import { pdfExporter } from "./pdf-exporter";
import { pngExporter } from "./png-exporter";
import type { ExportFormat, ExportInput, Exporter } from "./types";

export type { ExportFormat, ExportInput, Exporter } from "./types";
export { PDF_RASTER_SCALE } from "./pdf-exporter";

/** Every format the editor can export to, keyed by its discriminator. */
export const EXPORTERS: Readonly<Record<ExportFormat, Exporter>> = {
  png: pngExporter,
  pdf: pdfExporter,
};

export function exporterFor(format: ExportFormat): Exporter {
  return EXPORTERS[format];
}

/** Composite the scene and encode it as `format`. */
export function exportScene(format: ExportFormat, input: ExportInput): Promise<ArrayBuffer> {
  return exporterFor(format).export(input);
}
