/**
 * Pure timeline math — the ONLY place that maps timeline time ↔ source time.
 * Private copies of this mapping logic WILL drift and desync preview from export;
 * every consumer (preview, timeline UI, export) must import from this module.
 */
import type { TrackItem } from "./scene";

export const MIN_ITEM_DURATION = 0.1;

export interface LayoutEntry {
  itemId: string;
  kind: "clip" | "slide";
  timelineStart: number;
  timelineEnd: number;
  /** Clips: position in the source recording. Slides: 0..duration local clock. */
  sourceStart: number;
  sourceEnd: number;
}

export function itemDuration(item: TrackItem): number {
  return item.kind === "clip" ? item.sourceEnd - item.sourceStart : item.duration;
}

export function toLayout(items: TrackItem[]): LayoutEntry[] {
  const layout: LayoutEntry[] = [];
  let cursor = 0;
  for (const item of items) {
    const duration = itemDuration(item);
    if (duration <= 0) continue;
    layout.push({
      itemId: item.id,
      kind: item.kind,
      timelineStart: cursor,
      timelineEnd: cursor + duration,
      sourceStart: item.kind === "clip" ? item.sourceStart : 0,
      sourceEnd: item.kind === "clip" ? item.sourceEnd : duration,
    });
    cursor += duration;
  }
  return layout;
}

export function layoutDuration(layout: LayoutEntry[]): number {
  return layout.length === 0 ? 0 : layout[layout.length - 1].timelineEnd;
}

export function entryAt(layout: LayoutEntry[], t: number): LayoutEntry | null {
  if (layout.length === 0) return null;
  const clamped = Math.max(0, Math.min(t, layoutDuration(layout)));
  for (const entry of layout) {
    if (clamped < entry.timelineEnd) return entry;
  }
  return layout[layout.length - 1];
}

export function timelineToSource(
  layout: LayoutEntry[],
  t: number,
): { entry: LayoutEntry; sourceTime: number } | null {
  const entry = entryAt(layout, t);
  if (!entry) return null;
  const offset = Math.max(
    0,
    Math.min(t - entry.timelineStart, entry.sourceEnd - entry.sourceStart),
  );
  return { entry, sourceTime: entry.sourceStart + offset };
}

export function sourceToTimeline(layout: LayoutEntry[], sourceTime: number): number | null {
  for (const entry of layout) {
    if (entry.kind !== "clip") continue;
    if (sourceTime >= entry.sourceStart && sourceTime <= entry.sourceEnd) {
      return entry.timelineStart + (sourceTime - entry.sourceStart);
    }
  }
  return null;
}
