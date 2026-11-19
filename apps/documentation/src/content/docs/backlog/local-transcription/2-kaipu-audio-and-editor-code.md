---
title: "Local transcription research 2: Kaipu audio and editor code"
description: "Written by Claude Sonnet, reading the Kaipu audio and editor code for transcription hook points."
sidebar:
  order: 2
---

> Evidence, kept verbatim (2026-11-15, design of [NIW2-818](https://linear.app/niway/issue/NIW2-818/local-transcription-with-parakeet-transcript-panel-and-subtitle-export)). The [spec](/specs/2026-11-15-local-transcription-design/) wins where they disagree.

## Brief

Read-only code investigation. Do not edit, commit, install or run the app. Repo: `~/Documents/Workspace/Personal/kaipu-record-monorepo`, desktop app in `apps/kaipu-record/` (Electron). Use `git grep` and ranged reads.

## Report

Transcription would plug in at six points: the mono 48 kHz AAC track in each recording's MP4, a new `.kaipu/<id>` companion file, the editor's right column, the Web Worker export, a `kaipu-text-recognition`-style helper in main, and a feature flag. Paths below are relative to `apps/kaipu-record/` unless stated.

**Branch caveat.** HEAD (`feature/niw2-782…`) and `origin/main` (e025db93) have diverged: 130 commits on HEAD that main lacks, 124 on main that HEAD lacks.

- HEAD has the joined-recordings model (`source-axis.ts`, ADR 0058). Main has no `source-axis.ts`.
- Main has the audio waveform (NIW2-775). HEAD has no `audio-peaks.ts` or `use-audio-peaks.ts`.
- I cite waveform lines as `origin/main:`. The two will need reconciling.

## 1. Audio capture and what lands on disk

**Capture happens in the renderer, never in a native helper.**

- The Swift helper `native/encoded-capture/main.swift` sets `capturesAudio = false` (`:362`, `:402`). Its header says "audio remains in Chromium" (`:1`).
- System audio comes from `getUserMedia({audio:{mandatory:{chromeMediaSource:"desktop"}}})` (`src/renderer/src/features/recording/recorder-engine.ts:371`), alongside the screen call. If it fails, the take records without system audio (`:375-377`).
- The mic goes through `openMicrophone(...)` (`:384`).
- Both feed one `AudioContext` (`:527`), and mic and system audio are mixed into one `MediaStreamAudioDestinationNode` (`:528`, `:684`).

**There is a single mixed audio track.** The mix is built as follows:

- The graph is `mic: source → level → mute → destination` and `system: source → volume → duck → mute → destination` (`:515-519`).
- Mute is gain 0, so the file keeps one continuous track (`:520-521`).
- Mic level, system volume and ducking are therefore baked into the file.
- The sidecar does not record whether the mic or system audio was on (`RecordingCapture` has only mode, size and ratio, `src/shared/recording-capture.ts:27-38`).

**Encoding.**

- Audio is AAC at 128 kbps (`AUDIO_BITRATE_BPS`, `src/shared/recording-quality.ts:85`), via `MediaStreamAudioTrackSource` with `codec: "aac"` (`recorder-engine.ts:776-778`).
- The MP4 is written by mediabunny with `fastStart: false` (`:725`).
- The code never sets sample rate or channel count. They are the Web Audio defaults, which I assume are the device rate and stereo. I did not probe a real file.
- The webcam file has no audio track (`:784`).
- Imports can bring in `.mp4`, `.mov`, `.m4v` and `.webm` with other codecs (`src/shared/import-video.ts:11`). The transcriber cannot assume AAC.

**Time base.** mediabunny's default `synced-zero` stamps samples relative to the first accepted video or audio sample (`first-media-timestamp.ts:1-9`). Audio and video share one clock, so audio-track time equals source time.

**Folder layout** (`src/main/library/library-vault.ts`):

- The vault is flat: `<id>.mp4` sits in the vault folder. The default is Videos + "Kaipu Record" (`src/main/library/vault-location.ts:7,49-54`).
- Companions live in `.kaipu/` (`META_DIR`, `:46`; `companionPaths`, `:452-464`):
  - `<id>.json` sidecar
  - `.jpg` thumbnail
  - `.cursor.json`
  - `.webcam.mp4`
  - `.edit.json` (edit session)
  - `.edit.meta.json`
  - `.canvas.json`
  - `.assets/`
  - `.text.json` (the image editor's recognized-text cache)
- The in-flight file is `<…>.mp4.part` in the staging folder `.kaipu/tmp` (`src/main/recording/recording-writer.ts:27,156`).

**Sidecar schema.**

- The `Sidecar` interface (`library-vault.ts:60`) has `sidecarVersion?: 1 | 2`, with every field optional.
- Validation is shallow (`isSidecarShape`, `:171`).
- The edit session has its own `version: 1 | 2` (`src/renderer/src/features/video-editor/session.ts:66`). Version 2 means the scene has joined `sources` (`:28-31`, `:81-87`). An unknown version makes `parseSession` return null (`:110-111`).

## 2. Editor data model

**Scene** (`src/renderer/src/features/video-editor/scene.ts`):

- `items: TrackItem[]` is the main track. A `ClipItem` has `sourceStart` and `sourceEnd` in source seconds (`:16-23`). A `SlideItem` has a duration (`:25-34`).
- A cut, trim or split is just clips covering part of the source. Uncovered footage is deleted footage (`:142`).
- **There is no per-clip speed.** Speed is preview-only view state and never reaches the plan or export (`playback-speed.ts:1-5`).
- `mutedRanges` and `audioMuted` are source-anchored (`scene.ts:150-155`, `audio-edits.ts:1-38`).
- `sources?: SceneSource[]` holds the joined recordings (`scene.ts:~140-175`).

**Multiple recordings share one source axis** (`source-axis.ts`).

- The opened recording sits at [0, duration]. Each joined one sits at a fixed `offset` (`sourceAxis`, `:34`).
- Offsets come from `nextOffset` (`:108`): the next 3600 s multiple after the end plus a 60 s gap.
- `recordingAt(axis, t)` (`:45`) returns `{recording, localTime}`. `resolveAt(layout, axis, t)` (`:61`) goes from timeline time to recording and local second.
- **Per-file word times need `axisTime = recording.offset + local`.**
- NIW2-782 is at `add-from-library.ts` (the joinable-recordings filter), `compose-join.ts` and `joinRecording` (`source-axis.ts:126`). A join is one undo step.

**Source ↔ timeline mapping lives in two modules.**

- `timeline.ts`: `toLayout` (`:26`), `timelineToSource` (`:62`), `sourceToTimeline` (`:84`).
- `source-time.ts`:
  - `sourceRangeToTimelineBlocks` (`:23`): one range becomes 0..n visible pieces.
  - `sourceTimeAtTimeline` (`:53`): returns null over slides.
  - `timelineTimeAtSource` (`:71`): returns null for cut footage, and the first piece wins on a reorder.
- `source-time.ts:3` says never to re-derive the mapping elsewhere.

**Where word timestamps map.**

- Word (local seconds) → `+ offset` → axis seconds → `timelineTimeAtSource` for a seek, or `sourceRangeToTimelineBlocks` for a span.
- `seekToCapture` already does this (`src/renderer/src/pages/video-editor/video-editor-page.tsx:1592-1608`).
- The reverse, for highlighting the current word, is `timelineTime` → `sourceTimeAtTimeline` → `recordingAt` → local time.

**Waveform** (on `origin/main`, primary recording only).

- `use-audio-peaks.ts:60-140` decodes with mediabunny `AudioSampleSink` over `openRecordingInput(url)`.
- `openRecordingInput` (`src/renderer/src/lib/open-recording-input.ts`) does Range requests against `kaipu-media://`.
- It runs in the renderer, in 8 ms slices, with an 8-entry LRU, and its page call passes only `sourceUrl, source.durationSeconds` (`video-editor-page.tsx:633`).
- This is the existing proof that PCM can be decoded from the vault MP4 without ffmpeg.

## 3. Editor layout, playhead and seeking

**Right column.**

- `.side` is a fixed 288 px (`video-editor-page.module.css:104-112`).
- The page renders exactly one of `CapturesPanel`, `AddFromLibraryPanel` or `EditorInspector` (`video-editor-page.tsx:2534-2699`).
- Exclusivity is hand-kept: `cursorInspectorOpen`, `capturesOpen` and `addRecordingOpen` are separate booleans (`:690-703`). Each opener clears the others plus the selection (`:1493-1497`, `:1542-1551`, `:1560-1566`).
- A transcript panel would be a fourth boolean unless these become one `sidePanel` union.
- Panel buttons live in `editor-toolbar.tsx` (`onToggleCaptures`, `:331`, `:602-611`) and `transport-bar.tsx:70,231`.

**Adding a panel.**

1. Add a component like `CapturesPanel` (`components/captures-panel.tsx`), with `uiArea("editorVideo.<area>")` on its root.
2. Add the area and states to `src/shared/ui-map.ts` under `editorVideo` (`:242-300`). Use `gatedBy:[{flag}]` as `addFromLibrary` does (`:264`).
3. Add catalog states in `ui-catalog/catalog/editor-video.ts`. See the `add-from-library` entries (`:597-640`) with `profile`, `steps`, `demonstrates`, `ready` and `gates`.
4. Add a profile that forces the flag on in `ui-catalog/profiles.ts` (the `timeline-levels` one is at `:96-100`).
5. `ui-catalog/coverage.test.ts` fails until every map state is demonstrated or declared (`ui-catalog/catalog/README.md`, rule 2).

**Playhead** (`PreviewPlayback`, `use-preview-playback.ts:14-53`):

- `timelineTime` is state. It follows `timeupdate` a few times a second while playing, so it lags the frame.
- `readTimelineTime()` (`:28-33`, impl `:613-627`) is the exact clock.
- `subscribeTime(listener)` (`:52`) is rAF-rate and bypasses React renders. Use it for per-word highlighting.
- `seek(t)` (`:42`, impl `:419`) takes timeline seconds.

## 4. Background jobs

**Export is not in main and not ffmpeg.**

- It runs in a renderer Web Worker (`new Worker(new URL("./export-worker.ts"…))`, `export/export-runner.ts:562`) using mediabunny, WebCodecs and OffscreenCanvas (`export-worker.ts:1-60`).
- No ffmpeg exists in `package.json`. The only mention is a comment in `export-presets.ts:102`.
- Progress is a `progress` worker message throttled to about 4 Hz (`export-messages.ts:~80`, `export-runner.ts:576`).
- Cancellation is `worker.terminate()`, with no cancel message (`export-messages.ts:1-6`, `export-runner.ts:241,251`).
- The result streams as `chunk` messages to a vault writer session over IPC, the same create/write/finalize/abort contract the recorder uses (`export-runner.ts:296-300`).
- One export runs at a time (`:309`).

**Main spawns only one-shot helpers.**

- `main/` has no `utilityProcess`, `worker_threads` or `fork`.
- `runHelperProcess` (`src/main/screenshots/text-recognition/helper-process.ts:25-101`) spawns, writes stdin, caps stdout at 16 MB, and SIGKILLs on timeout. It has no progress or streaming.
- The capture helper is a long-lived child with framed stdout (`src/main/recording/native/session.ts`).

**Native helper pattern, to copy for a sidecar binary.**

- Path lookup tries the dev tree `resources/native/<name>`, then `app.asar.unpacked/resources/native` (`src/main/screenshots/text-recognition/index.ts:11-18`, `session.ts:14-23`). `asarUnpack: resources/**` (`electron-builder.yml:20-22`).
- Version handshake: `--version` must print an exact string (`macos-vision.ts:8,64-80`; `session.ts:25-34`). A mismatch makes the feature "unavailable".
- The Swift source is `native/text-recognition/main.swift`. The build script `scripts/build-text-recognition.sh` builds a universal arm64+x86_64 binary with `lipo`, and only warns on failure. Its output is gitignored (`resources/native/.gitignore`).
- The release workflow fails if either helper binary is missing or lacks an architecture (`.github/workflows/release-desktop.yml:193-208`).
- A cache keyed by sha256 plus a generation counter already exists: `main/screenshots/screenshot-text.ts` (`readTextCache` `:67-95`, generations `:49-62`, atomic write `:97-109`, `schemaVersion: 1`). It is the template for a transcript cache.

**Main→renderer progress and cancel** have a precedent: `onReconcileProgress` with an unsubscribe return (`src/preload/index.ts:239-244`) and `reconcileCancel` (`:238`).

**No downloaded-asset mechanism exists.**

- `src/main/` has no outbound `fetch` or `net` use. Its only `fetch` mention is a comment in `media-protocol.ts:55`.
- The only downloader is `electron-updater` (`auto-updater.ts`).
- The only sha256 helper is `sha256FileBase64` (`src/main/library/content-hash.ts:9`), used for the content-hash cache.
- Model download, checksum and versioning would be new.

## 5. Subtitles on export

**There is no subtitle support today.** Text overlays exist, but they are timeline-anchored annotations:

- They are rasterized to full-frame bitmaps in the renderer (`overlay-raster.ts:1-40`, called at `export-runner.ts:514`).
- They are sent to the worker with their windows (`export-messages.ts`) and stamped from `plan.overlayWindows` (`export-plan.ts:37-49`, `export-worker.ts:349-352`).
- There is no per-frame text drawing and no subtitle track.

**Burned-in captions.**

- Options: rasterize one bitmap per cue and reuse the overlay-window path, or draw text with `OffscreenCanvas.fillText` in the worker's composer (`compose-output-frame.ts`, which `export-worker.ts:342-352` calls per frame).
- Cue times must be on timeline time. Compute them in the renderer from word times through the layout, and put them in `ExportPlan` (`export-plan.ts:44`). The plan already carries layout-derived windows, and the worker has no layout.

**Soft subtitles.**

- The installed mediabunny is 1.61.4 (`node_modules/mediabunny/package.json`).
- `Mp4OutputFormat` accepts subtitle tracks, up to 127 (`node_modules/mediabunny/dist/modules/src/output-format.js:128-160,284-292`).
- The only subtitle codec is `["webvtt"]` (`dist/mediabunny.d.ts:4510`). The ISO muxer writes it as `wvtt` (`isobmff/isobmff-muxer.js:193-196`) via `output.addSubtitleTrack(new TextSubtitleSource("webvtt"))` (`dist/mediabunny.d.ts:3728,4595`).
- So `mov_text` (tx3g) is not available. The export uses mediabunny only.
- `MovOutputFormat` supports no subtitle codecs (`output-format.js:210`).

## 6. Flags, i18n, IPC

**Flags.**

- Add a name to `FLAG_NAMES` and a default to `FLAG_DEFAULTS` in `src/shared/analytics.ts:13-47`. It must match the PostHog dashboard name (`:12`). Unresolved flags fall back to the default (`:24-27`).
- Read it with `useFlag("name")` (`src/renderer/src/features/analytics/use-flag.ts:10`). `timeline-levels` is the example (`video-editor-page.tsx:697-701`).
- A dev override is `KAIPU_FLAG_OVERRIDES` (`src/main/flag-overrides.ts`).
- A flag-gated area is declared with `gatedBy` in `ui-map.ts`, and the catalog must shoot both sides.

**i18n.**

- Catalogs are `packages/i18n/messages/{en,es}.json`. The editor namespace is `videoEditor` (`en.json:1457`).
- The locales are `["es","en"]` (`packages/i18n/src/config.ts:1`).
- `src/__tests__/parity.test.ts` fails if a key exists in one file and not the other.
- Renderer: `useTranslations("videoEditor")`. Main: `createMainTranslator(locale)` (`src/main/index.ts:390`).

**IPC contract.** A new call needs five edits:

- a channel string in `IPC_CHANNELS` (`src/shared/types/ipc.ts:354`)
- the method on `KaipuElectronAPI` (`src/shared/types/electron-api.ts`, e.g. `:749`)
- the preload binding via `scopedInvoke` (`src/preload/index.ts:82-93,459`)
- a main handler (e.g. `src/main/screenshots/screenshot-ipc.ts:356`)
- the types in `src/shared/types/`

`scopedInvoke` stamps the workspace and throws `STALE_WORKSPACE` on a mid-call switch (`:82-93`). Transcript writes need that guard.

**Shared restriction.**

- The preload and `src/shared/**` take no value imports from `@kaipu/*` (`electron.vite.config.ts:28-36`). `src/shared/ui-map.ts:15-18` and `import-video.ts:3-5` repeat the rule, and `ui-map.test.ts` pins it.
- Aliased `@shared` files are bundled and are fine.
- Types and schemas that need `zod` or `@kaipu/domain` belong in main or the renderer. See how `recognizedWordsSchema` comes from `@kaipu/domain/schemas` in main only (`screenshot-text.ts:4-7`).

## 7. Native-dependency rules

**`uiohook-napi` patch story.**

- It is patched, with the patch declared in the root `package.json:79` (`patches/uiohook-napi@1.5.5.patch`). The patch changes the C sources only.
- `electron-builder.yml:56` sets `npmRebuild: false`. `scripts/rebuild-native.sh` runs `electron-builder install-app-deps` explicitly, and every packaging path calls it. It stamps Electron version plus patch hash (`scripts/native-deps-stamp.sh`).
- There is no `postinstall`.
- `asarUnpack` lists `**/node_modules/uiohook-napi/**` (`electron-builder.yml:22`).

**What this means for sherpa-onnx-node.**

- N-API prebuilts load in Electron without a rebuild. `uiohook-napi/prebuilds` ships darwin-arm64, darwin-x64 and win32-x64.
- If it is an unpatched prebuilt, adding it follows the existing pattern: add it to `asarUnpack`.
- Two cautions:
  - `rebuild-native.sh` would also try to rebuild it against Electron's ABI (`install-app-deps`).
  - A lazily loaded `.node` that fails to load must degrade like `click-hook.ts`, not crash main.
- I cannot verify from the repo how sherpa-onnx-node ships its prebuilts or its ONNX Runtime libraries.
- A sidecar binary has working precedents: asar.unpacked lookup, the `--version` handshake, universal-binary build checks, and `runHelperProcess`. But `runHelperProcess` is one-shot, with no progress or streaming, and a 16 MB stdout cap.
- Windows is x64 NSIS only. macOS has separate arm64 and x64 DMGs (`release-desktop.yml:3-4,244,434-435`). Windows OCR is spawned through PowerShell with no helper binary (`text-recognition/index.ts:56-57`).

## Integration points

**Add:**

- `src/shared/types/transcript.ts`: types only, plus IPC channel entries in `ipc.ts` and `electron-api.ts`.
- A main module `src/main/transcription/`:
  - helper or model path resolver
  - process runner with progress and cancel
  - model fetch and checksum (new)
  - `readTranscriptCache` and `writeTranscriptCache` in the style of `screenshot-text.ts`
  - IPC registration
- A `transcript` companion path in `CompanionPaths` (`library-vault.ts:270-283,452-464`).
  - It must also be handled in the same places `textCache` is:
    - the rename and move paths (`library-vault.ts:787,947`)
    - reconcile suffix roles (`vault-reconcile.ts:136`)
    - cross-workspace move (`workspaces/move-item.ts:138`)
- A renderer decode step beside `use-audio-peaks.ts` (reuse `openRecordingInput`). It downmixes and resamples the PCM to the model's rate, then sends it to main.
- `components/transcript-panel.tsx` plus CSS, and a toolbar button next to `onToggleCaptures`.
- A time-mapping module next to `source-time.ts` for word → axis → timeline, built on `recordingAt`, `timelineTimeAtSource` and `sourceTimeAtTimeline`.
- Subtitle cues in `export-plan.ts`, the worker message, and a worker draw step or a `webvtt` track.
- A flag in `analytics.ts`, a `ui-map.ts` area, catalog states in `ui-catalog/catalog/editor-video.ts`, a profile in `ui-catalog/profiles.ts`, and es+en messages.

**Edit:**

- `video-editor-page.tsx`: the panel state, plus `playback.seek` and `subscribeTime` wiring.
- A release-workflow check if a helper binary is added.

## Risks found in the code

1. **Mixed, level-adjusted audio.** The mic is ducked or gain-adjusted before encoding and the mix is baked in. Quiet or ducked speech and system audio reach the model as one stream. The sidecar does not say which sources were on.
2. **Muted ranges would leak.** `mutedRanges` and `audioMuted` are applied only at playback and export (`audio-edits.ts:40`, `silencedSpansFor`). A transcript or burned captions over a muted range would show what was silenced. Words must be filtered through `isAudible`.
3. **Redactions are visual only.** A redacted region on screen is not an audio redaction.
4. **Two joined branches disagree.** Waveform exists only for the primary recording and only on main. The join stack has no waveform. A transcript needs one decode per recording, mapped by offset.
5. **Right-column exclusivity is hand-maintained.** There are three booleans cleared at about nine call sites (`:900,1451,1496,1548,1565,1904,1924,2046,2408`). A fourth panel is likely to miss one and show two at once.
6. **The renderer CSP likely blocks WASM.** It is `script-src 'self'` with no `'wasm-unsafe-eval'`, and `connect-src` lists only PostHog (`src/renderer/index.html:12-13`). By Chromium's rules, an onnxruntime-web WASM model in the renderer would not run, and a model download from the renderer would be refused. That points to main or a sidecar. I did not test this.
7. **No download or integrity infrastructure.** A model is tens to hundreds of MB. Checksum, resume, versioning and offline behavior would all be new.
8. **`runHelperProcess` does not fit a long job.** It has a 16 MB stdout cap and a single timeout, and offers no streaming progress.
9. **Soft subtitles are `wvtt` only.** mediabunny cannot write `mov_text`. How Apple players treat `wvtt` in MP4 is outside this repo, and I did not check it.
10. **One export at a time, and captions force worker changes.** The worker has no layout, so cues must be pre-mapped to timeline time in the renderer. A transcript edited after an edit-session change must remap or invalidate.
11. **Speed is preview-only, but a reorder can show the same source second twice.** Highlighting the current word needs the playhead's source time. `timelineTimeAtSource` returns the first piece on a reorder.
12. **Workspace switching.** The sidecar and caches are per workspace (ADR 0032). The transcript read and write must go through `scopedInvoke` and the item lock (`withItemLock`, used in `video-edit-session.ts`).
