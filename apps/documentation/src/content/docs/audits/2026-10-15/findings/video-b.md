---
title: "Edit video — Lens B (error handling, bugs, logic, races, data integrity)"
description: "Detailed findings from the 2026-10-15 pre-deploy audit: Edit video — Lens B (error handling, bugs, logic, races, data integrity)."
---

> Part of the [2026-10-15 audit report](/audits/2026-10-15/report/). Paths are relative to `apps/kaipu-record/src/`.

## Summary

The persistence and export plumbing is generally careful: atomic session writes, the unmount and `beforeunload` flushes, the `active` guards in both export runners, `.part` cleanup on cancel and on write failure, the 64 MB GIF cap, and the monotonic video timestamp rebasing all hold up. The weakest area is the clip trim interaction. **The most important problem is that dragging a clip's START trim handle does not track the pointer.** Each pointermove adds the pointer's offset again, so a 3 px drag trims about 14 s instead of about 5 s (VID-B1). Trims also have no bounds. A clip can be extended into footage that a neighbouring clip already shows, which makes the preview loop. It can also be extended past the end of the source, which gives the export a frozen frame and A/V desync after that point (VID-B2). The other findings are data-integrity edges:

- an invalid or unreadable session is silently overwritten by the first edit (VID-B3);
- the export runner has no per-run token, so one sequence (cancel during prep, then a new export) produces two concurrent workers (VID-B4);
- vault ids have one-second resolution and finalize does not check for collisions (VID-B5).

## Findings

### VID-B1. The start-edge trim drag runs away from the pointer: each pointermove re-adds the offset

- Severity: high
- Category: bug
- Confidence: confirmed (the arithmetic is traced through the real code; it was simulated, not run in the app)
- Where: `renderer/src/features/video-editor/components/timeline-strip.tsx:284-285` (`sourceTimeFromPointer`), `:304-307`; `renderer/src/pages/video-editor/video-editor-page.tsx:836-853` (`handleTrim`); `renderer/src/features/video-editor/timeline.ts:117-119`
- What happens: when the user drags a clip's left trim handle to the right (for example, to trim the "reaching for Record" intro), the trim grows on every pointermove even though the pointer moved only 1 px. Example: one 60 s clip, 600 px track. Pointer at 50 px gives 5.00 s, 51 px gives 9.68 s, 52 px gives 14.04 s, and 55 px gives 25.4 s. Dragging left of the handle runs away in the other direction.
- Evidence: `sourceTimeFromPointer = entry.sourceStart + (timeFromPointer(event) - entry.timelineStart)` is relative to the entry's CURRENT `sourceStart`. Each live update changes `sourceStart`, and the page re-renders the `TrackBlock` with the new `entry`. A start trim does not move `timelineStart`, so the handle stays where it is. The next pointermove therefore adds the full pointer-to-handle offset again. The end edge is unaffected because neither `sourceStart` nor `timelineStart` changes during an end trim. There are no tests for drag phases on the start handle (`timeline-strip.test.tsx` only checks that the handles render), and `timeline.test.ts:158` only tests `trimClip` in isolation.
- Fix sketch: capture `{ origSourceStart, origTimelineStart, pointerT0 }` on pointerdown and compute `origSourceStart + (t − pointerT0)` from that fixed baseline. The overlay lane's body drag already uses this pattern (`overlay-lane.tsx:92`).
- Effort: S

### VID-B2. Clip trims have no bounds: extending into a neighbour's footage makes the preview loop, and extending past the source end freezes the export and desyncs its audio

