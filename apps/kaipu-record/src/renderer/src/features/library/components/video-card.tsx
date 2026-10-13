import { Film, PenLine, Tag, Trash2, Play } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatDuration, formatSize } from "@renderer/features/library/format";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { EditBadge as EditBadgeState } from "@renderer/features/library/lineage";
import { StorageMeta } from "./storage-meta";
import { KindBadge } from "./kind-badge";
import { EditBadge } from "./edit-badge";
import { cx } from "@renderer/ui/cx";
import styles from "./video-card.module.css";

const CARD_TAGS_SHOWN = 3;

interface VideoCardProps {
  video: LibraryVideo;
  badge?: EditBadgeState;
  onNavigate(): void;
  onDelete(): void;
  /** Opens the item in the Editor workspace; omitted when it cannot be edited. */
  onEdit?(): void;
  /** Opens the tag side panel for this item; omitted when it cannot be tagged. */
  onTags?(): void;
  /** This item is the one in the tag side panel. */
  selected?: boolean;
}

export function VideoCard({
  video,
  badge = null,
  onNavigate,
  onDelete,
  onEdit,
  onTags,
  selected = false,
}: VideoCardProps): React.JSX.Element {
  const t = useTranslations("library");
  // A few tags always visible under the title, the rest as "+N".
  const tags = video.tags ?? [];
  const cardTags = tags.slice(0, CARD_TAGS_SHOWN);
  const hiddenTags = tags.length - cardTags.length;

  return (
    <div
      className={styles.card}
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
            <Film size={26} strokeWidth={1.5} />
          </div>
        )}

        <div className={styles.scrim} aria-hidden />

        <span className={styles.kindBadge}>
          <KindBadge kind={video.kind} />
        </span>

        {video.durationSeconds > 0 && (
          <span className={styles.duration}>{formatDuration(video.durationSeconds)}</span>
        )}

        {video.kind !== "screenshot" && (
          <div className={styles.playLayer} aria-hidden>
            <span className={styles.playButton}>
              <Play size={18} fill="#fff" strokeWidth={0} />
            </span>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <p className={styles.title}>{video.title || t("untitled")}</p>
        <div className={styles.metaLine}>
          <StorageMeta video={video} />
          <EditBadge state={badge} />
        </div>
        <span className={styles.specs}>
          {formatSize(video.fileSizeBytes)}
          {video.kind !== "screenshot" && ` · ${formatDuration(video.durationSeconds)}`}
        </span>
        {cardTags.length > 0 && (
          <ul className={styles.tags} aria-label={t("tagsLabel")}>
            {cardTags.map((tag) => (
              <li key={tag} className={styles.tag}>
                {tag}
              </li>
            ))}
            {hiddenTags > 0 && <li className={styles.tagMore}>+{hiddenTags}</li>}
          </ul>
        )}

        <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
          {onTags && (
            <button className={styles.action} onClick={onTags} title={t("tagsEdit")}>
              <Tag size={14} strokeWidth={1.8} />
            </button>
          )}
          {onEdit && (
            <button className={styles.action} onClick={onEdit} title={t("edit")}>
              <PenLine size={14} strokeWidth={1.8} />
            </button>
          )}
          {video.id !== null && (
            <button
              className={cx(styles.action, styles.delete)}
              onClick={onDelete}
              title={t("delete")}
            >
              <Trash2 size={14} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
