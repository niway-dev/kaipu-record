import { Film, PenLine, Tag, Trash2, Upload } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatDuration, formatSize } from "@renderer/features/library/format";
import type { TagSummary } from "@shared/types";
import type { LibraryVideo } from "@renderer/features/library/types";
import { TagChip } from "../tags/tag-chip";
import { type EditBadge as EditBadgeState, isMaster } from "@renderer/features/library/lineage";
import { StorageMeta } from "./storage-meta";
import { KindBadge } from "./kind-badge";
import { MasterTag } from "./master-tag";
import { EditBadge } from "./edit-badge";
import { cx } from "@renderer/ui/cx";
import { SelectCheck, type ItemSelection } from "./select-check";
import styles from "./video-row.module.css";
import { uiArea, type UiAreaProps } from "@renderer/lib/ui-area";
import { LibraryTranscribeButton } from "@renderer/features/transcription/library-transcribe-button";

interface VideoRowProps {
  video: LibraryVideo;
  isLast?: boolean;
  badge?: EditBadgeState;
  onNavigate(): void;
  onDelete(): void;
  /** Opens the item in the Editor workspace; omitted when it cannot be edited. */
  onEdit?(): void;
  /** Opens Export — "Export a copy" — for this recording (NIW2-578); omitted when there is nothing to prepare. */
  onPrepare?(): void;
  /** Opens the tag side panel for this item; omitted when it cannot be tagged. */
  onTags?(): void;
  /** This item is the one in the tag side panel. */
  selected?: boolean;
  /** The item's tags, resolved from the registry (name + color). */
  tags?: readonly TagSummary[];
  /** The "⋯" menu (Move to ▸), shown with the other actions. */
  moveMenu?: React.ReactNode;
  /** Select mode: a click toggles the checkbox instead of opening the item. */
  selection?: ItemSelection;
  /** The catalog area this row is (`uiArea("…")`), put on its root. */
  ui?: UiAreaProps;
}

const ROW_TAGS_SHOWN = 4;

export function VideoRow({
  video,
  isLast,
  badge = null,
  onNavigate,
  onDelete,
  onEdit,
  onPrepare,
  onTags,
  selected = false,
  tags = [],
  moveMenu,
  selection,
  ui,
}: VideoRowProps): React.JSX.Element {
  const t = useTranslations("library");
  const rowTags = tags.slice(0, ROW_TAGS_SHOWN);
  const activate = (range: boolean): void => {
    if (!selection) return onNavigate();
    if (selection.disabledReason === null) selection.onToggle(range);
  };

  return (
    <div
      {...ui}
      className={cx(styles.row, !isLast && styles.divided)}
      data-selected={selected || selection?.checked}
      aria-pressed={selection ? selection.checked : undefined}
      aria-disabled={selection?.disabledReason ? true : undefined}
      onClick={(e) => activate(e.shiftKey)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // A key pressed on a control inside (the "⋯" menu, portaled or not, bubbles through
        // React) belongs to that control, not to the card.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate(e.shiftKey);
        }
      }}
    >
      {selection && <SelectCheck selection={selection} />}
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
          {/* An original reads as the master (NIW2-585); a screenshot also keeps its kind badge. */}
          {isMaster(video) && <MasterTag size="sm" screenshot={video.kind === "screenshot"} />}
          {(!isMaster(video) || video.kind === "screenshot") && <KindBadge kind={video.kind} />}
          <StorageMeta video={video} />
          <EditBadge state={badge} />
          <span className={styles.specs}>
            {formatSize(video.fileSizeBytes)}
            {video.kind !== "screenshot" && ` · ${formatDuration(video.durationSeconds)}`}
            {video.capture?.mode === "import" && ` · ${t("importedMeta")}`}
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

      {/* Outside the hover-only actions: a running job and a "Transcribed" badge stay visible;
          the idle button appears with the other actions. */}
      <div className={styles.transcribeSlot}>
        <LibraryTranscribeButton
          video={video}
          variant="row"
          ui={uiArea("library.videoRowTranscribe")}
        />
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
        {onPrepare && (
          <button
            className={styles.action}
            onClick={onPrepare}
            title={t("exportCopy")}
            aria-label={t("exportCopy")}
          >
            <Upload size={15} strokeWidth={1.8} />
          </button>
        )}
        {moveMenu}
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
