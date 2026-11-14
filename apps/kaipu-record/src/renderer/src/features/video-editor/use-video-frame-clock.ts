/**
 * Calls `onTime(sourceSeconds)` for every presented video frame and after every seek,
 * WITHOUT re-rendering React. Preview layers that depend on source time (camera
 * transform, redaction visibility, camera box) write to the DOM from this callback.
 *
 * `requestVideoFrameCallback` gives the exact media time of the frame on screen, so the
 * camera and redactions change on the same frame the picture does — a redaction that
 * appeared one rAF late would flash the secret. `seeked`/`timeupdate` cover paused
 * scrubbing and environments without rVFC (jsdom).
 *
 * Two effects on purpose. The subscription depends only on the element: `onTime` is held
 * in a ref (it is a new closure on every render) and `trigger` is NOT a dependency of
 * it. If it were, a camera-box drag — which produces a new camera path per pointermove —
 * would cancel and re-request the frame callback dozens of times a second, and a
 * cancel/request pair straddling a presented frame simply loses that frame. The second
 * effect is the whole point of `trigger`: re-apply the CURRENT callback at once, so a
 * new path reaches the DOM without waiting for the next frame.
 */
import { useEffect, useRef } from "react";
import type { FrameSource } from "./playback-media";

export function useVideoFrameClock(
  /** A `<video>`, or the preview's `MediaSwitch`: either way `currentTime` and `mediaTime` are
   *  AXIS seconds (ADR 0058), and the switch drops frames of a recording that is not on screen. */
  videoRef: React.RefObject<FrameSource | null>,
  onTime: (sourceSeconds: number) => void,
  /** Re-run the callback immediately when this value changes (e.g. a new camera path). */
  trigger?: unknown,
): void {
  const callback = useRef(onTime);
  callback.current = onTime;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    callback.current(video.currentTime);
    let stopped = false;
    let handle = 0;
    const request = video.requestVideoFrameCallback?.bind(video);
    const cancel = video.cancelVideoFrameCallback?.bind(video);
    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (stopped) return;
      callback.current(metadata.mediaTime);
      handle = request!(onFrame);
    };
    if (request) handle = request(onFrame);
    const onSeek = (): void => callback.current(video.currentTime);
    video.addEventListener("seeked", onSeek);
    video.addEventListener("timeupdate", onSeek);
    // A switch of recording moves the picture, the cursor and the webcam to other data with
    // no seek on a paused preview (a primed element only starts showing): apply at once.
    const stopWatching = video.onActiveChange?.(onSeek);
    return () => {
      stopped = true;
      if (cancel) cancel(handle);
      video.removeEventListener("seeked", onSeek);
      video.removeEventListener("timeupdate", onSeek);
      stopWatching?.();
    };
  }, [videoRef]);

  // Live updates land here, not in the subscription above: same loop, fresh callback.
  useEffect(() => {
    const video = videoRef.current;
    if (video) callback.current(video.currentTime);
  }, [videoRef, trigger]);
}
