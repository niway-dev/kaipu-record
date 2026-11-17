/**
 * When and what the editor asks the filmstrip worker for (ADR 0064, layer 3). It turns the
 * timeline view and the lanes' files into worker requests:
 *
 * - **Rest first (decision 7).** A request starts only after the view has been still for
 *   {@link REST_MS}. Every zoom or scroll tick before that cancels the job in flight and restarts
 *   the wait, so continuous scrolling starts no decode (AC7). The controller listens to the view
 *   store, never to a React render: the strip re-renders on every scroll tick.
 * - **Pause (AC6).** While the preview plays or an export runs nothing is requested, the job in
 *   flight is stopped and the worker closes its file, because playback and export need the decoder.
 * - **One file at a time.** The worker serves one request and a newer one cancels the older, so
 *   the files of the visible lanes are asked for in turn.
 * - **Fit zoom asks for nothing (AC3).** The 24 frames the editor decodes at open already cover it.
 *
 * Everything is injected (worker, timers, store), so it runs under test with fakes. Times in a
 * request are in the media file's OWN time, like the frame store; `fileOffset` is what turns the
 * timeline's SOURCE axis into it (a joined recording's offset, a webcam's start offset).
 */
import { planTileSlots, type Slot, type TimeRange } from "./filmstrip-frames";
import { realTimers, type FilmstripStore, type FilmstripTimers } from "./filmstrip-store";
import type {
  FilmstripWorkerInput,
  FilmstripWorkerOutput,
  ScrollDirection,
} from "./filmstrip-messages";
import { THUMB_TILE_PX } from "./components/timeline-geometry";
import { scaleOf, visibleRange, type TimelineView } from "./components/timeline-view";

/** The view must rest this long before anything is decoded (decision 7). */
export const REST_MS = 120;

/** One clip block of a lane: where it sits on the timeline and which stretch of the source it plays. */
export interface FilmstripClip {
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

/** One media file a visible lane draws tiles from. */
export interface FilmstripTarget {
  /** The frame store key: the full `kaipu-media://` URL, which the worker reads by Range. */
  fileKey: string;
  /** The file's duration in its own time. Unknown or not positive: nothing is requested. */
  duration: number;
  /** File time = SOURCE time − `fileOffset`. */
  fileOffset: number;
  clips: readonly FilmstripClip[];
  /** The frames the editor decodes at open, in file time: slots they fill are not asked for. */
  legacy: readonly { timestamp: number }[];
}

/** The part of a Worker the controller uses. */
export interface FilmstripWorkerPort {
  postMessage(message: FilmstripWorkerInput): void;
  terminate(): void;
  onmessage: ((event: { data: FilmstripWorkerOutput }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface FilmstripControllerOptions {
  store: FilmstripStore;
  createWorker(): FilmstripWorkerPort;
  /** The timeline view store's live view. */
  getView(): TimelineView;
  timers?: FilmstripTimers;
  restMs?: number;
  /**
   * Terminate the worker when it reports its file closed for being idle. For the software decoder,
   * whose GPU memory stays held until the worker ends (layer 2 measured about 290 MB).
   */
  terminateOnIdleClose?: boolean;
  /** Start the worker and read the first visible file's index when the editor opens. */
  prewarm?: boolean;
}

interface QueuedRequest {
  target: FilmstripTarget;
  slots: Slot[];
  playhead: number;
  direction: ScrollDirection;
  view: TimeRange;
}

/** Merges two lists sorted by timestamp, keeping both. */
function mergeSorted<A extends { timestamp: number }, B extends { timestamp: number }>(
  a: readonly A[],
  b: readonly B[],
): { timestamp: number }[] {
  const out: { timestamp: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i].timestamp <= b[j].timestamp)) out.push(a[i++]);
    else out.push(b[j++]);
  }
  return out;
}

export class FilmstripController {
  private readonly store: FilmstripStore;
  private readonly createWorker: () => FilmstripWorkerPort;
  private readonly getView: () => TimelineView;
  private readonly timers: FilmstripTimers;
  private readonly restMs: number;
  private readonly terminateOnIdleClose: boolean;
  private readonly prewarm: boolean;

  private worker: FilmstripWorkerPort | null = null;
  private targets: readonly FilmstripTarget[] = [];
  private playhead: number | null = null;
  private paused = false;
  private disposed = false;
  private restTimer: unknown = null;
  private queue: QueuedRequest[] = [];
  private inFlight: {
    requestId: number;
    fileKey: string;
    view: TimeRange;
    cancelled: boolean;
    remaining: number;
  } | null = null;
  private nextRequestId = 1;
  /** Frames of a request older than this are dropped (a workspace switch emptied the store). */
  private minAcceptedId = 1;
  private lastScroll: number | null = null;
  private direction: ScrollDirection = 0;

