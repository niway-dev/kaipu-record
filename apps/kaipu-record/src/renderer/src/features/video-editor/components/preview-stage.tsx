import type { PreviewPlayback } from "../use-preview-playback";
import styles from "./preview-stage.module.css";

export function PreviewStage({
  playback,
  mediaUrl,
  overlay,
}: {
  playback: PreviewPlayback;
  mediaUrl: string;
  /** The annotation layer — rendered as a sibling of <video> inside this component's
   *  position:relative wrapper, which (per preview-stage.module.css) shrinks to
   *  exactly the video's own rendered box, so the overlay covers it exactly. */
  overlay?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.stage}>
      <video
        ref={playback.videoRef}
        className={styles.video}
        src={mediaUrl}
        onTimeUpdate={playback.onVideoTimeUpdate}
        onEnded={playback.onVideoEnded}
        // Dead in practice — the overlay above is a full-cover sibling that always
        // wins the hit-test, so this click never reaches the video. Kept as a
        // harmless fallback for any future render path without an overlay; the real
        // toggle-on-click now comes from VideoAnnotationLayer's onBackgroundClick.
        onClick={playback.toggle}
      />
      {overlay}
    </div>
  );
}
