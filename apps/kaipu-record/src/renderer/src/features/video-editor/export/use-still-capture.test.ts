import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene, type TrackItem, type VideoScene } from "../scene";
import { joinedSource } from "../media-switch.fixture";
import { mediaUrl } from "@renderer/lib/media-url";
import type { ExportJoinedRecording } from "./export-runner";
import { createSlideAssetStore } from "../slide-assets";
import { WEBCAM_DEFAULTS } from "../webcam/webcam-model";
import type { GifStartMessage } from "./gif-messages";
import { buildStillMessage, type StillCaptureArgs, useStillCapture } from "./use-still-capture";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@renderer/features/analytics", () => ({ captureException }));
// Rasterizing draws an SVG through an <img>, which jsdom never loads; the rasterizer has its
// own tests (overlay-raster.test.ts). Here it returns one bitmap per overlay.
vi.mock("./overlay-raster", () => ({
  rasterizeOverlays: vi.fn(async (overlays: Array<{ id: string }>) =>
    overlays.map((o) => ({ overlayId: o.id, bitmap: { close: vi.fn() } })),
  ),
}));

// jsdom can't run the real worker (WebCodecs, OffscreenCanvas): a fake Worker stands in, and
// the suite covers what the HOOK owns, the start message and the routing of the answer.
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    createdWorkers.push(this);
  }
  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}
let createdWorkers: FakeWorker[] = [];

const clip = (id: string, sourceStart: number, sourceEnd: number): TrackItem => ({
  id,
  kind: "clip",
  sourceStart,
  sourceEnd,
});

// Timeline: clip a (src 0-10) 0-10, then clip b (src 20-30) 10-20.
const SCENE: VideoScene = {
  ...initialScene(1),
  items: [clip("a", 0, 10), clip("b", 20, 30)],
  overlays: [],
  redactions: [
    {
      id: "r1",
      kind: "blur",
      start: 2,
      end: 4,
      rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
      intensity: 60,
      style: "gaussian",
    },
  ],
};

function args(overrides: Partial<StillCaptureArgs> = {}): StillCaptureArgs {
  return {
    scene: SCENE,
    sourceId: "rec-1",
    videoWidth: 2560,
    videoHeight: 1440,
    previewWidth: 640,
    slideAssets: createSlideAssetStore(),
    cameraPath: null,
    joined: [],
    playhead: 12,
    ...overrides,
  };
}

beforeEach(() => {
  createdWorkers = [];
  captureException.mockClear();
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, blob: async () => new Blob(["bytes"]) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildStillMessage", () => {
  it("asks for one frame at the playhead, at the source size, over the whole plan", async () => {
    const { message, still } = await buildStillMessage(args(), new Blob(["x"]), null);
    expect(message.mode).toBe("still");
    expect(message.stillTime).toBe(12);
    expect(message.source).toEqual({ width: 2560, height: 1440 });
    // No GIF downscale: the output is the source.
    expect(message.output).toEqual({ width: 2560, height: 1440 });
    // Not sliced to a range: the timeline is intact and redactions pass through.
    expect(message.plan.totalDuration).toBe(20);
    expect(message.plan.redactions.map((r) => r.id)).toEqual(["r1"]);
    // Playhead 12 is 2 s into clip b (source 20-30).
    expect(still.sourceSeconds).toBe(22);
  });

  it("passes overlay windows and the rasterized overlays through", async () => {
    const scene: VideoScene = {
      ...SCENE,
      overlays: [
        {
          id: "o1",
          kind: "text",
          x: 0.1,
          y: 0.1,
          text: "hi",
          size: 19,
          color: "#000",
          start: 11,
          end: 14,
        },
      ],
    };
    const { message } = await buildStillMessage(args({ scene }), new Blob(["x"]), null);
    expect(message.plan.overlayWindows).toEqual([{ overlayId: "o1", start: 11, end: 14 }]);
    expect(message.overlays.map((o) => o.overlayId)).toEqual(["o1"]);
  });

  it("sends the webcam file only when the plan has a webcam layer", async () => {
    const track = { blob: new Blob(["cam"]), startOffsetMs: 0 };
    const without = await buildStillMessage(args(), new Blob(["x"]), track);
    expect(without.message.webcam).toBeNull();
    const scene: VideoScene = { ...SCENE, webcam: { layout: WEBCAM_DEFAULTS, segments: [] } };
    const withCam = await buildStillMessage(args({ scene }), new Blob(["x"]), track);
    expect(withCam.message.webcam).toBe(track);
  });

  it("sends the camera path as copies, so the preview's buffers stay attached", async () => {
    const scene: VideoScene = {
      ...SCENE,
      zoomSegments: [{ id: "z", start: 1, end: 3, scale: 2, cx: 0.5, cy: 0.5 }] as never,
    };
    const cameraPath = {
      fps: 30,
      cx: new Float32Array([0.5]),
      cy: new Float32Array([0.5]),
      scale: new Float32Array([2]),
    } as never as StillCaptureArgs["cameraPath"];
    const { message } = await buildStillMessage(args({ scene, cameraPath }), new Blob(["x"]), null);
    expect(message.camera?.scale).toEqual(new Float32Array([2]));
    expect(message.camera?.scale).not.toBe((cameraPath as { scale: Float32Array }).scale);
  });
});

