import type { PreviewPlayback } from "../use-preview-playback";
import styles from "./preview-stage.module.css";

export function PreviewStage({
  playback,
  mediaUrl,
  slideUrl,
  overlay,
  expanded = false,
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
  /** In fullscreen the bounded (contained-player) size caps are lifted so the video
   *  fills the screen. Off by default — normal editing keeps the compact player. */
  expanded?: boolean;
}): React.JSX.Element {
  return (
    <div className={styles.stage}>
      <video
        ref={playback.videoRef}
        className={expanded ? `${styles.video} ${styles.videoExpanded}` : styles.video}
        src={mediaUrl}
        onTimeUpdate={playback.onVideoTimeUpdate}
        onEnded={playback.onVideoEnded}
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
      {overlay}
    </div>
  );
}
