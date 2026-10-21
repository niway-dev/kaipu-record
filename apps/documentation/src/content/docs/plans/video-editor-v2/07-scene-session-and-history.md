---
title: "Video editor v2 — 07 scene, session and history"
description: "Scene v2 fields, additive session parsing inside version 1, loading the cursor track, initial detection as part of the initial scene (never a commit), the manual-wins edit helpers, the undo contract for sliders and drags, a single selection model, and debounced session autosave so closing the window no longer discards a user's redactions. Fixes audit W11."
sidebar:
  order: 7
---

# 07 — Scene, session and history

> **Status: 🟡 In progress** (2026-09-22). PR 5 ("Scene v2 + loader") in the
> [audit](/plans/video-editor-v2/00-audit/). Fixes W11; resolves overview decision 5.
> Requires PR 4 (the pure modules from docs 04–06 and `privacy/redaction.ts` from doc 10).
> Implemented on `feat/video-editor-v2-scene-v2` — not merged, not validated in
> production; see the [backlog PR table](/backlog/video-editor-zoom-blur-cover/).

## Problem

- The overview says "on first open with no session, run `detectZoomSegments` and
  **commit** the result". `useVideoScene` reports `dirty = past.length > 0`, and the page
  blocks navigation while dirty. A commit on open makes every open-then-leave pop the
  "discard changes?" dialog.
- `parseSession` rejects any scene without exactly the known shape; the plan says "stays
  version 1 with optional fields" without saying what happens to old sessions (they
  should get auto zooms too) or malformed new fields.
- Where the cursor track enters the editor is left as "a new return field or a sibling
  IPC".
- Sensitivity, level and smoothing are continuous controls; the plan does not say how
  they map onto `commit` vs `beginInteract/updateLive/endInteract`, or that a user edit
  must protect a segment from being regenerated.
- The page tracks `selectedItemId` and `selectedOverlayId` separately. Two more
  independent selections (zoom, redaction) make Delete, `Esc` and the inspector panel
  ambiguous.
- The session is written on export only, and the navigation blocker sees in-app
  navigation only. Closing the window therefore discards every redaction the user drew,
  with no dialog and no trace — the half of W11 an earlier draft of this document
  declared a non-goal.

## Decisions

| Topic               | Decision                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scene fields        | `zoomSegments: ZoomSegment[]`, `redactions: Redaction[]`, `zoomSensitivity: number` — **required** on `VideoScene` (every consumer handles them; no `?? []` scattered around).                                                                                                                                                                                                                                                 |
| Session version     | Stays `1`. Missing v2 keys → defaults and `hasZoomData: false`. **Structurally** broken v2 data → `null` (wrong type, unknown enum member, a zoom under `ZOOM_LIMITS.minSeconds`). An out-of-range **number** is clamped instead — a hand-edited file must not weaken a blur or over-scale a zoom, and refusing to open the session would punish the user for it. Zooms that overlap after the sort are dropped, not rejected. |
| Cursor track        | Not in the scene (immutable reference data). Loaded by `VideoEditorLoader` through `loadCursorTrack(id)` (doc 02), parsed with `parseCursorTrack`, passed to `VideoEditor` as a prop.                                                                                                                                                                                                                                          |
| Initial detection   | `withInitialZooms(scene, hasZoomData, track, duration)` in the loader, **before** `useVideoScene` exists → it is the initial scene, not a commit, so the editor is clean. Runs on a fresh open and on a pre-v2 session.                                                                                                                                                                                                        |
| Manual wins         | Every user edit goes through `zoom-edits.ts`, which sets `origin: "manual"`. `applySensitivity` regenerates only autos.                                                                                                                                                                                                                                                                                                        |
| Discrete edits      | `controller.commit(next)` — mode buttons, remove, add, style/fill buttons, label field on blur/Enter.                                                                                                                                                                                                                                                                                                                          |
| Continuous edits    | `beginInteract()` on pointer-down, `updateLive(next)` on each change, `endInteract()` on pointer-up — sliders (Sensitivity, Level, Smoothness, Intensity), edge drags, camera-box drag, region move/resize. One undo step per gesture. Keyboard steps on a slider are discrete commits.                                                                                                                                        |
| Fresh state in live | Live handlers compute from `controller.scene` (not the render-time `scene` closure), exactly like `handleTrim` does today.                                                                                                                                                                                                                                                                                                     |
| Guard               | Every discrete handler returns early when `controller.interacting` (existing pattern).                                                                                                                                                                                                                                                                                                                                         |
| Zoom times          | `ZoomPatch` cannot carry `start`/`end`: a zoom's times must respect its neighbours, the source bounds and `ZOOM_LIMITS.minSeconds`. Timeline edge drags go through `dragZoomEdge`, which wraps `dragRangeEdge` from [06](/plans/video-editor-v2/06-time-base-cuts-and-mapping/).                                                                                                                                               |
| Selection           | One `EditorSelection` (`item` \| `overlay` \| `zoom` \| `redaction`). Delete precedence: redaction → zoom → overlay → item. `Esc` clears (unless focus is in a text field, or the stage is fullscreen — there the browser owns `Esc`).                                                                                                                                                                                         |
| Saving              | **Autosave.** `saveVideoEditSession` runs ~800 ms after every `commit` / `endInteract`, flushed on unmount and `beforeunload`. See the rule below.                                                                                                                                                                                                                                                                             |

### The autosave rule (what "dirty" means now)

Audit W11 says the session is written on export only, so "sensitivity and privacy work is
lost on close". That is exactly right and `useBlocker` does **not** fix it: react-router's
blocker sees in-app navigation and nothing else, so ⌘W, Quit or a crash discards every
cut, every zoom and every redaction the user drew — silently, with no dialog. The earlier
draft of this document listed autosave as a non-goal; that made the document claim a fix
it did not deliver. **Autosave is in.** The rule, stated once and applied everywhere:

- `useVideoScene`'s `dirty` keeps its meaning — "the undo stack is non-empty" — and drives
  the Undo button. Nothing else reads it.
- The **discard dialog is about the session file, not about the history**: `shouldBlock`
  reads `autosave.pendingRef`, which is true from the moment the scene changes until the
  write resolves. With an 800 ms debounce plus flushes on unmount and `beforeunload`, that
  ref is true only inside the debounce window or after a failed write — so the dialog is
  rare, and when it does appear its copy ("You have unsaved edits. If you leave now,
  they're lost.") is literally true.
- Its **Discard button calls `autosave.cancel()`** before `blocker.proceed()`. Without
  that, "Discard" would be a lie: the unmount flush would save the very edits the user
  just chose to throw away.
- Leaving a recording the user only _opened_ still writes nothing: the hook never saves
  the scene it was mounted with, so browsing into the editor and out again does not create
  a session file or turn a pre-v2 recording into a v2 one.
- Honest limit: `beforeunload` cannot await, so the flush there is fire-and-forget and a
  hard kill mid-write can still lose the last edit. The debounce is short precisely to
  bound that window; do not raise it.

## Files

| Action | Path (under `apps/kaipu-record/src/renderer/src/features/video-editor/`)         |
| ------ | -------------------------------------------------------------------------------- |
| Modify | `scene.ts`, `scene.test.ts`                                                      |
| Modify | `session.ts`, `session.test.ts`                                                  |
| Create | `initial-zooms.ts` + `.test.ts`                                                  |
| Create | `zoom/zoom-edits.ts` + `.test.ts`                                                |
| Create | `privacy/redaction-edits.ts` + `.test.ts`                                        |
| Create | `editor-selection.ts` + `.test.ts`                                               |
| Create | `use-session-autosave.ts` + `.test.ts`                                           |
| Modify | `export/export-plan.test.ts`, `export/use-video-export.test.ts` (scene literals) |
| Modify | `pages/video-editor/video-editor-page.tsx` (`src/renderer/src/pages/…`)          |

`zoom/zoom-edits.ts` imports `dragRangeEdge` from `../source-time` — that module ships in
the same PR 4 as the detector and the camera, so PR 5 can rely on it.

## Tasks

### Task 1 — scene

- [ ] Replace `scene.ts` with:

**`apps/kaipu-record/src/renderer/src/features/video-editor/scene.ts`**

```ts
/**
 * Video-editor scene model. All overlay geometry is normalized 0–1 of the VIDEO frame
 * (same convention as screenshot annotations); all times are seconds. Overlays are
 * anchored to TIMELINE time (the edited result), not source time — see the design spec.
 * Zoom segments and redactions (v2) are the exception: they are anchored to SOURCE time
 * — see plans/video-editor-v2/06.
 */
import { ZOOM_DEFAULTS, type ZoomSegment } from "./zoom/zoom-model";
import type { Redaction } from "./privacy/redaction";

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
  /** Source-anchored, sorted by start, never overlapping. */
  zoomSegments: ZoomSegment[];
  /** Source-anchored privacy regions; may overlap. */
  redactions: Redaction[];
  /** Detection sensitivity 0–100; regenerates `origin: "auto"` segments. */
  zoomSensitivity: number;
}

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * The scene for a recording opened without a saved session: no zooms yet. The detector's
 * proposal is folded in afterwards by `withInitialZooms` (initial-zooms.ts), still as
 * part of the INITIAL scene and never as a commit, so opening and leaving the editor does
 * not count as an unsaved edit.
 *
 * `ZOOM_DEFAULTS` comes from zoom-model.ts rather than from the detector: scene.ts is
 * reachable from the export worker, and a VALUE import of detect-zoom-segments.ts would
 * pull the whole detector into that bundle.
 */
export function initialScene(durationSeconds: number): VideoScene {
  return {
    items: [{ id: newId(), kind: "clip", sourceStart: 0, sourceEnd: durationSeconds }],
    overlays: [],
    zoomSegments: [],
    redactions: [],
    zoomSensitivity: ZOOM_DEFAULTS.sensitivity,
  };
}
```

- [ ] Replace `scene.test.ts` with:

**`apps/kaipu-record/src/renderer/src/features/video-editor/scene.test.ts`**

```ts
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

describe("initialScene — v2 fields", () => {
  it("starts with no zooms, no redactions and the default sensitivity", () => {
    const scene = initialScene(10);
    expect(scene.zoomSegments).toEqual([]);
    expect(scene.redactions).toEqual([]);
    expect(scene.zoomSensitivity).toBe(55);
  });
});
```

- [ ] Fix the scene **literals** in tests that now miss the new required fields — apply
      these two diffs (`git apply <file>` from the monorepo root, or edit by hand):

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-plan.test.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-plan.test.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-plan.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from "vitest";
-import type { TrackItem } from "../scene";
+import { initialScene, type TrackItem } from "../scene";
 import { buildExportPlan } from "./export-plan";

 // Copied from timeline.test.ts — the same fixture factories, kept local so this
@@ -23,6 +23,7 @@
 describe("buildExportPlan", () => {
   it("maps the track to contiguous render segments", () => {
     const plan = buildExportPlan({
+      ...initialScene(1),
       items: [slide("s1", 3), clip("a", 0, 10), clip("b", 20, 25)],
       overlays: [],
     });
@@ -48,11 +49,15 @@
         end: 4,
       },
     ] as const;
-    const plan = buildExportPlan({ items: [clip("a", 0, 10)], overlays: [...overlays] });
+    const plan = buildExportPlan({
+      ...initialScene(1),
+      items: [clip("a", 0, 10)],
+      overlays: [...overlays],
+    });
     expect(plan.overlayWindows).toEqual([{ overlayId: "o1", start: 1, end: 4 }]);
   });

   it("throws on an empty timeline", () => {
-    expect(() => buildExportPlan({ items: [], overlays: [] })).toThrow();
+    expect(() => buildExportPlan({ ...initialScene(1), items: [], overlays: [] })).toThrow();
   });
 });
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts
@@ -1,7 +1,7 @@
 import { act, renderHook, waitFor } from "@testing-library/react";
 import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
 import type { LocalRecording } from "@shared/types/library-storage";
