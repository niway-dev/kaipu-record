import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Translator } from "@kaipu/i18n";
import type { LocalRecording } from "@shared/types/library-storage";
import { initialScene, type VideoScene } from "../scene";
import { joinedSource } from "../media-switch.fixture";
import { WEBCAM_DEFAULTS } from "../webcam/webcam-model";
import type { ExportStartMessage } from "./export-messages";
import { createSlideAssetStore } from "../slide-assets";
import type { VideoEncodingChoice } from "./video-encoding";
import { encodeFingerprint } from "./export-presets";
import {
  __resetExportRunnerForTests,
  cancelVideoExport,
  dismissReadyExport,
  exportTitle,
  getExportSnapshot,
  isVideoExportBusy,
  retryVideoExport,
  startVideoExport,
  type StartExportArgs,
} from "./export-runner";
import { __resetReadyCopiesForTests, getReadyCopies } from "./ready-copies";

// The pipeline itself (plan, session lifecycle, FR8/FR9 retries) is covered through
// `useVideoExport` in use-video-export.test.ts. Here: what makes the runner app-level —
// one export at a time, the job the cards describe, the Ready card, Retry, and telling
// main an export is running.

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@renderer/features/analytics", () => ({ captureException }));
const { probeSource } = vi.hoisted(() => ({ probeSource: vi.fn() }));
vi.mock("./probe-source", () => ({ probeSource }));

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
}
let workers: FakeWorker[] = [];

const t = ((key: string, values?: Record<string, unknown>) =>
  values?.title !== undefined
    ? `${String(values.title)} (${key})`
    : key) as unknown as Translator<"videoEditor">;

const RECORDING: LocalRecording = {
  id: "new-rec",
  assetId: "asset-new",
  kind: "recording",
  title: "Demo (10 MB)",
  filePath: "/vault/new-rec.mp4",
  createdAt: 1,
  sizeBytes: 8_100_000,
  durationSeconds: 78,
  thumbnailUrl: null,
  derivedFromAssetId: "asset-src",
  sourceVideoAssetId: null,
  sourceTimeSeconds: null,
  contentSha256: null,
};

const SCENE: VideoScene = {
  ...initialScene(78),
  items: [{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 78 }],
  overlays: [],
};

function args(overrides: Partial<StartExportArgs> = {}): StartExportArgs {
  return {
    scene: SCENE,
    sourceId: "rec-1",
    title: "Demo",
    derivedFromAssetId: "asset-src",
    sourceSizeBytes: 119_000_000,
    videoWidth: 2560,
    videoHeight: 1440,
    previewWidth: 2560,
    slideAssets: createSlideAssetStore(),
    cameraPath: null,
    joined: () => [],
    presetId: "light",
    onSaved: vi.fn(),
    ...overrides,
  };
}

const finish = (worker: FakeWorker): void =>
  worker.onmessage?.({ data: { type: "done" } } as MessageEvent);

beforeEach(() => {
  workers = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ blob: async () => new Blob(["mp4"]) })),
  );
  window.electronAPI.recordingCreate = vi.fn(async () => ({ tempPath: "/tmp/x.part" }));
  window.electronAPI.recordingWrite = vi.fn();
  window.electronAPI.recordingAbort = vi.fn(async () => {});
  window.electronAPI.recordingStat = vi.fn(async () => 8_100_000);
  window.electronAPI.recordingFinalize = vi.fn(async () => RECORDING);
  window.electronAPI.setExportActive = vi.fn();
  window.electronAPI.beginExport = vi.fn(async () => {});
});

afterEach(() => {
  captureException.mockClear();
  probeSource.mockReset();
  __resetExportRunnerForTests();
  __resetReadyCopiesForTests();
  vi.unstubAllGlobals();
});

