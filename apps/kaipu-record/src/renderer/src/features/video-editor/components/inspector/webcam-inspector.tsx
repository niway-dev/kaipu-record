/**
 * The Camera panel of the inspector (camera parts, drag-first). Two tabs; it opens on "This
 * part" when there is a part under the playhead or selected, else on "Whole video":
 *
 * - "This part": the part under the playhead or selected on the Camera lane (its range, where
 *   the camera comes from and goes to, how it arrives, when it ends, "Remove this part"), or,
 *   with no part there, a sentence and no button: a part is made by dragging the bubble.
 * - "Whole video": the original position and the look every stretch shares (shape, corners,
 *   size as S, M or L plus a slider, mirror, shadow, shrink during a zoom).
 *
 * A selected hidden range has no tabs: what it is, and "Show the camera again".
 *
 * The bubble's place is never a control here: the small frame only shows it, and the bubble
 * on the video is dragged to move it. Every control edits through WebcamEditing with the
 * history contract: buttons commit, sliders run begin → live… → end.
 */
import { useRef, useState } from "react";
import { Eye, EyeOff, Play, Trash2, Webcam } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import {
  CAMERA_BUBBLE_SHAPES,
  CAMERA_CORNER_RADIUS_MAX,
  CAMERA_CORNER_RADIUS_MIN,
  CAMERA_CORNER_RADIUS_STEP,
  type CameraBubbleShape,
} from "@shared/camera-bubble";
import { formatClock, formatPrecise } from "./format";
import { HistorySlider } from "../history-slider";
import { NAME_LABEL } from "../webcam-name-label";
import type { WebcamEditing } from "../../webcam/use-webcam-editing";
import { webcamOwnLook } from "../../webcam/webcam-edits";
import type { FrameSize } from "../../webcam/webcam-layout";
import {
  WEBCAM_LIMITS,
  WEBCAM_MOTION_BUTTONS,
  WEBCAM_SIZE_PRESETS,
  WEBCAM_SIZE_PRESET_IDS,
  WEBCAM_SHRINK_ON_SCALE,
  WEBCAM_SLIDE_MS_PRESETS,
  WEBCAM_TRANSITION_DEFAULTS,
  webcamSizePreset,
  type WebcamEasing,
  type WebcamLayout,
  type WebcamScene,
  type WebcamSegment,
  type WebcamSizePreset,
} from "../../webcam/webcam-model";
import { webcamLayoutDot, webcamLayoutName, webcamPartOrigin } from "../../webcam/webcam-stretches";
import styles from "./inspector.module.css";
import webcamStyles from "./webcam-inspector.module.css";

const SHAPE_LABEL: Record<
  CameraBubbleShape,
  "webcamShapeCircle" | "webcamShapeRounded" | "webcamShapeRectangle"
> = {
  circle: "webcamShapeCircle",
  rounded: "webcamShapeRounded",
  rectangle: "webcamShapeRectangle",
};

