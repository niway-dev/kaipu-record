---
title: Audit report — 2026-10-15
description: Pre-deploy audit of record, screenshot, library and edit video at main d36b19dd — why the app feels slower, 78 findings (6 high, 0 critical), and the order to fix them in.
sidebar:
  order: 2
---

# Audit report — 2026-10-15

> **Status: 🟡 Plans written, none shipped.** `main` at `d36b19dd`. 8 read-only auditors (Opus), two per feature,
> over the [feature map](/audits/2026-10-15/feature-map/). Method: [Pre-deploy audits](/audits/).
> Every finding maps to one implementation plan: [fix plans index](/plans/audit-2026-10-15/00-index/).

## Read this first (one minute)

**Verdict.** Safe to keep shipping — **no critical findings**, and the fixes from the
[Fable audit](/backlog/fable-audit-results/) still hold. But there are **6 high** findings: four
silent data-loss paths, a trim-handle bug a user hits on first use, and the Library navigation churn
below. In total: **78 raw findings (6 high · 49 medium · 23 low)**, about **68 distinct** after
merging the 10 that two auditors found independently.

**Why the app feels slower — ranked by likely contribution.** All of this is confirmed by reading the
code; magnitudes come from micro-benchmarks outside the app, **not from measuring the running app**
(nothing in the app measures this today — see the last point).

1. **Every Library-backed page does the whole library twice, and blinks.** Opening Library, a
   recording's detail page or Editor home fires a full cloud-catalog fetch. When it succeeds, main
   broadcasts `library:changed` **even if nothing changed**, which re-lists the vault. Each list
   also re-scans for tag counts. Result: ~4 full vault scans + 1 HTTP fetch per navigation, ~3× that
   for Library → detail → back. On the detail page and Editor home the second list flips
   `isLoading`, so the page swaps to "Loading" and **the video player unmounts and restarts**.
   ([LIB-A1](/audits/2026-10-15/findings/library-a/), [LIB-A2](/audits/2026-10-15/findings/library-a/))
2. **The main process blocks on tiny synchronous reads.** `vaultDirectory()` reads and parses
   `preferences.json` with `readFileSync` 2× per item per list and once per thumbnail request —
   ≈50 ms blocked per list at 500 items. While main is blocked, every IPC call and media request in
   every window waits. Users who never created a tag pay an extra full scan on every tag list. (LIB-A3, LIB-A4)
3. **The video editor re-renders all 1,545 lines on every playhead update**, because
   `usePreviewPlayback` returns a new object each render and defeats every memo built on it. Opening
   the editor also reads the whole recording into memory to decode 24 timeline thumbnails. (VID-A4, VID-A3)
4. **Screenshots pay for the same image many times**: ~6 copies of the PNG before the editor shows
   it, a synchronous decode in main just to read an unused width, the scene composited twice on every
   capture (auto-copy + auto-save), and Editor home decodes the whole clipboard image in main on every
   window focus. (SHOT-A1, SHOT-A4, SHOT-A5)
5. **We are blind.** No list timing, no editor-open timing, no capture-to-editor timing, no export
   speed, and a _successful_ recording emits nothing at all. The next "it feels slower" cannot be
   answered with data unless this changes. (REC-A3, LIB-A9, SHOT-A8, VID-A6)

Recording itself is **not** the culprit: the 8 ms cursor poll, the 100 ms tick and the chunk stream
are each well under 1 % of a core and bounded for a 1 h take (REC-A summary).

**Fix order.** Each batch's plans are listed in the [fix plans index](/plans/audit-2026-10-15/00-index/).

