---
title: Feature map — 2026-10-15
description: Principal source files, flows, IPC channels and hot paths of the four core desktop features (record, screenshot, library, edit video) at main d36b19dd — the input for the pre-deploy audit.
sidebar:
  order: 1
---

# Feature map — 2026-10-15

> Snapshot of `main` at `d36b19dd`. Produced by four read-only mapping agents (one per feature) and
> edited by hand. It is the input for the [audit report](/audits/2026-10-15/report/). Paths are
> relative to `apps/kaipu-record/src/`; line counts are from `wc -l` on that commit. Test files are
> excluded from the tables.

**Process model in one paragraph.** The desktop app is Electron. _main_ owns windows, global
shortcuts, the tray, the file system (the vault) and native hooks. _preload_ exposes
`window.electronAPI`, a typed bridge whose channel names live in `shared/types/ipc.ts`. The
_renderer_ (React) owns UI, capture encoding (mediabunny on WebCodecs) and the editors; heavy export
work runs in Web Workers. Media files reach the renderer through the `kaipu-media://` protocol.

**Where time is spent continuously** — the places a perf regression most likely hides:

| Feature    | Always-on work                                                                                                      | Where                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Record     | 8 ms cursor poll in main; 100 ms tick IPC; per-chunk copy + IPC; rAF compositor                                     | `cursor-tracker.ts:58`, `recorder-store.ts:224`, `recorder-engine.ts:236`, `recording-compositor.ts:76` |
| Screenshot | Scene `setState` on every pointer move                                                                              | `annotation-layer.tsx:217`, `crop-overlay.tsx:109`                                                      |
| Library    | Full vault scan per list _and_ per tag list; sync `preferences.json` read per IPC/media request; unvirtualized grid | `library-vault.ts:114`, `tag-repository.ts:148`, `vault-location.ts`, `library-page.tsx:329`            |
| Edit video | Per-frame overlays; 1545-line page re-renders on any scene change                                                   | `use-video-frame-clock.ts:36`, `redaction-layer.tsx:138`, `video-editor-page.tsx`                       |

## Record (screen recording)

**Flow.** The tray toggles the Capture Panel; its Start button or the global shortcut calls
`triggerStartRecording` (`main/index.ts`), which sends `recording:request-start` to the main
renderer. `recorder-store.ts` runs the 3-2-1 countdown, then `beginEngine` → `recording:start`;
`recording-hub.ts` hides the main window and shows the control bar. The engine
(`recorder-engine.ts`) opens the desktop stream with `getUserMedia`, mixes mic + system audio with
`GainNode`s, optionally passes video through the canvas compositor (downscale / watermark), and
encodes H.264 + AAC to MP4 with **mediabunny** (WebCodecs — there is no `MediaRecorder`). Every
muxed chunk goes to main as `recording:write`, where `RecordingWriter` does positional writes to a
`.part` file. In parallel main samples the cursor every 8 ms and uiohook-napi records clicks. Stop
finalizes mediabunny, `recording:finalize` renames the `.part` into the vault and writes the cursor
track sidecar, then `app-root.tsx` navigates to `/library/<assetId>`. The camera bubble is a
separate always-on-top window that the screen capture picks up.

