import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRecordingCompositor, type RecordingCompositor } from "./recording-compositor";

// jsdom has no 2D context, captureStream, MediaStream or requestVideoFrameCallback: every
// piece the compositor touches is a manual fake, and time is a clock the test moves.
let clock: number;
let ctx: { drawImage: ReturnType<typeof vi.fn>; clearRect: ReturnType<typeof vi.fn> };
/** The frame callback the compositor is waiting on (rVFC), or null when none is pending. */
let pending: VideoFrameRequestCallback | null;
/** The rAF callback the compositor is waiting on, or null. */
let rafPending: FrameRequestCallback | null;
let started: RecordingCompositor[];

/** The <video> presents a new source frame at `t`. */
function fireFrame(t: number): void {
  const cb = pending;
  pending = null;
  cb?.(t, {} as VideoFrameCallbackMetadata);
}

/** The display refreshes at `t`. */
function fireRaf(t: number): void {
  const cb = rafPending;
  rafPending = null;
  cb?.(t);
}

async function start({ frameRate }: { frameRate: number }): Promise<RecordingCompositor> {
  const c = await startRecordingCompositor(
    new MediaStream([{}] as unknown as MediaStreamTrack[]),
    { width: 100, height: 100 },
    null,
    frameRate,
  );
  started.push(c);
  return c;
}

beforeEach(() => {
  clock = 0;
  pending = null;
  rafPending = null;
  started = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(console, "info").mockImplementation(() => {}); // the per-take cadence line
  ctx = { drawImage: vi.fn(), clearRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  HTMLCanvasElement.prototype.captureStream = vi.fn(
    () => ({ getVideoTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream,
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(public tracks: unknown[]) {}
      getVideoTracks(): unknown[] {
        return this.tracks;
      }
    },
  );
  HTMLVideoElement.prototype.requestVideoFrameCallback = vi.fn((cb) => {
    pending = cb;
    return 1;
  });
  HTMLVideoElement.prototype.cancelVideoFrameCallback = vi.fn(() => {
    pending = null;
  });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      rafPending = cb;
      return 2;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn(() => {
      rafPending = null;
    }),
  );
});

afterEach(() => {
  for (const c of started) c.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).captureStream;
  delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).requestVideoFrameCallback;
  delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).cancelVideoFrameCallback;
});

describe("startRecordingCompositor cadence", () => {
  it("draws once up front, then once per source frame", async () => {
    await start({ frameRate: 30 });
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    clock = 40;
    fireFrame(40);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  });

  it("never draws faster than the capture frame rate", async () => {
    await start({ frameRate: 30 });
    // A 60 Hz source for 100 ms: at most one draw per 1/30 s on top of the first.
    for (let t = 16.7; t <= 100; t += 16.7) {
      clock = t;
      fireFrame(t);
    }
    expect(ctx.drawImage.mock.calls.length).toBeLessThanOrEqual(1 + 4);
  });

  it("does not draw while paused and redraws once on resume", async () => {
    const c = await start({ frameRate: 30 });
    c.pause();
    expect(HTMLVideoElement.prototype.cancelVideoFrameCallback).toHaveBeenCalled();
    expect(pending).toBeNull();
    clock = 5000;
    vi.advanceTimersByTime(5000); // no heartbeat while paused either
    const before = ctx.drawImage.mock.calls.length;
    expect(before).toBe(1);
    c.resume();
    expect(ctx.drawImage).toHaveBeenCalledTimes(before + 1);
    expect(pending).not.toBeNull();
  });

  it("pause/resume are idempotent and inert after stop", async () => {
    const c = await start({ frameRate: 30 });
    c.pause();
    c.pause();
    c.resume();
    c.resume();
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    const n = ctx.drawImage.mock.calls.length;
    c.stop();
    c.resume();
    expect(ctx.drawImage).toHaveBeenCalledTimes(n);
  });

  it("stop cancels the pending callback and stops the track", async () => {
    const c = await start({ frameRate: 30 });
    clock = 2000;
    c.stop();
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("1 draws"));
    expect(pending).toBeNull();
    expect(c.track.stop).toHaveBeenCalled();
    clock = 5000;
    vi.advanceTimersByTime(5000);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("falls back to requestAnimationFrame without requestVideoFrameCallback", async () => {
    delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).requestVideoFrameCallback;
    await start({ frameRate: 30 });
    // A 120 Hz display for 100 ms.
    for (let t = 8; t <= 100; t += 8) {
      clock = t;
      fireRaf(t);
    }
    expect(ctx.drawImage.mock.calls.length).toBeLessThanOrEqual(1 + 4);
  });

  it("keeps the capture rate on a 60 Hz clock even when a draw takes a few ms", async () => {
    delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).requestVideoFrameCallback;
    // Resampling a 5.9 MP frame is not free: the clock moves while drawImage runs.
    ctx.drawImage.mockImplementation(() => {
      clock += 5;
    });
    await start({ frameRate: 30 });
    for (let k = 1; k <= 60; k++) {
      const t = (k * 1000) / 60;
      clock = t;
      fireRaf(t);
    }
    // One second of 60 Hz frames: every other one is drawn, not every third.
    expect(ctx.drawImage.mock.calls.length).toBeGreaterThanOrEqual(30);
    expect(ctx.drawImage.mock.calls.length).toBeLessThanOrEqual(31);
  });

  it("switches to requestAnimationFrame when no source frame arrives within 500 ms", async () => {
    await start({ frameRate: 30 });
    expect(rafPending).toBeNull();
    clock = 500;
    vi.advanceTimersByTime(500);
    expect(HTMLVideoElement.prototype.cancelVideoFrameCallback).toHaveBeenCalled();
    expect(pending).toBeNull();
    expect(rafPending).not.toBeNull();
    clock = 540;
    fireRaf(540);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  });

  it("stays on requestVideoFrameCallback once a source frame arrived", async () => {
    await start({ frameRate: 30 });
    clock = 40;
    fireFrame(40);
    clock = 600;
    vi.advanceTimersByTime(600);
    expect(rafPending).toBeNull();
    expect(pending).not.toBeNull();
  });

  it("heartbeat redraws a static screen", async () => {
    await start({ frameRate: 30 });
    clock = 1000;
    vi.advanceTimersByTime(1000);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  });
});
