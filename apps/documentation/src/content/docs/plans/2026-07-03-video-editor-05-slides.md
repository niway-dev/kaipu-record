---
title: "Video editor 05 — image slides on the main track"
description: "Fifth implementation plan for the video editor: insert a static image as a timeline item (e.g. a 3s intro), preview it in the stage, and adjust its duration — held in memory until plan 06 persists it."
---

# Video editor 05 — image slides

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user inserts an image onto the main track (default 3 s, e.g. a title card
before the video starts), sees it play in the preview at the right moment, and adjusts
its duration by dragging the block edge.

**Architecture:** `SlideItem` already exists in the scene model and every pure function
(`toLayout`, `insertItemAt`, `boundaryIndexAt`, `setSlideDuration`, `entryAt`) already
handles it — plan 01 shipped them tested. This plan adds: an in-memory **slide asset
store** (assetId → object URL + ImageBitmap-ready bytes; persistence to the vault is
plan 06), the "Agregar imagen" action (native file picker via the existing dialog IPC if
one exists, else an `<input type=file>`), slide rendering in `PreviewStage` (video
hidden/paused while a slide entry is active — the playback controller walks entries
already), and slide blocks on the timeline with a duration handle.

**Tech Stack:** React, CSS Modules, vitest. No new dependencies.

**Design spec:** `apps/documentation/src/content/docs/specs/2026-07-03-video-editor-design.md`

## Global Constraints

- Same as plan 01: English code/comments, neutral-Spanish copy, no enums, kebab-case,
  `bunx oxfmt --check .` before every commit.
- Prerequisites: plans 01–04 merged. Consumed interfaces: `SlideItem`, `newId`
  (scene.ts); `insertItemAt`, `boundaryIndexAt`, `setSlideDuration`, `toLayout`,
  `entryAt`, `timelineToSource` (timeline.ts); `VideoSceneController`;
  `PreviewPlayback`; `TimelineStrip`; `EditorToolbar`.
- Accepted image types: `image/png`, `image/jpeg`, `image/webp`.

---

### Task 1: Slide asset store

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/slide-assets.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/video-editor/slide-assets.test.ts`

**Interfaces:**

- Consumes: nothing app-specific.
- Produces:

  ```ts
  export interface SlideAsset { assetId: string; bytes: ArrayBuffer; mimeType: string; url: string; naturalWidth: number; naturalHeight: number }
  export interface SlideAssetStore {
    get(assetId: string): SlideAsset | null;
    put(bytes: ArrayBuffer, mimeType: string): Promise<SlideAsset>; // decodes to measure natural size
    entries(): SlideAsset[];       // plan 06 persists these next to the session
    dispose(): void;               // revoke all object URLs
  }
  export function createSlideAssetStore(): SlideAssetStore;
  ```

  A plain module-level factory (not a hook) held in a `useRef` by the page — assets
  must survive scene undo/redo (an undone slide's asset stays available for redo).

- [ ] **Step 1: Write failing tests** for `put`/`get`/`entries`/`dispose` using a tiny
      PNG fixture (`createImageBitmap` exists in the vitest environment? **Check first** —
      if the environment is jsdom without `createImageBitmap`, measure via `Image` +
      object URL, and in tests stub `Image` the way existing screenshot tests do; read
      `compositor.test.ts` in the screenshots feature for the established pattern).

- [ ] **Step 2: Implement** — `put` stores bytes, creates `URL.createObjectURL(new
Blob([bytes], { type: mimeType }))`, measures natural size, returns the asset with
      `assetId = crypto.randomUUID()`.

- [ ] **Step 3: Run tests, format, commit**

```bash
cd apps/kaipu-record && bunx vitest run src/renderer/src/features/video-editor/slide-assets.test.ts \
  && cd ../.. && bunx oxfmt . && git add -A apps/kaipu-record \
  && git commit -m "feat(video-editor): in-memory slide asset store"