| File (under `apps/kaipu-record/src/`)                                                                     | Process  | Responsibility                                                                        | Lines      |
| --------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- | ---------- |
| `main/tray.ts`                                                                                            | main     | Tray, toggles the Capture Panel                                                       | 90         |
| `main/capture-panel-window.ts`                                                                            | main     | Tray-anchored panel window                                                            | 160        |
| `main/index.ts`                                                                                           | main     | Bootstrap, `triggerStartRecording`, shortcut wiring, close/quit guards                | 680        |
| `main/recording-sources.ts`                                                                               | main     | `desktopCapturer` sources + thumbnails                                                | 46         |
| `main/permissions.ts`                                                                                     | main     | Screen/camera/mic/Accessibility status and requests                                   | 158        |
| `preload/index.ts`                                                                                        | preload  | `window.electronAPI` bridge                                                           | 190        |
| `shared/types/ipc.ts`                                                                                     | shared   | `IPC_CHANNELS`, settings, tick, activity types                                        | 518        |
| `shared/recording-quality.ts`                                                                             | shared   | Quality preset → engine params                                                        | 239        |
| `renderer/src/features/capture-panel/capture-panel.tsx`                                                   | renderer | Panel UI                                                                              | 156        |
| `renderer/src/features/recording/hooks/use-recording-setup.ts`                                            | renderer | Composes sources, mic, toggles, quality into `StartInput`                             | 186        |
| `renderer/src/features/recording/components/screen-source-selector.tsx`                                   | renderer | Source picker                                                                         | 134        |
| `renderer/src/pages/record/record-page.tsx`                                                               | renderer | Record page                                                                           | 201        |
| `renderer/src/features/recording/recorder-store.ts`                                                       | renderer | State machine: countdown, start, ticks, pause/resume, stop/finalize                   | 391        |
| `renderer/src/features/recording/recorder-engine.ts`                                                      | renderer | getUserMedia, audio mix, mediabunny encoder, thumbnail                                | 386        |
| `renderer/src/features/recording/recording-compositor.ts`                                                 | renderer | rAF canvas loop for downscale + watermark                                             | 139        |
| `renderer/src/features/recording/cursor-track-session.ts` (+ `first-media-timestamp.ts`, `clock-sync.ts`) | renderer | Anchor cursor clock to video time 0                                                   | 84         |
| `main/recording/recording-hub.ts`                                                                         | main     | Coordinator: settings, activity, writer IPC, windows, tick relay, cursor/click wiring | 343        |
| `main/recording/recording-writer.ts`                                                                      | main     | `.part` positional writer, finalize, abort                                            | 165        |
| `main/recording/control-bar-window.ts`                                                                    | main     | Always-on-top control bar window                                                      | 123        |
| `main/recording/camera-bubble-window.ts`                                                                  | main     | Camera bubble window                                                                  | 103        |
| `main/recording/cursor-tracker.ts` (+ buffer, clock, display, build)                                      | main     | 8 ms cursor sampler, track build                                                      | 186 (+229) |
| `main/recording/click-hook.ts`                                                                            | main     | uiohook-napi `mousedown` hook                                                         | 98         |
| `shared/cursor-track.ts`, `shared/cursor-track-report.ts`                                                 | shared   | Track schema, serialize, report                                                       | 164, 222   |
| `renderer/src/shell/app-root.tsx`                                                                         | renderer | Recording-complete → library navigation                                               | 94         |

**Hot paths (while recording).**

- `recording-compositor.ts:76-100` — `draw()` on every `requestAnimationFrame` (only when downscale or watermark is needed; see [recording-compositor-perf](/backlog/recording-compositor-perf/)).
- `recorder-engine.ts:236` — every muxed chunk is copied (`chunk.data.slice()`) and sent over IPC; `recording-hub.ts:179-196` writes it.
- `recorder-store.ts:224` — 100 ms interval: tick IPC + `readLevels()` (analyser); main relays to the control bar, which re-renders per tick (`control-bar-window.tsx:17`).
- `cursor-tracker.ts:58` / `recording-hub.ts:85` — 8 ms interval in **main**: `screen.getCursorScreenPoint()` + buffer push.
- `click-hook.ts:69` — native `mousedown` listener for the whole take.

**Untested:** `recording-sources.ts`, `tray.ts`, `global-shortcuts.ts`, `control-bar-window.ts`,
`camera-bubble-window.ts`. The e2e suite runs with `KAIPU_DISABLE_SCREEN_CAPTURE=1` and never
actually records.

## Screenshot (capture + image editor)

**Flow.** The global shortcut (default ⌘⌃X), the capture panel's Capture tab or the `/screenshots` page
reach `triggerCaptureScreenshot()` (`main/index.ts:301`), which broadcasts `screenshot:hotkey`.
`shell/app-root.tsx` runs `useScreenshotCapture().capture()`, which refuses while a recording is
active and invokes `screenshot:capture`. Main hides the app windows, runs `screencapture -i -o`
(macOS only — region/window/fullscreen selection is the native overlay), reads and deletes the temp
PNG, and returns the bytes. The renderer navigates to `/editor/capture` with an in-memory blob
source. Paste (⌘V on `/editor`, `/editor/new`) decodes the clipboard image in the renderer and
falls back to `clipboard:read-image`. The editor composites scene → SVG → canvas → PNG/PDF for
Copy (`screenshot:copy`), Save (`screenshot:save` → vault) and Export (`screenshot:export-file`).
A fresh capture auto-saves/auto-copies per settings (`auto-capture-policy.ts`).

