---
title: "Video editor 03 — cut & trim: split, delete, trim handles, gap-skipping preview, undo/redo"
description: "Third implementation plan for the video editor: scene history (undo/redo), split at playhead, delete segments with ripple, edge trim handles, preview playback that skips deleted footage, and the unsaved-changes guard."
---

# Video editor 03 — cut & trim

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user can split the recording at the playhead, delete any segment (the
timeline ripples closed), trim segment edges by dragging handles, undo/redo every edit,
and the preview plays the edited result seamlessly — skipping deleted footage.

**Architecture:** `use-video-scene.ts` ports the screenshot editor's proven history
pattern (`past`/`future` snapshots, `commit` for discrete ops, `beginInteract`/
`endInteract` for drags) to `VideoScene`. All edit math already exists as pure functions
(plan 01 Task 3) — this plan wires UI to them. Gap skipping upgrades
`use-preview-playback.ts`: when the video reaches the end of the current layout entry
(or lands in deleted footage after a user seek), it advances to the next entry via an
internal seek — the entry-based controller was designed for exactly this extension.

**Tech Stack:** React, CSS Modules, vitest. No new dependencies.

**Design spec:** `apps/documentation/src/content/docs/specs/2026-07-03-video-editor-design.md`

## Global Constraints

- Same as plan 01: English code/comments, neutral-Spanish copy, no enums, kebab-case,
  `bunx oxfmt --check .` before every commit, vitest for pure logic.
- Prerequisites: plans 01–02 merged. Key interfaces consumed:
  `splitClipAt`, `removeItem`, `trimClip`, `clampOverlays`, `toLayout`,
  `layoutDuration`, `entryAt`, `timelineToSource`, `sourceToTimeline`,
  `MIN_ITEM_DURATION` (timeline.ts); `PreviewPlayback` (use-preview-playback.ts);
  `TimelineStrip` props `selectedItemId`/`onSelectItem` (plan 02).
- Before starting, read `apps/kaipu-record/src/renderer/src/features/screenshots/use-editor-scene.ts`
  (or wherever `useEditorScene` lives — search for `beginInteract`) — Task 1 mirrors it.

---

### Task 1: Scene history hook (undo/redo)

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/use-video-scene.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/video-editor/use-video-scene.test.ts`

**Interfaces:**

- Consumes: `VideoScene`, `TrackItem`, `VideoOverlay` from `./scene`.
- Produces:

  ```ts
  interface VideoSceneController {
    scene: VideoScene;
    dirty: boolean;                      // scene !== the initial scene (by history)
    canUndo: boolean;
    canRedo: boolean;
    undo(): void;
    redo(): void;
    commit(next: VideoScene): void;      // one undoable step; no-op if same reference
    beginInteract(): void;               // snapshot before a continuous drag
    updateLive(next: VideoScene): void;  // mid-drag, no history entry
    endInteract(): void;                 // collapse the drag into one undo step
  }
  function useVideoScene(initial: VideoScene): VideoSceneController;
  ```

- [ ] **Step 1: Write the failing tests**

Test through a tiny harness component or `renderHook` (check how the screenshot editor's
hook is tested and copy that setup — if `@testing-library/react` is available use
`renderHook`, otherwise test the reducer logic by extracting it):

```ts
// use-video-scene.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initialScene } from "./scene";
import { useVideoScene } from "./use-video-scene";

describe("useVideoScene", () => {
  it("commit creates one undo step; undo/redo walk history", () => {
    const { result } = renderHook(() => useVideoScene(initialScene(10)));
    const first = result.current.scene;
    act(() => result.current.commit({ ...first, overlays: [] }));
    // committing an identical reference is a no-op
    act(() => result.current.commit(result.current.scene));
    act(() =>
      result.current.commit({ ...result.current.scene, items: first.items.slice(0, 0) }),
    );
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.scene.items).toHaveLength(1);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.scene.items).toHaveLength(0);
  });

  it("a drag (begin/updateLive/end) collapses into a single undo step", () => {
    const { result } = renderHook(() => useVideoScene(initialScene(10)));
    const base = result.current.scene;
    act(() => result.current.beginInteract());
    act(() => result.current.updateLive({ ...base, overlays: [] }));
    act(() => result.current.updateLive({ ...base, items: [] }));
    act(() => result.current.endInteract());
    expect(result.current.scene.items).toHaveLength(0);
    act(() => result.current.undo());
    expect(result.current.scene).toBe(base);
    expect(result.current.canUndo).toBe(false);
  });

  it("tracks dirty", () => {
    const { result } = renderHook(() => useVideoScene(initialScene(10)));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.commit({ ...result.current.scene, items: [] }));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.undo());
    expect(result.current.dirty).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/features/video-editor/use-video-scene.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Port `useEditorScene`'s mechanics 1:1 onto `VideoScene` (read it first; keep its
