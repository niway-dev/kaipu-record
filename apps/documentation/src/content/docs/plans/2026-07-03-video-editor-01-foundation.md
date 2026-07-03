---
title: "Video editor 01 — foundation: scene, timeline math, editor page"
description: "First implementation plan for the video editor: VideoScene data model, pure timeline mapping module (TDD), the /video-editor route with basic playback, and the library entry point."
---

# Video editor 01 — foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recording in the library gains an "Editar video" button that opens a new
`/video-editor` page where the video plays, pauses (Space), and seeks — backed by the
`VideoScene` data model and a fully unit-tested pure timeline module that every later
plan builds on.

**Architecture:** `features/video-editor/scene.ts` defines the scene types;
`timeline.ts` is the only place that maps timeline time ↔ source time (pure functions,
TDD). The page follows the screenshot-editor shell pattern exactly: route state carries
the source, `key={location.key}` remounts, `setEditorWindowMode` grows the window.
Playback in this plan is the trivial single-clip case, but the controller is already
written entry-based so plans 03/05 extend it without rewrites.

**Tech Stack:** React 19 + react-router (hash router), CSS Modules, vitest. No new
dependencies.

**Design spec:** `apps/documentation/src/content/docs/specs/2026-07-03-video-editor-design.md`

## Global Constraints

- All work inside `apps/kaipu-record/` unless stated; repo root for commands.
- Code, comments, and identifiers in **English**; user-facing copy in **neutral Spanish**
  (no voseo, friendly). Example copy is given verbatim in each task — use it as-is.
- **No TS enums** — `as const` arrays + `(typeof X)[number]`.
- Kebab-case filenames; hooks are `use-*.ts` returning controller objects; pure logic
  modules get co-located `*.test.ts` (vitest).
- Comments explain **why** (constraints, gotchas), never what the next line does.
- Run `bunx oxfmt --check .` from the repo root before every commit; fix with
  `bunx oxfmt .` if it fails. Never `--no-verify`.
- Tests run with `bunx vitest run <path>` from `apps/kaipu-record/`.

---

### Task 1: Scene types and ids

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/scene.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/video-editor/scene.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `ClipItem`, `SlideItem`, `TrackItem`, `BoxOverlay`, `ArrowOverlay`,
  `TextOverlay`, `VideoOverlay`, `VideoScene`, `newId(): string`,
  `initialScene(durationSeconds: number): VideoScene` — every later plan imports these.

- [ ] **Step 1: Write the failing test**

```ts
// scene.test.ts
import { describe, expect, it } from "vitest";
import { initialScene, newId } from "./scene";

describe("initialScene", () => {
  it("creates a single clip covering the whole recording", () => {
    const scene = initialScene(92.5);
    expect(scene.overlays).toEqual([]);
    expect(scene.items).toHaveLength(1);
    const clip = scene.items[0];
    expect(clip.kind).toBe("clip");
    expect(clip).toMatchObject({ sourceStart: 0, sourceEnd: 92.5 });
  });

  it("generates unique ids", () => {
    expect(newId()).not.toBe(newId());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/features/video-editor/scene.test.ts`
Expected: FAIL — module `./scene` not found.

- [ ] **Step 3: Write the implementation**

