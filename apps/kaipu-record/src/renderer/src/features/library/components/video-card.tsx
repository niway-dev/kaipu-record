import { Film, PenLine, Send, Tag, Trash2, Play } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatDuration, formatSize } from "@renderer/features/library/format";
import type { TagSummary } from "@shared/types";
import type { LibraryVideo } from "@renderer/features/library/types";
import { TagChip } from "../tags/tag-chip";
import { type EditBadge as EditBadgeState, isMaster } from "@renderer/features/library/lineage";
import { StorageMeta } from "./storage-meta";
import { KindBadge } from "./kind-badge";
import { MasterTag } from "./master-tag";
import { RecordingCaptureTag } from "./recording-capture-tag";
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
  /** Opens Prepare — "Send to…" — for this recording (NIW2-578); omitted when there is nothing to prepare. */
  onPrepare?(): void;
  /** Opens the tag side panel for this item; omitted when it cannot be tagged. */
  onTags?(): void;
  /** This item is the one in the tag side panel. */
  selected?: boolean;
  /** A copy that finished in the background and has not been opened yet (NIW2-586). */
  justReady?: boolean;
  /** The item's tags, resolved from the registry (name + color). */
  tags?: readonly TagSummary[];
}

export function VideoCard({
  video,
  badge = null,
  onNavigate,
  onDelete,
  onEdit,
  onPrepare,
  onTags,
  selected = false,
  justReady = false,
  tags = [],
}: VideoCardProps): React.JSX.Element {
  const t = useTranslations("library");
  // A few tags always visible under the title, the rest as "+N".
  const cardTags = tags.slice(0, CARD_TAGS_SHOWN);
  const hiddenTags = tags.length - cardTags.length;
  // NIW2-579: an imported video says so in the metadata line, not as a capture pill.
  const imported = video.capture?.mode === "import";

  return (
    <div
      className={styles.card}
      data-selected={selected}
      data-just-ready={justReady}
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
          {/* An original reads as the master (NIW2-585); the tag also says it is a recording. */}
          {isMaster(video) ? <MasterTag size="sm" /> : <KindBadge kind={video.kind} />}
          {!imported && <RecordingCaptureTag capture={video.capture} />}
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
            {onPrepare && (
              <button
                className={styles.action}
                onClick={onPrepare}
                title={t("sendTo")}
                aria-label={t("sendTo")}
              >
                <Send size={14} strokeWidth={1.8} />
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
        <span className={styles.specs}>
          {formatSize(video.fileSizeBytes)}
          {video.kind !== "screenshot" && ` · ${formatDuration(video.durationSeconds)}`}
          {imported && ` · ${t("importedMeta")}`}
        </span>
        {cardTags.length > 0 && (
          <ul className={styles.tags} aria-label={t("tagsLabel")}>
            {cardTags.map((tag) => (
              <li key={tag.id}>
                <TagChip name={tag.name} color={tag.color} />
              </li>
            ))}
            {hiddenTags > 0 && <li className={styles.tagMore}>+{hiddenTags}</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
