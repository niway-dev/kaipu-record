import { useCallback, useEffect, useRef, useState } from "react";
import { captureException } from "@renderer/features/analytics";
import { useTranslations } from "@kaipu/i18n";
import type { CursorLayerData } from "../cursor/cursor-model";
import type { VideoScene } from "../scene";
import type { SlideAssetStore } from "../slide-assets";
import type { CameraPath } from "../zoom/camera-path";
import type { WebcamTrackMessage } from "./export-messages";
import type { ExportJoinedRecording } from "./export-runner";
import {
  createRecordingCache,
  fetchJoinedFiles,
  JoinedRecordingUnreadable,
  RecordingUnavailableError,
  usedJoinedRecordings,
} from "./joined-files";
import type { GifStartMessage, GifWorkerMessage } from "./gif-messages";
import { prepareWorkerInputs } from "./job-inputs";
import { planStill } from "./still-plan";
import { type ExportWebcamTrack, fetchWebcamTrack } from "./webcam-fetch";

/** The frame at the playhead, composed like an export would, ready to be saved. */
export interface StillCapture {
  /** PNG bytes. */
  png: ArrayBuffer;
  /** The export's source resolution. */
  width: number;
  height: number;
  /** Timeline time of the frame (the playhead, clamped into the timeline). */
  timelineSeconds: number;
  /** Source video time of the frame; null on a slide. */
  sourceSeconds: number | null;
}

export interface StillCaptureArgs {
  scene: VideoScene;
  /** The recording id the editor is open on (`mediaUrl("recording", sourceId)`). */
  sourceId: string;
  /** Native size of the source video: the PNG's size. */
  videoWidth: number;
  videoHeight: number;
  /** Displayed px of the preview video box — overlay strokes scale true-to-preview. */
  previewWidth: number;
  slideAssets: SlideAssetStore;
  cameraPath: CameraPath | null;
  cursor?: CursorLayerData | null;
  /** The recording's webcam track, when it has one (ADR 0038). */
  webcamTrack?: ExportWebcamTrack | null;
  /** The scene's joined recordings (ADR 0058), as for the MP4 export; `[]` without joins. */
  joined: ExportJoinedRecording[];
  /** The playhead, in edited-timeline seconds. */
  playhead: number;
}

export interface StillCaptureController {
  capture(args: StillCaptureArgs): Promise<StillCapture>;
  busy: boolean;
}

/**
 * Builds the worker's start message for one still: the WHOLE plan (not sliced) so privacy
 * redactions, overlay windows, webcam and background all apply, the frame time, and the
 * source size as the output. Exported for tests.
 */
export async function buildStillMessage(
  args: StillCaptureArgs,
  sourceBlob: Blob | null,
  webcam: WebcamTrackMessage | null,
  joined: GifStartMessage["joined"] = [],
): Promise<{
  message: GifStartMessage;
  transfer: Transferable[];
  still: ReturnType<typeof planStill>;
}> {
  const still = planStill(args.scene, args.playhead);
  const { overlays, slides, mediaImages, camera, transfer } = await prepareWorkerInputs(
    args,
    still.plan,
  );
  const size = { width: args.videoWidth, height: args.videoHeight };
  const message: GifStartMessage = {
    type: "start",
    mode: "still",
    stillTime: still.timelineSeconds,
    sourceBlob,
    plan: still.plan,
    overlays,
    slides,
    mediaImages,
    source: size,
    output: size,
    // Unused in still mode (no schedule); the field is required by the shared message.
    fps: 10,
    camera,
    cursor: args.cursor ?? null,
    webcam: still.plan.webcam ? webcam : null,
    joined,
  };
  return { message, transfer, still };
}

function runStillWorker(
  message: GifStartMessage,
  transfer: Transferable[],
  workerRef: { current: Worker | null },
): Promise<{ png: ArrayBuffer; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./gif-worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const finish = (): void => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
    worker.onmessage = (event: MessageEvent<GifWorkerMessage>) => {
      const msg = event.data;
      if (msg.type === "still") {
        finish();
        resolve({ png: msg.data, width: msg.width, height: msg.height });
      } else if (msg.type === "error") {
        finish();
        reject(new Error(msg.message));
      } else if (msg.type === "webcam-error") {
        // The frame is still made, without the webcam layer.
        captureException(new Error(msg.message), { context: "still-capture-webcam" });
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      finish();
      reject(event.error ?? new Error(event.message));
    };
    worker.postMessage(message, transfer);
  });
}

/**
 * Still capture (NIW2-764): the frame at the playhead, composed by the GIF worker's "still"
 * mode through the export composer. One worker per capture, terminated when it answers or
 * on unmount. Only the recording under the playhead is fetched (ADR 0058), once per vault id
 * and reused by later captures; a joined one by its current id, never its asset id.
 */
export function useStillCapture(): StillCaptureController {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const recordingsRef = useRef(createRecordingCache("still capture"));
  const t = useTranslations("videoEditor");

  const capture = useCallback(
    async (args: StillCaptureArgs): Promise<StillCapture> => {
      if (busyRef.current) throw new Error("a capture is already running");
      busyRef.current = true;
      setBusy(true);
      try {
        // The recording under the playhead is the only one this frame reads.
        const underPlayhead = planStill(args.scene, args.playhead);
        let blob: Blob | null = null;
        let joined: GifStartMessage["joined"] = [];
        let webcam: WebcamTrackMessage | null = null;
        if (underPlayhead.sourceId === null) {
          blob = await recordingsRef.current.blob(args.sourceId);
          // A webcam file that fails to load captures without the layer (reported).
          webcam = await fetchWebcamTrack(
            args.sourceId,
            args.scene.webcam,
            args.webcamTrack,
            (error) => captureException(error, { context: "still-capture-webcam" }),
          );
        } else {
          const sourceId = underPlayhead.sourceId;
          const used = usedJoinedRecordings(
            {
              segments: underPlayhead.plan.segments.filter(
                (s) => s.kind === "clip" && s.sourceId === sourceId,
              ),
            },
            args.scene,
            args.joined,
          );
          if (!used.ok) {
            throw new RecordingUnavailableError(
              used.reason === "missing"
                ? t("captureRecordingMissing", { title: used.title })
                : t("captureRecordingLoading"),
            );
          }
          try {
            joined = await fetchJoinedFiles(
              used.used,
              underPlayhead.plan.webcam,
              recordingsRef.current,
              (error) => captureException(error, { context: "still-capture-webcam" }),
            );
          } catch (error) {
            if (error instanceof JoinedRecordingUnreadable) {
              throw new RecordingUnavailableError(
                t("captureRecordingMissing", { title: error.title }),
                { cause: error },
              );
            }
            throw error;
          }
        }
        const { message, transfer, still } = await buildStillMessage(args, blob, webcam, joined);
        const result = await runStillWorker(message, transfer, workerRef);
        return {
          ...result,
          timelineSeconds: still.timelineSeconds,
          sourceSeconds: still.sourceSeconds,
        };
      } catch (error) {
        captureException(error, { context: "still-capture" });
        throw error;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [t],
  );

  useEffect(() => {
    const worker = workerRef;
    return () => worker.current?.terminate();
  }, []);

  return { capture, busy };
}
