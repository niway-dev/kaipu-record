import { sameScene } from "../annotations/scene";
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

interface CachedExport {
  format: ExportFormat;
  input: ExportInput;
  result: Promise<ArrayBuffer>;
}

/**
 * The last export. Auto copy then auto save (and Copy then Save on an untouched
 * scene) ask for byte-identical output, and compositing is the expensive part (data
 * URL, two decodes, SVG, canvas, PNG encode). One entry bounds memory, and any edit
 * makes the old entry unreachable anyway. The scene is compared by its inner refs
 * (`sameScene`), not by wrapper identity, because callers rebuild the wrapper on
 * every render. `bytes` is compared by identity: `useImageSource` hands out the same
 * buffer for the whole session.
 */
let lastExport: CachedExport | null = null;

/** Forget the memoized export (tests, and editor unmount). */
export function clearExportCache(): void {
  lastExport = null;
}

function sameInput(a: ExportInput, b: ExportInput): boolean {
  return a.bytes === b.bytes && a.displayedW === b.displayedW && sameScene(a.scene, b.scene);
}

/**
 * Composite the scene and encode it as `format`. Repeat calls with an unchanged
 * scene, shot and display width share one result (see `lastExport`). The buffer is
 * shared: callers must not mutate or transfer it (IPC `invoke` clones).
 */
export function exportScene(format: ExportFormat, input: ExportInput): Promise<ArrayBuffer> {
  if (lastExport && lastExport.format === format && sameInput(lastExport.input, input)) {
    return lastExport.result;
  }
  const entry: CachedExport = { format, input, result: exporterFor(format).export(input) };
  lastExport = entry;
  // A failed composite must not poison the next attempt (toast Retry).
  entry.result.catch(() => {
    if (lastExport === entry) lastExport = null;
  });
  return entry.result;
}
