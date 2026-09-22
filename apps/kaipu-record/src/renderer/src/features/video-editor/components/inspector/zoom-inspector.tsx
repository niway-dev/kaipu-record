/**
 * Inspector for a selected zoom (UI spec § 7.1): origin badge, range, Level, Smoothness,
 * Mode and Remove. Every control edits through ZoomEditing, which flips the segment to
 * `origin: "manual"`.
 *
 * "Lock here" commits the mode AND the anchor in one step: `anchorNow()` is where the
 * camera box sits at this instant, so locking freezes the picture the user is looking
 * at. Without the anchor, updateZoom would fall back to the frame centre and the camera
 * would jump (plans/video-editor-v2/09).
 */
import { Crosshair, Lock, Trash2 } from "lucide-react";
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
  anchorNow,
  onRemoved,
}: {
  segment: ZoomSegment;
  /** 1-based position among the visible zooms, for the "Zoom 2" header. */
  index: number;
  layout: LayoutEntry[];
  zooms: ZoomEditing;
  /** Where the camera box is right now, normalized and clamped — the anchor Lock pins. */
  anchorNow(): { x: number; y: number };
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
      <div className={styles.segmented} role="group" aria-label={t("zoomMode")}>
        <button
          type="button"
          aria-pressed={segment.mode === "follow"}
          className={segment.mode === "follow" ? styles.segmentActive : styles.segment}
          onClick={() => zooms.commitPatch(segment.id, { mode: "follow", anchor: null })}
        >
          <Crosshair size={14} />
          {t("zoomFollow")}
        </button>
        <button
          type="button"
          aria-pressed={segment.mode === "fixed"}
          className={segment.mode === "fixed" ? styles.segmentActive : styles.segment}
          onClick={() => zooms.commitPatch(segment.id, { mode: "fixed", anchor: anchorNow() })}
        >
          <Lock size={14} />
          {t("zoomLock")}
        </button>
      </div>
      <p className={styles.note}>
        {segment.mode === "follow" ? t("zoomFollowNote") : t("zoomLockNote")}
      </p>
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
