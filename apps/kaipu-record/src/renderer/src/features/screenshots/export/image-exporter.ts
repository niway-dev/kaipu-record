import { exportScene } from "./index";
import { encodeImage, type EncodedImage } from "./image-encoder";
import { planExport, type ExportPlan, type ImageExportSettings } from "./image-export-settings";
import type { ExportInput } from "./types";

export interface ExportedImage extends EncodedImage {
  plan: ExportPlan;
}

/**
 * Export the scene as PNG, JPEG or WebP (NIW2-852). The composite is `exportScene("png", …)`,
 * the one every format starts from, so redactions are baked in exactly as in Copy and Save and
 * a 1× composite is shared with them through its memo. `frame` is the export frame's 1× size
 * (the export box's size); the plan derives the raster multiplier and the output size from it.
 */
export async function exportImage(
  settings: ImageExportSettings,
  frame: { w: number; h: number },
  input: ExportInput,
): Promise<ExportedImage> {
  const plan = planExport(frame.w, frame.h, settings);
  const png = await exportScene("png", { ...input, rasterScale: plan.rasterScale });
  return { ...(await encodeImage(png, plan)), plan };
}