| File (under `apps/kaipu-record/src/`)                                | Process  | Responsibility                                                                 | Lines |
| -------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ | ----- |
| `main/shortcuts/global-shortcuts.ts`                                 | main     | Registers rebindable global accelerators                                       | 65    |
| `main/index.ts`                                                      | main     | `triggerCaptureScreenshot`, window hide/restore hooks, shortcut suspend/resume | 680   |
| `main/tray.ts`                                                       | main     | Tray icon + mode; click toggles the capture panel                              | 90    |
| `main/capture-panel-window.ts`                                       | main     | Capture panel window, `capture-panel:resize`                                   | 160   |
| `main/screenshots/screenshot-capture.ts`                             | main     | `screencapture -i -o` to a temp PNG                                            | 54    |
| `main/screenshots/screenshot-ipc.ts`                                 | main     | capture, copy, clipboard read/peek, read-bytes, save, export-file handlers     | 148   |
| `main/screenshots/export-file-name.ts`                               | main     | Export name sanitising, extension allowlist, 256 MB cap                        | 43    |
| `main/library/library-vault.ts`                                      | main     | `writeImage`, `writeMeta`                                                      | 431   |
| `renderer/src/features/capture-panel/capture-panel.tsx`              | renderer | Record/Capture tabs, ResizeObserver → resize IPC                               | 156   |
| `renderer/src/features/screenshots/use-screenshot-capture.ts`        | renderer | Recording guard, capture, navigate, reveal                                     | 38    |
| `renderer/src/features/editor/open-in-editor.ts`                     | renderer | Editor routing, `openCapture`                                                  | 91    |
| `renderer/src/features/editor/use-paste-to-editor.ts`                | renderer | ⌘V listener + main-process fallback                                            | 85    |
| `renderer/src/features/editor/paste-image.ts`                        | renderer | Paste decode to PNG                                                            | 60    |
| `renderer/src/pages/editor/editor-home-page.tsx`                     | renderer | Editor home: Continue list, paste, clipboard peek on focus                     | 338   |
| `renderer/src/pages/editor/editor-routes.tsx`                        | renderer | Image editor route, mark-opened                                                | 106   |
| `renderer/src/features/screenshots/image-source/*`                   | renderer | blob/local/cloud source → display URL + cached bytes                           | ~175  |
| `renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx`    | renderer | Editor shell: dirty guard, zoom, copy/save/export, auto actions                | 545   |
| `renderer/src/features/screenshots/annotations/use-editor-scene.ts`  | renderer | Scene state, undo/redo                                                         | 162   |
| `renderer/src/features/screenshots/annotations/annotation-layer.tsx` | renderer | Pointer drawing, move, resize, text                                            | 712   |
| `renderer/src/features/screenshots/annotations/compositor.ts`        | renderer | Scene → SVG → canvas → PNG (8192 px cap)                                       | 310   |
| `renderer/src/features/screenshots/beautify/*`                       | renderer | Frame, background, padding, crop overlay                                       | ~630  |
| `renderer/src/features/screenshots/export/*`                         | renderer | PNG / PDF (3× raster, pdf-lib) exporters                                       | ~100  |

**Hot paths.** `annotation-layer.tsx:217` `onPointerMove` calls `setScene`/`setDraft` on every move
(re-renders the editor) and `getBoundingClientRect` per event (`:148`); same pattern in
`crop-overlay.tsx:109`. ResizeObservers at `annotation-layer.tsx:86`, `crop-overlay.tsx:54`,
`beautified-frame.tsx:58`, `capture-panel.tsx:49` (an IPC per resize). Non-passive `wheel` zoom at
`screenshot-editor-page.tsx:183`. Window `focus` refreshes at `use-recent-screenshots.ts:18` and
`editor-home-page.tsx:162`. Compositing runs on every Copy/Save/Export and for auto actions.

**Untested:** `screenshot-ipc.ts`, `screenshot-editor-page.tsx`, `paste-image.ts`,
`use-paste-to-editor.ts`, `use-screenshot-capture.ts`.

## Library

