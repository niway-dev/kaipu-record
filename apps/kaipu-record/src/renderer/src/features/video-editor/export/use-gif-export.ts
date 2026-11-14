import type { CursorLayerData } from "../cursor/cursor-model";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { LocalRecording } from "@shared/types/library-storage";
import { captureException } from "@renderer/features/analytics";
import type { SlideAssetStore } from "../slide-assets";
import type { VideoScene } from "../scene";
import type { CameraPath } from "../zoom/camera-path";
import { buildExportPlan, gifOutputSize, sliceExportPlan, type ExportPlan } from "./export-plan";
import type { GifFps, GifStartMessage, GifWorkerMessage } from "./gif-messages";
import { prepareWorkerInputs } from "./job-inputs";
import type { WebcamTrackMessage } from "./export-messages";
import { type ExportWebcamTrack, fetchWebcamTrack } from "./webcam-fetch";
import type { ExportJoinedRecording } from "./export-runner";
import {
  createRecordingCache,
  fetchJoinedFiles,
  JoinedRecordingUnreadable,
  usedJoinedRecordings,
} from "./joined-files";

export interface GifJobArgs {
  scene: VideoScene;
  sourceId: string;
  /** Native size of the source video (the MP4 export's output size). */
  videoWidth: number;
  videoHeight: number;
  /** Displayed px of the preview video box — overlay strokes scale true-to-preview. */
  previewWidth: number;
  slideAssets: SlideAssetStore;
  cameraPath: CameraPath | null;
  cursor?: CursorLayerData | null;
  /** The recording's webcam track, when it has one (ADR 0038), as for the MP4 export. */
  webcamTrack?: ExportWebcamTrack | null;
  /** The scene's joined recordings (ADR 0058), as for the MP4 export; `[]` without joins. */
  joined: ExportJoinedRecording[];
  /** Range in edited-timeline seconds. */
  range: { start: number; end: number };
  /** Requested GIF width (capped at the source width). */
  width: number;
  fps: GifFps;
}

export interface StartGifExportArgs extends GifJobArgs {
  title: string;
  derivedFromAssetId: string | null;
  onSaved(recording: LocalRecording): void;
}

export interface GifExportState {
  status: "idle" | "exporting" | "error";
  fraction: number;
  error: string | null;
}

export interface GifEstimateState {
  status: "idle" | "estimating" | "ready" | "error";
  bytes: number | null;
  frameCount: number | null;
}

export interface GifExportController extends GifExportState {
  start(args: StartGifExportArgs): Promise<void>;
  cancel(): void;
  estimate: GifEstimateState;
  /** Debounced (≤ 300 ms) size estimate for these settings; replaces any running one. */
  requestEstimate(args: GifJobArgs): void;
  cancelEstimate(): void;
  /**
   * Asks again, over this joined list, for an estimate that was refused because a joined
   * recording was loading, missing or unreadable. Does nothing otherwise, so the parent can
   * call it whenever the list changes.
   */
  retryRefusedEstimate(joined: GifJobArgs["joined"]): void;
}

const IDLE: GifExportState = { status: "idle", fraction: 0, error: null };
const NO_ESTIMATE: GifEstimateState = { status: "idle", bytes: null, frameCount: null };
/** FR 6: refresh the estimate at most 300 ms after the last change. */
export const ESTIMATE_DEBOUNCE_MS = 250;

/**
 * Builds the worker's start message: the plan sliced to the range, overlays rasterized at
 * SOURCE size (same as the MP4 export), the used slides decoded, and COPIES of the camera
 * arrays (transferring the preview's own buffers would detach them).
 */
