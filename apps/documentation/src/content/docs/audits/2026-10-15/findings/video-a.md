---
title: "Edit video — Lens A (performance, optimizations, resource leaks, observability)"
description: "Detailed findings from the 2026-10-15 pre-deploy audit: Edit video — Lens A (performance, optimizations, resource leaks, observability)."
---

> Part of the [2026-10-15 audit report](/audits/2026-10-15/report/). Paths are relative to `apps/kaipu-record/src/`.

## Summary

The export pipeline is in good shape on the things that usually go wrong: workers are terminated on every exit path, `Input.dispose()` runs in both workers, progress is throttled to 4 Hz, the MP4 muxer flushes in ~0.5 s chunks (so per-chunk IPC is cheap), and the GIF encoder streams frames instead of holding them all. The slowness the owner feels is more likely to come from the editor page itself. Every playhead state change re-renders the whole 1545-line editor, and `usePreviewPlayback` returns a new object on every render, which defeats every `useCallback` and effect built on it. Opening the editor also reads the whole recording file into a Blob just to decode 24 timeline thumbnails. **The single most important item is VID-A1, which is about data rather than speed:** a failed session restore is swallowed silently, the editor opens a blank scene, and the first edit's autosave overwrites the user's saved session and deletes its slide PNGs. Observability is thin: errors and encoder fallbacks are reported, but no export duration, speed, size or success metric exists anywhere.

## Findings

### VID-A1. A failed session restore silently opens a blank scene; the first edit overwrites the saved session and prunes its slide assets

- Severity: high
- Category: error-handling
- Confidence: confirmed for the code path. Plausible for how often the trigger happens.
- Where: `renderer/src/pages/video-editor/video-editor-page.tsx:299-337`, `renderer/src/features/video-editor/slide-assets.ts:79-89`, `main/library/video-edit-session.ts:119-137`
- What happens: the loader can throw for several reasons: `loadVideoEditSession` rejects, or any slide PNG fails `restoreAsset`. A PNG fails `restoreAsset` when `measureNaturalSize` rejects on an undecodable image. Any of these throws is caught by the outer `catch {}` (line 334), which calls `open(initialScene(...))` with no toast and no `captureException`. The user sees an unedited recording. On their first edit, `useSessionAutosave` writes this fresh scene over `<id>.edit.json`. `saveSession` then prunes every PNG that is not in the asset store, including the slides that come after the one that failed. All previous cuts, zooms, redactions and slides are lost, and nothing about it shows up in telemetry.
- Evidence: the asset files are written non-atomically with plain `writeFile(assetPath)` (line 120), unlike the session JSON's temp-and-rename. A crash or quit in the middle of a write can therefore leave a truncated PNG, which is the realistic trigger. The "invalid session" branch (line 325) at least shows a toast. The throw branch shows nothing. Restored assets are added in order (line 309-312), so the ones before the failing asset stay in the store and the ones after it are pruned on the next save.
- Fix sketch: skip a single bad asset (try/catch per `restoreAsset`, then drop only that slide, which the filter on line 317 already does). In the outer catch, call `captureException` and refuse to autosave over a session that failed to load (for example, open read-only or show the `restoreError` toast and disable autosave). Write assets with temp-and-rename.
- Effort: S

### VID-A2. Every autosave re-sends and rewrites every slide PNG, including assets of deleted slides, which are never pruned

- Severity: medium
- Category: performance
- Confidence: confirmed
- Where: `renderer/src/features/video-editor/use-session-autosave.ts:64-67`, `main/library/video-edit-session.ts:117-137`, `renderer/src/pages/video-editor/video-editor-page.tsx:308-312`, `slide-assets.ts:95-97`
- What happens: `write()` sends `assetStore.entries()` with their full `bytes` on every save. Main then rewrites each PNG with `writeFile`. The store never forgets an asset (by design, so redo keeps working), so `keptIds` includes the images of slides the user deleted, and the prune pass never removes them. On the next open, the loader restores every PNG in the folder, so the orphans come back and are re-sent forever.
- Evidence: magnitude (illustrative): three pasted Retina screenshots at ~4 MB each, one of them later deleted, cost ~12 MB structured-cloned over IPC plus 12 MB of disk writes per autosave. That happens once per edit (800 ms debounce), for the life of that recording. The MP4 and GIF `onSaved` paths (lines 637-640 and 775-777) send the same full set. A second issue follows from this: two saves can overlap when one takes longer than 800 ms (`write` has no in-flight guard), and both use the same `${sp}.tmp` path. The second `rename` can then hit ENOENT, and the chip shows "failed". To measure: log the payload byte count in `saveSession`.
- Fix sketch: send only the assets referenced by `scene.items` (as `usedAssetIds` already does in export-runner), and skip rewriting an asset whose file already exists. Asset ids are content-stable UUIDs. Serialize writes, either by chaining a promise in `write` or by using a unique tmp name.
- Effort: S