  constructor(options: FilmstripControllerOptions) {
    this.store = options.store;
    this.createWorker = options.createWorker;
    this.getView = options.getView;
    this.timers = options.timers ?? realTimers;
    this.restMs = options.restMs ?? REST_MS;
    this.terminateOnIdleClose = options.terminateOnIdleClose ?? false;
    this.prewarm = options.prewarm ?? false;
  }

  // ---- inputs -------------------------------------------------------------------------

  /** The files of the visible lanes (hidden lanes are left out by the caller). */
  setTargets(targets: readonly FilmstripTarget[]): void {
    this.targets = targets;
    if (this.prewarm && !this.worker && !this.paused && !this.disposed) {
      const first = targets.find(
        (target) => Number.isFinite(target.duration) && target.duration > 0,
      );
      if (first) this.ensureWorker().postMessage({ type: "prepare", url: first.fileKey });
    }
    this.touch();
  }

  /** The playhead in SOURCE time (null over a slide): slots nearest it are decoded first. */
  setPlayhead(sourceTime: number | null): void {
    this.playhead = sourceTime;
  }

  /** The zoom or the scroll changed: stop what runs and wait for the view to rest. */
  viewChanged(): void {
    this.touch();
  }

  /** True while the preview plays or an export runs (AC6): nothing decodes until it is false. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.clearRestTimer();
      this.queue = [];
      this.inFlight = null;
      this.worker?.postMessage({ type: "close" });
    } else {
      this.touch();
    }
  }

  /** A workspace switch (AC10): forget what was asked, empty the store, close the open file. */
  reset(): void {
    this.clearRestTimer();
    this.queue = [];
    this.inFlight = null;
    this.minAcceptedId = this.nextRequestId;
    this.worker?.postMessage({ type: "close" });
    this.store.clear();
  }

  /** The editor is gone: stop everything and end the worker. */
  dispose(): void {
    this.disposed = true;
    this.clearRestTimer();
    this.queue = [];
    this.inFlight = null;
    this.endWorker();
  }

  // ---- scheduling ---------------------------------------------------------------------

  private touch(): void {
    if (this.disposed || this.paused) return;
    this.clearRestTimer();
    this.queue = [];
    const view = this.getView();
    if (this.lastScroll !== null && view.scroll !== this.lastScroll) {
      this.direction = view.scroll > this.lastScroll ? 1 : -1;
    }
    this.lastScroll = view.scroll;
    if (this.inFlight && !this.inFlight.cancelled) {
      // A stale job must not keep decoding after the user moved on (once is enough).
      this.inFlight.cancelled = true;
      this.worker?.postMessage({ type: "cancel", requestId: this.inFlight.requestId });
    }
    this.restTimer = this.timers.set(() => {
      this.restTimer = null;
      this.atRest();
    }, this.restMs);
  }

  private clearRestTimer(): void {
    if (this.restTimer !== null) this.timers.clear(this.restTimer);
    this.restTimer = null;
  }

  private atRest(): void {
    if (this.disposed || this.paused) return;
    this.queue = this.plan();
    this.pump();
  }

