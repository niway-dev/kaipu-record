---
title: "Screen Recording Pipeline + Floating Control Bar — Design"
description: "Design for the end-to-end recording engine and the floating control bar that drives it while recording."
---

**Date:** 2026-06-26
**App:** `apps/kaipu-record` (Electron desktop, renderer = React 19 + TS, CSS Modules)
**Status:** Approved design — ready for implementation plan

## 1. Context & goal

The recorder UI is built but inert: `useRecordingSetup.startRecording()` only runs a
3-second countdown and flips an `isRecording` boolean — **nothing is captured, encoded,
or saved.** This spec covers building the actual recording engine end-to-end and the
floating control bar that drives it while recording.

We already have the surrounding infrastructure: source enumeration
(`recording:get-screen-sources`), media permissions, the Library vault (list / rename /
delete / reveal / directory), the `kaipu-media://` playback protocol, and the menu-bar
Capture Panel + tray. The "heavy" middle — capture → encode → write → finalize-to-vault —
plus the floating control bar are what's missing.

The reference app (`workspace-temp/legacy-kaipu-recorder`) is **comparison-only**. We
reproduce the _behavior_, not the code: new architecture, new IPC contract, new UI built
on our design system. Specifically we improve on the legacy in three ways it did badly.

### Decisions (locked)

| Decision            | Choice                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture        | **Option A** — record in the (hidden) main window renderer; floating bar is a separate always-on-top window; main process is the message hub                            |
| Encoder             | **mediabunny** — `MediaStreamVideoTrackSource` + `MediaStreamAudioTrackSource` → `Output({ format: Mp4OutputFormat, target: StreamTarget })`                            |
| Output format       | **MP4, H.264 (`avc`) video + AAC audio**, fixed defaults (1080p / 30fps / auto bitrate). Documented fallback to Opus-in-MP4 if AAC encode is unavailable in the runtime |
| Pause/resume        | **In scope** — full Recording + Paused control bar                                                                                                                      |
| Camera in recording | **Out of scope this pass** (screen + audio only). Architected as an additive step — flagged important                                                                   |
| Watermark           | **Out of scope** — future option. Shares the same extension seam as camera                                                                                              |
| Quality settings UI | Not wired to Settings yet — hardcoded defaults                                                                                                                          |

### Why MP4/H.264+AAC over the legacy's WebM/VP9+Opus

The only axis WebM/VP9 wins is file size at equal quality (~20–40% smaller), recoverable
by tuning bitrate. MP4/H.264+AAC wins everywhere that matters for this product:

- **Hardware encode on macOS** (VideoToolbox) — low CPU/heat/battery, no dropped frames
  on long recordings. VP9 has no hardware _encoder_ on Apple Silicon → the legacy
  software-encoded VP9, which is hot and drop-prone.
- **Exports** — MP4/H.264 opens in QuickTime, Quick Look, Final Cut, Premiere, iOS,
  Keynote, everything. WebM opens in almost none of the Apple/editor ecosystem.
- **Cloud (future Cloudflare)** — H.264/MP4 is the clean, recommended ingest for Stream
  and the only universally-playable format if served directly from R2 (Safari/iOS can't
  play WebM). The same file we record is the file we export and upload — no conversion.
- **Seek + duration** — mediabunny writes a correct `moov`; with faststart it's
  progressively streamable. Eliminates the legacy's "remux WebM in place to add a
  duration header" post-step entirely.

## 2. Architecture (Option A)

```
Main window renderer (HIDDEN while recording)          Floating bar window (visible)
  useScreenRecorder                                      ControlBar (our UI)
   ├─ getUserMedia(chromeMediaSourceId) → screen track    timer · 5-bar level · ⏸/▶ · ■
   ├─ getUserMedia(mic)  + system audio (best-effort)         ▲ ticks        │ commands
   ├─ AudioContext mix → 1 audio track + AnalyserNode         │              ▼
   ├─ mediabunny Output(Mp4, StreamTarget) ──chunks──┐  ┌────────── main process ─────────┐
   │     MediaStream{Video,Audio}TrackSource         └─►│ recording-writer (fd.write@pos) │
   └─ timer (elapsed − paused) ──── ticks ──────────────►│ control-bar-window              │
                                          commands ◄──── │ recording-hub (relay + windows) │
                                                         │ finalize → vault + sidecar      │
                                                         └─────────────────────────────────┘
```

**The constraint that forces this shape:** WebCodecs / `getDisplayMedia` / `getUserMedia`
only exist in a renderer, and a `MediaStream` cannot cross processes. So the encoder lives
in the renderer that already holds the picked source + permissions (the main window). The
main window hides on record; the slim bar is the only visible surface and floats over all
other apps. The main process is a pure message hub + disk writer — it never touches media.

## 3. Capture & encode pipeline (renderer: `useScreenRecorder`)