**Flow.** The vault is a folder: `<vaultDir>/<id>.{mp4,webm,png,gif}` plus `.kaipu/<id>.json`
(sidecar: title, assetId, hash cache, tagIds, edit stamps), `.kaipu/<id>.jpg` (poster),
`.kaipu/tags.json` and `.kaipu/<id>.edit.json` (edit sessions). `useLocalLibrary` invokes
`library:list-items`; `LibraryService.list()` scans the vault (`readdir` + `describe()` per file),
reads the per-account cloud `catalog.json`, probes edit state per item, merges local and cloud by
`assetId` (`compose-library.ts`) and sorts. On mount the renderer also fires
`library:refresh-cloud-catalog` (HTTP, paged at 100), which broadcasts `library:changed` and makes
every window re-list. Filter, search and sort run in the renderer over the whole array. Posters and
media are served by the `kaipu-media://` protocol with Range support. Tags, rename, delete,
remove-local-copy (sha256 + policy) and drag-out (hard link into a temp folder) are IPC calls; most
writes broadcast `library:changed`. There is no pagination or virtualization in the Library page.

| File (under `apps/kaipu-record/src/`)                                                        | Process  | Responsibility                                                     | Lines      |
| -------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ | ---------- |
| `shared/types/library-item.ts`, `library-storage.ts`                                         | shared   | `LibraryItem`, `LocalRecording`, cloud entry types                 | 140, 62    |
| `main/library/vault-location.ts`                                                             | main     | Vault dir from `preferences.json` (**sync read per call**)         | 62         |
| `main/library/library-vault.ts`                                                              | main     | Disk vault: list, describe, sidecar, identity, hash, thumb, remove | 431        |
| `main/library/content-hash.ts`                                                               | main     | Streaming sha256                                                   | 17         |
| `main/library/tag-repository.ts`                                                             | main     | `tags.json` registry + per-item tagIds                             | 266        |
| `main/library/edit-project-probe.ts`                                                         | main     | Per-item edit-state probe (stat/access/JSON)                       | 103        |
| `main/library/compose-library.ts`                                                            | main     | Pure local + cloud merge                                           | 104        |
| `main/library/library-service.ts`                                                            | main     | `list()`, `refreshCatalog()`, `removeLocalCopy()`                  | 130        |
| `main/library/remove-local-copy-policy.ts`                                                   | main     | "Safe to remove local copy" rule                                   | 28         |
| `main/library/index.ts`                                                                      | main     | All library IPC handlers, broadcast, drag, vault-dir dialogs       | 242        |
| `main/library/gif-save.ts`, `drag-copies.ts`, `drag-name.ts`                                 | main     | GIF save, drag temp copies, drag name                              | 67, 32, 20 |
| `main/media-protocol.ts`, `main/media-range.ts`                                              | main     | `kaipu-media://` streaming + Range parsing                         | 108, 47    |
| `main/cloud/catalog-client.ts`, `catalog-cache.ts`                                           | main     | Paged cloud catalog fetch, per-account cache                       | 92, 73     |
| `main/cloud/storage-client.ts`, `storage-usage-service.ts`                                   | main     | Storage usage                                                      | 58, 42     |
| `renderer/src/features/library/hooks/use-local-library.ts`                                   | renderer | List/refresh/rename/remove/tags; mount refresh; `library:changed`  | 149        |
| `renderer/src/features/library/hooks/use-tags.ts`                                            | renderer | Tag registry (re-lists on `library:changed`)                       | 92         |
| `renderer/src/features/library/hooks/use-library-filters.ts`, `library-filters.ts`           | renderer | Filter/sort/search + facet counts                                  | 111, 137   |
| `renderer/src/features/library/lineage.ts`, `map-item.ts`                                    | renderer | Source/export lineage, view-model mapping                          | 59, 29     |
| `renderer/src/pages/library/library-page.tsx`                                                | renderer | Library page (grid/list, tag drawer, delete)                       | 399        |
| `renderer/src/features/library/components/video-card.tsx`, `video-row.tsx`                   | renderer | Per-item card / row                                                | 132, 121   |
| `renderer/src/features/library/components/tag-panel.tsx`, `tag-editor.tsx`                   | renderer | Tag drawer + editor                                                | 398, 136   |
| `renderer/src/pages/library-detail/library-detail-page.tsx`                                  | renderer | Item detail, remove-local-copy UI                                  | 493        |
| `renderer/src/features/library/hooks/use-orphan-heal.ts` (+ `media/heal-orphan-metadata.ts`) | renderer | Decode duration/poster for orphans, backfill                       | 94, 30     |
| `renderer/src/lib/generate-thumbnail.ts`                                                     | renderer | JPEG poster from video                                             | 42         |
| `renderer/src/features/storage-cloud/*`                                                      | renderer | Cloud capacity UI                                                  | ~760       |

