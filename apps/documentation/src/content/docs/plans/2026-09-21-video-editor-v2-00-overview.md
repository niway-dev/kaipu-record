---
title: "Video editor v2 — 00 overview: zoom, blur and cover"
description: "Master implementation plan for the video editor v2: cursor event track at record time, offline zoom detection, camera model, four-track timeline with inspector, blur/cover redactions, and the zoom-aware export pass. Six sequential PRs on top of the shipped editor."
---

# Video editor v2 — 00 overview

> **Status: ⚠️ Superseded** (2026-09-21) by the
> [audit of this plan](/plans/video-editor-v2/00-audit/) and its deep-dive documents
> `01`–`12`, which correct fifteen weak points found against the code and replace the PR
> decomposition below (ten PRs instead of six). Kept for history; do not implement from it.
>
> Specs: [pipeline](/specs/2026-09-21-zoom-cursor-follow-design/) ·
> [UI](/specs/2026-09-21-video-editor-zoom-blur-cover-design/) ·
> backlog: [video-editor-zoom-blur-cover](/backlog/video-editor-zoom-blur-cover/).

**Goal:** a recording opened in the editor arrives with zoom segments already proposed
from the user's clicks and pauses; the user tunes them (level, smoothness, follow/lock,
sensitivity), adds blur/cover regions over anything private, previews it all live
without encoding, and exports a new MP4 where zoom, cursor and redactions are burned in.
The original file is never modified.

**Approach:** extend, don't rewrite. The shipped editor already has the pieces this
plan leans on: a pure timeline module (`timeline.ts`), scene + history
(`use-video-scene.ts`), session persistence with vault sidecars (`session.ts`,
`saveVideoEditSession`), a pure `ExportPlan`, and a mediabunny Worker export
(`export-worker.ts`). v2 adds data to the scene, tracks to the timeline, and a
zoom/redaction stage to the export loop.

## What exists today (anchor points)

| Concern             | Where                                                                                 | Relevant fact                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Screen capture      | `renderer/features/recording/recorder-engine.ts`                                      | Runs in the **renderer** via `getUserMedia` + `chromeMediaSource: "desktop"`; encodes with mediabunny live.   |
| Recording lifecycle | `main/recording/recording-hub.ts`                                                     | `recordingStart(info.sourceId)` / `recordingStop` IPC; `displayIdForSource()` already resolves the display.   |
| Scene model         | `renderer/features/video-editor/scene.ts`                                             | `items` (clips/slides) + `overlays`; overlay geometry normalized 0–1; times in **timeline** seconds.          |
| Timeline math       | `renderer/features/video-editor/timeline.ts`                                          | `toLayout`, `timelineToSource`, `sourceToTimeline`, `clampOverlays`, `MIN_ITEM_DURATION`.                     |
| Edit history        | `renderer/features/video-editor/use-video-scene.ts`                                   | `commit` / `beginInteract` / `endInteract` undo-redo pattern.                                                 |
| Timeline UI         | `components/timeline-strip.tsx`, `timeline-geometry.ts`, `overlay-lane.tsx`           | Ruler, thumbnails, playhead, one overlay lane with drag handles.                                              |
| Session persistence | `session.ts` (`version: 1`), `electron-api.saveVideoEditSession/loadVideoEditSession` | JSON + asset sidecars in the vault `.kaipu/` dir.                                                             |
| Export              | `export/export-plan.ts`, `export/export-worker.ts`, `export/export-messages.ts`       | Worker decodes with `CanvasSink` at output size (`fit: "contain"`), stamps overlay bitmaps, re-encodes audio. |
| Permissions         | `main/permissions.ts`                                                                 | Screen/mic/camera only; deep-links System Settings. No Accessibility yet.                                     |

## PR decomposition

Six PRs, merged in order, each independently shippable behind nothing (v2 features are
additive; a recording without a cursor track simply opens with no auto zooms).

| #   | PR                                 | Delivers                                                                                                                 | Depends on |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 01  | Cursor track capture               | Main-process cursor poller + click hook, clock anchoring, `cursor.json` sidecar saved with the recording, permissions.   | —          |
| 02  | Detection + camera model (pure)    | `detectZoomSegments(track, sensitivity)`, `cameraAt(t)` with deadzone/damping/hysteresis/anticipation. TDD, no UI.       | 01 (types) |
| 03  | Scene v2 + zoom tracks + inspector | `zoomSegments` in scene/session, Activity + Zooms tracks, camera box on preview, zoom inspector, Detection panel.        | 02         |
| 04  | Blur & cover                       | `redactions` in scene, Blur/Cover tools, drawing interaction, Privacy track, blur/cover inspectors, preview compositing. | 03         |
| 05  | Export pass                        | Worker: decode at source res → redactions → camera crop → cursor → overlays; export dialog stays as-is.                  | 03, 04     |
| 06  | Polish + gaps                      | Hold-to-see-original, empty state, keyboard shortcuts, contextual hints, macOS onboarding for Accessibility, docs flip.  | 05         |