-import type { VideoScene } from "../scene";
+import { initialScene, type VideoScene } from "../scene";
 import { createSlideAssetStore } from "../slide-assets";
 import { useVideoExport } from "./use-video-export";

@@ -34,6 +34,7 @@
 let createdWorkers: FakeWorker[] = [];

 const CLIP_SCENE: VideoScene = {
+  ...initialScene(1),
   items: [{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 }],
   overlays: [],
 };
@@ -92,7 +93,9 @@
     const { result } = renderHook(() => useVideoExport());

     await act(async () => {
-      await result.current.start(startArgs({ scene: { items: [], overlays: [] } }));
+      await result.current.start(
+        startArgs({ scene: { ...initialScene(1), items: [], overlays: [] } }),
+      );
     });

     expect(result.current.status).toBe("error");
@@ -111,7 +114,9 @@
   it("dismisses the empty-timeline error via cancel()", async () => {
     const { result } = renderHook(() => useVideoExport());
     await act(async () => {
-      await result.current.start(startArgs({ scene: { items: [], overlays: [] } }));
+      await result.current.start(
+        startArgs({ scene: { ...initialScene(1), items: [], overlays: [] } }),
+      );
     });
     expect(result.current.status).toBe("error");

```

### Task 2 — session

- [ ] Replace `session.ts` with:

**`apps/kaipu-record/src/renderer/src/features/video-editor/session.ts`**

```ts
/**
 * Edit-session serialization for the video editor. `serializeSession` collapses the
 * current scene into a JSON string; `parseSession` validates it structurally (field by
 * field — no zod, consistent with the rest of this codebase) and returns null for
 * anything invalid so the caller can silently fall back to a fresh scene.
 *
 * The version field is an intentional break point: if the shape ever changes in an
 * incompatible way we bump `version` and old sessions are ignored (parse returns null).
 *
 * v2 fields (`zoomSegments`, `redactions`, `zoomSensitivity`) are ADDITIVE inside
 * version 1: missing → defaults (a session saved before v2 still opens). Structural
 * damage (wrong type, unknown enum member, a zoom under the minimum length) returns
 * null like any other invalid field; an out-of-range NUMBER is clamped instead, because
 * a weakened blur or an over-scaled zoom must not be honoured either. Overlapping zooms
 * are dropped, not rejected. Older app builds ignore the new keys, so opening a v2
 * session in an old build is safe (it just shows no zooms).
 */
import { ZOOM_DEFAULTS, ZOOM_LIMITS, type ZoomSegment } from "./zoom/zoom-model";
import { clampIntensity, REDACTION, type NormRect, type Redaction } from "./privacy/redaction";
import type {
  ArrowOverlay,
  BoxOverlay,
  ClipItem,
  SlideItem,
  TextOverlay,
  TrackItem,
  VideoOverlay,
  VideoScene,
} from "./scene";

export interface VideoEditSession {
  version: 1;
  scene: VideoScene;
  /**
   * False when the saved JSON predates v2 (no `zoomSegments` key). The loader then runs
   * detection once, exactly like a fresh open — see plans/video-editor-v2/07.
   */
  hasZoomData: boolean;
}

export function serializeSession(scene: VideoScene): string {
  return JSON.stringify({ version: 1, scene });
}

/**
 * Parse and validate a session JSON string. Returns `null` for any of:
 * - invalid JSON
 * - wrong `version`
 * - missing `items`/`overlays` arrays
 * - item with unknown `kind`
 * - overlay with unknown `kind`
 * - any required field that is non-numeric when a number is expected
 */
export function parseSession(json: string): VideoEditSession | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (r["version"] !== 1) return null;

  if (typeof r["scene"] !== "object" || r["scene"] === null) return null;
  const sceneRaw = r["scene"] as Record<string, unknown>;

  if (!Array.isArray(sceneRaw["items"])) return null;
  if (!Array.isArray(sceneRaw["overlays"])) return null;

  const items: TrackItem[] = [];
  for (const item of sceneRaw["items"] as unknown[]) {
    const validated = validateItem(item);
    if (validated === null) return null;
    items.push(validated);
  }

  const overlays: VideoOverlay[] = [];
  for (const overlay of sceneRaw["overlays"] as unknown[]) {
    const validated = validateOverlay(overlay);
    if (validated === null) return null;
    overlays.push(validated);
  }

  const zoomSegments: ZoomSegment[] = [];
  const hasZoomData = sceneRaw["zoomSegments"] !== undefined;
  if (hasZoomData) {
    if (!Array.isArray(sceneRaw["zoomSegments"])) return null;
    const parsed: ZoomSegment[] = [];
    for (const segment of sceneRaw["zoomSegments"] as unknown[]) {
      const validated = validateZoomSegment(segment);
      if (validated === null) return null;
      parsed.push(validated);
    }
    parsed.sort((a, b) => a.start - b.start);
    // The camera assumes exactly ONE active segment at a time (plans 05 and 06), and
    // nothing downstream re-checks it. A hand-edited file can break that, so drop the
    // overlapping segments rather than rejecting the session: the user's cuts and
    // redactions are worth far more than a stray zoom.
    for (const segment of parsed) {
      const previous = zoomSegments[zoomSegments.length - 1];
      if (previous && segment.start < previous.end) continue;
      zoomSegments.push(segment);
    }
  }

  const redactions: Redaction[] = [];
  if (sceneRaw["redactions"] !== undefined) {
    if (!Array.isArray(sceneRaw["redactions"])) return null;
    for (const redaction of sceneRaw["redactions"] as unknown[]) {
      const validated = validateRedaction(redaction);
      if (validated === null) return null;
      redactions.push(validated);
    }
  }

  let zoomSensitivity: number = ZOOM_DEFAULTS.sensitivity;
  if (sceneRaw["zoomSensitivity"] !== undefined) {
    if (!isNum(sceneRaw["zoomSensitivity"])) return null;
    zoomSensitivity = Math.min(100, Math.max(0, sceneRaw["zoomSensitivity"] as number));
  }

  return {
    version: 1,
    scene: { items, overlays, zoomSegments, redactions, zoomSensitivity },
    hasZoomData,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isNum(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function validateItem(raw: unknown): TrackItem | null {
  const i = obj(raw);
  if (!i) return null;
  if (!isStr(i["id"])) return null;

  if (i["kind"] === "clip") {
    if (!isNum(i["sourceStart"]) || !isNum(i["sourceEnd"])) return null;
    return {
      id: i["id"] as string,
      kind: "clip",
      sourceStart: i["sourceStart"] as number,
      sourceEnd: i["sourceEnd"] as number,
    } satisfies ClipItem;
  }

  if (i["kind"] === "slide") {
    if (!isStr(i["assetId"])) return null;
    if (!isNum(i["duration"]) || !isNum(i["naturalWidth"]) || !isNum(i["naturalHeight"]))
      return null;
    return {
      id: i["id"] as string,
      kind: "slide",
      assetId: i["assetId"] as string,
      duration: i["duration"] as number,
      naturalWidth: i["naturalWidth"] as number,
      naturalHeight: i["naturalHeight"] as number,
    } satisfies SlideItem;
  }

  // Unknown item kind — reject to avoid the worker receiving a shape it can't render.
  return null;
}

function validateOverlay(raw: unknown): VideoOverlay | null {
  const o = obj(raw);
  if (!o) return null;
  if (!isStr(o["id"]) || !isStr(o["color"])) return null;
  if (!isNum(o["start"]) || !isNum(o["end"])) return null;

  if (o["kind"] === "box") {
    if (
      !isNum(o["x"]) ||
      !isNum(o["y"]) ||
      !isNum(o["w"]) ||
      !isNum(o["h"]) ||
      !isNum(o["stroke"]) ||
      !isNum(o["seed"])
    )
      return null;
    return {
      id: o["id"] as string,
      kind: "box",
      start: o["start"] as number,
      end: o["end"] as number,
      color: o["color"] as string,
      x: o["x"] as number,
      y: o["y"] as number,
      w: o["w"] as number,
      h: o["h"] as number,
      stroke: o["stroke"] as number,
      seed: o["seed"] as number,
    } satisfies BoxOverlay;
  }

  if (o["kind"] === "arrow") {
    if (
      !isNum(o["x1"]) ||
      !isNum(o["y1"]) ||
      !isNum(o["x2"]) ||
      !isNum(o["y2"]) ||
      !isNum(o["stroke"]) ||
      !isNum(o["seed"])
    )
      return null;
    return {
      id: o["id"] as string,
      kind: "arrow",
      start: o["start"] as number,
      end: o["end"] as number,
      color: o["color"] as string,
      x1: o["x1"] as number,
      y1: o["y1"] as number,
      x2: o["x2"] as number,
      y2: o["y2"] as number,
      stroke: o["stroke"] as number,
      seed: o["seed"] as number,
    } satisfies ArrowOverlay;
  }

  if (o["kind"] === "text") {
    if (!isNum(o["x"]) || !isNum(o["y"]) || !isStr(o["text"]) || !isNum(o["size"])) return null;
    return {
      id: o["id"] as string,
      kind: "text",
      start: o["start"] as number,
      end: o["end"] as number,
      color: o["color"] as string,
      x: o["x"] as number,
      y: o["y"] as number,
      text: o["text"] as string,
      size: o["size"] as number,
    } satisfies TextOverlay;
  }

  // Unknown overlay kind — reject so the worker never receives a type it can't stamp.
  return null;
}

function validatePoint(raw: unknown): { x: number; y: number } | null {
  const p = obj(raw);
  if (!p || !isNum(p["x"]) || !isNum(p["y"])) return null;
  return { x: p["x"] as number, y: p["y"] as number };
}

function validateZoomSegment(raw: unknown): ZoomSegment | null {
  const z = obj(raw);
  if (!z) return null;
  if (!isStr(z["id"]) || !isNum(z["start"]) || !isNum(z["end"])) return null;
  if (!isNum(z["scale"]) || !isNum(z["smoothing"])) return null;
  const start = z["start"] as number;
  const end = z["end"] as number;
  // `end > start` is not enough: a segment under the minimum has no draggable block on
  // the timeline and the camera would flicker through it.
  if (end - start < ZOOM_LIMITS.minSeconds) return null;
  if (z["mode"] !== "follow" && z["mode"] !== "fixed") return null;
  if (z["origin"] !== "auto" && z["origin"] !== "manual") return null;
  const trigger = z["trigger"] ?? null;
  if (trigger !== null && trigger !== "click" && trigger !== "dwell") return null;
  let anchor: { x: number; y: number } | null = null;
  if (z["anchor"] !== null && z["anchor"] !== undefined) {
    anchor = validatePoint(z["anchor"]);
    if (!anchor) return null;
  }
  return {
    id: z["id"] as string,
    start,
    end,
    scale: Math.min(ZOOM_LIMITS.maxScale, Math.max(ZOOM_LIMITS.minScale, z["scale"] as number)),
    mode: z["mode"],
    anchor,
    smoothing: Math.min(100, Math.max(0, z["smoothing"] as number)),
    origin: z["origin"],
    trigger,
  };
}

function validateRect(raw: unknown): NormRect | null {
  const r = obj(raw);
  if (!r || !isNum(r["x"]) || !isNum(r["y"]) || !isNum(r["w"]) || !isNum(r["h"])) return null;
  if ((r["w"] as number) <= 0 || (r["h"] as number) <= 0) return null;
  return { x: r["x"] as number, y: r["y"] as number, w: r["w"] as number, h: r["h"] as number };
}

function validateRedaction(raw: unknown): Redaction | null {
  const r = obj(raw);
  if (!r) return null;
  if (!isStr(r["id"]) || !isNum(r["start"]) || !isNum(r["end"])) return null;
  const start = r["start"] as number;
  const end = r["end"] as number;
  if (end <= start) return null;
  const rect = validateRect(r["rect"]);
  if (!rect) return null;
  const base = { id: r["id"] as string, start, end, rect };

  if (r["kind"] === "blur") {
    if (!isNum(r["intensity"])) return null;
    if (r["style"] !== "gaussian" && r["style"] !== "pixelate") return null;
    // Clamp on load too: a hand-edited session must never produce a weak, reversible blur.
    return {
      ...base,
      kind: "blur",
      intensity: clampIntensity(r["intensity"] as number),
      style: r["style"],
    };
  }
  if (r["kind"] === "cover") {
    if (!isStr(r["fill"]) || !isStr(r["label"])) return null;
    const fill = (REDACTION.coverFills as readonly string[]).includes(r["fill"] as string)
      ? (r["fill"] as string)
      : REDACTION.coverFills[0];
    return { ...base, kind: "cover", fill, label: r["label"] as string };
  }
  return null;
}
```

- [ ] Replace `session.test.ts` with (the existing cases are unchanged except two
      `...initialScene(10)` spreads; the v2 cases are appended):

**`apps/kaipu-record/src/renderer/src/features/video-editor/session.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { initialScene, type VideoScene } from "./scene";
import { parseSession, serializeSession } from "./session";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CLIP_ITEM = {
  id: "clip-1",
  kind: "clip" as const,
  sourceStart: 0,
  sourceEnd: 10,
};

const SLIDE_ITEM = {
  id: "slide-1",
  kind: "slide" as const,
  assetId: "asset-uuid-1",
  duration: 3,
  naturalWidth: 1920,
  naturalHeight: 1080,
};

const BOX_OVERLAY = {
  id: "box-1",
  kind: "box" as const,
  start: 1,
  end: 5,
  color: "#ff0000",
  x: 0.1,
  y: 0.2,
  w: 0.3,
  h: 0.15,
  stroke: 2,
  seed: 42,
};

const ARROW_OVERLAY = {
  id: "arrow-1",
  kind: "arrow" as const,
  start: 2,
  end: 6,
  color: "#00ff00",
  x1: 0.1,
  y1: 0.1,
  x2: 0.9,
  y2: 0.9,
  stroke: 3,
  seed: 99,
};

const TEXT_OVERLAY = {
  id: "text-1",
  kind: "text" as const,
  start: 0,
  end: 8,
  color: "#0000ff",
  x: 0.5,
  y: 0.5,
  text: "Hello world",
  size: 1,
};

const FULL_SCENE: VideoScene = {
  ...initialScene(10),
  items: [CLIP_ITEM, SLIDE_ITEM],
  overlays: [BOX_OVERLAY, ARROW_OVERLAY, TEXT_OVERLAY],
};

// ── Round-trip ────────────────────────────────────────────────────────────────

describe("serializeSession / parseSession — round-trips", () => {
  it("round-trips a full scene with all three overlay kinds and a slide", () => {
    const json = serializeSession(FULL_SCENE);
    const result = parseSession(json);

    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.scene.items).toHaveLength(2);
    expect(result!.scene.overlays).toHaveLength(3);

    // Structural equality for each item/overlay type
    const [clip, slide] = result!.scene.items;
    expect(clip).toMatchObject(CLIP_ITEM);
    expect(slide).toMatchObject(SLIDE_ITEM);

    const [box, arrow, text] = result!.scene.overlays;
    expect(box).toMatchObject(BOX_OVERLAY);
    expect(arrow).toMatchObject(ARROW_OVERLAY);
    expect(text).toMatchObject(TEXT_OVERLAY);
  });

  it("round-trips a scene with only clips and no overlays", () => {
    const scene: VideoScene = { ...initialScene(10), items: [CLIP_ITEM], overlays: [] };
    const result = parseSession(serializeSession(scene));
    expect(result).not.toBeNull();
    expect(result!.scene.items).toHaveLength(1);
    expect(result!.scene.overlays).toHaveLength(0);
  });
});

// ── Null paths ────────────────────────────────────────────────────────────────

describe("parseSession — null on invalid input", () => {
  it("returns null for invalid JSON", () => {
    expect(parseSession("not json at all")).toBeNull();
    expect(parseSession("{broken")).toBeNull();
    expect(parseSession("")).toBeNull();
  });

  it("returns null for wrong version", () => {
    const withWrongVersion = JSON.stringify({ version: 2, scene: { items: [], overlays: [] } });
    expect(parseSession(withWrongVersion)).toBeNull();

    const withNoVersion = JSON.stringify({ scene: { items: [], overlays: [] } });
    expect(parseSession(withNoVersion)).toBeNull();
  });

  it("returns null when items array is missing", () => {
    const noItems = JSON.stringify({ version: 1, scene: { overlays: [] } });
    expect(parseSession(noItems)).toBeNull();
  });

  it("returns null when overlays array is missing", () => {
    const noOverlays = JSON.stringify({ version: 1, scene: { items: [] } });
    expect(parseSession(noOverlays)).toBeNull();
  });

  it("returns null for an item with an unknown kind", () => {
    const scene = {
      version: 1,
      scene: {
        items: [{ id: "x", kind: "video", src: "foo" }],
        overlays: [],
      },
    };
    expect(parseSession(JSON.stringify(scene))).toBeNull();
  });

  it("returns null for an overlay with an unknown kind", () => {
    const scene = {
      version: 1,
      scene: {
        items: [],
        overlays: [{ id: "x", kind: "circle", start: 0, end: 1, color: "#fff" }],
      },
    };
    expect(parseSession(JSON.stringify(scene))).toBeNull();
  });

  it("returns null for non-numeric times on a clip item", () => {
    const badClip = {
      version: 1,
      scene: {
        items: [{ id: "c", kind: "clip", sourceStart: "not-a-number", sourceEnd: 10 }],
        overlays: [],
      },
    };
    expect(parseSession(JSON.stringify(badClip))).toBeNull();
  });

  it("returns null for non-numeric times on an overlay", () => {
    const badOverlay = {
      version: 1,
      scene: {
        items: [],
        overlays: [
          {
            id: "o",
            kind: "box",
            start: "two",
            end: 5,
            color: "#f00",
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            stroke: 1,
            seed: 0,
          },
        ],
      },
    };
    expect(parseSession(JSON.stringify(badOverlay))).toBeNull();
  });

  it("returns null for a box overlay missing a required geometry field", () => {
    const badBox = {
      version: 1,
      scene: {
        items: [],
        overlays: [
          // `w` missing
          {
            id: "b",
            kind: "box",
            start: 0,
            end: 1,
            color: "#f00",
            x: 0,
            y: 0,
            h: 1,
            stroke: 1,
            seed: 0,
          },
        ],
      },
    };
    expect(parseSession(JSON.stringify(badBox))).toBeNull();
  });

  it("returns null for an arrow overlay missing a required endpoint field", () => {
    const badArrow = {
      version: 1,
      scene: {
        items: [],
        overlays: [
          // `x2` missing
          {
            id: "a",
            kind: "arrow",
            start: 0,
            end: 1,
            color: "#0f0",
            x1: 0,
            y1: 0,
            y2: 1,
            stroke: 2,
            seed: 7,
          },
        ],
      },
    };
    expect(parseSession(JSON.stringify(badArrow))).toBeNull();
  });

  it("returns null for a text overlay where size is not a number", () => {
    const badText = {
      version: 1,
      scene: {
        items: [],
        overlays: [
          {
            id: "t",
            kind: "text",
            start: 0,
            end: 2,
            color: "#00f",
            x: 0,
            y: 0,
            text: "hi",
            size: "big",
          },
        ],
      },
    };
    expect(parseSession(JSON.stringify(badText))).toBeNull();
  });

  it("returns null for a slide item with non-numeric duration", () => {
    const badSlide = {
      version: 1,
      scene: {
        items: [
          {
            id: "s",
            kind: "slide",
            assetId: "a",
            duration: "three",
            naturalWidth: 100,
            naturalHeight: 100,
          },
        ],
        overlays: [],
      },
    };
    expect(parseSession(JSON.stringify(badSlide))).toBeNull();
  });

  it("returns null when the scene is not an object", () => {
    expect(parseSession(JSON.stringify({ version: 1, scene: null }))).toBeNull();
    expect(parseSession(JSON.stringify({ version: 1, scene: 42 }))).toBeNull();
  });
});

// ── v2 fields (plans/video-editor-v2/07) ─────────────────────────────────────

const ZOOM = {
  id: "auto-4600",
  start: 4.6,
  end: 7,
  scale: 2,
  mode: "follow" as const,
  anchor: null,
  smoothing: 70,
  origin: "auto" as const,
  trigger: "click" as const,
};

const BLUR = {
  id: "r1",
  kind: "blur" as const,
  start: 1,
  end: 6,
  rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 },
  intensity: 70,
  style: "gaussian" as const,
};

const COVER = {
  id: "r2",
  kind: "cover" as const,
  start: 2,
  end: 4,
  rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
  fill: "#18181b",
  label: "API key",
};

describe("parseSession — v2 fields", () => {
  it("round-trips zoom segments, redactions and sensitivity", () => {
    const scene: VideoScene = {
      ...initialScene(10),
      zoomSegments: [ZOOM],
      redactions: [BLUR, COVER],
      zoomSensitivity: 80,
    };
    const result = parseSession(serializeSession(scene))!;
    expect(result.hasZoomData).toBe(true);
    expect(result.scene.zoomSegments).toEqual([ZOOM]);
    expect(result.scene.redactions).toEqual([BLUR, COVER]);
    expect(result.scene.zoomSensitivity).toBe(80);
  });

  it("opens a pre-v2 session with defaults and hasZoomData = false", () => {
    const old = JSON.stringify({ version: 1, scene: { items: [CLIP_ITEM], overlays: [] } });
    const result = parseSession(old)!;
    expect(result.hasZoomData).toBe(false);
    expect(result.scene.zoomSegments).toEqual([]);
    expect(result.scene.redactions).toEqual([]);
    expect(result.scene.zoomSensitivity).toBe(55);
  });

  it("clamps a too-weak blur intensity on load", () => {
    const json = JSON.stringify({
      version: 1,
      scene: { items: [CLIP_ITEM], overlays: [], redactions: [{ ...BLUR, intensity: 5 }] },
    });
    expect((parseSession(json)!.scene.redactions[0] as typeof BLUR).intensity).toBe(40);
  });

  it("clamps scale and replaces an unknown cover fill", () => {
    const json = JSON.stringify({
      version: 1,
      scene: {
        items: [CLIP_ITEM],
        overlays: [],
        zoomSegments: [{ ...ZOOM, scale: 9 }],
        redactions: [{ ...COVER, fill: "red" }],
      },
    });
    const { scene } = parseSession(json)!;
    expect(scene.zoomSegments[0].scale).toBe(4);
    expect((scene.redactions[0] as typeof COVER).fill).toBe("#18181b");
  });

  it("drops an overlapping zoom instead of rejecting the whole session", () => {
    const json = JSON.stringify({
      version: 1,
      scene: {
        items: [CLIP_ITEM],
        overlays: [],
        zoomSegments: [
          ZOOM,
          { ...ZOOM, id: "overlaps", start: 6, end: 9 },
          { ...ZOOM, id: "clear", start: 9, end: 12 },
        ],
      },
    });
    expect(parseSession(json)!.scene.zoomSegments.map((z) => z.id)).toEqual(["auto-4600", "clear"]);
  });

  it.each([
    ["zoom with end <= start", { zoomSegments: [{ ...ZOOM, end: 4 }] }],
    ["zoom shorter than ZOOM_LIMITS.minSeconds", { zoomSegments: [{ ...ZOOM, end: 5.1 }] }],
    ["zoom with bad mode", { zoomSegments: [{ ...ZOOM, mode: "orbit" }] }],
    ["zoom with bad anchor", { zoomSegments: [{ ...ZOOM, anchor: { x: "a" } }] }],
    ["redaction of unknown kind", { redactions: [{ ...BLUR, kind: "smudge" }] }],
    ["redaction with empty rect", { redactions: [{ ...BLUR, rect: { x: 0, y: 0, w: 0, h: 1 } }] }],
    ["non-array zoomSegments", { zoomSegments: "nope" }],
    ["non-numeric sensitivity", { zoomSensitivity: "high" }],
  ])("rejects %s", (_label: string, extra: object) => {
    const json = JSON.stringify({
      version: 1,
      scene: { items: [CLIP_ITEM], overlays: [], ...extra },
    });
    expect(parseSession(json)).toBeNull();
  });
});
```

### Task 3 — pure helpers

**`apps/kaipu-record/src/renderer/src/features/video-editor/initial-zooms.ts`**

```ts
/**
 * Decides the zoom segments of the scene the editor OPENS with. Pure; called by the
 * loader before `useVideoScene` is created, so the result is the initial scene (not a
 * commit → the editor is not dirty after merely opening it).
 *
 *   no cursor track                 → scene unchanged (no zooms, as before v2)
 *   session saved with v2 data      → scene unchanged (the user's zooms win)
 *   fresh open / pre-v2 session     → detect at the scene's sensitivity
 */
import type { CursorTrack } from "@shared/cursor-track";
import type { VideoScene } from "./scene";
import { detectZoomSegments } from "./zoom/detect-zoom-segments";

export function withInitialZooms(
  scene: VideoScene,
  hasZoomData: boolean,
  track: CursorTrack | null,
  sourceDurationSeconds: number,
): VideoScene {
  if (!track || hasZoomData) return scene;
  return {
    ...scene,
    zoomSegments: detectZoomSegments(track, sourceDurationSeconds, scene.zoomSensitivity),
  };
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/initial-zooms.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import { initialScene } from "./scene";
import { withInitialZooms } from "./initial-zooms";

const TRACK: CursorTrack = {
  version: 1,
  display: { id: "1", width: 1600, height: 1000, scaleFactor: 2 },
  anchor: "exact",
  clicksAvailable: true,
  t: [0, 20_000],
  x: [0.5, 0.5],
  y: [0.5, 0.5],
  clicks: [{ t: 10_000, x: 0.5, y: 0.5, button: 0 }],
};

describe("withInitialZooms", () => {
  it("detects on a fresh open", () => {
    expect(withInitialZooms(initialScene(20), false, TRACK, 20).zoomSegments).toHaveLength(1);
  });
  it("keeps saved v2 zooms, even an empty list", () => {
    expect(withInitialZooms(initialScene(20), true, TRACK, 20).zoomSegments).toEqual([]);
  });
  it("does nothing without a track", () => {
    const scene = initialScene(20);
    expect(withInitialZooms(scene, false, null, 20)).toBe(scene);
  });
});
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/zoom-edits.ts`**

```ts
/**
 * Pure scene edits for zoom segments. Every edit a USER makes to a segment flips it to
 * `origin: "manual"`, so a later Sensitivity change / Re-analyse never overwrites it
 * (replaceAutoSegments keeps manual segments). Detection itself never goes through here.
 */
import type { CursorTrack } from "@shared/cursor-track";
import { newId, type VideoScene } from "../scene";
import { dragRangeEdge } from "../source-time";
import { clampAnchor } from "./camera-path";
import { DETECTION, detectZoomSegments, replaceAutoSegments } from "./detect-zoom-segments";
import { ZOOM_DEFAULTS, ZOOM_LIMITS, type ZoomSegment } from "./zoom-model";

/**
 * `start`/`end` are deliberately NOT patchable: a zoom's times have to respect its
 * neighbours, the source bounds and `ZOOM_LIMITS.minSeconds`, which only
 * `dragZoomEdge` knows how to enforce.
 */
export type ZoomPatch = Partial<Pick<ZoomSegment, "scale" | "mode" | "anchor" | "smoothing">>;

export function updateZoom(scene: VideoScene, id: string, patch: ZoomPatch): VideoScene {
  return {
    ...scene,
    zoomSegments: scene.zoomSegments
      .map((s) => {
        if (s.id !== id) return s;
        const next: ZoomSegment = { ...s, ...patch, origin: "manual" };
        next.scale = Math.min(ZOOM_LIMITS.maxScale, Math.max(ZOOM_LIMITS.minScale, next.scale));
        next.smoothing = Math.min(100, Math.max(0, Math.round(next.smoothing)));
        // A fixed segment always has an anchor that keeps its window inside the frame.
        if (next.mode === "fixed")
          next.anchor = clampAnchor(next.anchor ?? { x: 0.5, y: 0.5 }, next.scale);
        return next;
      })
      .sort((a, b) => a.start - b.start),
  };
}

/**
 * Timeline edge drag (doc 08 calls this, never `updateZoom`). Delegates the clamping to
 * `dragRangeEdge` (doc 06) so zooms and redactions obey one rule: stay inside
 * [0, sourceDuration], keep `ZOOM_LIMITS.minSeconds`, never cross a neighbouring zoom.
 */
export function dragZoomEdge(
  scene: VideoScene,
  id: string,
  edge: "start" | "end",
  to: number,
  sourceDurationSeconds: number,
): VideoScene {
  if (!scene.zoomSegments.some((s) => s.id === id)) return scene;
  const { start, end } = dragRangeEdge(
    scene.zoomSegments,
    id,
    edge,
    to,
    sourceDurationSeconds,
    ZOOM_LIMITS.minSeconds,
  );
  return {
    ...scene,
    zoomSegments: scene.zoomSegments
      .map((s) => (s.id === id ? { ...s, start, end, origin: "manual" as const } : s))
      .sort((a, b) => a.start - b.start),
  };
}

/** Dragging the camera box: lock the segment where it was dropped (see doc 05). */
export function lockZoomAt(
  scene: VideoScene,
  id: string,
  center: { x: number; y: number },
): VideoScene {
  return updateZoom(scene, id, { mode: "fixed", anchor: center });
}

export function removeZoom(scene: VideoScene, id: string): VideoScene {
  return { ...scene, zoomSegments: scene.zoomSegments.filter((s) => s.id !== id) };
}

export function addManualZoom(
  scene: VideoScene,
  window: { start: number; end: number },
): {
  scene: VideoScene;
  id: string;
} {
  const segment: ZoomSegment = {
    id: newId(),
    start: window.start,
    end: window.end,
    scale: DETECTION.clickScale,
    mode: "follow",
    anchor: null,
    smoothing: ZOOM_DEFAULTS.smoothing,
    origin: "manual",
    trigger: null,
  };
  return {
    scene: {
      ...scene,
      zoomSegments: [...scene.zoomSegments, segment].sort((a, b) => a.start - b.start),
    },
    id: segment.id,
  };
}

function sameSegment(a: ZoomSegment, b: ZoomSegment): boolean {
  return (
    a.id === b.id &&
    a.start === b.start &&
    a.end === b.end &&
    a.scale === b.scale &&
    a.mode === b.mode &&
    a.smoothing === b.smoothing &&
    a.origin === b.origin &&
    a.trigger === b.trigger &&
    (a.anchor?.x ?? null) === (b.anchor?.x ?? null) &&
    (a.anchor?.y ?? null) === (b.anchor?.y ?? null)
  );
}

/** Sensitivity slider / Re-analyse: regenerate the auto segments, keep the manual ones. */
export function applySensitivity(
  scene: VideoScene,
  track: CursorTrack,
  sourceDurationSeconds: number,
  sensitivity: number,
): VideoScene {
  const s = Math.min(100, Math.max(0, Math.round(sensitivity)));
  const zoomSegments = replaceAutoSegments(
    scene.zoomSegments,
    detectZoomSegments(track, sourceDurationSeconds, s),
  );
  // A Re-analyse that changes nothing — or a slider dragged back to where it started —
  // must return the SAME object: `commit` and `endInteract` no-op on reference equality,
  // so no undo step is pushed, the editor does not go dirty and the autosave stays quiet.
  if (
    s === scene.zoomSensitivity &&
    zoomSegments.length === scene.zoomSegments.length &&
    zoomSegments.every((z, i) => sameSegment(z, scene.zoomSegments[i]))
  ) {
    return scene;
  }
  return { ...scene, zoomSensitivity: s, zoomSegments };
}
```

Three contracts this file establishes for the PRs that consume it:

- **The timeline edge drag in [08](/plans/video-editor-v2/08-editor-layout-and-tracks/)
  must call `dragZoomEdge`, never `updateZoom`.** `ZoomPatch` has no `start`/`end`, so the
  type system enforces it. Doc 08 is being told the same thing.
- `dragRangeEdge` comes from `source-time.ts`
  ([06](/plans/video-editor-v2/06-time-base-cuts-and-mapping/), shipped in PR 4), so zooms
  and redactions clamp identically and the no-overlap rule lives in exactly one place.
- **`applySensitivity` returns the same scene object when nothing changed** — same
  sensitivity, same resulting segment list. `commit` and `endInteract` both no-op on
  reference equality, so a Re-analyse that finds nothing new pushes no undo step, leaves
  the editor clean and does not wake the autosave.

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/zoom-edits.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import { initialScene } from "../scene";
import {
  addManualZoom,
  applySensitivity,
  dragZoomEdge,
  lockZoomAt,
  removeZoom,
  updateZoom,
} from "./zoom-edits";
import type { ZoomSegment } from "./zoom-model";

const AUTO: ZoomSegment = {
  id: "auto-1000",
  start: 1,
  end: 3,
  scale: 2,
  mode: "follow",
  anchor: null,
  smoothing: 70,
  origin: "auto",
  trigger: "click",
};

const withZoom = { ...initialScene(20), zoomSegments: [AUTO] };

const TRACK: CursorTrack = {
  version: 1,
  display: { id: "1", width: 1600, height: 1000, scaleFactor: 2 },
  anchor: "exact",
  clicksAvailable: true,
  t: [0, 20_000],
  x: [0.5, 0.5],
  y: [0.5, 0.5],
  clicks: [{ t: 10_000, x: 0.5, y: 0.5, button: 0 }],
};

describe("zoom edits", () => {
  it("any user edit flips an auto segment to manual and keeps its trigger", () => {
    const [s] = updateZoom(withZoom, AUTO.id, { scale: 3 }).zoomSegments;
    expect(s).toMatchObject({ scale: 3, origin: "manual", trigger: "click" });
  });
  it("clamps scale and smoothing", () => {
    const [s] = updateZoom(withZoom, AUTO.id, { scale: 9, smoothing: 140.4 }).zoomSegments;
    expect(s.scale).toBe(4);
    expect(s.smoothing).toBe(100);
  });
  it("lockZoomAt switches to fixed with a clamped anchor", () => {
    const [s] = lockZoomAt(withZoom, AUTO.id, { x: 0.99, y: 0.01 }).zoomSegments;
    expect(s).toMatchObject({ mode: "fixed", anchor: { x: 0.75, y: 0.25 }, origin: "manual" });
  });
  it("switching to fixed without an anchor centers it", () => {
    const [s] = updateZoom(withZoom, AUTO.id, { mode: "fixed" }).zoomSegments;
    expect(s.anchor).toEqual({ x: 0.5, y: 0.5 });
  });
  it("removes and adds", () => {
    expect(removeZoom(withZoom, AUTO.id).zoomSegments).toEqual([]);
    const { scene, id } = addManualZoom(withZoom, { start: 5, end: 8 });
    expect(scene.zoomSegments.map((s) => s.id)).toEqual([AUTO.id, id]);
    expect(scene.zoomSegments[1]).toMatchObject({
      origin: "manual",
      trigger: null,
      mode: "follow",
    });
  });
  it("applySensitivity replaces autos, keeps manuals, stores the value", () => {
    const edited = updateZoom(withZoom, AUTO.id, { scale: 3 });
    const next = applySensitivity(edited, TRACK, 20, 60);
    expect(next.zoomSensitivity).toBe(60);
    expect(next.zoomSegments.map((s) => s.origin)).toEqual(["manual", "auto"]);
    expect(next.zoomSegments[1].start).toBeCloseTo(9.6, 6);
  });
  it("applySensitivity returns the same scene when nothing changes", () => {
    const analysed = applySensitivity(withZoom, TRACK, 20, 55);
    expect(analysed).not.toBe(withZoom);
    expect(applySensitivity(analysed, TRACK, 20, 55)).toBe(analysed);
  });
});

describe("dragZoomEdge", () => {
  const two = {
    ...initialScene(20),
    zoomSegments: [AUTO, { ...AUTO, id: "auto-8000", start: 8, end: 12 }],
  };
  it("stops at the neighbour and flips the segment to manual", () => {
    const [, s] = dragZoomEdge(two, "auto-8000", "start", 2, 20).zoomSegments;
    expect(s).toMatchObject({ start: 3, end: 12, origin: "manual" });
  });
  it("keeps the minimum length", () => {
    const [s] = dragZoomEdge(two, "auto-1000", "end", 1.2, 20).zoomSegments;
    expect(s.end).toBe(2);
  });
  it("stays inside the source and ignores an unknown id", () => {
    const [, s] = dragZoomEdge(two, "auto-8000", "end", 99, 20).zoomSegments;
    expect(s.end).toBe(20);
    expect(dragZoomEdge(two, "nope", "end", 5, 20)).toBe(two);
  });
});
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/privacy/redaction-edits.ts`**

```ts
/** Pure scene edits for privacy regions (blur / cover). */
import { newId, type VideoScene } from "../scene";
import {
  type BlurRedaction,
  clampIntensity,
  type CoverRedaction,
  type NormRect,
  REDACTION,
  type Redaction,
} from "./redaction";

export function addRedaction(
  scene: VideoScene,
  kind: Redaction["kind"],
  rect: NormRect,
  window: { start: number; end: number },
): { scene: VideoScene; id: string } {
  const id = newId();
  const redaction: Redaction =
    kind === "blur"
      ? {
          id,
          kind,
          start: window.start,
          end: window.end,
          rect,
          intensity: REDACTION.defaultIntensity,
          style: "gaussian",
        }
      : {
          id,
          kind,
          start: window.start,
          end: window.end,
          rect,
          fill: REDACTION.coverFills[0],
          label: "",
        };
  return { scene: { ...scene, redactions: [...scene.redactions, redaction] }, id };
}

export type BlurPatch = Partial<
  Pick<BlurRedaction, "start" | "end" | "rect" | "intensity" | "style">
>;
export type CoverPatch = Partial<Pick<CoverRedaction, "start" | "end" | "rect" | "fill" | "label">>;

export function updateRedaction(
  scene: VideoScene,
  id: string,
  patch: BlurPatch | CoverPatch,
): VideoScene {
  return {
    ...scene,
    redactions: scene.redactions.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch } as Redaction;
      if (next.kind === "blur") next.intensity = clampIntensity(next.intensity);
      return next;
    }),
  };
}

export function removeRedaction(scene: VideoScene, id: string): VideoScene {
  return { ...scene, redactions: scene.redactions.filter((r) => r.id !== id) };
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/privacy/redaction-edits.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { initialScene } from "../scene";
import { addRedaction, removeRedaction, updateRedaction } from "./redaction-edits";

const RECT = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };

describe("redaction edits", () => {
  it("adds a blur with safe defaults", () => {
    const { scene, id } = addRedaction(initialScene(10), "blur", RECT, { start: 1, end: 6 });
    expect(scene.redactions).toEqual([
      { id, kind: "blur", start: 1, end: 6, rect: RECT, intensity: 70, style: "gaussian" },
    ]);
  });
  it("adds a plain cover", () => {
    const { scene } = addRedaction(initialScene(10), "cover", RECT, { start: 1, end: 6 });
    expect(scene.redactions[0]).toMatchObject({ kind: "cover", fill: "#18181b", label: "" });
  });
  it("never lets intensity drop below the minimum", () => {
    const { scene, id } = addRedaction(initialScene(10), "blur", RECT, { start: 1, end: 6 });
    const next = updateRedaction(scene, id, { intensity: 10 });
    expect(next.redactions[0]).toMatchObject({ intensity: 40 });
  });
  it("removes", () => {
    const { scene, id } = addRedaction(initialScene(10), "cover", RECT, { start: 1, end: 6 });
    expect(removeRedaction(scene, id).redactions).toEqual([]);
  });
});
```

### Task 4 — selection model

**`apps/kaipu-record/src/renderer/src/features/video-editor/editor-selection.ts`**

```ts
/**
 * One selection for the whole editor: a clip/slide, an annotation, a zoom or a privacy
 * region — never two at once. Selecting any kind clears the others, which is what makes
 * the inspector panel, Delete and Esc unambiguous (spec § 7: the panel "changes with the
 * selection").
 */
import { useCallback, useState } from "react";

export type SelectionKind = "item" | "overlay" | "zoom" | "redaction";
export type EditorSelection = { kind: SelectionKind; id: string } | null;

export function selectedIdOf(selection: EditorSelection, kind: SelectionKind): string | null {
  return selection?.kind === kind ? selection.id : null;
}

export interface EditorSelectionController {
  selection: EditorSelection;
  itemId: string | null;
  overlayId: string | null;
  zoomId: string | null;
  redactionId: string | null;
  /** `id = null` clears the selection only if it currently is of that kind. */
  select(kind: SelectionKind, id: string | null): void;
  clear(): void;
}

export function useEditorSelection(): EditorSelectionController {
  const [selection, setSelection] = useState<EditorSelection>(null);
  const select = useCallback((kind: SelectionKind, id: string | null) => {
    setSelection((current) =>
      id === null ? (current?.kind === kind ? null : current) : { kind, id },
    );
  }, []);
  const clear = useCallback(() => setSelection(null), []);
  return {
    selection,
    itemId: selectedIdOf(selection, "item"),
    overlayId: selectedIdOf(selection, "overlay"),
    zoomId: selectedIdOf(selection, "zoom"),
    redactionId: selectedIdOf(selection, "redaction"),
    select,
    clear,
  };
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/editor-selection.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useEditorSelection } from "./editor-selection";

describe("useEditorSelection", () => {
  it("selecting one kind clears the others", () => {
    const { result } = renderHook(() => useEditorSelection());
    act(() => result.current.select("overlay", "o1"));
    expect(result.current.overlayId).toBe("o1");
    act(() => result.current.select("zoom", "z1"));
    expect(result.current.overlayId).toBeNull();
    expect(result.current.zoomId).toBe("z1");
  });
  it("select(kind, null) only clears that kind", () => {
    const { result } = renderHook(() => useEditorSelection());
    act(() => result.current.select("zoom", "z1"));
    act(() => result.current.select("overlay", null));
    expect(result.current.zoomId).toBe("z1");
    act(() => result.current.select("zoom", null));
    expect(result.current.selection).toBeNull();
  });
});
```

### Task 5 — loader

In `src/renderer/src/pages/video-editor/video-editor-page.tsx`, `VideoEditorLoader`:

- [ ] Imports: `import { parseCursorTrack, type CursorTrack } from "@shared/cursor-track";`
      and `import { withInitialZooms } from "@renderer/features/video-editor/initial-zooms";`.
- [ ] Replace `const [resolvedScene, setResolvedScene] = useState<VideoScene | null>(null);` with:

  ```ts
  const [resolved, setResolved] = useState<{
    scene: VideoScene;
    cursorTrack: CursorTrack | null;
  } | null>(null);
  ```

- [ ] At the top of the async IIFE (before `loadVideoEditSession`) add:

  ```ts
  // The cursor track is best-effort and independent of the session: a missing or
  // malformed track just means no auto zooms (the editor behaves as before v2).
  let cursorTrack: CursorTrack | null = null;
  try {
    const trackJson = await window.electronAPI.loadCursorTrack(source.id);
    cursorTrack = trackJson ? parseCursorTrack(trackJson) : null;
  } catch {
    cursorTrack = null;
  }
  if (cancelled) return;
  // Initial detection happens HERE, before useVideoScene exists, so it is part of the
  // initial scene — not a commit — and merely opening the editor is not an edit.
  const open = (scene: VideoScene, hasZoomData: boolean): void => {
    if (cancelled) return;
    setResolved({
      scene: withInitialZooms(scene, hasZoomData, cursorTrack, source.durationSeconds),
      cursorTrack,
    });
  };
  ```

- [ ] Replace each `setResolvedScene(filteredScene)` with `open(filteredScene, session.hasZoomData)`,
      and each `setResolvedScene(initialScene(source.durationSeconds))` (three places,
      including the `catch`) with `open(initialScene(source.durationSeconds), false)`.
      Remove the now-redundant `if (!cancelled)` guards around them (`open` checks).
- [ ] Render: `if (resolved === null) return <div className={styles.page} />;` and
      `<VideoEditor source={source} resolvedScene={resolved.scene} cursorTrack={resolved.cursorTrack} assetStoreRef={assetStoreRef} />`.
- [ ] `VideoEditor` props type: add
      `/** Parsed \`.cursor.json\`, or null (no track / window source / pre-v2 recording). \*/ cursorTrack: CursorTrack | null;`.
**Do not destructure it yet** — `noUnusedParameters`fails the typecheck on an unused
binding. PR 6 adds`cursorTrack,` to the destructuring when it starts using it.

### Task 6 — selection migration in `VideoEditor`

- [ ] Import `useEditorSelection` from `@renderer/features/video-editor/editor-selection`.
- [ ] Replace the two `useState` selections with:

  ```ts
  const selection = useEditorSelection();
  // `select` / `clear` are stable (useCallback, no deps); the `selection` object itself
  // is rebuilt every render, so never put it in a dependency array.
  const { select: selectKind, clear: clearSelection } = selection;
  const selectedItemId = selection.itemId;
  const selectedOverlayId = selection.overlayId;
  const setSelectedItemId = useCallback((id: string | null) => selectKind("item", id), [selectKind]);
  const setSelectedOverlayId = useCallback(
    (id: string | null) => selectKind("overlay", id),
    [selectKind],
  );
  ```

  Keep every existing call site of `setSelectedItemId` / `setSelectedOverlayId` unchanged.

- [ ] Add the stale-selection effects for the new kinds, next to the existing two:

  ```ts
  const selectedZoomId = selection.zoomId;
  const selectedRedactionId = selection.redactionId;
  useEffect(() => {
    if (selectedZoomId && !scene.zoomSegments.some((z) => z.id === selectedZoomId)) {
      selectKind("zoom", null);
    }
  }, [scene.zoomSegments, selectedZoomId, selectKind]);
  useEffect(() => {
    if (selectedRedactionId && !scene.redactions.some((r) => r.id === selectedRedactionId)) {
      selectKind("redaction", null);
    }
  }, [scene.redactions, selectedRedactionId, selectKind]);
  ```

- [ ] In the keydown handler, before the Delete/Backspace branch add:

  ```ts
  // `!document.fullscreenElement`: in fullscreen the browser handles Esc itself to
  // leave it — clearing the selection at the same time would be a second, invisible
  // action the user never asked for.
  if (e.key === "Escape" && !document.fullscreenElement) {
    clearSelection();
    return;
  }
  ```

  and change the Delete branch to the precedence order (the zoom handler arrives in PR 6,
  the redaction handler in PR 8 — add each line in that PR; until then only the last
  two lines exist):

  ```ts
  if (!isMod && (e.key === "Delete" || e.key === "Backspace")) {
    if (selectedRedactionId) handleRemoveRedaction(selectedRedactionId);
    else if (selectedZoomId) handleRemoveZoom(selectedZoomId);
    else if (selectedOverlayId) handleDeleteOverlay();
    else if (!deleteDisabled) handleDeleteSelected();
  }
  ```

- [ ] Add `clearSelection`, `selectedZoomId` and `selectedRedactionId` to that effect's
      dependency array. Nothing enforces this — `react/exhaustive-deps` is configured at
      `warn` in the repo's root `.oxlintrc.json` and `bun run lint` is not one of the
      pre-commit checks (audit rule 4) — but the handler now closes over all three, and a
      stale `clearSelection` closure is exactly the kind of bug that only shows up after
      a later refactor makes it unstable.

### Task 5 + 6 as one diff (authoritative)

The steps above, applied to `main` at `d18dbbd`, produce exactly this diff (verified with
`git apply --check`; the page typechecks and `video-editor-page.test.tsx` passes). If a
hunk does not apply because the page changed since, follow the steps instead.

**Diff — `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx
+++ b/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx
@@ -11,6 +11,7 @@
   VolumeX,
 } from "lucide-react";
 import { useTranslations } from "@kaipu/i18n";
+import { parseCursorTrack, type CursorTrack } from "@shared/cursor-track";
 import { captureException } from "@renderer/features/analytics";
 import {
   initialScene,
@@ -45,6 +46,8 @@
   type SlideAssetStore,
 } from "@renderer/features/video-editor/slide-assets";
 import { parseSession, serializeSession } from "@renderer/features/video-editor/session";
+import { withInitialZooms } from "@renderer/features/video-editor/initial-zooms";
+import { useEditorSelection } from "@renderer/features/video-editor/editor-selection";
 import { usePreviewPlayback } from "@renderer/features/video-editor/use-preview-playback";
 import { useSourceThumbnails } from "@renderer/features/video-editor/use-source-thumbnails";
 import { useVideoScene } from "@renderer/features/video-editor/use-video-scene";
@@ -123,7 +126,10 @@
     return () => assetStoreRef.current.dispose();
   }, []);

-  const [resolvedScene, setResolvedScene] = useState<VideoScene | null>(null);
+  const [resolved, setResolved] = useState<{
+    scene: VideoScene;
+    cursorTrack: CursorTrack | null;
+  } | null>(null);

   useEffect(() => {
     // Guards against calling restoreAsset or setting state after unmount —
@@ -131,6 +137,25 @@
     // then restoreAsset would recreate object URLs that are never revoked.
     let cancelled = false;
     void (async () => {
+      // The cursor track is best-effort and independent of the session: a missing or
+      // malformed track just means no auto zooms (the editor behaves as before v2).
+      let cursorTrack: CursorTrack | null = null;
+      try {
+        const trackJson = await window.electronAPI.loadCursorTrack(source.id);
+        cursorTrack = trackJson ? parseCursorTrack(trackJson) : null;
+      } catch {
+        cursorTrack = null;
+      }
+      if (cancelled) return;
+      // Initial detection happens HERE, before useVideoScene exists, so it is part of the
+      // initial scene — not a commit — and merely opening the editor is not an edit.
+      const open = (scene: VideoScene, hasZoomData: boolean): void => {
+        if (cancelled) return;
+        setResolved({
+          scene: withInitialZooms(scene, hasZoomData, cursorTrack, source.durationSeconds),
+          cursorTrack,
+        });
+      };
       try {
         const saved = await window.electronAPI.loadVideoEditSession(source.id);
         if (cancelled) return;
@@ -156,19 +181,19 @@
               ),
             };
             showToast({ message: t("restored") });
-            setResolvedScene(filteredScene);
+            open(filteredScene, session.hasZoomData);
           } else {
             // Session file exists but is invalid (schema changed, corruption, etc.).
             showToast({ message: t("restoreError") });
-            if (!cancelled) setResolvedScene(initialScene(source.durationSeconds));
+            open(initialScene(source.durationSeconds), false);
           }
         } else {
           // No saved session — fresh start, no toast.
-          if (!cancelled) setResolvedScene(initialScene(source.durationSeconds));
+          open(initialScene(source.durationSeconds), false);
         }
       } catch {
         // IPC failure is non-fatal; open a fresh editor without surfacing the error.
-        if (!cancelled) setResolvedScene(initialScene(source.durationSeconds));
+        open(initialScene(source.durationSeconds), false);
       }
     })();
     return () => {
@@ -176,14 +201,19 @@
     };
   }, []); // [] correct: source is stable per VideoEditorPage's key={location.key}

-  if (resolvedScene === null) {
+  if (resolved === null) {
     // Brief loading state while the session IPC resolves. The editor grows the window
     // on mount; showing a blank page here avoids a visible size jump.
     return <div className={styles.page} />;
   }

   return (
-    <VideoEditor source={source} resolvedScene={resolvedScene} assetStoreRef={assetStoreRef} />
+    <VideoEditor
+      source={source}
+      resolvedScene={resolved.scene}
+      cursorTrack={resolved.cursorTrack}
+      assetStoreRef={assetStoreRef}
+    />
   );
 }

@@ -194,6 +224,8 @@
 }: {
   source: VideoEditorSource;
   resolvedScene: VideoScene;
+  /** Parsed `.cursor.json`, or null (no track / window source / pre-v2 recording). */
+  cursorTrack: CursorTrack | null;
   assetStoreRef: React.MutableRefObject<SlideAssetStore>;
 }): React.JSX.Element {
   const t = useTranslations("videoEditor");
@@ -233,14 +265,26 @@
   const videoExport = useVideoExport();
   const mediaUrl = `kaipu-media://recording/${source.id}`;
   const thumbnails = useSourceThumbnails(mediaUrl, source.durationSeconds);
-  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
+  const selection = useEditorSelection();
+  // `select` / `clear` are stable (useCallback, no deps); the `selection` object itself
+  // is rebuilt every render, so never put it in a dependency array.
+  const { select: selectKind, clear: clearSelection } = selection;
+  const selectedItemId = selection.itemId;
+  const selectedOverlayId = selection.overlayId;
+  const setSelectedItemId = useCallback(
+    (id: string | null) => selectKind("item", id),
+    [selectKind],
+  );
+  const setSelectedOverlayId = useCallback(
+    (id: string | null) => selectKind("overlay", id),
+    [selectKind],
+  );
   // A delete must clamp the playhead into the new (shorter) timeline, but the preview
   // hook's layoutRef only picks up the new layout on the NEXT render — seeking
   // synchronously here would map the target time through the stale, pre-delete layout.
   // Queue it and let the effect below (keyed on `layout`) fire the actual seek once
   // layoutRef has caught up.
   const pendingSeekRef = useRef<number | null>(null);
-  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
   // Fullscreen state — true while document.fullscreenElement is this page's <main> stage.
   const [isFullscreen, setIsFullscreen] = useState(false);
   // Ref for the stage <main> element, used to request fullscreen on it directly.
@@ -263,6 +307,19 @@
     }
   }, [scene.overlays, selectedOverlayId]);

