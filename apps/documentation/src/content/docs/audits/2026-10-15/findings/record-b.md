---
title: "Record — Lens B (error handling, bugs, logic, races)"
description: "Detailed findings from the 2026-10-15 pre-deploy audit: Record — Lens B (error handling, bugs, logic, races)."
---

> Part of the [2026-10-15 audit report](/audits/2026-10-15/report/). Paths are relative to `apps/kaipu-record/src/`.

## Summary

The happy path and the previously audited failure modes (orphaned engine, Cmd+Q, renderer crash
resetting the hub, write failures, stop during countdown/starting) are fixed and hold up: the
module-singleton recorder store has a single stop/cancel entry point and the hub resets on
`render-process-gone`. What remains are the edges of the edges: cleanup that runs only on the
success path. Failures during the ~200 ms between `output.start()` and the engine handle being
returned are swallowed, `engine.stop()` releases devices only if mediabunny finalizes cleanly,
and several main-side resources (cursor tracker, click hook, writer session, control bar) are
started asynchronously and never torn down if the take ends first. **The most important single
item is REC-B6: if `writer.finalize` fails after it has closed the session (vault folder on an
unplugged drive, cross-volume copy failure), the complete recording stays as an invisible `.part`
in tmpdir. Nothing tells the user it exists, and nothing ever recovers it.**

## Findings

### REC-B1. An encoder or capture failure in the first ~200 ms of a take is swallowed and the take continues as a zombie

- Severity: medium
- Category: error-handling
- Confidence: confirmed
- Where: `renderer/src/features/recording/recorder-engine.ts:283-307`, `renderer/src/features/recording/recorder-store.ts:191-199,323-327`
- What happens: The engine fails right after start. Either the WebCodecs encoder rejects its configuration on the first frame, or the screen track ends. The error fires `onError` while the store is still in `"starting"` and `engine` is still `null`, because `startEngine` has not returned yet: it is awaiting `captureThumbnail` (`video.play()` + 150 ms + `toBlob`). `onError` calls `reportError` (a toast in the hidden main window, auto-dismissed after 5 s) and then `stopRecording()`, which returns immediately at `if (stopping || !activeEngine ...)`. `notifyError` has already set `teardownStarted = true`, so the error never fires again. `beginEngine` then sets status `"recording"` and starts ticks. The bar shows a healthy timer for the whole take, and at Stop `output.finalize()` rethrows the encoder error (`checkForEncoderError` in mediabunny `flushAndClose`), so the user gets "couldn't save" after recording for minutes or hours.
- Evidence: `errorPromise.catch(notifyError)` and the `ended` listener are wired at :302-304, before `await captureThumbnail(...)` at :307. Encoder configure errors land on the first sample, within about one frame of `output.start()`, which is inside that window. `stopRecording`'s guard at store:327 has no "pending error" memory, and nothing in `beginEngine` checks whether the engine already failed before it sets `engine = handle` (:215).
- Fix sketch: In `beginEngine`, keep an `errorBeforeReady` flag set by `onError` while `engine` is null, and after `Promise.all` treat it like `cancelRequested` (stop + abort + `recordingStop`). Alternatively, register the error listeners only after the handle is returned, with a buffered rejection.
- Effort: S

### REC-B2. `engine.stop()` releases the screen, mic, compositor and AudioContext only if mediabunny finalizes cleanly, and `startEngine` releases nothing on partial failure

- Severity: medium
- Category: resource-leak
- Confidence: confirmed (stop path) / plausible (start path)
- Where: `renderer/src/features/recording/recorder-engine.ts:353-361` and `:134-283`
- What happens: Mid-take the encoder errors (GPU/VideoToolbox reset, sleep/wake), and `onError` runs `stopRecording`. `engine.stop()` sets `stopped` and then awaits `output.finalize()`, which rejects because `flushAndClose(false)` calls `checkForEncoderError()`. The lines after it never run, so `compositor?.stop()`, the track stops and `audioContext.close()` are all skipped. The OS mic and screen-capture indicators stay on after the error toast, the compositor's rAF loop keeps drawing, and the AudioContext stays alive until the app restarts. Every further failed take leaks another set. The start path has the same problem: if `startRecordingCompositor` or `output.start()` throws after `getUserMedia` succeeded, `screenStream`, any mic stream and the `AudioContext` are never released, because `startEngine` has no `try/finally`.
- Evidence: mediabunny 1.49.0 `output.ts:880-907` (finalize awaits `_flushOrWaitForOngoingClose(false)`) and `media-source.ts:844-846` (`if (!forceClose) this.checkForEncoderError()`). `stop()` has no `try/finally`. The store's catch at :360-368 only aborts the writer.
- Fix sketch: Wrap `stop()`'s finalize in `try { await output.finalize() } finally { compositor?.stop(); stop tracks; close context }`, falling back to `output.cancel()` on error. Add a cleanup-on-throw block around the body of `startEngine`.
- Effort: S