structure — `past: VideoScene[]`, `future: VideoScene[]`, an `interactBase` ref for
drags, reference-equality no-op guards). The `dirty` flag is `past.length > 0` after
collapsing (undoing everything returns to clean). Do not innovate here — the value is
consistency with the proven hook.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/features/video-editor/use-video-scene.test.ts`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
bunx oxfmt . && git add -A apps/kaipu-record && git commit -m "feat(video-editor): scene history with undo/redo"
```

---

### Task 2: Gap-skipping preview playback

**Files:**

- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/use-preview-playback.ts`

**Interfaces:**

- Consumes: everything already in the hook; `entryAt`, `timelineToSource`,
  `sourceToTimeline`, `layoutDuration`.
- Produces: same `PreviewPlayback` shape (no signature change) — behavior now honors
  multi-entry layouts: playback jumps across deleted ranges; user seeks into deleted
  source footage snap to the nearest kept time.

- [ ] **Step 1: Replace the two "single-clip case" branches from plan 01**

In `onVideoTimeUpdate`, replace the end-of-entry branch with real advancement:

```ts
const layoutNow = layoutRef.current;
const sourceT = video.currentTime;
const t = sourceToTimeline(layoutNow, sourceT);

const advanceFrom = (timelineEnd: number) => {
  const next = entryAt(layoutNow, timelineEnd + END_EPSILON);
  if (!next || next.timelineEnd <= timelineEnd + END_EPSILON) {
    pause();
    setTimelineTime(layoutDuration(layoutNow));
    return;
  }
  // Slides pause the video (plan 05 renders the image); clips reseek and keep playing.
  if (next.kind === "clip") {
    seekVideoToSource(next.sourceStart);
  }
  setTimelineTime(next.timelineStart);
};

if (t === null) {
  // The <video> drifted into deleted footage (native playback ran past a cut, or a
  // native control seeked). Snap forward to the first kept entry after this source
  // time, or stop at the end.
  const target = layoutNow.find(
    (e) => e.kind === "clip" && e.sourceStart >= sourceT - END_EPSILON,
  );
  if (target) {
    seekVideoToSource(target.sourceStart);
    setTimelineTime(target.timelineStart);
  } else {
    pause();
    setTimelineTime(layoutDuration(layoutNow));
  }
  return;
}

const entry = entryAt(layoutNow, t);
if (entry && sourceT >= entry.sourceEnd - END_EPSILON) {
  advanceFrom(entry.timelineEnd);
  return;
}
setTimelineTime(t);
```

Also fix the rAF loop's time derivation for robustness at cut boundaries: between the
video crossing `sourceEnd` and the `timeupdate` handler reseeking, `sourceToTimeline`
returns `null` for a few frames. The rAF tick must **hold the last valid time** instead
of emitting a garbage value (otherwise the playhead visibly jumps to 100% for a frame):

```ts
const lastValidTimeRef = useRef(0);
// in the rAF tick:
const mapped = sourceToTimeline(layoutRef.current, video.currentTime);
if (mapped !== null) lastValidTimeRef.current = mapped;
emitTime(lastValidTimeRef.current);
```

`timeupdate` fires only ~4×/s, so a cut can overshoot by up to ~250 ms before the
handler reseeks. That is acceptable for a quick editor; if it feels sloppy during
manual review, move the advancement check into the rAF tick (same logic, 60×/s) — but
measure first, do not preemptively optimize.

- [ ] **Step 2: Typecheck + existing tests**

Run: `cd apps/kaipu-record && bunx vitest run && bun run typecheck`
Expected: PASS (playback behavior is verified manually in Task 5 — it needs a real
`<video>` element; do not write jsdom tests for it).

- [ ] **Step 3: Commit**

```bash
bunx oxfmt . && git add -A apps/kaipu-record && git commit -m "feat(video-editor): gap-skipping preview playback"
```

---

### Task 3: Edit actions — split, delete, undo/redo UI

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.tsx`
- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.module.css`
- Modify: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`