+  const selectedZoomId = selection.zoomId;
+  const selectedRedactionId = selection.redactionId;
+  useEffect(() => {
+    if (selectedZoomId && !scene.zoomSegments.some((z) => z.id === selectedZoomId)) {
+      selectKind("zoom", null);
+    }
+  }, [scene.zoomSegments, selectedZoomId, selectKind]);
+  useEffect(() => {
+    if (selectedRedactionId && !scene.redactions.some((r) => r.id === selectedRedactionId)) {
+      selectKind("redaction", null);
+    }
+  }, [scene.redactions, selectedRedactionId, selectKind]);
+
   // Track fullscreen state via the fullscreenchange event so pressing Esc (which the
   // browser handles natively) still syncs isFullscreen back to false.
   useEffect(() => {
@@ -530,6 +587,13 @@
         if (!splitDisabled) handleSplit();
         return;
       }
+      // `!document.fullscreenElement`: in fullscreen the browser handles Esc itself to
+      // leave it — clearing the selection at the same time would be a second, invisible
+      // action the user never asked for.
+      if (e.key === "Escape" && !document.fullscreenElement) {
+        clearSelection();
+        return;
+      }
       // Annotation selection takes precedence over segment deletion when both exist —
       // an annotation is almost always the more "local" thing the user just touched.
       // Cmd/Ctrl+Backspace is a common "delete line/word" chord in text contexts —
@@ -552,6 +616,9 @@
     handleDeleteSelected,
     selectedOverlayId,
     handleDeleteOverlay,
+    clearSelection,
+    selectedZoomId,
+    selectedRedactionId,
   ]);

   return (
```

### Task 7 — session autosave

This is the second half of W11 and the reason a closed window no longer eats the user's
privacy work. Read [the autosave rule](#the-autosave-rule-what-dirty-means-now) first; the
code below implements exactly that and nothing more.

- [ ] Create:

**`apps/kaipu-record/src/renderer/src/features/video-editor/use-session-autosave.ts`**

```ts
/**
 * Debounced autosave of the video edit session.
 *
 * Before v2 the session was written only on export. `useBlocker` intercepts in-app
 * navigation and nothing else, so closing the window (⌘W, quit, a crash) silently threw
 * away every cut, every zoom and — the part that actually matters — every privacy
 * redaction the user had just drawn. See plans/video-editor-v2/07 and audit W11.
 *
 * Contract:
 *   - a write is scheduled AUTOSAVE_DEBOUNCE_MS after the scene changes, never while a
 *     drag owns the scene (`interacting`) — one write per gesture, not per pointermove;
 *   - the pending write is flushed on unmount and on `beforeunload`;
 *   - `pendingRef` is true from the moment the scene changes until the write resolves;
 *     the page's navigation blocker reads it, so the discard dialog now means "a write
 *     is still pending or failed", not "you have edits";
 *   - `cancel()` drops the pending write — that is what the dialog's Discard button
 *     does, and it is what makes the dialog honest.
 *
 * The scene the editor OPENED with is never written back: opening a recording and
 * leaving must not create a session file (and must not turn a pre-v2 recording into a
 * v2 one just because the detector proposed some zooms).
 */
import { useCallback, useEffect, useRef } from "react";
import { captureException } from "@renderer/features/analytics";
import type { VideoScene } from "./scene";
import { serializeSession } from "./session";
import type { SlideAssetStore } from "./slide-assets";

export const AUTOSAVE_DEBOUNCE_MS = 800;

export interface SessionAutosave {
  /** True while an edit has not reached the session file yet (or its write failed). */
  pendingRef: React.MutableRefObject<boolean>;
  /** Write now, skipping the debounce; resolves once the write settles. */
  flush(): Promise<void>;
  /** Drop the pending write (Discard, or an explicit save that supersedes it). */
  cancel(): void;
}

export function useSessionAutosave(
  sourceId: string,
  scene: VideoScene,
  interacting: boolean,
  assetStoreRef: React.MutableRefObject<SlideAssetStore>,
): SessionAutosave {
  const openedWith = useRef(scene);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const touchedRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const write = useCallback(async (): Promise<void> => {
    const snapshot = sceneRef.current;
    try {
      const assets = assetStoreRef.current
        .entries()
        .map((a) => ({ assetId: a.assetId, bytes: a.bytes }));
      await window.electronAPI.saveVideoEditSession(sourceId, serializeSession(snapshot), assets);
      // An edit may have landed while the write was in flight; it owns the flag now.
      if (sceneRef.current === snapshot) pendingRef.current = false;
    } catch (error) {
      // Non-fatal: keep `pendingRef` true so the discard dialog still warns on the way
      // out, and let the next edit retry.
      captureException(error, { context: "video-edit-session-autosave" });
    }
  }, [sourceId, assetStoreRef]);

  const cancel = useCallback((): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = false;
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!pendingRef.current) return;
    await write();
  }, [write]);

  // Declared BEFORE the flush effect on purpose: React runs cleanups in declaration
  // order, so the debounce timer is cleared before the unmount flush fires.
  useEffect(() => {
    if (!touchedRef.current && scene === openedWith.current) return;
    touchedRef.current = true;
    // Set before the `interacting` early return so closing the window mid-drag still
    // flushes the live scene.
    pendingRef.current = true;
    if (interacting) return;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void write();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [scene, interacting, write]);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onBeforeUnload = (): void => {
      // beforeunload cannot await. The write is fired and the process may die before
      // the IPC round-trip lands, so at most AUTOSAVE_DEBOUNCE_MS of work is at risk —
      // which is the whole point of keeping the debounce short.
      void flushRef.current();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flushRef.current();
    };
  }, []);

  return { pendingRef, flush, cancel };
}
```

- [ ] Create (renderer project — jsdom, fake timers):

**`apps/kaipu-record/src/renderer/src/features/video-editor/use-session-autosave.test.ts`**

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene, type VideoScene } from "./scene";
import type { SlideAssetStore } from "./slide-assets";
import { AUTOSAVE_DEBOUNCE_MS, useSessionAutosave } from "./use-session-autosave";

const assetStoreRef = {
  current: { entries: () => [] } as unknown as SlideAssetStore,
};

let saved: { id: string; json: string }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  saved = [];
  window.electronAPI = {
    saveVideoEditSession: async (id: string, json: string) => {
      saved.push({ id, json });
    },
  } as unknown as typeof window.electronAPI;
});

afterEach(() => {
  vi.useRealTimers();
});

const OPENED = initialScene(10);

function render(scene: VideoScene = OPENED, interacting = false) {
  return renderHook(
    ({ scene: s, interacting: i }) => useSessionAutosave("rec-1", s, i, assetStoreRef),
    { initialProps: { scene, interacting } },
  );
}

describe("useSessionAutosave", () => {
  it("never writes the scene the editor opened with", async () => {
    render();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(saved).toEqual([]);
  });

  it("writes once, debounced, after an edit", async () => {
    const { rerender } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 60 }, interacting: false });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1);
    });
    expect(saved).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0].json).scene.zoomSensitivity).toBe(60);
  });

  it("collapses a burst of edits into one write", async () => {
    const { rerender } = render();
    for (const value of [56, 57, 58]) {
      rerender({ scene: { ...OPENED, zoomSensitivity: value }, interacting: false });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
    }
    expect(saved).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0].json).scene.zoomSensitivity).toBe(58);
  });

  it("does not write while a drag owns the scene, and writes once it ends", async () => {
    const { rerender } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 61 }, interacting: true });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(saved).toHaveLength(0);
    rerender({ scene: { ...OPENED, zoomSensitivity: 61 }, interacting: false });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(saved).toHaveLength(1);
  });

  it("flushes the pending write on unmount (closing the window)", async () => {
    const { rerender, unmount } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 62 }, interacting: false });
    await act(async () => {
      unmount();
    });
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0].json).scene.zoomSensitivity).toBe(62);
  });

  it("flushes on beforeunload", async () => {
    const { rerender } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 63 }, interacting: false });
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    expect(saved).toHaveLength(1);
  });

  it("cancel() drops the pending write, unmount included", async () => {
    const { result, rerender, unmount } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 64 }, interacting: false });
    act(() => result.current.cancel());
    await act(async () => {
      vi.advanceTimersByTime(5000);
      unmount();
    });
    expect(saved).toEqual([]);
  });
});
```

