/**
 * Message contract between the export worker (export-worker.ts) and the future
 * export hook (G10). Kept in its own module — with no worker-only or DOM-only
 * imports — so both sides can import it without pulling in the other's runtime.
 */
import type { ExportPlan } from "./export-plan";

export interface ExportStartMessage {
  type: "start";
  sourceBlob: Blob;
  plan: ExportPlan;
  overlays: { overlayId: string; start: number; end: number; bitmap: ImageBitmap }[];
  slides: { assetId: string; bitmap: ImageBitmap }[];
  output: { width: number; height: number };
}

export type ExportWorkerMessage =
  | { type: "chunk"; data: ArrayBuffer; position: number }
  /** 0..1, throttled to ~4 Hz. */
  | { type: "progress"; fraction: number }
  | { type: "done" }
  | { type: "error"; message: string };