async function buildStartMessage(
  args: GifJobArgs,
  mode: GifStartMessage["mode"],
  sourceBlob: Blob,
  webcam: WebcamTrackMessage | null,
  joined: GifStartMessage["joined"],
): Promise<{ message: GifStartMessage; transfer: Transferable[]; plan: ExportPlan }> {
  const plan = sliceExportPlan(buildExportPlan(args.scene), args.range.start, args.range.end);
  const { overlays, slides, mediaImages, camera, transfer } = await prepareWorkerInputs(args, plan);
  const message: GifStartMessage = {
    type: "start",
    mode,
    sourceBlob,
    plan,
    overlays,
    slides,
    mediaImages,
    source: { width: args.videoWidth, height: args.videoHeight },
    output: gifOutputSize(args.videoWidth, args.videoHeight, args.width),
    fps: args.fps,
    camera,
    cursor: args.cursor ?? null,
    webcam: plan.webcam ? webcam : null,
    joined,
  };
  return { message, transfer, plan };
}

function newGifWorker(): Worker {
  return new Worker(new URL("./gif-worker.ts", import.meta.url), { type: "module" });
}

/**
 * GIF export (NIW2-217), mirroring `useVideoExport`: one worker per job, cancel =
 * `worker.terminate()`. The finished file comes back from the worker as one buffer and is
 * saved through `gifSave` (main validates it and writes `<id>.gif` atomically), so a
 * cancelled or failed export never leaves anything in the vault. Also owns the debounced
 * size estimate, which runs in its own short-lived worker.
 */
