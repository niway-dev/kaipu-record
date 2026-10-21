import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clampRasterScale, MAX_RASTER_SIDE } from "../annotations/compositor";
import type { Scene } from "../annotations/scene";

// jsdom can't rasterize an SVG, so the compositor is stubbed: the exporters are
// tested on what they do AROUND it (which scale they ask for, how they encode).
const compositeSceneAt = vi.fn();
vi.mock("../annotations/compositor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../annotations/compositor")>()),
  compositeSceneAt: (...args: unknown[]) => compositeSceneAt(...args),
  compositeScene: async (...args: unknown[]) => (await compositeSceneAt(...args)).png,
}));

const { EXPORTERS, exportScene, PDF_RASTER_SCALE } = await import("./index");
const { buildPdf } = await import("./pdf-exporter");

const scene: Scene = {
  beautify: { bg: "none", padding: 0, radius: 0, shadow: 0 },
  annotations: [],
};

/** A real 2×2 PNG so pdf-lib can decode it. */
async function tinyPng(): Promise<ArrayBuffer> {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEIGGEMIAAAJfQD/QKnNq4AAAAASUVORK5CYII=";
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

afterEach(() => compositeSceneAt.mockReset());

describe("export seam", () => {
  it("registers an exporter per format with its mime type and extension", () => {
    expect(EXPORTERS.png).toMatchObject({ format: "png", mimeType: "image/png", extension: "png" });
    expect(EXPORTERS.pdf).toMatchObject({
      format: "pdf",
      mimeType: "application/pdf",
      extension: "pdf",
    });
  });

  it("png exports the composited frame at 1× untouched", async () => {
    const png = await tinyPng();
    compositeSceneAt.mockResolvedValue({ png, width: 2, height: 2, scale: 1 });
    const out = await exportScene("png", { scene, bytes: png, displayedW: 2 });
    expect(out).toBe(png);
    // No raster-scale option: Copy/Save must keep matching the shot 1:1.
    expect(compositeSceneAt).toHaveBeenCalledWith(scene, png, 2);
  });

  it("pdf asks the compositor for a high-DPI raster", async () => {
    const png = await tinyPng();
    compositeSceneAt.mockResolvedValue({ png, width: 2, height: 2, scale: PDF_RASTER_SCALE });
    await exportScene("pdf", { scene, bytes: png, displayedW: 2 });
    expect(compositeSceneAt).toHaveBeenCalledWith(scene, png, 2, {
      rasterScale: PDF_RASTER_SCALE,
    });
    expect(PDF_RASTER_SCALE).toBeGreaterThanOrEqual(2);
  });

  it("pdf is a single page sized to the frame's 1× pixels, with the image filling it", async () => {
    const png = await tinyPng();
    compositeSceneAt.mockResolvedValue({ png, width: 640, height: 400, scale: 3 });
    const bytes = await exportScene("pdf", { scene, bytes: png, displayedW: 640 });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBe(640);
    expect(height).toBe(400);
  });

  it("buildPdf embeds the PNG once and keeps the page/raster ratio", async () => {
    const png = await tinyPng();
    const bytes = await buildPdf(png, 300, 150);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getSize()).toEqual({ width: 300, height: 150 });
  });
});

describe("clampRasterScale", () => {
  it("honours the requested scale when the canvas fits", () => {
    expect(clampRasterScale(3, 1200, 800)).toBe(3);
  });

  it("steps down to the largest scale that keeps both sides under the cap", () => {
    expect(clampRasterScale(3, 2880, 1800)).toBe(2);
    expect(clampRasterScale(3, 1800, 2880)).toBe(2);
    expect(clampRasterScale(3, MAX_RASTER_SIDE, 10)).toBe(1);
  });

  it("never goes below 1, even for frames already past the cap", () => {
    expect(clampRasterScale(3, MAX_RASTER_SIDE * 2, 100)).toBe(1);
    expect(clampRasterScale(0, 10, 10)).toBe(1);
  });
});
