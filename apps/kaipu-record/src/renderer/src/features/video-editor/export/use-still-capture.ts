import { useCallback, useEffect, useRef, useState } from "react";
import { captureException } from "@renderer/features/analytics";
import { mediaUrl } from "@renderer/lib/media-url";
import type { CursorLayerData } from "../cursor/cursor-model";
import type { VideoScene } from "../scene";
import type { SlideAssetStore } from "../slide-assets";
import type { CameraPath } from "../zoom/camera-path";
import type { WebcamTrackMessage } from "./export-messages";
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
  sourceBlob: Blob,
  webcam: WebcamTrackMessage | null,
): Promise<{
  message: GifStartMessage;
  transfer: Transferable[];
  still: ReturnType<typeof planStill>;
}> {
  const still = planStill(args.scene, args.playhead);
  const { overlays, slides, camera, transfer } = await prepareWorkerInputs(args, still.plan);
  const size = { width: args.videoWidth, height: args.videoHeight };
  const message: GifStartMessage = {
    type: "start",
    mode: "still",
    stillTime: still.timelineSeconds,
    sourceBlob,
    plan: still.plan,
    overlays,
    slides,
    source: size,
    output: size,
    // Unused in still mode (no schedule); the field is required by the shared message.
    fps: 10,
    camera,
    cursor: args.cursor ?? null,
    webcam: still.plan.webcam ? webcam : null,
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
 * on unmount. The source file is fetched once per recording id and reused by later captures.
 */
export function useStillCapture(): StillCaptureController {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const sourceRef = useRef<{ id: string; blob: Promise<Blob> } | null>(null);

  const sourceBlob = useCallback((id: string): Promise<Blob> => {
    if (sourceRef.current?.id !== id) {
      const blob = fetch(mediaUrl("recording", id)).then((r) => {
        // An error page is not the recording: fail, so it is not cached as one.
        if (!r.ok) throw new Error(`still capture: source fetch failed (${r.status})`);
        return r.blob();
      });
      // A failed fetch must not be cached for the next attempt.
      blob.catch(() => {
        if (sourceRef.current?.blob === blob) sourceRef.current = null;
      });
      sourceRef.current = { id, blob };
    }
    return sourceRef.current.blob;
  }, []);

  const capture = useCallback(
    async (args: StillCaptureArgs): Promise<StillCapture> => {
      if (busyRef.current) throw new Error("a capture is already running");
      busyRef.current = true;
      setBusy(true);
      try {
        const blob = await sourceBlob(args.sourceId);
        // A webcam file that fails to load captures without the layer (reported).
        const webcam = await fetchWebcamTrack(
          args.sourceId,
          args.scene.webcam,
          args.webcamTrack,
          (error) => captureException(error, { context: "still-capture-webcam" }),
        );
        const { message, transfer, still } = await buildStillMessage(args, blob, webcam);
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
    [sourceBlob],
  );

  useEffect(() => {
    const worker = workerRef;
    return () => worker.current?.terminate();
  }, []);

  return { capture, busy };
}
