import { renderHook, waitFor } from "@testing-library/react";
import { CanvasSink } from "mediabunny";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openRecordingInput } from "@renderer/lib/open-recording-input";
import {
  __resetSourceThumbnailCacheForTests,
  companionCoveredRange,
  companionSampleTimes,
  useCompanionThumbnails,
  useSourceThumbnails,
} from "./use-source-thumbnails";

// mediabunny decodes via WebCodecs, which jsdom lacks — mock it and the Range-reader helper
// at the boundary so the test exercises OUR orchestration (open → sink → blobs → cache).
vi.mock("mediabunny", () => ({ CanvasSink: vi.fn() }));
vi.mock("@renderer/lib/open-recording-input", () => ({ openRecordingInput: vi.fn() }));

const CanvasSinkMock = vi.mocked(CanvasSink);
const openMock = vi.mocked(openRecordingInput);

function asyncIterableOf<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

const fakeCanvas = () => ({
  toBlob: (cb: (b: Blob | null) => void) =>
    cb(new Blob([new Uint8Array([1])], { type: "image/jpeg" })),
});

const frames = (n: number) =>
  asyncIterableOf(Array.from({ length: n }, (_, i) => ({ canvas: fakeCanvas(), timestamp: i })));

const inputs: {
  getPrimaryVideoTrack: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}[] = [];
const lastInput = () => inputs[inputs.length - 1]!;

function stubInput(track: unknown) {
  openMock.mockImplementation((() => {
    const input = { getPrimaryVideoTrack: vi.fn(async () => track), dispose: vi.fn() };
    inputs.push(input);
    return input;
  }) as never);
}

function stubSink() {
  CanvasSinkMock.mockImplementation(function () {
    return { canvasesAtTimestamps: vi.fn(() => frames(24)) };
  } as never);
}

const URL_R1 = "kaipu-media://recording/r1";

beforeEach(() => {
  vi.clearAllMocks();
  inputs.length = 0;
  __resetSourceThumbnailCacheForTests();
  vi.stubGlobal("fetch", vi.fn());
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:thumb-${n++}`);
  URL.revokeObjectURL = vi.fn();
  stubInput({});
  stubSink();
});

describe("useSourceThumbnails", () => {
  it("decodes 24 thumbnails through openRecordingInput and never fetches the whole file", async () => {
    const { result } = renderHook(() => useSourceThumbnails(URL_R1, 48));
    await waitFor(() => expect(result.current).toHaveLength(24));

    expect(fetch).not.toHaveBeenCalled();
    expect(openMock).toHaveBeenCalledWith(URL_R1);
    const sink = CanvasSinkMock.mock.results[0]!.value as {
      canvasesAtTimestamps: ReturnType<typeof vi.fn>;
    };
    const timestamps = sink.canvasesAtTimestamps.mock.calls[0]![0] as number[];
    expect(timestamps).toHaveLength(24);
    expect(timestamps[0]).toBeCloseTo(1); // 0.5/24 * 48
  });

  it("disposes the input when decoding finishes and when there is no video track", async () => {
    const { result } = renderHook(() => useSourceThumbnails(URL_R1, 48));
    await waitFor(() => expect(result.current).toHaveLength(24));
    expect(lastInput().dispose).toHaveBeenCalled();

    stubInput(null);
    renderHook(() => useSourceThumbnails("kaipu-media://recording/r2", 48));
    await waitFor(() => expect(lastInput().dispose).toHaveBeenCalled());
  });

  it("serves a second mount of the same recording from the cache", async () => {
    const first = renderHook(() => useSourceThumbnails(URL_R1, 48));
    await waitFor(() => expect(first.result.current).toHaveLength(24));
    first.unmount();

    const second = renderHook(() => useSourceThumbnails(URL_R1, 48));
    await waitFor(() => expect(second.result.current).toHaveLength(24));
    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it("revokes the object URLs on unmount", async () => {
    const { result, unmount } = renderHook(() => useSourceThumbnails(URL_R1, 48));
    await waitFor(() => expect(result.current).toHaveLength(24));
    unmount();

    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledTimes(
      vi.mocked(URL.createObjectURL).mock.calls.length,
    );
  });

  it("a different duration is a different cache entry", async () => {
    const a = renderHook(() => useSourceThumbnails(URL_R1, 48));
    await waitFor(() => expect(a.result.current).toHaveLength(24));
    const b = renderHook(() => useSourceThumbnails(URL_R1, 49));
    await waitFor(() => expect(b.result.current).toHaveLength(24));

    expect(openMock).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used filmstrip past 16", async () => {
    for (let i = 0; i < 17; i++) {
      const h = renderHook(() => useSourceThumbnails(`kaipu-media://recording/r${i}`, 48));
      await waitFor(() => expect(h.result.current).toHaveLength(24));
      h.unmount();
    }
    const again = renderHook(() => useSourceThumbnails("kaipu-media://recording/r0", 48));
    await waitFor(() => expect(again.result.current).toHaveLength(24));

    expect(openMock).toHaveBeenCalledTimes(18);
  });

  it("keeps 8 recordings with a webcam: their screen and webcam strips both stay", async () => {
    stubInput({ computeDuration: vi.fn(async () => 48) });
    for (let i = 0; i < 8; i++) {
      const screen = renderHook(() => useSourceThumbnails(`kaipu-media://recording/r${i}`, 48));
      await waitFor(() => expect(screen.result.current).toHaveLength(24));
      screen.unmount();
      const cam = renderHook(() => useCompanionThumbnails(`kaipu-media://webcam/r${i}`, 48, 0));
      await waitFor(() => expect(cam.result.current.thumbnails.length).toBeGreaterThan(0));
      cam.unmount();
    }
    const again = renderHook(() => useSourceThumbnails("kaipu-media://recording/r0", 48));
    await waitFor(() => expect(again.result.current).toHaveLength(24));
    const cam = renderHook(() => useCompanionThumbnails("kaipu-media://webcam/r0", 48, 0));
    await waitFor(() => expect(cam.result.current.thumbnails.length).toBeGreaterThan(0));

    expect(openMock).toHaveBeenCalledTimes(16);
  });
});

