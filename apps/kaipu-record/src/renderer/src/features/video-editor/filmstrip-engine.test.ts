import { describe, expect, it } from "vitest";
import {
  FilmstripEngine,
  FramePacer,
  type Clock,
  type DecodedSlot,
  type FilmstripFile,
  type FilmstripFileOpener,
} from "./filmstrip-engine";
import type { Slot } from "./filmstrip-frames";
import {
  DEFAULT_DECODER,
  FILE_IDLE_MS,
  MAX_FAILED_IN_A_ROW,
  PASS_SLOTS,
  MAX_REQUEST_SLOTS,
  type DecoderPreference,
  type FilmstripDoneMessage,
  type FilmstripFrameMessage,
  type FilmstripRequestMessage,
  type FilmstripWorkerOutput,
} from "./filmstrip-messages";
import type { DecodeGroup, PlannedSlot, SkippedSlot } from "./filmstrip-plan";

// ---------------------------------------------------------------------------------------
// A clock that only moves when the test says so
// ---------------------------------------------------------------------------------------

/** Lets pending promise callbacks and real I/O run, without moving the fake time. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class FakeClock implements Clock {
  time = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;

  now = () => this.time;
  sleep = (ms: number) => new Promise<void>((resolve) => this.setTimer(resolve, ms));
  /** A yield costs no time; it only lets a message handler run. */
  yield = () => Promise.resolve();
  setTimer = (fn: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.push({ at: this.time + ms, fn, id });
    return id;
  };
  clearTimer = (handle: unknown) => {
    this.timers = this.timers.filter((t) => t.id !== handle);
  };

  /** Moves time forward `ms`, firing every timer on the way in order. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      await settle();
      const next = this.timers.sort((a, b) => a.at - b.at)[0];
      if (!next || next.at > target) break;
      this.timers = this.timers.filter((t) => t !== next);
      this.time = Math.max(this.time, next.at);
      next.fn();
    }
    this.time = target;
    await settle();
  }

  /** Runs until `promise` settles, moving time to the next timer whenever everything waits. */
  async until<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    const result = promise.finally(() => {
      done = true;
    });
    result.catch(() => undefined);
    while (!done) {
      await settle();
      if (done) break;
      const next = this.timers.sort((a, b) => a.at - b.at)[0];
      if (!next) {
        await settle();
        if (!done) throw new Error("nothing left to wait for, and the promise is still pending");
        break;
      }
      this.timers = this.timers.filter((t) => t !== next);
      this.time = Math.max(this.time, next.at);
      next.fn();
    }
    return result;
  }
}

// ---------------------------------------------------------------------------------------
// A container that is only bookkeeping
// ---------------------------------------------------------------------------------------

interface FakeFileOptions {
  /** What the planner says per slot; default: the key packet at the slot start. */
  plan?: (slot: Slot) => PlannedSlot | SkippedSlot;
  /** Slots the decoder has no frame for: it yields nothing for them, as mediabunny does. */
  noFrameFor?: (slot: Slot) => boolean;
}

class FakeOpener implements FilmstripFileOpener {
  opens: { url: string; decoder: DecoderPreference }[] = [];
  closes: string[] = [];
  openNow = new Set<string>();
  maxOpenAtOnce = 0;
  failNextOpen = false;
  fileOptions: FakeFileOptions = {};
  /** Called with every decoded slot, before it is yielded: where a test injects a message. */
  onDecode: (slot: Slot) => void = () => undefined;
  /** Called with every pass handed to the decoder. */
  onPass: (group: DecodeGroup) => void = () => undefined;