| #   | Batch                                                                                                                                                                                          | Findings                                                                    | Effort | Why this order                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| 1   | **Measure first** — timing logs + one `recording_completed`, `export_completed`, `library_listed` event                                                                                        | REC-A3, LIB-A9, SHOT-A8, VID-A6                                             | S      | Makes every fix below provable, and is the "control" the owner asked for |
| 2   | **Stop silent data loss**                                                                                                                                                                      | REC-B6, VID-A1/B3, LIB-B1, SHOT-B1, SHOT-B3/LIB-B10, LIB-B3, LIB-B6, VID-B5 | M      | Lost work is worse than slow work                                        |
| 3   | **Library fan-out** — broadcast only on change, no "Loading" swap on background re-list, one shared library store, cache `vaultDirectory()`, persist `tags.json` after import, parallel probes | LIB-A1–A5, LIB-A8, LIB-B7, SHOT-A7, SHOT-A9                                 | M      | Biggest perceived-speed win                                              |
| 4   | **Trim handle** — fixed drag baseline, trim bounds, pointercancel                                                                                                                              | VID-B1, VID-B2, VID-B7, VID-B8                                              | S      | User-visible on first use                                                |
| 5   | **Recording failure-path cleanup** — `try/finally` in `engine.stop()`, tear down main-side resources when a take ends early                                                                    | REC-A1/B2, REC-A2/B4, REC-B1, REC-B3, REC-B5, REC-A4/B7, REC-A5             | M      | Leaks devices and the global mouse hook                                  |
| 6   | **Render and copy cost** in both editors                                                                                                                                                       | VID-A2–A5, SHOT-A1, A2, A4–A6, A10, LIB-A6, LIB-A7/B9                       | M–L    | Measured by batch 1 before and after                                     |

Everything else (mostly low) is in the tables below.

**Caveats.** (1) The app and the e2e suite were not run; "confirmed" means the auditor traced the
full code path, and some confirmed a mechanism with a throwaway script outside the repo. (2) The
recording auditors checked mediabunny behaviour against the **1.49.0** copy installed in the audit
worktree, while `bun.lock` pins **1.61.4** — re-check REC-A1/A6/A7 against 1.61.4. (3) The
orchestrator re-verified LIB-A1, LIB-A2, REC-B6 and VID-B1 by hand; the rest rest on each auditor's
own refutation pass.

## Cross-cutting themes

1. **Redundant work fans out from broadcasts.** `library:changed` is a coarse "re-read everything"
   signal, sent even when nothing changed, and each consumer (three independent `useLocalLibrary`
   instances plus `useTags`) re-reads the whole vault. Fixing the signal fixes many findings at once.
2. **Cleanup runs only on the success path.** Recording (`engine.stop`, cursor tracker, click hook,
   control bar, writer session), export (two workers after cancel-then-export) and finalize
   (session deleted before the move) all release resources only when everything went well.
3. **Writes are not serialized or atomic.** Sidecar read-modify-write without a lock and with a
   shared temp name (LIB-B1), session saves sharing one `.tmp` (VID-A2/B6), screenshot overwrite in
   place (SHOT-B3/LIB-B10), delete order (LIB-B3), one-second vault ids (VID-B5).
4. **"Unreadable" is treated as "empty".** A session that fails to load becomes a blank scene
   (VID-A1/B3); an unreadable `tags.json` becomes "no registry" (LIB-B6); a corrupt sidecar reads as
   `{}` (LIB-B1). In each case the next write destroys the real data.
5. **Big components re-render as a whole.** The video editor page (1,545 lines) and the screenshot
   editor page re-render on every pointer move or playhead update; nothing below them is memoized.
6. **No performance telemetry.** Errors reach PostHog through `reportError`; durations, sizes and
   successes do not reach anything.

## All findings

Severity: 🔴 high · 🟠 medium · ⚪ low. Confidence: ✔ confirmed · ? plausible. "≈" marks a merge with
another auditor's finding. Full evidence, fix sketch and effort are on each detail page.

### Record — [lens A](/audits/2026-10-15/findings/record-a/) · [lens B](/audits/2026-10-15/findings/record-b/)

