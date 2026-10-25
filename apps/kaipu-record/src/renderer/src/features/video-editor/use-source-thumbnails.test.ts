import { renderHook, waitFor } from "@testing-library/react";
import { CanvasSink } from "mediabunny";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openRecordingInput } from "@renderer/lib/open-recording-input";
import { __resetSourceThumbnailCacheForTests, useSourceThumbnails } from "./use-source-thumbnails";

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

  it("evicts the least recently used recording past 8", async () => {
    for (let i = 0; i < 9; i++) {
      const h = renderHook(() => useSourceThumbnails(`kaipu-media://recording/r${i}`, 48));
      await waitFor(() => expect(h.result.current).toHaveLength(24));
      h.unmount();
    }
    const again = renderHook(() => useSourceThumbnails("kaipu-media://recording/r0", 48));
    await waitFor(() => expect(again.result.current).toHaveLength(24));

    expect(openMock).toHaveBeenCalledTimes(10);
  });
});
