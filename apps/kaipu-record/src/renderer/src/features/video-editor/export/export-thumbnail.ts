/**
 * Poster thumbnail for an exported recording, decoded from the source Blob rather
 * than a live MediaStream — mirrors `recorder-engine.ts`'s `captureThumbnail`, which
 * draws the first frame of a live stream to a canvas; this does the same against the
 * already-fetched export source so the export hook needs no dependency on the live
 * preview `<video>` element. Best-effort: any decode failure OR timeout resolves
 * `null` instead of blocking the export from finalizing (a missing poster is
 * cosmetic, not fatal).
 */

/** Wall-clock cap for the entire thumbnail decode pipeline. */
const THUMBNAIL_TIMEOUT_MS = 2000;

/** @param width/height native output pixels (falls back to the decoded video's own size). */
export async function captureExportThumbnail(
  sourceBlob: Blob,
  width: number,
  height: number,
): Promise<ArrayBuffer | null> {
  let url: string | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    url = URL.createObjectURL(sourceBlob);
    const video = document.createElement("video");
    video.muted = true;
    video.src = url;

    // Single 2 s timeout shared across decode + seek — if either hangs (e.g.
    // video already at currentTime 0 so `seeked` never fires, or the browser
    // can't decode the format), the rejection propagates to the outer
    // try/catch so the function resolves `null` and finalize is never blocked.
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("export-thumbnail: timeout")),
        THUMBNAIL_TIMEOUT_MS,
      );
    });

    await Promise.race([
      new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("export-thumbnail: video decode failed"));
      }),
      timeout,
    ]);

    // The seek promise has no native rejection path — add `onerror` so a decode
    // error mid-seek isn't silently swallowed, and race the shared timeout so a
    // stuck seek (e.g. video not yet seekable, or already at 0) can't strand
    // the promise forever.
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("export-thumbnail: seek error"));
        video.currentTime = 0;
      }),
      timeout,
    ]);

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
    // Clear the timer so a successful capture doesn't leave a dangling callback.
    if (timeoutId !== null) clearTimeout(timeoutId);
    if (url) URL.revokeObjectURL(url);
  }
}