// The buttons read S, M and L; the tooltip says what each letter is.
const SIZE_TITLE: Record<WebcamSizePreset, "webcamSizeS" | "webcamSizeM" | "webcamSizeL"> = {
  S: "webcamSizeS",
  M: "webcamSizeM",
  L: "webcamSizeL",
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

/**
 * The small frame that shows where the camera is: a solid dot for now and, for a part, a
 * dashed dot for where it comes from with the line between them. It is a picture, never a
 * control: the bubble on the video is what moves.
 */
function PlaceFrame({
  now,
  before,
  name,
}: {
  /** Each axis's share (0 to 1) of the range the bubble's centre can reach. */
  now: { x: number; y: number } | null;
  before?: { x: number; y: number } | null;
  name: string;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const percent = (share: number): string => `${share * 100}%`;
  return (
    <div
      className={webcamStyles.placeFrame}
      role="img"
      aria-label={t("webcamFrameAria", { name })}
      data-testid="webcam-panel-frame"
    >
      <div className={webcamStyles.placeTrack}>
        {now && before && (
          <svg className={webcamStyles.placeLine} aria-hidden="true">
            <line
              x1={percent(before.x)}
              y1={percent(before.y)}
              x2={percent(now.x)}
              y2={percent(now.y)}
            />
          </svg>
        )}
        {before && (
          <span
            className={webcamStyles.placeBefore}
            data-dot="before"
            title={t("webcamFrameBefore")}
            style={{ left: percent(before.x), top: percent(before.y) }}
          />
        )}
        {now && (
          <span
            className={webcamStyles.placeNow}
            data-dot="now"
            title={t("webcamFrameNow")}
            style={{ left: percent(now.x), top: percent(now.y) }}
          />
        )}
      </div>
    </div>
  );
}

/** The place's name and the sentence that says the bubble is dragged on the video. */
function PlaceBlock({
  layout,
  before,
  frame,
  label,
  trailing,
}: {
  layout: WebcamLayout;
  before?: WebcamLayout;
  frame: FrameSize;
  label: string;
  /** Right-aligned text on the label's row (the part's range and length). */
  trailing?: string;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const name = webcamLayoutName(layout, frame);
  const nameText = name ? t(NAME_LABEL[name]) : "";
  return (
    <>
      <div className={webcamStyles.labelRow}>
        <p className={styles.sectionLabel}>{label}</p>
        {trailing && <span className={webcamStyles.trailing}>{trailing}</span>}
      </div>
      <div className={webcamStyles.placeBlock}>
        <PlaceFrame
          now={webcamLayoutDot(layout, frame)}
          before={before ? webcamLayoutDot(before, frame) : null}
          name={nameText}
        />
        <div className={webcamStyles.placeText}>
          <p className={webcamStyles.placeName} data-testid="webcam-panel-name">
            {nameText}
          </p>
          <p className={styles.note}>{t("webcamMoveHint")}</p>
        </div>
      </div>
    </>
  );
}

/** Buttons in a row that pick one of a few values; none is pressed when `current` is null. */
function Choices<T extends string | number>({
  label,
  options,
  current,
  onPick,
}: {
  label: string;
  options: readonly { value: T; text: string; title?: string }[];
  current: T | null;
  onPick(value: T): void;
}): React.JSX.Element {
  return (
    <>
      <p className={styles.sectionLabel}>{label}</p>
      <div className={webcamStyles.choices} role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={current === option.value}
            title={option.title}
            className={current === option.value ? styles.segmentActive : styles.segment}
            onClick={() => onPick(option.value)}
          >
            {option.text}
          </button>
        ))}
      </div>
    </>
  );
}