  async open(url: string, decoder: DecoderPreference): Promise<FilmstripFile> {
    this.opens.push({ url, decoder });
    await Promise.resolve();
    if (this.failNextOpen) {
      this.failNextOpen = false;
      throw new Error("could not open");
    }
    this.openNow.add(url);
    this.maxOpenAtOnce = Math.max(this.maxOpenAtOnce, this.openNow.size);
    const options = this.fileOptions;
    const onDecode = (slot: Slot) => this.onDecode(slot);
    const onPass = (group: DecodeGroup) => this.onPass(group);
    return {
      plan: async (slot) =>
        options.plan?.(slot) ?? {
          kind: "plan",
          slot,
          keyframe: true,
          keyTimestamp: slot.start,
          targetTimestamp: slot.start,
          rank: 0,
        },
      decode: async function* (group: DecodeGroup) {
        onPass(group);
        for (const item of group.items) {
          onDecode(item.slot);
          if (options.noFrameFor?.(item.slot)) continue;
          const decoded: DecodedSlot = {
            item,
            timestamp: item.targetTimestamp,
            blob: new Blob(["jpeg"]),
            decodeMs: 1,
            encodeMs: 1,
          };
          yield decoded;
        }
      },
      close: () => {
        this.openNow.delete(url);
        this.closes.push(url);
      },
    };
  }
}

const slot = (n: number, step = 2, visible = true): Slot => ({
  index: n,
  start: n * step,
  end: (n + 1) * step,
  visible,
});

let nextRequest = 1;
const request = (
  slots: Slot[],
  overrides: Partial<FilmstripRequestMessage> = {},
): FilmstripRequestMessage => ({
  type: "request",
  requestId: nextRequest++,
  fileKey: "file-a",
  url: "kaipu-media://recording/a?w=ws",
  slots,
  playhead: 0,
  direction: 0,
  ...overrides,
});

function setup(
  options: { idleMs?: number; onPost?: (message: FilmstripWorkerOutput) => void } = {},
) {
  const clock = new FakeClock();
  const opener = new FakeOpener();
  const posted: FilmstripWorkerOutput[] = [];
  const times: number[] = [];
  const engine = new FilmstripEngine({
    opener,
    clock,
    decoder: "software",
    idleMs: options.idleMs,
    post: (message) => {
      posted.push(message);
      if (message.type === "frame") times.push(clock.now());
      options.onPost?.(message);
    },
  });
  const frames = (requestId?: number) =>
    posted.filter(
      (m): m is FilmstripFrameMessage =>
        m.type === "frame" && (requestId === undefined || m.requestId === requestId),
    );
  const done = (requestId: number) =>
    posted.find((m): m is FilmstripDoneMessage => m.type === "done" && m.requestId === requestId);
  const run = async (message: FilmstripRequestMessage) => {
    engine.handle(message);
    await clock.until(engine.idle());
  };
  return { clock, opener, posted, times, engine, frames, done, run };
}

describe("FramePacer: AC14 at most 60 frames in any one-second window", () => {
  it("lets 60 frames through at once and holds the 61st until the window moves", async () => {
    const clock = new FakeClock();
    const pacer = new FramePacer(clock);
    const stamps: number[] = [];
    const burst = (async () => {
      for (let i = 0; i < 61; i++) {
        await pacer.acquire();
        stamps.push(clock.now());
      }
    })();
    await clock.until(burst);
    expect(stamps.slice(0, 60).every((t) => t === 0)).toBe(true);
    expect(stamps[60]).toBe(1000);
  });

  it("never lets a window of 1000 ms hold more than 60 frames, however many are asked for", async () => {
    const clock = new FakeClock();
    const pacer = new FramePacer(clock);
    const stamps: number[] = [];
    await clock.until(
      (async () => {
        for (let i = 0; i < 500; i++) {
          await pacer.acquire();
          stamps.push(clock.now());
          // The caller is slow now and then, as a decode is.
          if (i % 7 === 0) await clock.sleep(13);
        }
      })(),
    );
    for (let i = 0; i + 60 < stamps.length; i++) {
      expect(stamps[i + 60] - stamps[i]).toBeGreaterThanOrEqual(1000);
    }
  });
});

