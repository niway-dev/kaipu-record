import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Translator } from "@kaipu/i18n";
import type { LocalRecording } from "@shared/types/library-storage";
import { initialScene, type VideoScene } from "../scene";
import { WEBCAM_DEFAULTS } from "../webcam/webcam-model";
import type { ExportStartMessage } from "./export-messages";
import { createSlideAssetStore } from "../slide-assets";
import type { VideoEncodingChoice } from "./video-encoding";
import { encodeFingerprint } from "./export-presets";
import {
  __resetExportRunnerForTests,
  cancelVideoExport,
  dismissReadyExport,
  getExportSnapshot,
  isVideoExportBusy,
  retryVideoExport,
  startVideoExport,
  type StartExportArgs,
} from "./export-runner";

// The pipeline itself (plan, session lifecycle, FR8/FR9 retries) is covered through
// `useVideoExport` in use-video-export.test.ts. Here: what makes the runner app-level —
// one export at a time, the job the cards describe, the Ready card, Retry, and telling
// main an export is running.

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@renderer/features/analytics", () => ({ captureException }));

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
});

afterEach(() => {
  captureException.mockClear();
  __resetExportRunnerForTests();
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
    expect(await startVideoExport(args({ presetId: "youtube" }), t)).toBe(false);
    expect(workers).toHaveLength(1);
    expect(getExportSnapshot().job?.presetId).toBe("light");
  });

  it("tells main while an export runs, so closing or quitting asks first", async () => {
    await startVideoExport(args(), t);
    expect(window.electronAPI.setExportActive).toHaveBeenLastCalledWith(true);
    cancelVideoExport();
    expect(window.electronAPI.setExportActive).toHaveBeenLastCalledWith(false);
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

    await startVideoExport(args({ presetId: "youtube" }), t);
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

  describe("the webcam file (ADR 0033)", () => {
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
