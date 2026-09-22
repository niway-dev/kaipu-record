/**
 * Inspector for a selected zoom (UI spec § 7.1): origin badge, range, Level, Smoothness
 * and Remove. Every control edits through ZoomEditing, which flips the segment to
 * `origin: "manual"`.
 *
 * The spec's Follow / Lock Mode control is NOT here yet: "Lock here" has to pin the
 * camera where the user is currently looking, and that position only exists once the
 * camera path does. It ships with the preview in PR 7 (plans/video-editor-v2/09).
 */
import { Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { sourceRangeToTimelineBlocks } from "../../source-time";
import type { LayoutEntry } from "../../timeline";
import type { ZoomEditing } from "../../zoom/use-zoom-editing";
import type { ZoomSegment } from "../../zoom/zoom-model";
import { ZOOM_LIMITS } from "../../zoom/zoom-model";
import { HistorySlider } from "../history-slider";
import { formatPrecise } from "./format";
import styles from "./inspector.module.css";

export function ZoomInspector({
  segment,
  index,
  layout,
  zooms,
  onRemoved,
}: {
  segment: ZoomSegment;
  /** 1-based position among the visible zooms, for the "Zoom 2" header. */
  index: number;
  layout: LayoutEntry[];
  zooms: ZoomEditing;
  onRemoved(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const blocks = sourceRangeToTimelineBlocks(layout, segment.start, segment.end);
  const from = blocks[0]?.timelineStart ?? 0;
  const to = blocks[blocks.length - 1]?.timelineEnd ?? 0;
  const badge =
    segment.trigger === "click"
      ? t("zoomBadgeClick")
      : segment.trigger === "dwell"
        ? t("zoomBadgeDwell")
        : t("zoomBadgeManual");

  return (
    <section className={styles.panel} aria-label={t("zoomTitle", { n: index })}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("zoomTitle", { n: index })}</h2>
        <span className={styles.badge}>{badge}</span>
      </header>
      <p className={styles.range}>
        {formatPrecise(from)} → {formatPrecise(to)}
      </p>
      <HistorySlider
        label={t("zoomLevel")}
        value={segment.scale}
        min={ZOOM_LIMITS.minScale}
        max={ZOOM_LIMITS.maxScale}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
        onBegin={zooms.begin}
        onLive={(scale) => zooms.livePatch(segment.id, { scale })}
        onEnd={zooms.end}
        onCommit={(scale) => zooms.commitPatch(segment.id, { scale })}
      />
      <HistorySlider
        label={t("zoomSmoothness")}
        value={segment.smoothing}
        min={0}
        max={100}
        step={1}
        note={t("zoomSmoothnessNote")}
        onBegin={zooms.begin}
        onLive={(smoothing) => zooms.livePatch(segment.id, { smoothing })}
        onEnd={zooms.end}
        onCommit={(smoothing) => zooms.commitPatch(segment.id, { smoothing })}
      />
      {/* PR 7 inserts the Follow / Lock Mode control and its note here. */}
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => {
          zooms.remove(segment.id);
          onRemoved();
        }}
      >
        <Trash2 size={14} />
        {t("zoomRemove")}
      </button>
    </section>
  );
}