```ts
// scene.ts
/**
 * Video-editor scene model. All overlay geometry is normalized 0–1 of the VIDEO frame
 * (same convention as screenshot annotations); all times are seconds. Overlays are
 * anchored to TIMELINE time (the edited result), not source time — see the design spec.
 */

export interface ClipItem {
  id: string;
  kind: "clip";
  /** Seconds into the source recording. */
  sourceStart: number;
  /** Exclusive end, always > sourceStart. */
  sourceEnd: number;
}

export interface SlideItem {
  id: string;
  kind: "slide";
  /** Image stored as an edit-session asset in the vault (plan 06 persists it). */
  assetId: string;
  /** Seconds the image is held on screen. */
  duration: number;
  naturalWidth: number;
  naturalHeight: number;
}

export type TrackItem = ClipItem | SlideItem;

interface OverlayBase {
  id: string;
  /** Visibility window in timeline seconds. */
  start: number;
  end: number;
  color: string;
}

export interface BoxOverlay extends OverlayBase {
  kind: "box";
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: number;
  seed: number;
}

export interface ArrowOverlay extends OverlayBase {
  kind: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: number;
  seed: number;
}

export interface TextOverlay extends OverlayBase {
  kind: "text";
  x: number;
  y: number;
  text: string;
  /** Display px at preview scale, snapped to TEXT_PX levels like screenshots. */
  size: number;
}

export type VideoOverlay = BoxOverlay | ArrowOverlay | TextOverlay;

export interface VideoScene {
  /** The main track in playback order; uncovered source footage is deleted footage. */
  items: TrackItem[];
  overlays: VideoOverlay[];
}

export function newId(): string {
  return crypto.randomUUID();
}

export function initialScene(durationSeconds: number): VideoScene {
  return {
    items: [{ id: newId(), kind: "clip", sourceStart: 0, sourceEnd: durationSeconds }],
    overlays: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/features/video-editor/scene.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Format and commit**

```bash
bunx oxfmt . && git add apps/kaipu-record/src/renderer/src/features/video-editor && git commit -m "feat(video-editor): scene data model"
```

---

### Task 2: Pure timeline module — layout and time mapping

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/timeline.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/video-editor/timeline.test.ts`

**Interfaces:**

- Consumes: `TrackItem`, `VideoOverlay` from `./scene`.
- Produces (exact signatures — plans 02–06 all import these):
  - `MIN_ITEM_DURATION = 0.1`
  - `interface LayoutEntry { itemId: string; kind: "clip" | "slide"; timelineStart: number; timelineEnd: number; sourceStart: number; sourceEnd: number }`
  - `itemDuration(item: TrackItem): number`
  - `toLayout(items: TrackItem[]): LayoutEntry[]`
  - `layoutDuration(layout: LayoutEntry[]): number`
  - `entryAt(layout: LayoutEntry[], t: number): LayoutEntry | null`
  - `timelineToSource(layout: LayoutEntry[], t: number): { entry: LayoutEntry; sourceTime: number } | null`
  - `sourceToTimeline(layout: LayoutEntry[], sourceTime: number): number | null`

- [ ] **Step 1: Write the failing tests**

```ts
// timeline.test.ts
import { describe, expect, it } from "vitest";
import type { TrackItem } from "./scene";
import {
  entryAt,
  layoutDuration,
  sourceToTimeline,
  timelineToSource,
  toLayout,
} from "./timeline";

const clip = (id: string, sourceStart: number, sourceEnd: number): TrackItem => ({
  id,
  kind: "clip",
  sourceStart,
  sourceEnd,
});

const slide = (id: string, duration: number): TrackItem => ({
  id,
  kind: "slide",
  assetId: `asset-${id}`,
  duration,
  naturalWidth: 800,
  naturalHeight: 600,
});

// A representative edited track: 3s slide, then 0–10s of source, then 20–25s of source.
const ITEMS = [slide("s1", 3), clip("a", 0, 10), clip("b", 20, 25)];

describe("toLayout", () => {
  it("lays items out contiguously and remembers source ranges", () => {
    expect(toLayout(ITEMS)).toEqual([
      { itemId: "s1", kind: "slide", timelineStart: 0, timelineEnd: 3, sourceStart: 0, sourceEnd: 3 },
      { itemId: "a", kind: "clip", timelineStart: 3, timelineEnd: 13, sourceStart: 0, sourceEnd: 10 },
      { itemId: "b", kind: "clip", timelineStart: 13, timelineEnd: 18, sourceStart: 20, sourceEnd: 25 },
    ]);
    expect(layoutDuration(toLayout(ITEMS))).toBe(18);
  });

  it("skips zero-duration items and returns [] for an empty track", () => {
    expect(toLayout([clip("z", 5, 5)])).toEqual([]);
    expect(layoutDuration([])).toBe(0);
  });
});

describe("entryAt", () => {
  const layout = toLayout(ITEMS);

  it("finds the entry containing a time", () => {
    expect(entryAt(layout, 0)?.itemId).toBe("s1");
    expect(entryAt(layout, 3)?.itemId).toBe("a"); // boundary belongs to the next entry
    expect(entryAt(layout, 17.9)?.itemId).toBe("b");
  });

  it("clamps out-of-range times instead of returning null", () => {
    expect(entryAt(layout, -1)?.itemId).toBe("s1");
    expect(entryAt(layout, 99)?.itemId).toBe("b");
    expect(entryAt([], 0)).toBeNull();
  });
});

describe("timelineToSource", () => {
  const layout = toLayout(ITEMS);

  it("maps timeline time into the source recording across cuts", () => {
    expect(timelineToSource(layout, 4)?.sourceTime).toBe(1); // 1s into clip a
    expect(timelineToSource(layout, 14)?.sourceTime).toBe(21); // 1s into clip b
  });

  it("maps slide time onto the slide's own 0..duration clock", () => {
    const hit = timelineToSource(layout, 1.5);
    expect(hit?.entry.itemId).toBe("s1");
    expect(hit?.sourceTime).toBe(1.5);
  });
});

describe("sourceToTimeline", () => {
  const layout = toLayout(ITEMS);

  it("maps source time back to timeline time", () => {
    expect(sourceToTimeline(layout, 1)).toBe(4);
    expect(sourceToTimeline(layout, 21)).toBe(14);
  });

  it("returns null for deleted footage", () => {
    expect(sourceToTimeline(layout, 15)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/features/video-editor/timeline.test.ts`
