/**
 * Inspector for a selected muted range: its position on the timeline and Delete.
 * Deliberately thin — a mute has no level, no mode, nothing to tune — but it
 * lives in the side panel like every other edit so the rule "details and
 * destructive actions go in the inspector" holds for all of them.
 */
import { Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { MutedRange } from "../../audio-edits";
import { sourceRangeToTimelineBlocks } from "../../source-time";
import type { LayoutEntry } from "../../timeline";
import type { MuteEditing } from "../../use-mute-editing";
import { formatPrecise } from "./format";
import styles from "./inspector.module.css";

export function MuteInspector({
  range,
  index,
  layout,
  mutes,
  onRemoved,
}: {
  range: MutedRange;
  /** 1-based position among the ranges, for the "Muted section 2" header. */
  index: number;
  layout: LayoutEntry[];
  mutes: MuteEditing;
  onRemoved(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const blocks = sourceRangeToTimelineBlocks(layout, range.sourceStart, range.sourceEnd);
  const from = blocks[0]?.timelineStart ?? 0;
  const to = blocks[blocks.length - 1]?.timelineEnd ?? 0;

  return (
    <section className={styles.panel} aria-label={t("muteTitle", { n: index })}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("muteTitle", { n: index })}</h2>
      </header>
      <p className={styles.range}>
        {formatPrecise(from)} → {formatPrecise(to)}
      </p>
      <p className={styles.note}>{t("muteInspectorNote")}</p>
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => {
          mutes.remove(range.id);
          onRemoved();
        }}
      >
        <Trash2 size={14} />
        {t("muteRemove")}
      </button>
    </section>
  );
}