describe("useStillCapture", () => {
  it("resolves with the PNG, its size and both times, and is busy meanwhile", async () => {
    const { result } = renderHook(() => useStillCapture());
    let promise!: ReturnType<typeof result.current.capture>;
    act(() => {
      promise = result.current.capture(args());
    });
    await waitFor(() => expect(createdWorkers).toHaveLength(1));
    expect(result.current.busy).toBe(true);
    const png = new Uint8Array([0x89, 0x50]).buffer;
    act(() => createdWorkers[0].emit({ type: "still", data: png, width: 2560, height: 1440 }));
    await expect(promise).resolves.toEqual({
      png,
      width: 2560,
      height: 1440,
      timelineSeconds: 12,
      sourceSeconds: 22,
    });
    expect(createdWorkers[0].terminate).toHaveBeenCalled();
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("rejects when the worker reports an error, and can capture again", async () => {
    const { result } = renderHook(() => useStillCapture());
    let promise!: ReturnType<typeof result.current.capture>;
    act(() => {
      promise = result.current.capture(args());
    });
    await waitFor(() => expect(createdWorkers).toHaveLength(1));
    const rejected = expect(promise).rejects.toThrow("no decodable frame");
    act(() => createdWorkers[0].emit({ type: "error", message: "no decodable frame" }));
    await rejected;
    expect(captureException).toHaveBeenCalled();
    await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => {
      void result.current.capture(args()).catch(() => {});
    });
    await waitFor(() => expect(createdWorkers).toHaveLength(2));
  });

  it("refuses a second capture while one runs", async () => {
    const { result } = renderHook(() => useStillCapture());
    act(() => {
      void result.current.capture(args()).catch(() => {});
    });
    await waitFor(() => expect(createdWorkers).toHaveLength(1));
    await expect(result.current.capture(args())).rejects.toThrow("already running");
  });

  it("fetches the source once for repeated captures of the same recording", async () => {
    const { result } = renderHook(() => useStillCapture());
    for (let n = 1; n <= 2; n++) {
      let promise!: ReturnType<typeof result.current.capture>;
      act(() => {
        promise = result.current.capture(args());
      });
      await waitFor(() => expect(createdWorkers).toHaveLength(n));
      act(() =>
        createdWorkers[n - 1].emit({
          type: "still",
          data: new ArrayBuffer(1),
          width: 1,
          height: 1,
        }),
      );
      await promise;
    }
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("does not cache a source fetch that answered with an error: the next capture fetches again", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        blob: async () => new Blob(["nope"]),
      } as Response)
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["bytes"]) } as Response);
    const { result } = renderHook(() => useStillCapture());
    await expect(result.current.capture(args())).rejects.toThrow("source fetch failed (404)");
    // No worker was started for an error page.
    expect(createdWorkers).toHaveLength(0);
    await waitFor(() => expect(result.current.busy).toBe(false));
    let promise!: ReturnType<typeof result.current.capture>;
    act(() => {
      promise = result.current.capture(args());
    });
    await waitFor(() => expect(createdWorkers).toHaveLength(1));
    act(() =>
      createdWorkers[0].emit({ type: "still", data: new ArrayBuffer(1), width: 1, height: 1 }),
    );
    await promise;
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("terminates a running worker on unmount", async () => {
    const { result, unmount } = renderHook(() => useStillCapture());
    act(() => {
      void result.current.capture(args()).catch(() => {});
    });
    await waitFor(() => expect(createdWorkers).toHaveLength(1));
    unmount();
    expect(createdWorkers[0].terminate).toHaveBeenCalled();
  });
});

