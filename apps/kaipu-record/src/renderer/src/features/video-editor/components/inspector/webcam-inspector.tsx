/**
 * The Webcam section of the inspector (ADR 0038, spec § 6): Shape, Size, nine position
 * presets, Mirror, Shadow and Shrink during zoom, for the global layout — or, when a lane
 * block is selected, for that segment: a hidden one shows its range and Delete, an override
 * the same controls over its own fields. A recording without a webcam never renders it.
 *
 * Every control edits through WebcamEditing with the history contract: buttons commit,
 * sliders run begin → live… → end. `target` is the source time the edit applies at: null
 * for the global layout, a time inside the segment for an override.
 */
import { EyeOff, Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatPrecise } from "./format";
import { HistorySlider } from "../history-slider";
import type { WebcamEditing } from "../../webcam/use-webcam-editing";
import {
  WEBCAM_DEFAULTS,
  WEBCAM_LIMITS,
  type WebcamLayout,
  type WebcamSegment,
} from "../../webcam/webcam-model";
import {
  type FrameSize,
  WEBCAM_POSITION_PRESETS,
  type WebcamPositionPresetId,
  webcamPresetCenter,
} from "../../webcam/webcam-layout";
import styles from "./inspector.module.css";
import webcamStyles from "./webcam-inspector.module.css";

type PresetLabelKey =
  | "webcamPosTopLeft"
  | "webcamPosTop"
  | "webcamPosTopRight"
  | "webcamPosLeft"
  | "webcamPosCenter"
  | "webcamPosRight"
  | "webcamPosBottomLeft"
  | "webcamPosBottom"
  | "webcamPosBottomRight";

const PRESET_LABEL: Record<WebcamPositionPresetId, PresetLabelKey> = {
  "top-left": "webcamPosTopLeft",
  top: "webcamPosTop",
  "top-right": "webcamPosTopRight",
  left: "webcamPosLeft",
  center: "webcamPosCenter",
  right: "webcamPosRight",
  "bottom-left": "webcamPosBottomLeft",
  bottom: "webcamPosBottom",
  "bottom-right": "webcamPosBottomRight",
};

/** The highest shrink the slider offers while the toggle is on; 1 means "off". */
const MAX_SHRINK_WHILE_ON = 0.95;

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

