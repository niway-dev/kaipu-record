---
title: "Record — Lens A (performance, optimizations, resource leaks, observability)"
description: "Detailed findings from the 2026-10-15 pre-deploy audit: Record — Lens A (performance, optimizations, resource leaks, observability)."
---

> Part of the [2026-10-15 audit report](/audits/2026-10-15/report/). Paths are relative to `apps/kaipu-record/src/`.

## Summary

The always-on work during a take is cheap and bounded: the 8 ms cursor poll, the 100 ms tick and
the chunk stream are each well under 1% of a core, and none of them grows without a cap for a 1 h
take. The real problems are at the edges of a take: two failure paths leak live resources
(an encoder error leaves the mic, the screen capture and the compositor running; a start failure
can orphan the 125 Hz cursor sampler and the global mouse hook for the rest of the session), and
the start path is fully serial. The single most important thing is **observability**: a successful
recording emits nothing at all. "It was choppy" or "it took 3 s to start" leaves no trace — no start
latency, no hardware-vs-software encoder flag, no dropped-frame count (mediabunny drops frames
silently), and console logs are not persisted in packaged builds. One `recording_completed` event
with about eight numbers would answer most of these reports.

Note: mediabunny behaviour was verified against the copy installed in this worktree (1.49.0;
`apps/kaipu-record/node_modules/mediabunny` → `.bun/mediabunny@1.49.0`), while `bun.lock` pins
1.61.4. The worktree's install is stale. The cited behaviours (encoder-error check in
`flushAndClose`, the queue-size frame drop, fresh allocation per flushed chunk) are long-standing, but
re-check them against 1.61.4.

## Findings

### REC-A1. An encoder error leaves the mic, the screen capture, the compositor and the AudioContext running after the take ends

- Severity: medium
- Category: resource-leak
- Confidence: confirmed
- Where: `renderer/src/features/recording/recorder-engine.ts:353-361`, `renderer/src/features/recording/recorder-store.ts:191-198,348-368`
- What happens: the video or audio encoder errors mid-take (VideoToolbox failure, GPU reset, an unsupported config). `onError` runs `stopRecording()`, which calls `engine.stop()`. Its first line, `await output.finalize()`, rejects. So `compositor?.stop()`, the `getTracks().forEach(stop)` loops and `audioContext.close()` never run. Result:
  - The mic stays open, with the macOS mic indicator on.
  - The screen capture stays live, with the screen-recording indicator on.
  - The compositor's rAF loop keeps downscaling a native frame (about 5.9 MP on a MacBook) every vsync until the app quits.
  - The AudioContext stays alive.

  The user sees an error toast while the privacy indicators say Kaipu is still recording. Every take that errors this way adds another set.

- Evidence: in mediabunny, `Output.finalize()` awaits `source._flushOrWaitForOngoingClose(false)` (`output.ts:886-887`). That reaches `flushAndClose(forceClose=false)`, which calls `this.checkForEncoderError()` first (`media-source.ts:844-847`) and throws the stored encoder error. `stop()` has no try/finally. In the store's catch (`recorder-store.ts:360-368`), only `recordingAbort` runs. Nothing else holds the engine's streams, and `engine = null` drops the only reference. The "screen capture ended" error path does not trigger this because the encoder is healthy there.
- Fix sketch: wrap the body of `stop()` as `try { await output.finalize() } finally { compositor?.stop(); stop all tracks; await audioContext.close() }`. A unit test with a fake output whose `finalize` rejects pins it.
- Effort: S

### REC-A2. A start that fails quickly can orphan the 8 ms cursor sampler and the global mouse hook for the rest of the session

