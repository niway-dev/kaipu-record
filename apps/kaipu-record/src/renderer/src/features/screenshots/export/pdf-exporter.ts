import { PDFDocument } from "pdf-lib";
import { compositeSceneAt } from "../annotations/compositor";
import type { Exporter } from "./types";

/**
 * Resolution multiplier for the raster embedded in the PDF. The page is sized in
 * points to the frame's 1× pixels, so a 3× raster gives three screen pixels per
 * point — zooming to 300% in a viewer is still 1:1 with the bitmap, and the
 * annotations (drawn as vectors into that bitmap) stay crisp that far. Capped by
 * the compositor on very large captures. Vector annotations are a later step.
 */
export const PDF_RASTER_SCALE = 3;

/**
 * One page, no margins, sized to the composed frame. The PNG is embedded as-is
 * (pdf-lib keeps its alpha, so a "None" background stays transparent) and drawn
 * to fill the page, which puts the extra resolution to work as zoom headroom.
 */
export async function buildPdf(
  png: ArrayBuffer,
  width: number,
  height: number,
): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png);
  const page = doc.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });
  const out = await doc.save();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

export const pdfExporter: Exporter = {
  format: "pdf",
  mimeType: "application/pdf",
  extension: "pdf",
  async export({ scene, bytes, displayedW }) {
    const frame = await compositeSceneAt(scene, bytes, displayedW, {
      rasterScale: PDF_RASTER_SCALE,
    });
    return buildPdf(frame.png, frame.width, frame.height);
  },
};