function WebcamControls({
  layout,
  target,
  edits,
  frame,
}: {
  layout: WebcamLayout;
  target: number | null;
  edits: WebcamEditing;
  frame: FrameSize;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const commit = (patch: Partial<WebcamLayout>): void => edits.commitLayout(patch, target);
  const live = (patch: Partial<WebcamLayout>): void => edits.liveLayout(patch, target);
  const shrinking = layout.scaleDuringZoom < 1;
  return (
    <>
      <p className={styles.sectionLabel}>{t("webcamShape")}</p>
      <div className={styles.segmented} role="group" aria-label={t("webcamShape")}>
        {(["circle", "rounded"] as const).map((shape) => (
          <button
            key={shape}
            type="button"
            aria-pressed={layout.shape === shape}
            className={layout.shape === shape ? styles.segmentActive : styles.segment}
            onClick={() => commit({ shape })}
          >
            {shape === "circle" ? t("webcamShapeCircle") : t("webcamShapeRounded")}
          </button>
        ))}
      </div>
      <HistorySlider
        label={t("webcamSize")}
        value={layout.size}
        min={WEBCAM_LIMITS.minSize}
        max={WEBCAM_LIMITS.maxSize}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onBegin={edits.begin}
        onLive={(size) => live({ size })}
        onEnd={edits.end}
        onCommit={(size) => commit({ size })}
      />
      <p className={styles.sectionLabel}>{t("webcamPosition")}</p>
      <div className={webcamStyles.positions} role="group" aria-label={t("webcamPosition")}>
        {WEBCAM_POSITION_PRESETS.map((preset) => {
          const center = webcamPresetCenter(preset, layout.size, frame);
          const active = near(center.x, layout.position.x) && near(center.y, layout.position.y);
          return (
            <button
              key={preset.id}
              type="button"
              title={t(PRESET_LABEL[preset.id])}
              aria-label={t(PRESET_LABEL[preset.id])}
              aria-pressed={active}
              className={active ? webcamStyles.positionActive : webcamStyles.position}
              onClick={() => commit({ position: center })}
            >
              <span className={webcamStyles.dot} aria-hidden />
            </button>
          );
        })}
      </div>
      <label className={webcamStyles.toggle}>
        <input
          type="checkbox"
          checked={layout.mirrored}
          onChange={(event) => commit({ mirrored: event.currentTarget.checked })}
        />
        {t("webcamMirror")}
      </label>
      <label className={webcamStyles.toggle}>
        <input
          type="checkbox"
          checked={layout.shadow}
          onChange={(event) => commit({ shadow: event.currentTarget.checked })}
        />
        {t("webcamShadow")}
      </label>
      <label className={webcamStyles.toggle}>
        <input
          type="checkbox"
          checked={shrinking}
          onChange={(event) =>
            commit({
              scaleDuringZoom: event.currentTarget.checked ? WEBCAM_DEFAULTS.scaleDuringZoom : 1,
            })
          }
        />
        {t("webcamShrinkDuringZoom")}
      </label>
      {shrinking && (
        <HistorySlider
          label={t("webcamShrinkAmount")}
          value={layout.scaleDuringZoom}
          min={WEBCAM_LIMITS.minScaleDuringZoom}
          max={MAX_SHRINK_WHILE_ON}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          note={t("webcamShrinkNote")}
          onBegin={edits.begin}
          onLive={(scaleDuringZoom) => live({ scaleDuringZoom })}
          onEnd={edits.end}
          onCommit={(scaleDuringZoom) => commit({ scaleDuringZoom })}
        />
      )}
    </>
  );
}

/** The global layout: what the webcam looks like everywhere no segment says otherwise. */
export function WebcamInspector({
  layout,
  edits,
  frame,
  onHideHere,
}: {
  layout: WebcamLayout;
  edits: WebcamEditing;
  frame: FrameSize;
  onHideHere(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  return (
    <section className={styles.panel} aria-label={t("webcamTitle")}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("webcamTitle")}</h2>
      </header>
      <WebcamControls layout={layout} target={null} edits={edits} frame={frame} />
      <button type="button" className={styles.secondaryButton} onClick={onHideHere}>
        <EyeOff size={14} />
        {t("webcamHideHere")}
      </button>
    </section>
  );
}

/** A selected lane block: a hidden stretch, or an override with its own controls. */
export function WebcamSegmentInspector({
  segment,
  index,
  range,
  layout,
  edits,
  frame,
  onRemoved,
}: {
  segment: WebcamSegment;
  /** 1-based position among the visible segments, for the header. */
  index: number;
  /** Timeline range of the segment's visible pieces. */
  range: { from: number; to: number };
  /** The layout in force inside the segment (global + the override's fields). */
  layout: WebcamLayout;
  edits: WebcamEditing;
  frame: FrameSize;
  onRemoved(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const hidden = segment.mode === "hidden";
  return (
    <section className={styles.panel} aria-label={t("webcamSegmentTitle", { n: index })}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("webcamSegmentTitle", { n: index })}</h2>
        <span className={styles.badge}>{hidden ? t("webcamHidden") : t("webcamOverride")}</span>
      </header>
      <p className={styles.range}>
        {formatPrecise(range.from)} → {formatPrecise(range.to)}
      </p>
      <p className={styles.note}>{hidden ? t("webcamHiddenNote") : t("webcamOverrideNote")}</p>
      {!hidden && (
        <WebcamControls layout={layout} target={segment.start} edits={edits} frame={frame} />
      )}
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => {
          edits.remove(segment.id);
          onRemoved();
        }}
      >
        <Trash2 size={14} />
        {t("webcamRemoveSegment")}
      </button>
    </section>
  );
}