- Severity: medium
- Category: race
- Confidence: plausible
- Where: `renderer/src/features/recording/recorder-store.ts:176-201,242`; `main/recording/recording-hub.ts:233-252`
- What happens: `beginEngine` runs `beginCursorTrackSession` and `startEngine` under one `Promise.all`. If `startEngine` rejects first (screen `getUserMedia` fails: a stale `screen:` id after a display was unplugged, `NotReadableError`, a denied permission), the catch runs `recordingAbort(id)` at once. Main's abort handler calls `cursorTracks.discard(id)`, but the tracker does not exist yet: the `cursorTrackStart` handler is still awaiting `displayIdForSource` → `desktopCapturer.getSources()`. When that resolves, the handler calls `cursorTracks.start(id, display)` and `clickHook.ensureRunning()` for a session that is already gone. Consequences:
  - Nothing ever finishes or discards that session id. `finalize` and `abort` for later takes use other ids, and only `forceReset` (renderer death) calls `discardAll`.
  - The orphan polls `getCursorScreenPoint()` at 125 Hz on the main thread for the app's lifetime. Its buffer grows to `MAX_CURSOR_SAMPLES` (1 M samples × 3 arrays ≈ 24 MB) and then stops growing, but the interval keeps running.
  - `cursorTracks.active` stays true, so `stopHookIfIdle()` never stops the uiohook global mouse hook. Every click for the rest of the session goes to the orphan.
  - Each further failed start adds another orphan.
- Evidence: `recordingAbort` handler (hub:233-238) runs before `cursorTrackStart` (hub:239-252) has reached `cursorTracks.start`. `CursorTrackRegistry.start` only discards the _same_ id (cursor-tracker.ts:143-148). The renderer's 500 ms timeout (`cursor-track-session.ts:41,73-80`) only stops the renderer from waiting; it does not cancel main's handler. The leak depends on timing: `getUserMedia` has to reject before `getSources` resolves. That is likely, because a denied or invalid desktop source rejects in tens of ms, and the code's own comment puts `getSources` at 100–500 ms. It is not measured.
- Fix sketch: in `cursorTrackStart`, start the tracker only if the session is still live. One option is to keep a `abortedSessions` set filled by `recordingAbort` and check it after the `await`. A simpler option is to check `writer` session existence (a `writer.has(id)`) before `cursorTracks.start`.
- Effort: S

### REC-A3. A successful recording emits no telemetry: start latency, encoder path, dropped frames and finalize time are invisible

- Severity: medium
- Category: observability
- Confidence: confirmed
- Where: `renderer/src/features/recording/recorder-engine.ts:261-272` (encoder config, `console.info` only), `recorder-store.ts:162-253,323-380` (no timing captured), `renderer/src/features/analytics/analytics-client.ts:51` (`captureEvent`, called exactly once in the app: `use-missing-recording-recovery.ts:67`)
- What happens: when a user reports "choppy" or "slow to start", nothing is on record:
  - Whether hardware H.264 engaged is logged to a console nobody sees. There is no electron-log or other file sink; the only PostHog path is exceptions.
  - mediabunny silently drops a frame whenever the encoder queue is ≥ 8 (`media-source.ts:1795`, video; `:2849`, audio). That is exactly the "choppy" symptom, with no counter.
  - Start-to-first-frame, `getUserMedia` time, compositor on/off, finalize duration and write-queue depth are not measured anywhere.

  Errors are covered: `reportError` on start, mid-take and finalize reaches PostHog. Degradations are not.

- Evidence: grep for `captureEvent(` under `src/` finds one call site, outside recording. There is no `performance.mark` or timing in the start/stop path. `onEncoderConfig` only logs. The `RecordingTick` carries no health data.
- Fix sketch (minimum instrumentation): one `recording_completed` event (and `recording_failed` with the same props) carrying:
  - `startMs`: countdown end → `output.start()` resolved, plus `gumMs` and `micMs`;
  - `hwEncoder`: `config.hardwareAcceleration` from `onEncoderConfig`;
  - `compositor`: whether resize and/or watermark was on;
  - `width`, `height`, `fps` and `bitrate`;
  - `durationMs`;
  - `framesExpected` (duration × fps) vs `framesWritten`, counted in a `VideoSample`-level wrapper or from the muxer's sample count at finalize;
  - `finalizeMs`;
  - `maxWriteQueue`: peak pending writes in `RecordingWriter`, returned by `finalize`.

  No PII, and about 10 lines in the store plus 5 in the writer.