- [ ] Wire it into the page. Applied on top of the Task 5 + 6 diff above, these steps
      produce exactly the diff that follows (verified with `git apply --check`; the two
      diffs apply in sequence and the result is `oxfmt`-clean):
  - import `useSessionAutosave`;
  - call it in `VideoEditor`, right after `layout`, with
    `(source.id, scene, controller.interacting, assetStoreRef)`;
  - point `shouldBlock` at `autosave.pendingRef` and delete `dirtyRef` — `controller.dirty`
    now drives the Undo button only;
  - call `autosave.cancel()` at the top of the export's `onSaved` (that explicit save
    supersedes the queued one) and add `autosave` to `handleExport`'s deps;
  - call `autosave.cancel()` in the discard dialog's Discard button before
    `blocker.proceed()`.

**Diff — `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx
+++ b/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx
@@ -48,6 +48,7 @@
 import { parseSession, serializeSession } from "@renderer/features/video-editor/session";
 import { withInitialZooms } from "@renderer/features/video-editor/initial-zooms";
 import { useEditorSelection } from "@renderer/features/video-editor/editor-selection";
+import { useSessionAutosave } from "@renderer/features/video-editor/use-session-autosave";
 import { usePreviewPlayback } from "@renderer/features/video-editor/use-preview-playback";
 import { useSourceThumbnails } from "@renderer/features/video-editor/use-source-thumbnails";
 import { useVideoScene } from "@renderer/features/video-editor/use-video-scene";
@@ -239,26 +240,33 @@
   const controller = useVideoScene(resolvedScene);
   const { scene } = controller;
   const layout = useMemo(() => toLayout(scene.items), [scene.items]);
-  // Blocks in-app navigation (e.g. the sidebar) while there's an edit that would be
-  // lost — same useBlocker pattern as the screenshot editor.
+  // Writes the session ~800 ms after every commit/endInteract, and flushes on unmount
+  // and beforeunload. See plans/video-editor-v2/07: before this, closing the window
+  // threw away every cut, zoom and redaction, because useBlocker below only ever sees
+  // in-app navigation.
+  const autosave = useSessionAutosave(source.id, scene, controller.interacting, assetStoreRef);
+  // Blocks in-app navigation (e.g. the sidebar) while an edit has NOT reached the
+  // session file yet — same useBlocker pattern as the screenshot editor, but now about
+  // "not written" rather than "edited": with autosave on, an edit that is already on
+  // disk is not lost by leaving, so warning about it would be a lie. In practice the
+  // dialog therefore appears only inside the debounce window or after a failed write,
+  // and its Discard button drops the pending write (`autosave.cancel()`) so it means
+  // exactly what it says.
   //
-  // The predicate reads refs instead of closing over `controller.dirty`/a plain
-  // boolean: react-router's data router consults the predicate SYNCHRONOUSLY inside
-  // `navigate()`, before React has re-rendered. handleExport's onSaved callback calls
-  // `controller.markClean()` (which schedules setPast([])/setFuture([])) immediately
-  // followed by `navigate(...)` — React 19 batches those state updates, so a boolean
-  // `dirty` value closed over at render time would still read `true` at navigate-time
-  // and the "discard changes" dialog would pop on every successful export. Refs
-  // sidestep the batching entirely: they're updated synchronously and read
-  // synchronously by the predicate.
-  const dirtyRef = useRef(controller.dirty);
-  dirtyRef.current = controller.dirty;
+  // The predicate reads a ref instead of a plain boolean: react-router's data router
+  // consults it SYNCHRONOUSLY inside `navigate()`, before React has re-rendered, and
+  // React 19 batches the state updates that a render-time boolean would depend on.
+  // Refs sidestep the batching entirely.
+  const pendingSaveRef = autosave.pendingRef;
   // Set to true right before the post-export `navigate()` so that programmatic
   // navigation always proceeds, regardless of batching timing. Normal in-app
-  // navigation (e.g. the sidebar) never touches this ref, so it still blocks while
-  // dirty.
+  // navigation (e.g. the sidebar) never touches this ref, so it still blocks while a
+  // write is pending.
   const bypassBlockerRef = useRef(false);
-  const shouldBlock = useCallback(() => dirtyRef.current && !bypassBlockerRef.current, []);
+  const shouldBlock = useCallback(
+    () => pendingSaveRef.current && !bypassBlockerRef.current,
+    [pendingSaveRef],
+  );
   const blocker = useBlocker(shouldBlock);
   const playback = usePreviewPlayback(layout);
   const videoTools = useVideoTools();
@@ -445,6 +453,9 @@
       previewWidth: video.clientWidth,
       slideAssets: assetStoreRef.current,
       onSaved: async (recording) => {
+        // This save supersedes whatever the autosave still had queued; dropping it
+        // avoids a second write of the same scene right before unmount.
+        autosave.cancel();
         // Persist the session before navigating away so reopening the editor on the
         // original recording restores cuts/overlays/slides. Non-fatal if it fails —
         // the export already succeeded and the user lands on the new recording.
@@ -467,7 +478,7 @@
         navigate(`/library/${recording.assetId}`);
       },
     });
-  }, [playback, videoExport, scene, source, controller, navigate, assetStoreRef]);
+  }, [playback, videoExport, scene, source, controller, navigate, assetStoreRef, autosave]);

   const handleDeleteOverlay = useCallback(() => {
     // Same rationale as handleDeleteSelected: don't touch scene/selection while a
@@ -758,7 +769,15 @@
             <ModalButton variant="ghost" onClick={() => blocker.reset()}>
               {t("keepEditing")}
             </ModalButton>
-            <ModalButton variant="danger" onClick={() => blocker.proceed()}>
+            <ModalButton
+              variant="danger"
+              onClick={() => {
+                // Discard = drop the queued write, so the unmount flush does not save
+                // the very edits the user just chose to throw away.
+                autosave.cancel();
+                blocker.proceed();
+              }}
+            >
               <Trash2 size={15} strokeWidth={1.8} />
               {t("discard")}
             </ModalButton>
```

