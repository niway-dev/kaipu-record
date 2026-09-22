---
title: "Video editor v2 — 00 audit of the overview plan"
description: "Audit of the video editor v2 overview plan against the actual code: fifteen weak points with evidence, the deep-dive document that fixes each one, a revised PR sequence, and the execution rules for implementer agents."
sidebar:
  order: 0
---

# Video editor v2 — 00 audit

> **Status: 🔵 Proposed** (2026-09-21). Audits
> [the overview plan](/plans/2026-09-21-video-editor-v2-00-overview/) against the code on
> `main` at `d18dbbd`. Nothing described here is implemented. The documents `01`–`12` in
> this folder replace the overview's PR sections; the overview stays as history.

## Verdict

The overview picks the right architecture (record clean, capture a cursor track, compose
at export) and the right host (the existing mediabunny export worker). It is **not
executable** as written: several steps rest on assumptions the code contradicts, and the
hardest parts — the clock, the camera model, the detector — are named but not specified.
An implementer following it would ship zooms that drift after the first pause, a camera
that cannot be both "stateless" and "damped", and an exported file whose library
thumbnail shows the secret the user just covered.

Each weak point below has its own document with the missing design and step-by-step
tasks. The documents carry **complete code and exact diffs**, not sketches. Before
publishing, the whole plan was implemented in a scratch copy of `main` at `d18dbbd`: every
diff applies in PR order with `git apply`, the result typechecks (`web` and `node`),
passes `oxfmt --check`, and passes the full suite — **1,024 tests** across both vitest
projects, including the unchanged pre-existing editor, page, timeline, export and
recorder tests. Copy the code verbatim.

What that verification does **not** cover, and each document says so where it applies:
the native click hook (Spike B), real capture on hardware, the Web Worker's WebCodecs
path, `backdrop-filter` under a transform on real GPUs, and performance. Those are manual
checks listed in each PR's "verify" task.

## Weak points

Severity: **Critical** = ships a wrong result or a privacy leak · **High** = blocks
implementation or forces a rewrite · **Medium** = rework or a bad UX edge.