- Effort: S

### REC-A4. A renderer crash mid-recording is not reported, and its writer session (open FD plus the `.part` file) is never closed

- Severity: medium
- Category: observability
- Confidence: confirmed
- Where: `main/index.ts:218-222`; `main/recording/recording-hub.ts:321-327`; `main/recording/recording-writer.ts:55-57`; `renderer/src/features/recording/recorder-store.ts:163`
- What happens:
  - The worst Record event, the recorder renderer dying (OOM or GPU crash), is only `console.error`'d. `captureMainException` is not called, so it never reaches PostHog.
  - `forceReset()` resets activity, cursor tracks and the click hook, but not the `RecordingWriter` session. Its `FileHandle` stays open and the `.part` (up to GBs for a long take) stays in `tmpdir`.
  - Session ids restart at `session-1` per renderer load (`++sessionCounter`). The next take after a reload therefore opens the same `kaipu-rec-session-1.mp4.part` with `w+`: it truncates the leftover and replaces the map entry, which leaks the old handle until GC.
  - Nothing on launch scans for leftover `.part` files.
- Evidence: the `render-process-gone` handler (index.ts:218-222) logs and calls `hub.forceReset()`. `forceReset` (hub:321-327) never touches `writer`. `RecordingWriter.create` overwrites `sessions` without closing an existing entry (writer:54-58).
- Fix sketch: in the `render-process-gone` handler, call `captureMainException(new Error("recorder renderer gone"), "render-process-gone", { reason, wasRecording })`. In `forceReset`, abort (or close and keep) every open writer session. Make session ids unique per app run, for example by prefixing with `Date.now()`.
- Effort: S
- Known: #10 (its suggested fix included "abort/close the writer session"; that part did not land)

### REC-A5. If the mic fails to open at start, the take records silently while every surface still shows the mic as on

- Severity: medium
- Category: error-handling
- Confidence: confirmed
- Where: `renderer/src/features/recording/recorder-engine.ts:200-216`; `renderer/src/features/recording/recorder-store.ts:263,271-276`
- What happens: `acquireMicrophone` swallows any `getUserMedia` error and returns `null` (engine:207-209), so `micGain` stays `null`. `forwardLiveSettings` initialises `micOn = input.microphoneDeviceId !== null`, which is true, and only corrects the toggle for system audio (store:273-276). Nothing corrects it for the mic. The mic toggle in the bar, the panel and the Record page stays "on", the level meter reads flat, and the user records a full meeting with no voice and no warning. The failure is not captured to analytics either.
- Evidence: `EngineHandle` exposes `hasSystemAudio` but has no mic equivalent (engine:34-35,324). An unplugged device does _not_ trigger this, because `deviceId: { ideal }` falls back to the default mic. The triggers are `NotAllowedError` (permission revoked or denied) and `NotReadableError` (device busy, common on Windows). How often that happens is not measured.
- Fix sketch: expose `hasMicrophone` on the handle. When the mic was requested but not acquired, write back `isMicrophoneEnabled: false` the same way system audio already is, and `captureException` the swallowed error with `phase: "mic-start"`.
- Effort: S

### REC-A6. The start path is fully serial, and the poster thumbnail sits on the critical path to "recording"

- Severity: medium
- Category: performance
- Confidence: plausible
- Where: `renderer/src/features/recording/recorder-engine.ts:134-148,167-175,213-216,283,307,365-386`; `recorder-store.ts:170,215-233`
- What happens: after the countdown, these run one after another:
  1. `recordingCreate` IPC;
  2. screen `getUserMedia` (on a macOS dev build, a rejected audio+video call and then a second video-only call);
  3. the compositor's `video.play()` and the watermark image load;
  4. mic `getUserMedia`;
  5. `output.start()`;
  6. `captureThumbnail()`: a second `<video>.play()`, a fixed **150 ms sleep**, a full-output-size draw and a JPEG `toBlob` (for a 2160p preset, a 3840×2160 encode).

  The first video frame is delayed by the mic open. Opening a Bluetooth headset mic forces a profile switch, which plausibly costs hundreds of ms to about 1 s. Status `recording`, the elapsed clock and the bar's ticks are delayed by the thumbnail as well, an estimated 200–400 ms. The clock starting late has two effects. The `durationMs` passed to finalize is short by that amount. And the cursor-track cut `maxMs = durationMs + 250` (hub:217) can clip the last cursor samples when the thumbnail takes more than 250 ms.

