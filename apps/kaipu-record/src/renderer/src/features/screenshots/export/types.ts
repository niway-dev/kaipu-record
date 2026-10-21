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
}

export interface Exporter {
  format: ExportFormat;
  mimeType: string;
  /** File extension without the dot. */
  extension: string;
  export(input: ExportInput): Promise<ArrayBuffer>;
}