| #   | Weak point                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Severity | Evidence in code                                                                                                                                                                    | Fixed in                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| W1  | **Pause is ignored.** mediabunny removes paused time from the file; the plan's `now − t0` does not, so every sample after the first pause is late by the paused duration.                                                                                                                                                                                                                                                                                   | Critical | `recorder-store.ts:233` `engine.pause()` → `recorder-engine.ts:252` `videoSource.pause()`; mediabunny 1.49 `media-source.js` subtracts dropped-frame deltas from `timestampOffset`. | [01](/plans/video-editor-v2/01-clock-and-pause-mapping/)                                                            |
| W2  | **Wrong t0 source.** The plan stamps t0 with `requestVideoFrameCallback` on "the hidden video element used for `captureThumbnail`". That element is created _after_ `output.start()` and waits 150 ms; it is not the frame mediabunny encodes first.                                                                                                                                                                                                        | Critical | `recorder-engine.ts:232` start, `:248` thumbnail; `captureThumbnail` sleeps 150 ms.                                                                                                 | [01](/plans/video-editor-v2/01-clock-and-pause-mapping/)                                                            |
| W3  | **Cross-process clock is not comparable.** `timeOrigin + now()` is fixed per process at launch and the monotonic clock stops during sleep; a renderer re-created after a sleep disagrees with main by the sleep length.                                                                                                                                                                                                                                     | High     | Recorder = main window renderer (`recorder-store.ts`); poller = main process.                                                                                                       | [01](/plans/video-editor-v2/01-clock-and-pause-mapping/)                                                            |
| W4  | **Window sources and display resolution are not handled.** `displayIdForSource` returns `undefined` for `window:` sources; Electron cannot read another app's window bounds, so there is nothing to normalize against.                                                                                                                                                                                                                                      | High     | `recording-hub.ts:208`.                                                                                                                                                             | [02](/plans/video-editor-v2/02-cursor-track-capture-and-persistence/)                                               |
| W5  | **"Ring-buffers samples"** drops the start of any recording longer than the buffer. Storage format, size and de-duplication are unspecified.                                                                                                                                                                                                                                                                                                                | High     | Overview PR 01 bullet 4.                                                                                                                                                            | [02](/plans/video-editor-v2/02-cursor-track-capture-and-persistence/)                                               |
| W6  | **Lifecycle gaps.** `recordingStart` carries no session id and the recording id is minted only at `finalize`; export sessions use the same writer; `LibraryVault.remove` would orphan `cursor.json`.                                                                                                                                                                                                                                                        | High     | `recording-hub.ts:140-146`, `recorder-store.ts:161-163`, `library-vault.ts:274`.                                                                                                    | [02](/plans/video-editor-v2/02-cursor-track-capture-and-persistence/)                                               |
| W7  | **Shipping PR 01 alone prompts every macOS user for Accessibility** on their next recording (libuiohook asks when it starts untrusted), while the onboarding that explains it is in PR 06. Native-module packaging (`npmRebuild: false`, `asarUnpack`) is not addressed.                                                                                                                                                                                    | High     | `electron-builder.yml:12,49`; overview PR 06 bullet 3.                                                                                                                              | [03](/plans/video-editor-v2/03-click-hook-permissions-and-gating/)                                                  |
| W8  | **Detector is named, not specified.** "Hysteresis from sensitivity", "calibration constants", dwell and cluster definitions are left open — an implementer has to invent the algorithm.                                                                                                                                                                                                                                                                     | High     | Overview PR 02 bullets 1–2; pipeline spec § 9 open item.                                                                                                                            | [04](/plans/video-editor-v2/04-zoom-detection-algorithm/)                                                           |
| W9  | **"Deterministic, no internal state" contradicts damping/deadzone.** A damped camera is a stateful filter; `cameraAt(t)` cannot be both. Transitions between segments, follow-mode offset and clamping are undefined.                                                                                                                                                                                                                                       | Critical | Overview PR 02 bullet 3; UI spec § 4.2 ("drag defines the offset relative to the cursor") vs data model (`anchor` only in fixed).                                                   | [05](/plans/video-editor-v2/05-camera-path-model/)                                                                  |
| W10 | **Source time base consequences are not worked out.** Segments that span a cut, segments in deleted footage, counts, timeline blocks, edge drags over slides, overlap rules.                                                                                                                                                                                                                                                                                | High     | `timeline.ts` maps only clip entries; overlays are timeline-anchored (`scene.ts` header).                                                                                           | [06](/plans/video-editor-v2/06-time-base-cuts-and-mapping/)                                                         |
| W11 | **Auto-detection as a commit marks the scene dirty**, so the discard-changes dialog pops on every open-and-leave. And the session is written only on export while `useBlocker` intercepts in-app navigation only — closing the window (⌘W, Quit, crash) silently discards every cut, zoom and redaction, with no dialog.                                                                                                                                    | Medium   | `video-editor-page.tsx:163-171` (initial scene), `:229` (blocker predicate), `:399` (only save), `use-video-scene.ts` `dirty = past.length > 0`.                                    | [07](/plans/video-editor-v2/07-scene-session-and-history/) — initial scene, plus debounced autosave                 |
| W12 | **The UI spec describes a different screen** (titlebar, rail, 288 px properties panel, four tracks with a label column) than the page that exists (header, floating `OverlayOptions`, one overlay lane). Where annotations live in the four-track design is not said. Spec copy is English, product copy is Spanish via i18n; spec colors are literal hex, the app uses tokens.                                                                             | High     | `video-editor-page.tsx:581`, `timeline-strip.tsx`, `packages/i18n/messages/es.json`, `packages/tokens/css/tokens.css`.                                                              | [08](/plans/video-editor-v2/08-editor-layout-and-tracks/)                                                           |
| W13 | **Preview design is one line.** Result view vs zoom-edit view, per-frame camera updates without React re-renders, pointer mapping under a CSS transform, preview/export blur parity, pixelate in the preview, hold-to-compare.                                                                                                                                                                                                                              | High     | `preview-stage.tsx`, `video-annotation-layer.tsx` (`toNorm` uses `getBoundingClientRect`).                                                                                          | [09](/plans/video-editor-v2/09-preview-compositing/)                                                                |
| W14 | **Privacy leaks the plan does not see.** (a) The exported recording's poster is generated from the _original_ first frame — unredacted and even from deleted footage. (b) Point-in-time redaction tests leak one frame at each edge. (c) Blur px differ between preview and export.                                                                                                                                                                         | Critical | `use-video-export.ts:109` `generateThumbnail(sourceBlob)`.                                                                                                                          | [10](/plans/video-editor-v2/10-redactions-rendering-and-leaks/)                                                     |
| W15 | **Export facts are off.** Output size already equals source size (`CanvasSink` at `videoWidth×videoHeight`), so "decode at source res costs memory" is moot; the real questions are the scratch canvas, overlay order under the crop and a fast path. Recordings are capped at the quality preset height (1080 by default), so "zoom up to 2.5× is free" is false. The drawn-cursor "plan B" needs sub-frame sync and still double-draws non-arrow cursors. | High     | `use-video-export.ts:206`, `export-worker.ts:202`, `recorder-engine.ts:131` `fitToCap`.                                                                                             | [11](/plans/video-editor-v2/11-export-pass/), [12](/plans/video-editor-v2/12-capture-resolution-and-cursor-sprite/) |

