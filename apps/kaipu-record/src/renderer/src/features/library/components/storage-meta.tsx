import { AlertTriangle } from "lucide-react";
import type { LibraryVideo } from "@renderer/features/library/types";
import { relativeDate } from "@renderer/features/library/format";
import styles from "./storage-meta.module.css";

/**
 * The single status line shared by the card and row: a transient upload state
 * (uploading / failed) or a storage dot + relative time. Keeping it in one place
 * stops the card and row drifting apart.
 */
export function StorageMeta({ video }: { video: LibraryVideo }): React.JSX.Element {
  if (video.storage === "failed") {
    return (
      <span className={styles.failed}>
        <AlertTriangle size={12} strokeWidth={2} />
        Upload failed
      </span>
    );
  }

  if (video.storage === "uploading") {
    const pct = Math.round(video.processingProgress ?? 0);
    return (
      <span className={styles.uploading}>
        <span className={styles.pulse} />
        Uploading{pct > 0 ? ` ${pct}%` : "…"}
      </span>
    );
  }

  return (
    <span className={styles.stored}>
      <span className={styles.dot} data-state={video.storage} />
      {relativeDate(video.createdAt)}
    </span>
  );
}
