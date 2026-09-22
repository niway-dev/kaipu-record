---
title: "Video editor v2 — zoom, blur and cover"
description: "Next iteration of the video editor: automatic cursor-following zoom (clean capture + cursor event track + offline detection), blur/cover privacy regions, a four-track timeline, and a context-sensitive properties panel. Non-destructive; burned in only at export."
---

# Video editor v2 — zoom, blur and cover

> **Status: 🔵 Proposed** (2026-09-21). Two design docs captured, nothing implemented.
> Evolves the shipped [video editor](./video-editor) (timeline, cuts, annotations,
> slides) — the new tools sit next to the existing annotation tools in the toolbar.
>
> - [Pipeline spec](/specs/2026-09-21-zoom-cursor-follow-design/) — capture, clock,
>   detector, camera model, mediabunny render.
> - [UI spec](/specs/2026-09-21-video-editor-zoom-blur-cover-design/) — screen anatomy,
>   five states with screenshots, properties panel, data model, behavior rules.
> - Interactive mockup of the zoom editor: [/mockups/zoom-editor.html](/mockups/zoom-editor.html).
> - **Implementation plan:** [audit + deep-dive documents 00–12](/plans/video-editor-v2/00-audit/)
>   (ten PRs, verified code and diffs). The earlier
>   [overview](/plans/2026-09-21-video-editor-v2-00-overview/) is superseded by the audit.

Not to be confused with [editor zoom](./editor-zoom), which is the screenshot editor's
view-zoom (navigation only, closed).

## What it is

Screen Studio–style automatic zoom plus privacy redaction, edited on the timeline:

- **Record clean** — no live zoom burned into the frame; the original is never modified.
- **Cursor event track** — position polled from main via `screen.getCursorScreenPoint()`
  (~125 Hz), clicks via `uiohook-napi`, on a `performance.now()` clock anchored to the
  first video frame, stored normalized 0–1 to the captured display.
- **Offline detection** — click + dwell are the triggers (not movement); deadzone,
  damping, hysteresis, ~1 s minimum duration, ~200 ms anticipation before each click.
- **Segment editor** — segments, not keyframes. Four tracks (filmstrip, activity,
  zooms, privacy), one global sensitivity slider that regenerates auto segments,
  draggable camera box with non-destructive live preview, hold-to-compare, two modes per
  segment (**follow cursor** / **lock here**).
- **Blur and cover** — time-ranged privacy regions in original-video coordinates,
  applied **before** the zoom crop so they stay pinned to the content. Blur has a
  deliberate minimum intensity of 40; cover is a solid fill with an optional label.
- **Export** — per-frame `drawImage` crop + crisp composited cursor with mediabunny;
  audio packets remuxed untouched. The only moment anything is burned into pixels.

## Key decisions

- **Live zoom rejected.** No lookahead, competes with the encoder, blurry scaled cursor,
  irreversible.
- **Never detect the cursor from pixels.** Shape changes, camouflage, no click signal.
- **Composition order is fixed:** `original → blur/cover → camera crop → cursor`.
- **Sensitivity only regenerates `origin: 'auto'` segments;** manual edits are kept.
- **Out of v1:** manual keyframes, editable easing curves, hand-drawn zoom regions,
  motion tracking for regions when content scrolls, light theme.

## Open items

- [ ] Verify `cursor: 'never'` on Windows and macOS through Electron's capture path
      (plan B: draw a larger custom cursor over the original)
- [ ] macOS permission flow: Screen Recording + Accessibility (two onboarding dialogs)
- [ ] Decide where the render lives — the existing editor export worker
      (`features/video-editor/export/export-worker.ts`) is the likely host
- [ ] Calibrate detector thresholds (minimum dwell, radius, click clustering)
- [ ] Multi-monitor handling when the cursor leaves the captured display
- [ ] Reconcile the spec's `project/` layout with the existing vault + edit-session JSON
- [ ] Export dialog: format, output resolution, destination
- [ ] Do Library thumbnails and Cloud upload respect privacy regions? The original on
      disk still contains the secret
- [ ] Empty state when no zoom is detected

## Implementation plan

Master plan (six PRs, decisions pending owner review):
[plans/2026-09-21-video-editor-v2-00-overview](/plans/2026-09-21-video-editor-v2-00-overview/).

| #   | PR                                | Status |
| --- | --------------------------------- | ------ |
| 01  | Cursor track capture (+ 2 spikes) | 🔵     |
| 02  | Detection + camera model (pure)   | 🔵     |
| 03  | Scene v2, zoom tracks, inspector  | 🔵     |
| 04  | Blur & cover                      | 🔵     |
| 05  | Export pass                       | 🔵     |
| 06  | Polish + gaps                     | 🔵     |