Expected: FAIL — module `./timeline` not found.

- [ ] **Step 3: Write the implementation**

```ts
// timeline.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/features/video-editor/timeline.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Format and commit**

```bash
bunx oxfmt . && git add apps/kaipu-record/src/renderer/src/features/video-editor && git commit -m "feat(video-editor): pure timeline layout and time mapping"
```

---

### Task 3: Timeline edit operations (pure)

These functions are consumed by plan 03 (split/delete/trim), plan 04 (`clampOverlays`),
and plan 05 (slides) — they live here so the whole pure surface ships tested at once.

**Files:**

- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/timeline.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/video-editor/timeline.test.ts` (append)

**Interfaces:**

- Consumes: `newId` from `./scene`.
- Produces:
  - `splitClipAt(items: TrackItem[], t: number): TrackItem[]` — returns the SAME array reference when the split is a no-op (slide hit, boundary too close); callers use reference equality to skip history commits.
  - `removeItem(items: TrackItem[], itemId: string): TrackItem[]`
  - `trimClip(items: TrackItem[], itemId: string, edge: "start" | "end", sourceTime: number): TrackItem[]`
  - `insertItemAt(items: TrackItem[], index: number, item: TrackItem): TrackItem[]`
  - `boundaryIndexAt(layout: LayoutEntry[], t: number): number` — index in `items` of the boundary nearest to timeline time `t` (0..items.length)
  - `setSlideDuration(items: TrackItem[], itemId: string, duration: number): TrackItem[]`
  - `clampOverlays(overlays: VideoOverlay[], duration: number): VideoOverlay[]`

- [ ] **Step 1: Write the failing tests (append to timeline.test.ts)**

```ts
import {
  boundaryIndexAt,
  clampOverlays,
  insertItemAt,
  MIN_ITEM_DURATION,
  removeItem,
  setSlideDuration,
  splitClipAt,
  trimClip,
} from "./timeline";
import type { VideoOverlay } from "./scene";

describe("splitClipAt", () => {
  it("splits a clip into two at the timeline time, preserving source coverage", () => {
    const items = [clip("a", 20, 30)];
    const result = splitClipAt(items, 4); // 4s into the timeline = source 24
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: "clip", sourceStart: 20, sourceEnd: 24 });
    expect(result[1]).toMatchObject({ kind: "clip", sourceStart: 24, sourceEnd: 30 });
    expect(result[0].id).not.toBe(result[1].id);
  });

  it("is a no-op (same reference) on slides and near boundaries", () => {
    const withSlide = [slide("s1", 3), clip("a", 0, 10)];
    expect(splitClipAt(withSlide, 1)).toBe(withSlide); // inside the slide
    const items = [clip("a", 0, 10)];
    expect(splitClipAt(items, MIN_ITEM_DURATION / 2)).toBe(items); // sliver
    expect(splitClipAt(items, 10 - MIN_ITEM_DURATION / 2)).toBe(items);
  });
});

describe("removeItem / insertItemAt / boundaryIndexAt", () => {
  it("removes by id", () => {
    expect(removeItem(ITEMS, "a").map((i) => i.id)).toEqual(["s1", "b"]);
  });

  it("inserts at an index", () => {
    const s = slide("s2", 2);
    expect(insertItemAt(ITEMS, 1, s).map((i) => i.id)).toEqual(["s1", "s2", "a", "b"]);
  });

  it("finds the nearest boundary for a timeline time", () => {
    const layout = toLayout(ITEMS); // boundaries at 0, 3, 13, 18
    expect(boundaryIndexAt(layout, 0.4)).toBe(0);
    expect(boundaryIndexAt(layout, 2.9)).toBe(1);
    expect(boundaryIndexAt(layout, 14)).toBe(2);
    expect(boundaryIndexAt(layout, 18)).toBe(3);
  });
});

describe("trimClip", () => {
  it("moves an edge in source time, respecting MIN_ITEM_DURATION", () => {
    const items = [clip("a", 2, 10)];
    expect(trimClip(items, "a", "start", 4)[0]).toMatchObject({ sourceStart: 4 });
    expect(trimClip(items, "a", "end", 8)[0]).toMatchObject({ sourceEnd: 8 });
    // collapsing beyond the minimum clamps instead of inverting
    expect(trimClip(items, "a", "start", 99)[0]).toMatchObject({
      sourceStart: 10 - MIN_ITEM_DURATION,
    });
    expect(trimClip(items, "a", "start", -5)[0]).toMatchObject({ sourceStart: 0 });
  });
});

describe("setSlideDuration", () => {
  it("clamps to the minimum duration", () => {
    const items = [slide("s1", 3)];
    expect(setSlideDuration(items, "s1", 0)[0]).toMatchObject({
      duration: MIN_ITEM_DURATION,
    });
    expect(setSlideDuration(items, "s1", 7.5)[0]).toMatchObject({ duration: 7.5 });
  });
});

describe("clampOverlays", () => {
  const overlay = (id: string, start: number, end: number): VideoOverlay => ({
    id,
    kind: "text",
    x: 0.1,
    y: 0.1,
    text: "hola",
    size: 19,
    color: "#000",
    start,
    end,
  });

  it("clamps overlay windows into the new duration and drops orphans", () => {
    const result = clampOverlays([overlay("keep", 1, 5), overlay("clip", 8, 15), overlay("drop", 12, 14)], 10);
    expect(result.map((o) => o.id)).toEqual(["keep", "clip"]);
    expect(result[1]).toMatchObject({ start: 8, end: 10 });
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/features/video-editor/timeline.test.ts`
Expected: FAIL — `splitClipAt` (etc.) not exported.

- [ ] **Step 3: Write the implementation (append to timeline.ts)**

```ts
import { newId, type TrackItem, type VideoOverlay } from "./scene";

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
```

- [ ] **Step 4: Run the full timeline suite**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/features/video-editor/timeline.test.ts`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Format and commit**

```bash
bunx oxfmt . && git add apps/kaipu-record/src/renderer/src/features/video-editor && git commit -m "feat(video-editor): pure timeline edit operations"
```

---

### Task 4: Editor route, page shell, and window mode

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`
- Create: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.module.css`
- Modify: `apps/kaipu-record/src/renderer/src/app/router.tsx` (add the route)

Before writing, read `apps/kaipu-record/src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx`
— this page mirrors its structure deliberately (route-state guard, `key={location.key}`
remount, `setEditorWindowMode` on mount/unmount).

**Interfaces:**

- Consumes: `initialScene` from `features/video-editor/scene`; `LocalRecording` fields
  via route state.
- Produces: route `/video-editor` accepting
  `location.state: { id: string; title: string; durationSeconds: number }`;
  inner component `VideoEditor({ source })` that later plans extend.

- [ ] **Step 1: Write the page shell**

```tsx
// video-editor-page.tsx
import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { initialScene } from "../../features/video-editor/scene";
import styles from "./video-editor-page.module.css";

