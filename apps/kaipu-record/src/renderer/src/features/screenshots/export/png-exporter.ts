import { compositeScene } from "../annotations/compositor";
import type { Exporter } from "./types";

/**
 * The lossless baseline: the composited frame at the shot's natural resolution.
 * Copy and Save both go through this so the clipboard and the vault hold the
 * same pixels.
 */
export const pngExporter: Exporter = {
  format: "png",
  mimeType: "image/png",
  extension: "png",
  export: ({ scene, bytes, displayedW, canvas, assets, rasterScale }) => {
    const scaled = rasterScale !== undefined && rasterScale > 1;
    if (!canvas && !scaled) return compositeScene(scene, bytes, displayedW);
    return compositeScene(scene, bytes, displayedW, {
      ...(canvas ? { canvas: true, assets } : {}),
      ...(scaled ? { rasterScale } : {}),
    });
  },
};
