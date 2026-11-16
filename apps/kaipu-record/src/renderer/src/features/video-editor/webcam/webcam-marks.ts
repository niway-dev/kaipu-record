/**
 * What the paused preview marks around the camera bubble (camera parts, drag-first): the
 * label that says what a drag would edit, where a part's camera comes from (the ghost bubble,
 * the dotted route and the chip), and the outline of a hidden range. Pure: the component only
 * draws it, so the rules (which label, which ghost, which chip) are pinned by tests.
 *
 * EDITOR ONLY. Nothing here is drawn while playing or exported, and the export composer must
 * never import this file: a mark in the MP4 would be baked into the user's video. A test
 * reads the export folder's imports to hold that line.
 *
 * Places are in FRAME PIXELS, like `webcamRoute`; the route is the same curve, from the same
 * boxes and reach, that `webcamStateRect` plays, so what is drawn is what slides.
 */
import { type FrameSize, webcamClipPath, webcamRect, webcamStateRect } from "./webcam-layout";
import { webcamRoute, type RoutePoint, type WebcamRoute } from "./webcam-route";
import {
  webcamEffectiveTransitionMs,
  webcamEndSeconds,
  webcamOverrideAt,
  webcamStateAt,
  type WebcamLayout,
  type WebcamScene,
  type WebcamSegment,
} from "./webcam-model";

/** A part ends where another starts within this many seconds: the ghost is "Before". */
const TOUCH_EPSILON = 1e-6;

export type WebcamMarkLabel =
  | { kind: "original" }
  | { kind: "part"; start: number; end: number }
  | { kind: "sliding" };

export type WebcamMarkChip = { kind: "slide"; seconds: number } | { kind: "cut" };

export interface WebcamMarkBox {
  width: number;
  height: number;
}

export interface WebcamMarks {
  /** The bubble as it is drawn at this time, or null when a hidden range covers it. */
  bubble: { center: RoutePoint; box: WebcamMarkBox } | null;
  /** What a drag edits; null where there is no bubble to label. */
  label: WebcamMarkLabel | null;
  /** Where the part in force comes from; null when no part is in force or one is sliding. */
  from: {
    route: WebcamRoute;
    box: WebcamMarkBox;
    /** CSS `clip-path` of the part's bubble shape, for the ghost. */
    clipPath: string;
    /** "Before" when a part ends exactly where this one starts, otherwise "Original". */
    ghost: "before" | "original";
    chip: WebcamMarkChip;
  } | null;
  /** Where the camera would be inside a hidden range. */
  hidden: {
    center: RoutePoint;
    box: WebcamMarkBox;
    shape: WebcamLayout["shape"];
    cornerRadius: number;
  } | null;
}

export interface WebcamMarksInput {
  webcam: WebcamScene;
  /** The playhead in SOURCE seconds; null over a slide clip, where there is no camera. */
  sourceTime: number | null;
  /** The selected segment's id (a part or a hidden range), or null. */
  selectedId: string | null;
  frame: FrameSize;
  /** The camera path's scale at `sourceTime`, as the bubble's own size follows it. */
  cameraScale?: number;
  /** The recording's length in source seconds, as the bubble's last return takes it. */
  endSeconds?: number;
}

const layoutOf = (webcam: WebcamScene, segment: WebcamSegment | undefined): WebcamLayout =>
  segment?.layout ? { ...webcam.layout, ...segment.layout } : webcam.layout;

const centerOf = (rect: { x: number; y: number; width: number; height: number }): RoutePoint => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

/** The chip on the route: the part's slide at its real length, or Cut. */
function chipOf(part: WebcamSegment): WebcamMarkChip {
  const transition = part.transition;
  if (transition?.kind !== "slide") return { kind: "cut" };
  return {
    kind: "slide",
    seconds: webcamEffectiveTransitionMs(part.end - part.start, transition.ms) / 1000,
  };
}

/**
 * The marks at one paused instant, or null when there are none to draw (no webcam time, an
 * empty frame). The label follows what a drag edits: "sliding" mid-slide, the part's range
 * inside a part, the original position elsewhere. The route is for the selected part or, with
 * none selected, the part under the playhead; it starts at the place that stretch comes from
 * (the previous part when it ends exactly here, otherwise the original position) and ends at
 * the part's own place, and it is left out while a slide is under way.
 */
export function webcamMarks(input: WebcamMarksInput): WebcamMarks | null {
  const { webcam, sourceTime, selectedId, frame } = input;
  if (sourceTime === null) return null;
  const scale = input.cameraScale ?? 1;
  const hidden = webcam.segments.find(
    (s) => s.mode === "hidden" && sourceTime >= s.start && sourceTime < s.end,
  );
  if (hidden) {
    // The camera is not drawn: the outline marks where the default layout would put it.
    const rect = webcamRect(webcam.layout, frame, scale);
    if (!rect) return null;
    return {
      bubble: null,
      label: null,
      from: null,
      hidden: {
        center: centerOf(rect),
        box: { width: rect.width, height: rect.height },
        shape: webcam.layout.shape,
        cornerRadius: webcam.layout.cornerRadius,
      },
    };
  }
  const state = webcamStateAt({ webcam }, sourceTime, webcamEndSeconds(input.endSeconds));
  const rect = state && webcamStateRect(state, frame, scale);
  if (!state || !rect) return null;

  const partNow = webcamOverrideAt(webcam, sourceTime);
  const sliding = state.from !== null;
  const label: WebcamMarkLabel = sliding
    ? { kind: "sliding" }
    : partNow
      ? { kind: "part", start: partNow.start, end: partNow.end }
      : { kind: "original" };

  const selected = webcam.segments.find((s) => s.id === selectedId && s.mode === "override");
  const shown = selected ?? partNow;
  let from: WebcamMarks["from"] = null;
  if (shown && !sliding) {
    const index = webcam.segments.indexOf(shown);
    const previous = webcam.segments[index - 1];
    const touching =
      !!previous &&
      previous.mode === "override" &&
      Math.abs(previous.end - shown.start) <= TOUCH_EPSILON;
    const target = webcamRect(layoutOf(webcam, shown), frame, scale);
    const origin = webcamRect(layoutOf(webcam, touching ? previous : undefined), frame, scale);
    if (target && origin) {
      const { width, height } = target;
      // The reach `webcamStateRect` slides inside: the frame minus half the box.
      const reach = {
        minX: width / 2,
        maxX: frame.width - width / 2,
        minY: height / 2,
        maxY: frame.height - height / 2,
      };
      from = {
        route: webcamRoute(centerOf(origin), centerOf(target), frame, reach),
        box: { width, height },
        clipPath: webcamClipPath(
          layoutOf(webcam, shown).shape,
          layoutOf(webcam, shown).cornerRadius,
        ),
        ghost: touching ? "before" : "original",
        chip: chipOf(shown),
      };
    }
  }
  return {
    bubble: { center: centerOf(rect), box: { width: rect.width, height: rect.height } },
    label,
    from,
    hidden: null,
  };
}
