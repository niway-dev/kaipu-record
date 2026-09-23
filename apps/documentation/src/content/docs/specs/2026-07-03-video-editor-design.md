---
title: "Video editor — design"
description: "Quick, simple video editor for recordings: timeline with cut/trim, time-ranged annotations (text/box/arrow), image slides, and a mediabunny worker export."
---

# Video editor — design

> **Status: 🔵 Approved design** (2026-07-03). Implementation decomposed into six plans
> under `plans/2026-07-03-video-editor-0*.md`, executed one PR at a time. Owner decisions
> baked in: sequential slides first (overlay image track later), time-ranged annotations,
> export writes a new file + re-editable session JSON (the replace-vs-duplicate choice was
> closed on 2026-09-22 by [ADR 0003](/architecture/decisions/0003-export-never-replaces-the-original/):
> never replace).

## Goal

A **quick, simple** video editor for recordings in the library — the video sibling of the
screenshot editor. Not a professional NLE. Core jobs:

1. **Cut**: split a recording, delete the middle, trim the ends.
2. **Annotate over time**: text, box, arrow that appear during a chosen time range.
3. **Slides**: insert a static image on the timeline (e.g. a 3s intro before the video).
4. **Export**: burn everything into a new MP4 with mediabunny, saved to the vault.

## Non-goals (explicitly out of scope for v1)

- Multi-video composition, transitions, audio editing (volume/mute per segment), speed
  changes, timeline zoom, clip reordering, blur/redaction on video, background export
  (navigate away while encoding), replace-original export mode.
- A parallel **overlay image track** (image floating over the video mid-playback) is a
  wanted follow-up — the data model must not preclude it (see Data model).

## Design principles

Timeline editors accumulate bugs in a handful of well-known places (time-mapping drift,
preview/export mismatch, deferred-save state machines). These principles keep this one
simple and correct:

- **One editor page, one pure timeline module.** All timeline-time ↔ source-time math
  lives in a single tested module; every consumer (preview, timeline UI, export)
  imports it. No second editing surface, no private copies of the mapping logic.
- **Segment-list model with implicit deletion** — the track is the list of kept items;
  anything uncovered is deleted footage. A pure `toLayout()` derives the contiguous
  timeline. Trim is not separate state: it just edits the first/last clip's source
  range. One representation.
- **Per-overlay visibility windows** (`start`/`end` in timeline seconds) — the simplest
  mental model for "this annotation shows during this part".
- **Preview gap-skipping by reseeking one `<video>`** across cut boundaries, with an
  "internal seek" flag so programmatic seeks are distinguishable from user seeks, and a
  hold-last-valid-time rule so the playhead never glitches while crossing a cut.
- **Export composites on canvas per frame** (mediabunny) — the exact vector shapes the
  preview shows are burned in; no filter-graph string building, no quality degradation
  fallbacks.
- **Export is explicit and foregrounded** — a progress dialog with cancel; when it says
  done, the file is in the vault. No deferred background-save state to reconcile later.
- **No clip drag-reordering** — the timeline keeps one time axis; reordering breaks that
  mental model for little value in a quick editor.
- Real thumbnails decoded from the source (never placeholders); `crypto.randomUUID()`
  for ids.

## User flow

1. Library detail of a recording → **"Editar video"** button → `/video-editor` route
   (main window grows via the existing `setEditorWindowMode(true)`, same as screenshots).
2. Editor page: video preview on top, tool/action bar, timeline at the bottom
   (ruler + main track with thumbnail blocks + overlay lane).
3. User scrubs/plays (Space toggles), splits at the playhead, deletes segments, trims
   edges, draws time-ranged annotations, inserts image slides.
4. **Exportar** → progress modal (cancelable) → new `"<title> (editado)"` recording in
   the vault + edit-session JSON sidecar → navigate to `/library/:newId`.
5. Re-opening the editor on the _original_ recording restores the saved session.

## Data model

Lives in `apps/kaipu-record/src/renderer/src/features/video-editor/scene.ts`. All overlay
geometry is normalized 0–1 **of the video frame** (same convention as screenshot
annotations). All times are seconds. No TS enums — `as const` unions.

