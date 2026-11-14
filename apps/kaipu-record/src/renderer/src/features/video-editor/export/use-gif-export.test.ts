import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalRecording } from "@shared/types/library-storage";
import { initialScene, type VideoScene } from "../scene";
import { joinedSource } from "../media-switch.fixture";
import { mediaUrl } from "@renderer/lib/media-url";
import type { ExportJoinedRecording } from "./export-runner";
import { WEBCAM_DEFAULTS } from "../webcam/webcam-model";
import { createSlideAssetStore } from "../slide-assets";
import { ESTIMATE_DEBOUNCE_MS, useGifExport } from "./use-gif-export";
import type { GifStartMessage } from "./gif-messages";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@renderer/features/analytics", () => ({ captureException }));

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
  sourceVideoAssetId: null,
  sourceTimeSeconds: null,
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
    joined: [] as ExportJoinedRecording[],
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
    vi.fn(async () => ({ ok: true, blob: async () => new Blob(["fake-mp4-bytes"]) })),
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
      {
        kind: "clip",
        timelineStart: 0,
        duration: 2,
        sourceStart: 8,
        sourceEnd: 10,
        sourceId: null,
      },
      {
        kind: "clip",
        timelineStart: 2,
        duration: 2,
        sourceStart: 20,
        sourceEnd: 22,
        sourceId: null,
      },
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

  it("sends the webcam file with the offset, like the MP4 export, and fetches it once", async () => {
    const fetch = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      blob: async () => new Blob([url]),
    }));
    vi.stubGlobal("fetch", fetch);
    const scene: VideoScene = {
      ...SCENE,
      webcam: { layout: { ...WEBCAM_DEFAULTS }, segments: [] },
    };
    const { worker } = await startExport(args({ scene, webcamTrack: { startOffsetMs: 80 } }));
    const msg = worker.postMessage.mock.calls[0][0] as GifStartMessage;
    expect(msg.webcam).toEqual({ blob: expect.any(Blob), startOffsetMs: 80 });
    expect(msg.plan.webcam).toEqual(scene.webcam);
    expect(
      fetch.mock.calls.filter(([url]) => url.startsWith("kaipu-media://webcam/")),
    ).toHaveLength(1);
  });

  it("a webcam fetch that throws synchronously exports without the layer and is retried (E11)", async () => {
    // fetch() itself throwing (not a rejected promise) reaches onError before the hook's
    // `track` binding exists; it must still be reported and must not be cached.
    const fetch = vi.fn((url: string) => {
      if (url.startsWith("kaipu-media://webcam/")) throw new TypeError("bad scheme");
      return Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(["x"]) });
    });
    vi.stubGlobal("fetch", fetch);
    const scene: VideoScene = {
      ...SCENE,
      webcam: { layout: { ...WEBCAM_DEFAULTS }, segments: [] },
    };
    const a = args({ scene, webcamTrack: { startOffsetMs: 80 } });
    const { result, worker } = await startExport(a);
    const msg = worker.postMessage.mock.calls[0][0] as GifStartMessage;
    expect(msg.webcam).toBeNull();
    expect(captureException).toHaveBeenCalledWith(expect.any(TypeError), {
      context: "gif-export-webcam",
    });
    act(() => worker.emit({ type: "error", message: "stop" }));
    await act(async () => {
      await result.current.start(a);
    });
    expect(
      fetch.mock.calls.filter(([url]) => url.startsWith("kaipu-media://webcam/")),
    ).toHaveLength(2);
  });

  it("sends no webcam and fetches none for a recording without one", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(["x"]) }));
    vi.stubGlobal("fetch", fetch);
    const { worker } = await startExport(args({ webcamTrack: null }));
    const msg = worker.postMessage.mock.calls[0][0] as GifStartMessage;
    expect(msg.webcam).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("logs a webcam the worker could not decode, and keeps exporting without it", async () => {
    const { result, worker } = await startExport();
    act(() => worker.emit({ type: "webcam-error", message: "decode failed" }));
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      context: "gif-export-webcam",
    });
    expect(result.current.status).toBe("exporting");
  });

  // ADR 0058: clip a is the opened recording (src 0-10); clip b is joined "b" at axis 3600.
  describe("over a joined recording", () => {
    const JOINED_SCENE: VideoScene = {
      ...SCENE,
      items: [
        { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
        { id: "b", kind: "clip", sourceStart: 3600, sourceEnd: 3610 },
      ],
      sources: [joinedSource("b", 3600, 40)],
    };
    const joined = (over: Partial<ExportJoinedRecording> = {}): ExportJoinedRecording[] => [
      {
        sourceId: "b",
        id: "vault-b",
        title: "Second take",
        status: "ready",
        webcam: null,
        ...over,
      },
    ];
    const urls = () => vi.mocked(fetch).mock.calls.map((c) => c[0]);

    it("fetches the opened and the joined recording by their vault ids and sends both", async () => {
      const { worker } = await startExport(args({ scene: JOINED_SCENE, joined: joined() }));
      expect(urls()).toEqual([mediaUrl("recording", "rec-1"), mediaUrl("recording", "vault-b")]);
      const msg = worker.postMessage.mock.calls[0][0] as GifStartMessage;
      expect(msg.sourceBlob).toBeInstanceOf(Blob);
      expect(msg.joined).toEqual([
        { sourceId: "b", offset: 3600, blob: expect.any(Blob), webcam: null },
      ]);
      expect(msg.plan.segments.map((seg) => (seg as { sourceId: string | null }).sourceId)).toEqual(
        [null, "b"],
      );
    });

    it("refuses naming a used recording that is missing: no fetch of it, no worker", async () => {
      const hook = renderHook(() => useGifExport());
      await act(async () => {
        await hook.result.current.start(
          args({ scene: JOINED_SCENE, joined: joined({ status: "missing" }) }),
        );
      });
      expect(hook.result.current.status).toBe("error");
      expect(hook.result.current.error).toContain("Second take");
      expect(createdWorkers).toHaveLength(0);
      expect(urls()).not.toContain(mediaUrl("recording", "vault-b"));
    });

    it("a missing recording no clip of the range uses does not block", async () => {
      const { worker } = await startExport(
        args({
          scene: JOINED_SCENE,
          joined: joined({ status: "missing" }),
          range: { start: 2, end: 6 },
        }),
      );
      const msg = worker.postMessage.mock.calls[0][0] as GifStartMessage;
      expect(msg.joined).toEqual([]);
    });

    it("does not cache a joined fetch that answered 404: the next export fetches it again", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["a"]) } as Response)
        .mockResolvedValueOnce({ ok: false, status: 404, blob: async () => new Blob() } as Response)
        .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["b"]) } as Response);
      const a = args({ scene: JOINED_SCENE, joined: joined() });
      const hook = renderHook(() => useGifExport());
      await act(async () => {
        await hook.result.current.start(a);
      });
      expect(hook.result.current.error).toContain("Second take");
      await act(async () => {
        await hook.result.current.start(a);
      });
      await waitFor(() => expect(createdWorkers).toHaveLength(1));
      expect(urls().filter((u) => u === mediaUrl("recording", "vault-b"))).toHaveLength(2);
      expect(urls().filter((u) => u === mediaUrl("recording", "rec-1"))).toHaveLength(1);
    });

    it("an estimate over a used joined recording that is missing ends in error, without a worker", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { result } = renderHook(() => useGifExport());
      act(() =>
        result.current.requestEstimate(
          args({ scene: JOINED_SCENE, joined: joined({ status: "missing" }) }),
        ),
      );
      expect(result.current.estimate.status).toBe("estimating");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ESTIMATE_DEBOUNCE_MS + 10);
      });
      await waitFor(() => expect(result.current.estimate.status).toBe("error"));
      expect(createdWorkers).toHaveLength(0);
    });

    it("asks again for an estimate refused while a joined recording loaded, once it is ready", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { result } = renderHook(() => useGifExport());
      act(() =>
        result.current.requestEstimate(
          args({ scene: JOINED_SCENE, joined: joined({ status: "loading" }) }),
        ),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ESTIMATE_DEBOUNCE_MS + 10);
      });
      await waitFor(() => expect(result.current.estimate.status).toBe("error"));
      expect(createdWorkers).toHaveLength(0);

      // The recording finishes loading: the parent hands over the new list, nothing else changed.
      act(() => result.current.retryRefusedEstimate(joined({ status: "ready" })));
      expect(result.current.estimate.status).toBe("estimating");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ESTIMATE_DEBOUNCE_MS + 10);
      });
      await waitFor(() => expect(createdWorkers).toHaveLength(1));
      const msg = createdWorkers[0].postMessage.mock.calls[0][0] as GifStartMessage;
      expect(msg.mode).toBe("estimate");
      expect(msg.joined).toHaveLength(1);
      act(() => createdWorkers[0].emit({ type: "estimate", bytes: 1000, frameCount: 5 }));
      expect(result.current.estimate.status).toBe("ready");
    });

    it("asks again when the joined list changed while the refused estimate was still pending", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { result } = renderHook(() => useGifExport());
      act(() =>
        result.current.requestEstimate(
          args({ scene: JOINED_SCENE, joined: joined({ status: "loading" }) }),
        ),
      );
      // The recording finishes loading before the first estimate has even left the debounce:
      // the parent hands over the new list while nothing is refused yet.
      act(() => result.current.retryRefusedEstimate(joined({ status: "ready" })));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ESTIMATE_DEBOUNCE_MS + 10);
      });
      // The first estimate is refused over the old list; it asks again over the new one.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ESTIMATE_DEBOUNCE_MS + 10);
      });
      await waitFor(() => expect(createdWorkers).toHaveLength(1));
      const msg = createdWorkers[0].postMessage.mock.calls[0][0] as GifStartMessage;
      expect(msg.mode).toBe("estimate");
      expect(msg.joined).toHaveLength(1);
      act(() => createdWorkers[0].emit({ type: "estimate", bytes: 1000, frameCount: 5 }));
      expect(result.current.estimate.status).toBe("ready");
    });

    it("does not ask again when the last estimate was not refused or was cancelled", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { result } = renderHook(() => useGifExport());
      // Nothing requested yet.
      const loading = joined({ status: "loading" });
      act(() => result.current.retryRefusedEstimate(loading));
      expect(result.current.estimate.status).toBe("idle");

      // Refused, then the sheet closes (cancelEstimate): a later list change stays quiet.
      act(() => result.current.requestEstimate(args({ scene: JOINED_SCENE, joined: loading })));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ESTIMATE_DEBOUNCE_MS + 10);
      });
      await waitFor(() => expect(result.current.estimate.status).toBe("error"));
      act(() => result.current.cancelEstimate());
      act(() => result.current.retryRefusedEstimate(joined()));
      expect(result.current.estimate.status).toBe("idle");
    });
  });
});
