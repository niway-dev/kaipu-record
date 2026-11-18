/**
 * The filmstrip worker's brain (ADR 0064, layer 2), without the worker: it takes requests, keeps
 * ONE file open between them, serves slots in priority order one frame at a time and cancels a
 * job when a newer request arrives. The container and the decoder are reached through
 * {@link FilmstripFile} / {@link FilmstripFileOpener} and time through {@link Clock}, so every
 * rule here (AC8, AC13, AC14, one file open, cancel) is tested with fakes.
 */
import {
  DEFAULT_DECODER,
  FILE_IDLE_MS,
  MAX_FAILED_IN_A_ROW,
  MAX_REQUEST_SLOTS,
  PACE_MAX_FRAMES,
  PACE_WINDOW_MS,
  PASS_SLOTS,
  type DecoderPreference,
  type FilmstripDoneMessage,
  type FilmstripRequestMessage,
  type FilmstripWorkerInput,
  type FilmstripWorkerOutput,
} from "./filmstrip-messages";
import {
  batchIntoPasses,
  groupByKeyframe,
  orderSlots,
  type DecodeGroup,
  type PlannedSlot,
  type SkipReason,
  type SkippedSlot,
} from "./filmstrip-plan";

/** One decoded and JPEG-encoded slot. */
export interface DecodedSlot {
  item: PlannedSlot;
  /** The decoded frame's true timestamp (what the store keys it by). */
  timestamp: number;
  blob: Blob;
  decodeMs: number;
  encodeMs: number;
}

/** An open media file. The engine holds at most one. */
export interface FilmstripFile {
  /** How a slot is filled, or why it is skipped (metadata only, no decoding). */
  plan(slot: PlannedSlot["slot"]): Promise<PlannedSlot | SkippedSlot>;
  /**
   * Decodes a group in one forward pass, yielding one slot at a time. A slot whose frame could
   * not be produced is left out. Stops promptly when the consumer calls `return()`.
   */
  decode(group: DecodeGroup): AsyncGenerator<DecodedSlot, void, undefined>;
  /** Frees the connection, the read cache and the decoder. */
  close(): Promise<void> | void;
}

export interface FilmstripFileOpener {
  open(url: string, decoder: DecoderPreference): Promise<FilmstripFile>;
}

/** Time, injected so a test can run ten seconds of idle in no time. */
export interface Clock {
  now(): number;
  /** Resolves after `ms`. */
  sleep(ms: number): Promise<void>;
  /** Lets the worker handle pending messages (a cancel, a newer request) before going on. */
  yield(): Promise<void>;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * At most `maxFrames` frames in any window of `windowMs`, and a yield before every frame so a
 * cancel can get in (AC14, decision 13). Shared by all jobs: a cancelled job's frames count
 * toward the next job's window, because the decoder and the main thread see one stream.
 */
export class FramePacer {
  private readonly stamps: number[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly maxFrames = PACE_MAX_FRAMES,
    private readonly windowMs = PACE_WINDOW_MS,
  ) {}

  /** Resolves when one more frame may be posted, and counts it. */
  async acquire(): Promise<void> {
    await this.clock.yield();
    for (;;) {
      const now = this.clock.now();
      while (this.stamps.length > 0 && this.stamps[0] <= now - this.windowMs) this.stamps.shift();
      if (this.stamps.length < this.maxFrames) {
        this.stamps.push(now);
        return;
      }
      // The oldest frame leaves the window at `stamps[0] + windowMs`.
      await this.clock.sleep(this.stamps[0] + this.windowMs - now);
    }
  }
}

interface Job {
  request: FilmstripRequestMessage;
  cancelled: boolean;
  /** Settles when the job has stopped touching the file. */
  finished: Promise<void>;
}

interface OpenState {
  url: string;
  decoder: DecoderPreference;
  /** Settles with the file; shared by a request that arrives while it is still opening. */
  file: Promise<FilmstripFile>;
  /** How long the open took. */
  openMs: number;
}

export interface FilmstripEngineOptions {
  opener: FilmstripFileOpener;
  post: (message: FilmstripWorkerOutput) => void;
  clock?: Clock;
  decoder?: DecoderPreference;
  idleMs?: number;
}

export class FilmstripEngine {
  private readonly opener: FilmstripFileOpener;
  private readonly post: (message: FilmstripWorkerOutput) => void;
  private readonly clock: Clock;
  private readonly pacer: FramePacer;
  private readonly idleMs: number;
  private decoder: DecoderPreference;
  private open: OpenState | null = null;
  private job: Job | null = null;
  private idleTimer: unknown = null;
  /** The file being closed, so the next one is never opened while the old one is still open. */
  private closing: Promise<void> = Promise.resolve();

