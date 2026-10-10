import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalRecording } from "@shared/types/library-storage";
import { initialScene, type VideoScene } from "../scene";
import { createSlideAssetStore } from "../slide-assets";
import { ESTIMATE_DEBOUNCE_MS, useGifExport } from "./use-gif-export";
import type { GifStartMessage } from "./gif-messages";

// Like use-video-export.test.ts: jsdom can't run the real worker (WebCodecs, OffscreenCanvas),
// so a fake Worker stands in and the suite covers what the HOOK owns — the start message,
// routing, saving through gifSave, cancel and errors.
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(public url: string | URL) {
    createdWorkers.push(this);
  }
  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}
let createdWorkers: FakeWorker[] = [];

// Timeline: clip a (src 0–10) then, after a cut, clip b (src 20–30).
const SCENE: VideoScene = {
  ...initialScene(1),
  items: [
    { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
    { id: "b", kind: "clip", sourceStart: 20, sourceEnd: 30 },
  ],
  overlays: [],
};

const SAVED: LocalRecording = {
  id: "gif-1",
  assetId: "00000000-0000-0000-0000-0000000000g1",
  kind: "gif",
  title: "My recording (GIF)",
  filePath: "/vault/gif-1.gif",
  createdAt: 1,
  sizeBytes: 1234,
  durationSeconds: 4,
  thumbnailUrl: null,
  derivedFromAssetId: "src-asset",
  contentSha256: null,
  gif: { width: 640, height: 360, fps: 15 },
};

function args(overrides: Record<string, unknown> = {}) {
  return {
    scene: SCENE,
    sourceId: "rec-1",
    title: "My recording",
    derivedFromAssetId: "src-asset",
    videoWidth: 1920,
    videoHeight: 1080,
    previewWidth: 640,
    slideAssets: createSlideAssetStore(),
    cameraPath: null,
    range: { start: 8, end: 12 },
    width: 640,
    fps: 15 as const,
    onSaved: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  createdWorkers = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ blob: async () => new Blob(["fake-mp4-bytes"]) })),
  );
  window.electronAPI.gifSave = vi.fn(async () => SAVED);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function startExport(a = args()) {
  const hook = renderHook(() => useGifExport());
  await act(async () => {
    await hook.result.current.start(a);
  });
  await waitFor(() => expect(createdWorkers).toHaveLength(1));
  return { ...hook, worker: createdWorkers[0], a };
}

describe("useGifExport", () => {
  it("sends the range-sliced plan, the GIF size and fps to the worker", async () => {
    const { worker } = await startExport();
    const msg = worker.postMessage.mock.calls[0][0] as GifStartMessage;
    expect(msg.mode).toBe("export");
    expect(msg.fps).toBe(15);
    expect(msg.source).toEqual({ width: 1920, height: 1080 });
    expect(msg.output).toEqual({ width: 640, height: 360 });
    // 8–12 s spans the cut: 2 s of clip a, then 2 s of clip b.
    expect(msg.plan.totalDuration).toBe(4);
    expect(msg.plan.segments).toEqual([
      { kind: "clip", timelineStart: 0, duration: 2, sourceStart: 8, sourceEnd: 10 },
      { kind: "clip", timelineStart: 2, duration: 2, sourceStart: 20, sourceEnd: 22 },
    ]);
  });

  it("saves the finished GIF through gifSave and reports it", async () => {
    const { result, worker, a } = await startExport();
    const poster = new Uint8Array([1, 2, 3]).buffer;
    const data = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]).buffer;
    act(() => {
      worker.emit({ type: "progress", fraction: 0.5 });
    });
    expect(result.current.fraction).toBe(0.5);
    act(() => {
      worker.emit({ type: "poster", data: poster });
      worker.emit({ type: "done", data, width: 640, height: 360, frameCount: 60 });
    });
    await waitFor(() => expect(a.onSaved).toHaveBeenCalledWith(SAVED));
    expect(window.electronAPI.gifSave).toHaveBeenCalledWith(data, {
      title: "My recording (GIF)",
      durationSeconds: 4,
      width: 640,
      height: 360,
      fps: 15,
      thumbnail: poster,
      derivedFromAssetId: "src-asset",
    });
    expect(result.current.status).toBe("idle");
  });

  it("cancel terminates the worker and never saves", async () => {
    const { result, worker } = await startExport();
    act(() => result.current.cancel());
    expect(worker.terminate).toHaveBeenCalled();
    act(() => {
      worker.emit({ type: "done", data: new ArrayBuffer(8), width: 1, height: 1, frameCount: 1 });
    });
    await Promise.resolve();
    expect(window.electronAPI.gifSave).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("surfaces a worker error with i18n copy and saves nothing", async () => {
    const { result, worker } = await startExport();
    act(() => worker.emit({ type: "error", message: "decode failed" }));
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Couldn't export the GIF.");
    expect(worker.terminate).toHaveBeenCalled();
    expect(window.electronAPI.gifSave).not.toHaveBeenCalled();
  });

  it("explains an over-cap GIF", async () => {
    const { result, worker } = await startExport();
    act(() => worker.emit({ type: "error", message: "big", code: "too-large" }));
    expect(result.current.error).toMatch(/64 MB/);
  });

  it("fails cleanly when the save is refused", async () => {
    window.electronAPI.gifSave = vi.fn(async () => {
      throw new Error("not-gif");
    });
    const { result, worker } = await startExport();
    act(() =>
      worker.emit({ type: "done", data: new ArrayBuffer(8), width: 1, height: 1, frameCount: 1 }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("debounces the estimate and keeps only the latest request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useGifExport());
    act(() => result.current.requestEstimate(args({ fps: 10 })));
    act(() => result.current.requestEstimate(args({ fps: 15 })));
    expect(result.current.estimate.status).toBe("estimating");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESTIMATE_DEBOUNCE_MS + 10);
    });
    await waitFor(() => expect(createdWorkers).toHaveLength(1));
    const worker = createdWorkers[0];
    const msg = worker.postMessage.mock.calls[0][0] as GifStartMessage;
    expect(msg.mode).toBe("estimate");
    expect(msg.fps).toBe(15);
    act(() => worker.emit({ type: "estimate", bytes: 6_200_000, frameCount: 60 }));
    expect(result.current.estimate).toEqual({ status: "ready", bytes: 6_200_000, frameCount: 60 });
  });
});