**Hot paths.**

- Every `library:list-items`: `library-vault.ts:114-128` scans the whole vault; per item `describe()` (`:130-175`) probes up to 4 extensions **sequentially** with `access`, `stat`s, reads + parses the sidecar, checks the thumbnail. `library-service.ts:52-55` then probes edit state in a **serial** `for` loop. `:58` `JSON.stringify`s two catalogs to compare.
- `tags:list` (`tag-repository.ts:148-150`) runs another full `vault.list()` just to count usage. Every tag write broadcasts, so each window runs `library:list-items` **and** `tags:list` — two full scans per window per change.
- `vaultDirectory()` does `readFileSync` + `JSON.parse` of `preferences.json` on every IPC handler and every `kaipu-media://` request; each media request also probes extensions + `stat`s.
- Renderer: `library-page.tsx:329`/`:350` render every item (no windowing); every poster is fetched and decoded; `VideoCard`/`VideoRow` are not memoized and get inline callbacks; filters + facet counts recompute per search keystroke (`use-library-filters.ts:73,76`).
- `use-orphan-heal.ts:64-93` fetches whole recordings as blobs to decode duration/poster for orphans.
- The Library page, Editor home and detail page each mount their own `useLocalLibrary` → their own list + cloud refresh.

**Untested:** `main/media-protocol.ts`, `main/library/index.ts` (IPC handlers), `drag-copies.ts`,
`pages/library/library-page.tsx`.

## Edit video

**Flow.** Editor home (`editor-home-page.tsx`) lists Continue items over `useLocalLibrary`; opening
one routes to `/editor/video/:assetId` (`editor-routes.tsx`), which stamps `editorOpenedAt` and
renders `VideoEditorLoader` (`video-editor-page.tsx`). The loader reads the cursor track and the
saved edit session over IPC; with no session it seeds auto-zooms from clicks (`detect-zoom-segments.ts`).
`useVideoScene` owns the scene (timeline, trims/cuts, zooms, mute, redactions, overlays, annotations)
with undo/redo. Preview is a plain `<video>` with a CSS camera transform and DOM overlays driven per
frame by `requestVideoFrameCallback`. Autosave debounces 800 ms → `videoEdit:save-session`. MP4
export (`export-runner.ts`, module-level) spawns `export-worker.ts`: mediabunny decodes, `compose-*`
composites redactions/overlays/crop/framing on `OffscreenCanvas`, mediabunny encodes (WebCodecs);
chunks go back over `recording:write` to the same writer the recorder uses. GIF export uses
`gif-worker.ts` + gifenc and `library:gif-save`. Editing and rendering live entirely in the app — no
ffmpeg, nothing from `packages/`.

