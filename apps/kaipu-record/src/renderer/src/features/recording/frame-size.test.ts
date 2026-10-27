import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measureFrameSize } from "./frame-size";

const FALLBACK = { width: 1920, height: 1080 };

function fakeTrack(settings: { width?: number; height?: number }): MediaStreamTrack {
  return { getSettings: vi.fn(() => settings) } as unknown as MediaStreamTrack;
}

function frames(width: number, height: number): void {
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(height);
}

let pause: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(public tracks: unknown[]) {}
    },
  );
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("measureFrameSize", () => {
  it("prefers the delivered frames over the track's report", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    frames(3024, 1964);
    const size = await measureFrameSize(fakeTrack({ width: 7680, height: 4320 }), FALLBACK);
    expect(size).toEqual({ width: 3024, height: 1964 });
  });

  it("uses the report when the element knows no size", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    frames(0, 0);
    const size = await measureFrameSize(fakeTrack({ width: 2560, height: 1440 }), FALLBACK);
    expect(size).toEqual({ width: 2560, height: 1440 });
  });

  it("uses the report when play() rejects", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("NotAllowed"));
    const size = await measureFrameSize(fakeTrack({ width: 2560, height: 1440 }), FALLBACK);
    expect(size).toEqual({ width: 2560, height: 1440 });
  });

  it("uses the passed fallback when the report has no size either", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("NotAllowed"));
    expect(await measureFrameSize(fakeTrack({}), FALLBACK)).toEqual(FALLBACK);
  });

  it("stops waiting for a track that never delivers a frame", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(new Promise<void>(() => {}));
    const pending = measureFrameSize(fakeTrack({ width: 2560, height: 1440 }), FALLBACK, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ width: 2560, height: 1440 });
  });

  it("releases the element whichever way it ends", async () => {
    const create = vi.spyOn(document, "createElement");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("NotAllowed"));
    await measureFrameSize(fakeTrack({}), FALLBACK);
    const video = create.mock.results[0].value as HTMLVideoElement;
    expect(pause).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
  });
});
