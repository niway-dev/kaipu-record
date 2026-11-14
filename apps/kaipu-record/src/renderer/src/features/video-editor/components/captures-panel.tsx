import { X } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { reportError } from "@renderer/features/analytics";
import { DeleteConfirmDialog } from "@renderer/features/library/components/delete-confirm-dialog";
import { notifyVaultRefusal } from "@renderer/features/library/vault-errors";
import type { LibraryVideo } from "@renderer/features/library/types";
import { uiArea } from "@renderer/lib/ui-area";
import { formatClock } from "../capture-time";
import { CaptureItem } from "./capture-item";
import styles from "./captures-panel.module.css";

export interface CapturesPanelProps {
  /** This video's captures, newest first. */
  captures: LibraryVideo[];
  /** False until the first read lands: nothing is said about "no captures" before that. */
  loaded: boolean;
  /** Seek the playhead to a capture's source time. */
  onSeek(sourceSeconds: number): void;
  /** Insert a capture's image into the timeline as an image slide. */
  onAddToTimeline(capture: LibraryVideo): void;
  /** Delete one capture from the library (called only after the user confirms). */
  onDelete(capture: LibraryVideo): Promise<void>;
  /** The capture that already exists at the playhead: outlined and scrolled into view. */
  highlightedId?: string | null;
  onClose(): void;
}

/**
 * The editor's right column while Captures is open (NIW2-764): it takes the inspector's
 * place, the way the cursor settings do. Lists this video's frame captures, newest first.
 * Capture frame itself is in the top bar. Hovering a capture's image shows a Go to button
 * that moves the playhead to that moment; each row can add the image to the timeline.
 */
export function CapturesPanel({
  captures,
  loaded,
  onSeek,
  onAddToTimeline,
  onDelete,
  highlightedId = null,
  onClose,
}: CapturesPanelProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const tLibrary = useTranslations("library");
  const [pendingDelete, setPendingDelete] = useState<LibraryVideo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete || deleting) return;
    const target = pendingDelete;
    setDeleting(true);
    try {
      await onDelete(target);
    } catch (error) {
      // Files being fixed, or a read-only record: a plain notice, as the Library's delete gives.
      if (notifyVaultRefusal(error, tLibrary)) return;
      reportError(tLibrary("errorDelete"), error, {
        context: { id: target.id, phase: "delete-capture" },
      });
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };
  const empty = loaded && captures.length === 0;
  return (
    <aside
      {...uiArea("editorVideo.capturesPanel")}
      className={styles.panel}
      aria-label={t("capturesTitle")}
      data-testid="captures-panel"
    >
      <div className={styles.header}>
        <h2 className={styles.title}>{t("capturesTitle")}</h2>
        <button
          type="button"
          className={styles.close}
          aria-label={t("capturesClose")}
          title={t("capturesClose")}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      {empty ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>{t("capturesEmpty")}</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {captures.map((capture) => (
            <CaptureItem
              key={capture.assetId}
              capture={capture}
              imageLabel={capture.title}
              highlighted={capture.assetId === highlightedId}
              // A slide frame has no second in the video: no Go to for it.
              onSeek={
                capture.sourceTimeSeconds === null
                  ? undefined
                  : () => onSeek(capture.sourceTimeSeconds as number)
              }
              seekLabel={
                capture.sourceTimeSeconds === null
                  ? undefined
                  : t("captureSeek", { time: formatClock(capture.sourceTimeSeconds) })
              }
              onAddToTimeline={() => onAddToTimeline(capture)}
              addToTimelineLabel={t("captureAddToTimeline")}
              onDelete={() => setPendingDelete(capture)}
              deleteLabel={t("captureDelete")}
            />
          ))}
        </ul>
      )}
      {pendingDelete && (
        <DeleteConfirmDialog
          title={pendingDelete.title}
          isDeleting={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </aside>
  );
}
