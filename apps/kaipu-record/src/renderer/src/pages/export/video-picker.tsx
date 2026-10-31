import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Film } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatDuration } from "@renderer/features/library/format";
import { isMaster } from "@renderer/features/library/lineage";
import type { LibraryVideo } from "@renderer/features/library/types";
import { asPreparable } from "@renderer/features/prepare/use-prepare-copy";
import { formatMB } from "@renderer/features/video-editor/export/export-size";
import styles from "./video-picker.module.css";

/** The Library's originals a copy can be exported from, newest first. */
export function exportableVideos(videos: readonly LibraryVideo[]): LibraryVideo[] {
  return videos
    .filter((v) => asPreparable(v) !== null && isMaster(v))
    .sort((a, b) => b.createdAt - a.createdAt);
}

interface VideoPickerProps {
  videos: readonly LibraryVideo[];
  /** The video on screen, marked in the list. */
  currentAssetId?: string;
  onPick(video: LibraryVideo): void;
  /** Renders the button that opens the list. */
  trigger(props: { onClick(): void; "aria-expanded": boolean; "aria-controls": string }): ReactNode;
  align?: "start" | "end" | "center";
}

/**
 * "Change video" and "Pick from Library": the Library's recordings in a list under the button.
 * Escape or a click outside closes it.
 */
export function VideoPicker({
  videos,
  currentAssetId,
  onPick,
  trigger,
  align = "end",
}: VideoPickerProps): React.JSX.Element {
  const t = useTranslations("export");
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = exportableVideos(videos);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={root}>
      {trigger({
        onClick: () => setOpen((o) => !o),
        "aria-expanded": open,
        "aria-controls": id,
      })}
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={t("pickerLabel")}
          className={styles.panel}
          data-align={align}
        >
          {list.length === 0 ? (
            <p className={styles.empty}>{t("pickerEmpty")}</p>
          ) : (
            <ul className={styles.list}>
              {list.map((v) => (
                <li key={v.assetId}>
                  <button
                    type="button"
                    className={styles.item}
                    aria-current={v.assetId === currentAssetId || undefined}
                    onClick={() => {
                      setOpen(false);
                      onPick(v);
                    }}
                  >
                    <span className={styles.thumb}>
                      {v.thumbnailUrl ? (
                        <img src={v.thumbnailUrl} alt="" />
                      ) : (
                        <Film size={14} strokeWidth={1.8} aria-hidden />
                      )}
                    </span>
                    <span className={styles.text}>
                      <span className={styles.title}>{v.title}</span>
                      <span className={styles.meta}>
                        {t("pickerMeta", {
                          duration: formatDuration(v.durationSeconds),
                          size: formatMB(v.fileSizeBytes),
                        })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
