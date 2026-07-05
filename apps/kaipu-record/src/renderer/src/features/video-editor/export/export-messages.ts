/**
 * Message contracts shared by the renderer (hook) and the export worker.
 * Keeping them in one file eliminates the risk of the two sides drifting apart.
 *
 * Cancellation is done out-of-band: the hook calls `worker.terminate()`.
 * No cancellation message is needed — the worker process just stops.
 */
import type { ExportPlan } from "./export-plan";

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
  /** Native pixel dimensions of the output video. */
  output: { width: number; height: number };
}

/**
 * Messages posted from the worker back to the renderer.
 * `chunk` is transferable (the caller transfers the ArrayBuffer).
 * `progress` is throttled to ~4 Hz in the worker to avoid flooding the renderer.
 */
export type ExportWorkerMessage =
  | { type: "chunk"; data: ArrayBuffer; position: number }
  | { type: "progress"; fraction: number }
  | { type: "done" }
  | { type: "error"; message: string };