`video-editor-page.test.tsx` passes unchanged: its three blocker cases navigate inside the
800 ms debounce window, so `pendingRef` is still true and the dialog still appears, while
the export case now clears it explicitly. If that ever turns racy on a slow machine, wrap
those cases in `vi.useFakeTimers()` — do **not** raise `AUTOSAVE_DEBOUNCE_MS`.

### Task 8 — verify

- [ ] Checks (audit rule 4). All existing video-editor tests must still pass.
- [ ] Manual: open a pre-v2 recording (no `cursor.json`) → identical to before. Open a
      PR-2 recording → leave immediately → **no** discard dialog and **no** session file
      is created. Export → reopen → the toast "Se restauró tu edición anterior" appears
      and zooms are the same.
- [ ] Manual (autosave): make one edit, wait ~1 s, close the editor window (⌘W) without
      exporting, reopen the recording → the edit is back. Make one edit and close within
      ~200 ms → the discard dialog appears; Discard → reopen → the edit is gone; Keep
      editing → wait → close → the edit is back.

## Acceptance criteria

- Opening and leaving never marks the editor dirty and never writes a session file.
- A session saved by this build opens in a pre-v2 build (it ignores the new keys).
- A user-edited zoom survives any Sensitivity change, and a no-op Re-analyse leaves the
  editor clean (`applySensitivity` returns the same object).
- A zoom under `ZOOM_LIMITS.minSeconds` is rejected on load; zooms that overlap after the
  sort are dropped, so the parsed scene always satisfies the camera's one-active-segment
  assumption.
- Closing the window at least ~800 ms after an edit keeps that edit; closing sooner shows
  the discard dialog, whose Discard really discards.

## Non-goals

Syncing sessions to Cloud; per-segment undo outside the global history; autosaving a
recording the user merely opened; a write that survives a hard kill mid-`beforeunload`.

## Reopen if

Telemetry shows the discard dialog still firing often (the debounce is too long for real
usage — shorten it, or flush on blur as well), or session writes become expensive enough
that one per gesture is measurable (batch on an idle callback instead).
