---
title: "Video editor v2 — 06 time base, cuts and mapping"
description: "Zoom segments and redactions live in source time. This document works out every consequence: timeline blocks per visible piece, hidden ranges in deleted footage, counts, edge handles, drags over slides, the no-overlap rule for zooms, placing new ranges at the playhead, and what stays timeline-anchored. Fixes audit W10."
sidebar:
  order: 6
---

# 06 — Time base, cuts and mapping

> **Status: 🟡 In progress** (2026-09-22). Pure part in PR 4, UI rules applied in PRs 6
> and 8 ([audit](/plans/video-editor-v2/00-audit/)). Fixes W10. Resolves overview
> decision 1. Implemented across `feat/video-editor-v2-zoom-math`,
> `feat/video-editor-v2-timeline-lanes` and `feat/video-editor-v2-redactions` — none
> merged, none validated in production; see the
> [backlog PR table](/backlog/video-editor-zoom-blur-cover/).

## Decision

**Zoom segments and redactions are anchored to SOURCE seconds** (position in the original
recording). Annotations (`box`/`arrow`/`text` overlays) **stay timeline-anchored** as
today; nothing about them changes.

Why source time is required, not just preferred:

- The camera path ([05](/plans/video-editor-v2/05-camera-path-model/)) is simulated over
  source time. Cuts, trims, reorders and slides never invalidate it; a timeline-anchored
  camera would have to be re-simulated and re-anchored on every cut.
- A redaction describes _where the secret is in the footage_. If it were timeline-anchored,
  deleting 2 s before it would slide the redaction 2 s away from its secret — the export
  would show it. Source anchoring makes that impossible by construction.
- The cursor track is in source time already.

## Consequences and rules

| Situation                                          | Rule                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Range inside one kept clip                         | One block on its lane.                                                                                                                                                                                                                                            |
| Range spans a cut                                  | One block **per visible piece** (`sourceRangeToTimelineBlocks`), all with the same id. Clicking any piece selects the whole range.                                                                                                                                |
| Range entirely in deleted footage                  | Kept in the scene (undo of the cut brings it back), **not rendered, not counted, not exported, not selectable**.                                                                                                                                                  |
| Counts ("4 zooms detected", "2 private regions")   | Count ranges with ≥ 1 visible block.                                                                                                                                                                                                                              |
| Edge handles                                       | The **start** handle is drawn only on the block whose `sourceStart === range.start`; the **end** handle only on the block whose `sourceEnd === range.end`. Inner cut edges get no handle.                                                                         |
| Dragging an edge                                   | Pointer timeline time → `sourceTimeAtTimeline(layout, t)`. Over a slide it returns `null` → ignore that `move` event (the edge stays where it was). Then `dragRangeEdge(...)`.                                                                                    |
| Zoom overlap                                       | **Zooms never overlap** (the camera assumes one active segment). `dragRangeEdge(zoomSiblings, …)` stops at neighbours. New zooms use `freeWindowAt`. Detection output is non-overlapping by construction; `replaceAutoSegments` drops autos overlapping a manual. |
| Redaction overlap                                  | Allowed (two secrets can be on screen at once). Pass `siblings = [the range itself]` to `dragRangeEdge`.                                                                                                                                                          |
| Minimum length                                     | 1 s for both (`ZOOM_LIMITS.minSeconds`, `REDACTION.minSeconds`), measured in source time.                                                                                                                                                                         |
| New zoom at the playhead (Zoom tool, "add a zoom") | `src = sourceTimeAtTimeline(layout, playhead)`; `null` (slide) → toast `videoEditor.zoomNotOnSlide`. Else `freeWindowAt(zooms, src, 3, sourceDuration, 1)`; `null` → toast `videoEditor.zoomNoRoom`.                                                              |
| New redaction (drawn)                              | `start = src`, `end = min(src + 5, sourceDuration)`; on a slide the Blur/Cover tools are disabled (a slide has no footage to redact).                                                                                                                             |
| Selecting a zoom                                   | Seek the playhead to the **timeline** middle of its first visible block (spec § 6.3 "moves the playhead to its center").                                                                                                                                          |
| `sourceDuration`                                   | `source.durationSeconds` (what `initialScene` already uses as the clip end). Footage past it is already outside every clip.                                                                                                                                       |
| Slides                                             | No camera (identity), no redactions, no cursor. The preview and export treat a slide frame exactly as today.                                                                                                                                                      |

## Files

| Action | Path (under `apps/kaipu-record/src/renderer/src/features/video-editor/`) |
| ------ | ------------------------------------------------------------------------ |
| Create | `source-time.ts` + `.test.ts`                                            |

## Task 1 — source-time helpers

