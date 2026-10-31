import { Check, Film, FolderOpen, GripVertical, X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatDuration, formatSize } from "@renderer/features/library/format";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { DestinationId } from "@renderer/features/prepare/destinations";
import { DestinationTag } from "@renderer/features/prepare/components/destination-tag";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import type { ReadyCopy } from "@renderer/features/video-editor/export/ready-copies";
import styles from "./ready-copy-card.module.css";

interface ReadyCopyCardProps {
  video: LibraryVideo;
  /** What the export runner knew about the copy: its output size. */
  copy: ReadyCopy;
  /** Where the copy is going; null for an editor export. */
  destination: DestinationId | null;
  onOpen(): void;
  onDismiss(): void;
}

/**
 * "Ready to upload": a copy that just finished, leading the Library grid across two columns
 * so the result of a background export is impossible to miss. Its poster carries the
 * destination, the mono line says what the file is, and the two actions get it out of Kaipu —
 * Show in Finder, or a native drag of the real file into the upload page.
 */
export function ReadyCopyCard({
  video,
  copy,
  destination,
  onOpen,
  onDismiss,
}: ReadyCopyCardProps): React.JSX.Element {
  const t = useTranslations("backgroundCopy");
  const tLibrary = useTranslations("library");
  const tEditor = useTranslations("videoEditor");
  const title = video.title || tLibrary("untitled");
  const fileName = `${title}${video.kind === "gif" ? ".gif" : ".mp4"}`;
  const meta = [
    // Spaced like the ready toast's line ("2560 × 1440 · 566 MB").
    copy.width && copy.height ? `${copy.width} × ${copy.height}` : null,
    video.durationSeconds > 0 ? formatDuration(video.durationSeconds) : null,
    formatSize(video.fileSizeBytes),
    video.derivedFromAssetId ? t("fromOriginal") : null,
  ].filter((part) => part !== null);
  const localId = video.id;

  return (
    <article className={styles.card} aria-label={t("readyCardLabel", { name: title })}>
      <button type="button" className={styles.poster} onClick={onOpen} aria-label={title}>
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt="" className={styles.posterImage} />
        ) : (
          <span className={styles.posterFallback} aria-hidden>
            <Film size={26} strokeWidth={1.5} />
          </span>
        )}
        {destination && (
          <span className={styles.tag}>
            <DestinationTag destination={destination} />
          </span>
        )}
      </button>

      <div className={styles.body}>
        <div className={styles.status}>
          <Check size={14} strokeWidth={2.4} aria-hidden />
          {t("readyToUpload")}
        </div>
        <button type="button" className={styles.fileName} onClick={onOpen} title={fileName}>
          {fileName}
        </button>
        <p className={styles.meta}>{meta.join(" · ")}</p>
        {localId !== null && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              data-variant="primary"
              onClick={() => void window.electronAPI.revealLocalRecording(localId)}
            >
              <FolderOpen size={14} strokeWidth={1.8} aria-hidden />
              {tEditor(isWindowsHost() ? "exportShowInFinderWindows" : "exportShowInFinder")}
            </button>
            <button
              type="button"
              className={styles.button}
              draggable
              aria-label={t("readyDragLabel", { name: fileName })}
              onDragStart={(e) => {
                // Main runs a native drag (a real file), so the browser's own drag never starts.
                e.preventDefault();
                window.electronAPI.startFileDrag(localId, video.title);
              }}
            >
              <GripVertical size={14} strokeWidth={1.8} aria-hidden />
              {t("dragTo", { destination: destination ?? "other" })}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className={styles.dismiss}
        aria-label={t("readyCardClose")}
        onClick={onDismiss}
      >
        <X size={14} strokeWidth={1.8} />
      </button>
    </article>
  );
}
