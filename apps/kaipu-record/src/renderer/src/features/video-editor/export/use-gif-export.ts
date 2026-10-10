import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { LocalRecording } from "@shared/types/library-storage";
import { captureException } from "@renderer/features/analytics";
import type { SlideAssetStore } from "../slide-assets";
import type { VideoScene } from "../scene";
import type { CameraPath } from "../zoom/camera-path";
import { buildExportPlan, gifOutputSize, sliceExportPlan, type ExportPlan } from "./export-plan";
import type { GifFps, GifStartMessage, GifWorkerMessage } from "./gif-messages";
import { rasterizeOverlays } from "./overlay-raster";

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
): Promise<{ message: GifStartMessage; transfer: Transferable[]; plan: ExportPlan }> {
  const plan = sliceExportPlan(buildExportPlan(args.scene), args.range.start, args.range.end);
  const rasterized = await rasterizeOverlays(
    args.scene.overlays,
    args.videoWidth,
    args.videoHeight,
    args.previewWidth,
  );
  const usedOverlayIds = new Set(plan.overlayWindows.map((w) => w.overlayId));
  for (const r of rasterized) if (!usedOverlayIds.has(r.overlayId)) r.bitmap.close();
  const overlays = rasterized
    .filter((r) => usedOverlayIds.has(r.overlayId))
    .map((r) => ({ overlayId: r.overlayId, bitmap: r.bitmap }));
  const usedAssetIds = new Set(
    plan.segments.filter((s) => s.kind === "slide").map((s) => s.assetId),
  );
  const slides = await Promise.all(
    args.slideAssets
      .entries()
      .filter((asset) => usedAssetIds.has(asset.assetId))
      .map(async (asset) => ({
        assetId: asset.assetId,
        bitmap: await createImageBitmap(new Blob([asset.bytes], { type: asset.mimeType })),
      })),
  );
  const camera =
    plan.hasZoom && args.cameraPath
      ? {
          fps: args.cameraPath.fps,
          cx: args.cameraPath.cx.slice(),
          cy: args.cameraPath.cy.slice(),
          scale: args.cameraPath.scale.slice(),
        }
      : null;
  const message: GifStartMessage = {
    type: "start",
    mode,
    sourceBlob,
    plan,
    overlays,
    slides,
    source: { width: args.videoWidth, height: args.videoHeight },
    output: gifOutputSize(args.videoWidth, args.videoHeight, args.width),
    fps: args.fps,
    camera,
  };
  const transfer: Transferable[] = [
    ...overlays.map((o) => o.bitmap),
    ...slides.map((s) => s.bitmap),
    ...(camera ? [camera.cx.buffer, camera.cy.buffer, camera.scale.buffer] : []),
  ];
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
  // The source is fetched once per id and reused by every estimate and the export.
  const sourceRef = useRef<{ id: string; blob: Promise<Blob> } | null>(null);

  const sourceBlob = useCallback((id: string): Promise<Blob> => {
    if (sourceRef.current?.id !== id) {
      const blob = fetch(`kaipu-media://recording/${id}`).then((r) => r.blob());
      // A failed fetch must not be cached for the next attempt.
      blob.catch(() => {
        if (sourceRef.current?.blob === blob) sourceRef.current = null;
      });
      sourceRef.current = { id, blob };
    }
    return sourceRef.current.blob;
  }, []);

  const cancelEstimate = useCallback(() => {
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
      if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current);
      estimateWorkerRef.current?.terminate();
      estimateWorkerRef.current = null;
      setEstimate({ status: "estimating", bytes: null, frameCount: null });
      estimateTimerRef.current = setTimeout(() => {
        estimateTimerRef.current = null;
        void (async () => {
          try {
            const blob = await sourceBlob(args.sourceId);
            const { message, transfer } = await buildStartMessage(args, "estimate", blob);
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
    [sourceBlob],
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
        const { message, transfer, plan } = await buildStartMessage(args, "export", blob);
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
    [cancelEstimate, sourceBlob, teardown, t],
  );

  // Unmount: never leave a worker running behind the page.
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      estimateWorkerRef.current?.terminate();
      if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current);
    },
    [],
  );

  return { ...state, start, cancel, estimate, requestEstimate, cancelEstimate };
}
