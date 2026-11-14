import { Copy, LocateFixed, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslations } from "@kaipu/i18n";
import { reportError } from "@renderer/features/analytics";
import type { LibraryVideo } from "@renderer/features/library/types";
import { showToast } from "@renderer/ui/toast-store";
import { formatClock } from "../capture-time";
import styles from "./capture-item.module.css";

export interface CaptureItemProps {
  capture: LibraryVideo;
  /** Accessible name of the image when it is a button (what clicking it does). */
  imageLabel: string;
  /** Click on the image; without it the image is not interactive. */
  onImageClick?: () => void;
  /** The editor's Go to button: shown when given (a capture with a time in the video). */
  onSeek?: () => void;
  /** Accessible name of the Go to button. */
  seekLabel?: string;
  /** The editor's Delete button: shown when given (the caller confirms). */
  onDelete?: () => void;
  /** Accessible name of the Delete button. */
  deleteLabel?: string;
  /** Outline the item and scroll it into view (the capture that already exists). */
  highlighted?: boolean;
}

/**
 * One frame capture (NIW2-764): the image at the column's width in its own aspect ratio,
 * the second of the video it came from, and a Copy button that puts the image on the
 * clipboard. Shared by the editor's Captures panel and the video's Library page.
 */
export function CaptureItem({
  capture,
  imageLabel,
  onImageClick,
  onSeek,
  seekLabel,
  onDelete,
  deleteLabel,
  highlighted = false,
}: CaptureItemProps): React.JSX.Element {
  const t = useTranslations("library");
  const localId = capture.id;
  const itemRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    // jsdom has no scrollIntoView.
    if (highlighted) itemRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [highlighted]);

  const copy = async (): Promise<void> => {
    if (!localId) return;
    try {
      // Main reads the vault file by id: fetch on the media scheme returns no bytes here.
      await window.electronAPI.copyScreenshotById(localId);
      showToast({ message: t("copyImageDone") });
    } catch (error) {
      reportError(t("copyError"), error, {
        context: { id: localId, phase: "copy-capture" },
        retry: () => void copy(),
      });
    }
  };

  const image = capture.thumbnailUrl ? (
    <img
      className={styles.image}
      src={capture.thumbnailUrl}
      // Inside the labeled button the button names it; on its own the image names itself.
      alt={onImageClick ? "" : imageLabel}
      draggable={false}
    />
  ) : (
    <span className={styles.missing} aria-hidden />
  );

  return (
    <li
      ref={itemRef}
      className={styles.item}
      data-testid="capture-item"
      data-highlighted={highlighted ? "true" : undefined}
    >
      {onImageClick ? (
        <button
          type="button"
          className={styles.imageButton}
          aria-label={imageLabel}
          title={imageLabel}
          onClick={onImageClick}
        >
          {image}
        </button>
      ) : (
        <div className={styles.imageFrame}>{image}</div>
      )}
      <div className={styles.meta}>
        {capture.sourceTimeSeconds !== null && (
          <span className={styles.time}>{formatClock(capture.sourceTimeSeconds)}</span>
        )}
        <span className={styles.actions}>
          {onSeek && (
            <button
              type="button"
              className={styles.copy}
              aria-label={seekLabel}
              title={seekLabel}
              onClick={onSeek}
            >
              <LocateFixed size={14} />
            </button>
          )}
          <button
            type="button"
            className={styles.copy}
            aria-label={t("copyImage")}
            title={t("copyImage")}
            disabled={!localId}
            onClick={() => void copy()}
          >
            <Copy size={14} />
          </button>
          {onDelete && (
            <button
              type="button"
              className={styles.copy}
              aria-label={deleteLabel}
              title={deleteLabel}
              disabled={!localId}
              onClick={onDelete}
            >
              <Trash2 size={14} />
            </button>
          )}
        </span>
      </div>
    </li>
  );
}
