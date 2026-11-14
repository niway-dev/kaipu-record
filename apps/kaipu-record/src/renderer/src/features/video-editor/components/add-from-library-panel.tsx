import { Film, Info, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { absoluteDate, formatDuration } from "@renderer/features/library/format";
import type { LibraryVideo } from "@renderer/features/library/types";
import { joinableRecordings, RECORDING_DRAG_MIME, resolutionLabel } from "../add-from-library";
import styles from "./add-from-library-panel.module.css";

export interface AddFromLibraryPanelProps {
  /** Every item the Library holds: the panel keeps the recordings it can join. */
  videos: LibraryVideo[];
  /** The recording being edited, which is never offered. */
  openedAssetId: string;
  /** False until the first read lands: nothing is said about "no recordings" before that. */
  loaded: boolean;
  /** Add this recording to the sequence (a click on its row). */
  onAdd(video: LibraryVideo): void;
  /** A row started to be dragged: the browser hides a drag's contents until the drop, so the
   *  page keeps which recording it is for the timeline's drop to read. */
  onDragStart?(video: LibraryVideo): void;
  /** The drag ended, dropped on the sequence or cancelled. */
  onDragEnd?(): void;
  onClose(): void;
}

/**
 * The editor's right column while Add recording is open (NIW2-782): like Captures, it takes the
 * inspector's place. It lists the Library's other recordings, newest first, with a search field.
 * A row adds the whole recording at the clip boundary nearest the playhead.
 */
export function AddFromLibraryPanel({
  videos,
  openedAssetId,
  loaded,
  onAdd,
  onDragStart,
  onDragEnd,
  onClose,
}: AddFromLibraryPanelProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  // The unfiltered list decides which empty state to show: a query over nothing is still
  // "no other recordings".
  const all = useMemo(() => joinableRecordings(videos, openedAssetId, ""), [videos, openedAssetId]);
  const shown = useMemo(
    () => joinableRecordings(videos, openedAssetId, query),
    [videos, openedAssetId, query],
  );
  return (
    <aside
      className={styles.panel}
      aria-label={t("addFromLibraryTitle")}
      data-testid="add-from-library-panel"
    >
      <div className={styles.header}>
        <h2 className={styles.title}>{t("addFromLibraryTitle")}</h2>
        <button
          type="button"
          className={styles.close}
          aria-label={t("addFromLibraryClose")}
          title={t("addFromLibraryClose")}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <label className={styles.search}>
        <Search size={14} aria-hidden className={styles.searchIcon} />
        <input
          type="search"
          className={styles.searchInput}
          value={query}
          aria-label={t("addFromLibrarySearch")}
          placeholder={t("addFromLibrarySearch")}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {!loaded ? (
        <p className={styles.note}>{t("addFromLibraryLoading")}</p>
      ) : shown.length === 0 ? (
        <p className={styles.note}>
          {all.length === 0 ? t("addFromLibraryEmpty") : t("addFromLibraryNoMatch")}
        </p>
      ) : (
        <ul className={styles.list}>
          {shown.map((video) => {
            const resolution = resolutionLabel(video);
            return (
              <li key={video.assetId} className={styles.item}>
                <button
                  type="button"
                  className={styles.row}
                  data-testid="add-from-library-row"
                  aria-label={t("addFromLibraryRow", { title: video.title })}
                  title={t("addFromLibraryRow", { title: video.title })}
                  onClick={() => onAdd(video)}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(RECORDING_DRAG_MIME, video.assetId);
                    event.dataTransfer.effectAllowed = "copy";
                    // The row itself is the drag image, held where the user grabbed it.
                    const box = event.currentTarget.getBoundingClientRect();
                    event.dataTransfer.setDragImage(
                      event.currentTarget,
                      event.clientX - box.left,
                      event.clientY - box.top,
                    );
                    onDragStart?.(video);
                  }}
                  onDragEnd={() => onDragEnd?.()}
                >
                  <span className={styles.thumb}>
                    {video.thumbnailUrl ? (
                      <img className={styles.thumbImage} src={video.thumbnailUrl} alt="" />
                    ) : (
                      <span
                        className={styles.placeholder}
                        data-testid="add-from-library-placeholder"
                      >
                        <Film size={16} aria-hidden />
                      </span>
                    )}
                    <span className={styles.duration}>{formatDuration(video.durationSeconds)}</span>
                  </span>
                  <span className={styles.text}>
                    <span className={styles.name}>{video.title}</span>
                    <span className={styles.meta}>{absoluteDate(video.createdAt, locale)}</span>
                    {resolution && <span className={styles.meta}>{resolution}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.hint}>
        <Info size={12} aria-hidden className={styles.hintIcon} />
        {t("addFromLibraryHint")}
      </p>
    </aside>
  );
}