Lives in `features/recording/hooks/use-screen-recorder.ts`. Orchestrates:

1. **Acquire screen.** Electron-style deterministic source capture using the already-picked
   source id:
   ```ts
   navigator.mediaDevices.getUserMedia({
     audio: false,
     video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: source.id,
                           maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 } },
   })
   ```
2. **Acquire mic** (if enabled) via `getUserMedia({ audio: { deviceId } })`. Use `ideal`,
   not `exact`, so a disconnected device falls back instead of throwing.
3. **System audio** — best-effort. On macOS desktop audio capture is unreliable; mic is the
   primary track. If unavailable, recording proceeds with mic only. (No hard failure.)
4. **Mix audio** — a `videoProvider`/`audioProvider` seam (see §8) feeds the encoder. Audio:
   `AudioContext` → connect mic source (+ system audio source if present) →
   `MediaStreamAudioDestinationNode` → one mixed audio track. Tap an `AnalyserNode` off the
   same graph for the level meter (§5).
5. **Encode.** mediabunny:
   ```ts
   const output = new Output({ format: new Mp4OutputFormat({ fastStart: ... }),
                               target: new StreamTarget(writable) });
   output.addVideoTrack(new MediaStreamVideoTrackSource(screenTrack, { codec: "avc", bitrate }),
                        { frameRate: 30 });
   output.addAudioTrack(new MediaStreamAudioTrackSource(mixedAudioTrack, { codec: "aac", bitrate: 128e3 }));
   await output.start();      // capture begins automatically
   // ... pause()/resume() on the sources for pause/resume
   await output.finalize();   // closes the file
   ```
   `errorPromise` on each source is wired to the recorder's error path.
6. **Stream to disk.** The `StreamTarget`'s `WritableStream.write(chunk)` receives
   `{ data: Uint8Array, position: number }`. The recorder forwards `(sessionId, data, position)`
   to main over IPC, transferring the bytes as an `ArrayBuffer` (structured clone — **no
   base64**, unlike the legacy). **Critical:** the StreamTarget may rewrite earlier regions
   (e.g. faststart patching the `moov`), so main must honor `position` with a positional
   `fd.write(buffer, 0, len, position)` — **never** an append stream.

**fastStart choice:** `fastStart: "in-memory"` puts `moov` at the front (best for streaming /
Cloudflare / progressive playback) by buffering metadata in memory and patching on finalize;
`fastStart: false` writes `moov` at the end (lowest memory, still seekable locally). Default
to in-memory; revisit if memory on long recordings is a concern. Either way the writer is
position-aware, so both work without code changes.

## 4. Recording lifecycle & state

`useScreenRecorder` exposes: `status: "idle" | "starting" | "recording" | "paused" | "finalizing" | "error"`,
plus `start()`, `stop()`, `pause()`, `resume()`. Flow:

- **start()** — acquire streams → open writer session (`recording:create`) → build mediabunny
  Output → capture a poster frame for the thumbnail (§9) → `output.start()` → tell main to
  hide the main window and show the bar (§7) → begin the timer.
- **pause()/resume()** — `pause()`/`resume()` on the mediabunny sources; the timer accumulates
  paused duration so elapsed excludes it (§6).
- **stop()** — `output.finalize()` → flush remaining writes → `recording:finalize` (main moves
  temp → vault, writes sidecar, returns `LocalRecording`) → hide bar, show main window,
  navigate to the new recording's detail page.
- **error / abort** — any encoder/source/write failure → `recording:abort` (close fd, delete
  temp) → bar shows an error state → restore main window.

## 5. Mic level meter (renderer: `use-mic-level.ts` — pure, testable)

`AnalyserNode` (`fftSize: 256`, `smoothingTimeConstant: 0.3`) over the mixed audio stream.
A pure helper maps time-domain data to **5 bars**: split the sample buffer into 5 segments,
RMS each (`sqrt(mean((s-128)/128)²)`), boost for visual response (`min(1, rms * k)`), clamp
0..1. Sampled ~10×/s. The RMS→bars function is exported and unit-tested independently of the
AudioContext. Levels ride along in the tick (§6).

## 6. Timer / elapsed with pause (pure, testable)

A pure `elapsed.ts` helper computes recording seconds from wall-clock minus accumulated paused
duration: track `startedAt`, `pausedAt | null`, `totalPausedMs`. On resume, add
`now - pausedAt` to `totalPausedMs`. `elapsedMs(now) = now - startedAt - totalPausedMs (− current open pause)`.
Unit-tested with injected clock values (no real timers in the test).

The recorder emits a **tick** ~4–10×/s: `{ elapsedSeconds, levels: number[5], status }`. Sent
to main (`recording:report-tick`), relayed to the bar.

## 7. Main process

