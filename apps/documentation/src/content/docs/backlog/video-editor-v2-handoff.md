---
title: "Video editor v2 — handoff (2026-09-22)"
description: "Where video editor v2 stands at the end of the 2026-09-22 session: what is merged, what is open and in which order to merge it, what each open PR still needs from a human, the decisions taken while validating, and how to resume on another machine."
---

# Video editor v2 — handoff

> **Status: 🟡 In progress** (written 2026-09-22, end of session). This is a resume
> point, not a design doc. Parent: [video editor v2](./video-editor-zoom-blur-cover).
> Plan: [audit + docs 00–12](/plans/video-editor-v2/00-audit/). When every PR below is
> merged and validated, fold what lasts into the parent doc and delete this page.

## Where things stand

All ten implementation PRs exist, as a **stacked chain** — each branch was created from
the previous one, so they must be merged in order. Eight are merged; two are open.
Every branch is pushed and matches `origin`; nothing lives only on the machine that
wrote this.

| PR                                                                | Branch                                    | Delivers                                                                      | State                |
| ----------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- | -------------------- |
| [#132](https://github.com/csdev19/kaipu-record-monorepo/pull/132) | `feat/video-editor-v2-poster-from-output` | export poster from the rendered output                                        | ✅ merged            |
| [#133](https://github.com/csdev19/kaipu-record-monorepo/pull/133) | `…-cursor-track`                          | cursor position track + clock/pause mapping + vault sidecar                   | ✅ merged            |
| [#134](https://github.com/csdev19/kaipu-record-monorepo/pull/134) | `…-click-hook`                            | clicks via `uiohook-napi`, gated on Accessibility (no prompt)                 | ✅ merged            |
| [#135](https://github.com/csdev19/kaipu-record-monorepo/pull/135) | `…-zoom-math`                             | detector, camera path, source-time, redaction math (pure)                     | ✅ merged            |
| [#136](https://github.com/csdev19/kaipu-record-monorepo/pull/136) | `…-scene-v2`                              | scene v2, session, initial detection, **autosave**                            | ✅ merged            |
| [#137](https://github.com/csdev19/kaipu-record-monorepo/pull/137) | `…-timeline-lanes`                        | Activity + Zooms lanes, inspector column, Zoom tool                           | ✅ merged            |
| [#138](https://github.com/csdev19/kaipu-record-monorepo/pull/138) | `…-preview-camera`                        | camera transform per frame, camera box, hold-to-compare, Follow/Lock          | ✅ merged            |
| [#139](https://github.com/csdev19/kaipu-record-monorepo/pull/139) | `…-redactions`                            | Blur/Cover tools, Privacy lane, inspectors (preview only)                     | ✅ merged            |
| [#140](https://github.com/csdev19/kaipu-record-monorepo/pull/140) | `…-export-pass`                           | zoom + redactions + pinned overlays burned into the export                    | 🟢 open, base `main` |
| [#141](https://github.com/csdev19/kaipu-record-monorepo/pull/141) | `…-polish`                                | shortcuts, empty states, Accessibility onboarding, soft-zoom hint, docs to 🟡 | 🟢 open, base `#140` |

Plus one implementation PR that came out of validating the data:

| PR                                                                | Branch                                    | Delivers                                                                                                                         | State                |
| ----------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [#143](https://github.com/csdev19/kaipu-record-monorepo/pull/143) | `feat/video-editor-v2-cursor-track-check` | `inspectCursorTrack`, `bun run cursor-track:check`, a real-recording fixture, **and the tail-cut fix** (`durationMs`, unfloored) | 🟢 open, base `main` |

Test suite: 851 on `main` before v2 → 1084 with all ten PRs (→ ~1110 with #143).

**Merge order:** #140 → #141, then #143 (independent; may conflict trivially with #141
on `recorder-store.ts` — both touch `RecordingFinalizeMeta` call sites).

## Open docs PRs (all against `main`, docs only)

| PR                                                                | What it records                                                                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [#142](https://github.com/csdev19/kaipu-record-monorepo/pull/142) | `backlog/cursor-sprite-capture` — cursor-free capture + drawn cursor, deferred to v2.1; linked from the roadmap |
| [#144](https://github.com/csdev19/kaipu-record-monorepo/pull/144) | `backlog/edit-state-indicators` — "Guardando…" in the editor; "Editado · sin exportar" in the library           |
| [#145](https://github.com/csdev19/kaipu-record-monorepo/pull/145) | `backlog/video-editor-camera-box-ux` — box only grabs on its border; focus lost after a timeline click          |
| [#146](https://github.com/csdev19/kaipu-record-monorepo/pull/146) | `backlog/video-editor-annotation-inspector` — annotations still use the v1 popover; move them to the inspector  |
| [#147](https://github.com/csdev19/kaipu-record-monorepo/pull/147) | **ADR 0003** — an export never replaces the original recording                                                  |

#144, #145 and #146 each add one row to `backlog/index.mdx` and one sidebar entry at
different anchors. If the second or third to merge reports a conflict, it is only the
order of two adjacent table rows.

## Decisions taken while validating (2026-09-22)

1. **An export never replaces the original** (ADR 0003, #147). Already the code's
   behaviour; the v1 promise of a "reemplazar" option is withdrawn.
2. **Edits persist indefinitely** (autosaved `.kaipu/<id>.edit.json`, deleted with the
   recording). Leaving the editor is allowed; the missing signal is "edited, not
   exported" in the library, not an unsaved-changes chip (#144).
3. **Annotation options belong in the inspector column**, the same place the zoom is
   customised (#146).
4. **The camera box should grab by its body**, not only its border (#145).
5. **No drawn cursor in v2**; v2.1 candidate gated on a capture spike (#142).

## What still needs a human (hardware, not the suite)

In priority order — the first two are privacy:

- [ ] **#140 leak checks**, on the _exported_ file with a frame-accurate player: a Blur
      flush against the frame's top and left edge (nothing readable in the outer ~90 px
      band); a Blur drawn over a Cover (the covered content must not come back).
- [ ] **#140 A/V sync regression**: export with cuts + slides + annotations and no zoom
      or region; audio in sync at every cut. Plus the perf number: 30 s at 2560×1600 with
      two zooms and one gaussian region, wall time vs `main`; stop if > 2× slower.
- [ ] **#133 poller cost**: 5 min at the highest quality preset on `main` and on v2;
      main-process CPU and dropped frames. If it regresses, set
      `CURSOR_SAMPLE_INTERVAL_MS` to 16.
- [ ] **#141 Accessibility flow** on a Mac that has _not_ granted it: the Accessibility
      row appears on the onboarding permissions step (it was a standalone step; folded
      into the list during validation), "Allow" opens the prompt, and after granting +
      restart, clicks produce zooms. Also: does macOS list the app under **Input Monitoring**? If yes, stop —
      that is an owner decision (see plan doc 03).
- [ ] **#138 geometry**: shrink the window until the video is height-capped (or open a
      4:3 recording); the camera box must frame the picture exactly.
- [ ] **#139 GPU check**: a zoom over a region, deselect, play — the blur stays glued to
      the content under the moving camera (`backdrop-filter` under transform).
- [ ] **Detector calibration fixture** (plan doc 04, owner-manual): a real 60 s recording
      _with clicks_ as `zoom/__fixtures__/demo.cursor.json` + its test. The recording in
      `src/shared/__fixtures__/real-screen-2026-09-22.*` (#143) has **no clicks** — it was
      made before Accessibility was granted — so it pins the track format, not the
      detector's thresholds.

## Known findings from today's real recording

`recording-2026-09-22-21-27-53` (25 s, screen, 1920×1080 display, file 2560×1440):

- Track valid; clock and normalization verified with pixel overlays at four timestamps
  (`bun run cursor-track:check <id> --frames 4` reproduces the check).
- `clicksAvailable: false` — expected: Accessibility was not granted to the dev
  `Electron.app`. **Per machine**: it has to be granted again on the other machine
  (System Settings → Privacy & Security → Accessibility → `node_modules/electron/dist/Electron.app`).
- The tail cut lost ~0.9 s of samples because `durationSeconds` was floored — fixed in
  #143 (`durationMs + 250 ms`).
- Side observation, **not** this feature's: a 1920×1080 display produced a 2560×1440
  file. `fitToCap` never upscales, so either `getSettings()` reported that size or the
  engine fell back to the quality preset's width. Worth a look in `recorder-engine.ts`.

## Resuming on another machine

```bash
git fetch origin
git checkout feat/video-editor-v2-polish        # tip of the chain (PRs 1–10)
bun install                                     # uiohook-napi prebuilds; postinstall runs install-app-deps
bun run setup && infisical login                # secrets are per machine
cd apps/kaipu-record && bun run check-types && bun run test
bun run dev
```

Useful after recording something:

```bash
cd apps/kaipu-record
bun run cursor-track:check <recording-id> --frames 4   # needs #143 merged, or check out its branch
```

Model assignment used so far (audit § decision 7): Sonnet for implementation by
default; Opus 5 for the clock/tracker (PR 2), the preview compositing (PR 7) and the
export worker (PR 9). Design and review work ran on Opus 5 / Fable. Every PR
description carries its own manual checklist; those, not this page, are the source of
truth for what each PR still needs.