  /**
   * Per file, one slot for each tile that has no frame of its own time yet, for what the lanes show
   * and one screen around it. The tiles on screen of ALL files come first, then the margins, so a
   * row's margin never holds back another row's visible tiles (the worker runs one request at a
   * time).
   */
  private plan(): QueuedRequest[] {
    const view = this.getView();
    if (view.zoom <= 1) return []; // AC3: the strip decoded at open covers fit zoom
    const scale = scaleOf(view);
    if (scale <= 0) return [];
    const shown = visibleRange(view);
    if (shown.end <= shown.start) return [];

    const onScreen: QueuedRequest[] = [];
    const around: QueuedRequest[] = [];
    for (const target of this.targets) {
      if (!Number.isFinite(target.duration) || target.duration <= 0) continue;
      const frames = mergeSorted(this.store.liveFrames(target.fileKey), target.legacy);
      const byKey = new Map<string, Slot>();
      let hullStart = Infinity;
      let hullEnd = -Infinity;
      for (const clip of target.clips) {
        const length = clip.timelineEnd - clip.timelineStart;
        const sourceLength = clip.sourceEnd - clip.sourceStart;
        if (length <= 0 || sourceLength <= 0) continue;
        const from = Math.max(shown.start, clip.timelineStart);
        const to = Math.min(shown.end, clip.timelineEnd);
        if (to <= from) continue;
        const rate = sourceLength / length;
        const visible: TimeRange = {
          start: clip.sourceStart + (from - clip.timelineStart) * rate - target.fileOffset,
          end: clip.sourceStart + (to - clip.timelineStart) * rate - target.fileOffset,
        };
        // The same tile count as `thumbnailTiles`: one tile per THUMB_TILE_PX of block width.
        const count = Math.max(1, Math.round((length * scale) / THUMB_TILE_PX));
        hullStart = Math.min(hullStart, visible.start);
        hullEnd = Math.max(hullEnd, visible.end);
        const slots = planTileSlots({
          duration: target.duration,
          clip: {
            start: clip.sourceStart - target.fileOffset,
            end: clip.sourceEnd - target.fileOffset,
          },
          count,
          visible,
          frames,
        });
        for (const slot of slots) {
          const key = `${slot.start}:${slot.end}`;
          const known = byKey.get(key);
          if (!known) byKey.set(key, slot);
          else if (slot.visible && !known.visible) byKey.set(key, { ...known, visible: true });
        }
      }
      if (byKey.size === 0) continue;
      const slots = [...byKey.values()].sort((a, b) => a.start - b.start);
      const base = {
        target,
        playhead: this.playheadIn(target, hullStart, hullEnd),
        direction: this.direction,
        view: { start: hullStart, end: hullEnd },
      };
      const near = slots.filter((slot) => slot.visible);
      const far = slots.filter((slot) => !slot.visible);
      if (near.length > 0) onScreen.push({ ...base, slots: near });
      if (far.length > 0) around.push({ ...base, slots: far });
    }
    return [...onScreen, ...around];
  }

  /** The playhead in the file's own time; the middle of what is shown when it is elsewhere. */
  private playheadIn(target: FilmstripTarget, from: number, to: number): number {
    const middle = (from + to) / 2;
    if (this.playhead === null) return middle;
    const t = this.playhead - target.fileOffset;
    return t >= from && t <= to ? t : middle;
  }

  /** Sends the next queued request when the worker is not busy with one. */
  private pump(): void {
    if (this.disposed || this.paused || this.inFlight) return;
    const next = this.queue.shift();
    if (!next) return;
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    this.inFlight = {
      requestId,
      fileKey: next.target.fileKey,
      view: next.view,
      cancelled: false,
      remaining: next.slots.length,
    };
    worker.postMessage({
      type: "request",
      requestId,
      fileKey: next.target.fileKey,
      url: next.target.fileKey,
      slots: next.slots,
      playhead: next.playhead,
      direction: next.direction,
    });
  }

  // ---- the worker ---------------------------------------------------------------------

  private ensureWorker(): FilmstripWorkerPort {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event) => this.onMessage(worker, event.data);
    worker.onerror = () => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.inFlight = null;
      worker.terminate();
      console.warn("[filmstrip] the thumbnail worker failed; the next request starts a new one");
      // The request it was running is lost; the files still queued go on with a fresh worker.
      this.pump();
    };
    this.worker = worker;
    return worker;
  }

  private endWorker(): void {
    const worker = this.worker;
    this.worker = null;
    this.inFlight = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }

  private onMessage(from: FilmstripWorkerPort, message: FilmstripWorkerOutput): void {
    if (this.worker !== from) return;
    switch (message.type) {
      case "frame": {
        if (message.requestId < this.minAcceptedId) return;
        const view =
          this.inFlight?.requestId === message.requestId ? this.inFlight.view : undefined;
        this.store.add(
          message.fileKey,
          { timestamp: message.timestamp, blob: message.blob, bytes: message.bytes },
          view,
        );
        if (this.inFlight?.requestId === message.requestId) {
          this.inFlight.remaining--;
          // Publish the final visible frame before the decoder tears its pass down.
          if (this.inFlight.remaining === 0) this.store.flush();
        }
        return;
      }
      case "done":
      case "error":
        if (this.inFlight?.requestId === message.requestId) this.inFlight = null;
        // The last frame of the request is in: show it now, not at the next batch (AC1).
        this.store.flush();
        this.pump();
        return;
      case "file":
        // Not while a request is in flight: it was posted after the idle close began and the
        // worker is already running it (ending the worker would lose it).
        if (
          message.event === "closed" &&
          message.reason === "idle" &&
          this.terminateOnIdleClose &&
          !this.inFlight
        ) {
          this.endWorker();
        }
        return;
    }
  }
}
