/**
 * What the Camera lane draws (camera parts, drag-first): EVERY stretch of the recording, not
 * only the blocks. The default position fills the gaps between parts and hidden ranges as
 * "original" stretches (dashed, never selectable); a part is an override block; a hidden range
 * is a hidden block. Pure, so the lane's rules are pinned by tests instead of living in JSX.
 *
 * All times are SOURCE seconds, like the segments; pixel helpers take pixels measured on the
 * lane (seconds × the strip's scale), so the lane itself does no arithmetic of its own.
 */
import { webcamPositionName, type WebcamPositionName } from "./webcam-names";
import { type FrameSize, webcamRect } from "./webcam-layout";
import {
  webcamEffectiveTransitionMs,
  type WebcamEasing,
  type WebcamLayout,
  type WebcamScene,
  type WebcamSegment,
} from "./webcam-model";

export type WebcamStretch =
  | { kind: "original"; start: number; end: number }
  | { kind: "part"; id: string; start: number; end: number; segment: WebcamSegment }
  | { kind: "hidden"; id: string; start: number; end: number };

/** A gap shorter than this is float noise between two touching blocks, not an original stretch. */
const GAP_EPSILON = 1e-3;

/**
 * The stretches of `[0, sourceDuration]` in order: each segment as a part or a hidden range,
 * and the gaps between them (and before the first, after the last) as original stretches.
 * Segments are sorted and apart in a scene; a copy is sorted anyway so a stray order cannot
 * draw one over another. Time past `sourceDuration` gets no original stretch.
 */
export function webcamLaneStretches(
  webcam: Pick<WebcamScene, "segments">,
  sourceDuration: number,
): WebcamStretch[] {
  const segments = [...webcam.segments].sort((a, b) => a.start - b.start);
  const stretches: WebcamStretch[] = [];
  const total = Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : 0;
  let cursor = 0;
  for (const segment of segments) {
    if (segment.start > cursor + GAP_EPSILON) {
      stretches.push({ kind: "original", start: cursor, end: segment.start });
    }
    stretches.push(
      segment.mode === "hidden"
        ? { kind: "hidden", id: segment.id, start: segment.start, end: segment.end }
        : { kind: "part", id: segment.id, start: segment.start, end: segment.end, segment },
    );
    cursor = Math.max(cursor, segment.end);
  }
  if (total > cursor + GAP_EPSILON) stretches.push({ kind: "original", start: cursor, end: total });
  return stretches;
}

/** The layout a stretch shows: a part's own over the default; null for a hidden range. */
export function webcamStretchLayout(
  webcam: Pick<WebcamScene, "layout">,
  stretch: WebcamStretch,
): WebcamLayout | null {
  if (stretch.kind === "hidden") return null;
  if (stretch.kind === "original") return webcam.layout;
  return stretch.segment.layout ? { ...webcam.layout, ...stretch.segment.layout } : webcam.layout;
}

/** The place's name when a lane has not measured the frame yet: a 16:9 output. */
export const NOMINAL_LANE_FRAME: FrameSize = { width: 1920, height: 1080 };

/**
 * The name of the place a layout holds the camera at. The box is the one the bubble is drawn
 * with, so the thirds are over the range its centre can reach. Null for a frame with no room.
 */
export function webcamLayoutName(
  layout: WebcamLayout,
  frame: FrameSize,
): WebcamPositionName | null {
  const usable = frame.width > 0 && frame.height > 0 ? frame : NOMINAL_LANE_FRAME;
  const rect = webcamRect(layout, usable);
  if (!rect) return null;
  return webcamPositionName(layout.position, usable, rect);
}

/**
 * Where a small frame's dot goes: the bubble centre's share (0 to 1) of the range it can reach
 * on each axis. A bubble as big as the frame has no range and sits in the middle.
 */
export function webcamLayoutDot(
  layout: WebcamLayout,
  frame: FrameSize,
): { x: number; y: number } | null {
  const usable = frame.width > 0 && frame.height > 0 ? frame : NOMINAL_LANE_FRAME;
  const rect = webcamRect(layout, usable);
  if (!rect) return null;
  const share = (center: number, box: number, length: number): number => {
    const span = length - box;
    return span > 0 ? Math.min(1, Math.max(0, (center - box / 2) / span)) : 0.5;
  };
  return {
    x: share(rect.x + rect.width / 2, rect.width, usable.width),
    y: share(rect.y + rect.height / 2, rect.height, usable.height),
  };
}

