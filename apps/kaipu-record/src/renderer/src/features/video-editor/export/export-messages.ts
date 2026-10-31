/**
 * Message contracts shared by the renderer (hook) and the export worker.
 * Keeping them in one file eliminates the risk of the two sides drifting apart.
 *
 * Cancellation is done out-of-band: the hook calls `worker.terminate()`.
 * No cancellation message is needed — the worker process just stops.
 */
import type { ExportPlan } from "./export-plan";
import type { ResolvedExportTarget } from "./export-presets";
import type { VideoEncodingChoice } from "./video-encoding";

/** A CameraPath's arrays (transferred — the renderer sends COPIES, see use-video-export). */
export interface CameraPathMessage {
  fps: number;
  cx: Float32Array;
  cy: Float32Array;
  scale: Float32Array;
}

/**
 * The recording's webcam file (ADR 0037) for the webcam layer: sent only when the plan has a
 * webcam (`plan.webcam`) and the file could be read. The layer's layout is `plan.webcam`.
 */
export interface WebcamTrackMessage {
  /** The webcam file (`mediaUrl("webcam", id)`) as a Blob (not transferred: Blobs are cheap to clone). */
  blob: Blob;
  /** Webcam time 0 − screen time 0, in ms: webcam time = source time − startOffsetMs / 1000. */
  startOffsetMs: number;
}

/** Sent once from the renderer to the worker to kick off the export. */
export interface ExportStartMessage {
  type: "start";
  /** The recorded source file as a Blob (transferred, not copied). */
  sourceBlob: Blob;
  /** The fully-resolved render plan built by `buildExportPlan`. */
  plan: ExportPlan;
  /**
   * Rasterized overlay bitmaps, each bundled with the visibility window so the
   * worker can stamp without consulting the plan again.
   */
  overlays: Array<{ overlayId: string; start: number; end: number; bitmap: ImageBitmap }>;
  /** Slide image bitmaps keyed by assetId. */
  slides: Array<{ assetId: string; bitmap: ImageBitmap }>;
  /** Pixel dimensions of the OUTPUT video (the preset's target size; NIW2-218). */
  output: { width: number; height: number };
  /** Native pixel dimensions of the source video (overlays are rasterized at this size). */
  source: { width: number; height: number };
  /** The resolved export preset: size, framing, bitrates, fps cap, fast start (NIW2-218). */
  target: ResolvedExportTarget;
  /** v2: the preview's camera path (same simulation), or null when the scene has no zoom. */
  camera: CameraPathMessage | null;
  /** The webcam file, or null: no webcam layer, and no second decoder in the worker. */
  webcam: WebcamTrackMessage | null;
}

/**
 * Messages posted from the worker back to the renderer.
 * `chunk` is transferable (the caller transfers the ArrayBuffer).
 * `progress` is throttled to ~4 Hz in the worker to avoid flooding the renderer.
 */
export type ExportWorkerMessage =
  | { type: "chunk"; data: ArrayBuffer; position: number }
  /**
   * JPEG poster of the FIRST RENDERED output frame (transferable), sent once before the
   * first frame is encoded. It replaces decoding the poster from the source file, which
   * showed footage the edit deleted and — with video-editor v2 — content it redacted.
   */
  | { type: "poster"; data: ArrayBuffer }
  /**
   * The video encoder the worker settled on, sent once before encoding. The renderer logs a
   * software fallback (and a tier without quantizer mode) — the worker has no analytics.
   */
  | { type: "encoder"; choice: VideoEncodingChoice }
  | { type: "progress"; fraction: number }
  /**
   * The webcam file could not be opened or decoded: the export goes on without the layer
   * from here, and the renderer logs it (the worker has no analytics).
   */
  | { type: "webcam-error"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };
