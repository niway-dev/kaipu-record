---
title: Fable audit — results
description: Confirmed findings from the pre-testers audit (Claude Fable 5) — correctness bugs, flow-isolation gaps, design-conformance violations, and main-flow improvements, each adversarially verified with file/line and repro.
---

# Fable audit — results

> **Status: 🟡 Fix in progress — 20 of 46 confirmed findings fixed.** Produced by the
> [fable-audit](./fable-audit) method: 6 parallel finders (recording pipeline, screenshots,
> settings/IPC, flow isolation, design conformance vs the docs guides, main-flow UX) with
> adversarial verification of every candidate. Only findings that survived refutation are
> listed. **46 distinct confirmed findings (4 critical, 9 high, 17 medium, 16 low), 2 uncertain, 5 refuted.**
>
> **Fix plan (themed branches):** 1) recording engine lifetime & flow control — ✅ merged
> (#17: findings 1,2,3,5,9,10,17,19,20,22,23,24,25 + incidentally 39); 2) unguarded exits —
> ✅ merged (#18: findings 8, 11); 3) silent failures — ✅ done
> (`fix/surface-silent-failures`, findings 6, 7, 18, 28); 4) cross-window state + docs (14, 15,
> 16, 21, 27, 29, 30); 5) screenshot editor & export fidelity (4, 12, 13, 26). The 16
> low-severity findings (31–46 minus the incidental 39) are deferred to a later pass.

## Read this first — the five themes

Most findings cluster around five root causes. Fixing the cluster fixes many findings at once:

1. **The recording engine's lifetime is bound to the Record page's React mount** (findings 1, 2, 5, 10).
   The engine lives in `useScreenRecorder` refs inside the routed page. Any unmount —
   navigation, taking a screenshot mid-recording, closing the window — orphans a live,
   unstoppable, unsaveable recording. This is the root of the audit's worst bugs and directly
   violates the flow-isolation requirement (screenshot must never break recording). Fix once:
   lift the engine to an app-level owner (or hard-block navigation/close while active).
2. **`fastStart: "in-memory"` defeats the streaming writer** (finding 3). Nothing hits disk
   until stop, so every crash/quit/orphan above loses _everything_, and long recordings
   OOM-crash the renderer on their own. This multiplies the severity of every other
   recording finding.
3. **Unguarded exits.** Cmd+Q / tray-Quit mid-recording (finding 11), unsaved screenshot editor
   work (finding 8), Escape during onboarding — destructive exits with no confirmation,
   violating the "never lose progress without asking" product rule.
4. **Silent failures.** Save/Copy/export, chunk writes, screenshot capture, and library
   listing all swallow errors (console-only). The user believes work succeeded when it
   didn't. A single toast-on-error convention would cover most of these.
5. **Cross-window state has two sources of truth.** The Record page guards on its _local_
   engine status instead of the hub's `RecordingActivity`, settings have no renderer
   broadcast, and defaults are restated per process — the documented
   query-on-mount + subscribe pattern is only partially applied.

## Critical

### 1. Recording is orphaned and becomes unstoppable when RecordPage unmounts mid-recording — ✅ Fixed (`fix/recording-engine-lifetime`)

**Critical · Bug · found by `flow-isolation`** — `apps/kaipu-record/src/renderer/src/features/recording/hooks/use-screen-recorder.ts:220`

The whole recording lifecycle (engineRef, sessionRef, tick interval, and the recording:command IPC subscription) lives inside useScreenRecorder, which is instantiated by RecordPage via useRecordingSetup. There is no unmount cleanup that stops the engine, and the useEffect at line 220 REMOVES the onRecordingCommand listener on unmount. If RecordPage unmounts while status is 'recording', the engine and its 100ms tick interval keep running via closures (chunks keep streaming to the disk writer, the floating bar keeps ticking), but every stop path is dead: the control bar's Stop and the global stop shortcut both go main → mainWindow.webContents.send(recordingCommand,'stop') → no listener. recordingStop/finalize never run, so the .mp4.part stays in tmpdir and the recording is lost when the app quits.

**Repro / scenario:** Start a recording (window hides, bar shows). Press ⌘⌃O (bring-to-front rescue) or tray right-click → 'Open Kaipu Record' — the main window reappears with a live sidebar (the inert lock only covers the setup controls). Click 'Library'. RecordPage unmounts: the bar's timer keeps counting but its Stop button and ⌘⌃S do nothing; the recording can never be finalized and the entire session is silently lost.

**Suggested fix:** Move the recorder session out of the page component (module-level store or a provider mounted in App above the router), or add a route blocker on '/' while status is recording/paused, or at minimum an unmount cleanup that performs the robust stop (finalize-or-abort).

**Independently reported by:** `recording` — “Navigating away from the Record page mid-recording orphans the engine — recording can never be stopped or saved”; `design-conformance` — “Recording engine lifetime is bound to the Record page route mount — navigating away mid-recording orphans the engine (Stop stops working, tick interval leaks)”; `flow-improvements` — “Taking a screenshot (or any navigation) mid-recording unmounts the Record page and orphans the live recording engine — recording becomes unstoppable and unsaveable”

### 2. Screenshot hotkey during an active recording destroys the recording — ✅ Fixed (`fix/recording-engine-lifetime`)

**Critical · Bug · found by `flow-isolation`** — `apps/kaipu-record/src/renderer/src/shell/app-shell.tsx:53`

onCaptureScreenshotHotkey runs capture() unconditionally — neither AppShell nor main's triggerCaptureScreenshot (index.ts:153) checks recording activity (the Capture Panel locks its Capture tab while busy, but the global ⌘⌃X path has no such gate). On a successful capture, useScreenshotCapture navigates to /screenshot-editor, unmounting RecordPage mid-recording (→ the orphaned-recording bug), and then revealAfterCapture() calls bringAppToFront(), putting the main window back on screen INSIDE the ongoing (now unstoppable) recording.

**Repro / scenario:** Start a recording. Press ⌘⌃X, drag a region, release. The app jumps to the screenshot editor and comes to the front; the control bar still shows a running timer but Stop/⌘⌃S are dead; the recording keeps writing to a temp file that is never finalized. Both flows are broken: the screenshot editor is now covered by an un-dismissable recording bar and the recording is lost.

**Suggested fix:** In main, gate triggerCaptureScreenshot on the hub's activity (show a toast/notification 'Finish the recording first' or implement capture-without-navigation), or make the renderer capture flow skip navigation while recording.

### 3. fastStart 'in-memory' buffers the ENTIRE recording in renderer RAM — long recordings OOM-crash and lose everything — ✅ Fixed (`fix/recording-engine-lifetime`)

**Critical · Robustness · found by `recording`** — `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:170`

The Output uses `new Mp4OutputFormat({ fastStart: "in-memory" })`. Per mediabunny (node_modules/mediabunny/src/output-format.ts:127), 'in-memory' keeps ALL media chunks in memory until finalization and only then streams them through the StreamTarget. So during recording NOTHING reaches the RecordingWriter/disk — onChunk fires only at stop(). At the 'balanced' preset (8 Mbps video + 128 kbps AAC) that's ~60 MB/min, ~3.6 GB/hour held in the renderer process; at the 'max' bitrate tier (24 Mbps) ~180 MB/min. The Chromium renderer will hit its memory ceiling and crash on long recordings, and because nothing was flushed to disk the whole recording is unrecoverable. The RecordingWriter's positional-write design comment ('StreamTarget may rewrite earlier regions — faststart patches the moov') shows the intent was progressive streaming, which 'in-memory' silently defeats.

**Repro / scenario:** User records an hour-long meeting at the default preset → renderer memory grows past ~3.5 GB → renderer process crashes mid-recording → recording entirely lost (temp .part file is empty), main window stays hidden, control bar stays up frozen.

**Suggested fix:** Use `fastStart: false` (moov at end, progressive positional writes — exactly what RecordingWriter was built for) or `fastStart: 'fragmented'` (fMP4, monotonic writes, crash-salvageable). If fast-start MP4 is required, post-process the file in the main process after finalize instead of buffering in the renderer.

### 4. Re-edited screenshot: Copy or second Overwrite after 'Save → Overwrite' composites the scene onto the already-flattened file, doubling frame and annotations

**Critical · Bug · found by `screenshots`** — `apps/kaipu-record/src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:106`

exportPng() calls image.getBytes() on every export. For a kind:'local' source, localReader.getBytes (local-reader.ts:19) re-reads the vault file from disk each time. persist({overwriteId}) writes the composited PNG back to that same id (screenshot-ipc.ts:82-87). So after the first Overwrite, the on-disk bytes already contain the baked beautify frame + annotations, but scene state (beautify padding/bg, annotations, crop) is still live in the editor. Any subsequent export in the same session (Copy button, or Save → Overwrite again) composites the whole scene a second time on top of the already-flattened image: padding/background applied twice, annotations drawn twice (and at shifted positions, because normalized coords now map onto the padded image, not the original shot). The preview gives no warning because displayUrl keeps the stale ?v= cache token and still shows the pre-overwrite bytes.

**Repro / scenario:** Library → open a saved screenshot → Edit → set background + padding 40 and draw an arrow → Save → Overwrite → now click Copy (or Save → Overwrite again). The clipboard/library image has a double frame (padding and background applied twice) and the arrow duplicated/shifted, while the editor preview still looks correct. The library item is silently corrupted on the second overwrite.