- Evidence: every step above is a sequential `await` in `startEngine`. `startEngine` returns only after `captureThumbnail` resolves (engine:307-309), and the store starts `clock` and `tickTimer` only after that (store:221-233). The 150 ms constant is at engine:374.
- Fix sketch:
  - Start mic `getUserMedia` concurrently with screen `getUserMedia` (`Promise.all`, keeping mic best-effort).
  - Return the handle right after `output.start()` and make `thumbnail` a `Promise<ArrayBuffer|null>` awaited in `stopRecording`.
  - Start the clock from `firstMediaTimestamp` rather than `Date.now()` after the thumbnail.
  - Measure with the `startMs`/`gumMs`/`micMs` marks proposed in REC-A3.
- Effort: S

### REC-A7. The compositor redraws every display refresh (not at the encode frame rate), including while paused

- Severity: low
- Category: performance
- Confidence: plausible
- Where: `renderer/src/features/recording/recording-compositor.ts:76-104`; `recorder-engine.ts:310-317`
- What happens: `draw()` reschedules itself with `requestAnimationFrame`, so it runs at the display rate, up to 120 Hz on ProMotion MacBooks, while `canvas.captureStream(frameRate)` samples at 30. Each draw is a `clearRect` plus an `imageSmoothingQuality: "high"` resample of the native frame (3024×1964 ≈ 5.9 MP). Up to 4× of those draws are thrown away, and they keep running during pause, because `pause()` only pauses the mediabunny sources. The draw also runs whether or not the source produced a new frame. The canvas itself is a known, accepted trade-off (recording-compositor-perf); its _cadence_ is not covered by that note.
- Evidence: rAF loop at compositor:100; `pause()` never touches the compositor (engine:310-313). Plausible because the actual rAF rate in a hidden `BrowserWindow` with `setBackgroundThrottling(false)` (index.ts:151) was not measured. It may be vsync-rate or throttled.
- Fix sketch: drive `draw` from `video.requestVideoFrameCallback`, which fires only on new source frames, or skip draws that come sooner than `1000/frameRate` after the last one. Add `compositor.pause()/resume()` wired to engine pause. Measure with a draw counter divided by elapsed time, logged once at stop.
- Effort: S

### REC-A8. With the vault on another volume, Stop copies the whole recording (rename across volumes → `copyFile`), and the system disk must hold the full take