**Interfaces:**

- Consumes: `VideoSceneController` (Task 1); `splitClipAt`, `removeItem`,
  `clampOverlays`, `toLayout`, `layoutDuration` (pure); `PreviewPlayback`.
- Produces: `<EditorToolbar>` with props

  ```ts
  {
    canUndo: boolean; canRedo: boolean;
    onUndo(): void; onRedo(): void;
    onSplit(): void;               // disabled when playhead is not inside a clip
    splitDisabled: boolean;
    onDeleteSelected(): void;      // disabled when nothing is selected
    deleteDisabled: boolean;
  }
  ```

  (Plan 04 extends this toolbar with annotation tools; keep the component's left side
  free for a tool group.)

- [ ] **Step 1: Replace plan 01's static scene with the history controller**

In `VideoEditor`:

```tsx
const controller = useVideoScene(useMemo(() => initialScene(source.durationSeconds), [source.durationSeconds]));
const { scene } = controller;
const layout = useMemo(() => toLayout(scene.items), [scene.items]);
```

- [ ] **Step 2: Implement the action handlers in the page**

```tsx
const handleSplit = useCallback(() => {
  const items = splitClipAt(scene.items, playback.timelineTime);
  if (items === scene.items) return; // no-op split (slide, boundary) — no history entry
  controller.commit({ ...scene, items });
}, [scene, controller, playback.timelineTime]);

const handleDeleteSelected = useCallback(() => {
  if (!selectedItemId) return;
  const items = removeItem(scene.items, selectedItemId);
  const duration = layoutDuration(toLayout(items));
  controller.commit({ ...scene, items, overlays: clampOverlays(scene.overlays, duration) });
  setSelectedItemId(null);
  // Deleting the segment under the playhead leaves the playhead past the ripple —
  // clamp it back into the new timeline.
  playback.seek(Math.min(playback.timelineTime, duration));
}, [scene, controller, selectedItemId, playback]);
```

Guard rails:

- `splitDisabled` when `entryAt(layout, playback.timelineTime)?.kind !== "clip"`.
- Deleting the **last remaining item** must be blocked (`deleteDisabled` when
  `scene.items.length <= 1` or nothing selected) — an empty timeline has nothing to
  export and nothing to click.

- [ ] **Step 3: Build the toolbar component**

Icon buttons (lucide): `Undo2`, `Redo2`, separator, `Scissors` (split), `Trash2`
(delete). Follow the screenshot editor's `annotation-toolbar.tsx` structure and CSS
(button sizing, active/disabled states) — open it and mirror. Tooltips (native `title`):
"Deshacer", "Rehacer", "Cortar aquí", "Eliminar segmento".

Keyboard shortcuts in the page-level keydown effect (same guard as Space):

- `⌘/Ctrl+Z` → undo; `⌘/Ctrl+Shift+Z` → redo
- `S` → split at playhead
- `Delete`/`Backspace` → delete selected segment (only when a segment is selected and
  focus is not in an input — plan 04 adds annotation selection which takes precedence)

- [ ] **Step 4: Manual verification**

Run: `cd apps/kaipu-record && bun run dev`

- Split mid-video → two blocks appear; both show correct thumbnail ranges.
- Select the middle segment (after two splits) → delete → timeline ripples closed;
  playback of the whole timeline skips the deleted footage with only a brief hiccup.
- Undo/redo walks every step back and forth; ⌘Z works.
- Deleting down to one segment: delete disabled.
- Playhead never jumps to the end during a cut crossing (watch it closely).

- [ ] **Step 5: Full suite, format, commit**

```bash
cd apps/kaipu-record && bunx vitest run && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): split and delete with undo/redo"
```

---

### Task 4: Trim handles on segment blocks

**Files:**

- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.tsx`
- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.module.css`

