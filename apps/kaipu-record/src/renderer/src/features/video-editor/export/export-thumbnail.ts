/**
 * Poster thumbnail for an exported recording, decoded from the source Blob rather
 * than a live MediaStream — mirrors `recorder-engine.ts`'s `captureThumbnail`, which
 * draws the first frame of a live stream to a canvas; this does the same against the
 * already-fetched export source so the export hook needs no dependency on the live
 * preview `<video>` element. Best-effort: any decode failure resolves `null` instead
 * of blocking the export from finalizing (a missing poster is cosmetic, not fatal).
 */

/** @param width/height native output pixels (falls back to the decoded video's own size). */
export async function captureExportThumbnail(
  sourceBlob: Blob,
  width: number,
  height: number,
): Promise<ArrayBuffer | null> {
  let url: string | null = null;
  try {
    url = URL.createObjectURL(sourceBlob);
    const video = document.createElement("video");
    video.muted = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("export-thumbnail: video decode failed"));
    });
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = 0;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width || video.videoWidth || 1280;
    canvas.height = height || video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.7),
    );
    return blob ? await blob.arrayBuffer() : null;
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