/** The name of the place a stretch holds the camera at (null for a hidden range). */
export function webcamStretchName(
  webcam: Pick<WebcamScene, "layout">,
  stretch: WebcamStretch,
  frame: FrameSize,
): WebcamPositionName | null {
  const layout = webcamStretchLayout(webcam, stretch);
  return layout ? webcamLayoutName(layout, frame) : null;
}

/** The small frame's dot for a stretch (null for a hidden range). */
export function webcamStretchDot(
  webcam: Pick<WebcamScene, "layout">,
  stretch: WebcamStretch,
  frame: FrameSize,
): { x: number; y: number } | null {
  const layout = webcamStretchLayout(webcam, stretch);
  return layout ? webcamLayoutDot(layout, frame) : null;
}

/** A part ends where another starts within this many seconds: the camera comes from "Before". */
const TOUCH_EPSILON = 1e-6;

/**
 * Where a part's camera comes from, as a layout: the previous part's when it ends exactly
 * where this one starts, otherwise the original position. The part's own size and shape are
 * kept, because only the position slides, so the panel's "before" dot is measured on the same
 * box as its "now" dot.
 */
export function webcamPartOrigin(webcam: WebcamScene, part: WebcamSegment): WebcamLayout {
  const own: WebcamLayout = part.layout ? { ...webcam.layout, ...part.layout } : webcam.layout;
  const previous = webcam.segments.find(
    (s) => s.mode === "override" && Math.abs(s.end - part.start) <= TOUCH_EPSILON,
  );
  const position = previous?.layout?.position ?? webcam.layout.position;
  return { ...own, position: { ...position } };
}

/**
 * How long a part's slide really lasts, in seconds, or null for a Cut (and for a part saved
 * without a transition, which is a Cut): the duration asked for, at most half the part.
 */
export function webcamPartSlideSeconds(segment: WebcamSegment): number | null {
  const transition = segment.transition;
  if (segment.mode !== "override" || transition?.kind !== "slide") return null;
  return webcamEffectiveTransitionMs(segment.end - segment.start, transition.ms) / 1000;
}

/** What the lane's hover card says about one stretch (spec decision 16). Source seconds. */
export interface WebcamStretchCard {
  kind: WebcamStretch["kind"];
  /** The place the camera is held at; null for a hidden range, which has none. */
  name: WebcamPositionName | null;
  start: number;
  end: number;
  /** How a part arrives: a slide (its real length and easing) or a cut; null for the others. */
  arrives: { kind: "slide"; seconds: number; easing: WebcamEasing } | { kind: "cut" } | null;
}

/** The facts of a stretch the hover card shows, from the same helpers the lane draws with. */
export function webcamStretchCard(
  webcam: Pick<WebcamScene, "layout">,
  stretch: WebcamStretch,
  frame: FrameSize,
): WebcamStretchCard {
  const name = webcamStretchName(webcam, stretch, frame);
  let arrives: WebcamStretchCard["arrives"] = null;
  if (stretch.kind === "part") {
    const slide = webcamPartSlideSeconds(stretch.segment);
    const easing = stretch.segment.transition?.easing;
    arrives =
      slide !== null && easing ? { kind: "slide", seconds: slide, easing } : { kind: "cut" };
  }
  return { kind: stretch.kind, name, start: stretch.start, end: stretch.end, arrives };
}

/**
 * A part or hidden range narrower than this (px) is still drawn this wide, so it never
 * vanishes from the lane (spec decision 12). Never past the start of the next one.
 */
export const LANE_FLOOR_PX = 3;

/** A part or hidden range drawn narrower than this (px) still has a click target this wide. */
export const LANE_TARGET_PX = 12;

/**
 * A selected part's two handles are at least this far apart (px, centre to centre). With a
 * handle 6 px wide that leaves 4 px between them.
 */
export const HANDLE_APART_PX = 10;

/** One drawn piece of a stretch, in pixels from the lane's left edge. */
export interface LanePiece {
  kind: WebcamStretch["kind"];
  left: number;
  right: number;
  /**
   * Where the clip holding this piece ends, in the same pixels. A slide or the next clip
   * follows it, and there is no webcam there, so a part is never widened past it.
   */
  clipRight?: number;
}