**Suggested fix:** Resolve the source to immutable bytes once when the editor mounts (e.g. cache the ArrayBuffer in useImageSource/localReader on first getBytes) and export from that snapshot for the whole session; also bump the displayUrl version after an overwrite so the preview matches disk.

## High

### 5. Record page locks/guards on its LOCAL recorder status instead of the global RecordingActivity, so a second concurrent recording can be started mid-recording — ✅ Fixed (`fix/recording-engine-lifetime`)

**High · Design · found by `design-conformance`** — `apps/kaipu-record/src/renderer/src/pages/record/record-page.tsx:98`

recording-pipeline.mdx ('Estado global de grabación (entre ventanas)') documents that every window reads the hub-broadcast RecordingActivity via useRecordingActivity() so a window that (re)opens mid-recording shows locked controls and it is 'imposible arrancar una segunda grabación'. The Capture Panel follows this (capture-panel.tsx:29 uses activity.active), but the Record page does NOT: `data-locked={isRecording || undefined}` (line 98), the RecordButton's disabled condition (line 163), the startRecording guard in use-recording-setup.ts:130 (`countdownTimer.current || isRecording || !selectedSource`), and the auto-start effect (record-page.tsx:54-60) all key off the LOCAL useScreenRecorder status, which is 'idle' in any freshly mounted Record page even while a recording is running. useRecordingActivity() is imported (line 47) but only used for the paused label and elapsed time.

**Repro / scenario:** Start a recording (main window hides). Press the documented rescue shortcut ⌘⌃O (bringToFront) — the main window reappears with the sidebar active. Click Library, then Record: the remounted Record page shows 'Ready to record' with an enabled Start button (local recorder is idle). Press Start (or ⌘⌃C, whose startAt auto-start effect has the same local-only guard): a second engine + writer session starts over the still-running first one; the hub's activity is overwritten and the first recording becomes unstoppable and is never finalized to the vault.

**Suggested fix:** Derive the lock and the start guards from `useRecordingActivity().active || isRecording` in useRecordingSetup (canStartRecording, startRecording, the auto-start effect) and in the Record page's data-locked/inert, exactly as the Capture Panel already does per the doc.