| File (under `apps/kaipu-record/src/`)                                                                        | Process           | Responsibility                                                                | Lines         |
| ------------------------------------------------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------- | ------------- |
| `renderer/src/pages/editor/editor-home-page.tsx`, `editor-continue.ts`                                       | renderer          | Editor home, Continue list                                                    | 338, 88       |
| `renderer/src/pages/editor/editor-routes.tsx`                                                                | renderer          | Video/image editor routes, mark-opened                                        | 106           |
| `renderer/src/pages/video-editor/video-editor-page.tsx`                                                      | renderer          | Loader + editor orchestration + export wiring (**1545 lines, 18 hooks**)      | 1545          |
| `renderer/src/features/video-editor/session.ts`                                                              | renderer          | Session (de)serialization                                                     | 367           |
| `renderer/src/features/video-editor/scene.ts`, `use-video-scene.ts`                                          | renderer          | Scene model; state + undo/redo + live interaction                             | 130, 120      |
| `renderer/src/features/video-editor/use-session-autosave.ts`                                                 | renderer          | 800 ms debounced autosave                                                     | 138           |
| `renderer/src/features/video-editor/timeline.ts`, `source-time.ts`                                           | renderer          | Timeline layout, source ↔ timeline time                                       | 167, 117      |
| `renderer/src/features/video-editor/components/timeline-strip.tsx` (+ lanes)                                 | renderer          | Timeline UI, scrub, trim/cut drags; zoom/audio/privacy/overlay/activity lanes | 406 (+687)    |
| `renderer/src/features/video-editor/zoom/detect-zoom-segments.ts`                                            | renderer          | Auto-zoom from clicks + cursor                                                | 288           |
| `renderer/src/features/video-editor/zoom/camera-path.ts`, `use-camera-path.ts`, `use-camera-preview.ts`      | renderer + worker | Spring camera path, rebuild, per-frame CSS transform                          | 218, 64, 29   |
| `renderer/src/features/video-editor/use-preview-playback.ts`                                                 | renderer          | Playback engine: rAF playhead, cuts, slides, mute                             | 403           |
| `renderer/src/features/video-editor/use-video-frame-clock.ts`                                                | renderer          | `requestVideoFrameCallback` clock                                             | 59            |
| `renderer/src/features/video-editor/components/redaction-layer.tsx`, `camera-box.tsx`                        | renderer          | Per-frame redaction overlay (pixelate canvas), zoom box                       | 165, 145      |
| `renderer/src/features/video-editor/annotations/video-annotation-layer.tsx`                                  | renderer          | Annotation overlay editing                                                    | 560           |
| `renderer/src/features/video-editor/components/export-sheet.tsx`                                             | renderer          | Export UI: presets, MP4/GIF, size meter                                       | 680           |
| `renderer/src/features/video-editor/export/export-presets.ts`, `export-plan.ts`                              | renderer          | Presets/bitrates; scene → render segments                                     | 508, 215      |
| `renderer/src/features/video-editor/export/export-runner.ts`                                                 | renderer          | Module-level export orchestrator, worker host, IPC writer                     | 493           |
| `renderer/src/features/video-editor/export/export-worker.ts`                                                 | worker            | Decode, compose, encode MP4 + audio, poster                                   | 586           |
| `renderer/src/features/video-editor/export/compose-frame.ts`, `compose-output-frame.ts`, `overlay-raster.ts` | worker            | Per-frame compositing                                                         | 247, 216, 143 |
| `renderer/src/features/video-editor/export/use-gif-export.ts`, `gif-worker.ts`, `gif-encode.ts`              | renderer + worker | GIF export                                                                    | 313, 223, 302 |
| `main/library/video-edit-session.ts`                                                                         | main              | Session + assets save/load/delete                                             | 236           |
| `main/library/edit-project-probe.ts`, `gif-save.ts`                                                          | main              | Editing state probe, GIF save                                                 | 103, 67       |
| `main/index.ts`                                                                                              | main              | `export:active` close/quit guard, cancel                                      | 680           |

**Hot paths.**

- Preview per frame: `use-preview-playback.ts:176-198` rAF tick (time mapping, mute, listener fan-out); `use-video-frame-clock.ts:36-47` drives `use-camera-preview.ts` (`cameraAt` + `style.transform`), `redaction-layer.tsx:138-152` (`querySelector` per redaction per frame + `drawPixelated`) and `camera-box.tsx:70-76`.
- `use-preview-playback.ts:204-212` — 250 ms `setInterval` doing a React state update while a slide plays.
- `use-camera-path.ts:34-56` — effect with no dependency array (runs every render, rebuilds the spring path in rAF when inputs change).
- `video-editor-page.tsx` — any scene change re-renders the 1545-line page.
- Drags (`timeline-strip.tsx:127,146,294-335` and every lane) go through `updateLive`; autosave waits for the drag to end.
- Export worker per frame: `export-worker.ts:299-326` (compose, `videoSource.add`, progress at ~4 Hz); each `chunk` message becomes an IPC send in `export-runner.ts:373-381`.
- GIF worker per frame: `gif-worker.ts:129,194`, `gif-encode.ts:203,242-251`.
- Timeline thumbnails decode with mediabunny (`use-source-thumbnails.ts`).

Tests are broad here (scene, session, zoom, privacy, export, most components). The page itself has
one test file (`video-editor-page.test.tsx`).