### `recording-writer.ts` — positional disk writer

Session-based IPC. A `Map<sessionId, fileHandle>` of open temp files in `os.tmpdir()`.

| Channel              | Args                                                        | Returns / effect                                                                                                                            |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `recording:create`   | `(suggestedName?)`                                          | opens a temp file, returns `{ sessionId, tempPath }`                                                                                        |
| `recording:write`    | `(sessionId, data: ArrayBuffer, position: number)`          | `fd.write(Buffer.from(data), 0, data.byteLength, position)` — **positional, not append**                                                    |
| `recording:finalize` | `(sessionId, meta: { title, durationSeconds, thumbnail? })` | close fd → generate vault id → move temp → `<vault>/<id>.mp4` → write `.kaipu/<id>.json` sidecar (+ `.jpg` thumb) → return `LocalRecording` |
| `recording:abort`    | `(sessionId)`                                               | close fd, delete temp                                                                                                                       |

Mirrors the existing `library-vault` test style: pure-ish, tempdir-testable.

### `control-bar-window.ts` — the floating window

```ts
new BrowserWindow({
  width: 360, height: 64, show: false,
  frame: false, transparent: true, resizable: false, movable: true,
  alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false,
  webPreferences: { preload, sandbox: false, backgroundThrottling: false },
})
```

- `alwaysOnTop` at `"screen-saver"` level so it floats over fullscreen apps.
- Positioned **bottom-center of the recorded display** (derive from the picked source's
  `display_id` when available; else the primary display). Bottom margin ~40px.
- Loads the renderer with a window-mode marker (`?window=control-bar`, §10).
- `show()` / `hide()` / `destroy()`.

### `recording-hub.ts` — coordinator

The only stateful glue. Owns: the control-bar window instance, main-window show/hide on
record, and bidirectional relay:

- recorder → `recording:report-tick` → **hub** → `control:tick` → bar
- bar buttons → `control:pause|resume|stop` → **hub** → `recording:command` → recorder

Hub also handles the main-window backgroundThrottling: set `false` on the main window so the
hidden recorder keeps encoding at full rate.

## 8. The video/audio provider seam (camera + watermark future)

The encoder consumes a **video track** and an **audio track** from providers, not directly
from `getDisplayMedia`. Today:

- `videoProvider` → returns the raw screen `MediaStreamTrack`.
- `audioProvider` → returns the mixed-audio track.

Future (camera PiP and/or watermark) swaps `videoProvider` for a **canvas compositor**: a
render loop draws the screen frame, then the camera frame (PiP), then a watermark layer onto
an `OffscreenCanvas`, and feeds `CanvasSource` to the Output. **Camera and watermark are the
same extension point** — both are just additional draw passes in the compositor. Nothing
downstream (Output, writer, finalize, vault) changes. This seam is the entire reason camera
and watermark are cheap follow-ups. Designed now, built later.

## 9. Thumbnail

At start, the recorder draws the screen `<video>`'s first frame to a canvas → `toBlob("image/jpeg")`
→ sends bytes with `recording:finalize`. Main writes `.kaipu/<id>.jpg` (matches the path
`library-vault.remove()` already cleans up). `describe()` is updated to surface it (§10).

## 10. Vault & playback integration (improvements to existing code)

The vault is currently hardcoded to `.webm` and never surfaces thumbnails. Because we now
produce real MP4 with correct duration, we clean this up as part of the work:

- **Extension-aware vault** — `library-vault.ts`: discover known video extensions
  (`.mp4`, `.webm`), resolve a given id to whichever file exists, store the recording as
  `<id>.mp4`. `list()` scans for any known ext; `filePath(id)` resolves the real file.
- **Sidecar gains duration + thumbnail** — finalize writes `{ title, createdAt,
durationSeconds }`; `describe()` surfaces `thumbnailUrl` when `.kaipu/<id>.jpg` exists.
- **Media protocol** — `media-protocol.ts` resolves the real extension via the vault (not a
  hardcoded `.webm`) and serves the correct content type. Add a thumb route (e.g.
  `kaipu-media://thumb/<id>`) or equivalent so the Library can render posters.
- **Id scheme** — finalize generates a filesystem-safe, sortable id (timestamp-based, e.g.
  `recording-2026-06-26-143002`). An explicit human `title` is written to the sidecar so the
  list never falls back to `humanizeId`.

## 11. Control bar UI (our design system)

`features/control-bar/` — built from scratch with our tokens / `cx()` / `data-*` house style
(no legacy CSS ported). Reproduces the reference design: pill, dark, minimal.

- **Recording state:** ● red dot · `00:04:17` mono timer · 5-bar live mic level · ⏸ pause ·
  ■ stop (accent) · `⌘⇧P` hint.
