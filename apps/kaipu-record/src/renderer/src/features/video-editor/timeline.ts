/**
 * Pure timeline math — the ONLY place that maps timeline time ↔ source time.
 * Private copies of this mapping logic WILL drift and desync preview from export;
 * every consumer (preview, timeline UI, export) must import from this module.
 */
import { newId, type TrackItem, type VideoOverlay } from "./scene";

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

/**
 * Split the clip under timeline time `t` into two clips. Returns the same array
 * reference when nothing changes so callers can skip a history commit.
 */
export function splitClipAt(items: TrackItem[], t: number): TrackItem[] {
  const layout = toLayout(items);
  const hit = entryAt(layout, t);
  if (!hit || hit.kind !== "clip") return items;
  const offset = t - hit.timelineStart;
  if (offset < MIN_ITEM_DURATION || hit.timelineEnd - t < MIN_ITEM_DURATION) return items;
  return items.flatMap((item) => {
    if (item.id !== hit.itemId || item.kind !== "clip") return [item];
    const cut = item.sourceStart + offset;
    return [
      { ...item, id: newId(), sourceEnd: cut },
      { ...item, id: newId(), sourceStart: cut },
    ];
  });
}

export function removeItem(items: TrackItem[], itemId: string): TrackItem[] {
  return items.filter((item) => item.id !== itemId);
}

export function trimClip(
  items: TrackItem[],
  itemId: string,
  edge: "start" | "end",
  sourceTime: number,
): TrackItem[] {
  return items.map((item) => {
    if (item.id !== itemId || item.kind !== "clip") return item;
    if (edge === "start") {
      const next = Math.min(Math.max(0, sourceTime), item.sourceEnd - MIN_ITEM_DURATION);
      return { ...item, sourceStart: next };
    }
    const next = Math.max(sourceTime, item.sourceStart + MIN_ITEM_DURATION);
    return { ...item, sourceEnd: next };
  });
}

export function insertItemAt(items: TrackItem[], index: number, item: TrackItem): TrackItem[] {
  const next = items.slice();
  next.splice(index, 0, item);
  return next;
}

/** Index in `items` of the track boundary nearest to timeline time `t`. */
export function boundaryIndexAt(layout: LayoutEntry[], t: number): number {
  let best = 0;
  let bestDistance = Math.abs(t);
  layout.forEach((entry, i) => {
    const distance = Math.abs(t - entry.timelineEnd);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i + 1;
    }
  });
  return best;
}

export function setSlideDuration(
  items: TrackItem[],
  itemId: string,
  duration: number,
): TrackItem[] {
  return items.map((item) =>
    item.id === itemId && item.kind === "slide"
      ? { ...item, duration: Math.max(MIN_ITEM_DURATION, duration) }
      : item,
  );
}

/**
 * Overlays are timeline-anchored; after an edit shortens the timeline, windows are
 * clamped into [0, duration] and overlays that fall entirely off the end are dropped.
 * Simple and predictable beats clever remapping in a quick editor.
 */
export function clampOverlays(overlays: VideoOverlay[], duration: number): VideoOverlay[] {
  return overlays
    .filter((o) => o.start < duration - 0.01)
    .map((o) => (o.end > duration ? { ...o, end: duration } : o));
}