export interface VideoEditorSource {
  id: string;
  title: string;
  durationSeconds: number;
}

function isVideoEditorSource(value: unknown): value is VideoEditorSource {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.durationSeconds === "number" &&
    v.durationSeconds > 0
  );
}

export function VideoEditorPage() {
  const location = useLocation();
  const source = location.state;
  if (!isVideoEditorSource(source)) return <Navigate to="/library" replace />;
  // Remount per navigation so a different recording never inherits editor state.
  return <VideoEditor key={location.key} source={source} />;
}

function VideoEditor({ source }: { source: VideoEditorSource }) {
  useEffect(() => {
    // Same window growth the screenshot editor uses; restored on unmount.
    void window.electronAPI.setEditorWindowMode(true);
    return () => void window.electronAPI.setEditorWindowMode(false);
  }, []);

  const scene = initialScene(source.durationSeconds);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{source.title}</h1>
      </header>
      <main className={styles.stage}>{/* preview lands in Task 5 */}</main>
      <footer className={styles.timeline}>{/* timeline lands in plan 02 */}</footer>
    </div>
  );
}
```

Note: if `setEditorWindowMode` does not exist on `window.electronAPI`, search
`src/shared/types/electron-api.ts` for the editor-window-mode method the screenshot
editor calls and use that exact name — do not add a new IPC channel for this.

CSS module: a `page` grid with `grid-template-rows: auto 1fr auto; height: 100%;`,
`header` with the same padding/typography as the screenshot editor header, `stage`
centered with a dark background (`display:grid; place-items:center; overflow:hidden;`),
`timeline` fixed-height (160px) bottom band. Match colors to the screenshot editor's
module CSS (open it and reuse its custom-property values).

- [ ] **Step 2: Register the route**

In `app/router.tsx`, add as a sibling of the screenshot-editor route:

```tsx
{ path: "/video-editor", element: <VideoEditorPage /> },
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/kaipu-record && bunx tsc --noEmit -p tsconfig.web.json`
(Use the project's existing typecheck script if one exists — check `package.json`
`scripts` first and prefer `bun run typecheck`.)
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
bunx oxfmt . && git add -A apps/kaipu-record && git commit -m "feat(video-editor): /video-editor route and page shell"
```

---

### Task 5: Preview playback (entry-walking controller, single-clip case)

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/use-preview-playback.ts`
- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/preview-stage.tsx`
- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/preview-stage.module.css`
- Modify: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`

**Interfaces:**

- Consumes: `toLayout`, `layoutDuration`, `entryAt`, `timelineToSource`,
  `sourceToTimeline` from `../timeline`.
- Produces:
  - `usePreviewPlayback(layout: LayoutEntry[]): PreviewPlayback` where
    `interface PreviewPlayback { videoRef: RefObject<HTMLVideoElement>; playing: boolean; duration: number; timelineTime: number; play(): void; pause(): void; toggle(): void; seek(t: number): void; onVideoTimeUpdate(): void; onVideoEnded(): void; subscribeTime(listener: (t: number) => void): () => void }`
    — `timelineTime` is LOW-FREQUENCY state (~4 Hz, from `timeupdate`) for text
    displays; `subscribeTime` delivers rAF-frequency updates for the plan-02 playhead
    without re-rendering React.
  - `<PreviewStage playback={...} mediaUrl={string} />` rendering the `<video>`.

**Design notes (read before coding):**

- The controller is written **entry-based from day one** (walk `LayoutEntry[]`), even
  though this plan always sees a single clip — plans 03/05 extend `advancePastEntry()`
  rather than rewriting the hook.
- `internalSeekRef` marks programmatic seeks so user-seek handling (plan 03) can tell
  them apart — without it, the seek handlers misfire on every cut crossing.
- The media URL is `kaipu-media://recording/<id>` — the same streaming protocol the
  library player uses (`features/library/components/recording-player.tsx`); never load
  video bytes over IPC.