- **Paused state:** ○ amber dot · `Paused` · frozen timer · ▶ resume · ■ stop.
- Listens to `control:tick`; buttons send `control:pause|resume|stop`. Drag region on the
  pill (`-webkit-app-region: drag`) so the user can reposition it; buttons are `no-drag`.

## 12. Renderer window-mode entry

The renderer entry (`main.tsx` / `app/`) inspects the window marker:

- default → mount `<AppShell />` + hash router (existing).
- `?window=control-bar` → mount a bare `<ControlBar />` (no shell, no sidebar, transparent
  background).

## 13. Preload / electron-api contract additions

Extend `shared/types/electron-api.ts` + `preload/index.ts`:

- `recording.create() / write(sessionId, data, position) / finalize(sessionId, meta) / abort(sessionId)`
- `recording.reportTick(tick)` (recorder → main)
- `recording.start(meta) / stop()` (window show/hide orchestration via hub)
- control bar: `onControlTick(cb)`, `controlBar.pause() / resume() / stop()`, and a
  recorder-side `onRecordingCommand(cb)`.

Channel names centralized in `shared/types/ipc.ts` (`IPC_CHANNELS`) like the rest.

## 14. Error handling & edge cases

- **Screen permission denied** → don't start; surface via the existing permission notices.
- **System audio unavailable (macOS)** → proceed with mic only (best-effort, no error).
- **Mic device disconnected mid-recording** → `ideal` constraint degrades; recording continues.
- **Write / encoder failure** → `recording:abort` deletes temp; bar shows error; main restored.
- **Bar window closed mid-recording** → treated as **stop** (clean finalize), not a crash.
- **App quit mid-recording** → best-effort finalize or abort on `before-quit`; never leave a
  dangling fd or a half temp masquerading as a vault file (temp lives in `os.tmpdir()`, not the
  vault, so a crash can't pollute the Library).

## 15. Testing strategy

- **Pure logic (vitest/jsdom):** elapsed-with-pause (`elapsed.ts`), RMS→5-bars
  (`use-mic-level` helper), control-bar state mapping (tick → display). mediabunny &
  `electronAPI` mocked.
- **Main (tempdir):** `recording-writer` — positional writes reconstruct the exact byte
  stream (including a rewritten region), finalize moves temp → vault as `<id>.mp4`, writes
  sidecar + thumb; abort deletes temp. Extension-aware `library-vault` (mp4 discovery,
  id→file resolution) extends the existing vault tests.
- **Not unit-tested:** the device/media acquisition and the live encoder (browser APIs);
  exercised through injectable provider seams and verified manually in the running app.

## 16. File-by-file change list

**New — main**

- `src/main/recording/recording-writer.ts` (+ test)
- `src/main/recording/control-bar-window.ts`
- `src/main/recording/recording-hub.ts`

**New — renderer**

- `features/recording/hooks/use-screen-recorder.ts` (+ provider seam helpers)
- `features/recording/hooks/use-mic-level.ts` (+ pure RMS helper + test)
- `features/recording/elapsed.ts` (+ test)
- `features/control-bar/control-bar.tsx` (+ `.module.css`, + state helper + test)
- control-bar window-mode wiring in the renderer entry

**Modified**

- `shared/types/electron-api.ts`, `shared/types/ipc.ts` — new contract + channels
- `preload/index.ts` — new bridge methods
- `src/main/index.ts` — register writer/hub, wire start/stop window orchestration
- `src/main/library/library-vault.ts` + `library/index.ts` — extension-aware, mp4, thumb in `describe()`
- `src/main/media-protocol.ts` — resolve real extension + content type, thumb route
- `features/recording/hooks/use-recording-setup.ts` — `startRecording` delegates to the real engine
- `pages/record/record-page.tsx` + `features/capture-panel/capture-panel.tsx` — Start wired to the engine
- `package.json` — add `mediabunny`
- docs: `apps/documentation` renderer-architecture + recording-pipeline + changelog

## 17. Follow-ups (designed-for, not built)

- **Camera PiP** (flagged important) — canvas compositor via the §8 provider seam.
- **Watermark** — additional draw pass in the same compositor.
- **Quality settings** — wire resolution / fps / bitrate to the Settings page.
- **Cloudflare upload** — the MP4/H.264+AAC + faststart output is already ingest/serve-ready
  for Stream or R2; the upload flow itself is a separate feature.

## 18. Open items to confirm during planning

- Exact mediabunny API surface for `MediaStreamVideoTrackSource` codec strings (`avc` vs
  `"avc1.*"`), bitrate units, and `Mp4OutputFormat` faststart option names — verify against the
  installed package version, not docs prose.
- Whether AAC encode is available via WebCodecs in the Electron Chromium build; if not, ship
  the Opus-in-MP4 fallback and note the export/compat caveat.
- `display_id` availability from `desktopCapturer` sources for bar placement on the recorded
  screen.
