import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalRecording } from "@shared/types/library-storage";
import type { VideoScene } from "../scene";
import { createSlideAssetStore } from "../slide-assets";
import { useVideoExport } from "./use-video-export";

// The actual worker-run export (mediabunny decode/encode inside a Web Worker) is
// runtime-deferred — jsdom can neither construct a real Worker nor run WebCodecs.
// This suite exercises everything the HOOK itself owns: plan validation, session
// lifecycle (create/write/finalize/abort), message routing, and cancellation —
// with a fake Worker standing in for the real one.
// The poster is decoded via mediabunny (WebCodecs), which jsdom lacks — mock the
// shared primitive so the hook's plumbing is observable. A non-null buffer here
// proves the fix: the export must forward a real poster to finalize (the old
// `<video>`-seek capture always resolved null, so no thumbnail was ever written).
const { FAKE_THUMB } = vi.hoisted(() => ({ FAKE_THUMB: new Uint8Array([9, 8, 7]).buffer }));
vi.mock("@renderer/lib/generate-thumbnail", () => ({
  generateThumbnail: vi.fn(async () => FAKE_THUMB),
}));

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(
    public url: string | URL,
    public options?: WorkerOptions,
  ) {
    createdWorkers.push(this);
  }
}
let createdWorkers: FakeWorker[] = [];

const CLIP_SCENE: VideoScene = {
  items: [{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 }],
  overlays: [],
};