Smaller issues, fixed inline in the documents above: PR 03 and PR 04 are each three PRs
of work (split below); `ZoomSegment.anchor?` is replaced by `anchor: … | null` so parsing
is total; any user edit to an auto segment must flip it to `manual` or Sensitivity wipes
the edit; delete precedence and `Esc` need a single selection model.

## Decisions — resolved defaults

The overview asked seven questions. The audit resolves the ones the code answers and
leaves only genuine product calls to the owner.

| #   | Question                         | Resolution                                                                                                                                                                                                                                             | Status                                  |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| 1   | Time base for zooms / redactions | **Source time.** Required for correctness: the camera path is simulated once over source time and never recomputed on a cut; a redaction can never be "slid off" its secret by a cut. See [06](/plans/video-editor-v2/06-time-base-cuts-and-mapping/). | Resolved                                |
| 2   | Annotations under zoom           | **Content-pinned** (drawn before the crop). Falls out of the preview design for free (the annotation layer sits inside the transformed layer) and costs one `drawImage` source-rect change at export. Consequence: text grows with the zoom.           | Default — owner may flip                |
| 3   | Cursor sprite plan B             | **Deferred to v2.1.** v2 keeps the recorded OS cursor (magnified with the zoom). See [12](/plans/video-editor-v2/12-capture-resolution-and-cursor-sprite/) for why plan B is not "draw a PNG on top".                                                  | Owner confirms the cut                  |
| 4   | Where the cursor track lives     | **Vault sidecar** `.kaipu/<recordingId>.cursor.json`, deleted with the recording, never uploaded. See [02](/plans/video-editor-v2/02-cursor-track-capture-and-persistence/).                                                                           | Resolved                                |
| 5   | Session versioning               | **Stay `version: 1`**, new fields optional on parse. The old parser ignores unknown keys, so downgrading is safe (zooms are dropped, the session still opens). See [07](/plans/video-editor-v2/07-scene-session-and-history/).                         | Resolved                                |
| 6   | Thumbnails / Cloud and privacy   | **Export poster from the rendered output** (bug fix, first PR). The original's thumbnail and Cloud upload keep the secret by design — v2 non-goal, stated in the export dialog note.                                                                   | Resolved (poster) · non-goal (original) |
| 7   | Implementer models               | Sonnet by default; **Opus 5** for PR 2 (clock + tracker integration, cross-process), PR 7 (preview compositing) and PR 9 (export worker). The pure-math PR drops to Sonnet because its code is now fully specified.                                    | Owner confirms                          |

## Revised PR sequence

Every PR is additive and shippable alone. A recording without a cursor track opens
exactly as today. "Docs" = the deep-dive document the implementer follows.

| PR  | Title                              | Delivers                                                                                                                                    | Docs                  | Depends on | Model  |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------- | ------ |
| 1   | Export poster from rendered output | Worker posts the first output frame as JPEG; exported items stop showing the original's first frame. Pre-existing bug for cuts too.         | 10 § Poster           | —          | Sonnet |
| 2   | Cursor position track              | Shared track format, clock sync, pause mapping, main tracker, sidecar write/read/delete. No native module, no UI.                           | 01, 02                | —          | Opus 5 |
| 3   | Click hook (gated)                 | Spike B, `uiohook-napi` packaging, click capture only when Accessibility is already trusted, accessibility IPC. No prompt, no UI.           | 03                    | 2          | Sonnet |
| 4   | Zoom + source-time pure modules    | `detect-zoom-segments`, `camera-path`, `source-time`, `redaction` math with their tests. No UI.                                             | 04, 05, 06, 10 § Math | 2 (types)  | Sonnet |
| 5   | Scene v2 + loader                  | `zoomSegments` / `redactions` / `zoomSensitivity` in scene + session, cursor track load, initial detection (not dirty), debounced autosave. | 07                    | 4          | Sonnet |
| 6   | Timeline lanes + inspector panel   | Label column, Activity and Zooms lanes, inspector column with Detection panel and Zoom inspector, counts, Zoom tool.                        | 08                    | 5          | Sonnet |
| 7   | Preview camera                     | Result view with per-frame camera transform, zoom-edit view with camera box, hold-to-compare.                                               | 09                    | 6          | Opus 5 |
| 8   | Redactions in the editor           | Blur/Cover tools, drawing, preview rendering, Privacy lane, blur/cover inspectors.                                                          | 09, 10                | 7          | Sonnet |
| 9   | Export pass                        | Camera crop, redactions, content-pinned overlays, fast path, verification checklist.                                                        | 11                    | 8, 1       | Opus 5 |
| 10  | Polish + Accessibility onboarding  | Shortcuts, empty states, `Esc`, macOS Accessibility step (the only place the prompt is ever shown), docs flip to 🟢.                        | 03 § UI, 08 § Polish  | 9          | Sonnet |