/** A box in pixels from the lane's left edge. */
export interface LaneBox {
  left: number;
  width: number;
}

/** Where a piece is really drawn. */
export type LanePlacement = LaneBox;

/** A part and a hidden range are the stretches a click can select; an original is only fill. */
const isTargetable = (piece: LanePiece): boolean => piece.kind !== "original";

/**
 * Where each piece is drawn (spec decision 12): from its real start to its real end. An
 * original stretch is never displaced and a part never borrows width from what follows it.
 * The one exception is the floor: a part or hidden range narrower than {@link LANE_FLOOR_PX}
 * is drawn that wide so it stays visible, and never past the start of the next part or hidden
 * range, the lane's end, or the end of its own clip (a slide or another clip follows there,
 * and no webcam exists on it). `pieces` are in order, left to right; the result is index by index.
 */
export function webcamLanePlacements(pieces: LanePiece[], laneWidth: number): LanePlacement[] {
  return pieces.map((piece, i) => {
    const natural = Math.max(0, piece.right - piece.left);
    if (!isTargetable(piece) || natural >= LANE_FLOOR_PX) {
      return { left: piece.left, width: natural };
    }
    const next = pieces.slice(i + 1).find(isTargetable);
    const limit = Math.min(next ? next.left : laneWidth, piece.clipRight ?? Infinity);
    const room = Math.max(0, limit - piece.left);
    return { left: piece.left, width: Math.max(natural, Math.min(LANE_FLOOR_PX, room)) };
  });
}

/**
 * The click target of each piece: null for an original (never selectable). A part or hidden
 * range drawn narrower than {@link LANE_TARGET_PX} gets a target that wide, centred on it, so
 * a 3 px part is easy to hit; it never reaches over its neighbour: each side stops at the
 * midpoint of the gap to the next part or hidden range, and at the lane's edges. What is drawn
 * stays the real width; only the hit area grows. A piece 12 px or wider is its own target.
 */
export function webcamLaneTargets(
  pieces: LanePiece[],
  placements: LanePlacement[],
  laneWidth: number,
): (LaneBox | null)[] {
  const order = pieces.map((_, i) => i).filter((i) => isTargetable(pieces[i]!));
  return pieces.map((piece, i) => {
    if (!isTargetable(piece)) return null;
    const mine = placements[i]!;
    const want = Math.max(0, (LANE_TARGET_PX - mine.width) / 2);
    const at = order.indexOf(i);
    const prev = at > 0 ? placements[order[at - 1]!]! : null;
    const next = at < order.length - 1 ? placements[order[at + 1]!]! : null;
    const roomLeft = prev ? (mine.left - (prev.left + prev.width)) / 2 : mine.left;
    const roomRight = next
      ? (next.left - (mine.left + mine.width)) / 2
      : laneWidth - (mine.left + mine.width);
    const left = mine.left - Math.min(want, Math.max(0, roomLeft));
    const right = mine.left + mine.width + Math.min(want, Math.max(0, roomRight));
    return { left, width: right - left };
  });
}

/**
 * The piece under a pointer at `x` px from the lane's left edge, by the click rule: a part or
 * hidden range answers inside its click target, an original stretch inside what is drawn.
 * Null when `x` is over nothing (the lane has no stretch there).
 */
export function webcamLanePieceAt(
  pieces: LanePiece[],
  placements: LanePlacement[],
  targets: (LaneBox | null)[],
  x: number,
): number | null {
  const inside = (box: LaneBox): boolean => x >= box.left && x < box.left + box.width;
  for (let i = 0; i < pieces.length; i++) {
    const target = targets[i];
    if (target && inside(target)) return i;
  }
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i]!.kind === "original" && inside(placements[i]!)) return i;
  }
  return null;
}

/**
 * How far each handle of a selected part moves outward from its real edge (px) so the two are
 * at least {@link HANDLE_APART_PX} apart: 0 for a part 10 px or wider, growing continuously
 * as it narrows. `widthPx` is the real distance between the part's edges.
 */
export function webcamHandleShift(widthPx: number): number {
  return Math.max(0, (HANDLE_APART_PX - Math.max(0, widthPx)) / 2);
}