- Severity: medium
- Category: logic
- Confidence: confirmed (code path); the export outcome is inferred from the worker code
- Where: `renderer/src/features/video-editor/timeline.ts:109-124` (`trimClip`), `timeline.ts:75-83` (`sourceToTimeline`), `renderer/src/features/video-editor/use-preview-playback.ts:330-351`, `renderer/src/features/video-editor/export/export-worker.ts:299`, `:380-381`
- What happens:
  - (a) Overlap. Split a 20 s clip at 10 s into A[0,10] and B[10,20], then drag B's start handle left (or A's end handle right). Now A and B share source time, for example A[0,15] and B[10,20]. When preview playback reaches the end of A, it seeks to `B.sourceStart = 10`. `sourceToTimeline(10)` returns A's mapping, so the playhead jumps back to 10. A plays to 15, `advanceFrom` seeks to 10 again, and this repeats forever: B is never previewed. Seeking into B also snaps the playhead into A. The export renders A and B correctly, so the preview and the export disagree.
  - (b) Past the source end. With A[0,30] and B[30,60] (60 s source), drag A's end right. The first move sets `A.sourceEnd = 60`. The timeline grows to 90 s, so the next move at the right edge maps to t = 90 and sets `A.sourceEnd = 90`, past the media. In the preview, the `<video>` fires `ended` at 60 and `onVideoEnded` stops playback, so B cannot be reached by playing. In the export, `CanvasSink.canvases(0, 90)` yields frames only up to 60, and B's frames start at outTs 90, so the muxer stretches A's last frame over 30 s. The audio is laid on a contiguous `audioCursor`, which reaches about 60 s after A, so all of B's audio plays 30 s ahead of its video.