describe("export runner (NIW2-218 background export)", () => {
  it("describes the job for the cards: preset, output size, estimate and the original's size", async () => {
    await startVideoExport(args(), t);
    const { status, job, attemptStartedAt } = getExportSnapshot();
    expect(status).toBe("exporting");
    expect(attemptStartedAt).not.toBeNull();
    expect(job).toMatchObject({
      presetId: "light",
      sourceTitle: "Demo",
      sourceAssetId: "asset-src",
      sourceSizeBytes: 119_000_000,
      width: 1920,
      height: 1080,
    });
    // 78 s of Light: 4.7 MB/min of video + 128 kbps of audio + the moov reservation.
    expect(job!.estimateBytes).toBeGreaterThan(7_400_000);
    expect(job!.estimateBytes).toBeLessThan(7_800_000);
  });

  it("logs an export without hardware H.264 or without quantizer mode, and nothing else", async () => {
    const choice: VideoEncodingChoice = {
      rateControl: "quantizer",
      quantizer: 33,
      bitrate: 1_600_000,
      hardwareAcceleration: "prefer-hardware",
      keyFrameInterval: 10,
      softwareFallback: false,
      quantizerUnsupported: false,
    };
    const send = (c: VideoEncodingChoice): void =>
      workers[0]!.onmessage?.({ data: { type: "encoder", choice: c } } as MessageEvent);
    await startVideoExport(args(), t);
    send(choice);
    expect(captureException).not.toHaveBeenCalled();

    send({ ...choice, rateControl: "bitrate", quantizer: null, quantizerUnsupported: true });
    expect(captureException).toHaveBeenLastCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: "video-export-no-quantizer", presetId: "light" }),
    );

    send({
      ...choice,
      rateControl: "bitrate",
      quantizer: null,
      hardwareAcceleration: "no-preference",
      softwareFallback: true,
      quantizerUnsupported: true,
    });
    expect(captureException).toHaveBeenLastCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: "video-export-software-encoder", width: 1920 }),
    );
    // Logged, not failed: the export keeps going.
    expect(getExportSnapshot().status).toBe("exporting");
  });

  it("runs one export at a time", async () => {
    expect(await startVideoExport(args(), t)).toBe(true);
    expect(isVideoExportBusy()).toBe(true);
    expect(await startVideoExport(args({ presetId: "youtube-1440" }), t)).toBe(false);
    expect(workers).toHaveLength(1);
    expect(getExportSnapshot().job?.presetId).toBe("light");
  });

  it("tells main while an export runs, so closing or quitting asks first", async () => {
    await startVideoExport(args(), t);
    expect(window.electronAPI.setExportActive).toHaveBeenLastCalledWith(true);
    cancelVideoExport();
    expect(window.electronAPI.setExportActive).toHaveBeenLastCalledWith(false);
  });

  it("opens its writer session as an export, not a take", async () => {
    await startVideoExport(args(), t);
    await waitFor(() => expect(workers).toHaveLength(1));
    expect(window.electronAPI.recordingCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^export-/),
      "export",
    );
  });

  it("ends in a Ready card with the saved file, then calls onSaved", async () => {
    const onSaved = vi.fn();
    await startVideoExport(args({ onSaved }), t);
    finish(workers[0]);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(RECORDING));
    const snapshot = getExportSnapshot();
    expect(snapshot.status).toBe("idle");
    expect(snapshot.ready).toMatchObject({ recording: RECORDING, job: { presetId: "light" } });
    expect(isVideoExportBusy()).toBe(false);

    dismissReadyExport();
    expect(getExportSnapshot().ready).toBeNull();
  });

  it("a failing onSaved (e.g. a session save) does not turn the finished export into an error", async () => {
    const onSaved = vi.fn(async () => {
      throw new Error("disk full");
    });
    await startVideoExport(args({ onSaved }), t);
    finish(workers[0]);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await Promise.resolve();
    expect(getExportSnapshot().status).toBe("idle");
    expect(getExportSnapshot().ready).not.toBeNull();
  });

  it("a new export replaces the previous Ready card", async () => {
    await startVideoExport(args(), t);
    finish(workers[0]);
    await waitFor(() => expect(getExportSnapshot().ready).not.toBeNull());

    await startVideoExport(args({ presetId: "youtube-1440" }), t);
    expect(getExportSnapshot().ready).toBeNull();
    finish(workers[1]);
    await waitFor(() => expect(getExportSnapshot().ready).not.toBeNull());
    await startVideoExport(args(), t);
    cancelVideoExport();
    expect(getExportSnapshot().ready).toBeNull();
  });

  it("Retry re-runs the export that failed", async () => {
    await startVideoExport(args(), t);
    workers[0].onmessage?.({ data: { type: "error", message: "boom" } } as MessageEvent);
    expect(getExportSnapshot()).toMatchObject({ status: "error", error: "exportGenericError" });
    // The failed job stays described, for the error card.
    expect(getExportSnapshot().job?.presetId).toBe("light");

    retryVideoExport();
    await waitFor(() => expect(workers).toHaveLength(2));
    expect(getExportSnapshot().status).toBe("exporting");
  });

  it("takes the slides at start, so the editor disposing its store can't break a running export", async () => {
    const store = createSlideAssetStore();
    const entries = vi.spyOn(store, "entries");
    await startVideoExport(args({ slideAssets: store }), t);
    expect(entries).toHaveBeenCalledOnce();
    store.dispose();
    // The FR9 fallback (moov reservation too small) launches again without asking the store.
    workers[0].onmessage?.({
      data: { type: "error", message: "Exceeded maximum packet count" },
    } as MessageEvent);
    await waitFor(() => expect(workers).toHaveLength(2));
    expect(entries).toHaveBeenCalledOnce();
  });

  describe("floating images", () => {
    it("takes the asset of an image used only by a floating item and sends it as media", async () => {
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async () => ({ close: vi.fn() })),
      );
      const store = createSlideAssetStore();
      const asset = (assetId: string) => ({
        assetId,
        bytes: new ArrayBuffer(2),
        mimeType: "image/png",
        url: "",
        naturalWidth: 10,
        naturalHeight: 10,
      });
      vi.spyOn(store, "entries").mockReturnValue([asset("only-media"), asset("unused")]);
      const scene: VideoScene = {
        ...SCENE,
        media: [
          {
            id: "m",
            kind: "image",
            assetId: "only-media",
            naturalWidth: 10,
            naturalHeight: 10,
            anchor: { kind: "source", time: 5 },
            duration: 3,
            box: { x: 0.5, y: 0.5, width: 0.5 },
            z: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
          },
        ],
      };
      await startVideoExport(args({ scene, slideAssets: store }), t);
      await waitFor(() => expect(workers).toHaveLength(1));
      const message = workers[0]!.postMessage.mock.calls[0]![0] as ExportStartMessage;
      const transfer = workers[0]!.postMessage.mock.calls[0]![1] as unknown[];
      expect(message.slides).toEqual([]);
      expect(message.mediaImages?.map((m) => m.assetId)).toEqual(["only-media"]);
      expect(message.plan.floating?.items.map((i) => i.id)).toEqual(["m"]);
      expect(transfer).toContain(message.mediaImages![0].bitmap);
    });
  });

  describe("the webcam file (ADR 0038)", () => {
    const WEBCAM_SCENE: VideoScene = {
      ...SCENE,
      webcam: { layout: { ...WEBCAM_DEFAULTS }, segments: [] },
    };
    const fetchMock = (webcamStatus: number) =>
      vi.fn(async (url: string) =>
        url.startsWith("kaipu-media://webcam/")
          ? { ok: webcamStatus === 200, status: webcamStatus, blob: async () => new Blob(["cam"]) }
          : { ok: true, status: 200, blob: async () => new Blob(["mp4"]) },
      );
    const sent = (): ExportStartMessage =>
      workers[0]!.postMessage.mock.calls[0]![0] as ExportStartMessage;

    it("fetches it like the source and sends it with the offset when the scene has a layer", async () => {
      const fetch = fetchMock(200);
      vi.stubGlobal("fetch", fetch);
      await startVideoExport(args({ scene: WEBCAM_SCENE, webcamTrack: { startOffsetMs: 120 } }), t);
      await waitFor(() => expect(workers).toHaveLength(1));
      expect(fetch).toHaveBeenCalledWith("kaipu-media://webcam/rec-1");
      expect(sent().webcam).toEqual({ blob: expect.any(Blob), startOffsetMs: 120 });
      expect(sent().plan.webcam).toEqual(WEBCAM_SCENE.webcam);
    });

    it("asks for nothing for a recording without a webcam (no request, null in the message)", async () => {
      const fetch = fetchMock(200);
      vi.stubGlobal("fetch", fetch);
      await startVideoExport(args({ webcamTrack: null }), t);
      await waitFor(() => expect(workers).toHaveLength(1));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sent().webcam).toBeNull();
      expect(sent().plan.webcam).toBeNull();
    });

    it("logs a webcam the worker could not decode, and keeps exporting without it", async () => {
      await startVideoExport(args(), t);
      workers[0]!.onmessage?.({
        data: { type: "webcam-error", message: "decode failed" },
      } as MessageEvent);
      expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
        context: "video-export-webcam",
      });
      expect(getExportSnapshot().status).toBe("exporting");
    });

    it("exports without the layer when the file is gone (404), instead of failing", async () => {
      vi.stubGlobal("fetch", fetchMock(404));
      await startVideoExport(args({ scene: WEBCAM_SCENE, webcamTrack: { startOffsetMs: 0 } }), t);
      await waitFor(() => expect(workers).toHaveLength(1));
      expect(sent().webcam).toBeNull();
      expect(getExportSnapshot().status).toBe("exporting");
    });

    describe("an export that lost its face is never offered as the reusable one", () => {
      const WHOLE_WEBCAM = "whole:abc123";
      const EDIT_WEBCAM = "edit:wc1:abc123";
      const stamped = async (): Promise<string | undefined> => {
        finish(workers[0]!);
        await waitFor(() => expect(window.electronAPI.recordingFinalize).toHaveBeenCalled());
        const meta = vi.mocked(window.electronAPI.recordingFinalize).mock.calls[0]![1];
        return meta.exportFingerprint;
      };

      it("Share stamps the plain `whole` when the webcam file is missing", async () => {
        vi.stubGlobal("fetch", fetchMock(404));
        await startVideoExport(
          args({
            scene: WEBCAM_SCENE,
            webcamTrack: { startOffsetMs: 0 },
            fingerprint: WHOLE_WEBCAM,
          }),
          t,
        );
        await waitFor(() => expect(workers).toHaveLength(1));
        expect(await stamped()).toBe(encodeFingerprint("whole", "light"));
      });

      it("an editor export stamps no fingerprint when the webcam file is missing", async () => {
        vi.stubGlobal("fetch", fetchMock(404));
        await startVideoExport(
          args({
            scene: WEBCAM_SCENE,
            webcamTrack: { startOffsetMs: 0 },
            fingerprint: EDIT_WEBCAM,
          }),
          t,
        );
        await waitFor(() => expect(workers).toHaveLength(1));
        expect(await stamped()).toBeUndefined();
      });

      it("the same when the worker could not decode the webcam file", async () => {
        vi.stubGlobal("fetch", fetchMock(200));
        await startVideoExport(
          args({
            scene: WEBCAM_SCENE,
            webcamTrack: { startOffsetMs: 0 },
            fingerprint: EDIT_WEBCAM,
          }),
          t,
        );
        await waitFor(() => expect(workers).toHaveLength(1));
        workers[0]!.onmessage?.({
          data: { type: "webcam-error", message: "decode failed" },
        } as MessageEvent);
        expect(await stamped()).toBeUndefined();
      });

      it("keeps the full fingerprint when the face was composed", async () => {
        vi.stubGlobal("fetch", fetchMock(200));
        await startVideoExport(
          args({
            scene: WEBCAM_SCENE,
            webcamTrack: { startOffsetMs: 0 },
            fingerprint: EDIT_WEBCAM,
          }),
          t,
        );
        await waitFor(() => expect(workers).toHaveLength(1));
        expect(await stamped()).toBe(encodeFingerprint(EDIT_WEBCAM, "light"));
      });
    });

    it("exports without the layer when the webcam fetch throws, instead of failing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.startsWith("kaipu-media://webcam/")) throw new Error("read failed");
          return { ok: true, status: 200, blob: async () => new Blob(["mp4"]) };
        }),
      );
      await startVideoExport(args({ scene: WEBCAM_SCENE, webcamTrack: { startOffsetMs: 0 } }), t);
      await waitFor(() => expect(workers).toHaveLength(1));
      expect(sent().webcam).toBeNull();
      expect(getExportSnapshot().status).toBe("exporting");
    });
  });
});