export function useGifExport(): GifExportController {
  const t = useTranslations("videoEditor");
  const [state, setState] = useState<GifExportState>(IDLE);
  const [estimate, setEstimate] = useState<GifEstimateState>(NO_ESTIMATE);
  const workerRef = useRef<Worker | null>(null);
  const activeRef = useRef(false);
  const estimateWorkerRef = useRef<Worker | null>(null);
  const estimateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const estimateSeqRef = useRef(0);
  // The args of the last estimate refused over a joined recording; the sheet's settings effect
  // does not re-run when that recording finishes loading, so the parent re-asks through
  // `retryRefusedEstimate`. Cleared by every new request and by `cancelEstimate`.
  const refusedEstimateRef = useRef<GifJobArgs | null>(null);
  // The newest joined list the parent handed over. An estimate asked over an older list can be
  // refused after the list changed (the refusal lands after the debounce and the awaits), when
  // the parent's effect has already run and found nothing refused yet.
  const latestJoinedRef = useRef<GifJobArgs["joined"] | null>(null);
  const requestEstimateRef = useRef<((args: GifJobArgs) => void) | null>(null);
  // Every recording (the opened one and each joined one) is fetched once per vault id and
  // reused by every estimate and the export; a failed fetch is not cached.
  const recordingsRef = useRef(createRecordingCache("gif export"));
  // The webcam file, likewise fetched once per id (only for a scene with a webcam layer).
  const webcamRef = useRef<{ id: string; track: Promise<WebcamTrackMessage | null> } | null>(null);

  const sourceBlob = useCallback((id: string): Promise<Blob> => recordingsRef.current.blob(id), []);

  /**
   * What the plan's joined clips read, fetched; or the refusal to show. Never throws for a
   * recording that is missing, loading or unreadable: those are the user's to fix.
   */
  const joinedFiles = useCallback(
    async (
      args: GifJobArgs,
    ): Promise<{ files: GifStartMessage["joined"] } | { refusal: string }> => {
      const plan = sliceExportPlan(buildExportPlan(args.scene), args.range.start, args.range.end);
      const used = usedJoinedRecordings(plan, args.scene, args.joined);
      if (!used.ok) {
        return {
          refusal:
            used.reason === "missing"
              ? t("exportRecordingMissing", { title: used.title })
              : t("exportRecordingLoading"),
        };
      }
      try {
        const files = await fetchJoinedFiles(
          used.used,
          plan.webcam,
          recordingsRef.current,
          (error) => captureException(error, { context: "gif-export-webcam" }),
        );
        return { files };
      } catch (error) {
        if (error instanceof JoinedRecordingUnreadable) {
          captureException(error, { context: "gif-export" });
          return { refusal: t("exportRecordingMissing", { title: error.title }) };
        }
        throw error;
      }
    },
    [t],
  );

  const webcamTrack = useCallback((args: GifJobArgs): Promise<WebcamTrackMessage | null> => {
    if (!args.scene.webcam || !args.webcamTrack) return Promise.resolve(null);
    if (webcamRef.current?.id !== args.sourceId) {
      // A fetch that throws exports without the layer (reported), and is not cached: the
      // next export tries again. `onError` can run before fetchWebcamTrack returns (fetch()
      // throwing synchronously): `track` is declared null first, so that read is no TDZ, and
      // a failure flagged that early is simply never cached (E11).
      let failed = false;
      let track: Promise<WebcamTrackMessage | null> | null = null;
      track = fetchWebcamTrack(args.sourceId, args.scene.webcam, args.webcamTrack, (error) => {
        captureException(error, { context: "gif-export-webcam" });
        failed = true;
        if (track !== null && webcamRef.current?.track === track) webcamRef.current = null;
      });
      if (!failed) webcamRef.current = { id: args.sourceId, track };
      return track;
    }
    return webcamRef.current.track;
  }, []);

  const cancelEstimate = useCallback(() => {
    refusedEstimateRef.current = null;
    estimateSeqRef.current++;
    if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current);
    estimateTimerRef.current = null;
    estimateWorkerRef.current?.terminate();
    estimateWorkerRef.current = null;
    setEstimate(NO_ESTIMATE);
  }, []);

  const requestEstimate = useCallback(
    (args: GifJobArgs) => {
      const seq = ++estimateSeqRef.current;
      refusedEstimateRef.current = null;
      if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current);
      estimateWorkerRef.current?.terminate();
      estimateWorkerRef.current = null;
      setEstimate({ status: "estimating", bytes: null, frameCount: null });
      estimateTimerRef.current = setTimeout(() => {
        estimateTimerRef.current = null;
        void (async () => {
          try {
            const blob = await sourceBlob(args.sourceId);
            const webcam = await webcamTrack(args);
            const joined = await joinedFiles(args);
            if ("refusal" in joined) {
              if (seq !== estimateSeqRef.current) return;
              const latest = latestJoinedRef.current;
              if (latest !== null && latest !== args.joined) {
                requestEstimateRef.current?.({ ...args, joined: latest });
                return;
              }
              refusedEstimateRef.current = args;
              setEstimate({ status: "error", bytes: null, frameCount: null });
              return;
            }
            const { message, transfer } = await buildStartMessage(
              args,
              "estimate",
              blob,
              webcam,
              joined.files,
            );
            if (seq !== estimateSeqRef.current) return; // superseded meanwhile
            const worker = newGifWorker();
            estimateWorkerRef.current = worker;
            worker.onmessage = (event: MessageEvent<GifWorkerMessage>) => {
              if (seq !== estimateSeqRef.current) return;
              const msg = event.data;
              if (msg.type === "estimate") {
                setEstimate({ status: "ready", bytes: msg.bytes, frameCount: msg.frameCount });
              } else if (msg.type === "error") {
                setEstimate({ status: "error", bytes: null, frameCount: null });
              } else return;
              worker.terminate();
              if (estimateWorkerRef.current === worker) estimateWorkerRef.current = null;
            };
            worker.onerror = () => {
              if (seq !== estimateSeqRef.current) return;
              setEstimate({ status: "error", bytes: null, frameCount: null });
            };
            worker.postMessage(message, transfer);
          } catch (error) {
            if (seq !== estimateSeqRef.current) return;
            captureException(error, { context: "gif-estimate" });
            setEstimate({ status: "error", bytes: null, frameCount: null });
          }
        })();
      }, ESTIMATE_DEBOUNCE_MS);
    },
    [sourceBlob, webcamTrack, joinedFiles],
  );
  requestEstimateRef.current = requestEstimate;

  const retryRefusedEstimate = useCallback(
    (joined: GifJobArgs["joined"]) => {
      latestJoinedRef.current = joined;
      const refused = refusedEstimateRef.current;
      if (refused) requestEstimate({ ...refused, joined });
    },
    [requestEstimate],
  );

  const teardown = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    activeRef.current = false;
    teardown();
    setState(IDLE);
  }, [teardown]);

  const start = useCallback(
    async (args: StartGifExportArgs) => {
      if (activeRef.current) return;
      if (args.scene.items.length === 0) {
        setState({ status: "error", fraction: 0, error: t("exportEmptyTimeline") });
        return;
      }
      // FR 15: one job at a time — the estimate stops while the export runs.
      cancelEstimate();
      activeRef.current = true;
      setState({ status: "exporting", fraction: 0, error: null });

      const fail = (message: string, error?: unknown): void => {
        if (error !== undefined) captureException(error, { context: "gif-export" });
        activeRef.current = false;
        teardown();
        setState({ status: "error", fraction: 0, error: message });
      };

      try {
        const blob = await sourceBlob(args.sourceId);
        const webcam = await webcamTrack(args);
        const joined = await joinedFiles(args);
        if ("refusal" in joined) {
          fail(joined.refusal);
          return;
        }
        const { message, transfer, plan } = await buildStartMessage(
          args,
          "export",
          blob,
          webcam,
          joined.files,
        );
        if (!activeRef.current) return; // cancelled while preparing

        let poster: ArrayBuffer | null = null;
        const worker = newGifWorker();
        workerRef.current = worker;
        worker.onmessage = (event: MessageEvent<GifWorkerMessage>) => {
          const msg = event.data;
          if (!activeRef.current) return;
          if (msg.type === "progress") {
            setState((s) => (s.status === "exporting" ? { ...s, fraction: msg.fraction } : s));
          } else if (msg.type === "poster") {
            poster = msg.data;
          } else if (msg.type === "webcam-error") {
            // The worker carries on without the layer; the GIF is still made.
            captureException(new Error(msg.message), { context: "gif-export-webcam" });
          } else if (msg.type === "error") {
            fail(
              msg.code === "too-large" ? t("gifTooLargeError") : t("gifExportError"),
              new Error(msg.message),
            );
          } else if (msg.type === "done") {
            void (async () => {
              // Yield so a cancel() queued in the same tick wins (see useVideoExport).
              await Promise.resolve();
              if (!activeRef.current) return;
              try {
                const recording = await window.electronAPI.gifSave(msg.data, {
                  title: t("gifTitle", { title: args.title }),
                  durationSeconds: plan.totalDuration,
                  width: msg.width,
                  height: msg.height,
                  fps: args.fps,
                  thumbnail: poster,
                  derivedFromAssetId: args.derivedFromAssetId,
                });
                // A cancel during the save can't un-write the file; the export finished,
                // so report it rather than leave an unannounced item in the library.
                activeRef.current = false;
                teardown();
                setState(IDLE);
                args.onSaved(recording);
              } catch (error) {
                if (!activeRef.current) return;
                fail(t("gifExportError"), error);
              }
            })();
          }
        };
        worker.onerror = (event: ErrorEvent) => {
          fail(t("gifExportError"), event.error ?? new Error(event.message));
        };
        worker.postMessage(message, transfer);
      } catch (error) {
        fail(t("gifExportError"), error);
      }
    },
    [cancelEstimate, sourceBlob, webcamTrack, joinedFiles, teardown, t],
  );

  // Unmount: never leave a worker running behind the page.
  useEffect(() => {
    const exportWorker = workerRef;
    const estimateWorker = estimateWorkerRef;
    const estimateTimer = estimateTimerRef;
    return () => {
      exportWorker.current?.terminate();
      estimateWorker.current?.terminate();
      if (estimateTimer.current) clearTimeout(estimateTimer.current);
    };
  }, []);

  return {
    ...state,
    start,
    cancel,
    estimate,
    requestEstimate,
    cancelEstimate,
    retryRefusedEstimate,
  };
}