  constructor(options: FilmstripEngineOptions) {
    this.opener = options.opener;
    this.post = options.post;
    this.clock = options.clock ?? realClock;
    this.pacer = new FramePacer(this.clock);
    this.idleMs = options.idleMs ?? FILE_IDLE_MS;
    this.decoder = options.decoder ?? DEFAULT_DECODER;
  }

  /** Handles one message. Never throws: a failure is reported as an `error` message. */
  handle(message: FilmstripWorkerInput): void {
    switch (message.type) {
      case "request":
        this.start(message);
        return;
      case "cancel":
        if (this.job?.request.requestId === message.requestId) this.job.cancelled = true;
        return;
      case "close":
        void this.closeNow("close");
        return;
      case "configure":
        if (message.decoder === this.decoder) return;
        this.decoder = message.decoder;
        void this.closeNow("decoder-changed");
        return;
    }
  }

  /** Resolves when no job is running. For tests and for shutdown. */
  async idle(): Promise<void> {
    while (this.job) await this.job.finished;
  }

  /** Cancels the job and closes the file, now. */
  async dispose(): Promise<void> {
    await this.closeNow("close");
  }

  // -------------------------------------------------------------------------------------

  private start(request: FilmstripRequestMessage): void {
    this.clearIdle();
    const previous = this.job;
    if (previous) previous.cancelled = true;

    const job: Job = { request, cancelled: false, finished: Promise.resolve() };
    // One job at a time: the new one waits for the old one to stop touching the file.
    job.finished = (async () => {
      await previous?.finished;
      try {
        await this.run(job);
      } catch (error) {
        this.post({
          type: "error",
          requestId: request.requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // A newer request owns the file from here on; only the last job arms the idle close.
        if (this.job === job) {
          this.job = null;
          this.armIdle();
        }
      }
    })();
    this.job = job;
  }

  private async run(job: Job): Promise<void> {
    const { request } = job;
    const startedAt = this.clock.now();
    const counts = { frames: 0, skippedNoFrame: 0, skippedOverCap: 0, failed: 0 };
    const finish = (opened: boolean, openMs: number): void => {
      const done: FilmstripDoneMessage = {
        type: "done",
        requestId: request.requestId,
        fileKey: request.fileKey,
        outcome: job.cancelled ? "cancelled" : "complete",
        ...counts,
        openedFile: opened,
        openMs,
        elapsedMs: this.clock.now() - startedAt,
      };
      this.post(done);
    };

    // Superseded while it waited for the job before it: it never touches the file.
    if (job.cancelled) return finish(false, 0);

    const { state, opened } = await this.acquire(request.url);
    const file = await state.file;
    const openMs = opened ? state.openMs : 0;
    if (job.cancelled) return finish(opened, openMs);

    const slots = orderSlots(
      request.slots,
      { playhead: request.playhead, direction: request.direction },
      MAX_REQUEST_SLOTS,
    );

    // Plan every slot first (metadata only), keeping the served order as each slot's rank.
    const planned: PlannedSlot[] = [];
    for (const [rank, slot] of slots.entries()) {
      if (job.cancelled) return finish(opened, openMs);
      try {
        const plan = await file.plan(slot);
        if (plan.kind === "plan") planned.push({ ...plan, rank });
        else this.count(counts, plan.reason);
      } catch {
        counts.failed += 1;
      }
    }

    // Single-slot retries that failed one after another: the cause is then the decoder or the
    // file, not a slot, and trying the rest only pays one more decoder start-up each.
    let failedInARow = 0;
    const passes = batchIntoPasses(groupByKeyframe(planned), PASS_SLOTS);
    for (const [passIndex, pass] of passes.entries()) {
      if (job.cancelled) break;
      if (failedInARow >= MAX_FAILED_IN_A_ROW) {
        counts.failed += passes.slice(passIndex).reduce((n, p) => n + p.items.length, 0);
        break;
      }
      const postedBefore = counts.frames;
      const left = await this.decodePass(job, file, pass, counts);
      if (counts.frames > postedBefore) failedInARow = 0;
      // A pass that threw keeps what it posted; the slots after the failure are tried one by one,
      // so one bad slot costs that slot and not the rest of the pass.
      for (const [position, item] of left.entries()) {
        if (job.cancelled) break;
        if (failedInARow >= MAX_FAILED_IN_A_ROW) {
          counts.failed += left.length - position;
          break;
        }
        const postedAlone = counts.frames;
        const rest = await this.decodePass(
          job,
          file,
          { keyTimestamp: item.keyTimestamp, items: [item] },
          counts,
        );
        if (rest.length > 0) {
          counts.failed += 1;
          failedInARow += 1;
        } else if (counts.frames > postedAlone) {
          failedInARow = 0;
        }
      }
    }
    finish(opened, openMs);
  }

  /**
   * Decodes one pass and posts its frames, paced. Returns the slots of the pass that were not
   * posted because the decode threw (none when it finished or the job was cancelled).
   */
  private async decodePass(
    job: Job,
    file: FilmstripFile,
    pass: DecodeGroup,
    counts: { frames: number; skippedNoFrame: number },
  ): Promise<PlannedSlot[]> {
    const { request } = job;
    const posted = new Set<PlannedSlot>();
    const generator = file.decode(pass);
    try {
      for (;;) {
        if (job.cancelled) return [];
        const next = await generator.next();
        if (next.done) {
          // The decoder had no frame for these (it returns nothing for a timestamp outside the
          // track): counted, so frames + skipped + failed adds up to the slots planned.
          counts.skippedNoFrame += pass.items.length - posted.size;
          return [];
        }
        if (job.cancelled) return [];
        await this.pacer.acquire();
        if (job.cancelled) return [];
        const decoded = next.value;
        posted.add(decoded.item);
        this.post({
          type: "frame",
          requestId: request.requestId,
          fileKey: request.fileKey,
          slotIndex: decoded.item.slot.index,
          timestamp: decoded.timestamp,
          blob: decoded.blob,
          bytes: decoded.blob.size,
          decodeMs: decoded.decodeMs,
          encodeMs: decoded.encodeMs,
        });
        counts.frames += 1;
      }
    } catch {
      return pass.items.filter((item) => !posted.has(item));
    } finally {
      await generator.return(undefined).catch(() => undefined);
    }
  }

  private count(counts: { skippedNoFrame: number; skippedOverCap: number }, reason: SkipReason) {
    if (reason === "over-cap") counts.skippedOverCap += 1;
    else counts.skippedNoFrame += 1;
  }

  /** The open file for `url`: the one already open, or a new one after closing the old. */
  private async acquire(url: string): Promise<{ state: OpenState; opened: boolean }> {
    if (this.open && this.open.url === url && this.open.decoder === this.decoder) {
      return { state: this.open, opened: false };
    }
    if (this.open) await this.closeFile(this.open.url === url ? "decoder-changed" : "other-file");
    await this.closing;

    const decoder = this.decoder;
    const startedAt = this.clock.now();
    const state: OpenState = {
      url,
      decoder,
      openMs: 0,
      file: this.opener.open(url, decoder).then((file) => {
        state.openMs = this.clock.now() - startedAt;
        this.post({ type: "file", event: "opened", url });
        return file;
      }),
    };
    this.open = state;
    // A failed open must not stay as "the open file": the next request tries again.
    state.file.catch(() => {
      if (this.open === state) this.open = null;
    });
    return { state, opened: true };
  }

  private closeFile(reason: "idle" | "close" | "other-file" | "decoder-changed"): Promise<void> {
    const open = this.open;
    if (!open) return this.closing;
    this.open = null;
    const closed = this.closing.then(async () => {
      try {
        const file = await open.file;
        await file.close();
        this.post({ type: "file", event: "closed", url: open.url, reason });
      } catch {
        // It never opened, or closing failed: nothing is left to hold.
      }
    });
    this.closing = closed;
    return closed;
  }

  private async closeNow(reason: "close" | "decoder-changed"): Promise<void> {
    this.clearIdle();
    const job = this.job;
    if (job) {
      job.cancelled = true;
      await job.finished;
    }
    await this.closeFile(reason);
  }

  private armIdle(): void {
    this.clearIdle();
    if (!this.open) return;
    this.idleTimer = this.clock.setTimer(() => {
      this.idleTimer = null;
      void this.closeFile("idle");
    }, this.idleMs);
  }

  private clearIdle(): void {
    if (this.idleTimer === null) return;
    this.clock.clearTimer(this.idleTimer);
    this.idleTimer = null;
  }
}