**Interfaces:**

- Consumes: `trimClip`, `clampOverlays`, `toLayout`, `layoutDuration`,
  `MIN_ITEM_DURATION`; `VideoSceneController.beginInteract/updateLive/endInteract`.
- Produces: new optional `TimelineStrip` props:

  ```ts
  onTrim?: (itemId: string, edge: "start" | "end", sourceTime: number, phase: "start" | "move" | "end") => void
  ```

  The page maps `phase` to `beginInteract`/`updateLive`+`trimClip`/`endInteract`.

- [ ] **Step 1: Render handles on the selected clip block**

Inside `TrackBlock`, when `selected && entry.kind === "clip"`, render two absolutely
positioned handle divs (`left: -4px` / `right: -4px`, width 8px, full height, `cursor:
ew-resize`, accent background at 60% opacity, rounded). `stopPropagation` on their
pointer events so they neither scrub nor re-select.

- [ ] **Step 2: Implement the drag**

On handle pointerdown: capture the pointer, call `onTrim(id, edge, startSourceTime,
"start")`. On pointermove: convert the pointer's timeline position to a **source** time
for this entry — the handle moves in source space:

```ts
// pointer fraction along the track → timeline time → source time within this entry
const t = fractionToTime((event.clientX - trackRect.left) / trackRect.width, duration);
const sourceTime = entry.sourceStart + (t - entry.timelineStart);
onTrim(entry.itemId, edge, sourceTime, "move");
```

`trimClip` (pure) clamps to `MIN_ITEM_DURATION` and `[0, ...]` — the handle visually
stops at the limits for free. On pointerup: `onTrim(..., "end")`.

In the page:

```tsx
const handleTrim = useCallback(
  (itemId: string, edge: "start" | "end", sourceTime: number, phase: "start" | "move" | "end") => {
    if (phase === "start") controller.beginInteract();
    if (phase === "move") {
      const items = trimClip(controller.scene.items, itemId, edge, sourceTime);
      const duration = layoutDuration(toLayout(items));
      controller.updateLive({
        ...controller.scene,
        items,
        overlays: clampOverlays(controller.scene.overlays, duration),
      });
    }
    if (phase === "end") controller.endInteract();
  },
  [controller],
);
```

Note: while trimming a middle clip, later blocks shift left/right live (ripple) — this
is correct and matches the model; do not try to freeze them.

- [ ] **Step 3: Manual verification**

- Select first block → drag its left handle right → block shrinks, video content
  starts later; whole timeline shortens.
- Trim below minimum → handle stops.
- One continuous drag = one undo step.
- Thumbnails inside the block re-pick to the narrowed range (they will, via
  `thumbnailsForRange`).

- [ ] **Step 4: Full suite, format, commit**

```bash
cd apps/kaipu-record && bunx vitest run && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): trim handles on clip blocks"
```

---

### Task 5: Unsaved-changes guard

**Files:**

- Modify: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`

**Interfaces:**

- Consumes: `controller.dirty`; the screenshot editor's `useBlocker` +
  `DiscardChangesDialog` pattern (read `screenshot-editor-page.tsx` and reuse the exact
  same dialog component if it is exported; otherwise mirror its markup/copy).
- Produces: navigating away with `dirty === true` asks
  **"¿Descartar los cambios del video?"** with actions **"Seguir editando"** /
  **"Descartar"**.

- [ ] **Step 1: Implement with `useBlocker`**

```tsx
const blocker = useBlocker(controller.dirty);
// render the dialog when blocker.state === "blocked";
// "Descartar" → blocker.proceed(); "Seguir editando" → blocker.reset()
```

- [ ] **Step 2: Manual verification**

Make an edit → press back → dialog appears; both actions behave. Undo back to clean →
back navigates silently.

- [ ] **Step 3: Full suite, format, commit**

```bash
cd apps/kaipu-record && bunx vitest run && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): unsaved-changes guard"
```

---

## Done when

- All suites + typecheck green, oxfmt clean.
- Manual: split/delete/trim/undo/redo/guard all behave; playback skips cuts without the
  playhead glitching.
- PR: `feat(video-editor): cut & trim (plan 03)` → **stop for owner review**.
