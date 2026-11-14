import { Camera, X } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { reportError } from "@renderer/features/analytics";
import { DeleteConfirmDialog } from "@renderer/features/library/components/delete-confirm-dialog";
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
  onCaptureFrame(): void;
  captureBusy: boolean;
  /** Delete one capture from the library (called only after the user confirms). */
  onDelete(capture: LibraryVideo): Promise<void>;
  /** The capture that already exists at the playhead: outlined and scrolled into view. */
  highlightedId?: string | null;
  onClose(): void;
}

/**
 * The editor's right column while Captures is open (NIW2-764): it takes the inspector's
 * place, the way the cursor settings do. Lists this video's frame captures, newest first;
 * its Go to button moves the playhead to that moment.
 */
export function CapturesPanel({
  captures,
  loaded,
  onSeek,
  onCaptureFrame,
  captureBusy,
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
        <div className={styles.headerActions}>
          {/* Disabled until the first read lands: the duplicate check needs the real list. */}
          <button
            type="button"
            className={styles.captureButton}
            disabled={captureBusy || !loaded}
            onClick={onCaptureFrame}
          >
            <Camera size={14} />
            {t("captureFrame")}
          </button>
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
