import { compositeSceneAt } from "../annotations/compositor";
import type { PdfRequest, PdfResponse } from "./pdf-messages";
import type { Exporter } from "./types";

/**
 * Resolution multiplier for the raster embedded in the PDF. The page is sized in
 * points to the frame's 1× pixels, so a 3× raster gives three screen pixels per
 * point — zooming to 300% in a viewer is still 1:1 with the bitmap, and the
 * annotations (drawn as vectors into that bitmap) stay crisp that far. Capped by
 * the compositor on very large captures. Vector annotations are a later step.
 */
export const PDF_RASTER_SCALE = 3;

function newPdfWorker(): Worker {
  return new Worker(new URL("./pdf-worker.ts", import.meta.url), { type: "module" });
}

/**
 * Build the PDF off the main thread. `png` is transferred, so it is unusable by
 * the caller afterwards. Without `Worker` (jsdom) it runs inline: same output.
 */
export async function buildPdfOffThread(
  png: ArrayBuffer,
  width: number,
  height: number,
): Promise<ArrayBuffer> {
  if (typeof Worker === "undefined") {
    const { buildPdf } = await import("./build-pdf");
    return buildPdf(png, width, height);
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const worker = newPdfWorker();
    worker.onmessage = (event: MessageEvent<PdfResponse>) => {
      worker.terminate();
      if (event.data.type === "done") resolve(event.data.pdf);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "pdf worker failed"));
    };
    const request: PdfRequest = { png, width, height };
    worker.postMessage(request, [png]);
  });
}

export const pdfExporter: Exporter = {
  format: "pdf",
  mimeType: "application/pdf",
  extension: "pdf",
  async export({ scene, bytes, displayedW }) {
    const frame = await compositeSceneAt(scene, bytes, displayedW, {
      rasterScale: PDF_RASTER_SCALE,
    });
    return buildPdfOffThread(frame.png, frame.width, frame.height);
  },
};
