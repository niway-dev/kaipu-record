import { FLATTEN_COLOR, type ExportPlan } from "./image-export-settings";

export interface EncodedImage {
  bytes: ArrayBuffer;
  /** The pixel size of the encoded file. */
  width: number;
  height: number;
}

/**
 * Encode the composited PNG as the plan says: decode it, draw it at the plan's size (white
 * underneath for JPEG), and let Chromium's canvas encoder write PNG, JPEG or WebP. No
 * compositing happens here: `png` is what `exportScene("png", …)` returned, the same
 * redaction-baked frame Copy and Save use, so every format shows the same pixels.
 *
 * `canvas.toBlob` does not fail on a type it cannot encode, it hands back a PNG. The blob's type
 * is checked, so a ".webp" file is never a PNG underneath.
 */
export async function encodeImage(png: ArrayBuffer, plan: ExportPlan): Promise<EncodedImage> {
  const bitmap = await createImageBitmap(new Blob([png], { type: "image/png" }));
  try {
    // A lossless export of a frame already at the target size is Save's own PNG, byte for byte.
    if (
      plan.mimeType === "image/png" &&
      bitmap.width === plan.width &&
      bitmap.height === plan.height
    ) {
      return { bytes: png, width: plan.width, height: plan.height };
    }
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("image encoder: no 2D context");
    if (plan.flatten) {
      ctx.fillStyle = FLATTEN_COLOR;
      ctx.fillRect(0, 0, plan.width, plan.height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(
        resolve,
        plan.mimeType,
        plan.mimeType === "image/png" ? undefined : plan.quality,
      ),
    );
    if (!blob) throw new Error("image encoder: toBlob returned nothing");
    if (blob.type !== plan.mimeType) {
      throw new Error(`image encoder: asked for ${plan.mimeType}, got ${blob.type || "nothing"}`);
    }
    return { bytes: await blob.arrayBuffer(), width: plan.width, height: plan.height };
  } finally {
    bitmap.close();
  }
}