This is the only module allowed to map source-anchored ranges onto the timeline; it
builds on `LayoutEntry` from `timeline.ts` (same "one mapping module" rule as that file's
header).

**`apps/kaipu-record/src/renderer/src/features/video-editor/source-time.ts`**

```ts
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
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/source-time.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { TrackItem } from "./scene";
import { toLayout } from "./timeline";
import {
  dragRangeEdge,
  freeWindowAt,
  isSourceRangeVisible,
  sourceRangeToTimelineBlocks,
  sourceTimeAtTimeline,
} from "./source-time";

// Source 0–30 s, with 10–15 s deleted and a 3 s slide inserted between the pieces.
const items: TrackItem[] = [
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
  { id: "s", kind: "slide", assetId: "img", duration: 3, naturalWidth: 10, naturalHeight: 10 },
  { id: "b", kind: "clip", sourceStart: 15, sourceEnd: 30 },
];
const layout = toLayout(items);

describe("sourceRangeToTimelineBlocks", () => {
  it("maps a range inside one clip", () => {
    expect(sourceRangeToTimelineBlocks(layout, 2, 4)).toEqual([
      { itemId: "a", timelineStart: 2, timelineEnd: 4, sourceStart: 2, sourceEnd: 4 },
    ]);
  });
  it("splits a range across a cut into two blocks", () => {
    expect(sourceRangeToTimelineBlocks(layout, 8, 17)).toEqual([
      { itemId: "a", timelineStart: 8, timelineEnd: 10, sourceStart: 8, sourceEnd: 10 },
      { itemId: "b", timelineStart: 13, timelineEnd: 15, sourceStart: 15, sourceEnd: 17 },
    ]);
  });
  it("hides a range entirely in deleted footage", () => {
    expect(isSourceRangeVisible(layout, 11, 14)).toBe(false);
  });
});

describe("sourceTimeAtTimeline", () => {
  it("maps clips and returns null over slides", () => {
    expect(sourceTimeAtTimeline(layout, 5)).toBe(5);
    expect(sourceTimeAtTimeline(layout, 11)).toBeNull();
    expect(sourceTimeAtTimeline(layout, 14)).toBe(16);
  });
});

describe("dragRangeEdge", () => {
  const ranges = [
    { id: "x", start: 2, end: 5 },
    { id: "y", start: 8, end: 12 },
  ];
  it("stops at the neighbour", () => {
    expect(dragRangeEdge(ranges, "y", "start", 3, 30, 1)).toEqual({ start: 5, end: 12 });
    expect(dragRangeEdge(ranges, "x", "end", 10, 30, 1)).toEqual({ start: 2, end: 8 });
  });
  it("keeps the minimum length", () => {
    expect(dragRangeEdge(ranges, "x", "start", 4.9, 30, 1)).toEqual({ start: 4, end: 5 });
    expect(dragRangeEdge(ranges, "y", "end", 8.2, 30, 1)).toEqual({ start: 8, end: 9 });
  });
  it("stays inside the source", () => {
    expect(dragRangeEdge(ranges, "x", "start", -3, 30, 1)).toEqual({ start: 0, end: 5 });
    expect(dragRangeEdge(ranges, "y", "end", 99, 30, 1)).toEqual({ start: 8, end: 30 });
  });
});

describe("freeWindowAt", () => {
  const ranges = [{ id: "x", start: 5, end: 8 }];
  it("fits before the next range", () => {
    expect(freeWindowAt(ranges, 3, 3, 30, 1)).toEqual({ start: 3, end: 5 });
  });
  it("refuses inside a range or when less than the minimum fits", () => {
    expect(freeWindowAt(ranges, 6, 3, 30, 1)).toBeNull();
    expect(freeWindowAt(ranges, 4.5, 3, 30, 1)).toBeNull();
  });
});
```

## i18n keys (added in PR 6)

| Key                          | es                                                                      | en                                                     |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `videoEditor.zoomNotOnSlide` | Las imágenes no tienen zoom. Mueve el cursor de reproducción a un clip. | Images can't be zoomed. Move the playhead onto a clip. |
| `videoEditor.zoomNoRoom`     | No hay espacio para otro zoom aquí.                                     | There's no room for another zoom here.                 |

## Acceptance criteria

- A cut before a zoom or redaction never changes its source range (unit-level: nothing
  in `timeline.ts` touches `zoomSegments`/`redactions`; add no clamp for them in
  `handleTrim` / `handleDeleteSelected`).
- Undoing a cut restores the visibility of ranges that were hidden by it.

## Non-goals

Moving a whole range by dragging its body (v2 has edge drags only, like the spec);
ranges on slides.

## Reopen if

Users need body-drag to retime a zoom (add a `dragRangeBody` helper with the same
neighbour clamping).