- [ ] **Step 1: Write the hook**

```ts
// use-preview-playback.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  entryAt,
  type LayoutEntry,
  layoutDuration,
  timelineToSource,
  sourceToTimeline,
} from "./timeline";

export interface PreviewPlayback {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  playing: boolean;
  duration: number;
  timelineTime: number;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
  onVideoTimeUpdate(): void;
  onVideoEnded(): void;
  subscribeTime(listener: (t: number) => void): () => void;
}

const END_EPSILON = 0.02;

export function usePreviewPlayback(layout: LayoutEntry[]): PreviewPlayback {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const internalSeekRef = useRef(false);
  const listenersRef = useRef(new Set<(t: number) => void>());
  const [playing, setPlaying] = useState(false);
  const [timelineTime, setTimelineTime] = useState(0);
  const duration = useMemo(() => layoutDuration(layout), [layout]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const currentTimelineTime = useCallback((): number => {
    const video = videoRef.current;
    if (!video) return 0;
    return sourceToTimeline(layoutRef.current, video.currentTime) ?? 0;
  }, []);

  const emitTime = useCallback(
    (t: number) => {
      for (const listener of listenersRef.current) listener(t);
    },
    [],
  );

  // rAF loop feeds high-frequency listeners (playhead) without re-rendering React.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      emitTime(currentTimelineTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, currentTimelineTime, emitTime]);

  const seekVideoToSource = useCallback((sourceTime: number) => {
    const video = videoRef.current;
    if (!video) return;
    internalSeekRef.current = true;
    video.currentTime = sourceTime;
  }, []);

  const seek = useCallback(
    (t: number) => {
      const hit = timelineToSource(layoutRef.current, t);
      if (!hit) return;
      // Slides are handled in plan 05; until then every entry is a clip.
      if (hit.entry.kind === "clip") seekVideoToSource(hit.sourceTime);
      setTimelineTime(Math.max(0, Math.min(t, layoutDuration(layoutRef.current))));
      emitTime(t);
    },
    [seekVideoToSource, emitTime],
  );

  const play = useCallback(() => {
    void videoRef.current?.play();
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    (videoRef.current?.paused ?? true) ? play() : pause();
  }, [play, pause]);

  const onVideoTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (internalSeekRef.current) {
      internalSeekRef.current = false;
      return;
    }
    const layoutNow = layoutRef.current;
    const t = sourceToTimeline(layoutNow, video.currentTime);
    if (t === null) {
      // Inside deleted footage — plan 03 advances to the next entry here. With a
      // single full clip this cannot happen; snap to the nearest kept position.
      const entry = entryAt(layoutNow, timelineTime);
      if (entry) seekVideoToSource(entry.sourceStart);
      return;
    }
    const entry = entryAt(layoutNow, t);
    if (entry && video.currentTime >= entry.sourceEnd - END_EPSILON) {
      // Reached the end of this entry: plan 03 jumps to the next one. Single-clip
      // case: stop at the end.
      if (entry.timelineEnd >= layoutDuration(layoutNow) - END_EPSILON) pause();
    }
    setTimelineTime(t);
  }, [pause, seekVideoToSource, timelineTime]);

  const onVideoEnded = useCallback(() => {
    setPlaying(false);
    setTimelineTime(layoutDuration(layoutRef.current));
  }, []);

  const subscribeTime = useCallback((listener: (t: number) => void) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  return {
    videoRef,
    playing,
    duration,
    timelineTime,
    play,
    pause,
    toggle,
    seek,
    onVideoTimeUpdate,
    onVideoEnded,
    subscribeTime,
  };
}
```

- [ ] **Step 2: Write the stage component**

```tsx
// components/preview-stage.tsx
import type { PreviewPlayback } from "../use-preview-playback";
import styles from "./preview-stage.module.css";

export function PreviewStage({
  playback,
  mediaUrl,
}: {
  playback: PreviewPlayback;
  mediaUrl: string;
}) {
  return (
    <div className={styles.stage}>
      <video
        ref={playback.videoRef}
        className={styles.video}
        src={mediaUrl}
        onTimeUpdate={playback.onVideoTimeUpdate}
        onEnded={playback.onVideoEnded}
        onClick={playback.toggle}
      />
    </div>
  );
}
```

