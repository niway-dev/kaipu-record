---
title: "Video editor"
description: "Quick, simple video editor for recordings: timeline with cut/trim, time-ranged text/box/arrow annotations, image slides, and mediabunny export to a new vault MP4. Decomposed into six sequential implementation plans."
---

# Video editor

> **Status: 🔵 Proposed — design approved, plans ready** (2026-07-03). The video sibling
> of the screenshot editor: cut a recording, annotate it over time, drop in image
> slides, export a new MP4. Design in
> [specs/2026-07-03-video-editor-design](/specs/2026-07-03-video-editor-design/); six
> implementation plans below, executed **one PR at a time** with owner review between
> each.

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
- **Export duplicates** (original untouched, session re-editable). Final behavior will
  offer "reemplazar" vs "generar duplicado" — deferred.
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
| 06  | [Export & sessions](/plans/2026-07-03-video-editor-06-export/) | worker export pipeline, progress dialog, session persistence                                | 🔵  |

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

(Fill in during implementation — playback boundary behavior, mediabunny API surprises,
worker transfer costs.)
