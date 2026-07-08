import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";

/**
 * Decodes a single frame from a video Blob and encodes it as a JPEG poster.
 *
 * The shared primitive behind every "a vault file exists but has no thumbnail"
 * fix — edited-video export and imported/interrupted-recording heal both call it.
 * It decodes through mediabunny's `CanvasSink.canvasesAtTimestamps`, which pulls a
 * frame at an exact source time WITHOUT relying on an `<video>` element's `seeked`
 * event (that event never fires when the element is already at the requested time,
 * which is why the previous `<video>`-based capture always returned null).
 *
 * Frame decoding needs WebCodecs, so this only runs in the renderer — never the
 * main process. Best-effort by contract: any decode/encode failure resolves `null`
 * rather than throwing, because a missing poster is cosmetic, not fatal.
 *
 * @param atSeconds source-time offset of the frame to capture (clamped to >= 0).
 */
export async function generateThumbnail(blob: Blob, atSeconds = 0): Promise<ArrayBuffer | null> {
  try {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;

    const sink = new CanvasSink(track, { width: POSTER_WIDTH });
    for await (const wrapped of sink.canvasesAtTimestamps([Math.max(0, atSeconds)])) {
      if (!wrapped) continue;
      const canvas = wrapped.canvas as HTMLCanvasElement;
      const jpeg = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.7),
      );
      return jpeg ? await jpeg.arrayBuffer() : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Poster width in px; height follows the source aspect ratio. Small enough for a
 * card poster, sharp enough at grid size. */
const POSTER_WIDTH = 640;
