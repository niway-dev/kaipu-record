import React, { useState } from "react";
import { VideoOff } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./recording-player.module.css";

/** Playable URL for a vault recording, served by the main-process media protocol. */
const mediaUrl = (id: string): string => `kaipu-media://recording/${encodeURIComponent(id)}`;

interface RecordingPlayerProps {
  id: string;
  poster?: string | null;
}

/**
 * The recording's video surface. Falls back to an "unavailable" panel if the
 * media protocol can't serve the file (deleted on disk, codec error, etc.).
 */
export function RecordingPlayer({ id, poster }: RecordingPlayerProps): React.JSX.Element {
  const t = useTranslations("library");
  const [playable, setPlayable] = useState(true);
  return (
    <div className={styles.player}>
      {playable ? (
        <video
          className={styles.video}
          src={mediaUrl(id)}
          poster={poster ?? undefined}
          controls
          autoPlay
          onError={() => setPlayable(false)}
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