describe("the request queue: decision 14", () => {
  it("posts the slots nearest the playhead first, then the rest of the visible slots", async () => {
    const t = setup();
    // 20 visible slots of 2 s; the playhead (5 s) is in slot 2.
    await t.run(
      request(
        Array.from({ length: 20 }, (_, n) => slot(n)),
        { playhead: 5, direction: 0 },
      ),
    );
    const order = t.frames().map((f) => f.slotIndex);
    expect(order).toHaveLength(20);
    // The first pass holds the PASS_SLOTS slots nearest the playhead (slots 0..7 here), in time
    // order inside the pass; the farthest slots come in the last pass.
    const first = order.slice(0, PASS_SLOTS);
    expect([...first].sort((a, b) => a - b)).toEqual(first);
    expect(first).toContain(2);
    expect(Math.max(...first)).toBeLessThan(Math.min(...order.slice(PASS_SLOTS * 2)));
  });

  it("decodes slots with their own keyframes in passes of PASS_SLOTS, not one pass each", async () => {
    const t = setup();
    const passes: number[][] = [];
    t.opener.onPass = (group) => passes.push(group.items.map((i) => i.slot.index));
    await t.run(
      request(
        Array.from({ length: 20 }, (_, n) => slot(n)),
        { playhead: 0 },
      ),
    );
    expect(passes.map((p) => p.length)).toEqual([8, 8, 4]);
  });

  it("posts the margin last, and only the side the view moves toward", async () => {
    const t = setup();
    // 16 visible slots (two passes), a margin of two slots before them and two after; the view
    // moves backwards. The margin is earlier in time than the view, so only its rank puts it last.
    await t.run(
      request(
        [
          ...[0, 1].map((n) => slot(n, 2, false)),
          ...Array.from({ length: 16 }, (_, n) => slot(n + 2)),
          ...[18, 19].map((n) => slot(n, 2, false)),
        ],
        { playhead: 20, direction: -1 },
      ),
    );
    const order = t.frames().map((f) => f.slotIndex);
    expect(order).toHaveLength(18);
    expect(order.slice(0, 16).every((n) => n >= 2 && n <= 17)).toBe(true);
    expect(order.slice(16)).toEqual([0, 1]);
  });

  it("keeps the frame's true timestamp, not the slot's", async () => {
    const t = setup();
    t.opener.fileOptions.plan = (s) => ({
      kind: "plan",
      slot: s,
      keyframe: true,
      keyTimestamp: s.start + 0.7,
      targetTimestamp: s.start + 0.7,
      rank: 0,
    });
    await t.run(request([slot(3)]));
    expect(t.frames()[0]).toMatchObject({
      slotIndex: 3,
      timestamp: 6.7,
      bytes: 4,
      fileKey: "file-a",
    });
  });

  it("cuts a request over the slot cap", async () => {
    const t = setup();
    const slots = Array.from({ length: MAX_REQUEST_SLOTS + 50 }, (_, n) => slot(n, 0.25));
    await t.run(request(slots));
    expect(t.frames()).toHaveLength(MAX_REQUEST_SLOTS);
  });

  it("AC8: a slot whose exact decode is over the cap posts nothing and is counted", async () => {
    const t = setup();
    t.opener.fileOptions.plan = (s) =>
      s.index === 1
        ? { kind: "skip", reason: "over-cap" }
        : s.index === 2
          ? { kind: "skip", reason: "no-frame" }
          : {
              kind: "plan",
              slot: s,
              keyframe: true,
              keyTimestamp: s.start,
              targetTimestamp: s.start,
              rank: 0,
            };
    const message = request([slot(0), slot(1), slot(2), slot(3)]);
    await t.run(message);
    expect(
      t
        .frames()
        .map((f) => f.slotIndex)
        .sort(),
    ).toEqual([0, 3]);
    expect(t.done(message.requestId)).toMatchObject({
      outcome: "complete",
      frames: 2,
      skippedOverCap: 1,
      skippedNoFrame: 1,
    });
  });

  it("shares one decode between slots of one keyframe (a group is decoded once)", async () => {
    const t = setup();
    const decoded: number[] = [];
    const passes: number[][] = [];
    t.opener.onDecode = (s) => decoded.push(s.index);
    t.opener.onPass = (group) => passes.push(group.items.map((i) => i.slot.index));
    t.opener.fileOptions.plan = (s) => ({
      kind: "plan",
      slot: s,
      keyframe: false,
      keyTimestamp: 0,
      targetTimestamp: s.start + 0.1,
      rank: 0,
    });
    // Played in reverse priority (playhead at the end), the group still decodes forward.
    await t.run(
      request(
        [0, 1, 2].map((n) => slot(n, 0.5)),
        { playhead: 1.4 },
      ),
    );
    expect(decoded).toEqual([0, 1, 2]);
    // One keyframe group is one decoder pass.
    expect(passes).toEqual([[0, 1, 2]]);
    // ...but the frames are posted in that decode order, not the served order.
    expect(t.frames().map((f) => f.slotIndex)).toEqual([0, 1, 2]);
  });
});

