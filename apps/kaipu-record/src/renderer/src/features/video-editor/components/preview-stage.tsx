import { useLayoutEffect, useRef, useState } from "react";
import { DEFAULT_BACKGROUND, type VideoBackground } from "../background";
import type { PreviewPlayback } from "../use-preview-playback";
import { previewBackgroundStyle } from "./preview-background";
import styles from "./preview-stage.module.css";

export function PreviewStage({
  playback,
  mediaUrl,
  slideUrl,
  overlay,
  underlay,
  webcam,
  cursor,
  chrome,
  contentRef,
  expanded = false,
  onFrameSize,
  background = DEFAULT_BACKGROUND,
}: {
  playback: PreviewPlayback;
  mediaUrl: string;
  /** Image of the slide under the playhead, or null when the playhead is on a clip.
   *  When set, it covers the video (which is paused underneath) so the slide reads as
   *  its own frame; the annotation layer still renders on top. */
  slideUrl?: string | null;
  /** The annotation layer — rendered as a sibling of <video> inside this component's
   *  position:relative wrapper, which (per preview-stage.module.css) shrinks to
   *  exactly the video's own rendered box, so the overlay covers it exactly. */
  overlay?: React.ReactNode;
  /** Privacy regions (video-editor v2): inside the content layer, UNDER the annotations,
   *  so they zoom with the footage — export order frame → redactions → overlays → crop. */
  underlay?: React.ReactNode;
  /** The webcam layer (ADR 0038): a third kind of layer, ABOVE the content and below the
   *  chrome, and like the chrome never transformed by the camera path — so with a zoom
   *  active the face stays in its corner instead of being cropped away with the frame. */
  webcam?: React.ReactNode;
  cursor?: React.ReactNode;
  /** Stage-level UI that must NOT zoom: camera box, hold-to-compare button and chip. */
  chrome?: React.ReactNode;
  /** The content layer (video + slide + underlay + overlay); the camera transform is
   *  written to it per frame by useCameraPreview. */
  contentRef?: React.Ref<HTMLDivElement>;
  /** In fullscreen the bounded (contained-player) size caps are lifted so the video
   *  fills the screen. Off by default — normal editing keeps the compact player. */
  expanded?: boolean;
  /** Decoded frame size, reported once metadata lands. The <video> element's own
   *  `videoWidth`/`videoHeight` are not reactive — reading them off the ref during a
   *  render gives whatever happened to be true at that render and never schedules
   *  another — so anything that needs them as state has to receive them here. */
  onFrameSize?: (size: { width: number; height: number }) => void;
  /** The background around the picture (ADR 0051). With `none` the picture fills the frame
   *  and nothing here draws; with a preset the frame is painted with it and the picture is
   *  inset, rounded and shadowed by the very numbers the export's composer draws with. */
  background?: VideoBackground;
}): React.JSX.Element {
  // The frame is sized from the DECODED frame ratio, not shrink-wrapped around the <video>:
  // with a height cap binding, a shrink-to-fit wrapper keeps its max-content width and ends
  // up wider than the picture, which would misplace the camera box (all of whose geometry is
  // a % of the picture) and its scrim. 16:9 until metadata lands.
  const [ratio, setRatio] = useState(16 / 9);
  // The frame's displayed size, in px: the background's padding, radius and shadow are
  // expressed at a 1080 px-high output and scaled to it (`previewBackgroundStyle`), exactly as
  // the export scales them to its own output. Read before paint, so a restored background
  // never flashes full-bleed.
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = (): void =>
      setFrameSize((previous) => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        return previous && previous.w === w && previous.h === h ? previous : { w, h };
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const look = previewBackgroundStyle(background, frameSize?.w ?? 0, frameSize?.h ?? 0);
  return (
    <div className={styles.stage}>
      {/* The frame is the output: ratio-exact, and the preset's paint when one is set. The
          picture inside it is the whole frame with `none`, or inset by the padding. Every
          layer of the footage — video, slide, privacy regions, annotations, the cursor, the
          webcam and the stage chrome — is inside the picture, so a zoom is clipped by it and
          never reaches the padding, and the camera box and the webcam are laid out against the
          picture, not the frame. The ambient glow lives behind all of it, on the video region. */}
      <div
        ref={frameRef}
        data-testid="preview-frame"
        className={expanded ? `${styles.frame} ${styles.frameExpanded}` : styles.frame}
        style={{ "--frame-ratio": ratio, ...look.frame } as React.CSSProperties}
      >
        <div data-testid="preview-picture" className={styles.picture} style={look.picture}>
          <div ref={contentRef} data-testid="preview-content" className={styles.content}>
            <video
              ref={playback.videoRef}
              className={styles.video}
              src={mediaUrl}
              onTimeUpdate={playback.onVideoTimeUpdate}
              onEnded={playback.onVideoEnded}
              onLoadedMetadata={(event) => {
                // A new `src` resets the element's rate: put the chosen speed back first,
                // whatever the decoded size says.
                playback.onVideoLoadedMetadata();
                const { videoWidth, videoHeight } = event.currentTarget;
                if (videoWidth > 0 && videoHeight > 0) {
                  setRatio(videoWidth / videoHeight);
                  onFrameSize?.({ width: videoWidth, height: videoHeight });
                }
              }}
              // Keep `playing` in sync with what the element actually does — a rejected play()
              // (e.g. interrupted by a seek) leaves it paused, and these events stop the
              // transport from getting stuck showing "pause" while nothing plays.
              onPlay={playback.onVideoPlay}
              onPause={playback.onVideoPause}
              // No onClick: a click on the picture does not toggle playback. The play
              // button and Space do (NIW2-611).
            />
            {slideUrl && <img className={styles.slide} src={slideUrl} alt="" draggable={false} />}
            {underlay}
            {overlay}
          </div>
          {cursor}
          {webcam}
          {chrome}
        </div>
      </div>
    </div>
  );
}