```ts
export interface ClipItem {
  id: string;
  kind: "clip";
  sourceStart: number; // seconds into the source recording
  sourceEnd: number;   // > sourceStart
}

export interface SlideItem {
  id: string;
  kind: "slide";
  assetId: string;     // image stored as an edit-session asset in the vault
  duration: number;    // seconds the image is held
  naturalWidth: number;
  naturalHeight: number;
}

export type TrackItem = ClipItem | SlideItem;

interface OverlayBase { id: string; start: number; end: number; color: string }
export interface BoxOverlay extends OverlayBase { kind: "box"; x: number; y: number; w: number; h: number; stroke: number; seed: number }
export interface ArrowOverlay extends OverlayBase { kind: "arrow"; x1: number; y1: number; x2: number; y2: number; stroke: number; seed: number }
export interface TextOverlay extends OverlayBase { kind: "text"; x: number; y: number; text: string; size: number }
export type VideoOverlay = BoxOverlay | ArrowOverlay | TextOverlay;

export interface VideoScene {
  items: TrackItem[];      // the main track, in playback order
  overlays: VideoOverlay[]; // time-ranged, anchored to TIMELINE time
}
```

Design properties:

- **Main track** is an ordered `TrackItem[]`; anything not covered by a clip is deleted
  footage. A fresh session is one clip `[0, duration]`.
- **Overlays** are timeline-anchored (not source-anchored): they belong to the edited
  result the user sees. After edits shorten the timeline they are clamped
  (`clampOverlays`). This is the simple, predictable rule for a quick editor.
- **Future overlay image track** = a fourth `VideoOverlay` kind (`image` with an
  `assetId` + rect). Nothing else changes — that is why overlays and slides are separate
  concepts even though both hold images.

## Timeline math

`features/video-editor/timeline.ts` — pure, fully unit-tested, the only place that maps
between timeline time and source time:

- `toLayout(items) → LayoutEntry[]` (contiguous `[timelineStart, timelineEnd)` per item,
  remembering `sourceStart/sourceEnd`), `layoutDuration`, `entryAt`,
  `timelineToSource`, `sourceToTimeline`.
- Edit operations, all pure `TrackItem[] → TrackItem[]`: `splitClipAt`, `removeItem`,
  `trimClip`, `insertItemAt`, `boundaryIndexAt`, `setSlideDuration`, plus
  `clampOverlays(overlays, duration)`.
- `MIN_ITEM_DURATION = 0.1` s guards degenerate items.

## Architecture

```
pages/video-editor/video-editor-page.tsx     route shell (state from location, remount by location.key)
features/video-editor/
  scene.ts            types + initialScene + newId
  timeline.ts         pure math (above)
  use-video-scene.ts  undo/redo history over VideoScene (pattern: screenshots' use-editor-scene)
  use-preview-playback.ts  playback controller (entry-walking, gap skipping, slides)
  components/
    preview-stage.tsx      <video> + <img> slide + annotation SVG layer, sized 'contain'
    editor-toolbar.tsx     tools (select/box/arrow/text) + actions (split/delete/add image/export)
    overlay-options.tsx    floating contextual panel (color/stroke/text size/time range/delete)
    timeline-strip.tsx     ruler + playhead + main track blocks + overlay lane
    export-dialog.tsx      progress + cancel
  annotations/             video-overlay layer (adapts screenshot annotation-layer patterns;
                           reuses rough.ts / smooth.ts / handles.ts from features/screenshots)
  export/
    export-plan.ts         pure: VideoScene → ExportPlan (segments, overlay windows, output size)
    overlay-raster.ts      renderer-side: overlay → SVG string → ImageBitmap at native px
    export-worker.ts       Web Worker: mediabunny decode → canvas composite → encode
    use-video-export.ts    orchestration hook (worker lifecycle, IPC writer, progress)
  session.ts               edit-session JSON (version, scene) validate/serialize
```

