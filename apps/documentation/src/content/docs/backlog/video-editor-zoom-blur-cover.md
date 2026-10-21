---
title: "Video editor v2 — zoom, blur and cover"
description: "Next iteration of the video editor: automatic cursor-following zoom (clean capture + cursor event track + offline detection), blur/cover privacy regions, a four-track timeline, and a context-sensitive properties panel. Non-destructive; burned in only at export."
---

# Video editor v2 — zoom, blur and cover

> **Status: 🟡 In progress** (2026-09-22). All ten PRs from the
> [audit](/plans/video-editor-v2/00-audit/) are implemented, each on its own branch
> stacked on the previous one (`feat/video-editor-v2-*`), ending at
> `feat/video-editor-v2-polish` (PR 10). **None of it is merged to `main`, and none of it
> has been validated in production** — see the PR table below for exactly what that means
> per PR. Evolves the shipped [video editor](./video-editor) (timeline, cuts,
> annotations, slides) — the new tools sit next to the existing annotation tools in the
> toolbar.
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

- [x] macOS permission flow: Screen Recording + Accessibility — two onboarding steps
      (the existing Screen Recording/Mic/Camera step, plus PR 10's Accessibility step),
      not one combined dialog; see [03](/plans/video-editor-v2/03-click-hook-permissions-and-gating/).
- [x] Decide where the render lives — the existing editor export worker
      (`features/video-editor/export/export-worker.ts`) hosts it; see
      [11](/plans/video-editor-v2/11-export-pass/).
- [x] Calibrate detector thresholds (minimum dwell, radius, click clustering) — see
      [04](/plans/video-editor-v2/04-zoom-detection-algorithm/).
- [x] Reconcile the spec's `project/` layout with the existing vault + edit-session
      JSON — session stays `version: 1`, cursor track is a vault sidecar
      (`.kaipu/<recordingId>.cursor.json`); see decisions 4–5 in the
      [audit](/plans/video-editor-v2/00-audit/).
- [x] Do Library thumbnails and Cloud upload respect privacy regions? — the export
      poster is generated from the rendered (redacted, zoomed) output, not the source
      (PR 1). The original recording on disk, its own thumbnail, and Cloud upload keep
      everything by design — documented as a v2 non-goal, with a note to that effect in
      the export dialog; see decision 6 in the [audit](/plans/video-editor-v2/00-audit/).
- [x] Empty state when no zoom is detected — Zooms lane empty-state hint, PR 10 (see
      [08 § PR 10 polish](/plans/video-editor-v2/08-editor-layout-and-tracks/#pr-10-polish-not-in-pr-6)).
- [ ] Export dialog: output resolution/format options — explicitly rejected for v2 (a
      resolution option is "the right long-term fix" but its own feature); see
      [12 § 1](/plans/video-editor-v2/12-capture-resolution-and-cursor-sprite/). The
      dialog's destination (Library) is unchanged from v1.
- [ ] Verify `cursor: 'never'` on Windows and macOS through Electron's capture path —
      deferred to v2.1 as an optional research spike, not a v2 blocker; see
      [12 § 2](/plans/video-editor-v2/12-capture-resolution-and-cursor-sprite/). v2 ships
      with the recorded OS cursor, magnified with the zoom (no drawn cursor).
- [ ] Multi-monitor handling when the cursor leaves the captured display — window
      sources and non-primary displays are handled for capture/normalization
      ([02](/plans/video-editor-v2/02-cursor-track-capture-and-persistence/) fixes W4),
      but a live monitor change mid-recording was not specifically re-verified in this
      pass; treat as open until manually checked.

## Implementation plan

Ten PRs (revised sequence from the
[audit](/plans/video-editor-v2/00-audit/), which supersedes the six-PR overview above).
**All ten are implemented, each on its own branch stacked on the previous one, ending at
`feat/video-editor-v2-polish` — none are merged into `main`, and none have been
validated in production.** 🟢 below means "code complete on its branch, checks green,
production validation still pending" per the status legend in the repo's `CLAUDE.md` —
it is not ✅ and does not mean shipped.

| #   | Title                              | Branch                                    | Depends on | Status                                                                                                                                                                                               |
| --- | ---------------------------------- | ----------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Export poster from rendered output | `feat/video-editor-v2-poster-from-output` | —          | 🟢 implemented, unmerged, unvalidated                                                                                                                                                                |
| 2   | Cursor position track              | `feat/video-editor-v2-cursor-track`       | —          | 🟢 implemented, unmerged, unvalidated                                                                                                                                                                |
| 3   | Click hook (gated)                 | `feat/video-editor-v2-click-hook`         | 2          | 🟢 implemented, unmerged, unvalidated (native-module packaging per Spike B still needs a real signed/notarized build check — see [03](/plans/video-editor-v2/03-click-hook-permissions-and-gating/)) |
| 4   | Zoom + source-time pure modules    | `feat/video-editor-v2-zoom-math`          | 2 (types)  | 🟢 implemented, unmerged, unvalidated                                                                                                                                                                |
| 5   | Scene v2 + loader                  | `feat/video-editor-v2-scene-v2`           | 4          | 🟢 implemented, unmerged, unvalidated                                                                                                                                                                |
| 6   | Timeline lanes + inspector panel   | `feat/video-editor-v2-timeline-lanes`     | 5          | 🟢 implemented, unmerged, unvalidated                                                                                                                                                                |
| 7   | Preview camera                     | `feat/video-editor-v2-preview-camera`     | 6          | 🟢 implemented, unmerged, unvalidated                                                                                                                                                                |
| 8   | Redactions in the editor           | `feat/video-editor-v2-redactions`         | 7          | 🟢 implemented, unmerged, unvalidated                                                                                                                                                                |
| 9   | Export pass                        | `feat/video-editor-v2-export-pass`        | 8, 1       | 🟢 implemented, unmerged, unvalidated                                                                                                                                                                |
| 10  | Polish + Accessibility onboarding  | `feat/video-editor-v2-polish`             | 9          | 🟢 implemented, unmerged, unvalidated                                                                                                                                                                |

Manual checks the automated suite does not cover (per PR, see each doc's "verify"
task): the native click hook on real hardware (Spike B), a signed/notarized macOS
build's Accessibility prompt behavior, real capture on hardware, the Web Worker's
WebCodecs export path, `backdrop-filter` under a transform on real GPUs, and general
performance. None of these have been run yet.
