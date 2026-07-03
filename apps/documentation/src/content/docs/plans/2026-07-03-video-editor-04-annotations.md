---
title: "Video editor 04 — time-ranged annotations: text, box, arrow + overlay lane"
description: "Fourth implementation plan for the video editor: drawing text/box/arrow over the video with the screenshot editor's tools and hand-drawn look, visibility windows on the timeline, and an overlay lane to drag/resize those windows."
---

# Video editor 04 — time-ranged annotations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user draws text, boxes, and arrows over the video — same hand-drawn look
and interaction feel as the screenshot editor — and each annotation is visible only
during its time window, shown and adjustable as a pill on a new overlay lane in the
timeline.

**Architecture:** The overlay geometry model (normalized 0–1 of the video frame) is
already in `scene.ts` (plan 01). This plan builds a `VideoAnnotationLayer` that adapts
the screenshot editor's `annotation-layer.tsx` interaction machine (pointer state
machine, hit-testing, handles, inline text input) to `VideoOverlay` — **importing** the
pure helpers (`rough.ts`, `smooth.ts` not needed, `handles.ts`, tool constants) rather
than copying them. New overlays default to a window of `[playhead, playhead + 3s]`
(clamped). The timeline gains an overlay lane; pills move/resize in time via the same
begin/live/end history pattern as trim.

**Tech Stack:** React, SVG, CSS Modules, vitest. No new dependencies.

**Design spec:** `apps/documentation/src/content/docs/specs/2026-07-03-video-editor-design.md`

## Global Constraints

- Same as plan 01: English code/comments, neutral-Spanish copy, no enums, kebab-case,
  `bunx oxfmt --check .` before every commit.
- Prerequisites: plans 01–03 merged. Consumed interfaces:
  `VideoOverlay`/`BoxOverlay`/`ArrowOverlay`/`TextOverlay`, `newId` (scene.ts);
  `clampOverlays`, `layoutDuration` (timeline.ts); `VideoSceneController` (plan 03);
  `PreviewPlayback.timelineTime`/`subscribeTime` (plan 01); `EditorToolbar` (plan 03).
- Screenshot-editor modules to REUSE (import paths under
  `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/` — verify exact
  paths and exported names by reading the files first):
  - `tools.ts`: `ANNOTATION_COLORS`, `STROKE_WIDTHS`, `TEXT_SIZES`, `TEXT_PX`, `HAND_FONT`
  - `rough.ts`: `roughRect`, `roughArrow` (seeded hand-drawn SVG paths)
  - `handles.ts`: resize-handle geometry/hit-testing
    If any of these are not exported from the feature's barrel (`annotations/index.ts`),
    export them there — do NOT copy the functions into video-editor.

---

### Task 1: Video annotation tool state + toolbar extension

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-tools.ts`
- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.tsx`

**Interfaces:**

- Consumes: screenshot `tools.ts` constants.
- Produces:

  ```ts
  export const VIDEO_TOOLS = ["select", "box", "arrow", "text"] as const;
  export type VideoTool = (typeof VIDEO_TOOLS)[number];
  export const DEFAULT_OVERLAY_SECONDS = 3;
  interface VideoToolState { tool: VideoTool; color: string; stroke: number; textSize: number }
  function useVideoTools(): VideoToolState & { setTool; setColor; setStroke; setTextSize }
  ```

  (Mirror `use-annotation-tools.ts` from screenshots — same defaults, same state shape,
  minus the tools that do not exist here.)

- [ ] **Step 1: Write `video-tools.ts`** (constants + hook as above; import color/stroke
      constants from the screenshot feature, do not redefine values).

- [ ] **Step 2: Extend the toolbar** — add a left-hand tool group to `EditorToolbar`:
      `MousePointer2` (Seleccionar), `Square` (Cuadro), `ArrowUpRight` (Flecha), `Type`
      (Texto), visually separated from the undo/split/delete action group. New props:
      `tool: VideoTool; onToolChange(tool: VideoTool): void`. Active tool gets the same
      highlighted style as the screenshot toolbar.

- [ ] **Step 3: Typecheck, format, commit**

```bash
cd apps/kaipu-record && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): annotation tool state and toolbar group"
```

---

