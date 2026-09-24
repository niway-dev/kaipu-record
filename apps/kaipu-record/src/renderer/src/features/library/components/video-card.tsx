import { Film, Trash2, Play } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatDuration, formatSize } from "@renderer/features/library/format";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { EditBadge as EditBadgeState } from "@renderer/features/library/lineage";
import { StorageMeta } from "./storage-meta";
import { KindBadge } from "./kind-badge";
import { EditBadge } from "./edit-badge";
import { cx } from "@renderer/ui/cx";
import styles from "./video-card.module.css";

interface VideoCardProps {
  video: LibraryVideo;
  badge?: EditBadgeState;
  onNavigate(): void;
  onDelete(): void;
}

export function VideoCard({
  video,
  badge = null,
  onNavigate,
  onDelete,
}: VideoCardProps): React.JSX.Element {
  const t = useTranslations("library");

  return (
    <div
      className={styles.card}
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

        <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
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