### VID-A3. Opening the editor reads the entire recording into a Blob to decode 24 thumbnails (and export/GIF do the same)

- Severity: medium
- Category: performance
- Confidence: confirmed
- Where: `renderer/src/features/video-editor/use-source-thumbnails.ts:27-28`, `export/export-runner.ts:318-319`, `export/use-gif-export.ts:149`
- What happens: `fetch(kaipu-media://recording/<id>).blob()` reads the whole file through the protocol before mediabunny sees a byte. At the recording baseline of 12–23 MB/min, a 10-minute take means 120–230 MB read (and copied into Chromium's blob store) before the first thumbnail. That read competes for disk with the `<video>` element loading the same file, on every editor open. The `Input` built here is never disposed, so it and the Blob stay reachable until GC. Export and the GIF estimate each make another full copy. The GIF one is cached in `sourceRef` for the editor's lifetime once the sheet has run an estimate.
- Evidence: `probe-source.ts:29-31` already uses `UrlSource` over the same Range-aware protocol (`main/media-protocol.ts:11`). Mediabunny then fetches only the container metadata and the packets it needs. For 24 seeks that is a small fraction of the file. To measure: the time from editor mount to `setThumbnails` on a 10-minute take, and the renderer's blob-storage memory in `chrome://blob-internals` via devtools.
- Fix sketch: use `new UrlSource(mediaUrl)` in `useSourceThumbnails` (and `input.dispose()` in a finally). Consider passing a URL instead of a Blob to the export and GIF workers too, since workers can fetch the custom protocol if it is registered with `supportFetchAPI` (verify in a worker first).
- Effort: S

### VID-A4. The whole editor re-renders on every playhead update, and `playback` changes identity every render, defeating all memoization

- Severity: medium
- Category: performance
- Confidence: confirmed (mechanism). The cost per render is not measured.
- Where: `renderer/src/features/video-editor/use-preview-playback.ts:85,252,354,385-402`, `renderer/src/pages/video-editor/video-editor-page.tsx:404,1105-1126,826-831`, `components/timeline-strip.tsx:80-85,117-131`
- What happens: `timelineTime` is React state on the page. Four things set it:
  - `seek()`, once per pointermove while scrubbing the ruler;
  - `timeupdate`, about 4 Hz during playback;
  - the 250 ms slide interval;
  - each `advanceFrom`.

  Each of these re-renders `VideoEditor` and everything under it: TimelineStrip with all five lanes, the annotation layer, the inspector, the toolbar. Nothing in the feature uses `React.memo`, and no React Compiler is configured. On top of that, `usePreviewPlayback` returns a fresh object literal (line 385), so every `useCallback` and effect with `playback` in its deps is recreated on each render. That includes the global `keydown` listener (removed and re-added every render), the TimelineStrip `subscribeTime` subscription, the `[layout, playback]` seek effect, and `handleExport`, `gifJobArgs` and `startVideoExport`. Drags make it worse: every `updateLive` re-renders the page, and camera-box or zoom-slider drags also rebuild the camera path once per frame. By the hook's own comment that rebuild costs 26 ms for a 1 h source, so roughly 4–7 ms per frame on a 10–15 min take, before React's work.

- Evidence: the playhead itself was already moved off React (`subscribeTime` + direct style mutation, timeline-strip.tsx:78-85). The page-level state undoes that win for every other component.
- Fix sketch: wrap the hook's return in `useMemo`. Move `timelineTime` consumers that only need the current time on demand (split, add zoom, `visibleIds`, the time display) to `subscribeTime` or a ref, or to a narrow child component. Wrap lanes and the inspector in `React.memo` with stable props. To measure: React Profiler commit durations while dragging the ruler on a 10-minute take with zooms and redactions.
- Effort: M

### VID-A5. Export and GIF workers allocate a new full-size canvas for every decoded frame, including frames the fps cap then drops

- Severity: medium
- Category: performance
- Confidence: confirmed (code and mediabunny's documented behaviour). The wall-clock impact is not measured.
- Where: `renderer/src/features/video-editor/export/export-worker.ts:292-313`, `export/gif-worker.ts:98-100`
- What happens: `new CanvasSink(videoTrack, {width, height, fit})` has no `poolSize`. Per `mediabunny.d.ts:789-795` ("A pool size of 0 or undefined disables the pool and means a new canvas is created each time"), every decoded frame gets a fresh OffscreenCanvas at compose size. The `cap.keep(outTs)` check (line 313) runs only after the frame has already been drawn into that new canvas. With the quality tiers capped at 24 fps, a 60 fps source wastes 60% of those canvas draws.
- Evidence: magnitude: a 10-minute 1080p, 30 fps source allocates 18,000 canvases of ~8 MB each, about 144 GB of allocation churn over the export. At 60 fps it is 36,000. This becomes GC pressure and GPU/VRAM churn on the hot path. To measure: the export's realtime factor before and after setting `poolSize: 2`, using a 5-minute source.
- Fix sketch: pass `poolSize: 2` to both sinks. `compose.clip` draws synchronously and `videoSource.add` is awaited before the next iteration, so the canvas is free to reuse. Optionally switch to `VideoSampleSink`, check the cap on the timestamp first, and draw only the frames that are kept (closing the sample either way).
- Effort: S

### VID-A6. No export or editor-open metrics: duration, speed, size and success rate are not measured anywhere

- Severity: medium
- Category: observability
- Confidence: confirmed
- Where: `renderer/src/features/video-editor/export/export-runner.ts:207-222,300-307,398-438`, `renderer/src/features/analytics/analytics-client.ts:51`, `use-source-thumbnails.ts:55-57`, `video-editor-page.tsx:286-288,334-337`
- What happens: failures (`video-export`, `gif-export`, `video-export-fast-start`) and encoder fallbacks (`video-export-software-encoder`, `video-export-no-quantizer`) are reported through `captureException`. That is good. Several things are not recorded at all:
  - a successful export;
  - how long it took, or its realtime factor (output seconds per wall second);
  - the output size against `estimateBytes`;
  - the preset;
  - a cancellation;
  - how long the editor took to become interactive.

  `captureEvent` is called exactly once in the whole renderer (`use-missing-recording-recovery.ts:67`). Thumbnail decode failures and cursor-track load failures are swallowed with an empty `catch {}`. "Exports got slower in 1.x" or "the Light estimate is 2× off on Intel Macs" therefore cannot be seen from production.

- Evidence: `attemptStartedAt` is already tracked (line 296), so the duration is one subtraction away. `job.estimateBytes` and `recording.sizeBytes` are both in scope at `done`.
- Fix sketch: at `done`, call `captureEvent("video-export-finished", {presetId, outputSec: plan.totalDuration, elapsedMs, realtimeFactor, bytes, estimateBytes, rateControl, softwareFallback, retriedWithoutFastStart})`. Add matching `...-cancelled` and GIF events, and an `editor-opened` event with the loader's elapsed ms and the cursor-track size.
- Effort: S

### VID-A7. Editor home decodes the whole clipboard image on the main process every time the window gains focus

- Severity: low
- Category: performance
- Confidence: plausible (code confirmed, cost not measured)
- Where: `renderer/src/pages/editor/editor-home-page.tsx:160-180`, `main/screenshots/screenshot-ipc.ts:72-75`
- What happens: `useClipboardImageSize` calls `peekClipboardImage` on mount and on every `focus`. The main handler runs `clipboard.readImage()`, which synchronously decodes the full pasteboard image into a NativeImage just to return `getSize()`. A 5K Retina screenshot is about 59 MB of RGBA, likely tens of ms of main-thread time on each focus. The main thread is also the one that services recording chunk writes and every other IPC.
- Fix sketch: check `clipboard.availableFormats()` for an image type first (cheap) and return null otherwise. Accept the decode only when an image is actually present, or show the hint without dimensions.
- Effort: S

### VID-A8. Editor open is fully serial and does all cursor-track work synchronously on first render

- Severity: low
- Category: optimization
- Confidence: confirmed
- Where: `renderer/src/pages/video-editor/video-editor-page.tsx:279-312,420-425`, `zoom/use-camera-path.ts:31-33`
- What happens: the loader runs these steps one after another:
  1. awaits `loadCursorTrack`;
  2. then awaits `loadVideoEditSession` (independent of the track);
  3. then awaits each `restoreAsset` (an image decode) in turn.

  Only after that does `VideoEditor` mount, at which point it synchronously runs `detectZoomSegments` (fresh open), `buildCameraPath` (in `useState` init) and `activityMarks` (a second `findDwells` pass). After mount it starts the thumbnail fetch (VID-A3) and `probeSource`. For a typical 10-minute take this is a few tens of ms. For a 1 h take the cursor JSON is roughly 10 MB at 125 Hz, and the camera path alone is 26 ms.

- Fix sketch: `Promise.all([loadCursorTrack, loadVideoEditSession])` and `Promise.all` over `restoreAsset`. Optionally move `activityMarks` to idle time. To measure: `performance.mark` from route entry to first `VideoEditor` commit (fits VID-A6).
- Effort: S

### VID-A9. An export write failure stops the user's live recording, and the export keeps encoding until finalize fails

- Severity: low
- Category: error-handling
- Confidence: plausible (needs a recording running during a background export, plus a failed disk write)
- Where: `main/recording/recording-hub.ts:174-193`, `renderer/src/features/recording/recorder-store.ts:387-391`, `export/export-runner.ts:375-376`
- What happens: export chunks go through the recorder's `recording:write` channel, which is fire-and-forget. On the first failed write, main sends `recordingCommand "stop"` to the main window. That reaches `stopOrCancelRecording()`, so a recording started while the export runs in the background is stopped by the export's disk error. The export itself is never told: it encodes to the end, and only `recordingFinalize` rejects. `stoppedForWriteFailure` is a single flag shared by both sessions and is reset by whichever `recordingCreate` came last.
- Fix sketch: track write failure per session id in main, and send "stop" only for the recorder's session. For export sessions, notify the export runner (or have it poll `recordingStat`) so it can terminate early.
- Effort: S

### VID-A10. ImageBitmaps leak on cancel/supersede paths, and the module-level runner keeps the last editor's closure alive

- Severity: low
- Category: resource-leak
- Confidence: confirmed
- Where: `export/export-runner.ts:147,227,355`, `export/use-gif-export.ts:179-181`
- What happens: `rasterizeOverlays` and `createImageBitmap` produce bitmaps that are transferred to the worker only on the happy path. When the export is cancelled while they are being built (line 355 `if (!active) return`), or a GIF estimate is superseded (line 181), they are dropped without `.close()` and wait for GC (GPU-backed memory). Separately, `lastStart` keeps the last export's `args` for Retry forever. Those args include the scene, the camera path (about 2.6 MB per hour of source) and the `onSaved` closure, which captures the whole `VideoEditor` render scope (controller, autosave, refs) after the user has left the editor.
- Fix sketch: close the overlay and slide bitmaps on early returns. Clear `lastStart` when a Ready card is dismissed or the export succeeds, since Retry only exists for errors.
- Effort: S

## Checked and fine

- Per-chunk export IPC: the non-fragmented MP4 muxer only calls `writer.flush()` when a ~0.5 s chunk is finalized (`isobmff-muxer.js` `finalizeCurrentChunk`). That means about 4 `recording:write` messages per output second, each one copy in the worker plus one clone to main. This is fine, and `chunked: true` is not needed.
- Progress throttling: both workers post at most every 250 ms. The runner's `set()` notifies only `useSyncExternalStore` subscribers.
- Worker lifetimes: the export worker is terminated on done, fail, cancel and the fast-start retry. The GIF export and estimate workers are terminated on finish, cancel and hook unmount. `input.dispose()` runs in a `finally` in both workers. `out.cancel()` runs on every non-finalized path. AudioSamples are closed after `add`.
- GIF memory: frames are streamed into `GifStreamWriter`. Only the 8 palette samples (or 10 estimate frames) are held at once, not every RGBA frame.
- `use-camera-path.ts` effect without deps: it is a reference compare plus a single coalesced rAF, cancelled on unmount. That is cheap. The cost is the rebuild itself (folded into VID-A4).
- `use-video-frame-clock.ts`: it subscribes once per element. Live updates re-apply the callback without cancelling rVFC. The cleanup cancels the callback and removes the listeners.
- `redaction-layer.tsx` per-frame `querySelector`: it is scoped to the layer's own subtree, with one lookup per visible redaction (usually a handful). This is negligible next to `drawPixelated`, which is needed anyway.
- Object URLs: thumbnail URLs are revoked on cleanup, including the mid-`toBlob` cancel case. The slide store revokes its URLs on loader unmount, and `put` and `restoreAsset` revoke on decode failure.
- `findDwells` / `detectZoomSegments`: these are O(n · runLength) on real tracks, because samples are stored only when the pointer moves. They are bounded by `MAX_CURSOR_SAMPLES` = 1,000,000.
- Autosave during drags: the effect returns early while `interacting`, so a drag produces one write per gesture rather than one per pointermove. `serializeSession` of the scene itself is small. The cost is the assets (VID-A2).
