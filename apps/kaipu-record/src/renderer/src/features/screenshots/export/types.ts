import type { CanvasAssets } from "../annotations/redaction";
import type { Scene } from "../annotations/scene";

/**
 * The formats a composed capture can be exported to. Adding one is a new
 * exporter module plus a member here — the editor never learns how a format is
 * encoded, the same way it never learns how an image origin is read
 * (`image-source/`).
 */
export type ExportFormat = "png" | "pdf";

/** What every exporter receives: the scene and the shot it's drawn over. */
export interface ExportInput {
  scene: Scene;
  /** The source screenshot's PNG bytes. */
  bytes: ArrayBuffer;
  /** On-screen width of the shot; beautify px are display-relative (see compositor). */
  displayedW: number;
  /**
   * Canvas mode (NIW2-698, behind `image-canvas`): export the content box, windowed by
   * `scene.exportFrame`. Absent = today's export. Part of the memo key.
   */
  canvas?: boolean;
  /**
   * Canvas mode (NIW2-703): the PNG bytes of every added image, by asset id. Part of the
   * memo key (by identity, like `bytes`).
   */
  assets?: CanvasAssets;
  /**
   * Resolution multiplier over the frame's natural pixels (NIW2-852: the image exporter's 2×).
   * Absent or 1 = today's 1:1 PNG, which is what Copy and Save use. Part of the memo key.
   */
  rasterScale?: number;
}

export interface Exporter {
  format: ExportFormat;
  mimeType: string;
  /** File extension without the dot. */
  extension: string;
  export(input: ExportInput): Promise<ArrayBuffer>;
}