The two capture risks (spikes) are **inside PR 01**, first tasks, so the rest of the plan
is not built on an assumption.

---

## PR 01 — Cursor track capture

**Outcome:** every new recording is saved with a `CursorTrack` sidecar
(`.kaipu/<id>.cursor.json`) when the platform allows it; recordings without one still
work exactly as today.

- [ ] **Spike A — cursor exclusion.** Try to exclude the OS cursor from the captured
      stream through the Electron `getUserMedia` path (there is no `cursor` constraint
      on the `mandatory` shape; check `desktopCapturer` options and Chromium flags).
      Expected result: **not possible** → adopt plan B from the spec (draw a larger
      custom cursor over the original at export). Record the finding in the spec.
- [ ] **Spike B — global click hook.** Add `uiohook-napi`, confirm it builds with
      electron-builder/rebuild on macOS arm64 + Windows, measure idle CPU, confirm the
      Accessibility prompt behavior. Fallback if it fails: ship position-only tracks and
      let the detector run on dwell alone (degraded but functional).
- [ ] `shared/types`: `CursorTrack`, `CursorSample`, `CursorClick` (spec § 8).
- [ ] `main/recording/cursor-tracker.ts` (pure-ish, tested): starts on
      `recordingStart`, polls `screen.getCursorScreenPoint()` every 8 ms, normalizes to
      the captured display's `bounds` (via `displayIdForSource`), stops on
      `recordingStop`; ring-buffers samples; returns the track on demand.
- [ ] **Clock anchoring across processes.** The recording's first video frame lives in
      the renderer; the poller lives in main. Both processes expose
      `performance.timeOrigin + performance.now()` — a monotonic clock with a fixed
      per-process origin, immune to NTP jumps mid-recording. The renderer stamps `t0`
      when the first frame arrives (`requestVideoFrameCallback` on the hidden video
      element already used for `captureThumbnail`) and sends it with `recordingStart`;
      main rebases every sample as `now - t0`. Test with a synthetic offset.
- [ ] Persist: extend `RecordingFinalizeMeta` (or a new IPC) so the track is written by
      `library-vault` next to the existing sidecar. Multi-monitor: samples outside the
      captured display are kept but flagged `offscreen: true` (renderer decides).
- [ ] `main/permissions.ts`: add `accessibility` kind (macOS
      `systemPreferences.isTrustedAccessibilityClient`, pane deep-link). UI wiring is PR 06.
- [ ] Docs: update the pipeline spec § 3/§ 4 with spike results.

## PR 02 — Detection + camera model (pure, TDD)

**Outcome:** two pure modules with exhaustive unit tests and no UI. Both live in
`renderer/features/video-editor/zoom/` and are shared by preview and export.

- [ ] `cursor-track.ts`: `sampleAt(track, t)` (binary search + lerp), `dwellsFrom(track)`
      (pauses with duration/radius), `clusterClicks(clicks, windowMs)`.
- [ ] `detect-zoom-segments.ts`: `detectZoomSegments(track, sensitivity) → ZoomSegment[]`
      with `origin: 'auto'`, `trigger: 'click' | 'dwell'`, min duration 1 s, merge
      overlapping candidates, hysteresis enter/exit thresholds derived from
      `sensitivity` (0–100). Calibration constants in one exported object so the
      Detection panel and tests share them.
- [ ] `camera.ts`: `cameraAt(segments, track, t) → { x, y, scale }` in normalized frame
      space — deadzone, critically-damped easing driven by `smoothing`, 200 ms
      anticipation using lookahead, `follow` vs `fixed` (anchor), clamp so the box never
      leaves the frame. Deterministic given inputs (no internal state) so preview
      scrubbing and export agree frame-for-frame.
- [ ] Fixture: one real `cursor.json` from PR 01 checked into `__fixtures__` for
      regression tests on segment counts at sensitivities 0/55/100.

## PR 03 — Scene v2, zoom tracks, inspector

**Outcome:** the editor shows Activity + Zooms tracks, proposes segments on open, and
the user can select, resize, retarget, tune and delete them, with undo/redo.

- [ ] `scene.ts`: add `zoomSegments: ZoomSegment[]`, `sensitivity: number`; `session.ts`
      stays `version: 1` with the new fields **optional on parse** (old sessions load
      with `[]`/`55`) — additive, so no break point needed.
- [ ] Loading: `use-video-scene` receives the cursor track (new
      `loadVideoEditSession` return field or a sibling IPC); on first open with no
      session, run `detectZoomSegments` and commit the result as the initial scene.
- [ ] `timeline-strip.tsx`: generalize the single overlay lane into a track stack
      (Filmstrip · Activity · Zooms · [Privacy in PR 04]) with the 62 px label column.
      Activity track renders clicks (24 px accent) and dwells (6–18 px). Zoom blocks
      reuse the overlay-lane drag-handle code (min 1 s, `MIN_ITEM_DURATION`).
