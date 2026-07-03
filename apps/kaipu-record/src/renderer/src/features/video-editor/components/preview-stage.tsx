import type { PreviewPlayback } from "../use-preview-playback";
import styles from "./preview-stage.module.css";

export function PreviewStage({
  playback,
  mediaUrl,
}: {
  playback: PreviewPlayback;
  mediaUrl: string;
}): React.JSX.Element {
  return (
    <div className={styles.stage}>
      <video
        ref={playback.videoRef}
        className={styles.video}
        src={mediaUrl}
        onTimeUpdate={playback.onVideoTimeUpdate}
        onEnded={playback.onVideoEnded}
        onClick={playback.toggle}
      />
    </div>
  );
}