**Reused from the screenshot editor** (imported, not copied): `rough.ts`, `smooth.ts`,
`handles.ts`, colors/stroke/text-size constants, the toolbar + floating-options UX
pattern, `use-editor-scene`'s history pattern, `useBlocker` + `DiscardChangesDialog`,
`key={location.key}` remount, `setEditorWindowMode`.

## Preview playback

One hidden-source `<video src="kaipu-media://recording/<id>">` + an `<img>` for slides.
`use-preview-playback.ts` walks the layout:

- A rAF loop derives the current timeline time; the playhead DOM node is positioned via
  direct style mutation (documented perf pattern — avoids re-rendering the timeline at
  60 fps).
- Clip entries: video plays natively; when `video.currentTime` reaches
  `entry.sourceEnd − ε`, seek to the next entry (`internalSeekRef` marks programmatic
  seeks). Slide entries: video paused + hidden, a wall-clock timer advances through
  `duration`, then the next clip is seeked and played.
- Seeking the timeline maps through `timelineToSource`.

## Export pipeline

All decoding/encoding in a **Web Worker** (OffscreenCanvas + WebCodecs; mediabunny is
worker-safe). The renderer pre-bakes anything that needs the DOM:

1. Renderer: `fetch(kaipu-media://…)` → `Blob`; rasterize each overlay to an
   `ImageBitmap` at native video resolution (SVG → `Image` → canvas — SVG decode is not
   available in workers); decode slide images to `ImageBitmap`s. Transfer everything to
   the worker with the `ExportPlan`.
2. Worker: mediabunny `Input(BlobSource)`; per clip segment `CanvasSink.canvases(start,
end)` → draw frame → draw visible overlay bitmaps → `CanvasSource.add(outTs)`, with
   output timestamps rebased to the collapsed timeline. Slides render at a fixed fps.
   Audio: per-clip `AudioBufferSink` buffers appended to an `AudioBufferSource`;
   silent buffers fill slide ranges; recordings without audio export video-only.
3. Output: `Mp4OutputFormat({ fastStart: false })` + `StreamTarget`; chunks are
   `postMessage`d to the renderer and forwarded over the **existing recording writer
   IPC** (`recording:create/write/finalize`) so the export lands in the vault exactly
   like a live recording (sidecar + thumbnail included).
4. Progress = processed output time / total duration → modal with cancel
   (worker terminate + `recording:abort`).

## Persistence

- Export always writes a **new** vault item titled `"<title> (editado)"`.
- The edit session (`{ version: 1, scene }`) is saved to `.kaipu/<id>.edit.json` and
  slide images to `.kaipu/<id>.assets/<assetId>.png` via new `videoEdit:*` IPC channels;
  re-opening the editor restores it. Missing/invalid session → fresh scene (never crash).

## Error handling

- Route entered without state → redirect to `/library`.
- Session JSON invalid or assets missing → start fresh, toast a warning.
- Export failure/cancel → abort the vault temp file, keep the editor state intact, show
  a retry-able error in the dialog. The original recording is never touched.

## Testing

Pure modules (`timeline.ts`, `export-plan.ts`, `session.ts`, overlay clamp) get
co-located vitest suites — they encode every cut/trim/mapping edge case. Playback and
UI interactions get targeted component tests where the screenshot editor has precedent;
end-to-end behavior is validated manually in the running app (owner reviews every
feature before merge).

## Phasing

| Plan                 | Delivers                                              | PR gate                              |
| -------------------- | ----------------------------------------------------- | ------------------------------------ |
| 01 foundation        | scene + timeline math + editor route + basic playback | open recording, play/pause/seek      |
| 02 timeline          | ruler, thumbnails, playhead, scrubbing                | scrub accurately                     |
| 03 cut & trim        | split/delete/trim + gap-skipping preview + undo/redo  | cut the middle out, preview skips it |
| 04 annotations       | time-ranged text/box/arrow + overlay lane             | arrow visible 0:12–0:16              |
| 05 slides            | insert image on main track + preview                  | 3s intro image                       |
| 06 export & sessions | worker export + session save/restore                  | edited MP4 in library                |
