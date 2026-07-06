---
title: "E2E testing harness — design"
description: "Playwright-driven end-to-end tests that launch the real Electron app against an isolated vault fixture, starting with the video-editor playback (seek) and export regressions."
---

# E2E testing harness — design

> **Status: 🔵 Approved design** (2026-07-06). Local-first (not wired into CI yet, by
> choice), Playwright + Electron, MVP scoped to the two flows whose regressions we just
> lived through: seek-then-play and video export. Grows from there.

## Motivation

The video-editor playback and export bugs (seeking wedged the `<video>`; export failed on
a cross-origin `fetch()` and then on `AudioBuffer` in a worker) were all **invisible to the
unit suite** — they only reproduce in a real Chromium renderer driving a real media file.
They were found by driving the running app over the Chrome DevTools Protocol (CDP). That
ad-hoc instrumentation was, in effect, end-to-end testing. This spec turns that technique
into a maintained, reusable harness so those exact regressions (and the class of bug they
represent) are caught automatically going forward.

## Goals / non-goals

**Goals**

- Launch the **real production build** of `kaipu-record` and drive it like a user (clicks,
  navigation), asserting on observable behavior.
- Run fully **isolated**: never touch the developer's real profile or `~/Movies/Kaipu Record`.
- Ship two regression tests: **playback seek → play**, and **export → valid MP4**.
- Be structured so a CI job can be added later without redesign.

**Non-goals (this iteration)**

- Native-capture flows: screen recording (`desktopCapturer`/ScreenCaptureKit), camera,
  global shortcuts, tray, OS permission dialogs. These need real hardware/OS APIs; they are
  a documented **known limitation**, to be mocked at the main-process IPC boundary or tested
  manually in a later iteration.
- CI integration. The harness is local-first now; the design keeps CI cheap to add later.
- Broad coverage (timeline edits, screenshot editor, library). Deferred to follow-ups.

## Prerequisite

The two regression tests assert the FIXED behavior. They must run against a build that
contains the fixes on `feat/video-editor` (PR #28: commits `f41706f` Range/seeking and
`5a2af0e` export CORS + worker audio). **Implementation of this harness must be based on
top of those fixes** (branch off `feat/video-editor`, or land after it merges to `main`) —
otherwise the tests correctly fail. This `test/e2e-harness` branch holds only the design +
plan documents and is based on `main`; the implementation branch rebases onto the fixes.

## Architecture

### Launch model

Playwright's Electron support (`_electron.launch`) **launches** the app (it owns the
lifecycle), as opposed to the debugging instruments which **attached** to an already-running
dev process. Tests launch the built main entry `out/main/index.js` so the renderer loads via
`file://` — the same path the packaged `.app` uses, not the Vite dev server. A `test:e2e`
script runs `build` first.

Per launch, a helper (`e2e/helpers/launch.ts`) provides:

- A fresh temp `--user-data-dir` (clean profile; `app.getPath("userData")` points here), so
  no real preferences/state leak in or out.
- A fresh temp **vault** seeded with the fixture recording (see below), pointed at via a
  `preferences.json` (`{ "vaultDirectory": "<tempVault>" }`) written into the temp userData —
  the existing, supported way `vault-location.ts` selects a custom folder. No app code change
  is required to isolate the vault.
- The Playwright `ElectronApplication` + first `Page` (the renderer window), and a
  `teardown()` that closes the app and removes both temp dirs.

### Fixture

A small committed clip at `apps/kaipu-record/e2e/fixtures/sample.mp4`: a few seconds, modest
resolution, **with an audio track** (so the export audio path — the `AudioSample` migration —
is actually exercised). Tens to low hundreds of KB. `seedVault(dir)` copies it in as
`<id>.mp4` and writes `.kaipu/<id>.json` with `{ durationSeconds, title }` (a positive
`durationSeconds` is what makes a recording editable per `LibraryDetailPage`), so it appears
in the library and opens in the editor.

Committing a fixture (vs generating it with ffmpeg at runtime) is chosen for determinism and
zero runtime tooling dependency; the file is tiny and stable.

### Test files

- `e2e/playback.e2e.ts` — library → open recording → "Editar video" → click the ruler at a
  fraction (seek) → click Play → assert `video.currentTime` advances and the element is not
  stuck (`seeking === false`, `error === null`). Optionally: scrub while playing stays
  playing; pause/resume after seeks. This is the exact `f41706f` regression.
- `e2e/export.e2e.ts` — open the editor → click "Exportar" → wait (long, explicit timeout)
  until the app navigates to the new `/library/<id>` → validate the output file with
  **ffprobe**: has an h264 video stream + an aac audio stream, and video/audio durations are
  aligned (within tolerance). Covers both `5a2af0e` failures (CORS fetch, worker audio).

### Layout

```
apps/kaipu-record/
  e2e/
    fixtures/sample.mp4
    helpers/launch.ts      # isolated Electron launch + seedVault + teardown
    helpers/ffprobe.ts     # spawn ffprobe, parse streams/durations
    playback.e2e.ts
    export.e2e.ts
  playwright.config.ts     # electron project, timeouts, artifacts on failure
```

New dev dependency: `@playwright/test` only. `ffprobe` is used from the system if present.

## Data flow (a test run)

1. `test:e2e` builds the app, then Playwright runs.
2. `launch.ts` makes temp userData + temp vault, `seedVault()` drops in `sample.mp4` +
   sidecar, writes `preferences.json`, and `_electron.launch({ args: ["out/main/index.js",
"--user-data-dir=<temp>"] })`.
3. The test drives the renderer `Page` with auto-waiting locators (no `sleep`).
4. Assertions read renderer state (`video.currentTime`, DOM/route) and, for export, the
   on-disk output via `ffprobe`.
5. `teardown()` closes the app and deletes both temp dirs.

## Error handling & flakiness

- **No fixed sleeps.** Every wait is condition-based (Playwright waits for elements/state);
  export uses one generous explicit timeout with progress polling.
- **ffprobe optional.** If `ffprobe` is not on `PATH`, the export assertion on stream codecs
  is **skipped with a clear message** (test not silently green): the navigation-success check
  still runs. A follow-up can vendor a probe or make ffprobe required in CI.
- **Artifacts on failure.** Playwright config captures screenshot + video + trace on failure
  for post-mortem (the trace viewer replaces the manual CDP logging we did by hand).
- **Retry policy.** Zero or one retry locally; the goal is deterministic tests, not masking
  flakiness with retries.

## Testing (of the harness itself)

The harness is validated by running it against the fixed build and confirming both tests pass,
and by confirming a deliberately reverted fix makes the corresponding test fail (red-green
proof that the test actually guards the regression).

## Future work (out of scope here)

- CI job: macOS runner (native features work, costlier) or Linux + `xvfb` for the
  renderer-only flows (playback/export/edit run headless since they are Chromium + a file).
- Main-process IPC stubs for native-capture flows.
- Coverage expansion: timeline cut/trim/split, slides, overlays, undo/redo, screenshot editor,
  library browse.
