/**
 * Source-time ↔ timeline helpers for SOURCE-anchored ranges (zoom segments and
 * redactions). Lives next to timeline.ts and builds only on its LayoutEntry — never
 * re-derive the clip mapping anywhere else (see timeline.ts header).
 *
 * A source range can appear 0, 1 or many times on the timeline:
 *   - 0: it lies entirely in deleted footage → hidden, not counted, not exported
 *   - 1: the usual case
 *   - many: a cut (or a reorder) splits it → one block per visible piece, all with
 *     the same id, so clicking any piece selects the whole range
 */
import type { LayoutEntry } from "./timeline";

export interface TimelineBlock {
  itemId: string;
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

/** Visible pieces of source range [start, end) on the timeline, in timeline order. */
export function sourceRangeToTimelineBlocks(
  layout: LayoutEntry[],
  start: number,
  end: number,
): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  for (const entry of layout) {
    if (entry.kind !== "clip") continue;
    const s = Math.max(start, entry.sourceStart);
    const e = Math.min(end, entry.sourceEnd);
    if (e - s <= 1e-6) continue;
    blocks.push({
      itemId: entry.itemId,
      timelineStart: entry.timelineStart + (s - entry.sourceStart),
      timelineEnd: entry.timelineStart + (e - entry.sourceStart),
      sourceStart: s,
      sourceEnd: e,
    });
  }
  return blocks;
}

export function isSourceRangeVisible(layout: LayoutEntry[], start: number, end: number): boolean {
  return sourceRangeToTimelineBlocks(layout, start, end).length > 0;
}

/**
 * Source time under timeline time `t`, or null when `t` is over a slide (a slide has
 * no source footage, so nothing source-anchored can start or end there).
 */
export function sourceTimeAtTimeline(layout: LayoutEntry[], t: number): number | null {
  for (const entry of layout) {
    if (t < entry.timelineStart || t > entry.timelineEnd) continue;
    if (entry.kind !== "clip") return null;
    return entry.sourceStart + (t - entry.timelineStart);
  }
  return null;
}

export interface SourceRange {
  id: string;
  start: number;
  end: number;
}

/**
 * New [start, end] for dragging one edge of range `id` to source time `to`, keeping
 * `minSeconds` of length, staying inside [0, sourceDuration] and never crossing the
 * neighbouring ranges in `siblings` (zooms must not overlap: the camera assumes one
 * active segment at a time). Pass `siblings = []` for redactions (they may overlap).
 */
export function dragRangeEdge(
  siblings: SourceRange[],
  id: string,
  edge: "start" | "end",
  to: number,
  sourceDuration: number,
  minSeconds: number,
): { start: number; end: number } {
  const self = siblings.find((r) => r.id === id);
  if (!self) throw new Error(`dragRangeEdge: unknown range ${id}`);
  const others = siblings.filter((r) => r.id !== id);
  if (edge === "start") {
    const floor = Math.max(0, ...others.filter((r) => r.end <= self.start).map((r) => r.end));
    const start = Math.min(Math.max(to, floor), self.end - minSeconds);
    return { start: Math.max(floor, start), end: self.end };
  }
  const ceiling = Math.min(
    sourceDuration,
    ...others.filter((r) => r.start >= self.end).map((r) => r.start),
  );
  const end = Math.max(Math.min(to, ceiling), self.start + minSeconds);
  return { start: self.start, end: Math.min(ceiling, end) };
}

/**
 * The free source window [start, end) of length ≤ `seconds` starting at `at`, clipped
 * to the next sibling and the source end; null when less than `minSeconds` fits.
 * Used to place a hand-made zoom at the playhead without overlapping another zoom.
 */
export function freeWindowAt(
  siblings: SourceRange[],
  at: number,
  seconds: number,
  sourceDuration: number,
  minSeconds: number,
): { start: number; end: number } | null {
  if (siblings.some((r) => at >= r.start && at < r.end)) return null;
  const next = Math.min(
    sourceDuration,
    ...siblings.filter((r) => r.start >= at).map((r) => r.start),
  );
  const end = Math.min(at + seconds, next);
  return end - at >= minSeconds ? { start: at, end } : null;
}
