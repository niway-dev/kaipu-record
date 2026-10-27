import type { Size } from "@shared/capture-geometry";

/** How long a take waits for the first frame before sizing from the track's report. */
export const FRAME_SIZE_TIMEOUT_MS = 1500;

/**
 * The size of the frames a capture track actually delivers. `getSettings()` is not that for
 * desktop capture: Chromium can report the `maxWidth`/`maxHeight` ceiling the engine asked
 * for (7680×4320) instead of the display's 3024×1964. Everything sized from that report
 * came out wrong — a full-display take pillarboxed into 2560×1440, and an area cropped at
 * five times its real offset, so the file showed a corner of the selection on black.
 *
 * A playing `<video>` knows the real size (`videoWidth`/`videoHeight`, set before `play()`
 * resolves), and it is the same size `drawImage` crops from. The report is the fallback
 * for an element that cannot tell (jsdom, a track that never plays).
 *
 * `play()` only settles once the track has a frame, and a track that never delivers one
 * (source gone, permission half-granted) leaves it pending: the wait is capped at
 * `timeoutMs` so the take starts on the reported size instead of hanging.
 */
export async function measureFrameSize(
  track: MediaStreamTrack,
  fallback: Size,
  timeoutMs = FRAME_SIZE_TIMEOUT_MS,
): Promise<Size> {
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = new MediaStream([track]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      video.play(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("frame size: no frame in time")), timeoutMs);
      }),
    ]);
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      return { width: video.videoWidth, height: video.videoHeight };
    }
  } catch {
    // Fall through to the reported size.
  } finally {
    clearTimeout(timer);
    video.pause();
    video.srcObject = null;
  }
  const reported = track.getSettings();
  return {
    width: reported.width ?? fallback.width,
    height: reported.height ?? fallback.height,
  };
}