describe("export runner in the background (NIW2-586)", () => {
  it("carries Prepare's destination on the job; an editor export has none", async () => {
    await startVideoExport(args({ destination: "github" }), t);
    expect(getExportSnapshot().job?.destination).toBe("github");
    cancelVideoExport();
    await startVideoExport(args(), t);
    expect(getExportSnapshot().job).not.toHaveProperty("destination");
  });

  it("notes the finished copy as not seen yet", async () => {
    await startVideoExport(args({ destination: "github" }), t);
    finish(workers[0]!);
    await waitFor(() => expect(getExportSnapshot().ready).not.toBeNull());
    // With what its Library card shows: where it goes and the encoded size.
    const job = getExportSnapshot().job ?? getExportSnapshot().ready!.job;
    expect(getReadyCopies().copies).toEqual([
      {
        assetId: "asset-new",
        announced: false,
        card: true,
        destination: "github",
        width: job.width,
        height: job.height,
      },
    ]);
  });

  it("a cancelled export notes nothing", async () => {
    await startVideoExport(args(), t);
    cancelVideoExport();
    expect(getReadyCopies().copies).toEqual([]);
  });
});

describe("exportTitle", () => {
  it("titles both YouTube canvases \"(YouTube)\": the resolution is the file's, not the destination's", () => {
    expect(exportTitle(t, "youtube-1440", "Demo")).toBe("Demo (presetTitleYoutube)");
    expect(exportTitle(t, "youtube-4k", "Demo")).toBe("Demo (presetTitleYoutube)");
    expect(exportTitle(t, "vertical", "Demo")).toBe("Demo (presetTitleVertical)");
  });
});