- Evidence: `trimClip` clamps only to `[0, other edge ∓ MIN_ITEM_DURATION]`. It knows neither the source duration nor the neighbours, and `handleTrim` adds no clamp. `sourceToTimeline` returns the FIRST clip whose source range contains the time. `parseSession` (`session.ts:185-193`) does not validate clip ranges either, so these states persist.
- Fix sketch: pass the source duration (and the neighbouring clips' source ranges, if overlap should be disallowed) into `trimClip` and clamp there. Alternatively, make the preview's source-to-timeline mapping prefer the entry under the current `timelineTime`.
- Effort: S–M

### VID-B3. An invalid or unreadable session file is silently replaced by the first edit; `loadSession` treats every read error as "no session"

- Severity: medium
- Category: error-handling
- Confidence: confirmed
- Where: `main/library/video-edit-session.ts:170-177`; `renderer/src/pages/video-editor/video-editor-page.tsx:322-337`; `renderer/src/features/video-editor/use-session-autosave.ts:102-114`
- What happens:
  - If `.edit.json` fails `parseSession` (corruption, one unknown overlay or item kind written by a newer build, or any non-finite number that `JSON.stringify` turned into `null`), the editor shows the `restoreError` toast and opens a fresh scene. The first edit makes autosave write that fresh scene over the old file. All cuts, zooms and redactions in the old file are then gone for good, and nothing was backed up.
  - A transient read error (`EMFILE`, `EACCES`, `EBUSY`) is worse: `readFile`'s catch returns `null`, which means "fresh open, no toast". The user is told nothing, and the first edit overwrites a valid session.
  - An IPC failure also falls into the silent catch at `:334-337`.
- Evidence: the main-side catch does not inspect `error.code`. `parseSession` rejects the whole session if any single item, overlay, zoom or redaction is invalid (`session.ts:75-86`). Autosave's `openedWith` guard only prevents writing the untouched scene; any edit after that is written over the file.
- Fix sketch: in `loadSession`, return `null` only for `ENOENT` and rethrow other errors. On a parse failure, rename the file to `<id>.edit.json.bad-<ts>` before opening fresh, or disable autosave for that session until the user confirms.
- Effort: S

### VID-B4. Cancel during export prep followed by a new export runs two workers; one writer session and its `.part` file leak

- Severity: medium
- Category: race
- Confidence: plausible (the full path is traced; the timing window is the prep phase)
- Where: `renderer/src/features/video-editor/export/export-runner.ts:316-323`, `:327-370`, `:374`
- What happens: export A is in its prep phase (`fetch(...).blob()` of the whole source, then `rasterizeOverlays` and `createImageBitmap`); this can take seconds on a large recording. The user cancels, which sets `active = false`. The user then starts export B (Export, then the sheet, or Share from the library), which sets `active = true`. Then A's awaits resume:
  - A's `if (!active) return` checks pass because the flag belongs to B.
  - A opens its own writer session, overwrites `sessionId` and `worker`, and starts a second worker.
  - Whichever run assigned `worker` first now has every message ignored (`worker !== runWorker`), including `done`. Its `.part` file and `FileHandle` in main are never finalized or aborted, and its worker keeps encoding at full CPU until it finishes.
  - If A assigned `worker` last, the user's export B is the one discarded, and the file that lands is A's (old preset and old scene), while the card shows B's job.
  - A's `fail` closure can also tear down B.
- Evidence: the module-level `active` boolean is the only liveness guard, and it is not tied to a run.
- Fix sketch: increment a `runId` per start, capture it in the `launch` and `fail` closures, and compare it after every await instead of `active`.
- Effort: S

### VID-B5. Vault ids have one-second resolution and finalize does not check for collisions, so two finalizes in the same second overwrite each other

- Severity: medium
- Category: bug
- Confidence: confirmed (code path); the trigger is rare
- Where: `main/recording/recording-writer.ts:118-127`, `:162-165` (`timestampId`); `main/recording/recording-hub.ts:77`; `main/library/index.ts:146`; `main/library/library-vault.ts:89-95`
- What happens: the export runs in the background and shares one `RecordingWriter` with the recorder. If a background export finishes in the same wall-clock second as a recording stop (or a GIF save), both get the same id, `recording-YYYY-MM-DD-HH-MM-SS`:
  - `vault.filePath(id)` returns the EXISTING `<id>.mp4`, and `rename` silently replaces it, losing the earlier file.
  - For MP4 plus GIF, both share `<id>.json` and `<id>.jpg`, so one item's title and thumbnail are overwritten, and `filePath` resolves both items to the first extension.
- Evidence: the comment says "does not exist yet", but nothing verifies it. Neither `newId` nor `saveGif` retries or adds a suffix on a collision.
- Fix sketch: add milliseconds or a random suffix to `timestampId`, or loop until `filePath(id)` does not exist (`fs.link` or `COPYFILE_EXCL` makes this atomic).
- Effort: S

### VID-B6. Concurrent session saves share one `.tmp` path: one save fails spuriously and can leave the session JSON referencing a slide PNG that was never written

- Severity: low
- Category: race
- Confidence: plausible
- Where: `main/library/video-edit-session.ts:106-121`, `:161`; `renderer/src/features/video-editor/use-session-autosave.ts:60-79`; `renderer/src/pages/video-editor/video-editor-page.tsx:666-677`
- What happens: two `saveSession(id)` calls can overlap:
  - an in-flight autosave and the window-close or `beforeunload` flush, because `pendingRef` stays true until the write resolves;
  - an in-flight autosave and the export's `onSaved` save, because `autosave.cancel()` cannot stop a write already in flight;
  - two debounced writes, when a write takes longer than 800 ms (every save re-sends and re-writes every slide PNG over IPC).

  Both calls write `<id>.edit.json.tmp`. The first `rename` moves the second call's half-written file into place, and the second `rename` then fails with `ENOENT`. That call throws before writing its asset PNGs and meta file. Results: the chip shows "failed" for a session that is in fact on disk. A newly added slide whose PNG was never written is dropped on the next open (`video-editor-page.tsx:314-319`). The `exportedSavedAt` stamp can be lost (read-modify-write race at `:161`), so a just-exported item reads "not exported".

- Fix sketch: use a unique temp name (`${sp}.${process.pid}.${counter}.tmp`) and serialize saves per id in main with a promise chain, as `RecordingWriter.queue` does. Optionally skip rewriting asset PNGs that are unchanged.
- Effort: S

### VID-B7. Clip trim, slide-duration and overlay-lane drags have no pointercancel or lost-capture handling, so an aborted gesture leaves the editor stuck in "interacting"

- Severity: low
- Category: bug
- Confidence: plausible (pointercancel for a mouse is uncommon)
- Where: `renderer/src/features/video-editor/components/timeline-strip.tsx:290-345`; `renderer/src/features/video-editor/components/overlay-lane.tsx:94-161`; `renderer/src/features/video-editor/use-video-scene.ts:51-99`
- What happens: if a drag ends without `pointerup` (system gesture, capture stolen, a context menu), `snapshot.current` stays set. From then on, `commit`, `undo` and `redo` silently do nothing, Split, Delete and Add image return early on `controller.interacting`, and autosave never schedules a write. This lasts until the user happens to start another drag. That later drag's `beginInteract` overwrites the stale snapshot, so the first drag's change can no longer be undone.
- Evidence: the zoom, privacy, audio, region and camera-box handles all wire `onPointerCancel` and `onLostPointerCapture` to an abort that reports `"end"` (`zoom-lane.tsx:98-99`, `privacy-lane.tsx:85-86`). The main track's trim and slide handles and the overlay lane do not.
- Fix sketch: add the same abort handlers that report the `"end"` phase. Optionally have `beginInteract` end any interaction that is still open.
- Effort: S

### VID-B8. `clampOverlays` runs on every live trim frame, so shortening the timeline briefly during one drag permanently truncates or deletes annotations

- Severity: low
- Category: logic
- Confidence: confirmed
- Where: `renderer/src/pages/video-editor/video-editor-page.tsx:843-850`, `:862-869`; `renderer/src/features/video-editor/timeline.ts:163-167`
- What happens: during an end-trim or slide-duration drag, each move clamps overlays against the live duration and writes the result into the live scene. The next move reads that already-clamped scene (`controller.scene.overlays`). Dragging shorter and then back longer in the same gesture therefore leaves annotations cut or dropped. Only undo restores them.
- Fix sketch: clamp from the snapshot taken at `"start"` (keep the original overlays in a ref for the duration of the drag) rather than from the live scene.
- Effort: S

### VID-B9. A library refresh that comes back with a vault error kicks the user out of the open editor

- Severity: low
- Category: error-handling
- Confidence: plausible
- Where: `renderer/src/pages/editor/editor-routes.tsx:21-25`, `:35-41`, `:64-72`; `renderer/src/features/library/hooks/use-local-library.ts:41-56`, `:133`
- What happens: the editor route re-lists the whole library on every `library:changed` broadcast (for example, when a background export finishes). If that list returns a `vaultError`, `result.items` contains no local items. The item is then not found, `useStableSource` returns `null` (the key is now `undefined`), and `<Navigate to=editor>` unmounts the editor mid-edit. The unmount flush still saves the edits.
- Fix sketch: keep the stable source while `hasError` is set, or resolve it once per mount.
- Effort: S

## Checked and fine

- Autosave contract: `pendingRef` is set before the `interacting` early return. The timer cleanup is declared before the flush effect. The Discard button cancels so the unmount flush does not write. A write that races a newer edit leaves `pendingRef` true and lets the next timer write. A failed write keeps the blocker armed.
- Quit and close with pending edits: `beforeunload` cannot await, so up to one debounce of work is at risk. This is a documented trade-off and not reported. The close and quit guards for an active export (`main/index.ts:198-216`, `:646-660`) cancel the export and clean up its `.part`.
- MP4 `onSaved`: a fingerprint check while still mounted, and a reload-and-compare after unmount, so a newer edit is never stamped as exported. GIF `onSaved` uses the scene captured at start, which is safe because the GIF `ExportDialog` is modal and editor shortcuts are suppressed while it runs.
- Export cancel: `teardown` terminates the worker and aborts the writer. `RecordingWriter.abort` waits for queued writes and then deletes the `.part`. The yield before finalize means a cancel in the same tick wins. A chunk write failure poisons finalize, so no corrupt file is promoted.
- The packet-reserve retry runs a fresh session and worker, and the stale worker's messages are filtered by `worker !== runWorker`.
- A source missing mid-export or at start: the fetch or the worker fails, and the generic error card offers Retry. An audio-less source and a whole-video mute skip the audio track cleanly.
- Video timestamps: `rebaseVideoTimestamp` with `prevOutTs` threaded across segments keeps them monotonic. VFR frames keep their own timestamps. Slide frames use a fixed cadence.
- GIF 64 MB cap: enforced in the worker while encoding (`gif-worker.ts:201`), again at finish, and again in main (`gif-save.ts:24-30`). `gifSave` is atomic and removes the item if its sidecar write fails.
- Auto-zoom detection on degenerate tracks: an empty track, a single click (only below the score threshold at low sensitivity), off-display clicks (`isOnDisplay` filter), clicks past the media end (`withMinDuration` clamps), a zero-size display (NaN comparisons fall through harmlessly), and a missing or invalid track (`withInitialZooms` returns the scene unchanged). `durationSeconds` is guarded > 0 by `isVideoEditorSource`. Merged ids `auto-<startMs>` are unique.
- Preview and export agree on the windows for redactions (padded inclusive vs frame-interval overlap), overlays (inclusive in both) and mute (per-sample zeroing; at most one AAC frame of granularity).
- `parseSession` drops overlapping zooms, clamps blur intensity and zoom scale, and rejects zero-length mute ranges.
- Undo and redo are blocked mid-drag (the snapshot guard); a no-op `endInteract` adds no history entry.