```

---

### Task 2: "Agregar imagen" action

**Files:**

- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.tsx`
- Modify: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`

**Interfaces:**

- Consumes: `SlideAssetStore.put`; `insertItemAt`, `boundaryIndexAt`, `toLayout`;
  `VideoSceneController.commit`.
- Produces: toolbar button `ImagePlus` (lucide), tooltip **"Agregar imagen"**, prop
  `onAddImage(): void`.

- [ ] **Step 1: File picking**

Use a hidden `<input type="file" accept="image/png,image/jpeg,image/webp">` triggered
by the button (the pattern used elsewhere in the renderer if it exists — search for
`type="file"` first and follow suit). Read bytes with `file.arrayBuffer()`.

- [ ] **Step 2: Insert at the playhead boundary**

```tsx
const handleAddImage = useCallback(async (file: File) => {
  const asset = await assetStoreRef.current.put(await file.arrayBuffer(), file.type);
  const slide: SlideItem = {
    id: newId(),
    kind: "slide",
    assetId: asset.assetId,
    duration: 3,
    naturalWidth: asset.naturalWidth,
    naturalHeight: asset.naturalHeight,
  };
  const index = boundaryIndexAt(toLayout(scene.items), playback.timelineTime);
  controller.commit({ ...scene, items: insertItemAt(scene.items, index, slide) });
}, [scene, controller, playback.timelineTime]);
```

The slide lands at the nearest item boundary — playhead at 0 inserts before everything
(the intro-card case); mid-clip inserts at the closest cut point. To place a slide
mid-clip the user splits first — that is the simple, predictable rule; do not
auto-split.

- [ ] **Step 3: Commit**

```bash
cd apps/kaipu-record && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): add image slide at playhead boundary"
```

---

### Task 3: Slide playback in the preview

**Files:**

- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/use-preview-playback.ts`
- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/components/preview-stage.tsx`

**Interfaces:**

- Consumes: `entryAt`, `timelineToSource`; the existing entry-advancement from plan 03.
- Produces: `PreviewPlayback` gains
  ```ts
  activeSlideId: string | null;   // slide entry under the playhead, else null
  ```
  `PreviewStage` gains `slideUrl?: string | null` and renders
  `<img className={styles.slide} src={slideUrl}>` over the video (absolute inset-0,
  `object-fit: contain`, black background) when set. The annotation layer stays on top.

**Playback semantics for slides — implement exactly:**

- A slide has no media element; its clock is wall time. When playback enters a slide
  entry: pause+hide the video, record `slideStartedAt = performance.now()` and the
  slide's `timelineStart`, set `activeSlideId`.
- The rAF loop, when a slide is active, computes
  `t = slideTimelineStart + (performance.now() - slideStartedAt) / 1000`; when `t >=
entry.timelineEnd`, advance to the next entry (reuse `advanceFrom` — seek+play the
  video for clips, chain slides, or stop at the end).
- Pausing during a slide freezes the offset (store consumed seconds, resume re-anchors
  `slideStartedAt`).
- Seeking into a slide (`timelineToSource` hit with `entry.kind === "slide"`) sets the
  consumed-offset from `sourceTime` and pauses/hides the video without seeking it.
- `timelineTime` state updates during slides too (a ~4 Hz `setInterval` while a slide
  is active is fine — the video's `timeupdate` will not fire).

- [ ] **Step 1: Implement the slide branch in the hook** (the `advanceFrom` from plan
      03 already special-cases `next.kind === "clip"`; fill in the slide case per the
      semantics above).

- [ ] **Step 2: Wire the stage** — in the page:

```tsx
const activeSlide = playback.activeSlideId
  ? scene.items.find((i) => i.id === playback.activeSlideId)
  : null;
const slideUrl = activeSlide?.kind === "slide"
  ? assetStoreRef.current.get(activeSlide.assetId)?.url ?? null
  : null;
```

- [ ] **Step 3: Manual verification**

- Insert an image at 0 → press play from 0: image holds 3 s, then video starts.
- Scrub across the slide: image shows while inside, video frame outside.
- Pause mid-slide, resume: total hold stays 3 s of playing time.
- Insert between two segments (after a split): plays clip → image → clip.

- [ ] **Step 4: Full suite, format, commit**

```bash
cd apps/kaipu-record && bunx vitest run && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): slide playback in preview"
```

---

### Task 4: Slide blocks on the timeline

**Files:**

- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.tsx`
- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.module.css`
- Modify: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`

**Interfaces:**

- Consumes: `setSlideDuration`; the trim-handle drag mechanics from plan 03 (same
  phases, same page-side begin/live/end wiring).
- Produces: `TimelineStrip` prop
  `slideUrlFor?: (assetId: string) => string | null` so slide blocks show their image;
  `onSlideDuration?: (itemId: string, duration: number, phase: "start" | "move" | "end") => void`.

- [ ] **Step 1: Render slide blocks** — in `TrackBlock`, `entry.kind === "slide"`
      renders the asset image (via `slideUrlFor`) as a single `object-fit: cover` tile with
      a small `ImagePlus` badge, and a distinct background tint so slides read differently
      from footage. Selected slides show ONE right-edge handle (duration), reusing the trim
      handle styles.

- [ ] **Step 2: Duration drag** — right-handle drag maps pointer → timeline time →
      `duration = t - entry.timelineStart`; page routes phases to
      `beginInteract`/`updateLive` + `setSlideDuration`/`endInteract`. Deleting a selected
      slide already works (plan 03's `removeItem` path is item-kind-agnostic) — verify, do
      not re-implement.

- [ ] **Step 3: Manual verification** — resize a slide 3→6 s (later blocks ripple);
      delete a slide; undo both.

- [ ] **Step 4: Full suite, format, commit**

```bash
cd apps/kaipu-record && bunx vitest run && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): slide blocks with duration handle"
```

---

## Done when

- Suites + typecheck green, oxfmt clean.
- Manual: intro-image flow works end to end in preview (image → video, adjustable
  duration, undoable, survives scrubbing).
- Known limitation (by design until plan 06): slides live in memory — leaving the
  editor discards them with the rest of the unsaved scene (the plan-03 guard warns).
- PR: `feat(video-editor): image slides (plan 05)` → **stop for owner review**.