**Verifier note:** severity adjusted from critical to high. record-page.tsx:98,163 and use-recording-setup.ts:130,203 gate only on the local recorder (idle after a remount), while useRecordingActivity is used only for label/time (record-page.tsx:47,76); the scenario is reachable because bringAppToFront (main/index.ts:140-144, the ⌘⌃O handler) shows the hidden main window mid-recording and sidebar.tsx has no lock. This defeats the documented invariant (reco

### 6. Screenshot editor Save and Copy swallow failures — a failed save gives zero feedback, user closes editor believing the shot is in the library — ✅ Fixed (`fix/surface-silent-failures`)

**High · Robustness · found by `flow-improvements`** — `apps/kaipu-record/src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:125`

persist() (line 121–134) and onCopy() (line 110–119) use try/finally with no catch, and callers invoke them as `void persist({})`. If saveScreenshot rejects (vault on an unplugged external drive, disk full, compositeScene decode failure) or copyImageToClipboard rejects, the rejection is unhandled: no toast, the button never flips to "Saved"/"Copied", and no error state exists. The app has a ready-made reportError() + toast-store used by the recording flow, but the entire screenshot editor never uses it.

**Repro / scenario:** User's custom vault folder is on an external drive that's disconnected. They annotate a screenshot for five minutes, click Save — the button stays "Save" with no message. They assume it worked (or click it three more times), navigate away, and the work is gone with no trace and no explanation.

**Suggested fix:** Wrap the awaits in catch → reportError("No pudimos guardar la captura…", error, { retry }) in onCopy and persist; same for copyScreenshotById in library-detail-page.tsx:57.

**Independently reported by:** `screenshots` — “Copy/Save failures are swallowed: no user feedback and an unhandled promise rejection”

### 7. Recording chunk write failures are only console.error'd — user can record for an hour onto a full disk and only discover the corrupt file afterwards — ✅ Fixed (`fix/surface-silent-failures`)

**High · Robustness · found by `flow-improvements`** — `apps/kaipu-record/src/main/recording/recording-hub.ts:94`

The recordingWrite IPC handler catches writer.write rejections with `console.error("recording write failed", error)` and nothing else. Writes are fire-and-forget from the renderer, so the engine keeps encoding and the control bar keeps showing a healthy timer while every chunk is being dropped (ENOSPC, temp dir permission error, disk ejected). finalize() will then rename a truncated/hole-filled .part into the vault and report success, or the moov patch lands in a sparse file — either way the user gets a "saved" recording that doesn't play.

**Repro / scenario:** User's disk fills up 2 minutes into a 40-minute meeting recording. The bar shows recording normally for the remaining 38 minutes; at Stop the app navigates to the detail page like everything worked. The video is corrupt/truncated and the meeting is unrecoverable — the user was never warned while they could still have fixed it.

**Suggested fix:** On the first write failure for a session, notify the recorder renderer (e.g. send recordingCommand "stop" or a dedicated error event) so it runs the existing onError → reportError + robust-stop path, and mark the session failed so finalize refuses to report success.

**Independently reported by:** `recording` — “Disk write failures are swallowed — finalize reports success and a truncated/corrupt file is presented as saved”

### 8. Screenshot editor has no unsaved-changes guard — annotations and the unsaved capture are silently destroyed by any navigation — ✅ Fixed (`fix/unguarded-exits`)

**High · Robustness · found by `flow-isolation`** — `apps/kaipu-record/src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:41`

The editor keeps the scene (annotations/crop/beautify) and, for a fresh capture, the only copy of the PNG bytes in component state / location.state. There is no useBlocker or beforeunload guard (router.tsx:19 explicitly calls it a 'future' guard). Any navigation unmounts it with zero confirmation: clicking any sidebar item, ⌘⌃V (AppShell navigates to '/' and auto-starts a countdown), the Capture Panel's Start/Change buttons (both navigate to '/'), or ⌘⌃X capturing a NEW screenshot (navigate with a new location.key remounts the editor on the new shot, discarding the previous unsaved one).

**Repro / scenario:** Capture a screenshot (⌘⌃X), spend minutes annotating/blurring, then press ⌘⌃V to start a recording (or click Library in the sidebar, or ⌘⌃X again). The editor unmounts instantly: every annotation AND the never-saved screenshot itself are gone with no confirmation — the shot exists nowhere on disk.

**Suggested fix:** Track scene dirtiness (scene.canUndo or an explicit dirty flag vs last save) and add useBlocker + a confirm dialog; also gate the AppShell hotkey handlers (start-recording, new capture) on the same dirty check.

**Independently reported by:** `flow-improvements` — “Leaving the screenshot editor with unsaved annotations discards everything silently — no unsaved-changes guard despite the router being chosen for it”

### 9. Screenshot hotkey during the recording countdown races the native region selector against recording start — ✅ Fixed (`fix/recording-engine-lifetime`)

**High · Bug · found by `flow-isolation`** — `apps/kaipu-record/src/main/index.ts:153`

triggerCaptureScreenshot and the renderer capture() have no guard for the countdown/'starting' phase (hub activity is still idle then — startedActivity only fires after streams are acquired, so even the Capture Panel tab lock doesn't apply). beforeCapture hides the main window but the countdown interval keeps ticking (backgroundThrottling is disabled) and fires recorder.start() while the native `screencapture -i` selector is on screen: the control bar pops up over the selector and the recording begins capturing the selection UI. If the user then cancels (Esc), afterCapture sees captureWasVisible=true and calls showMainWindow() — the main window is now fully visible during a recording the hub meant to hide it for. If the user completes the capture, navigation to the editor unmounts RecordPage → orphaned unstoppable recording.

**Repro / scenario:** Click Record (3-2-1 countdown starts), immediately press ⌘⌃X. The app vanishes, the crosshair appears, and 2 seconds later the control bar appears and recording starts underneath the selector. Press Esc: the main app window pops back up while the recording is running, and the recorded video shows the app window the design explicitly hides.

**Suggested fix:** Gate triggerCaptureScreenshot on countdown/starting as well (broadcast a 'preparing' activity from the renderer when the countdown begins), or have beforeCapture cancel the pending countdown with a toast.

### 10. No recovery when the recorder renderer dies or the main window is closed mid-recording — app permanently stuck 'recording' — ✅ Fixed (`fix/recording-engine-lifetime`)

**High · Robustness · found by `recording`** — `apps/kaipu-record/src/main/index.ts:73`

The recording lives in the main window's renderer, but the main process has no `render-process-gone` handler (grep confirms none exist) and the `closed` handler just nulls `mainWindow`. The hub's `activity` flips back to idle ONLY via the renderer-sent `recordingStop`. If the recorder renderer dies (crash, OOM from the in-memory buffering, or the user closing the window), `recordingStop` never arrives: `activity.active` stays true forever, the control bar stays floating with a frozen timer (its Stop routes to a dead/absent webContents via `getMainWindow()?.webContents.send`), the forced Dock policy is never restored, and the Capture Panel stays locked in 'recording' mode until app restart.

**Repro / scenario:** Mid-recording the user presses the rescue shortcut ⌘⌃O (which unconditionally shows the hidden main window) and then clicks the window's red close button → renderer destroyed, recording silently dies, control bar floats forever with a frozen timer, Capture Panel permanently shows the recording banner and can never start a new recording.

**Suggested fix:** In the hub, watch the recorder webContents: on `render-process-gone` / `destroyed` while `activity.active`, run the stop path in main (abort/close the writer session, hide the bar, restore Dock policy, reset+broadcast activity). Also block or confirm main-window close while `activity.active`.

**Independently reported by:** `flow-improvements` — “Closing the main window mid-recording destroys the recorder renderer with no guard — control bar sticks on screen, recording lost, app deadlocked until relaunch”

### 11. Cmd+Q mid-recording quits silently and discards the entire recording — ✅ Fixed (`fix/unguarded-exits`)

**High · Robustness · found by `recording`** — `apps/kaipu-record/src/main/index.ts:304`

`before-quit` only unregisters shortcuts, destroys the tray and flushes analytics. There is no check of the hub's `activity.active`: no confirmation dialog, no attempt to finalize or preserve the in-progress session. With fastStart 'in-memory' nothing is on disk yet, so quitting destroys the whole recording; even with progressive writes the un-finalized .part would be left in tmpdir with no recovery flow on next launch.

**Repro / scenario:** User records 40 minutes, habitually hits Cmd+Q (the main window is hidden so the app looks 'done') → app quits instantly → recording gone with no warning and no salvage on next launch.

**Suggested fix:** In before-quit, if activity.active: preventDefault, show a confirm dialog ('A recording is in progress — stop and save first?'), and route through the normal stop path before quitting. Optionally scan tmpdir for orphaned .part files on launch.

**Independently reported by:** `flow-isolation` — “Quit paths (tray Quit, Cmd+Q) are unguarded during an active recording — recording discarded without confirmation”

### 12. Export clips annotations to the shot rectangle while the live preview shows them overflowing into the padding

**High · Bug · found by `screenshots`** — `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/compositor.ts:123`

The export wraps all annotations in <g transform=translate(pad,pad) clip-path=url(#rcLocal)> where rcLocal is the shot rect (0,0,naturalW,naturalH, rx=radius). But the interactive layer renders annotations with `.svg { overflow: visible }` (annotation-layer.module.css:10) and no clipping on .shotWrap/.frame, and annotation coordinates are not clamped to [0,1] (pointer capture lets a drag end outside the layer; moveBy in annotation-layer.tsx:529 applies unclamped deltas). So an arrow head, pen stroke, or text label that extends past the shot edge into the beautify padding is fully visible in the preview but silently truncated at the shot boundary in the exported PNG. The same clip also squares off blur boxes at rounded corners in export but not in preview.

**Repro / scenario:** Capture → set padding 60 + a gradient background → draw an arrow that starts inside the shot and whose head lands in the padding area (drag past the image edge; preview shows the whole arrow) → Copy/Save. The exported image cuts the arrow off exactly at the screenshot edge; the annotation the user placed is partially missing. Same with a text label typed near the right edge.

**Suggested fix:** Make preview and export agree: either clip the live annotation SVG to the shot (overflow hidden / clip-path on .layer) or clip the export annotation group to the full frame instead of rcLocal. Clamp move/draw coordinates if the shot-only semantics are kept.

### 13. Arrow curvature and arrowhead are fixed-pixel in rough.ts and never scaled in the export, so exported arrows differ from the preview on Retina

**High · Bug · found by `screenshots`** — `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/compositor.ts:170`

annotationSvg for arrows calls roughArrow(x1..y2, seed) with coordinates converted to native pixels, but roughArrow (rough.ts:35-47) uses absolute pixel constants: curve mid-point offset `-16`, jitters j(10)/j(6)/j(2), and arrowhead length `ah = 15`. In the preview these constants apply in display px; in the export the coordinates are native px (scale = naturalW/displayedW is typically 2–3x for a Retina capture shown fit-to-window) while the constants stay the same. Box/blur/text/stroke widths are all multiplied by `scale`, arrows are not.

**Repro / scenario:** On a Retina Mac, capture a full-screen shot (natural width ~2900px, displayed ~1000px, scale ~2.9), draw an arrow, Copy/Save. The exported arrow has an arrowhead ~3x smaller relative to the arrow and an almost flat curve, visibly different from the bowed, well-headed arrow in the editor.

**Suggested fix:** Thread `scale` into roughArrow (multiply the -16 curve offset, jitter magnitudes, and ah=15 by scale), mirroring how STROKE_WIDTHS and the box radius (14\*scale) are handled.

## Medium

### 14. Persisted AppSettings has no renderer broadcast — cross-window consumers violate the documented query-on-mount + subscribe pattern (stale Stop-shortcut hint on the control bar)

**Medium · Design · found by `design-conformance`** — `apps/kaipu-record/src/main/infrastructure/settings-store.ts:106`

recording-pipeline.mdx establishes the cross-window state pattern: 'consulta al montar, se suscribe a cambios' (query on mount + subscribe), implemented for RecordingSettings and RecordingActivity. Persisted AppSettings breaks the pattern: settings-store.ts notifies only main-process listeners (line 106) and never sends a settings-changed event to windows; there is no onSettingsChanged in the preload bridge. Renderer consumers compensate ad hoc: useAppSettings (query on mount only), use-recording-setup's qualityRef (mount-time read justified by a remount argument), and use-shortcut-labels.ts:28 (refetch on window 'focus'). The control-bar window defeats the focus workaround: ControlBarWindow is shown with showInactive() and kept alive after hide() (control-bar-window.ts:35,98), so its renderer never remounts and never receives focus.

**Repro / scenario:** Record once (bar window gets created and reads shortcuts), stop, go to the Shortcuts page and rebind 'Stop recording' from ⌘⌃S to something else, then record again. The bar reappears (hide→show, no reload, no focus) still displaying the old ⌘⌃S hint — a shortcut that is no longer registered, so pressing what the bar shows does nothing.

**Suggested fix:** Broadcast a `settings:changed` event to all windows from the update handler (mirroring recording-settings:changed), expose onSettingsChanged in the bridge, and have useShortcutLabels/useAppSettings subscribe instead of relying on focus/remount.

### 15. Pages are untested, contradicting the renderer-architecture folder contract that pages get jsdom tests — record-page's auto-start logic has zero coverage

**Medium · Design · found by `design-conformance`** — `apps/kaipu-record/src/renderer/src/pages/record/record-page.tsx:54`

renderer-architecture.mdx's folder table (line 15-22) states pages/<page> are tested with jsdom. Only the settings pages have tests (settings-page.test.tsx, recording-quality-settings.test.tsx); record-page.tsx, library-page.tsx, library-detail-page.tsx, screenshots-page.tsx, screenshot-editor-page.tsx and shortcuts-page.tsx have none. record-page is the worst gap: it carries the subtlest logic in the app — the once-per-flag auto-start (startAt) and openPicker effects built on refs + location.state (lines 54-74), plus the permissionsChecked flash-guard — precisely the code most likely to regress into a double-start or missed start.

**Repro / scenario:** A future edit to the startAt effect (e.g. adding startRecording's changing identity dependencies or dropping startedForRef) makes the Capture Panel's Start button fire startRecording twice per request; nothing in CI catches it, and it ships to testers as intermittent double-countdown behavior.

**Suggested fix:** Add jsdom tests for record-page covering: auto-start fires exactly once per startAt flag, no start while activity.active, and openPicker opens the selector once.

### 16. IPC Contract doc is materially wrong: it asserts settings:get/update have no handler and documents 13 of ~45 channels

**Medium · Design · found by `design-conformance`** — `apps/documentation/src/content/docs/desktop/ipc-contract.mdx:62`

Repo CLAUDE.md makes the docs site 'the single source of truth'. ipc-contract.mdx's first gotcha (line 62) states in bold that IPC_CHANNELS defines settings:get/update but 'el bridge NO los expone... ni handler en main' and that only the vault dir is persisted — all false: settings-store.ts:101-108 registers both handlers, preload/index.ts:23-24 exposes getSettings/updateSettings, and settings.json persists theme/dock/quality/shortcuts/deviceId. The channel table (lines 27-42) lists 13 channels while shared/types/ipc.ts defines ~45 (recording engine, screenshots, shortcuts, updater, analytics all missing), and the 'invoke vs send' section claims only two send channels exist. main-process-architecture.mdx's startup list (lines 15-21) is similarly missing registerSettings, the recording hub, global shortcuts, screenshot handlers, and the auto-updater.

**Repro / scenario:** A contributor (or an audit agent) trusting the doc's explicit 'no settings handler exists — don't assume they do' warning implements a second settings-persistence path (or skips reviewing the existing one), directly because the single-source-of-truth doc says the opposite of the code.

**Suggested fix:** Regenerate the channel table from IPC_CHANNELS, delete the obsolete settings gotcha, and update the main-process subsystem list; consider a doc-generation script so the table can't drift again.

### 17. The 3-2-1 countdown cannot be cancelled — the overlay blocks the page and every control that could abort it is disabled or unreachable — ✅ Fixed (`fix/recording-engine-lifetime`)

**Medium · Improvement · found by `flow-improvements`** — `apps/kaipu-record/src/renderer/src/features/recording/hooks/use-recording-setup.ts:129`

Once startRecording begins the countdown, the full-screen CountdownOverlay covers the page, the RecordButton is disabled (record-page.tsx:163), the Pause/Stop controls only render when isRecording is already true, no Escape handler exists, and the ⌘⌃S stop shortcut is a no-op because useScreenRecorder.stop() guards on a non-existent engine. stopRecording() would clear the countdown — but no UI path can invoke it during the count.

**Repro / scenario:** User clicks Record and instantly realizes the wrong screen is selected (or a Slack DM just appeared on the shared display). They mash Escape and click everywhere for 3 seconds — nothing responds — then the recording starts anyway, they stop it at 0:02, and a junk recording lands in the vault that they now have to find and delete.

**Suggested fix:** Add an Escape key handler and a visible "Cancel" affordance on CountdownOverlay wired to stopRecording() (which already clears the countdown); also route the stop command to clearCountdown when no engine exists yet.

### 18. Library list failure is rendered as the 'No recordings yet' empty state instead of an error — ✅ Fixed (`fix/surface-silent-failures`)

**Medium · Robustness · found by `flow-improvements`** — `apps/kaipu-record/src/renderer/src/features/library/hooks/use-local-library.ts:37`

refresh() catches any listLocalRecordings failure and silently does setVideos([]). The Library page can't distinguish "vault is empty" from "vault couldn't be read", so it shows the first-run empty state ("No recordings yet — Your recorded videos will appear here") with a 'Go record something' CTA. rename() and remove() similarly propagate rejections to `void`-ed callers with no user feedback.

**Repro / scenario:** User's custom vault lives on a network drive that's momentarily unreachable. They open Library and are told they have no recordings at all — indistinguishable from data loss. The Sync button spins and lands on the same lie. Had the page said "Couldn't read your recordings folder — Retry", the user would reconnect the drive instead of panicking.

**Suggested fix:** Store the error in state and render a distinct error panel with a Retry action; wrap rename/remove in catch → reportError so failed deletes/renames aren't silent.

**Verifier note:** Finding is accurate but the silence is two-layered, not one: besides the renderer catch (use-local-library.ts:37), the main process also swallows failures — LibraryVault.list() catches readdir errors and returns [] (library-vault.ts:59-63), and LibraryVault.remove() swallows all rm failures via Promise.allSettled + force:true (library-vault.ts:134-140), so remove() rejections never reach the renderer at all. The list() error that actually propagates to the renderer catch is the un-wrapped `mkdir` at library-vault.ts:57. A complete fix must surface errors from both layers (e.g., let list() propagate readdir failures and have remove() report per-file failures), not just add renderer state.

### 19. Stop shortcut and stop command are silently ignored during the countdown — recording starts anyway — ✅ Fixed (`fix/recording-engine-lifetime`)

**Medium · Bug · found by `flow-isolation`** — `apps/kaipu-record/src/renderer/src/features/recording/hooks/use-screen-recorder.ts:157`

The global ⌘⌃S stop shortcut and the control-bar command path deliver recordingCommand 'stop' to useScreenRecorder.stop(), which early-returns when there is no engine yet (line 157). The countdown lives one level up in useRecordingSetup (only setup.stopRecording clears it, and that is only wired to the on-page Stop button, which isn't rendered before isRecording). The CountdownOverlay is a fixed full-window blocker with no cancel affordance either, so during the 3s countdown + 'starting' spinner there is no way to abort at all.

**Repro / scenario:** Press ⌘⌃V by accident; during the 3-2-1 countdown press ⌘⌃S ('stop') repeatedly. Nothing is cancelled — the recording starts anyway, the window hides, and the user must wait for the handoff and then stop and delete a junk recording.

**Suggested fix:** Route the 'stop' command through useRecordingSetup so it clears a pending countdown (clearCountdown) before delegating to recorder.stop; add Esc/click-to-cancel on CountdownOverlay.

### 20. Start requested while previous recording is finalizing: countdown plays, then silently records nothing — ✅ Fixed (`fix/recording-engine-lifetime`)

**Medium · Robustness · found by `flow-isolation`** — `apps/kaipu-record/src/renderer/src/pages/record/record-page.tsx:56`

During 'finalizing' isRecording is false (only recording/paused count), and neither the auto-start guard (line 56) nor the RecordButton disabled expression (line 163: covers 'starting' and countdown only) accounts for it, so a new countdown can start while the previous session is still being written. When the countdown ends, recorder.start() early-returns because sessionRef is still set (use-screen-recorder.ts:75) — no error, no toast. Alternatively, if finalize completes mid-countdown, onRecordingComplete navigates to /library/:id, unmounting RecordPage and killing the countdown.

**Repro / scenario:** Stop a long recording (bar shows 'Saving…' for several seconds), immediately press ⌘⌃V to start the next take. The 3-2-1 countdown plays, the overlay disappears… and nothing is recording. The user believes the take is being captured and narrates into nothing.

**Suggested fix:** Treat 'finalizing' as busy: include it in the isRecording/auto-start/RecordButton guards, and surface a 'Saving previous recording…' state instead of silently swallowing the start.

### 21. Closing the window while rebinding a shortcut leaves ALL global shortcuts unregistered

**Medium · Bug · found by `flow-isolation`** — `apps/kaipu-record/src/renderer/src/features/shortcuts/shortcut-input.tsx:30`

Entering 'listening' mode sends suspendShortcuts() → main runs globalShortcut.unregisterAll(). resumeShortcuts() is only sent from the React effect cleanup. If the main window is closed while listening (Cmd+W — the renderer is destroyed without running effect cleanups, and the button's onBlur doesn't fire on window close), applyGlobalShortcuts is never called again. Every global shortcut — including ⌘⌃O, the documented rescue backstop for the app-vanishes bug — stays dead until a settings change or app restart.

**Repro / scenario:** Settings → Shortcuts → click a binding ('Press keys…'), then Cmd+W the window. The app is now tray-only and ⌘⌃C/⌘⌃S/⌘⌃X/⌘⌃O all do nothing; a user relying on the ⌘⌃O rescue shortcut cannot get the app back except via the tray icon.

**Suggested fix:** In main, re-apply shortcuts when the suspending webContents is destroyed (track the sender of shortcutsSuspend and hook its 'destroyed'/window 'closed' event), or auto-resume after a timeout.

### 22. Camera bubble is not hidden for screenshot capture and appears in the shot — ✅ Fixed (`fix/recording-engine-lifetime`)

**Medium · Robustness · found by `flow-isolation`** — `apps/kaipu-record/src/main/index.ts:176`

captureWindowHooks.beforeCapture hides only capturePanel and mainWindow. The camera bubble window is shown by the hub as soon as the shared Camera toggle flips on (recording-hub.ts:74-80), independent of any recording, and is always-on-top — so it sits inside the native screencapture region. The design intent ('the app must get OUT of the way during a capture') is violated for this window.

**Repro / scenario:** Enable the Camera toggle on the Record page (the webcam bubble appears), then press ⌘⌃X and select a region that includes the bubble. The saved screenshot contains the floating webcam bubble with the user's face, even though every other app window was hidden for the shot.

**Suggested fix:** Hide the camera bubble (and, if 'show bar in recording' is off, the control bar) in beforeCapture and restore it in afterCapture, mirroring the mainWindow visibility bookkeeping.

### 23. Start-recording shortcut during an active recording re-shows the main window into the recording with no feedback — ✅ Fixed (`fix/recording-engine-lifetime`)

**Medium · Robustness · found by `flow-isolation`** — `apps/kaipu-record/src/main/index.ts:108`

triggerStartRecording never checks the hub's activity: while a recording is running it calls showMainWindow() + focus, un-hiding the window the hub deliberately hid at recordingStart. The Record page's guard then blocks the double start, but the user gets no 'already recording' toast — just the app window suddenly appearing inside their recording, with a live sidebar that enables the orphaned-recording navigation bug (finding 1).

**Repro / scenario:** While recording a presentation, absent-mindedly press ⌘⌃V again. The Kaipu window pops to the front and is burned into the recording; nothing explains why, and the exposed sidebar invites a click that would destroy the recording.

**Suggested fix:** In triggerStartRecording, when activity.active, skip showMainWindow and instead flash the control bar / show a notification ('Already recording — ⌘⌃S to stop').

**Independently reported by:** `recording` — “Global start shortcut / panel actions un-hide the main window mid-recording with no way to re-hide it”; `flow-improvements` — “Pressing the global start shortcut while already recording pops the hidden main window into the shot”

### 24. Main window is hidden only AFTER the engine starts — every recording's first frames and poster thumbnail show the Kaipu app itself — ✅ Fixed (`fix/recording-engine-lifetime`)

**Medium · Bug · found by `recording`** — `apps/kaipu-record/src/renderer/src/features/recording/hooks/use-screen-recorder.ts:109`

Order in start(): `await startEngine(...)` (which begins screen capture immediately and captures the poster thumbnail ~150ms+ after the stream opens) → then `recordingStart` IPC → only then does the hub hide the main window (recording-hub.ts:108). The Record page (with the countdown overlay) is the frontmost focused window over the recorded screen during this whole span, and the main window has no contentProtection. So the encoded stream's opening ~0.5s shows the Kaipu window disappearing, and captureThumbnail (recorder-engine.ts:221) bakes the app window into the library poster of essentially every screen recording.

**Repro / scenario:** User records their primary display from the Record page → the saved video opens with the Kaipu Record window vanishing, and the library card's thumbnail is a picture of Kaipu Record instead of the recorded content.

**Suggested fix:** Hide the main window (send recordingStart, or a dedicated 'hide' IPC) BEFORE calling startEngine, or setContentProtection(true) on the main window for the start transition; alternatively capture the thumbnail after the hide settles.

### 25. Window-source resize mid-recording distorts the video (compositor keeps the start-time aspect ratio) — ✅ Fixed (`fix/recording-engine-lifetime`)

**Medium · Bug · found by `recording`** — `apps/kaipu-record/src/renderer/src/features/recording/recording-compositor.ts:78`

The compositor computes `target` once from getSettings at start and every frame does `ctx.drawImage(video, 0, 0, target.width, target.height)` — a stretch-to-fill of the CURRENT frame into the ORIGINAL aspect ratio. Screen sources have fixed AR, but window sources (the picker offers windows) change dimensions whenever the user resizes the window; from that moment every frame is non-uniformly squeezed, silently reintroducing exactly the distortion the fitToCap rework fixed. In the raw (no-compositor) path a mid-stream dimension change hits the encoder instead, which may error and kill the recording via onError.

**Repro / scenario:** User records a Chrome window and drags it wider halfway through → the second half of the recording shows everything horizontally squashed.

**Suggested fix:** Per frame, read video.videoWidth/videoHeight and letterbox/uniform-fit into the canvas (or recompute a uniform scale each frame), rather than stretching into the fixed target rect.

### 26. Changing beautify padding while a crop is applied desynchronizes preview and export (frame frozen at stale measured size)

**Medium · Bug · found by `screenshots`** — `apps/kaipu-record/src/renderer/src/features/screenshots/beautify/beautified-frame.tsx:51`

In windowed (cropped) mode the frame is rendered at the fixed frameSize measured while un-windowed, and the ResizeObserver deliberately does not re-measure while windowed. The BeautifyPanel stays active, so moving the padding slider with a crop applied shrinks/grows the <img> inside the frozen frame (max-width/height:100% against the fixed content box), and because the image scales uniformly (object-fit) one axis gains centering slack — effective padding on that axis no longer equals `beautify.padding`. The export (compositor fullW/fullH = natural + 2\*pad) always applies the exact new padding on both axes and composes a frame of a different size, so the normalized crop window selects different content than the preview shows. The preview frame also stops growing/shrinking with padding entirely, unlike the un-cropped state.

**Repro / scenario:** Capture a wide shot → crop to a sub-region (crop applied, windowed preview) → drag the padding slider from 0 to 96. The preview frame does not grow; the shot shrinks and recentres with uneven gaps. Export the image: the saved PNG's crop window shows a different composition (exact 96px-equivalent padding on all sides) than the on-screen preview.

**Suggested fix:** Recompute the windowed frame size from the current beautify state (displayedShotW + 2\*padding) instead of freezing the un-windowed measurement, or disable/apply-and-exit the beautify sliders while a crop is applied.

### 27. Clicking the Dock icon never reopens the main window once any hidden auxiliary window exists

**Medium · Bug · found by `settings-ipc`** — `apps/kaipu-record/src/main/index.ts:297`

The activate handler recreates the main window only when BrowserWindow.getAllWindows().length === 0. But the Capture Panel window persists hidden after its first show (CapturePanelWindow.hide() hides, never destroys — capture-panel-window.ts:40), and the control-bar window persists hidden after the first recording (ControlBarWindow.hide() at control-bar-window.ts:98). Once either has ever been shown, getAllWindows() is never empty, so activate does nothing after the user closes the main window.

**Repro / scenario:** Open the tray Capture Panel once (or finish one recording), then close the main window with Cmd+W (app stays alive — macOS + tray). Click the Kaipu Dock icon: nothing opens. The only recovery paths are the tray menu or the ⌘⌃O shortcut; the Dock icon appears dead.

**Suggested fix:** In the activate handler, check the tracked mainWindow reference instead: if (!mainWindow || mainWindow.isDestroyed()) createWindow(); else showMainWindow();

**Verifier note:** Bug confirmed exactly as described, but severity is medium, not high: the app is deliberately tray-first (index.ts:301-303 comment: "The app lives in the menu bar"), the always-visible tray reopens the main window in one click via showMainWindow (index.ts:292), and the ⌘⌃O bringAppToFront rescue shortcut (index.ts:140-144) exists specifically for reachability. The Dock click silently doing nothing is a real, reachable defect in default config, but it is recoverable with no data loss or dead-end.

### 28. settings.json is written non-atomically; a crash mid-write loses all settings and mints a new analytics deviceId — ✅ Fixed (`fix/surface-silent-failures`)

**Medium · Robustness · found by `settings-ipc`** — `apps/kaipu-record/src/main/infrastructure/settings-store.ts:37`

persist() does a direct writeFileSync to settings.json. A crash/power loss/full disk mid-write leaves a truncated file; on next launch JSON.parse throws in load() and the catch silently resets to mergeSettings(null) — losing theme, dock policy, launch-at-login, recording quality, and all custom shortcut bindings — and because deviceId is now empty, a brand-new deviceId is minted and persisted, silently splitting the install's analytics identity. vault-location.ts write() (preferences.json) has the same non-atomic pattern, and its writeFileSync exceptions are not caught at all (an EACCES would reject the chooseVaultDirectory IPC).

**Repro / scenario:** Machine loses power (or the app is force-killed) during any settings save. On next launch every setting is back to defaults, the user's rebound shortcuts are gone, and analytics counts the install as a new device — with no error surfaced anywhere.

**Suggested fix:** Write to settings.json.tmp then renameSync over the original (atomic on the same volume); apply the same to preferences.json and wrap its write in try/catch.

### 29. Two actions can be bound to the same accelerator; one silently stops working and is mislabeled 'in use by another app'

**Medium · Bug · found by `settings-ipc`** — `apps/kaipu-record/src/renderer/src/pages/shortcuts/shortcuts-page.tsx:73`

Neither ShortcutInput/captureShortcut nor mergeShortcuts (settings.service.ts:31) checks a newly captured accelerator against the other three bindings. applyGlobalShortcuts registers actions in SHORTCUT_ACTIONS order, so with a duplicate the second globalShortcut.register returns false and that action's hotkey is dead. The Shortcuts page then renders the failure with the hardcoded copy 'in use by another app' (line 67), which is wrong for both the duplicate case and the malformed-accelerator case — the user is told to blame another app for a conflict inside Kaipu itself.

**Repro / scenario:** On the Shortcuts page, rebind 'Stop recording' to ⌘⌃C (already Start recording). Save succeeds with no warning. During the next recording ⌘⌃C fires startRecording (which now also pops the window into the shot) and the stop hotkey does nothing; the page claims another app owns it.

**Suggested fix:** Reject (or swap) duplicates in the onChange handler before calling update(), and differentiate the status copy (duplicate within Kaipu vs owned by another app).

**Independently reported by:** `flow-improvements` — “Rebinding a shortcut to a combo already used by another Kaipu action silently breaks it and mislabels the conflict as 'in use by another app'”

### 30. Changing the recordings folder silently empties the library and breaks open playback — no migration, warning, or folder validation

**Medium · Design · found by `settings-ipc`** — `apps/kaipu-record/src/main/library/index.ts:57`

chooseVaultDirectory just persists the chosen path. Every subsequent call (list, media-protocol resolution, copy/read screenshot bytes) builds a fresh LibraryVault on the new path, so all existing recordings/screenshots — still on disk in the old folder — vanish from the Library with no explanation, and a video currently open in the player breaks on the next Range request/seek because kaipu-media://recording/<id> now resolves into the new (empty) folder where filePath() falls back to a nonexistent <id>.mp4. Nothing offers migration, mentions the old location, or verifies the new directory is writable.

**Repro / scenario:** User records 10 clips, then in Settings → Files picks ~/Documents/Recordings while watching a clip. The playing video errors on seek, the Library shows empty, and the user believes their recordings were deleted (they are still in ~/Movies/Kaipu Record, but the UI never says so).

**Suggested fix:** On change, at minimum show a confirm dialog stating existing items stay in the old folder (with a 'move files' option), mkdir + writability-check the new path before persisting, and broadcast a library-changed event so open pages refresh.

**Independently reported by:** `flow-improvements` — “Changing the recordings folder silently 'empties' the library — no migration, no explanation that existing files stay behind”

## Low

### 31. Cross-process defaults restated instead of derived: RecordingSettings default and IDLE RecordingActivity are hand-copied in renderer and main

**Low · Design · found by `design-conformance`** — `apps/kaipu-record/src/renderer/src/features/recording/hooks/use-recording-settings.ts:4`

enums-as-const.mdx ('Corollary: derive, don't restate', lines 77-91) mandates that a value never be copied into a second module. The initial RecordingSettings object is written out twice: renderer use-recording-settings.ts:4-10 (DEFAULT) and main recording-hub.ts:53-59 (the hub's authoritative `settings`). Likewise the idle RecordingActivity is written twice: renderer use-recording-activity.ts:4 (IDLE) and main recording/recording-activity.ts:9-13 (IDLE_ACTIVITY) — the pure module lives under main/ so the renderer cannot import it and restates it. The zero-levels tick `[0, 0, 0, 0, 0]` is additionally restated three times (use-screen-recorder.ts:120,167; control-bar-window.tsx:8).

**Repro / scenario:** Change the product default `isMicrophoneEnabled` to false in recording-hub.ts only (the single source of truth per the doc): every window still renders mic-ON during the mount-query gap, and a user clicking the mic toggle in that gap sends an optimistic patch computed from the stale renderer default, flipping the setting the wrong way once the broadcast reconciles.

**Suggested fix:** Export DEFAULT_RECORDING_SETTINGS and IDLE_ACTIVITY (and a ZERO_LEVELS/BAR_COUNT constant) from shared/types/ipc.ts (or move recording-activity.ts into shared/), and import them in both processes.

**Verifier note:** severity adjusted from medium to low. The duplication is real: use-recording-settings.ts:4-10 restates recording-hub.ts:53-59, use-recording-activity.ts:4 restates recording-activity.ts:9-13, and enums-as-const.mdx ('Corollary: derive, don't restate' — 'never copy a value into a second module') explicitly forbids it. Downgraded to low: the renderer copies are only mount-gap placeholders reconciled by the query+broadcast within millise

### 32. Riskiest coordination modules have zero tests: media-protocol's path-traversal guard, recording-hub, and all window managers

**Low · Design · found by `design-conformance`** — `apps/kaipu-record/src/main/media-protocol.ts:13`

The project's own pattern (recording-pipeline.mdx: 'lógica pura testeada'; main modules like recording-activity, recording-writer, library-vault, settings.service all have co-located tests) is not applied to the remaining risk surface: media-protocol.ts — whose isUnsafeId (line 13) is called out in library-vault.mdx as a do-not-bypass guard against path traversal — is a trivially testable pure predicate with no test; recording-hub.ts (the cross-window coordinator: settings merge, camera-bubble show/destroy, dock-policy sequencing) has no test; control-bar-window.ts, camera-bubble-window.ts, capture-panel-window.ts, global-shortcuts.ts, and permissions.ts have none either.

**Repro / scenario:** A refactor of the protocol handler (e.g. moving decodeURIComponent after the guard, or resolving the path before validating) silently reopens kaipu-media://../.. traversal to arbitrary files — no test fails. Similarly, reordering the camera-bubble destroy/show logic in the hub (the documented device-release gotcha at recording-hub.ts:84) regresses the 'green camera light stays on' bug with no safety net.

**Suggested fix:** Add unit tests for isUnsafeId + the handler's id extraction, and extract the hub's settings-merge/bubble-transition decisions into a pure tested module like recording-activity.

**Verifier note:** severity adjusted from medium to low. Verified: find over src/main shows tests only for writer/activity/vault/settings/analytics/screenshot-capture — media-protocol.ts, recording-hub.ts, and all window managers have none, and library-vault.mdx:72 explicitly marks isUnsafeId (media-protocol.ts:13) as a do-not-bypass traversal guard. Downgraded to low: no written rule mandates tests for these modules (the cited 'lógica pura testeada' is

### 33. screenshot-editor-page breaks the 'composition only' page rule: inline export/persist business logic and hand-rolled UI while ui/IconButton sits dead

**Low · Design · found by `design-conformance`** — `apps/kaipu-record/src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:103`

renderer-architecture.mdx: pages are 'Composition only — local state + wiring' and 'A page never owns markup it could delegate'. The 278-line editor page owns the export pipeline (exportPng, persist, the savedId/overwrite-or-copy state machine, busy-ref double-click guard, lines 103-150) that belongs in a features/screenshots hook, plus hand-rolled markup that duplicates existing ui/ primitives: styles.iconBtn buttons (lines 160-177, 224-250) while ui/icon-button.tsx has ZERO consumers anywhere in the app (dead primitive), and a bespoke savedToast (line 256) alongside the existing ui/toast + toast-store system.

**Repro / scenario:** The library-detail screenshot viewer (or any future surface that needs 'copy edited shot') cannot reuse the export/save logic without re-implementing it, and the two implementations drift (e.g. one preserves createdAt on overwrite, the other doesn't); meanwhile IconButton bit-rots unused, so the 'would I use this in any app? → ui/' rule stops being trustworthy.

**Suggested fix:** Extract a use-editor-actions (exportPng/copy/save/overwrite) hook under features/screenshots, render icon buttons with ui/IconButton (or delete the primitive), and route the saved confirmation through the ui/toast store.

### 34. Pressing Escape anywhere in first-run onboarding permanently marks it complete and skips permission setup

**Low · Improvement · found by `flow-improvements`** — `apps/kaipu-record/src/renderer/src/features/onboarding/onboarding-overlay.tsx:49`

The overlay's keydown handler maps Escape directly to onClose, and OnboardingProvider.finish() calls markOnboardingComplete() unconditionally — the same as finishing all three steps. There is no confirmation and no distinction between "completed" and "dismissed": a single reflexive Esc on the welcome screen writes the localStorage flag and the flow never auto-shows again.

**Repro / scenario:** New user's first act in the app is pressing Esc (a universal "dismiss this overlay" reflex) before reading anything. Onboarding vanishes forever, screen/mic permissions are never walked through, and their first recording attempt lands on a source picker full of permission notices with no context. The Replay button exists but is buried in Settings they don't know about.

**Suggested fix:** Treat Esc as "skip this session" (close without markOnboardingComplete so it reappears on next launch), or only honor Esc after the permissions step, keeping the explicit "Skip setup" button as the deliberate opt-out.

**Verifier note:** The Esc→permanent-dismiss mechanics are exactly as described, but the scenario's harm is overstated: a user who skips onboarding is not stranded. The record page surfaces denied mic/camera permissions in-context with "Open Settings" CTAs (record-page.tsx:116-139, permission-notice.tsx), the source picker gates on screen permission with a grant-access action (record-page.tsx:176-183), and Settings has both a per-permission grant section and the onboarding Replay row (settings-page.tsx:77-88, 156-164). Esc is also intentional keyboard parity with the confirmation-free "Skip setup" button (overlay.tsx:94-96, codified in onboarding-overlay.test.tsx:62-67). The residual issue is only that an accidental keypress is treated the same as a deliberate skip click; the suggested fix (Esc = skip-this-session, no flag write) remains the right cheap improvement.

### 35. Screenshot capture failure rejects unhandled — button click and ⌘⌃X produce zero feedback when screencapture errors

**Low · Robustness · found by `flow-improvements`** — `apps/kaipu-record/src/renderer/src/features/screenshots/use-screenshot-capture.ts:8`

capture() awaits window.electronAPI.captureScreenshot() with no try/catch, and every caller invokes it as `void capture()` (screenshots-page.tsx:20, app-shell.tsx:53). In main, provider.captureInteractive() propagates execFile failures (screencapture exits non-zero, e.g. Screen Recording permission denied, or the binary is sandbox-blocked); the finally block restores the window, but the rejection then reaches the renderer as an unhandled promise — no toast, no state change.

**Repro / scenario:** User denied Screen Recording permission earlier, then clicks "Capturar pantalla" on the Screenshots page. The window blips hide/show and nothing else happens — no region selector, no error, no pointer to the permission fix. They click again a few times and conclude the feature is broken.

**Suggested fix:** Wrap the await in try/catch → reportError with a message that mentions the Screen Recording permission and an "Open Settings" action; consider checking checkPermissions().screen before invoking the native flow.

**Verifier note:** The missing try/catch and zero-feedback rejection path are real, but the trigger is not Screen Recording permission denial: `screencapture` with TCC denied exits 0 and captures wallpaper-only content (a different bug — wrong pixels, not a rejection). The unhandled rejection is only reachable when `screencapture -i` exits non-zero, e.g. another interactive capture already active system-wide (user's ⌘⇧5 overlay or another app; the `capturing` guard at screenshot-ipc.ts:33 is app-local only) or temp PNG write/read failure. Window visibility is correctly restored in all cases (screenshot-ipc.ts:42-44), so the impact is silence on an edge-case failure. Fix suggestion stands (try/catch → reportError toast, plus a CGPreflightScreenCaptureAccess-style permission preflight to catch the far more common wallpaper-only degradation).

### 36. Delete confirmation always says 'Delete recording?' even when deleting a screenshot

**Low · Improvement · found by `flow-improvements`** — `apps/kaipu-record/src/renderer/src/features/library/components/delete-confirm-dialog.tsx:30`

ModalTitle is hardcoded to "Delete recording?" and the body says "removed from your vault". Both LibraryPage and LibraryDetailPage reuse this dialog for screenshot items (video.kind === "screenshot") without passing the kind, so the confirmation names the wrong object type. Additionally the dialog's isDeleting prop is never wired by either caller — remove() is fire-and-forget and the dialog closes instantly, so the affordance for a slow/failed delete is dead code.

**Repro / scenario:** User deletes an annotated screenshot from its detail page and is asked to confirm deleting a "recording" — a beat of doubt about whether they're about to delete the wrong item (a video instead of the shot), exactly at the one moment the dialog exists to create confidence.

**Suggested fix:** Accept a kind prop ("recording" | "screenshot") and render "Delete screenshot?" accordingly; either wire isDeleting to the awaited remove() or drop the prop.

### 37. Global shortcuts are live during onboarding — ⌘⌃V starts a recording behind the overlay and hides the window mid-onboarding

**Low · Robustness · found by `flow-isolation`** — `apps/kaipu-record/src/main/index.ts:246`

registerGlobalShortcuts runs unconditionally at startup, and the AppShell hotkey handlers plus RecordPage auto-start (with useSourceSelection auto-selecting the primary screen) are all mounted underneath the OnboardingOverlay. Nothing gates the start/capture actions on onboarding being open.

**Repro / scenario:** User replays onboarding from Settings (permissions already granted) and, while reading the permissions step, tries the shortcut the status bar advertises: ⌘⌃V. The countdown runs behind the onboarding overlay, then the whole window (onboarding included) hides and the floating bar appears — the user is dumped out of onboarding into a recording they didn't understand they started.

**Suggested fix:** Gate the AppShell hotkey handlers (start/capture) on onboarding.isOpen (context is available), or suspend the global shortcuts while the onboarding overlay is up.

### 38. Height-only cap punishes portrait displays: a 1080×1920 portrait monitor records at 608×1080

**Low · Design · found by `recording`** — `apps/kaipu-record/src/shared/recording-quality.ts:68`

fitToCap applies the resolution step exclusively as a height cap: `height = min(capHeight, sourceH)`. For a portrait/rotated display (sourceH >> sourceW) this massively over-downscales: 1080×1920 at the default 1080 cap → 608×1080 (0.63 MP vs the ~2 MP a landscape 1920×1080 user gets at the same preset); a portrait 4K panel (2160×3840) → 1080p-cap → 608×1080 too. The preset's intent ('1080p-class quality') is not honored for portrait sources.

**Repro / scenario:** Developer records their vertically-rotated code monitor at the default 'Equilibrado' preset → output is 608×1080, text is visibly blurry, while a landscape colleague gets crisp 1920×1080.

**Suggested fix:** Cap the SHORTER dimension (e.g. `if (sourceW < sourceH) cap width at RESOLUTION_DIMENSIONS[step].height * ar` style), or cap by total pixel budget of the step, so portrait and landscape get equivalent quality.

**Verifier note:** severity adjusted from medium to low. fitToCap (recording-quality.ts:63-71) is verifiably a height-only cap: 1080×1920 portrait at the 1080 step yields 608×1080, far below the ~2MP a landscape user gets. However this is the explicitly documented design ('the resolution step is a HEIGHT CAP', recording-quality.ts:57-62 and recorder-engine.ts:77-78), so it's a deliberate tradeoff that degrades a niche (portrait/rotated) source rather th

### 39. Stop pressed during the 'starting' gap is silently dropped — recording starts anyway — ✅ Fixed incidentally (`fix/recording-engine-lifetime`, unified stop/cancel path)

**Low · Bug · found by `recording`** — `apps/kaipu-record/src/renderer/src/features/recording/hooks/use-screen-recorder.ts:157`

stop() returns early when `!engine || !sessionId`. Between the countdown ending and startEngine resolving (stream acquisition, thumbnail's 150ms wait — easily ~0.5-1s), `sessionRef` is set but `engineRef` is null, so a stop command (global stop shortcut, since the control bar isn't up yet) is discarded and the recording proceeds. There is no pending-stop flag, so the user's cancel intent is lost.

**Repro / scenario:** User triggers start via hotkey, immediately regrets it and hits the stop hotkey during the acquire gap → nothing happens, the app window hides and the recording runs until they stop it again.

**Suggested fix:** Set a `cancelRequestedRef` when stop() arrives during 'starting'; check it right after startEngine resolves and run the normal teardown (engine.stop + abort + recordingStop) instead of proceeding.

### 40. Camera bubble is positioned on the cursor's display, not the recorded display — it can be absent from the recording

**Low · Bug · found by `recording`** — `apps/kaipu-record/src/main/recording/camera-bubble-window.ts:79`

CameraBubbleWindow.position() uses `screen.getDisplayNearestPoint(screen.getCursorScreenPoint())`, unlike ControlBarWindow which resolves the recorded display via displayIdForSource. The bubble's entire purpose is to be captured inside the recording ('because it sits on screen, the screen recording captures it'), but on multi-monitor setups it lands wherever the cursor happens to be when toggled.

**Repro / scenario:** User records their external display while the cursor is on the laptop screen, toggles the camera on from the Capture Panel → bubble appears on the laptop screen → the recorded video has no camera at all and the user only discovers it after finishing.

**Suggested fix:** Route the recorded display id (same displayIdForSource resolution the hub does for the bar) to cameraBubble.show(), and reposition the bubble when recording starts on a different display.

### 41. roughRect jitter amplitude is not scaled in export, so the hand-drawn box style largely disappears in saved PNGs

**Low · Bug · found by `screenshots`** — `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/rough.ts:18`

roughRect's jitter magnitude is hardcoded `m = 1.7` px. The compositor scales the corner radius (14\*scale) and stroke width but the jitter stays 1.7 native px, versus 1.7 display px in the preview. At export scale 2–3x the jitter is 2–3x smaller relative to the shape, so the two offset strokes nearly coincide and the sketchy double-line look flattens into a plain rounded rect.

**Repro / scenario:** Retina capture displayed at ~1/3 natural size → draw a box annotation (clearly sketchy in the preview) → Save. The exported box looks like a clean, non-hand-drawn rectangle with a faint double edge — visibly different style from the editor.

**Suggested fix:** Add a jitter-scale parameter to roughRect (m = 1.7 \* scale) and pass the compositor's scale, keeping the preview at scale 1.

**Verifier note:** severity adjusted from medium to low. m = 1.7 is hardcoded in rough.ts:18 while compositor.ts:152-154 scales radius and stroke, so jitter is 2-3x smaller relative to the shape in Retina exports. However the double-stroke look (two seeds at opacity 0.55) persists with reduced amplitude, so this is a subtle cosmetic fidelity loss rather than the style disappearing — low, not medium.

### 42. Escape pressed mid-crop-drag corrupts undo history with the half-dragged crop

**Low · Bug · found by `screenshots`** — `apps/kaipu-record/src/renderer/src/features/screenshots/beautify/crop-overlay.tsx:71`

The Escape handler nulls drag.current and calls scn.setCrop(undefined), which commits by pushing sceneRef.current — the scene containing the live, in-progress crop from setCropLive — onto the undo stack. The beginInteract snapshot taken at pointerdown (the pre-drag crop) is discarded: pointerup returns early because drag.current is null, so endInteract never pairs. Undo after Escape therefore restores the transient mid-drag rect instead of the crop that existed before the drag started.

**Repro / scenario:** Apply a crop rect A → start dragging a corner handle (rect live-updates to some intermediate B) → press Esc while still holding the button (crop resets to full frame) → click Undo. The crop comes back as the meaningless mid-drag rect B, not A.

**Suggested fix:** In the Escape branch, first restore the snapshot (setCropLive to the pre-drag crop via endInteract-style rollback) before committing setCrop(undefined), or commit from snapshot.current when a drag is active.

### 43. Committed text jumps from where it was typed (input box padding/line metrics vs SVG hanging baseline)

**Low · Improvement · found by `screenshots`** — `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-layer.tsx:297`

The inline text input is positioned at (editing.x*W, editing.y*H) with `padding: 2px 4px` (annotation-layer.module.css .textInput) and line-height 1, while the committed annotation renders an SVG <text> at the same x/y with dominant-baseline:hanging and no padding. The glyphs therefore shift left ~4px and up ~2px (plus any baseline metric difference of the hand font) the moment Enter is pressed, so precise placement (e.g. aligning a label with a UI element in the shot) is off after commit.

**Repro / scenario:** Choose the text tool, click exactly on a form field's left edge in the screenshot, type a label, press Enter: the committed label sits a few pixels up-left of where the typed text was shown, requiring a manual nudge every time.

**Suggested fix:** Offset the input by its padding (left: x*W - 4, top: y*H - 2) or remove the input padding, so the typed glyph origin matches the SVG text origin.

### 44. Exported background gradient angle and shadow spread differ subtly from the preview

**Low · Improvement · found by `screenshots`** — `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/compositor.ts:70`

Preview gradients are CSS `linear-gradient(135deg, ...)` (angle-based; the gradient line direction is constant regardless of box aspect), but the export emits <linearGradient x1=0 y1=0 x2=1 y2=1> in objectBoundingBox units (corner-to-corner; direction depends on the frame's aspect ratio). For wide frames the exported gradient axis is visibly more horizontal than the preview. Similarly, shadowCss uses a negative spread (`-spread`) that feDropShadow (line 77) cannot express, so the exported shadow reads slightly larger/heavier than the preview at high shadow values.

**Repro / scenario:** Beautify a very wide (e.g. 3440x600 ultrawide) capture with the Ocean gradient and shadow 100 → export. The saved PNG's gradient runs at a noticeably shallower angle than the editor preview and the shadow halo is wider.

**Suggested fix:** Compute the SVG gradient vector from the 135deg CSS angle and the frame's aspect (or use gradientTransform), and shrink the shadow rect by the spread amount before applying feDropShadow.

### 45. Three IPC channels are wired with raw string literals outside the IPC_CHANNELS contract

**Low · Design · found by `settings-ipc`** — `apps/kaipu-record/src/preload/index.ts:25`

"recording:get-screen-sources" (preload:25 / recording-sources.ts:13), "capture-panel:resize" (preload:26 / capture-panel-window.ts:97), and "capture-panel:open-main" (preload:27 / main/index.ts:210) bypass the shared IPC_CHANNELS map that the file's own docs call the mechanism that 'keeps main and renderer in sync'. A typo on either side compiles fine and fails only at runtime as a silently-dead channel (invoke would reject, sends vanish). Everything else in the app goes through the typed map; these three are the only drift. (The leftover "ping" test handler at main/index.ts:202 is similar dead wiring.)

**Repro / scenario:** A future rename of the capture-panel resize channel in capture-panel-window.ts but not preload (or vice versa) type-checks cleanly; the panel then renders at the wrong height with no error anywhere.

**Suggested fix:** Add getScreenSources/capturePanelResize/capturePanelOpenMain entries to IPC_CHANNELS and use them on both sides; delete the 'ping' handler.

**Independently reported by:** `design-conformance` — “Three IPC channel names are restated as inline string literals on both sides, defeating the stated purpose of the IPC_CHANNELS const map”

### 46. No single-instance lock: a second app instance fights over settings.json, global shortcuts, and the tray

**Low · Robustness · found by `settings-ipc`** — `apps/kaipu-record/src/main/index.ts:190`

main/index.ts never calls app.requestSingleInstanceLock(). A second instance (open -n on macOS, plain double-launch on Windows/Linux, or a dev instance alongside a packaged one sharing userData in edge setups) loads settings.json into its own memory and each instance's updateSettings persist() blindly overwrites the file with its own stale snapshot — last writer wins, silently reverting the other instance's changes. The second instance also fails to register any global shortcut (first instance owns them) and adds a duplicate tray icon.

**Repro / scenario:** User launches a second copy via `open -n`. They rebind a shortcut in instance B while instance A later toggles the Dock setting; A's write resurrects the old shortcut binding. Meanwhile B shows all shortcuts as 'in use by another app'.

**Suggested fix:** Call app.requestSingleInstanceLock() at startup; on failure app.quit(), and in the primary handle 'second-instance' by focusing the main window.

## Uncertain (verify by hand)

- **System-audio toggle on macOS likely makes getUserMedia reject — recording fails to start at all** (`recording`, high) — `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:89`. User flips the system-audio toggle on and presses record → countdown runs → 'No pudimos iniciar la grabación' every time (or, at best, recordings never contain system audio) on every macOS machine. _Verifier: recorder-engine.ts:87-101 does bundle audio:{mandatory:{chromeMediaSource:'desktop'}} into the same getUserMedia as video, so if macOS rejects the audio leg the whole start fails — but whether Electron 39 (Chromium ~142, which gained ScreenCaptureKit-based loopback paths) rejects, silently omits aud_
- **Shortcut actions sent on did-finish-load race the renderer's listener registration when the main window is recreated** (`flow-isolation`, medium) — `apps/kaipu-record/src/main/index.ts:162`. Close the main window with Cmd+W (app lives on in the tray). Press ⌘⌃X: no region selector appears, no window, no feedback — the shortcut appears broken. Pressing it a second time works (window now exists and is loaded). _Verifier: The mechanism is real — index.ts:162-166 sends on did-finish-load, listeners register in AppShell useEffects (app-shell.tsx:33-53) which flush asynchronously after commit, and an ipcRenderer message with no listener is silently dropped, with createWindow(false) at index.ts:159 leaving an invisible w_

## Refuted (checked, not real)

- [recording] getSettings() fallback uses the preset's 16:9 box — silently reintroduces the squeeze bug if width/height are unreported
- [screenshots] Text annotations use fixed CSS-pixel font size with normalized anchors, so resizing the editor window changes what the exported text covers
- [flow-isolation] Recording finalize completing while the user is in the screenshot editor can hijack or drop the completion navigation
- [design-conformance] cloud-reader is unreachable speculative code in an explicitly offline-only, desktop-only app
- [flow-improvements] Granting Screen Recording requires an app relaunch on macOS but no UI ever says so

## Not covered

Areas the finders explicitly did not reach; a follow-up pass could cover them.

- **recording**: Not inspected in depth: use-microphones/use-screen-sources internals (device enumeration, hot-plug), elapsed.ts and audio-levels.ts (pure + tested), watermark placement math (watermarkRect), control-bar UI component states (noted but did not verify a stale 'saving' tick flash when the bar window is reused for a second recording), tray.ts, capture-panel-window.ts sizing, global-shortcuts registration internals, settings-store Dock-policy internals, and library vault beyond finalize. The macOS system-audio finding (getUserMedia desktop-audio rejection) is inferred from Electron platform limitations and needs runtime validation on a real build; mediabunny's finalize-after-encoder-error behavior (hang vs reject) was also not empirically verified. Findings were capped at 13; dropped lower-value items (control-bar stale-tick flash, default source picking 'first screen' rather than primary display, no re-validation of a stale selected source after display disconnect — it fails at start with a recoverable error).
- **screenshots**: Not inspected in depth: preload bridge definitions and shared/types/ipc channel wiring for screenshots (assumed correct since flows ship), cloud-reader.ts (unused placeholder), use-recent-screenshots polling, the library screenshots grid page, screenshot-capture cancel semantics on real macOS (whether `screencapture -i` exits non-zero on Esc, which would make the fileExists cancel path dead and surface as an unhandled rejection — could not be verified without an interactive run), smooth.ts numerical edge cases beyond 0/1/2-point paths, and the test suites' coverage gaps beyond compositor.test.ts. Minor items found but dropped to stay under the cap: ±1px crop-edge rounding from independent Math.round of viewBox origin vs size (compositor.ts:87-90), 'Caveat' leading the HAND_FONT stack without being bundled (silently falls back to Comic Sans on most machines, same in preview and export), and stale frameSize when the OS window is resized while a crop is applied.
- **settings-ipc**: Inspected in depth: settings.service(+test), settings-store, full IPC contract cross-check (shared/types/ipc.ts + electron-api.ts vs preload/index.ts vs all main handlers vs renderer callers — all declared channels are wired; only the three raw-string channels drift), global-shortcuts + shortcut-input/keyboard-accelerator/shortcuts-page, permissions (main + use-permissions + onboarding store/provider), library-vault/vault-location/library index/media-protocol, recording-hub/recording-writer settings interplay, capture-panel-window, record-page/app-shell/use-recording-setup/use-screen-recorder for shortcut-vs-recording-state collisions. NOT inspected: tray.ts, camera-bubble-window.ts, auto-updater.ts, analytics.service.ts internals, screenshot-capture.ts provider, the recorder engine/compositor, version-gate/watermark features, onboarding overlay step components, library renderer hooks (use-local-library, use-vault-directory) beyond skimming, and the test suites other than settings.service.test.ts. Findings I dropped to stay under the cap (lower severity): renameLocalRecording creates orphan sidecars for nonexistent ids; capture-panel:resize does not guard non-finite heights (setContentSize would throw); LibraryVault.list produces duplicate rows if a user manually places <same-id>.mp4 and <same-id>.png in the vault; recording-writer timestampId is second-resolution (collision overwrite theoretically possible); the shortcuts page can revert a just-saved binding if two rebinds happen faster than the IPC round-trip (stale spread of settings state).
- **flow-isolation**: Inspected the full cross-window flow set (main index/hub/tray/capture-panel-window/screenshot-ipc/global-shortcuts/recording-writer, renderer app-shell/router/record-page/editor/capture-panel/control-bar/onboarding/shortcut-input/preload). Not inspected in depth: recorder-engine.ts internals (stream-ended/system source-loss handling beyond the onError hook), control-bar-window.ts and camera-bubble-window.ts window-level flags (always-on-top level fights between the bar, bubble, capture panel, and the native screencapture overlay), the auto-updater's installDownloadedUpdate quitting during an active recording (same family as the unguarded-quit finding but not traced), library delete/rename while a detail page is playing the same file, vault-directory relocation mid-recording/mid-editor, and the beautify/crop tool internals. Also did not run the app to time the did-finish-load race empirically. Two low findings were cut for the 14-item budget: useRecordingActivity's brief idle flash before the async getRecordingState resolves (Capture Panel can momentarily show Start during a recording), and the CountdownOverlay lacking any cancel affordance (folded into the stop-ignored-during-countdown finding).
- **design-conformance**: Not inspected in depth: onboarding feature (store/provider/steps), analytics feature internals (client, crash-forwarder, use-flag), version-gate and updater renderer features, watermark hooks, the screenshot annotations subsystem internals (scene/compositor/crop/handles/rough/smooth — they have co-located tests), beautify hooks, library filter/format helpers and components, camera-bubble renderer + use-camera-preview, main/permissions.ts and tray.ts, and whether existing tests assert behavior vs implementation details (only spot-checked: pure-module tests like recording-activity/library-vault look behavior-oriented). CSS-token/cx()/data-\* styling conformance was only spot-checked (ui/ primitives conform). Cross-checked but not reported (benign): both windows racing the default-mic/default-source write into shared RecordingSettings; RecorderStatus vs RecordingStatus type overlap; control bar showing the previous recording's last tick for ~100ms on reshow.
- **flow-improvements**: Inspected in depth: record + capture-panel + control-bar recording flow (use-recording-setup/use-screen-recorder/recorder-engine, recording-hub, recording-writer), screenshot capture/editor/save (screenshot-ipc, screenshot-capture, editor page, image-source, save dialog), library list/detail/vault, onboarding + permissions (renderer and main), settings/shortcuts pages, app-shell/router, toast-store/modal. Not inspected line-by-line: camera-bubble window and use-camera-preview, beautify internals (backgrounds, beautified-frame, crop-overlay math), annotations subsystem internals (scene/tools/compositor — covered by another audit per memory), updater/version-gate/analytics features, tray.ts, media-protocol.ts, and the microphone/audio-levels modules. Findings dropped for the 14-cap: unhandled rejection on library-detail Copy/rename (folded into findings 3/10 descriptions), raw Error.message shown in the source picker (use-screen-sources.ts:51), and capture panel not surfacing mic/camera permission notices that the Record page shows.

## Next steps

1. Triage: decide fix-before-testers vs accept-and-track per finding (start with the 5 critical).
2. Fix theme 1 + 2 together — they interact (engine ownership × on-disk streaming).
3. After fixes land, fold lasting lessons into `desktop/recording-pipeline` and
   `desktop/renderer-architecture`, then drop this page and [fable-audit](./fable-audit)
   from the backlog per the docs workflow.