### Task 2: Annotation layer over the video

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx`
- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.module.css`
- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/overlay-shapes.tsx`
- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/components/preview-stage.tsx`
- Modify: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`

**Interfaces:**

- Consumes: `roughRect`, `roughArrow`, `handles.ts`, `HAND_FONT`, `TEXT_PX` (screenshots);
  `VideoOverlay`, `newId`; `VideoSceneController`; `VideoToolState`.
- Produces:
  ```tsx
  <VideoAnnotationLayer
    overlays={VideoOverlay[]}
    visibleIds={Set<string>}            // computed from playhead time by the page
    selectedId={string | null}
    onSelect={(id: string | null) => void}
    tool={VideoTool}
    toolState={{ color: string; stroke: number; textSize: number }}
    playheadTime={number}               // for new overlays' default window
    timelineDuration={number}
    onDraft={(overlay: VideoOverlay) => void}     // live while drawing/moving (updateLive)
    onCommit={(overlays: VideoOverlay[]) => void} // full next overlays array (commit)
    onInteractStart={() => void}
    onInteractEnd={() => void}
  />
  ```
  Rendered inside `PreviewStage`'s relative wrapper as an absolutely positioned SVG
  covering the video box exactly.

**Implementation guidance (read `annotation-layer.tsx` from screenshots first — this
component is its sibling):**

- [ ] **Step 1: Shape rendering (`overlay-shapes.tsx`)**

One component per overlay kind, sized against the layer's current pixel box
(`width`/`height` from a `ResizeObserver` on the wrapper, like the screenshot layer):

```tsx
// box: two overlaid jittered strokes — same call the screenshot Shape uses
<path d={roughRect(x * w, y * h, bw * w, bh * h, seed)} stroke={color} strokeWidth={stroke} fill="none" />
// arrow: roughArrow(x1*w, y1*h, x2*w, y2*h, seed, /*scale*/ 1)
// text: <text x={x*w} y={y*h} fontFamily={HAND_FONT} fontSize={size} fill={color}>
```

Overlays NOT in `visibleIds` are not rendered at all — except the selected one, which
renders at 35% opacity so the user can still adjust an annotation while the playhead is
outside its window (otherwise selecting a pill on the lane would show nothing).

- [ ] **Step 2: Interaction state machine**

Port the screenshot layer's `Drag` union reduced to this feature's needs:
`draw-box | draw-arrow | move | resize`. Behaviors to replicate exactly:

- Draw: pointerdown starts a `draft` overlay (id `"draft"`), pointermove updates it via
  `onDraft`, pointerup ≥ minimum size commits with a real `newId()` and **auto-switches
  back to select with the new overlay selected**.
- New overlays get `start = clamp(playheadTime, 0, duration - 0.1)`,
  `end = min(start + DEFAULT_OVERLAY_SECONDS, duration)`.
- Select tool: handle hit-test first (8 handles for box via `handles.ts`, 2 endpoints
  for arrow, 1 corner for text size snapping to `TEXT_PX`), then shape hit-test, then
  deselect.
- Text: inline `<input>` at the click point (window.prompt does not work in Electron);
  Enter commits, Escape cancels, blur commits only after an armed rAF — copy the
  screenshot layer's exact arming trick.
- Delete/Backspace deletes the selected overlay (page-level handler: annotation
  selection takes precedence over segment deletion when both exist — check
  `selectedOverlayId` first).

- [ ] **Step 3: Visibility from the playhead**

In the page:

```tsx
const visibleIds = useMemo(() => {
  const t = playback.timelineTime;
  return new Set(scene.overlays.filter((o) => t >= o.start && t <= o.end).map((o) => o.id));
}, [scene.overlays, playback.timelineTime]);
```

`timelineTime` updates ~4 Hz; visibility flips near window edges may lag up to 250 ms
during playback. Acceptable; if it bothers during review, subscribe the layer to
`playback.subscribeTime` and toggle CSS visibility per overlay id via refs (do not
re-render the SVG at 60 fps).

- [ ] **Step 4: Wire scene mutations**

Page handlers passed to the layer:

```tsx
onInteractStart={controller.beginInteract}
onDraft={(draft) => controller.updateLive({ ...scene, overlays: upsertDraft(scene.overlays, draft) })}
onCommit={(overlays) => controller.commit({ ...scene, overlays })}
onInteractEnd={controller.endInteract}
```

(`upsertDraft` = replace-or-append by id — 3 lines, co-locate in the page or layer.)

- [ ] **Step 5: Manual verification**

- Draw a box mid-video → visible; scrub 4s later → it disappears; scrub back → appears.
- Draw an arrow, drag its endpoints; text tool opens inline input; ⌘Z undoes each step.
- Pause video, draw while paused: geometry lands where drawn (the SVG must exactly
  cover the letterboxed video box — check with a portrait-ish window).

- [ ] **Step 6: Full suite, format, commit**

```bash
cd apps/kaipu-record && bunx vitest run && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): annotation layer with time-ranged visibility"
```

---

### Task 3: Overlay lane on the timeline

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/overlay-lane.tsx`
- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/overlay-lane.module.css`
- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.tsx`

