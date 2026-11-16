/**
 * The Webcam section of the inspector (ADR 0038, spec § 6): Shape, Corners (square and
 * rectangle, ADR 0041), Size, nine position
 * presets, Mirror, Shadow and Shrink during zoom, for the global layout — or, when a lane
 * block is selected, for that segment: a hidden one shows its range and Delete, an override
 * the same controls over its own fields. A recording without a webcam never renders it.
 *
 * Every control edits through WebcamEditing with the history contract: buttons commit,
 * sliders run begin → live… → end. `target` is the source time the edit applies at: null
 * for the global layout, a time inside the segment for an override.
 */
import { EyeOff, Move, Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  CAMERA_BUBBLE_SHAPES,
  CAMERA_CORNER_RADIUS_MAX,
  CAMERA_CORNER_RADIUS_MIN,
  CAMERA_CORNER_RADIUS_STEP,
  type CameraBubbleShape,
} from "@shared/camera-bubble";
import { formatPrecise } from "./format";
import { HistorySlider } from "../history-slider";
import type { WebcamEditing } from "../../webcam/use-webcam-editing";
import {
  WEBCAM_DEFAULTS,
  WEBCAM_EASINGS,
  WEBCAM_LIMITS,
  WEBCAM_TRANSITION_DEFAULTS,
  WEBCAM_TRANSITION_LIMITS,
  webcamSizeLabel,
  type WebcamEasing,
  type WebcamLayout,
  type WebcamSegment,
} from "../../webcam/webcam-model";
import {
  type FrameSize,
  WEBCAM_POSITION_PRESETS,
  type WebcamPositionPresetId,
  webcamPresetActive,
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

const SHAPE_LABEL: Record<
  CameraBubbleShape,
  "webcamShapeCircle" | "webcamShapeRounded" | "webcamShapeRectangle"
> = {
  circle: "webcamShapeCircle",
  rounded: "webcamShapeRounded",
  rectangle: "webcamShapeRectangle",
};

const EASING_LABEL: Record<
  WebcamEasing,
  "webcamEasingEaseInOut" | "webcamEasingLinear" | "webcamEasingEaseOut" | "webcamEasingBack"
> = {
  "ease-in-out": "webcamEasingEaseInOut",
  linear: "webcamEasingLinear",
  "ease-out": "webcamEasingEaseOut",
  back: "webcamEasingBack",
};

/** The highest shrink the slider offers while the toggle is on; 1 means "off". */
const MAX_SHRINK_WHILE_ON = 0.95;

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
        {CAMERA_BUBBLE_SHAPES.map((shape) => (
          <button
            key={shape}
            type="button"
            aria-pressed={layout.shape === shape}
            className={layout.shape === shape ? styles.segmentActive : styles.segment}
            onClick={() => commit({ shape })}
          >
            {t(SHAPE_LABEL[shape])}
          </button>
        ))}
      </div>
      {layout.shape !== "circle" && (
        <HistorySlider
          label={t("webcamCorners")}
          value={layout.cornerRadius}
          min={CAMERA_CORNER_RADIUS_MIN}
          max={CAMERA_CORNER_RADIUS_MAX}
          step={CAMERA_CORNER_RADIUS_STEP}
          format={(v) => `${Math.round(v * 100)}%`}
          onBegin={edits.begin}
          onLive={(cornerRadius) => live({ cornerRadius })}
          onEnd={edits.end}
          onCommit={(cornerRadius) => commit({ cornerRadius })}
        />
      )}
      <HistorySlider
        label={t("webcamSize")}
        value={layout.size}
        min={WEBCAM_LIMITS.minSize}
        max={WEBCAM_LIMITS.maxSize}
        step={0.01}
        format={(v) => `${webcamSizeLabel(v)}%`}
        onBegin={edits.begin}
        onLive={(size) => live({ size })}
        onEnd={edits.end}
        onCommit={(size) => commit({ size })}
      />
      <p className={styles.sectionLabel}>{t("webcamPosition")}</p>
      <div className={webcamStyles.positions} role="group" aria-label={t("webcamPosition")}>
        {WEBCAM_POSITION_PRESETS.map((preset) => {
          const active = webcamPresetActive(preset, layout, frame);
          return (
            <button
              key={preset.id}
              type="button"
              title={t(PRESET_LABEL[preset.id])}
              aria-label={t(PRESET_LABEL[preset.id])}
              aria-pressed={active}
              className={active ? webcamStyles.positionActive : webcamStyles.position}
              onClick={() => commit({ position: { x: preset.x, y: preset.y } })}
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

/**
 * How a selected block's start plays (the camera-sections design): Slide or Cut, and for a
 * Slide its duration and easing. A block with no transition is a Cut, so a session saved
 * before transitions existed reads as what it always did. Duration and easing stay stored
 * while the block is a Cut, but are only offered for a Slide.
 */
function WebcamTransitionControls({
  segment,
  edits,
}: {
  segment: WebcamSegment;
  edits: WebcamEditing;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const kind = segment.transition?.kind ?? "cut";
  const ms = segment.transition?.ms ?? WEBCAM_TRANSITION_DEFAULTS.ms;
  const easing = segment.transition?.easing ?? WEBCAM_TRANSITION_DEFAULTS.easing;
  const kinds = [
    { kind: "slide", label: t("webcamTransitionSlide") },
    { kind: "cut", label: t("webcamTransitionCut") },
  ] as const;
  return (
    <>
      <p className={styles.sectionLabel}>{t("webcamTransition")}</p>
      <div className={styles.segmented} role="group" aria-label={t("webcamTransition")}>
        {kinds.map((option) => (
          <button
            key={option.kind}
            type="button"
            aria-pressed={kind === option.kind}
            className={kind === option.kind ? styles.segmentActive : styles.segment}
            onClick={() => edits.commitTransition(segment.id, { kind: option.kind })}
          >
            {option.label}
          </button>
        ))}
      </div>
      {kind === "slide" && (
        <>
          <HistorySlider
            label={t("webcamTransitionDuration")}
            value={ms}
            min={WEBCAM_TRANSITION_LIMITS.minMs}
            max={WEBCAM_TRANSITION_LIMITS.maxMs}
            step={50}
            format={(v) => `${v} ms`}
            onBegin={edits.begin}
            onLive={(value) => edits.liveTransition(segment.id, { ms: value })}
            onEnd={edits.end}
            onCommit={(value) => edits.commitTransition(segment.id, { ms: value })}
          />
          <p className={styles.sectionLabel}>{t("webcamEasing")}</p>
          <div className={styles.segmented} role="group" aria-label={t("webcamEasing")}>
            {WEBCAM_EASINGS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={easing === preset}
                className={easing === preset ? styles.segmentActive : styles.segment}
                onClick={() => edits.commitTransition(segment.id, { easing: preset })}
              >
                {t(EASING_LABEL[preset])}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/**
 * The global layout: what the webcam looks like everywhere no segment says otherwise.
 * `changeBlocked` is the reason, already translated, that "Change camera from here" does
 * nothing at the playhead; null when it can.
 */
export function WebcamInspector({
  layout,
  edits,
  frame,
  onHideHere,
  onChangeHere,
  changeBlocked,
}: {
  layout: WebcamLayout;
  edits: WebcamEditing;
  frame: FrameSize;
  onHideHere(): void;
  onChangeHere(): void;
  changeBlocked: string | null;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  return (
    <section className={styles.panel} aria-label={t("webcamTitle")}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("webcamTitle")}</h2>
      </header>
      <p className={styles.range} data-webcam-scope="default">
        {t("webcamScopeDefault")}
      </p>
      <WebcamControls layout={layout} target={null} edits={edits} frame={frame} />
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={changeBlocked !== null}
        title={changeBlocked ?? t("hintChangeCamera")}
        onClick={onChangeHere}
      >
        <Move size={14} />
        {t("webcamChangeHere")}
      </button>
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
      <p className={styles.range} data-webcam-scope="block">
        {formatPrecise(range.from)} → {formatPrecise(range.to)}
      </p>
      <p className={styles.note}>{hidden ? t("webcamHiddenNote") : t("webcamOverrideNote")}</p>
      {!hidden && (
        <>
          <WebcamControls layout={layout} target={segment.start} edits={edits} frame={frame} />
          <WebcamTransitionControls segment={segment} edits={edits} />
        </>
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