### REC-B3. The control bar can appear after the take has already ended and float on screen while idle

- Severity: medium
- Category: race
- Confidence: plausible (timing-dependent, code path confirmed)
- Where: `main/recording/recording-hub.ts:267-279,280-293`, `main/recording/control-bar-window.ts:73-76`
- What happens: `recordingStart` calls `bar.show()` only after `displayIdForSource()` resolves (`desktopCapturer.getSources`, 100–500 ms per the code's own comment). If the start fails quickly (`getUserMedia` rejects, compositor/encoder start fails), or the user cancels during `"starting"`, `recordingStop` → `bar.hide()` runs first, and the late `.then` shows the bar afterwards. On the first take of a session the same thing happens through the `ready-to-show` handler, which calls `showInactive()` unconditionally even if `hide()` already ran. Result: an always-on-top bar on every workspace with a stale timer, while the hub is idle. Its Stop does nothing (`stopOrCancelRecording` is a no-op while idle). It disappears only after another take starts and stops.
- Evidence: Neither `show()` nor the `ready-to-show` handler checks that a recording is still active. The hub does not compare `activity` after the await.
- Fix sketch: In the `.then`, `if (!activity.active) return;`. In `ControlBarWindow`, track a `wanted` flag set by `show()`/`hide()` and honour it in `ready-to-show`.
- Effort: S

### REC-B4. A start that fails before main's `cursorTrackStart` resolves leaves a cursor tracker (125 Hz) and the global mouse hook running for the rest of the app's life

- Severity: medium
- Category: resource-leak
- Confidence: plausible (timing-dependent, code path confirmed)
- Where: `main/recording/recording-hub.ts:233-252`, `renderer/src/features/recording/recorder-store.ts:176-201,234-242`
- What happens: `beginEngine` runs `beginCursorTrackSession` and `startEngine` in a `Promise.all`. If `startEngine` rejects first, the catch runs `recordingAbort(id)`, and main calls `cursorTracks.discard(id)` while no tracker exists yet. Then main's `cursorTrackStart` handler resumes from `await displayIdForSource()` and calls `cursorTracks.start(id, display)` and `clickHook.ensureRunning()` for a session that is already dead. Nothing ever finishes or discards that id: session ids only increase, and `forceReset` runs only on a renderer crash. So `screen.getCursorScreenPoint()` keeps running every 8 ms on the main thread (the thread that also serializes chunk writes), the uiohook mouse hook stays installed while idle, and the sample buffer grows up to `MAX_CURSOR_SAMPLES` (1M samples). `stopHookIfIdle` never stops the hook again, because `cursorTracks.active` stays true. The same thing happens when the renderer's 500 ms handshake timeout wins and the take is then cancelled or fails. This adds continuous main-thread work, which matters given the "feels slower" complaint. Measure it by checking `cursorTracks.all().length` after a failed start.
- Evidence: There is no "is this session still alive" check after the `await` in the `cursorTrackStart` handler. The writer has the session map, but it is not consulted.
- Fix sketch: After the await, `if (!writer.has(sessionId)) return { enabled: false };` (add `has()`), or keep an `abortedSessions` set that `recordingAbort` fills.
- Effort: S

### REC-B5. The close guard's 5 s timeout closes the window without a stop, leaving the hub "recording" forever, and its stale `ipcMain.once` listener later closes the next window

- Severity: medium
- Category: logic
- Confidence: plausible (needs stop to take longer than 5 s; path confirmed)
- Where: `main/index.ts:171-193` (close guard), `main/index.ts:619-640` (quit guard), `main/index.ts:157-160`
- What happens: The user confirms "Stop and close". If `recordingStop` does not arrive within 5 s, `finishClose` closes the window with `closingWithRecording = true`. That happens when the renderer is hung, or when finalize is slow; the realistic case is a vault on another volume, where `rename` falls back to `copyFile` and a 1 h take (about 0.5–1.4 GB) takes well over 5 s on USB. A normal close does not emit `render-process-gone`, and the `closed` handler does not call `hub.forceReset()`. So: hub `activity.active` stays true, and the bar stays up showing "Saving…". If the renderer died before invoking finalize, the writer session and `.part` leak and the cursor tracker and click hook keep running. `triggerStartRecording` answers "already recording" until restart, and every quit prompts and then waits 5 s. Separately, the `ipcMain.once(recordingStop)` registered by the guard is never removed on timeout. The next time any recording stops, it fires `finishClose` → `mainWindow.close()` and closes the window the user just got back. The quit guard has the same timeout: `app.quit()` after 5 s kills main in the middle of `copyFile`. That leaves a truncated `<id>.mp4` in the vault, which `vault.list()` includes because it lists any `.mp4`, plus the `.part` in tmp.
- Evidence: `closed` handler at :157-162 only nulls state. `forceReset` is wired only to `render-process-gone` (:218-223). The once-listeners are not removed in the timeout branch.
- Fix sketch: In the timeout branch, remove the once-listener and call `hub.forceReset()` (which should also abort writer sessions, see REC-B7). Call `forceReset` from `closed` when the hub is active. In the quit path, wait for an in-flight finalize (not a fixed 5 s) once the renderer has acknowledged the stop.
- Effort: M

### REC-B6. When finalize fails after closing the session, the complete recording is stranded as an invisible `.part` in tmpdir

- Severity: high
- Category: error-handling
- Confidence: confirmed
- Where: `main/recording/recording-writer.ts:114-127`, `renderer/src/features/recording/recorder-store.ts:360-368`
- What happens: `finalize` closes the handle and deletes the session (:114-115) before it creates the vault folder and moves the file. If `mkdir(vaultDir)` fails, the error propagates. It fails when the vault is on an external drive that was unplugged mid-take (`/Volumes/...` → EACCES/ENOENT), or the folder is unwritable or on an unreachable network share. The same happens when `copyFile` fails (cross-volume ENOSPC). The renderer shows "couldn't save", and its retry action starts a _new_ recording. It then calls `recordingAbort`, which is a no-op because the session is already gone. The finished `kaipu-rec-session-N.mp4.part` (moov written, fully playable) stays in `os.tmpdir()`. Nothing points the user to it, nothing in the app ever sweeps or recovers `kaipu-rec-*` (grep: the name appears only in `recording-writer.ts:55`), and macOS purges `$TMPDIR` periodically. A failed `copyFile` can also leave a partial `<id>.mp4` in the vault, which the library lists as a broken recording.
- Evidence: The order in `finalize` is close → delete → mkdir → rename/copy. There is no try/catch that restores the session or moves the file somewhere visible. The vault-folder-change fix (#30) validates the folder when the setting changes, not when the drive disappears mid-take.
- Fix sketch: Resolve and `mkdir` the destination _before_ closing and deleting the session. On a move failure, keep the `.part` and offer to save it elsewhere (save dialog) or move it to a fallback folder (`~/Movies/Kaipu Recovered`). Clean up a partial dest on copy failure. Optionally sweep or offer `kaipu-rec-*.part` recovery on launch.
- Effort: M

### REC-B7. After a renderer crash the writer session is never closed, and the next renderer reuses `session-1`, truncating the crashed take's `.part`

- Severity: medium
- Category: resource-leak
- Confidence: confirmed (code path) / plausible (frequency)
- Where: `main/recording/recording-hub.ts:321-327`, `main/recording/recording-writer.ts:54-58`, `renderer/src/features/recording/recorder-store.ts:74,163`
- What happens: `forceReset` discards cursor tracks and the hook but leaves `writer` sessions alone, so the crashed take's FileHandle stays open and its `.part` (all media up to the crash, progressively written since `fastStart:false`) stays in tmp. Nothing reloads the crashed window: `forceReset` → `applyStopWindowState` → `main.show()` shows a blank, dead renderer. Once the window is recreated, the module counter restarts and the first take is `session-1` again. `writer.create("session-1")` then `open`s the same temp path with `"w+"`, which truncates the crashed take's data. It also overwrites the map entry and leaks the old FileHandle for the life of the process.
- Evidence: `sessionCounter` is module state in the renderer (resets on reload). The temp name is derived only from the session id. `create()` does not check for an existing entry.
- Fix sketch: Have `forceReset` call `writer.abortAll()`, or better keep the `.part` and rename it to a recoverable name. Generate session ids in main (or include a renderer-instance nonce/timestamp). Reload the main window's webContents on `render-process-gone`.
- Effort: S

### REC-B8. The cursor-track tail cut uses a clock that starts ≥150 ms after video time 0, so the last frames can lose their cursor samples

- Severity: low
- Category: logic
- Confidence: plausible
- Where: `renderer/src/features/recording/recorder-store.ts:221,332`, `main/recording/recording-hub.ts:214-218`
- What happens: `clock = startElapsed(Date.now())` runs only after `startEngine` resolves, which includes `captureThumbnail` (play + 150 ms + JPEG encode). Video t0 (`firstMediaTimestamp`) is the first frame after `output.start()`, earlier by roughly 200–300 ms. `durationMs` therefore underestimates the video length by about that much, and the `+ 250` margin meant to cover "the last frame's own duration and clock jitter" is mostly consumed by this offset. Samples in the final ~0–100 ms of the video can be cut, and the cursor freezes or vanishes on the last frames in the editor. `durationMs` is also wall-clock (`Date.now`), so an NTP adjustment mid-take skews it.
- Evidence: Read order in `beginEngine` and `startEngine` (`startedAt` at engine:286 vs `thumbnail` at :307).
- Fix sketch: Derive `maxMs` from main's anchor (`t0`) plus the last cut by `performance.now()` at stop (both clocks are already available), or start the elapsed clock from `firstMediaTimestamp`.
- Effort: S

## Checked and fine

- Two overlapping sessions: `requestStartRecording` no-ops unless `idle`, and the hub is `active` from `recordingStart` (sent before streams are acquired) until `recordingStop`. `triggerStartRecording` refuses while the hub is active, and the start shortcut during `counting` only reaches the store's idle guard.
- Stop during `counting` (instant cancel), during `starting` (`cancelRequested` consumed after `Promise.all`), and double stop (`stopping` guard): all correct. An engine `onError` racing a user Stop is guarded.
- Write failure: the first failed `writer.write` sends one `"stop"` (`stoppedForWriteFailure`), `finalize` refuses the session and unlinks it, and the user gets the save-error toast once the window reappears (Known #7 fix holds).
- `writer.finalize`/`abort` await the serialized write queue before closing. IPC `send` (writes) and `invoke` (finalize) keep order, and the renderer awaits `output.finalize()` before invoking finalize, so no chunk arrives after the handle is closed.
- `recordingAbort` cannot reject in practice (the queue never rejects; close/unlink are caught), so the store's catch blocks always reach `recordingStop` and the store never sticks in `finalizing`/`starting` from that.
- Display unplugged / sharing revoked mid-take: the screen track's `ended` → `onError` → normal stop path finalizes what was recorded (mediabunny finalize succeeds when only the track ended).
- System audio unavailable: falls back to video-only. `forwardLiveSettings` writes the toggle back to false, and the mic late-acquire is guarded against a concurrent take end (`stopped` re-check).
- Cursor handshake: bounded by a 500 ms race and every IPC failure degrades to a no-op session. Pause/resume edges are converted to the main clock with a measured offset. A tracker that never receives an anchor builds `null` at finalize and is removed (it only leaks if the session is never finalized; see REC-B4).
- Click hook unavailable (no Accessibility, native load failure): `ensureRunning` returns false, and the track is built with `clicksAvailable=false`. Load failure is cached (`loadFailed`).
- `resolveInput()` throwing at countdown end (store:135, outside the try) would leave status `"starting"` forever, but it is unreachable today: `selectedSource` is never set back to `null` anywhere, and refs survive unmount.
- Pause/resume commands are not status-gated (a pause during `finalizing` would overwrite the status), but the bar hides its buttons on the `"saving"` tick and the Record page is hidden during the take, so this is not reachable through the UI.
