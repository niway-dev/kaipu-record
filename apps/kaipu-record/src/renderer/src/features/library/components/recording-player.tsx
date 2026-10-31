import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { VideoOff } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { WebcamPlaybackLayer } from "@renderer/features/video-editor/components/webcam-layer";
import type { FrameSize } from "@renderer/features/video-editor/webcam/webcam-layout";
import { seedWebcamScene } from "@renderer/features/video-editor/webcam/webcam-model";
import styles from "./recording-player.module.css";
import { mediaUrl } from "@renderer/lib/media-url";

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
   * The take's webcam track (ADR 0037), when its file exists: the face is drawn over the
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
 *
 * NIW2-560: a rename moves the file, so `id` (and the `src`) can change under a mounted
 * player. The element reloads; the playback position and paused state are carried over.
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
  // Where the viewer was, from the element's own events.
  const position = useRef({ time: 0, paused: false });
  // Set when `id` changed: the reload's own events (time 0, autoplay) must not overwrite
  // the position until it has been restored.
  const restoring = useRef(false);
  const mountedId = useRef(id);
  // Layout effect: runs before the reload's events are dispatched.
  useLayoutEffect(() => {
    if (mountedId.current === id) return;
    mountedId.current = id;
    restoring.current = true;
  }, [id]);

  const onLoadedMetadata = (event: React.SyntheticEvent<HTMLVideoElement>): void => {
    const video = event.currentTarget;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setFrame({ width: video.videoWidth, height: video.videoHeight });
    }
    if (!restoring.current) return;
    restoring.current = false;
    video.currentTime = position.current.time;
    if (position.current.paused) video.pause();
  };

  return (
    <div className={styles.player}>
      {playable ? (
        <>
          <video
            ref={videoRef}
            className={styles.video}
            src={mediaUrl("recording", id)}
            poster={poster ?? undefined}
            controls
            autoPlay
            data-testid="recording-video"
            onError={() => setPlayable(false)}
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={(event) => {
              if (!restoring.current) position.current.time = event.currentTarget.currentTime;
            }}
            onPlay={() => {
              if (!restoring.current) position.current.paused = false;
            }}
            onPause={() => {
              if (!restoring.current) position.current.paused = true;
            }}
          />
          {webcam && scene && frame && (
            <div className={styles.picture} style={pictureBox(frame)}>
              <WebcamPlaybackLayer
                videoRef={videoRef}
                src={mediaUrl("webcam", id)}
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