describe("companionSampleTimes", () => {
  it("maps evenly spaced source times into the companion file's own time", () => {
    // Webcam started 2 s after the screen: source 3 s is webcam 1 s.
    expect(companionSampleTimes(8, 4, 2, Infinity)).toEqual([1, 3, 5]);
  });

  it("drops the source times before the companion's first frame and after its last", () => {
    // Source samples 1, 3, 5, 7 → webcam −1, 1, 3, 5; the webcam is 4 s long.
    expect(companionSampleTimes(8, 4, 2, 4)).toEqual([1, 3]);
  });

  it("keeps every sample when the companion's duration is unknown", () => {
    expect(companionSampleTimes(8, 4, 0, Number.NaN)).toEqual([1, 3, 5, 7]);
  });
});

describe("companionCoveredRange", () => {
  it("runs from the companion's first frame to its last, in SOURCE time", () => {
    expect(companionCoveredRange(2, 30)).toEqual({ start: 2, end: 32 });
    expect(companionCoveredRange(-1, 30)).toEqual({ start: -1, end: 29 });
  });

  it("bounds nothing past the start when the duration is unknown", () => {
    expect(companionCoveredRange(2, Number.NaN)).toEqual({ start: 2, end: Infinity });
  });
});

describe("useCompanionThumbnails (the webcam)", () => {
  const URL_CAM = "kaipu-media://webcam/r1";

  function stubEchoSink() {
    // Echoes the requested timestamps, like a real sink landing on exact frames.
    CanvasSinkMock.mockImplementation(function () {
      return {
        canvasesAtTimestamps: vi.fn((times: number[]) =>
          asyncIterableOf(times.map((timestamp) => ({ canvas: fakeCanvas(), timestamp }))),
        ),
      };
    } as never);
  }

  it("decodes at webcam time and reports each frame at its SOURCE time", async () => {
    stubInput({ computeDuration: vi.fn(async () => 40) });
    stubEchoSink();
    const { result } = renderHook(() => useCompanionThumbnails(URL_CAM, 48, 0.5));
    await waitFor(() => expect(result.current.thumbnails.length).toBeGreaterThan(0));

    const sink = CanvasSinkMock.mock.results[0]!.value as {
      canvasesAtTimestamps: ReturnType<typeof vi.fn>;
    };
    const requested = sink.canvasesAtTimestamps.mock.calls[0]![0] as number[];
    expect(requested[0]).toBeCloseTo(0.5); // source 1 s − 0.5 s
    expect(requested.every((t) => t >= 0 && t < 40)).toBe(true);
    expect(result.current.thumbnails[0]!.sourceTime).toBeCloseTo(1);
    // A 40 s webcam that started 0.5 s after the screen has footage over source 0.5–40.5 s.
    expect(result.current.covered).toEqual({ start: 0.5, end: 40.5 });
  });

  it("serves the covered range from the cache too", async () => {
    stubInput({ computeDuration: vi.fn(async () => 40) });
    stubEchoSink();
    const first = renderHook(() => useCompanionThumbnails(URL_CAM, 48, 2));
    await waitFor(() => expect(first.result.current.covered).not.toBeNull());
    first.unmount();
    const second = renderHook(() => useCompanionThumbnails(URL_CAM, 48, 2));
    await waitFor(() => expect(second.result.current.covered).toEqual({ start: 2, end: 42 }));
    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the screen and webcam caches apart", async () => {
    const screen = renderHook(() => useSourceThumbnails(URL_R1, 48));
    await waitFor(() => expect(screen.result.current).toHaveLength(24));
    stubInput({ computeDuration: vi.fn(async () => 48) });
    const cam = renderHook(() => useCompanionThumbnails(URL_CAM, 48, 0));
    await waitFor(() => expect(cam.result.current.thumbnails.length).toBeGreaterThan(0));

    expect(openMock).toHaveBeenCalledWith(URL_CAM);
    expect(openMock).toHaveBeenCalledTimes(2);
  });

  it("decodes nothing for an empty URL (a recording without a webcam)", async () => {
    const { result } = renderHook(() => useCompanionThumbnails("", 48, 0));
    await Promise.resolve();
    expect(result.current).toEqual({ thumbnails: [], covered: null });
    expect(openMock).not.toHaveBeenCalled();
  });

  it("a different offset is a different cache entry", async () => {
    stubInput({ computeDuration: vi.fn(async () => 48) });
    const a = renderHook(() => useCompanionThumbnails(URL_CAM, 48, 0));
    await waitFor(() => expect(a.result.current.thumbnails.length).toBeGreaterThan(0));
    const b = renderHook(() => useCompanionThumbnails(URL_CAM, 48, 1));
    await waitFor(() => expect(b.result.current.thumbnails.length).toBeGreaterThan(0));

    expect(openMock).toHaveBeenCalledTimes(2);
  });
});
