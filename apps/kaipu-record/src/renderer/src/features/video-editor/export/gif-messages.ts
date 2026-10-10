/**
 * Message contracts between the renderer (`use-gif-export.ts`) and `gif-worker.ts`
 * (NIW2-217). Mirrors export-messages.ts; cancellation is `worker.terminate()`.
 */
import type { CameraPathMessage } from "./export-messages";
import type { ExportPlan } from "./export-plan";

/** GIF frame rates offered in the export sheet. 30 fps is ruled out (browser delay clamp). */
export type GifFps = 10 | 15;
/** GIF widths offered in the export sheet (never wider than the source). */
export const GIF_WIDTHS = [480, 640, 800] as const;
export type GifWidth = (typeof GIF_WIDTHS)[number];
export const GIF_FPS_OPTIONS: readonly GifFps[] = [10, 15];

/** Output limits (FR 7, FR 8, IPC cap). */
export const GIF_MAX_DURATION_S = 30;
export const GIF_MIN_DURATION_S = 0.5;
export const GIF_WARN_BYTES = 10 * 1024 * 1024;
/** Mirrors `GIF_MAX_BYTES` in the main process (`src/main/library/gif-save.ts`). */
export const GIF_HARD_CAP_BYTES = 64 * 1024 * 1024;

export interface GifStartMessage {
  type: "start";
  /** "estimate" encodes a handful of sampled frames; "export" encodes the whole range. */
  mode: "estimate" | "export";
  sourceBlob: Blob;
  /** The plan already sliced to the range and rebased to 0 (`sliceExportPlan`). */
  plan: ExportPlan;
  /** Overlay bitmaps rasterized at SOURCE size, like the MP4 export. */
  overlays: Array<{ overlayId: string; bitmap: ImageBitmap }>;
  slides: Array<{ assetId: string; bitmap: ImageBitmap }>;
  /** Frames are composed at source size (identical geometry to the MP4)… */
  source: { width: number; height: number };
  /** …then downsampled once to the GIF size. */
  output: { width: number; height: number };
  fps: GifFps;
  camera: CameraPathMessage | null;
}

export type GifWorkerMessage =
  | { type: "estimate"; bytes: number; frameCount: number }
  | { type: "progress"; fraction: number }
  /** JPEG of the first composed GIF frame (transferable). */
  | { type: "poster"; data: ArrayBuffer }
  | {
      type: "done";
      /** The complete GIF file (transferable). */
      data: ArrayBuffer;
      width: number;
      height: number;
      /** Frames in the file, after folding unchanged ones into the previous delay. */
      frameCount: number;
    }
  | { type: "error"; message: string; code?: "too-large" };
