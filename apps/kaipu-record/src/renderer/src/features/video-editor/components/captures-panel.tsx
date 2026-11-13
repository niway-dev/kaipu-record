import { X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
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
  onClose(): void;
}

/**
 * The editor's right column while Captures is open (NIW2-764): it takes the inspector's
 * place, the way the cursor settings do. Lists this video's frame captures, newest first;
 * clicking an image moves the playhead to that moment.
 */
export function CapturesPanel({
  captures,
  loaded,
  onSeek,
  onCaptureFrame,
  captureBusy,
  onClose,
}: CapturesPanelProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
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
          <button
            type="button"
            className={styles.emptyButton}
            disabled={captureBusy}
            onClick={onCaptureFrame}
          >
            {t("captureFrame")}
          </button>
        </div>
      ) : (
        <ul className={styles.list}>
          {captures.map((capture) => (
            <CaptureItem
              key={capture.assetId}
              capture={capture}
              imageLabel={
                capture.sourceTimeSeconds === null
                  ? capture.title
                  : t("captureSeek", { time: formatClock(capture.sourceTimeSeconds) })
              }
              onImageClick={
                capture.sourceTimeSeconds === null
                  ? undefined
                  : () => onSeek(capture.sourceTimeSeconds as number)
              }
            />
          ))}
        </ul>
      )}
    </aside>
  );
}