CSS: `.stage { position: relative; max-width: 100%; max-height: 100%; }`,
`.video { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }`.
The wrapper is `position: relative` because plan 04 layers the annotation SVG over it.

- [ ] **Step 3: Wire into the page + transport controls**

In `VideoEditor` (video-editor-page.tsx):

```tsx
const layout = useMemo(() => toLayout(scene.items), [scene.items]);
const playback = usePreviewPlayback(layout);
const mediaUrl = `kaipu-media://recording/${source.id}`;
```

Render `<PreviewStage playback={playback} mediaUrl={mediaUrl} />` in the stage, plus a
minimal transport row under it: a play/pause icon button (lucide `Play`/`Pause`,
aria-label "Reproducir"/"Pausar") and a time display `MM:SS / MM:SS` from
`playback.timelineTime` / `playback.duration` (write a tiny local `formatTime(seconds)`
— `Math.floor` minutes + zero-padded seconds).

Add a page-level keydown effect: Space toggles play/pause, guarded exactly like the
screenshot editor guards Delete (skip when `event.target` is an input/textarea or
`isContentEditable`); call `event.preventDefault()` so the page does not scroll.

- [ ] **Step 4: Manual verification in the app**

Run: `cd apps/kaipu-record && bun run dev`, open a library recording — there is no
Edit button yet, so navigate manually: from DevTools console
`window.location.hash = "#/video-editor"` will redirect to `/library` (guard works).
Then verify the full flow after Task 6 lands the button. For now confirm typecheck +
`bunx vitest run` still pass.

- [ ] **Step 5: Commit**

```bash
bunx oxfmt . && git add -A apps/kaipu-record && git commit -m "feat(video-editor): preview playback controller and stage"
```

---

### Task 6: Library entry point

**Files:**

- Modify: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx`

**Interfaces:**

- Consumes: the `LocalRecording` already loaded by the detail page (`id`, `title`,
  `durationSeconds`, `kind`); route `/video-editor` from Task 4.
- Produces: an "Editar video" action visible only for `kind === "recording"`.

- [ ] **Step 1: Add the button**

Read the detail page's existing action row (rename / delete / reveal) and add a button
styled like its siblings, only for recordings, with copy **"Editar video"** (lucide
`Scissors` or `Clapperboard` icon, match sibling icon sizing):

```tsx
const navigate = useNavigate();
// inside the actions row, recordings only:
<Button
  onClick={() =>
    navigate("/video-editor", {
      state: {
        id: recording.id,
        title: recording.title,
        durationSeconds: recording.durationSeconds ?? 0,
      },
    })
  }
>
  Editar video
</Button>
```

Guard: if `durationSeconds` is missing/0 (older vault items), disable the button with
tooltip **"No se pudo leer la duración de este video"** — the editor needs a real
duration to build the initial scene.

Use the page's actual button component and layout — read the file first; do not invent
a new button style.

- [ ] **Step 2: Manual verification**

Run: `cd apps/kaipu-record && bun run dev`

- Open a recording in the library → "Editar video" → editor opens, window grows.
- Video plays, pauses with Space and click, time display advances, ends cleanly.
- Back-navigate → window shrinks back (editor mode off).
- Screenshots do NOT show the button.

- [ ] **Step 3: Run the whole suite + typecheck**

Run: `cd apps/kaipu-record && bunx vitest run && bun run typecheck` (or the tsc command
from Task 4 if no script exists).
Expected: PASS / no errors.

- [ ] **Step 4: Commit**

```bash
bunx oxfmt . && git add -A apps/kaipu-record && git commit -m "feat(video-editor): library entry point"
```

---

## Done when

- `bunx vitest run` green, typecheck green, `bunx oxfmt --check .` clean.
- Manual: library recording → Editar video → plays/pauses/ends; guard redirects direct
  navigation; screenshots unaffected.
- Open a PR titled `feat(video-editor): foundation — scene model, timeline math, editor page (plan 01)`
  and **stop for owner review** (one PR at a time).
