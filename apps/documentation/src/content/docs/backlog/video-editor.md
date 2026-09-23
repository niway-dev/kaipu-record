---
title: "Video editor"
description: "Quick, simple video editor for recordings: timeline with cut/trim, time-ranged text/box/arrow annotations, image slides, and mediabunny export to a new vault MP4. Decomposed into six sequential implementation plans."
---

# Video editor

> **Status: 🟢 Merged (#28) — validate in prod** (2026-07-06). The full quick editor
> shipped: cut a recording, annotate it over time, drop in image slides, export a new
> MP4 via mediabunny. Design in
> [specs/2026-07-03-video-editor-design](/specs/2026-07-03-video-editor-design/); the six
> implementation plans below were executed **one PR at a time** with owner review between
> each. Pending owner validation in a packaged build.

## What it is

Open a recording from the library → **Editar video** → a quick editor (not a
professional NLE) that covers the explainer-video jobs:

- **Cut**: split at the playhead, delete segments (timeline ripples closed), trim ends.
- **Annotate over time**: text / box / arrow with the screenshot editor's hand-drawn
  look, each visible only during its time window (pill on an overlay lane).
- **Slides**: insert a static image on the timeline (3 s intro card, etc.).
- **Export**: burn everything into `"<title> (editado)"` in the vault via mediabunny in
  a Web Worker; the edit session is saved as JSON and restored on reopen.

## Key decisions (owner-approved)

- **Sequential slides first**; a parallel overlay-image track (image floating over the
  video) is a follow-up — the overlay data model already has room for an `image` kind.
- **Annotations are time-ranged**, anchored to timeline time, clamped when cuts shorten
  the timeline.
- **Export duplicates** (original untouched, session re-editable). The once-deferred
  "reemplazar" vs "generar duplicado" choice is closed: an export never replaces the
  original — see [ADR 0003](/architecture/decisions/0003-export-never-replaces-the-original/).
- **One editor page, one pure timeline module.** All timeline↔source time math lives in
  a single tested module; the design-principles section of the spec locks in the rest
  (canvas-per-frame export, foregrounded export, no clip reordering).

## Implementation plans

| #   | Plan                                                           | Scope                                                                                       | PR  |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --- |
| 01  | [Foundation](/plans/2026-07-03-video-editor-01-foundation/)    | scene model, pure timeline math (TDD), `/video-editor` route, basic playback, library entry | 🔵  |
| 02  | [Timeline UI](/plans/2026-07-03-video-editor-02-timeline/)     | ruler, mediabunny thumbnails, 60 fps playhead, scrubbing                                    | 🔵  |
| 03  | [Cut & trim](/plans/2026-07-03-video-editor-03-cut-trim/)      | split/delete/trim, gap-skipping preview, undo/redo, unsaved guard                           | 🔵  |
| 04  | [Annotations](/plans/2026-07-03-video-editor-04-annotations/)  | time-ranged text/box/arrow, overlay lane, options panel                                     | 🔵  |
| 05  | [Slides](/plans/2026-07-03-video-editor-05-slides/)            | image items on the main track, slide playback, duration handle                              | 🔵  |
| 06  | [Export & sessions](/plans/2026-07-03-video-editor-06-export/) | worker export pipeline, progress dialog, session persistence                                | 🟢  |

Each plan ends with its own manual-verification checklist and stops for owner review —
flip its PR column (🔵 → 🟡 in progress → 🟢 merged) as work advances.

## Architecture at a glance

- `features/video-editor/` — `scene.ts` (model), `timeline.ts` (the ONLY timeline↔source
  time mapping), `use-video-scene.ts` (undo/redo), `use-preview-playback.ts`
  (entry-walking playback), `components/`, `annotations/`, `export/`.
- Reuses from screenshots: `rough.ts`/`handles.ts`/tool constants (imported, never
  copied), toolbar + floating-options UX, history pattern, `useBlocker` guard,
  `setEditorWindowMode`.
- Export streams to the vault through the **existing recording writer IPC** — an
  exported edit lands exactly like a live recording (sidecar + thumbnail).

## Out of scope (v1)

Replace-original export, overlay image track, background export, timeline zoom,
per-segment audio controls, transitions, export quality picker.

## Gotchas

- **Export hook has no live `<video>` element to draw a thumbnail from.** Its public
  args are plain numbers (`videoWidth`/`videoHeight`/`previewWidth`), not a ref, so
  the poster thumbnail is decoded independently from the already-fetched source
  `Blob` (an off-DOM `<video>`, seek to 0, draw to canvas) rather than reusing the
  preview's own frame — see `export/export-thumbnail.ts`.
- **`useVideoScene`'s initial scene is fixed at first mount** — you can't hand it a
  fresher scene after an async session load resolves. Restoring a saved session on
  open requires gating the whole editor behind a loader component (`VideoEditorLoader`
  in `video-editor-page.tsx`) that resolves the initial scene (and hydrates the slide
  asset store) _before_ the real editor (and its `useVideoScene` call) ever mounts.
- **Session slide assets are always written/read as `.png`** regardless of the
  original upload's mimeType (jpeg/webp slides get bytes saved under `<assetId>.png`)
  — the IPC payload deliberately has no mimeType field. Restoring hardcodes
  `"image/png"` when rebuilding the Blob; this works because browsers sniff real
  image bytes rather than trusting the asserted Blob type, but hasn't been manually
  verified against a real non-PNG slide end to end.
- **`cancel()` on the export hook does double duty**: dismissing the empty-timeline
  error dialog and aborting a genuinely in-flight worker/writer session both go
  through the same function — every step in it (`worker.terminate()`,
  `recordingAbort`) is written to be a no-op when there's nothing to tear down, so
  one function safely covers both call sites.