/** The look every stretch shares: it always edits the whole video's layout. */
function WholeVideoControls({
  layout,
  edits,
}: {
  layout: WebcamLayout;
  edits: WebcamEditing;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const commit = (patch: Partial<WebcamLayout>): void => edits.commitLayout(patch, null);
  const live = (patch: Partial<WebcamLayout>): void => edits.liveLayout(patch, null);
  const shrinking = layout.scaleDuringZoom < 1;
  return (
    <>
      <Choices
        label={t("webcamShape")}
        options={CAMERA_BUBBLE_SHAPES.map((shape) => ({
          value: shape,
          text: t(SHAPE_LABEL[shape]),
        }))}
        current={layout.shape}
        onPick={(shape) => commit({ shape })}
      />
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
      {/* A size saved outside the three keeps playing and shows no button pressed; the slider
          below shows and edits it. */}
      <Choices
        label={t("webcamSize")}
        options={WEBCAM_SIZE_PRESET_IDS.map((id) => ({
          value: id,
          text: id,
          title: t(SIZE_TITLE[id]),
        }))}
        current={webcamSizePreset(layout.size)}
        onPick={(id) => commit({ size: WEBCAM_SIZE_PRESETS[id] })}
      />
      <HistorySlider
        label={t("webcamSizeSlider")}
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
              scaleDuringZoom: event.currentTarget.checked ? WEBCAM_SHRINK_ON_SCALE : 1,
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
 * How a part arrives: Slide or Cut, and for a Slide its duration (0.4, 0.7 or 1.2 s) and motion
 * (Smooth, Bounce or Linear). A part with no transition is a Cut. One saved with a duration or
 * motion no button offers (500 ms, ease out) keeps and plays it, and shows nothing pressed
 * until the user picks one; the panel never rewrites a saved value by being opened.
 */
function ArrivalControls({
  part,
  edits,
}: {
  part: WebcamSegment;
  edits: WebcamEditing;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const kind = part.transition?.kind ?? "cut";
  const ms = part.transition?.ms ?? WEBCAM_TRANSITION_DEFAULTS.ms;
  const easing = part.transition?.easing ?? WEBCAM_TRANSITION_DEFAULTS.easing;
  return (
    <>
      <Choices
        label={t("webcamTransition")}
        options={[
          { value: "slide", text: t("webcamTransitionSlide") },
          { value: "cut", text: t("webcamTransitionCut") },
        ]}
        current={kind}
        onPick={(next) => edits.commitTransition(part.id, { kind: next })}
      />
      {kind === "slide" && (
        <>
          <Choices
            label={t("webcamTransitionDuration")}
            options={WEBCAM_SLIDE_MS_PRESETS.map((value) => ({
              value,
              text: `${value / 1000} s`,
            }))}
            current={ms}
            onPick={(value) => edits.commitTransition(part.id, { ms: value })}
          />
          <Choices
            label={t("webcamEasing")}
            options={WEBCAM_MOTION_BUTTONS.map((value) => ({
              value,
              text: t(EASING_LABEL[value]),
            }))}
            current={easing}
            onPick={(value) => edits.commitTransition(part.id, { easing: value })}
          />
        </>
      )}
    </>
  );
}

const OWN_LOOK_LABEL = {
  shape: "webcamOwnShape",
  size: "webcamOwnSize",
  corners: "webcamOwnCorners",
} as const;

/**
 * A part saved with its own shape, size or corners (older sessions) keeps playing them; this
 * says so and offers the whole video's look. Nothing is rewritten by opening the panel.
 */
function OwnLookNote({
  part,
  edits,
}: {
  part: WebcamSegment;
  edits: WebcamEditing;
}): React.JSX.Element | null {
  const t = useTranslations("videoEditor");
  const own = webcamOwnLook(part);
  if (own.length === 0) return null;
  const names = own.map((key) => t(OWN_LOOK_LABEL[key]));
  const what =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} ${t("webcamOwnAnd")} ${names[names.length - 1]}`
      : names[0];
  return (
    <>
      <p className={styles.note} data-testid="webcam-own-look">
        {t("webcamOwnLook", { what })}
      </p>
      <button
        type="button"
        className={styles.secondaryButton}
        onClick={() => edits.takeWholeLook(part.id)}
      >
        {t("webcamUseWholeLook")}
      </button>
    </>
  );
}

/** "This part" with a part there: its place, how it arrives, when it ends, and removing it. */
function PartTab({
  webcam,
  part,
  range,
  edits,
  frame,
  onPlaySlide,
  onRemoved,
}: {
  webcam: WebcamScene;
  part: WebcamSegment;
  range: { from: number; to: number };
  edits: WebcamEditing;
  frame: FrameSize;
  onPlaySlide(part: WebcamSegment): void;
  onRemoved(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const own: WebcamLayout = part.layout ? { ...webcam.layout, ...part.layout } : webcam.layout;
  const sliding = part.transition?.kind === "slide";
  return (
    <>
      <PlaceBlock
        layout={own}
        before={webcamPartOrigin(webcam, part)}
        frame={frame}
        label={t("webcamPosition")}
        trailing={`${formatPrecise(range.from)} – ${formatPrecise(range.to)} · ${t("webcamPartLength", { seconds: (range.to - range.from).toFixed(1) })}`}
      />
      <OwnLookNote part={part} edits={edits} />
      <ArrivalControls part={part} edits={edits} />
      {sliding && (
        <button type="button" className={webcamStyles.playButton} onClick={() => onPlaySlide(part)}>
          <Play size={12} aria-hidden />
          {t("webcamPlaySlide")}
        </button>
      )}
      <p className={styles.sectionLabel}>{t("webcamWhenEnds")}</p>
      <p className={styles.text}>{sliding ? t("webcamEndsSlide") : t("webcamEndsCut")}</p>
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => {
          edits.remove(part.id);
          onRemoved();
        }}
      >
        <Trash2 size={14} />
        {t("webcamRemoveSegment")}
      </button>
    </>
  );
}

/** "This part" with no part at the playhead: what is there and how a part gets made. No button. */
function NoPartTab({ playhead }: { playhead: number }): React.JSX.Element {
  const t = useTranslations("videoEditor");
  return (
    <div className={webcamStyles.empty} data-testid="webcam-panel-empty">
      <span className={webcamStyles.emptyIcon} aria-hidden>
        <Webcam size={18} />
      </span>
      <p className={webcamStyles.emptyTitle}>
        {t("webcamNoChange", { time: formatClock(playhead) })}
      </p>
      <p className={styles.note}>{t("webcamNoChangeBody")}</p>
    </div>
  );
}

/** A selected hidden range: what it is and how to bring the camera back. */
function HiddenRangePanel({
  segment,
  range,
  edits,
  onRemoved,
}: {
  segment: WebcamSegment;
  range: { from: number; to: number };
  edits: WebcamEditing;
  onRemoved(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  return (
    <section
      {...uiArea("editorVideo.webcamPanel")}
      className={styles.panel}
      aria-label={t("webcamHiddenTitle")}
      data-webcam-panel="hidden"
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{t("webcamHiddenTitle")}</h2>
        <EyeOff size={14} aria-hidden />
      </header>
      <p className={styles.range} data-webcam-scope="block">
        {formatPrecise(range.from)} → {formatPrecise(range.to)}
      </p>
      <p className={styles.note}>{t("webcamHiddenNote")}</p>
      <button
        type="button"
        className={styles.secondaryButton}
        onClick={() => {
          edits.remove(segment.id);
          onRemoved();
        }}
      >
        <Eye size={14} />
        {t("webcamShowAgain")}
      </button>
    </section>
  );
}

type Tab = "part" | "whole";

export interface WebcamPanelProps {
  webcam: WebcamScene;
  /** The part under the playhead or selected, or a selected hidden range; null with none. */
  segment: WebcamSegment | null;
  /** Timeline range of the segment's visible pieces (null with no segment). */
  range: { from: number; to: number } | null;
  /** The playhead, in timeline seconds: "No change at 0:04". */
  playhead: number;
  edits: WebcamEditing;
  frame: FrameSize;
  /** Starts a little before the part and plays it. */
  onPlaySlide(part: WebcamSegment): void;
  /** The segment the panel was showing is gone: the page clears its selection. */
  onRemoved(): void;
}

/**
 * The panel. The page keys it by the selection, so picking another part on the lane opens it on
 * "This part" again (and a selection with no part opens "Whole video"); the tab the user chose stays while the playhead crosses parts.
 */
export function WebcamPanel({
  webcam,
  segment,
  range,
  playhead,
  edits,
  frame,
  onPlaySlide,
  onRemoved,
}: WebcamPanelProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  // "This part" opens only when it has content: a part under the playhead or selected. With
  // none it would only say "No change at 0:00", so the panel opens on "Whole video". The page
  // keys the panel by the selection, so a new selection evaluates this again.
  const [tab, setTab] = useState<Tab>(segment && range ? "part" : "whole");
  const tabButtons = useRef<Record<Tab, HTMLButtonElement | null>>({ part: null, whole: null });
  if (segment?.mode === "hidden" && range) {
    return <HiddenRangePanel segment={segment} range={range} edits={edits} onRemoved={onRemoved} />;
  }
  const tabs: readonly { id: Tab; text: string }[] = [
    { id: "part", text: t("webcamTabPart") },
    { id: "whole", text: t("webcamTabWhole") },
  ];
  // Arrows move along the strip, wrapping at the ends, and focus follows the selection.
  const onTabKeyDown = (event: React.KeyboardEvent): void => {
    // Space activates the focused tab (the browser turns it into a click). The page listens on
    // `window` and treats Space as play/pause, so it must not travel past the tab strip.
    if (event.key === " ") event.stopPropagation();
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const at = tabs.findIndex((entry) => entry.id === tab);
    const next = tabs[(at + step + tabs.length) % tabs.length].id;
    setTab(next);
    tabButtons.current[next]?.focus();
  };
  return (
    <section
      {...uiArea("editorVideo.webcamPanel")}
      className={styles.panel}
      aria-label={t("webcamTitle")}
      data-webcam-panel={tab}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{t("webcamTitle")}</h2>
      </header>
      <div
        className={webcamStyles.tabs}
        role="tablist"
        aria-label={t("webcamTabsAria")}
        onKeyDown={onTabKeyDown}
      >
        {tabs.map((entry) => (
          <button
            key={entry.id}
            ref={(node) => {
              tabButtons.current[entry.id] = node;
            }}
            type="button"
            role="tab"
            id={`webcam-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls="webcam-tabpanel"
            tabIndex={tab === entry.id ? 0 : -1}
            className={tab === entry.id ? webcamStyles.tabActive : webcamStyles.tab}
            onClick={() => setTab(entry.id)}
          >
            {entry.text}
          </button>
        ))}
      </div>
      <div
        id="webcam-tabpanel"
        role="tabpanel"
        aria-labelledby={`webcam-tab-${tab}`}
        className={webcamStyles.tabBody}
      >
        {tab === "whole" ? (
          <>
            <PlaceBlock layout={webcam.layout} frame={frame} label={t("webcamMarkOriginal")} />
            <WholeVideoControls layout={webcam.layout} edits={edits} />
          </>
        ) : segment && range ? (
          <PartTab
            webcam={webcam}
            part={segment}
            range={range}
            edits={edits}
            frame={frame}
            onPlaySlide={onPlaySlide}
            onRemoved={onRemoved}
          />
        ) : (
          <NoPartTab playhead={playhead} />
        )}
      </div>
    </section>
  );
}