// ADR 0058: the opened recording is [0, 100] on the axis; "b" is joined at 3600 with a clip
// 3600-3610. The timeline is clip a (src 0-10), then clip b (axis 3600-3610): playhead 15 is
// 5 s into b's own file.
describe("useStillCapture over a joined recording", () => {
  const JOINED_SCENE: VideoScene = {
    ...SCENE,
    items: [clip("a", 0, 10), clip("b", 3600, 3610)],
    redactions: [],
    sources: [joinedSource("b", 3600, 40)],
  };
  const joined = (over: Partial<ExportJoinedRecording> = {}): ExportJoinedRecording[] => [
    { sourceId: "b", id: "vault-b", title: "Second take", status: "ready", webcam: null, ...over },
  ];
  const finish = async (n: number, promise: Promise<unknown>) => {
    await waitFor(() => expect(createdWorkers).toHaveLength(n));
    act(() =>
      createdWorkers[n - 1].emit({ type: "still", data: new ArrayBuffer(1), width: 1, height: 1 }),
    );
    await promise;
  };
  const fetched = () => vi.mocked(fetch).mock.calls.map((c) => c[0]);

  it("fetches each recording by its current vault id, the one under the playhead only", async () => {
    const { result } = renderHook(() => useStillCapture());
    let promise!: ReturnType<typeof result.current.capture>;
    act(() => {
      promise = result.current.capture(
        args({ scene: JOINED_SCENE, joined: joined(), playhead: 15 }),
      );
    });
    await finish(1, promise);
    expect(fetched()).toEqual([mediaUrl("recording", "vault-b")]);
    const msg = createdWorkers[0].postMessage.mock.calls[0][0] as GifStartMessage;
    // The opened recording's file is not sent when no frame reads it.
    expect(msg.sourceBlob).toBeNull();
    expect(msg.joined).toEqual([
      { sourceId: "b", offset: 3600, blob: expect.any(Blob), webcam: null },
    ]);
    act(() => {
      promise = result.current.capture(
        args({ scene: JOINED_SCENE, joined: joined(), playhead: 5 }),
      );
    });
    await finish(2, promise);
    expect(fetched()).toEqual([mediaUrl("recording", "vault-b"), mediaUrl("recording", "rec-1")]);
    const opened = createdWorkers[1].postMessage.mock.calls[0][0] as GifStartMessage;
    expect(opened.sourceBlob).toBeInstanceOf(Blob);
    expect(opened.joined).toEqual([]);
  });

  it("refuses naming the recording when the one under the playhead is missing, before any fetch", async () => {
    const { result } = renderHook(() => useStillCapture());
    await expect(
      result.current.capture(
        args({ scene: JOINED_SCENE, joined: joined({ status: "missing" }), playhead: 15 }),
      ),
    ).rejects.toThrow("Second take");
    expect(fetch).not.toHaveBeenCalled();
    expect(createdWorkers).toHaveLength(0);
  });

  it("refuses while the recording under the playhead is still loading", async () => {
    const { result } = renderHook(() => useStillCapture());
    await expect(
      result.current.capture(
        args({
          scene: JOINED_SCENE,
          joined: joined({ status: "loading", id: null }),
          playhead: 15,
        }),
      ),
    ).rejects.toThrow(/still loading/);
    expect(createdWorkers).toHaveLength(0);
  });

  it("does not cache a joined fetch that answered 404, and names the recording", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404, blob: async () => new Blob() } as Response)
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["b"]) } as Response);
    const { result } = renderHook(() => useStillCapture());
    const a = args({ scene: JOINED_SCENE, joined: joined(), playhead: 15 });
    await expect(result.current.capture(a)).rejects.toThrow("Second take");
    await waitFor(() => expect(result.current.busy).toBe(false));
    let promise!: ReturnType<typeof result.current.capture>;
    act(() => {
      promise = result.current.capture(a);
    });
    await finish(1, promise);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