describe("an export that uses joined recordings (NIW2-781)", () => {
  // Opened [0, 100]; joined B at [3600, 3640] and C at [7200, 7220]; the sequence goes a -> B.
  const WEBCAM = { layout: { ...WEBCAM_DEFAULTS }, segments: [] };
  const JOINED_SCENE: VideoScene = {
    ...initialScene(100),
    sources: [joinedSource("b", 3600, 40), joinedSource("c", 7200, 20)],
    items: [
      { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
      { id: "b", kind: "clip", sourceStart: 3600, sourceEnd: 3610 },
    ],
    overlays: [],
  };
  const entry = (
    sourceId: string,
    overrides: Partial<ReturnType<StartExportArgs["joined"]>[number]> = {},
  ): ReturnType<StartExportArgs["joined"]>[number] => ({
    sourceId,
    id: `vault-${sourceId}`,
    title: `Title ${sourceId}`,
    status: "ready",
    webcam: null,
    ...overrides,
  });
  const fetchMock = (notOk: string[] = []) =>
    vi.fn(async (url: string) => ({
      ok: !notOk.some((id) => url.includes(id)),
      status: notOk.some((id) => url.includes(id)) ? 404 : 200,
      blob: async () => new Blob([url]),
    }));
  const sent = (): ExportStartMessage =>
    workers[0]!.postMessage.mock.calls[0]![0] as ExportStartMessage;

  it("refuses by name when a used joined recording is missing, taking nothing", async () => {
    const beginExport = vi.fn(async () => {});
    window.electronAPI.beginExport = beginExport;
    await startVideoExport(
      args({ scene: JOINED_SCENE, joined: () => [entry("b", { status: "missing", id: "" })] }),
      t,
    );
    expect(getExportSnapshot().status).toBe("error");
    expect(getExportSnapshot().error).toBe("Title b (exportRecordingMissing)");
    // The export card renders only for a job: without one the refusal is never seen.
    expect(getExportSnapshot().job).toMatchObject({ sourceTitle: expect.any(String) });
    expect(beginExport).not.toHaveBeenCalled();
    expect(window.electronAPI.setExportActive).not.toHaveBeenCalledWith(true);
    expect(window.electronAPI.recordingCreate).not.toHaveBeenCalled();
    expect(workers).toHaveLength(0);
  });

  it("names the scene's title when a used joined recording has no entry at all", async () => {
    await startVideoExport(args({ scene: JOINED_SCENE, joined: () => [] }), t);
    expect(getExportSnapshot().error).toBe("b (exportRecordingMissing)");
    expect(workers).toHaveLength(0);
  });

  it("refuses with the loading message while a used joined recording loads, taking nothing", async () => {
    const beginExport = vi.fn(async () => {});
    window.electronAPI.beginExport = beginExport;
    await startVideoExport(
      args({ scene: JOINED_SCENE, joined: () => [entry("b", { status: "loading", id: "" })] }),
      t,
    );
    expect(getExportSnapshot().error).toBe("exportRecordingLoading");
    expect(getExportSnapshot().job).not.toBeNull();
    expect(beginExport).not.toHaveBeenCalled();
    expect(window.electronAPI.recordingCreate).not.toHaveBeenCalled();
    expect(workers).toHaveLength(0);
  });

  it("is not blocked by a missing joined recording that no clip uses", async () => {
    vi.stubGlobal("fetch", fetchMock());
    await startVideoExport(
      args({
        scene: JOINED_SCENE,
        joined: () => [entry("b"), entry("c", { status: "missing", id: "" })],
      }),
      t,
    );
    await waitFor(() => expect(workers).toHaveLength(1));
    expect(getExportSnapshot().status).toBe("exporting");
  });

  it("fails by name and lets go of everything when a used joined file answers 404", async () => {
    vi.stubGlobal("fetch", fetchMock(["vault-b"]));
    await startVideoExport(args({ scene: JOINED_SCENE, joined: () => [entry("b")] }), t);
    expect(getExportSnapshot().status).toBe("error");
    expect(getExportSnapshot().error).toBe("Title b (exportRecordingMissing)");
    expect(window.electronAPI.recordingCreate).not.toHaveBeenCalled();
    expect(workers).toHaveLength(0);
    expect(isVideoExportBusy()).toBe(false);
    // The lease is main's `exportActive` mirror: the last report is "not exporting".
    expect(vi.mocked(window.electronAPI.setExportActive).mock.calls.at(-1)).toEqual([false]);
  });

  it("sends each used joined recording with its source id, offset, file and webcam", async () => {
    const fetch = fetchMock();
    vi.stubGlobal("fetch", fetch);
    const scene: VideoScene = {
      ...JOINED_SCENE,
      webcam: WEBCAM,
      items: [...JOINED_SCENE.items, { id: "c", kind: "clip", sourceStart: 7200, sourceEnd: 7210 }],
    };
    await startVideoExport(
      args({
        scene,
        webcamTrack: null,
        joined: () => [entry("b", { webcam: { startOffsetMs: 250 } }), entry("c")],
      }),
      t,
    );
    await waitFor(() => expect(workers).toHaveLength(1));
    expect(fetch).toHaveBeenCalledWith("kaipu-media://recording/vault-b");
    expect(fetch).toHaveBeenCalledWith("kaipu-media://webcam/vault-b");
    expect(fetch).not.toHaveBeenCalledWith("kaipu-media://webcam/vault-c");
    expect(sent().joined).toEqual([
      {
        sourceId: "b",
        offset: 3600,
        blob: expect.any(Blob),
        webcam: { blob: expect.any(Blob), startOffsetMs: 250 },
      },
      { sourceId: "c", offset: 7200, blob: expect.any(Blob), webcam: null },
    ]);
  });

  it("exports a joined recording whose webcam fails to load, without that webcam only", async () => {
    vi.stubGlobal("fetch", fetchMock(["webcam/vault-b"]));
    await startVideoExport(
      args({
        scene: { ...JOINED_SCENE, webcam: WEBCAM },
        joined: () => [entry("b", { webcam: { startOffsetMs: 5 } })],
      }),
      t,
    );
    await waitFor(() => expect(workers).toHaveLength(1));
    expect(sent().joined.map((j) => j.webcam)).toEqual([null]);
  });

  it("sends an empty joined list and makes the same fetches for a scene without joined recordings", async () => {
    const fetch = fetchMock();
    vi.stubGlobal("fetch", fetch);
    await startVideoExport(args({ joined: () => [] }), t);
    await waitFor(() => expect(workers).toHaveLength(1));
    expect(sent().joined).toEqual([]);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(["kaipu-media://recording/rec-1"]);
  });

  describe("a plan that cannot be built", () => {
    it("says the timeline is empty, and reports nothing, for an empty timeline", async () => {
      await startVideoExport(args({ scene: { ...initialScene(1), items: [], overlays: [] } }), t);
      expect(getExportSnapshot()).toMatchObject({
        status: "error",
        error: "exportEmptyTimeline",
      });
      expect(captureException).not.toHaveBeenCalled();
      expect(workers).toHaveLength(0);
    });

    it("reports a broken scene and shows the generic error, not the empty-timeline one", async () => {
      // A clip that starts in the opened recording and ends inside B's range.
      const broken: VideoScene = {
        ...JOINED_SCENE,
        items: [{ id: "x", kind: "clip", sourceStart: 90, sourceEnd: 3610 }],
      };
      await startVideoExport(args({ scene: broken, joined: () => [entry("b")] }), t);
      expect(getExportSnapshot()).toMatchObject({
        status: "error",
        error: "exportGenericError",
      });
      expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
        context: "video-export",
      });
      expect(workers).toHaveLength(0);
    });
  });

  it("Retry re-runs the call that ran, not a second call that was turned away", async () => {
    vi.stubGlobal("fetch", fetchMock());
    const resolvers: Array<(value: null) => void> = [];
    probeSource.mockImplementation(() => new Promise<null>((resolve) => resolvers.push(resolve)));
    const first = startVideoExport(
      args({ scene: JOINED_SCENE, joined: () => [entry("b")], title: "First call" }),
      t,
    );
    const second = startVideoExport(
      args({ scene: JOINED_SCENE, joined: () => [entry("b")], title: "Second call" }),
      t,
    );
    // The first call's probe lands first: it runs, the second is turned away after its own.
    resolvers[0]!(null);
    await waitFor(() => expect(workers).toHaveLength(1));
    resolvers[1]!(null);
    expect(await first).toBe(true);
    expect(await second).toBe(false);

    workers[0]!.onmessage?.({ data: { type: "error", message: "boom" } } as MessageEvent);
    probeSource.mockResolvedValue(null);
    retryVideoExport();
    await waitFor(() => expect(workers).toHaveLength(2));
    expect(getExportSnapshot().job?.sourceTitle).toBe("First call");
  });

  it("Retry reads the joined recordings as they are now, not as they were when the export was refused", async () => {
    vi.stubGlobal("fetch", fetchMock());
    let current = [entry("b", { status: "loading", id: null })];
    await startVideoExport(args({ scene: JOINED_SCENE, joined: () => current }), t);
    expect(getExportSnapshot().error).toBe("exportRecordingLoading");
    expect(workers).toHaveLength(0);

    // The recording finished loading: the editor now holds a different object for it.
    current = [entry("b")];
    retryVideoExport();
    await waitFor(() => expect(workers).toHaveLength(1));
    expect(getExportSnapshot()).toMatchObject({ status: "exporting", error: null });
    expect(sent().joined.map((j) => j.sourceId)).toEqual(["b"]);
  });

  describe("a cancelled export that is still waiting while a new one runs", () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const ok = (url: string) => ({ ok: true, status: 200, blob: async () => new Blob([url]) });

    it("its late 404 on a joined file leaves the new export running", async () => {
      let answerA!: (response: unknown) => void;
      const held = new Promise((resolve) => (answerA = resolve));
      const fetch = vi.fn(async (url: string) => (url.includes("vault-b") ? held : ok(url)));
      vi.stubGlobal("fetch", fetch);
      void startVideoExport(
        args({ scene: JOINED_SCENE, joined: () => [entry("b")], title: "Export A" }),
        t,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledWith("kaipu-media://recording/vault-b"));
      cancelVideoExport();
      await startVideoExport(args({ title: "Export B" }), t);
      await waitFor(() => expect(workers).toHaveLength(1));
      const sessionB = vi.mocked(window.electronAPI.recordingCreate).mock.calls[0]![0];

      answerA({ ok: false, status: 404, blob: async () => new Blob([]) });
      await flush();

      expect(getExportSnapshot()).toMatchObject({ status: "exporting", error: null });
      expect(getExportSnapshot().job?.sourceTitle).toBe("Export B");
      expect(isVideoExportBusy()).toBe(true);
      expect(workers[0]!.terminate).not.toHaveBeenCalled();
      expect(window.electronAPI.recordingAbort).not.toHaveBeenCalledWith(sessionB);
      expect(vi.mocked(window.electronAPI.setExportActive).mock.calls.at(-1)).toEqual([true]);
    });

    it("its late writer session never replaces the new export's worker or session", async () => {
      let sessionA!: () => void;
      window.electronAPI.recordingCreate = vi
        .fn()
        .mockImplementationOnce(() => new Promise<void>((resolve) => (sessionA = resolve)))
        .mockResolvedValue({ tempPath: "/tmp/b.part" });
      void startVideoExport(args({ title: "Export A" }), t);
      await waitFor(() => expect(window.electronAPI.recordingCreate).toHaveBeenCalledTimes(1));
      const idA = vi.mocked(window.electronAPI.recordingCreate).mock.calls[0]![0];
      cancelVideoExport();
      await startVideoExport(args({ title: "Export B" }), t);
      await waitFor(() => expect(workers).toHaveLength(1));
      const idB = vi.mocked(window.electronAPI.recordingCreate).mock.calls[1]![0];

      sessionA();
      await flush();

      expect(workers).toHaveLength(1);
      expect(workers[0]!.terminate).not.toHaveBeenCalled();
      expect(window.electronAPI.recordingAbort).toHaveBeenCalledWith(idA);
      expect(window.electronAPI.recordingAbort).not.toHaveBeenCalledWith(idB);
      // B is still the export that finishes: its worker's messages reach its own session.
      workers[0]!.onmessage?.({
        data: { type: "chunk", data: new ArrayBuffer(1), position: 0 },
      } as MessageEvent);
      expect(window.electronAPI.recordingWrite).toHaveBeenCalledWith(idB, expect.anything(), 0);
    });

    it("its lease wait ending later does not read any file for it", async () => {
      let leaseA!: () => void;
      window.electronAPI.beginExport = vi
        .fn()
        .mockImplementationOnce(() => new Promise<void>((resolve) => (leaseA = resolve)))
        .mockResolvedValue(undefined);
      const fetch = vi.fn(async (url: string) => ok(url));
      vi.stubGlobal("fetch", fetch);
      void startVideoExport(args({ title: "Export A", sourceId: "rec-a" }), t);
      await waitFor(() => expect(window.electronAPI.beginExport).toHaveBeenCalledTimes(1));
      cancelVideoExport();
      await startVideoExport(args({ title: "Export B", sourceId: "rec-b" }), t);
      await waitFor(() => expect(workers).toHaveLength(1));

      leaseA();
      await flush();

      expect(fetch.mock.calls.map((c) => c[0])).toEqual(["kaipu-media://recording/rec-b"]);
      expect(workers).toHaveLength(1);
      expect(getExportSnapshot().status).toBe("exporting");
    });
  });

  describe("audio of the joined recordings", () => {
    const probe = (hasAudio: boolean) => ({
      width: 1920,
      height: 1080,
      durationSec: 40,
      fps: 30,
      hasAudio,
      sampleRate: 44100,
    });
    const start = async (over: Partial<StartExportArgs>) => {
      vi.stubGlobal("fetch", fetchMock());
      await startVideoExport(
        args({ scene: JOINED_SCENE, joined: () => [entry("b")], presetId: "balanced", ...over }),
        t,
      );
      await waitFor(() => expect(workers).toHaveLength(1));
    };

    it("sizes the export with audio when only the joined recording has it", async () => {
      probeSource.mockResolvedValue(probe(true));
      await start({ sourceInfo: { fps: 30, hasAudio: false } });
      expect(probeSource).toHaveBeenCalledWith("vault-b");
      expect(sent().target.packetCounts.audio).toBeGreaterThan(0);
    });

    it("sizes it without audio when neither used recording has it", async () => {
      probeSource.mockResolvedValue(probe(false));
      await start({ sourceInfo: { fps: 30, hasAudio: false } });
      expect(sent().target.packetCounts.audio).toBe(0);
    });

    it("counts a joined recording that cannot be probed as without audio", async () => {
      probeSource.mockResolvedValue(null);
      await start({ sourceInfo: { fps: 30, hasAudio: false } });
      expect(sent().target.packetCounts.audio).toBe(0);
    });

    it("sizes it without audio when the scene is muted", async () => {
      probeSource.mockResolvedValue(probe(true));
      await start({
        scene: { ...JOINED_SCENE, audioMuted: true } as VideoScene,
        sourceInfo: { fps: 30, hasAudio: true },
      });
      expect(sent().target.packetCounts.audio).toBe(0);
    });

    it("probes nothing for a scene without joined recordings", async () => {
      vi.stubGlobal("fetch", fetchMock());
      await startVideoExport(args({ joined: () => [] }), t);
      await waitFor(() => expect(workers).toHaveLength(1));
      expect(probeSource).not.toHaveBeenCalled();
    });
  });
});