describe("AC14: the worker paces itself", () => {
  it("posts at most 60 frames in any one-second window, and all of them in the end", async () => {
    const t = setup();
    const slots = Array.from({ length: 150 }, (_, n) => slot(n, 0.25));
    const message = request(slots);
    await t.run(message);
    expect(t.frames()).toHaveLength(150);
    for (let i = 0; i + 60 < t.times.length; i++) {
      expect(t.times[i + 60] - t.times[i]).toBeGreaterThanOrEqual(1000);
    }
    // 150 frames at 60 per second take at least two full windows after the first 60.
    expect(t.times[149]).toBeGreaterThanOrEqual(2000);
  });

  it("posts 17 frames at once: nothing slows an ordinary view down", async () => {
    const t = setup();
    await t.run(request(Array.from({ length: 17 }, (_, n) => slot(n))));
    expect(t.times.every((time) => time === 0)).toBe(true);
  });
});

describe("AC7: a new request cancels the job in flight", () => {
  it("stops the older job's frames the moment the newer request arrives", async () => {
    const older = request([0, 1, 2, 3, 4, 5].map((n) => slot(n)));
    const newer = request([slot(10)]);
    let sent = false;
    const t = setup({
      onPost: (message) => {
        if (message.type === "frame" && message.requestId === older.requestId && !sent) {
          // Frame 1 of the older job has just been posted; a newer request comes in.
          sent = true;
          t.engine.handle(newer);
        }
      },
    });
    t.engine.handle(older);
    await t.clock.until(t.engine.idle());

    expect(t.frames(older.requestId)).toHaveLength(1);
    expect(t.done(older.requestId)).toMatchObject({ outcome: "cancelled", frames: 1 });
    expect(t.frames(newer.requestId).map((f) => f.slotIndex)).toEqual([10]);
    expect(t.done(newer.requestId)).toMatchObject({ outcome: "complete", frames: 1 });
  });

  it("the older job's last frame is never posted after its done message", async () => {
    const t = setup();
    const older = request([0, 1, 2].map((n) => slot(n)));
    t.opener.onDecode = (s) => {
      if (s.index === 0) t.engine.handle({ type: "cancel", requestId: older.requestId });
    };
    await t.run(older);
    const kinds = t.posted
      .filter((m) => m.type === "frame" || m.type === "done")
      .map((m) => m.type);
    expect(kinds.at(-1)).toBe("done");
    expect(t.done(older.requestId)?.outcome).toBe("cancelled");
    expect(t.frames(older.requestId)).toHaveLength(0);
  });

  it("a request superseded before it ran never opens its file", async () => {
    const t = setup();
    const a = request([slot(0)], { url: "kaipu-media://recording/one" });
    const b = request([slot(0)], { url: "kaipu-media://recording/two" });
    const c = request([slot(1)], { url: "kaipu-media://recording/one" });
    t.engine.handle(a);
    t.engine.handle(b);
    t.engine.handle(c);
    await t.clock.until(t.engine.idle());
    expect(t.opener.opens.map((o) => o.url)).toEqual(["kaipu-media://recording/one"]);
    expect(t.done(a.requestId)).toMatchObject({
      outcome: "cancelled",
      frames: 0,
      openedFile: false,
    });
    expect(t.done(b.requestId)).toMatchObject({ outcome: "cancelled", frames: 0 });
    // `c` is the only request that touched the file: it opened it, so `a` (same URL) did not.
    expect(t.done(c.requestId)).toMatchObject({
      outcome: "complete",
      frames: 1,
      openedFile: true,
    });
  });
});