- [ ] Preview: `camera-box.tsx` overlay on `preview-stage` (frame, ticks, scrim, chip),
      draggable → writes `anchor`; preview canvas applies `cameraAt(t)` as a CSS
      transform on the video element (no re-encode — spec rule 6).
- [ ] Properties panel: `zoom-inspector.tsx` (Level, Smoothness, Follow/Lock, notes,
      Remove) and `detection-panel.tsx` (Sensitivity, live summary, Re-analyse, safety
      note). Sensitivity regenerates only `origin: 'auto'` segments.
- [ ] Toolbar: add the Zoom tool group next to the annotation tools; hint text per tool.
- [ ] Transport counts: `N zooms detected`.

## PR 04 — Blur & cover

**Outcome:** the user can draw time-ranged blur/cover regions in original-frame space,
see them live in the preview under the zoom, and edit them from the Privacy track.

- [ ] `scene.ts`: add `redactions: Redaction[]` (spec § 9; `intensity` min 40).
- [ ] Tools: Blur (`B`) and Cover (`C`) in the toolbar; drawing interaction on the
      preview with marching ants, size badge in **source pixels**, range badge, ghost
      block on the Privacy track; on release → created + selected + tool back to Select.
- [ ] Preview compositing order `frame → redactions → camera crop → cursor` — since the
      preview uses a CSS transform for the camera, redactions are DOM elements **inside**
      the transformed layer so they move with the content. Blur via
      `backdrop-filter`, pixelate via a downscaled canvas snapshot.
- [ ] Privacy track + inspectors (`blur-inspector.tsx`, `cover-inspector.tsx`).
- [ ] Transport counts: `N private regions`.

## PR 05 — Export pass

**Outcome:** the exported MP4 contains zoom, cursor and redactions; audio path unchanged.

- [ ] `export-plan.ts`: add `zoomSegments`, `redactions`, and the cursor track (or a
      pre-sampled camera path at output cadence) to the plan; keep it pure and tested.
- [ ] `export-worker.ts`: per clip frame, decode with `CanvasSink` at **source**
      resolution into a scratch `OffscreenCanvas`, apply redactions there (`ctx.filter =
'blur(px)'` for gaussian — supported on OffscreenCanvas 2D in Chromium — or
      down/upscale with `imageSmoothingEnabled = false` for pixelate; solid fill + label
      for cover), then `drawImage` the camera crop into the output canvas, draw the
      cursor, then stamp overlays. Slides: unchanged.
- [ ] Cursor sprite: a pre-rasterized `ImageBitmap` (plan B from PR 01) sized relative to
      the output, drawn at `sampleAt(t)` mapped through the camera.
- [ ] Verify A/V sync is untouched (the audio pass and `rebaseVideoTimestamp` do not
      change); add a perf note — decoding at source res instead of output res costs
      memory, measure on a 2560×1600 30 s clip.

## PR 06 — Polish and gaps

- [ ] Hold-to-see-original (button + `ORIGINAL · UNEDITED` chip; hides box, scrim,
      redactions) — small, but it is the honesty check the spec insists on.
- [ ] Empty state when no zoom is detected; `Esc` deselects; shortcuts `V R A T Z B C`.
- [ ] Onboarding: Accessibility permission step on macOS (two dialogs flow).
- [ ] Docs: flip backlog to 🟢, move lasting knowledge into `desktop/`.

---

## Decisions to confirm

Owner input needed before writing plans 01–06 in detail.

1. **Time base for zoom segments and redactions.** The specs say "same clock as the video
   PTS" (source time). The existing overlays are anchored to **timeline** time and
   clamped on cuts. Recommendation: **source time** for both zooms and redactions —
   they describe content, and a cut before them must not shift them; the timeline UI
   maps through `sourceToTimeline` for display. Annotations stay as they are.
2. **Annotations under zoom.** Should existing box/arrow/text overlays follow the content
   (drawn before the crop, so they zoom with it) or the screen (drawn after)?
   Recommendation: **before the crop** (content-pinned), same as redactions; it keeps one
   mental model and the export order becomes `frame → redactions → overlays → crop → cursor`.
3. **Cursor sprite plan B.** Assuming Spike A confirms the OS cursor cannot be excluded,
   we draw a larger cursor on top. OK to accept a faint "double cursor" at 1× when the
   sprite does not perfectly cover the original?
4. **Where the cursor track lives.** Vault sidecar `.kaipu/<id>.cursor.json` (proposed)
   vs. embedded in the edit session JSON. Sidecar keeps it tied to the recording, not to
   an edit; and Cloud upload can decide separately whether to sync it.
5. **Session versioning.** Keep `version: 1` and make new fields optional (proposed) vs.
   bump to 2 and drop old sessions.
6. **Library thumbnails / Cloud and privacy regions.** Out of scope for v2 or a PR 07?
   The original on disk keeps the secret either way; the question is whether thumbnails
   generated from the original should be regenerated from an export.
7. **Model for implementer subagents:** Sonnet by default, Opus 5 for PR 02 (detector /
   camera math) and PR 05 (worker). Confirm.
