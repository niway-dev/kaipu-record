import { PDFDocument } from "pdf-lib";

/**
 * One page, no margins, sized to the composed frame. The PNG is embedded as-is
 * (pdf-lib keeps its alpha, so a "None" background stays transparent) and drawn
 * to fill the page, which puts the extra resolution to work as zoom headroom.
 * WORKER-BUNDLE INVARIANT: no DOM, no React — this runs inside pdf-worker.ts.
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
