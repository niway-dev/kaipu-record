import { Film, PenLine, Tag, Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatDuration, formatSize } from "@renderer/features/library/format";
import type { TagSummary } from "@shared/types";
import type { LibraryVideo } from "@renderer/features/library/types";
import { TagChip } from "../tags/tag-chip";
import type { EditBadge as EditBadgeState } from "@renderer/features/library/lineage";
import { StorageMeta } from "./storage-meta";
import { KindBadge } from "./kind-badge";
import { EditBadge } from "./edit-badge";
import { cx } from "@renderer/ui/cx";
import styles from "./video-row.module.css";

interface VideoRowProps {
  video: LibraryVideo;
  isLast?: boolean;
  badge?: EditBadgeState;
  onNavigate(): void;
  onDelete(): void;
  /** Opens the item in the Editor workspace; omitted when it cannot be edited. */
  onEdit?(): void;
  /** Opens the tag side panel for this item; omitted when it cannot be tagged. */
  onTags?(): void;
  /** This item is the one in the tag side panel. */
  selected?: boolean;
  /** The item's tags, resolved from the registry (name + color). */
  tags?: readonly TagSummary[];
}

const ROW_TAGS_SHOWN = 4;

export function VideoRow({
  video,
  isLast,
  badge = null,
  onNavigate,
  onDelete,
  onEdit,
  onTags,
  selected = false,
  tags = [],
}: VideoRowProps): React.JSX.Element {
  const t = useTranslations("library");
  const rowTags = tags.slice(0, ROW_TAGS_SHOWN);

  return (
    <div
      className={cx(styles.row, !isLast && styles.divided)}
      data-selected={selected}
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate();
        }
      }}
    >
      <div className={styles.poster}>
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt="" className={styles.posterImage} />
        ) : (
          <div className={styles.posterFallback} aria-hidden>
            <Film size={18} strokeWidth={1.5} />
          </div>
        )}
        {video.durationSeconds > 0 && (
          <span className={styles.duration}>{formatDuration(video.durationSeconds)}</span>
        )}
      </div>

      <div className={styles.info}>
        <p className={styles.title}>{video.title || t("untitled")}</p>
        <div className={styles.metaLine}>
          <KindBadge kind={video.kind} />
          <StorageMeta video={video} />
          <EditBadge state={badge} />
          <span className={styles.specs}>
            {formatSize(video.fileSizeBytes)}
            {video.kind !== "screenshot" && ` · ${formatDuration(video.durationSeconds)}`}
          </span>
          {rowTags.length > 0 && (
            <ul className={styles.tags} aria-label={t("tagsLabel")}>
              {rowTags.map((tag) => (
                <li key={tag.id}>
                  <TagChip name={tag.name} color={tag.color} />
                </li>
              ))}
              {tags.length > rowTags.length && (
                <li className={styles.tag}>+{tags.length - rowTags.length}</li>
              )}
            </ul>
          )}
        </div>
      </div>

      <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
        {onTags && (
          <button className={styles.action} onClick={onTags} title={t("tagsEdit")}>
            <Tag size={15} strokeWidth={1.8} />
          </button>
        )}
        {onEdit && (
          <button className={styles.action} onClick={onEdit} title={t("edit")}>
            <PenLine size={15} strokeWidth={1.8} />
          </button>
        )}
        {video.id !== null && (
          <button
            className={cx(styles.action, styles.delete)}
            onClick={onDelete}
            title={t("delete")}
          >
            <Trash2 size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  );
}