describe("AC13 and AC5: one file open, kept for 10 s, then closed", () => {
  it("prepares the file without decoding and reuses it for the first frame", async () => {
    const { engine, clock, opener, frames, run } = setup();
    const first = request([slot(0)]);
    engine.handle({ type: "prepare", url: first.url });
    await clock.until(engine.idle());
    expect(frames()).toHaveLength(0);
    await run(first);
    expect(opener.opens).toHaveLength(1);
    expect(frames()).toHaveLength(1);
    await engine.dispose();
  });

  const A = "kaipu-media://recording/a?w=ws";
  const B = "kaipu-media://recording/b?w=ws";

  it("AC13: two requests less than 10 s apart open the file once", async () => {
    const t = setup();
    const first = request([slot(0)], { url: A });
    await t.run(first);
    await t.clock.advance(FILE_IDLE_MS - 1);
    const second = request([slot(1)], { url: A });
    await t.run(second);
    expect(t.opener.opens).toHaveLength(1);
    expect(t.done(first.requestId)?.openedFile).toBe(true);
    expect(t.done(second.requestId)?.openedFile).toBe(false);
    expect(t.done(second.requestId)?.openMs).toBe(0);
    expect(t.opener.closes).toEqual([]);
  });

  it("AC13: each request restarts the 10 s", async () => {
    const t = setup();
    await t.run(request([slot(0)], { url: A }));
    await t.clock.advance(9000);
    await t.run(request([slot(1)], { url: A }));
    await t.clock.advance(9000);
    expect(t.opener.closes).toEqual([]);
    await t.clock.advance(1000);
    expect(t.opener.closes).toEqual([A]);
  });

  it("AC13: 10 s after the last request the file closes, and a later request opens it again", async () => {
    const t = setup();
    await t.run(request([slot(0)], { url: A }));
    await t.clock.advance(FILE_IDLE_MS);
    expect(t.opener.closes).toEqual([A]);
    expect(t.posted).toContainEqual({ type: "file", event: "closed", url: A, reason: "idle" });
    const later = request([slot(1)], { url: A });
    await t.run(later);
    expect(t.opener.opens).toHaveLength(2);
    expect(t.done(later.requestId)?.openedFile).toBe(true);
  });

  it("does not close the file while a job is still running", async () => {
    // 192 frames paced at 60 a second take over 3 s: longer than this 2 s idle timeout.
    const t = setup({ idleMs: 2000 });
    await t.run(
      request(
        Array.from({ length: 192 }, (_, n) => slot(n, 0.25)),
        { url: A },
      ),
    );
    expect(t.clock.now()).toBeGreaterThan(2000);
    expect(t.opener.closes).toEqual([]);
    await t.clock.advance(2000);
    expect(t.opener.closes).toEqual([A]);
  });

  it("AC5: another file closes the open one before it opens: never two at once", async () => {
    const t = setup();
    await t.run(request([slot(0)], { url: A }));
    await t.run(request([slot(0)], { url: B }));
    expect(t.opener.maxOpenAtOnce).toBe(1);
    expect(t.opener.closes).toEqual([A]);
    expect(t.posted).toContainEqual({
      type: "file",
      event: "closed",
      url: A,
      reason: "other-file",
    });
    const order = t.posted
      .filter((m) => m.type === "file")
      .map((m) => (m.type === "file" ? `${m.event}:${m.url}` : ""));
    expect(order).toEqual([`opened:${A}`, `closed:${A}`, `opened:${B}`]);
  });

  it("a close message sent while a request runs cancels it and closes the file", async () => {
    const t = setup();
    const message = request(
      Array.from({ length: 12 }, (_, n) => slot(n)),
      { url: A },
    );
    // The editor needs the decoder while the third slot is being decoded.
    t.opener.onDecode = (s) => {
      if (s.index === 2) t.engine.handle({ type: "close" });
    };
    await t.run(message);
    await t.clock.advance(0);
    expect(t.done(message.requestId)).toMatchObject({ outcome: "cancelled" });
    expect(t.frames().length).toBeLessThan(12);
    expect(t.opener.closes).toEqual([A]);
    expect(t.posted).toContainEqual({ type: "file", event: "closed", url: A, reason: "close" });
  });

  it("closes the file now on a close message when nothing is running", async () => {
    const t = setup();
    await t.run(request([slot(0)], { url: A }));
    t.engine.handle({ type: "close" });
    await t.clock.advance(0);
    expect(t.opener.closes).toEqual([A]);
    expect(t.posted).toContainEqual({ type: "file", event: "closed", url: A, reason: "close" });
  });

  it("changing the decoder closes the file; the next request opens it with the new decoder", async () => {
    const t = setup();
    await t.run(request([slot(0)], { url: A }));
    t.engine.handle({ type: "configure", decoder: "hardware" });
    await t.clock.advance(0);
    expect(t.opener.closes).toEqual([A]);
    await t.run(request([slot(1)], { url: A }));
    expect(t.opener.opens.map((o) => o.decoder)).toEqual(["software", "hardware"]);
  });

  it("an engine told nothing about the decoder uses the measured default", async () => {
    const opener = new FakeOpener();
    const engine = new FilmstripEngine({ opener, post: () => undefined });
    engine.handle(request([slot(0)], { url: A }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opener.opens.map((o) => o.decoder)).toEqual([DEFAULT_DECODER]);
    engine.dispose();
  });

  it("configuring the decoder it already has does nothing", async () => {
    const t = setup();
    await t.run(request([slot(0)], { url: A }));
    t.engine.handle({ type: "configure", decoder: "software" });
    await t.clock.advance(0);
    expect(t.opener.closes).toEqual([]);
  });
});

describe("failures", () => {
  it("reports a file that cannot be opened, and opens it on the next request", async () => {
    const t = setup();
    t.opener.failNextOpen = true;
    const first = request([slot(0)]);
    await t.run(first);
    expect(t.posted).toContainEqual({
      type: "error",
      requestId: first.requestId,
      message: "could not open",
    });
    const second = request([slot(0)]);
    await t.run(second);
    expect(t.done(second.requestId)).toMatchObject({ outcome: "complete", frames: 1 });
  });

  it("counts a slot the decoder has no frame for, so the numbers add up", async () => {
    const t = setup();
    t.opener.fileOptions.noFrameFor = (s) => s.index === 1;
    const message = request([slot(0), slot(1), slot(2)]);
    await t.run(message);
    expect(t.frames().map((f) => f.slotIndex)).toEqual([0, 2]);
    expect(t.done(message.requestId)).toMatchObject({
      frames: 2,
      skippedNoFrame: 1,
      skippedOverCap: 0,
      failed: 0,
    });
  });

  it("gives up on a request whose decodes keep failing, instead of retrying every slot", async () => {
    const t = setup();
    const passes: number[][] = [];
    t.opener.onPass = (g) => passes.push(g.items.map((i) => i.slot.index));
    t.opener.onDecode = () => {
      throw new Error("the decoder cannot start");
    };
    const message = request(Array.from({ length: 24 }, (_, n) => slot(n)));
    await t.run(message);
    expect(t.frames()).toHaveLength(0);
    expect(t.done(message.requestId)).toMatchObject({ outcome: "complete", frames: 0, failed: 24 });
    // One pass of 8 plus MAX_FAILED_IN_A_ROW single-slot retries; nothing after that is tried.
    expect(passes).toHaveLength(1 + MAX_FAILED_IN_A_ROW);
  });

  it("a decode that throws costs that slot only, not the rest of its pass", async () => {
    const t = setup();
    t.opener.onDecode = (s) => {
      if (s.index === 1) throw new Error("decoder error");
    };
    const message = request([slot(0), slot(1), slot(2)]);
    await t.run(message);
    expect(
      t
        .frames()
        .map((f) => f.slotIndex)
        .sort(),
    ).toEqual([0, 2]);
    expect(t.done(message.requestId)).toMatchObject({ outcome: "complete", failed: 1, frames: 2 });
  });
});
