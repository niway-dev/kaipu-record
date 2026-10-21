import { useState } from "react";
import type { PreviewPlayback } from "../use-preview-playback";
import styles from "./preview-stage.module.css";

export function PreviewStage({
  playback,
  mediaUrl,
  slideUrl,
  overlay,
  underlay,
  chrome,
  contentRef,
  expanded = false,
  onFrameSize,
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
}): React.JSX.Element {
  // The content layer is sized from the DECODED frame ratio, not shrink-wrapped around
  // the <video>: with a height cap binding, a shrink-to-fit wrapper keeps its max-content
  // width and ends up wider than the picture, which would misplace the camera box (all
  // of whose geometry is a % of this element) and its scrim. 16:9 until metadata lands.
  const [ratio, setRatio] = useState(16 / 9);
  return (
    <div className={styles.stage}>
      <div
        ref={contentRef}
        className={expanded ? `${styles.content} ${styles.contentExpanded}` : styles.content}
        style={{ "--frame-ratio": ratio } as React.CSSProperties}
      >
        <video
          ref={playback.videoRef}
          className={styles.video}
          src={mediaUrl}
          onTimeUpdate={playback.onVideoTimeUpdate}
          onEnded={playback.onVideoEnded}
          onLoadedMetadata={(event) => {
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
          // Dead in practice — the overlay above is a full-cover sibling that always
          // wins the hit-test, so this click never reaches the video. Kept as a
          // harmless fallback for any future render path without an overlay; the real
          // toggle-on-click now comes from VideoAnnotationLayer's onBackgroundClick.
          onClick={playback.toggle}
        />
        {slideUrl && <img className={styles.slide} src={slideUrl} alt="" draggable={false} />}
        {underlay}
        {overlay}
      </div>
      {chrome}
    </div>
  );
}
