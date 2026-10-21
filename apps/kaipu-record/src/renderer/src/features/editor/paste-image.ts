import type { ImageSource } from "@renderer/features/screenshots/image-source";

/**
 * Getting an image off the clipboard and into the image editor (the Editor's
 * New page). Two ways in, one result: an in-memory PNG source marked as pasted,
 * which the editor opens like a fresh capture minus the capture conveniences.
 */

/** A decoded image as the editor's in-memory source wants it. */
export interface PastedImage {
  png: ArrayBuffer;
  width: number;
  height: number;
}

/**
 * The first image a paste event carries, or null. A copied picture arrives as an
 * image item; an image file copied in Finder arrives the same way.
 */
export function imageFileFromPaste(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

/**
 * Decode any image the browser can read and re-encode it as PNG: the editor's
 * readers, Copy and Save all treat the bytes as PNG, and a pasted photo is often
 * a JPEG.
 */
export async function decodeToPng(file: Blob): Promise<PastedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("paste: no 2d context to decode the image");
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("paste: could not encode the image as PNG");
    return { png: await blob.arrayBuffer(), width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** The editor source for a pasted image. */
export function pastedImageSource(image: PastedImage, title: string): ImageSource {
  return {
    kind: "blob",
    origin: "paste",
    bytes: image.png,
    width: image.width,
    height: image.height,
    title,
  };
}
