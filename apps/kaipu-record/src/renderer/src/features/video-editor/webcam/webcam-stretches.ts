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
 * The name of the place a stretch holds the camera at (null for a hidden range). The box is
 * the one the bubble is drawn with, so the thirds are over the range its centre can reach.
 */
export function webcamStretchName(
  webcam: Pick<WebcamScene, "layout">,
  stretch: WebcamStretch,
  frame: FrameSize,
): WebcamPositionName | null {
  const layout = webcamStretchLayout(webcam, stretch);
  if (!layout) return null;
  const usable = frame.width > 0 && frame.height > 0 ? frame : NOMINAL_LANE_FRAME;
  const rect = webcamRect(layout, usable);
  if (!rect) return null;
  return webcamPositionName(layout.position, usable, rect);
}

/**
 * Where the small frame's dot goes: the bubble centre's share (0 to 1) of the range it can
 * reach on each axis. Null for a hidden range. A bubble as big as the frame has no range and
 * sits in the middle.
 */
export function webcamStretchDot(
  webcam: Pick<WebcamScene, "layout">,
  stretch: WebcamStretch,
  frame: FrameSize,
): { x: number; y: number } | null {
  const layout = webcamStretchLayout(webcam, stretch);
  if (!layout) return null;
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

/**
 * How long a part's slide really lasts, in seconds, or null for a Cut (and for a part saved
 * without a transition, which is a Cut): the duration asked for, at most half the part.
 */
export function webcamPartSlideSeconds(segment: WebcamSegment): number | null {
  const transition = segment.transition;
  if (segment.mode !== "override" || transition?.kind !== "slide") return null;
  return webcamEffectiveTransitionMs(segment.end - segment.start, transition.ms) / 1000;
}

/** A part is drawn at least this wide (px) so its name fits and it is easy to grab. */
export const WEBCAM_PART_MIN_PX = 56;

/** One drawn piece of a stretch, in pixels from the lane's left edge. */
export interface LanePiece {
  kind: WebcamStretch["kind"];
  left: number;
  right: number;
}

/** Where a piece is really drawn. A `width` of 0 is not drawn at all. */
export interface LanePlacement {
  left: number;
  width: number;
}

/**
 * The 56 px rule (spec decision 12). A part is drawn at least {@link WEBCAM_PART_MIN_PX} wide
 * but never over its neighbour: the room it can take ends where the next part or hidden range
 * starts (or at the lane's end). With less room than that it is as wide as the room, and it
 * is still the same part. Original stretches are only fill, so a wider part covers the start
 * of the original after it: that stretch is drawn from where the part now ends (and not at all
 * when the part covers it). `pieces` are in order, left to right; the result is index by index.
 */
export function webcamLaneBlockWidths(
  pieces: LanePiece[],
  laneWidth: number,
  minPartWidth = WEBCAM_PART_MIN_PX,
): LanePlacement[] {
  const placements: LanePlacement[] = pieces.map((p) => ({
    left: p.left,
    width: Math.max(0, p.right - p.left),
  }));
  let blockEnd = 0;
  pieces.forEach((piece, i) => {
    const natural = Math.max(0, piece.right - piece.left);
    if (piece.kind === "part") {
      const next = pieces.slice(i + 1).find((p) => p.kind !== "original");
      const limit = next ? next.left : laneWidth;
      const room = Math.max(0, limit - piece.left);
      placements[i] = { left: piece.left, width: Math.max(natural, Math.min(minPartWidth, room)) };
    } else if (piece.kind === "original") {
      const left = Math.max(piece.left, blockEnd);
      placements[i] = { left, width: Math.max(0, piece.right - left) };
      return;
    }
    blockEnd = Math.max(blockEnd, placements[i]!.left + placements[i]!.width);
  });
  return placements;
}
