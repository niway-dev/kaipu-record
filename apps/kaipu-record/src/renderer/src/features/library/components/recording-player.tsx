import React, { useLayoutEffect, useRef, useState } from "react";
import { VideoOff } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./recording-player.module.css";
import { mediaUrl } from "@shared/media-url";

interface RecordingPlayerProps {
  id: string;
  poster?: string | null;
}

/**
 * The recording's video surface. Falls back to an "unavailable" panel if the
 * media protocol can't serve the file (deleted on disk, codec error, etc.).
 *
 * NIW2-560: a rename moves the file, so `id` (and the `src`) can change under a mounted
 * player. The element reloads; the playback position and paused state are carried over.
 */
export function RecordingPlayer({ id, poster }: RecordingPlayerProps): React.JSX.Element {
  const t = useTranslations("library");
  const [playable, setPlayable] = useState(true);
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
    if (!restoring.current) return;
    restoring.current = false;
    const video = event.currentTarget;
    video.currentTime = position.current.time;
    if (position.current.paused) video.pause();
  };

  return (
    <div className={styles.player}>
      {playable ? (
        <video
          className={styles.video}
          src={mediaUrl("recording", id)}
          poster={poster ?? undefined}
          controls
          autoPlay
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
      ) : (
        <div className={styles.unavailable}>
          <VideoOff size={32} strokeWidth={1.5} />
          <span>{t("videoUnavailable")}</span>
        </div>
      )}
    </div>
  );
}