| ID          | Sev | Conf | Finding                                                                                                                  |
| ----------- | --- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| REC-B6      | 🔴  | ✔    | Finalize failure after the session closes strands the finished take as an invisible `.part` in tmpdir                    |
| REC-A1 ≈ B2 | 🟠  | ✔    | Encoder error leaves mic, screen capture, compositor rAF and AudioContext running (`engine.stop()` lacks `try/finally`)  |
| REC-A2 ≈ B4 | 🟠  | ?    | A start that fails before `cursorTrackStart` resolves leaves the 125 Hz cursor sampler and global mouse hook running     |
| REC-A3      | 🟠  | ✔    | Successful recordings emit no telemetry (start latency, encoder type, dropped frames, finalize time)                     |
| REC-A4 ≈ B7 | 🟠  | ✔    | After a renderer crash the writer session stays open and `session-1` is reused, truncating the crashed take (Known: #10) |
| REC-A5      | 🟠  | ✔    | Mic fails to open → take records without voice while every surface shows the mic as on                                   |
| REC-A6      | 🟠  | ?    | Start path is fully serial; thumbnail (150 ms sleep + JPEG) sits before "recording" begins                               |
| REC-A8      | 🟠  | ✔    | `.part` always lives in tmpdir: a vault on another volume pays a full copy at Stop (~36 s for 1 h)                       |
| REC-B1      | 🟠  | ✔    | Encoder/capture failure in the first ~200 ms is swallowed; the take continues as a zombie                                |
| REC-B3      | 🟠  | ?    | Control bar can appear after the take has ended and float while idle                                                     |
| REC-B5      | 🟠  | ?    | Close/quit guard's 5 s timeout closes without stopping; hub stays "recording"; stale listener closes the next window     |
| REC-A7      | ⚪  | ?    | Compositor redraws at display refresh (up to 120 Hz) instead of encode fps, and while paused                             |
| REC-A9      | ⚪  | ?    | Two duplicate `desktopCapturer.getSources` calls per start                                                               |
| REC-B8      | ⚪  | ?    | Cursor-track tail cut uses a clock that starts ≥150 ms late; last frames can lose cursor samples                         |

### Screenshot — [lens A](/audits/2026-10-15/findings/screenshot-a/) · [lens B](/audits/2026-10-15/findings/screenshot-b/)

| ID                | Sev | Conf | Finding                                                                                               |
| ----------------- | --- | ---- | ----------------------------------------------------------------------------------------------------- |
| SHOT-A1           | 🟠  | ✔    | Auto-copy + auto-save composite the identical scene twice on every capture (both on by default)       |
| SHOT-A2           | 🟠  | ✔/?  | PDF export: 3× raster + pdf-lib pure-JS PNG decode/deflate on the renderer main thread                |
| SHOT-A3           | 🟠  | ?    | Capture/paste PNG bytes live in router history state, held per capture                                |
| SHOT-A4           | 🟠  | ✔/?  | Main decodes full PNGs synchronously (capture `getSize` whose result is unused, copy, paste fallback) |
| SHOT-A5 ≈ VID-A7  | 🟠  | ✔/?  | Editor home decodes the whole clipboard image in main on every window focus                           |
| SHOT-A6           | 🟠  | ✔    | Pasting a PNG re-encodes PNG → PNG on the renderer main thread                                        |
| SHOT-A7           | 🟠  | ✔/?  | Opening a saved shot waits for a full library list plus a cloud refresh that re-lists again           |
| SHOT-A8 ≈ B6      | 🟠  | ✔    | No timings/sizes for capture or export; capture IPC rejection unhandled (Known: #35)                  |
| SHOT-B1           | 🟠  | ✔    | Edits made while a save is in flight are marked clean and lost on navigation                          |
| SHOT-B2           | 🟠  | ✔    | A new capture taken while the editor is dirty is discarded on "Keep editing"                          |
| SHOT-B3 ≈ LIB-B10 | 🟠  | ✔    | Overwrite rewrites the library PNG in place; a failed write destroys the original                     |
| SHOT-A9           | ⚪  | ✔    | Recent screenshots re-list the vault on every focus with no `.catch`; save never broadcasts           |
| SHOT-A10          | ⚪  | ?    | Every pointermove in move/resize/crop/slider drags re-renders the whole editor page                   |
| SHOT-B4           | ⚪  | ✔    | "Discard" after "Save copy" deletes the copy and keeps the auto-saved original                        |
| SHOT-B5           | ⚪  | ?    | Clearing a re-edited label then clicking another shape deletes the other shape                        |
| SHOT-B7           | ⚪  | ✔    | "Finish the recording first" toast for ⌘⌃X goes to a hidden window                                    |
| SHOT-B8           | ⚪  | ?    | Auto-save/copy skipped if the image loads before settings resolve                                     |
| SHOT-B9           | ⚪  | ✔    | Copy/Save/Export during another export silently dropped; stale retries run after unmount              |

### Library — [lens A](/audits/2026-10-15/findings/library-a/) · [lens B](/audits/2026-10-15/findings/library-b/)

| ID           | Sev | Conf | Finding                                                                                                    |
| ------------ | --- | ---- | ---------------------------------------------------------------------------------------------------------- |
| LIB-A1       | 🔴  | ✔    | Every library page mount runs a full cloud fetch that always broadcasts: ~4 vault scans per navigation     |
| LIB-A2       | 🔴  | ✔    | A background re-list swaps the detail page / Editor home to "Loading", restarting the video player         |
| LIB-B1       | 🔴  | ✔    | Concurrent `writeMeta` on one item loses updates and can corrupt the sidecar (title, tags, `assetId` lost) |
| LIB-A3       | 🟠  | ✔    | `vaultDirectory()` sync-reads `preferences.json` 2n times per list and per media request (~50 ms at n=500) |
| LIB-A4 ≈ B7  | 🟠  | ✔    | No `tags.json` → every `tags:list` re-runs the legacy import: extra full scan + n serial sidecar reads     |
| LIB-A5       | 🟠  | ✔    | Redundant per-item fs work: extension re-probing, serial edit probes, session meta read twice              |
| LIB-A6       | 🟠  | ✔/?  | Screenshot cards load the full-resolution PNG as thumbnail; no lazy loading or virtualization              |
| LIB-A7 ≈ B9  | 🟠  | ✔    | Orphan heal reads whole recordings into a Blob, retries failures on every re-list, also runs in the editor |
| LIB-A9 ≈ B13 | 🟠  | ✔    | No timing, vault-size or failure signal; cloud refresh errors discarded                                    |
| LIB-B2       | 🟠  | ✔    | Pasting several tags at once assigns only the last; chip edits use a stale id list                         |
| LIB-B3       | 🟠  | ✔    | Delete removes sidecar, poster and track before the media; failed media delete leaves a stripped item      |
| LIB-B4       | 🟠  | ?    | `list()` can overwrite a fresher catalog with a stale one (ghost / missing cloud items)                    |
| LIB-B5       | 🟠  | ✔    | Account switch during a refresh reuses the previous account's in-flight refresh                            |
| LIB-B6       | 🟠  | ?    | Unreadable or newer `tags.json` treated as "no registry"; the next tag write erases every tag              |
| LIB-B8       | 🟠  | ?    | `assetId` minting guard is per instance; concurrent lists mint different ids                               |
| LIB-B11      | 🟠  | ?    | Library IPC handlers use renderer ids in paths unvalidated; delete/rename can reach outside the vault      |
| LIB-A8       | ⚪  | ✔    | Each tag create/rename/recolor triggers 3–4 vault scans                                                    |
| LIB-B12      | ⚪  | ?    | Drag-out from another volume copies the whole file first; the next drag deletes earlier copies             |
| LIB-B14      | ⚪  | ✔    | Remove-local-copy rejection unhandled; failure after media delete leaves stale UI                          |

### Edit video — [lens A](/audits/2026-10-15/findings/video-a/) · [lens B](/audits/2026-10-15/findings/video-b/)

| ID          | Sev | Conf | Finding                                                                                                              |
| ----------- | --- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| VID-A1 ≈ B3 | 🔴  | ✔    | Failed session restore silently opens a blank scene; the first autosave overwrites the session and prunes slide PNGs |
| VID-B1      | 🔴  | ✔    | Start-edge trim drag runs away from the pointer (each pointermove re-adds the offset)                                |
| VID-A2 ≈ B6 | 🟠  | ✔    | Every autosave re-sends and rewrites all slide PNGs, never prunes deleted ones; overlapping saves share one `.tmp`   |
| VID-A3      | 🟠  | ✔    | Editor open reads the whole recording into a Blob for 24 thumbnails (export and GIF too)                             |
| VID-A4      | 🟠  | ✔    | Whole editor re-renders per playhead update; `usePreviewPlayback` returns a new object each render                   |
| VID-A5      | 🟠  | ✔    | Export/GIF workers use `CanvasSink` without `poolSize`: a new full-size canvas per decoded frame                     |
| VID-A6      | 🟠  | ✔    | No export or editor-open metrics (duration, realtime factor, size vs estimate, outcome)                              |
| VID-B2      | 🟠  | ✔    | Clip trims have no bounds: preview loops, export freezes past source end and desyncs audio                           |
| VID-B4      | 🟠  | ?    | Cancel during export prep then a new export runs two workers; a writer session and `.part` leak                      |
| VID-B5      | 🟠  | ✔    | Vault ids have one-second resolution and finalize doesn't check collisions                                           |
| VID-A8      | ⚪  | ✔    | Editor open is fully serial and runs cursor-track work synchronously on first render                                 |
| VID-A9      | ⚪  | ?    | Export write failure sends "stop" to the recorder, which would stop a live recording                                 |
| VID-A10     | ⚪  | ✔    | ImageBitmaps not closed on cancel/supersede; module-level `lastStart` retains the last editor                        |
| VID-B7      | ⚪  | ?    | Trim/slide/overlay drags lack pointercancel handling; editor can stay "interacting"                                  |
| VID-B8      | ⚪  | ✔    | `clampOverlays` on every live trim frame permanently truncates annotations                                           |
| VID-B9      | ⚪  | ?    | A library refresh returning a vault error kicks the user out of the open editor                                      |

## Untested modules on the critical path

From the feature map — these carry several of the findings above and have no tests:
`main/media-protocol.ts`, `main/library/index.ts` (all library IPC handlers),
`main/screenshots/screenshot-ipc.ts`, `pages/screenshot-editor/screenshot-editor-page.tsx`,
`pages/library/library-page.tsx`, `features/editor/paste-image.ts`, `use-paste-to-editor.ts`,
`main/recording-sources.ts`, the window managers (`control-bar-window.ts`, `camera-bubble-window.ts`),
and the start-handle drag phases of `timeline-strip.tsx`. Each fix in batches 2–5 should land with
the test that would have caught it.

## Next run

Re-run this when a batch of features lands, or monthly. Diff the new feature map against this one
(file sizes, new hot paths, newly untested modules), and once batch 1 ships, compare the timing
events against this run's numbers.

## Appendix — auditor focus questions

All auditors shared the brief on the [method page](/audits/), plus these focus questions:

- **Record A** — cost of the always-on work during a take; time-to-record; per-take leaks; what a
  "choppy" or "slow to start" report would show.
- **Record B** — state machine under concurrent inputs; every failure path (permissions, encoder,
  disk, vault, display); cursor clock; swallowed promises.
- **Screenshot A** — hotkey-to-editor latency; pointer-move render cost; export compositing and
  memory; focus-driven refreshes; failure visibility.
- **Screenshot B** — untested modules; re-entrancy; save/overwrite/auto-action correctness; crop and
  annotation math; non-macOS behaviour.
- **Library A** — work per list and per broadcast as a function of n; sync reads; media protocol;
  renderer list cost; broadcast storms; timing signals.
- **Library B** — media protocol and IPC input validation; concurrent sidecar and `tags.json` writes;
  delete partial failures; account switch; vault unavailable.
- **Edit video A** — time-to-interactive; re-render cost; autosave payload; export worker path and
  leaks; navigation leaks; export metrics.
- **Edit video B** — session persistence races; time mapping at boundaries; preview vs export
  disagreement; export cancel and concurrency; auto-zoom on degenerate tracks; undo with live drags.