Cursor sprite (plan B) is **not** in v2 — see [12](/plans/video-editor-v2/12-capture-resolution-and-cursor-sprite/).

## Rules for implementer agents

Read these once; every document assumes them.

1. **Language.** Code, identifiers, comments, tests, commits, PR text: English. User-facing
   copy: neutral Spanish in `packages/i18n/messages/es.json` **and** English in
   `packages/i18n/messages/en.json`, same key, under the `videoEditor` (or `record`,
   `settings`) namespace. Never hard-code copy in a component.
2. **Style.** Match the surrounding file: kebab-case filenames, no `enum`, string-union
   types, structural validation without zod, CSS Modules with tokens from
   `packages/tokens/css/tokens.css` (`var(--accent-primary)`, `var(--bg-card)`, …).
   Where a document gives a literal color it is the UI spec's value; if a token exists
   for it use the token.
3. **Copy code verbatim** when a document provides a full file. Do not "improve" the
   constants — they are what the tests pin.
4. **Checks before every commit**, from the monorepo root:

   ```bash
   bunx oxfmt --check .
   cd apps/kaipu-record && bun run check-types && bun run test
   ```

   All three must pass. Never commit with a failing check; never skip a hook.

5. **Tests.** Main-process and `src/shared/` tests run in the `main` vitest project (node);
   renderer tests in `renderer` (jsdom, `src/renderer/src/test/setup.ts`). Every new
   `window.electronAPI` method must also get a stub in `src/renderer/src/test/setup.ts`
   or unrelated renderer tests break.
6. **IPC.** A new channel = four edits: `IPC_CHANNELS` in `src/shared/types/ipc.ts`, the
   method on `ElectronAPI` in `src/shared/types/electron-api.ts`, the bridge in
   `src/preload/index.ts`, the handler in main. Plus the test stub (rule 5).
7. **Git.** Branch `feat/video-editor-v2-<pr-slug>` from `main`. Before any `gh` command,
   follow `~/GITHUB_ACCOUNTS.md`. One PR per row above; do not combine rows.
8. **Stop and report** instead of improvising when: a spike result contradicts a
   document, a referenced file or symbol does not exist, or a check fails for a reason
   the document does not cover.
9. **Docs.** When a PR lands, tick its row in
   [backlog/video-editor-zoom-blur-cover](/backlog/video-editor-zoom-blur-cover/) and
   keep the spec status honest (no "implemented" for code not on `main`).

## Documents

| Doc | Topic                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------- |
| 01  | [Clock and pause mapping](/plans/video-editor-v2/01-clock-and-pause-mapping/)                           |
| 02  | [Cursor track capture and persistence](/plans/video-editor-v2/02-cursor-track-capture-and-persistence/) |
| 03  | [Click hook, permissions and gating](/plans/video-editor-v2/03-click-hook-permissions-and-gating/)      |
| 04  | [Zoom detection algorithm](/plans/video-editor-v2/04-zoom-detection-algorithm/)                         |
| 05  | [Camera path model](/plans/video-editor-v2/05-camera-path-model/)                                       |
| 06  | [Time base, cuts and mapping](/plans/video-editor-v2/06-time-base-cuts-and-mapping/)                    |
| 07  | [Scene, session and history](/plans/video-editor-v2/07-scene-session-and-history/)                      |
| 08  | [Editor layout and tracks](/plans/video-editor-v2/08-editor-layout-and-tracks/)                         |
| 09  | [Preview compositing](/plans/video-editor-v2/09-preview-compositing/)                                   |
| 10  | [Redactions: rendering and leaks](/plans/video-editor-v2/10-redactions-rendering-and-leaks/)            |
| 11  | [Export pass](/plans/video-editor-v2/11-export-pass/)                                                   |
| 12  | [Capture resolution and cursor sprite](/plans/video-editor-v2/12-capture-resolution-and-cursor-sprite/) |