function startArgs(
  overrides: Partial<Parameters<ReturnType<typeof useVideoExport>["start"]>[0]> = {},
) {
  return {
    scene: CLIP_SCENE,
    sourceId: "rec-1",
    title: "My recording",
    videoWidth: 1280,
    videoHeight: 720,
    previewWidth: 640,
    slideAssets: createSlideAssetStore(),
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
  window.electronAPI.recordingCreate = vi.fn(async () => ({ tempPath: "/tmp/export.mp4.part" }));
  window.electronAPI.recordingWrite = vi.fn();
  window.electronAPI.recordingAbort = vi.fn(async () => {});
  window.electronAPI.recordingFinalize = vi.fn(
    async (): Promise<LocalRecording> => ({
      id: "new-rec",
      kind: "recording",
      title: "My recording (edited)",
      filePath: "/vault/new-rec.mp4",
      createdAt: 1_700_000_000_000,
      sizeBytes: 100,
      durationSeconds: 10,
      thumbnailUrl: null,
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useVideoExport", () => {
  it("refuses to start on an empty timeline, without touching the writer", async () => {
    const { result } = renderHook(() => useVideoExport());

    await act(async () => {
      await result.current.start(startArgs({ scene: { items: [], overlays: [] } }));
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("No hay nada que exportar");
    expect(window.fetch).not.toHaveBeenCalled();
    expect(window.electronAPI.recordingCreate).not.toHaveBeenCalled();
  });

  it("cancel() is a no-op when idle", () => {
    const { result } = renderHook(() => useVideoExport());
    act(() => result.current.cancel());
    expect(result.current.status).toBe("idle");
    expect(window.electronAPI.recordingAbort).not.toHaveBeenCalled();
  });

  it("dismisses the empty-timeline error via cancel()", async () => {
    const { result } = renderHook(() => useVideoExport());
    await act(async () => {
      await result.current.start(startArgs({ scene: { items: [], overlays: [] } }));
    });
    expect(result.current.status).toBe("error");

    act(() => result.current.cancel());
    expect(result.current.status).toBe("idle");
  });

  it("opens a writer session, spawns the worker, and forwards chunk/progress messages", async () => {
    const { result } = renderHook(() => useVideoExport());

    await act(async () => {
      await result.current.start(startArgs());
    });

    expect(window.electronAPI.recordingCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^export-/),
    );
    const sessionId = (window.electronAPI.recordingCreate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(createdWorkers).toHaveLength(1);
    const worker = createdWorkers[0];
    expect(worker.postMessage).toHaveBeenCalledOnce();

    const chunkData = new ArrayBuffer(4);
    act(() =>
      worker.onmessage?.({ data: { type: "chunk", data: chunkData, position: 0 } } as MessageEvent),
    );
    expect(window.electronAPI.recordingWrite).toHaveBeenCalledWith(sessionId, chunkData, 0);

    act(() => worker.onmessage?.({ data: { type: "progress", fraction: 0.5 } } as MessageEvent));
    expect(result.current.status).toBe("exporting");
    expect(result.current.fraction).toBe(0.5);
  });

  it("on a worker error, aborts the writer session and surfaces the generic error", async () => {
    const { result } = renderHook(() => useVideoExport());
    await act(async () => {
      await result.current.start(startArgs());
    });
    const sessionId = (window.electronAPI.recordingCreate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    const worker = createdWorkers[0];

    act(() => worker.onmessage?.({ data: { type: "error", message: "boom" } } as MessageEvent));

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("No pudimos exportar el video.");
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledWith(sessionId);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("cancel() during an active export terminates the worker and aborts the session", async () => {
    const { result } = renderHook(() => useVideoExport());
    await act(async () => {
      await result.current.start(startArgs());
    });
    const sessionId = (window.electronAPI.recordingCreate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    const worker = createdWorkers[0];

    act(() => result.current.cancel());

    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledWith(sessionId);
    expect(result.current.status).toBe("idle");
  });

  it("does not call onSaved when cancel() runs during the done→finalize window", async () => {
    // generateThumbnail is mocked to resolve immediately (see module mock at the
    // top), so by the time `done` fires the thumbnailPromise has already settled —
    // the await inside the done handler's IIFE still yields a microtask, which is the
    // exact window cancel() races against. recordingFinalize is made to hang so we can
    // land cancel() squarely inside that second await too.
    let resolveFinalize!: (recording: LocalRecording) => void;
    window.electronAPI.recordingFinalize = vi.fn(
      () =>
        new Promise<LocalRecording>((resolve) => {
          resolveFinalize = resolve;
        }),
    );
    const onSaved = vi.fn();
    const { result } = renderHook(() => useVideoExport());
    await act(async () => {
      await result.current.start(startArgs({ onSaved }));
    });
    const sessionId = (window.electronAPI.recordingCreate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    const worker = createdWorkers[0];

    act(() => worker.onmessage?.({ data: { type: "done" } } as MessageEvent));
    // Wait for the done handler's IIFE to actually reach recordingFinalize (it awaits
    // thumbnailPromise first) before racing cancel() against it.
    await waitFor(() => expect(window.electronAPI.recordingFinalize).toHaveBeenCalled());
    // Cancel while still awaiting the (still-pending) recordingFinalize call.
    act(() => result.current.cancel());
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledWith(sessionId);

    // Now let the stale finalize resolve — the done handler's post-await guard must
    // bail instead of resurrecting the cancelled export.
    await act(async () => {
      resolveFinalize({
        id: "new-rec",
        kind: "recording",
        title: "My recording (edited)",
        filePath: "/vault/new-rec.mp4",
        createdAt: 1_700_000_000_000,
        sizeBytes: 100,
        durationSeconds: 10,
        thumbnailUrl: null,
      });
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("on done, finalizes with the localized (edited) title + plan duration and calls onSaved", async () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() => useVideoExport());
    await act(async () => {
      await result.current.start(startArgs({ onSaved }));
    });
    const sessionId = (window.electronAPI.recordingCreate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    const worker = createdWorkers[0];

    act(() => worker.onmessage?.({ data: { type: "done" } } as MessageEvent));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());

    expect(window.electronAPI.recordingFinalize).toHaveBeenCalledWith(sessionId, {
      title: "My recording (edited)",
      durationSeconds: 10,
      thumbnail: FAKE_THUMB,
    });
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new-rec", title: "My recording (edited)" }),
    );
    expect(result.current.status).toBe("idle");
  });
});