- Severity: medium
- Category: performance
- Confidence: confirmed
- Where: `main/recording/recording-writer.ts:50,55,122-127`
- What happens: the `.part` file is always created in `os.tmpdir()`, which is on the system disk. At finalize, `rename()` into a vault on an external or other volume fails with `EXDEV` and falls back to `copyFile` of the entire file while the bar shows "Saving…". A 1 h take at the balanced 8 Mbps is about 3.6 GB; at roughly 100 MB/s to a USB disk that is about 36 s of "Saving…", and minutes on a slow drive. The take also needs 3.6 GB free on the system disk even when the user moved the vault elsewhere to save space, and a full system disk fails the take mid-recording (now surfaced, per #7).
- Evidence: `tempDir = deps.tempDir ?? tmpdir()` (writer:50). The hub never passes `tempDir` (hub:75-78). `rename(2)` always fails across filesystems, so the catch branch at writer:124-127 is the normal path for an external vault.
- Fix sketch: create the `.part` inside the vault directory (or a `.tmp/` subfolder of it). The final rename is then same-volume and instant, and the space is charged to the disk the user chose.
- Effort: S

### REC-A9. Two `desktopCapturer.getSources()` calls on main for every start, for a `display_id` the renderer already has

- Severity: low
- Category: optimization
- Confidence: plausible
- Where: `main/recording/recording-hub.ts:276-278,242-246,332-343`
- What happens: `recordingStart` (bar placement) and `cursorTrackStart` (cursor normalisation) each call `displayIdForSource` → `getSources({types:["screen"]})` concurrently on every take. The renderer's source list already carries `display_id`. The cost is uncertain: the cursor-session comment says 100–500 ms, while the capture-panel note says a 0×0 screens-only call takes milliseconds. Either way it is duplicate work on main during the most latency-sensitive second. It also delays the bar's first appearance, which additionally pays a cold `BrowserWindow` load on the first take of a session (control-bar-window.ts:38-76).
- Evidence: both handlers call `displayIdForSource(info.sourceId)` independently; nothing is cached.
- Fix sketch: pass `displayId` from the renderer in `RecordingStartInfo` and `cursorTrackStart`, falling back to `getSources` only when it is missing. Optionally pre-create the bar hidden, as the capture panel already is.
- Effort: S

## Checked and fine

- **8 ms cursor poll (main):**
  - `getCursorScreenPoint()` is a microsecond-scale sync call, so 125 Hz is negligible CPU.
  - Samples are de-duplicated (idle pointer → no growth) and capped at 1 M samples (≈ 24 MB of doubles), which covers about 2.2 h of continuous motion. A 1 h moving-pointer take is about 450 k samples ≈ 11 MB.
  - Finalize does one `JSON.stringify` of that (about 10 MB; plausibly around 100 ms on main, once per take). That is acceptable.
  - Normal finalize and abort both stop the timer.
- **Chunk path:**
  - mediabunny (non-fragmented, `fastStart: false`) flushes once per MP4 chunk (about every 0.5 s), not per frame, so IPC is a few messages per second at about 1 MB/s.
  - The engine's `chunk.data.slice()` is a redundant copy, because mediabunny allocates a fresh `Uint8Array` per flushed chunk (`target.ts:410`); the "pooled buffer" comment is wrong. The cost is about 1 MB/s of memcpy, which does not matter.
  - The `WritableStream.write` returns synchronously, so there is no backpressure into mediabunny, and main's per-session write queue is unbounded. At 1–3 MB/s to a local SSD the queue cannot realistically build up. The `maxWriteQueue` metric in REC-A3 would show it if it ever did.
- **Tick:**
  - The 100 ms `readLevels()` is a 256-byte analyser read plus a 5-bar RMS.
  - Main relays to the bar only; the all-windows `recording:state` broadcast is deduped to once per elapsed second (`recording-activity.ts:31-48`).
- **Per-take listeners:**
  - `onRecordingCommand` is registered once at module scope.
  - `onRecordingSettingsChanged` is unsubscribed in `stopRecording`.
  - Hub IPC handlers are registered once.
  - The bar window is reused (hidden between takes).
  - The click hook is stopped when no tracker is active (except REC-A2).
  - The compositor `<video>` is detached in `stop()`.
  - The thumbnail `<video>` is paused and unreferenced (collected by GC).
  - The normal-stop path releases all tracks and closes the AudioContext.
  - 20 normal takes do not accumulate anything that was found here.
- **mediabunny audio:** it uses `MediaStreamTrackProcessor` (available in Chromium windows), so its fallback `AudioContext` + `ScriptProcessorNode` path (suspended, never closed) is not taken.
- **Pre-countdown start:** the auto-start waits only for `selectedSource`, which the mount resolves with the cheap screens-only, 0×0-thumbnail call (`use-source-selection.ts:22-24`). The thumbnail enumeration happens only when the picker opens (capture-panel-latency fixes are in place).
- **Write failures** are now surfaced via the stop command and `finalize` refusing a failed session (#7 holds), and reach PostHog through `reportError` in the store's finalize catch.