**Interfaces:**

- Consumes: `VideoOverlay`, `timeToFraction`/`fractionToTime` (plan 02),
  `clampOverlays`; the same begin/live/end callbacks as trim.
- Produces:

  ```tsx
  <OverlayLane
    overlays={VideoOverlay[]}
    duration={number}
    selectedOverlayId={string | null}
    onSelectOverlay={(id: string | null) => void}
    onWindowChange={(id: string, start: number, end: number, phase: "start" | "move" | "end") => void}
  />
  ```

  rendered by `TimelineStrip` as a 20px lane above the main track (strip becomes
  ruler / overlay lane / track, in that order).

- [ ] **Step 1: Render pills**

Each overlay renders as an absolutely positioned pill (`left`/`width` from
`timeToFraction`), colored with the overlay's `color` at 70% opacity, with a small
kind icon (Square/ArrowUpRight/Type at 10px) and 6px drag handles at both ends.
Selected pill gets a border. Clicking a pill selects the overlay (same selection state
as the annotation layer — one shared `selectedOverlayId` in the page).

- [ ] **Step 2: Drag interactions**

Pointer-capture drags, mirroring the trim-handle mechanics:

- Body drag → move the window (preserve length; clamp into `[0, duration]`).
- End handles → resize (`end - start >= 0.2s` minimum).
- Phases map to `beginInteract`/`updateLive`/`endInteract` in the page:

```tsx
const handleWindowChange = useCallback(
  (id: string, start: number, end: number, phase: "start" | "move" | "end") => {
    if (phase === "start") controller.beginInteract();
    if (phase === "move") {
      controller.updateLive({
        ...controller.scene,
        overlays: controller.scene.overlays.map((o) => (o.id === id ? { ...o, start, end } : o)),
      });
    }
    if (phase === "end") controller.endInteract();
  },
  [controller],
);
```

- [ ] **Step 3: Manual verification**

- Every drawn annotation appears as a pill at its window; dragging the pill shifts when
  the annotation is visible in preview; resizing changes its duration.
- Selecting a pill highlights the (dimmed) shape on the stage and vice versa.
- Cuts that shorten the timeline clamp/drop pills predictably (via `clampOverlays`,
  already wired in plan 03's delete/trim handlers).

- [ ] **Step 4: Full suite, format, commit**

```bash
cd apps/kaipu-record && bunx vitest run && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): overlay lane with window drag/resize"
```

---

### Task 4: Contextual options panel

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/overlay-options.tsx`
- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/overlay-options.module.css`
- Modify: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`

**Interfaces:**

- Consumes: `ANNOTATION_COLORS`, `STROKE_WIDTHS`, `TEXT_SIZES`/`TEXT_PX` (screenshots);
  the shared selection + tool state.
- Produces: a floating panel over the stage (screenshot `annotation-options.tsx` is the
  template — read it), shown when a drawing tool is active OR an overlay is selected:
  color swatches; stroke width (box/arrow); text size (text); **Eliminar** button for
  the selected overlay. Same dual behavior as screenshots: with a selection it edits
  that overlay (one `commit` per change) AND updates the tool default; without, it sets
  next-draw defaults.

- [ ] **Step 1: Build the panel** (mirror the screenshot component's structure/CSS).

- [ ] **Step 2: Manual verification** — change color of a selected arrow (undoable);
      set defaults with nothing selected and draw (new shape uses them); Eliminar removes.

- [ ] **Step 3: Full suite, format, commit**

```bash
cd apps/kaipu-record && bunx vitest run && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): contextual overlay options panel"
```

---

## Done when

- Suites + typecheck green, oxfmt clean.
- Manual: draw/select/move/resize/delete all three kinds; windows adjustable on the
  lane; visibility follows the playhead; everything undoable.
- PR: `feat(video-editor): time-ranged annotations (plan 04)` → **stop for owner review**.
