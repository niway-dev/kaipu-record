import React, { useMemo, useRef, useState } from "react";
import { VideoOff } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { WebcamPlaybackLayer } from "@renderer/features/video-editor/components/webcam-layer";
import type { FrameSize } from "@renderer/features/video-editor/webcam/webcam-layout";
import { seedWebcamScene } from "@renderer/features/video-editor/webcam/webcam-model";
import styles from "./recording-player.module.css";

/** Playable URL for a vault recording, served by the main-process media protocol. */
const mediaUrl = (id: string): string => `kaipu-media://recording/${encodeURIComponent(id)}`;

/** `.player`'s aspect-ratio in recording-player.module.css; the two must agree. */
const PLAYER_RATIO = 16 / 9;

/**
 * Where the picture sits inside the 16:9 player (`object-fit: contain` letterboxes or
 * pillarboxes anything else), as percentages of the player: the webcam layer is placed in
 * the picture's own frame, so it has to cover exactly that rectangle.
 */
export function pictureBox(frame: FrameSize): { width: string; height: string } {
  const ratio = frame.width / frame.height;
  const width = Math.min(1, ratio / PLAYER_RATIO);
  const height = Math.min(1, PLAYER_RATIO / ratio);
  return { width: `${width * 100}%`, height: `${height * 100}%` };
}

interface RecordingPlayerProps {
  id: string;
  poster?: string | null;
  /**
   * The take's webcam track (ADR 0032), when its file exists: the face is drawn over the
   * screen where the bubble was while recording, and hidden while the camera was off, so the
   * original reads as what was captured. The files on disk stay as they are (ADR 0003).
   */
  webcam?: WebcamTrackMeta | null;
  /** The recording's length, so a camera-off stretch at the very end stays inside it. */
  durationSeconds?: number;
}

/**
 * The recording's video surface. Falls back to an "unavailable" panel if the
 * media protocol can't serve the file (deleted on disk, codec error, etc.).
 */
export function RecordingPlayer({
  id,
  poster,
  webcam,
  durationSeconds,
}: RecordingPlayerProps): React.JSX.Element {
  const t = useTranslations("library");
  const [playable, setPlayable] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The decoded frame, as state: the layer's geometry is relative to it, and it is unknown
  // until metadata lands (the layer waits for it).
  const [frame, setFrame] = useState<FrameSize | null>(null);
  const scene = useMemo(
    () => seedWebcamScene(webcam, durationSeconds || undefined),
    [webcam, durationSeconds],
  );
  return (
    <div className={styles.player}>
      {playable ? (
        <>
          <video
            ref={videoRef}
            className={styles.video}
            src={mediaUrl(id)}
            poster={poster ?? undefined}
            controls
            autoPlay
            data-testid="recording-video"
            onLoadedMetadata={(event) => {
              const { videoWidth, videoHeight } = event.currentTarget;
              if (videoWidth > 0 && videoHeight > 0) {
                setFrame({ width: videoWidth, height: videoHeight });
              }
            }}
            onError={() => setPlayable(false)}
          />
          {webcam && scene && frame && (
            <div className={styles.picture} style={pictureBox(frame)}>
              <WebcamPlaybackLayer
                videoRef={videoRef}
                src={`kaipu-media://webcam/${encodeURIComponent(id)}`}
                startOffsetMs={webcam.startOffsetMs}
                webcam={scene}
                frame={frame}
              />
            </div>
          )}
        </>
      ) : (
        <div className={styles.unavailable}>
          <VideoOff size={32} strokeWidth={1.5} />
          <span>{t("videoUnavailable")}</span>
        </div>
      )}
    </div>
  );
}
