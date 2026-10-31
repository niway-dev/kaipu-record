---
title: Webcam track — record the webcam as its own synchronized track and compose it as a layer above the zoom
description: Design for taking the webcam out of the screen pixels. The recorder renderer encodes a second MP4 from the webcam stream on the same clock as the screen, the floating bubble is excluded from the screen capture (Electron content protection first, a native ScreenCaptureKit exclusion if the spike shows it fails), and the video editor composes the webcam as a viewport layer after the auto-zoom crop, so the face never disappears into a zoom. Exports and Share burn the layer in; the original stays screen-only.
---

# Webcam track — design

**Status: 🟢 Ready to validate (prod review pending) · 2026-10-30.** Approved by the owner on
2026-10-30 from the design conversation; implemented across the NIW2-565 stack (recorder,
editor layer, export, Share, bubble content protection). Owner QA is pending, including the
exclusion matrix of section 3.5. Linear:
[NIW2-565](https://linear.app/niway/issue/NIW2-565). ADRs:
[0037](/architecture/decisions/0037-webcam-is-its-own-track-and-the-bubble-is-excluded-from-capture/)
(capture, storage, exclusion) and
[0038](/architecture/decisions/0038-webcam-is-a-viewport-layer-composed-after-the-zoom-crop/)
(editor model and composition), both new. Builds on the video editor v2 plans
([02 cursor track](/plans/video-editor-v2/02-cursor-track-capture-and-persistence/),
[09 preview compositing](/plans/video-editor-v2/09-preview-compositing/),
[11 export pass](/plans/video-editor-v2/11-export-pass/)) and on
[ADR 0030](/architecture/decisions/0030-recording-target-and-area-crop-in-the-compositor/), whose
[capture modes spec](/specs/2026-10-26-record-capture-modes-design/) decision 6 this design
supersedes. Backlog page: [webcam track](/backlog/webcam-track/).

Vocabulary: **webcam** is the new track and layer. **Camera path** keeps its meaning in the zoom
code (`zoom/camera-path.ts`): the virtual window the auto-zoom moves. The two are different
things and the code must not mix the words.

## Summary (one minute)

Today the webcam is a floating bubble window that the screen capture records as part of the
screen (`camera-bubble-window.ts`: "deliberately NOT content-protected"). The recorder
(`recorder-engine.ts`) writes one MP4 with the screen and the mixed audio; there is no webcam
file. So when the editor's auto-zoom crops into a region, the face is cropped away with the
rest of the frame, and the user records without zoom to keep it. The cheap fix — pasting the
bubble's pixels back from the unzoomed frame — was rejected: it is a hack over a wrong model.

This design does what Screen Studio, Cap, Tella and Camtasia do. The recorder renderer opens
the webcam beside the screen and encodes it into **its own file**, `.kaipu/<id>.webcam.mp4`,
through a second mediabunny `Output` on the same `performance.now()` clock; the offset between
the two files' time 0 is persisted on the sidecar, exactly as the cursor track is anchored
today. The bubble stays on screen as a preview but is **excluded from the capture**: Plan A is
Electron's content protection, which on this capture path hands in-process
`NSWindowSharingNone` windows to ScreenCaptureKit's `excludingWindows` (and
`WDA_EXCLUDEFROMCAPTURE` on Windows); a one-day spike with written pass/fail criteria goes first,
and if it fails Plan B is a native ScreenCaptureKit capture that excludes the bubble by window
id, as Cap does. Hiding the bubble during a take is rejected. The editor gains a **webcam
layer**: a global layout (shape, size, position, mirror, framing, shrink during zoom) plus
source-anchored segments that hide or override it, composed **after** the zoom crop and after
the output framing, so it stays in its corner while the zoom moves. The preview draws it as a
second `<video>` kept in step with the main one; the export worker decodes the webcam file in
lockstep and draws it through the same composer the GIF export uses. The original `<id>.mp4`
stays a screen-only video; every export and Share burns the layer in.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                          | ADR        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | **The webcam is its own file**, `.kaipu/<id>.webcam.mp4`, H.264, no audio, encoded by the recorder renderer with a second mediabunny `Output` and written through a second `RecordingWriter` session; `recordingFinalize` moves it beside the screen file and records it on the sidecar.                                                                                                                                                                                    | The screen file stays a universally playable video and the library, thumbnails and Share keep working unchanged; a second video track in one MP4 is invisible to every player we ship to and inflates the "original". Cap, Tella and Camtasia keep separate sources.                                                         | 0037 (new) |
| 2   | **Sync is one clock plus a stored start offset.** Both `Output`s live in the same renderer; `waitForFirstMediaTimestamp` gives each file's time 0; `startOffsetMs = webcamT0 − screenT0` and its `quality` go on the sidecar. Pause and resume call both sources in the same breath, so no drift accumulates.                                                                                                                                                               | It is the model the cursor track already uses (`first-media-timestamp.ts`, `cursor-clock.ts`) and the model Cap uses (`start_time` per track against one epoch). Two recorders with two clocks cannot be aligned exactly (W3C thread, Sources).                                                                              | 0037       |
| 3   | **The bubble is excluded from the capture, never hidden.** **Plan A is chosen (owner, 2026-10-30); Plan B is recorded, not scheduled.** Plan A: `setContentProtection(true)` on the bubble **from creation**, always; the spike (task 0) proves it on the owner's Mac and on Windows. Plan B, only if the spike fails: a native ScreenCaptureKit capture behind the engine's source seam that excludes the bubble by window id, under the repo's native-dependencies rules. | The owner wants to see the framing while recording and the screen recorded correctly ("if Cap could, we can"). Electron's own `desktopCapturer` path carries a Chromium patch that passes in-process protected windows to `initWithDisplay:excludingWindows:` (Sources); the control bar and the shade already depend on it. | 0037       |
| 4   | **Webcam capture: 1280×720 @ 30 fps**, 1080 lines only while framing is active (`cameraCaptureLines`), `avc`, ~2.5 Mbps, `prefer-hardware`, `realtime`. The file is **raw**: no mirror, no framing crop.                                                                                                                                                                                                                                                                    | Cap's defaults; 720p covers a 480 DIP bubble on a Retina display. Mirror and framing become layout properties, so they stay editable and the preview still shows them.                                                                                                                                                       | —          |
| 5   | **The editor models the webcam as a viewport layer**: `scene.webcam = { layout, segments } \| null`, additive inside session `version: 1` like `zoomSegments`; `layout` is global, `segments` are source-anchored, sorted, non-overlapping, each `hidden` or an `override`. The position is a normalized centre in the **output** frame.                                                                                                                                    | A viewport layer stays in its corner while the zoom moves — what every reference product does. Annotations are content-pinned and timeline-anchored; reusing them would zoom the face and lose it across cuts. Cap (`Camera` + style segments) and Tella (base layout + layout sections) use the same shape.                 | 0038 (new) |
| 6   | **Composition order**: `frame → redactions → overlays → zoom crop → framing (fixed-canvas presets) → webcam layer`, in the shared `createOutputComposer`, so MP4 and GIF cannot diverge. The preview draws the layer in a third, untransformed slot above `.content` and below `chrome`.                                                                                                                                                                                    | After the framer, a corner bubble is never cropped by Fill and is positioned against the real output. One composer is the v2 invariant that keeps privacy identical across exports; the webcam joins it rather than bypassing it.                                                                                            | 0038       |
| 7   | **Share composes the webcam at its recorded layout.** `WHOLE_RECORDING_FINGERPRINT` becomes `whole:<layout hash>` for recordings with a webcam, so an older "whole" export is not reused without the face.                                                                                                                                                                                                                                                                  | Share means "what I recorded", and what the user saw while recording had the bubble. The original file is screen-only by decision 1, so the one export path without edits must add it back.                                                                                                                                  | 0038       |
| 8   | **The original stays screen-only** and nothing migrates: a recording without `webcam` on its sidecar opens, plays and exports exactly as today (its bubble is in the pixels). `remove` deletes the webcam file; `removeLocalCopy` is refused while one exists until the cloud carries it.                                                                                                                                                                                   | ADR 0003: the original is never rewritten. Old recordings are already correct for what they are. The cloud transfer client is plan 03 and not built; the file must not be silently stranded.                                                                                                                                 | 0037       |
| 9   | **Task 0 is the exclusion spike**, run by the owner by hand, documented below with steps, pixels to check and the plan each outcome selects. It also settles the [terminal-line patch hypothesis](/backlog/bug-control-bar-hides-last-terminal-line/).                                                                                                                                                                                                                      | Everything above the recorder depends on whether the bubble can stay on screen and out of the file. One day of evidence before five weeks of code.                                                                                                                                                                           | —          |

### Open questions

Defaulted on 2026-10-30; each is taken as written unless its "revisit if" triggers.

1. **Layer anchoring.** Defaulted: viewport (stays put during the zoom). Revisit if the owner
   asks for a bubble that follows the zoomed content, which would be a content-pinned variant
   drawn before the crop.
2. **"Hold to see original".** Defaulted: the webcam layer is hidden while holding; the chip says
   UNEDITED and the original file has no face. Revisit if testers read the held frame as "the
   webcam broke".
3. **`scaleDuringZoom`.** Defaulted: in v1, an inspector toggle, on at 0.7 (Cap's default; Tella
   ships it on). Revisit if it reads as the bubble "breathing" on short zooms — then it eases
   on the camera path's scale, which it already samples.
4. **Position model.** Defaulted: free drag plus nine presets in the inspector (Tella's grid);
   no automatic snapping. Revisit if free positions drift off-frame in Fit exports.
5. **A setting to keep the burned-in bubble.** Defaulted: none; one capture path. Revisit only
   if a user needs the raw file with the face and refuses to export.
6. **`removeLocalCopy` with a webcam file.** Defaulted: refused with a reason, like an edit
   session refuses it today. Revisit when cloud plan 03 uploads the webcam as an auxiliary
   object of the asset.
7. **Webcam turned on or off mid-take.** Decided in code (NIW2-576 review): turning it off ends
   the file and the layer disappears from that source time; turning it on mid-take records **no**
   second webcam file. Instead, the bubble is left in the screen capture for the rest of that
   take (section 3.2), so the face is recorded in the screen pixels. Whether a running
   ScreenCaptureKit stream picks up a bubble that drops its protection mid-stream is unverified
   (spike rows 4/5).
8. **`window` targets.** Defaulted: same path (separate file, protected bubble). Unverified
   inference: with ScreenCaptureKit window capture the bubble was probably never in a window
   recording; task 0 checks it.
9. **Names.** Defaulted: `webcam` everywhere for the new track (`src/shared/webcam-track.ts`,
   `WebcamLayer`, `.webcam.mp4`); the zoom's `camera-path.ts` is not renamed now. Revisit when
   the zoom code is next touched broadly.
10. **Two consumers of one camera device.** The bubble's preview and the recorder renderer each
    call `getUserMedia` on the same device. Chrome shares a device between tabs; Electron
    across two renderers is assumed to behave the same. Task 0 confirms it; if it does not, the
    recorder renderer owns the device and streams preview frames to the bubble.

### Out of scope

- Camera-only, split-screen and fullscreen-webcam scenes (Cap `SceneMode`, Screen Studio
  "dynamic layouts"); animated transitions between layouts.
- Background blur or removal; shadows beyond a flat drop shadow.
- Audio on the webcam file (the microphone is already on the screen file).
- Uploading the webcam file to the cloud: it depends on the transfer client of
  [cloud plan 03](/backlog/desktop-cloud-sync-gap/), which does not exist. This design names the
  dependency and leaves the file local.
- Re-timing the webcam against the screen after the fact (Cap's audio cross-correlation): there
  is no audio on the webcam file and one clock makes it unnecessary.
- Linux.

### Failures this must protect against

Input for tests; each line is at least one test.

1. The bubble appears in the video → window options pinned like `floating-window-policy.test.ts`
   (`setContentProtection(true)` at creation, before any capture starts); task 0 proves it on
   hardware and the QA sheet repeats it on every release that touches capture.
2. The bubble leaves a blank or black patch where it stood → task 0's pixel check (content
   underneath visible); on Windows before 10 2004 the same rule as `canExcludeWindowFromCapture`
   keeps the legacy path there: the bubble stays unprotected and burned into the screen as
   today, no webcam track is recorded, and no take shows a black square.
3. The webcam file and the screen file disagree by more than one frame at start → the offset
   is read from mediabunny's first-media timestamp for both outputs (`exact`), the fallback is
   logged as `estimated`, and `webcam-track:check` prints both; a unit test fails if the private
   field disappears (as `first-media-timestamp.test.ts` already does).
4. Pause skews the two files → both sources pause and resume in the same call; a test on the
   engine handle asserts both are paused after `pause()` and both resumed after `resume()`.
5. The webcam file is written but the screen file fails (or the reverse) → `recordingAbort`
   and `salvage` treat the pair as one take: a stranded screen file without its webcam is a
   valid recording without a webcam; a webcam `.part` without a screen file is discarded.
6. A rename, delete or `removeLocalCopy` strands the webcam file → `LibraryVault` tests: `remove`
   deletes it, rename moves it with the id (NIW2-560), `removeLocalCopy` is refused while it
   exists.
7. The session carries a webcam layout for a recording that lost its file → the loader sets
   `scene.webcam = null` when the sidecar has no webcam, whatever the session says; the lane
   shows "webcam file missing" instead of an empty layer.
8. The export shows the face at the wrong moment → the worker's lockstep decoder holds the last
   webcam frame whose `timestamp + offset ≤ sourceTs` and never reads ahead; a test with a
   synthetic 30 fps webcam against 60 fps screen frames pins the mapping, including across a
   cut and across a pause gap.
9. The GIF export loses the face or the privacy regions → `createOutputComposer` tests cover
   the layer for both workers; the order test asserts redactions are applied before the crop
   and the webcam after the framer.
10. A Fill export crops the bubble, a Fit export draws it over the padding unexpectedly → framer
    tests with a corner layout for Vertical and Square: the bubble is wholly inside the output
    in both; its position is relative to the output canvas, not the view.
11. Share reuses an old "whole" export without the face → `export-reuse` tests: the fingerprint
    of a recording with a webcam is `whole:<hash>`, and `whole` alone never matches it.
12. An older build opens a new recording → `parseSession` ignores `webcam`; the file plays
    without the face; nothing throws. A new build opens an old session → `webcam` absent, the
    sidecar decides.
13. The preview's two `<video>` elements drift → the frame clock re-seeks the webcam element
    when `|webcam.currentTime − (t − offset)| > 80 ms`; a test on the pure drift rule.
14. Mirror or framing from the record-time settings are lost or applied twice → the webcam file
    is raw (engine test: no CSS transform reaches the encoder); the layout seeded from the
    sidecar carries `mirrored` and `framing`; the composer applies them once.
15. The hub's shutdown sequence (ADR 0031) leaves the webcam writer handle open → the second
    session registers with the same `dispose` as the first.

### Acceptance criteria

- [ ] Task 0 ran on the owner's Mac and on Windows with the written steps; the outcome table
      in section 3 is filled and the chosen plan (A or B) is named in NIW2-565.
- [ ] A 10 s take with the webcam on produces `<id>.mp4` (no bubble in its pixels) and
      `.kaipu/<id>.webcam.mp4`; the sidecar carries `webcam.startOffsetMs` with
      `quality: "exact"`.
- [ ] `bun run webcam-track:check <id>` prints both files' durations, the offset and its
      quality; a clap in front of the webcam lands within one frame of the screen's audio peak.
- [ ] Pause for 5 s mid-take: the clap after the resume still lands within one frame.
- [ ] The editor opens the recording with a Webcam lane and the layer at the bubble's recorded
      shape, size, corner and mirror; dragging the layer moves it; "Hide here" creates a segment.
- [ ] With an auto-zoom active, the preview shows the face in its corner above the zoomed
      content; the exported MP4 and GIF show the same frame for frame.
- [ ] Vertical (Fill) and Square (Fit) exports keep the whole bubble inside the output.
- [ ] Share on a recording with a webcam produces a file with the bubble at its recorded
      layout; Share again reuses it; an edit then Share from the editor does not reuse it.
- [ ] A recording made before this feature opens, plays and exports exactly as before.
- [ ] Delete removes both files; rename keeps them paired; "Remove local copy" is refused with
      the reason.
- [ ] The terminal-line hypothesis is closed one way or the other in its backlog page.

## 1. Capture and file

### 1.1 Engine

`recorder-engine.ts` (`prepareEngine`) gains `webcam?: { deviceId: string | null; lines: number } | null`
in `EngineOptions`. When set:

- A `getUserMedia({ video: { deviceId | facingMode: "user", width: { ideal: lines * 16/9 }, height: { ideal: lines } }, audio: false })`
  request opens beside the mic request and is settled **before** the screen is requested
  (released by `releaseMicOnFailure` on a failed start). A webcam that cannot be opened does not
  fail the take: the engine awaits `onWebcamUnavailable` (the store tells main through
  `recordingWebcamEnded`, which puts the bubble back in the capture) before it requests the
  screen, the take records the face in the screen, and the user gets a toast once it is saved.
  If main cannot acknowledge that report, the start fails like any other start: the screen is
  never requested.
- A second `Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(webcamWritable) })`
  with one `MediaStreamVideoTrackSource(webcamTrack, { codec: "avc", bitrate: WEBCAM_BITRATE_BPS, hardwareAcceleration: "prefer-hardware", latencyMode: "realtime" })`
  and `addVideoTrack(source, { frameRate: 30 })`. No audio track. Chunks go to
  `options.onWebcamChunk(data, position)`.
- `begin()` starts both outputs back to back and resolves `firstMediaTimestamp` for each
  (`waitForFirstMediaTimestamp(screenOutput, …)` and `waitForFirstMediaTimestamp(webcamOutput, …)`).
  `EngineHandle` gains `webcam: { firstMediaTimestamp: Promise<FirstMediaTimestamp>; size: { width; height } } | null`.
- `pause()` / `resume()` / `stop()` act on both sources in the same call, screen first. `stop()`
  finalizes the webcam output after the screen output and before the tracks stop.
- `release()` and `releaseAll()` stop the webcam tracks like every other input stream.
- The `ended` event of the webcam track (unplugged mid-take) ends the webcam file through
  `webcamSource.close()` and is **not** an engine error: the take goes on without a webcam
  from there.

Constants live in `src/shared/webcam-track.ts` (pure, no workspace value imports, as the
`src/shared` rule in CLAUDE.md requires): `WEBCAM_LINES_DEFAULT = 720`, `WEBCAM_FPS = 30`,
`WEBCAM_BITRATE_BPS`, and `webcamCaptureLines(settings)` that returns 720 unless framing is
enabled, in which case it reuses `cameraCaptureLines` and caps at 1080.

### 1.2 Store and writer

`recorder-store.ts` `acquireStart` creates a second writer session,
`window.electronAPI.recordingCreate(id, "webcam")`, only when `settings.isCameraEnabled`; its
chunks go to `recordingWrite(id, data, position, "webcam")`. `RecordingWriter.create(sessionId, kind: "screen" | "webcam" = "screen")`
opens `kaipu-rec-<sessionId>.webcam.mp4.part`; `write`, `stat`, `abort` and `salvage` take the
same `kind`. `finalize(sessionId, meta)` keeps its signature: it moves the screen file as today,
then moves the webcam `.part` to `.kaipu/<id>.webcam.mp4` when one exists, and writes the
sidecar's `webcam` field from `meta.webcam`. A webcam move that fails is logged and the sidecar
has no `webcam` field: the recording is valid without it (failure 5). `takeBack` undoes both.

`RecordingFinalizeMeta` gains:

```ts
webcam?: {
  startOffsetMs: number;          // webcam time 0 − screen time 0, renderer clock
  offsetQuality: "exact" | "estimated";
  width: number;
  height: number;
  fps: number;
  // The bubble as the user saw it, seeds the editor's layout (section 5).
  recordedLayout: WebcamLayout;
} | null;
```

The sidecar `<id>.json` stores it under `webcam`; `LocalRecording.webcam?: WebcamTrackMeta | null`
exposes it to the renderer. `describe()` sets `webcam` only when the file exists, so a sidecar
field without its file reads as "no webcam".

### 1.3 Hub, recovery, shutdown

- `recording-hub.ts`: nothing new to orchestrate for the bubble beyond section 3; the second
  writer session is part of the same take for `markEnded`, `recordingAbort` and the stranded
  recordings sweep (`stranded-recordings.ts`): a stranded pair is salvaged together, a lone
  webcam `.part` is deleted.
- ADR 0031: the writer's `dispose` already closes every session handle; the webcam session is
  one more entry in the same map.

## 2. Sync and the check script

Both outputs are stamped by mediabunny with the recorder renderer's `performance.now()`
(`timestampBase: "synced-zero"` per output). The two files therefore share a clock and differ
only by their first accepted sample. The store computes
`startOffsetMs = webcam.firstMediaTimestamp.rendererMs − screen.firstMediaTimestamp.rendererMs`
and `offsetQuality = "exact"` only when both are exact. A reading the live 3 s wait gave up on
is read again after the stop (NIW2-581), and is exact if the first sample arrived late. Paused
time is dropped by both sources (`MediaStreamVideoTrackSource` subtracts the gaps between the
frames it discards), each in steps of its own frames, so a pause can shift the webcam against
the screen by up to about one webcam frame (33 ms). The shifts of several pauses add up: the
bound is ±1 frame per pause, and one pause stays inside the tolerance the acceptance criteria
set. A pause before the webcam's first frame is not dropped from the webcam at all: its time 0
becomes the first frame after the resume, the offset then counts paused time the screen
dropped, and the webcam plays that much late. That window is about one frame after the take
begins.

Editor time mapping: for screen source time `t`, the webcam frame is the last one with
`webcamTs ≤ t − startOffsetMs / 1000`; before the webcam's first frame (a late start) the layer
is not drawn; after its last frame (turned off) the layer is not drawn.

`bun run webcam-track:check <recording-id>` (a sibling of `cursor-track:check`,
`scripts/webcam-track-check.ts`): prints both durations, the offset and its quality, the webcam
size and fps, and warns when `|durationScreen − durationWebcam − offset| > 500 ms`. The QA
sheet's clap test is the human check behind it.

## 3. Bubble exclusion: Plan A, Plan B and the spike (task 0)

### 3.1 What the capture path is

Verified in `recorder-engine.ts` lines 218–245: the screen is captured through
`getUserMedia` with `chromeMediaSource: "desktop"` and a `chromeMediaSourceId`, i.e. Electron's
`desktopCapturer` path, not `getDisplayMedia`. Electron carries a Chromium patch for exactly this
path: for a full-display capture under ScreenCaptureKit it collects the application's own windows
whose `sharingType` is `NSWindowSharingNone` and passes them to
`initWithDisplay:excludingWindows:` (Sources, PR #34362; the patch is still listed in
`patches/chromium/.patches`). Two limits are stated in the patch: only in-process windows, and
only windows protected **before** the stream starts. The control bar, the shade and the capture
toast already rely on it.

### 3.2 Plan A — content protection from creation (chosen)

The owner chose Plan A on 2026-10-30. Everything after task 0 is planned on it.

`CameraBubbleWindow.show()` creates the window with content protection on and keeps it on for
the window's whole life (`setContentProtection(true)` right after construction, pinned in
`floating-window-policy.test.ts`). "Always", because the bubble is usually created before the take
and the stream must not start with an unprotected bubble; outside a take protection costs
nothing. The comment at the top of `camera-bubble-window.ts` and the hub's media-pipeline page
flip from "deliberately NOT content-protected" to the opposite, with this spec as the reason.

Windows: `WDA_EXCLUDEFROMCAPTURE` removes the window from capture on Windows 10 2004 and later;
before that the window is captured as black. The existing `canExcludeWindowFromCapture(platform,
release)` rule (named `fullDisplayBorderAllowed` until NIW2-581) already encodes that threshold;
the bubble reuses it to decide "Plan A works here". Where it does not (before 10 2004) the take
keeps the legacy path: the bubble stays unprotected and burned into the screen, and no webcam
track is recorded. The renderer reads it as a capability (`recordingWebcamTrackSupported`) and
does not ask for a webcam session there. Plan B is macOS-only.

Protection also follows the take (NIW2-576 review, `bubble-protection.ts`): the bubble is
protected with no take active, or while the active take records a live webcam file. A take
whose camera was off when it started, whose camera did not open, or whose webcam file ended
(turned off, unplugged, encoder failure) leaves the bubble in the screen capture: created
unprotected, or unprotected in place. Finalize, abort and a forced reset protect it again,
before the next take's screen capture starts. Unprotecting a bubble while a stream already runs
is best effort and unverified (spike rows 4/5).

### 3.3 Plan B — native ScreenCaptureKit capture that excludes the bubble (recorded, not scheduled)

Recorded so the fallback is not rediscovered; no work is planned for it. Only if task 0 fails on
a supported macOS does it become a separate ticket, and ADR 0037 is amended then. A native module behind the engine's source seam
(`acquireScreen` in `recorder-engine.ts` becomes a provider: Chromium capture today, native
capture when the module is present) that builds the display filter with
`SCContentFilter(display:excludingWindows:)` from the bubble's native window id
(`BrowserWindow.getNativeWindowHandle()` → `CGWindowID`), the way Cap's
`crates/recording/src/sources/screen_capture/macos.rs` calls
`as_content_filter_excluding_windows(shareable_content, excluded_sc_windows)` on its display path
(Sources). Frames arrive as `VideoFrame`s into the same compositor and encoder; audio stays on
the Chromium path.

Rules it must follow, by construction:

- The repo's native-dependencies rules (CLAUDE.md "Native dependencies: no install scripts"): no
  `postinstall`, an explicit `rebuild:native` stamp like `uiohook-napi`, the module degrades to
  the Chromium path when missing or failing to load (and then the bubble is still protected: a
  captured bubble is the symptom, never a crash).
- It reopens the precedent of [ADR 0022](/architecture/decisions/0022-screenshot-capture-native-where-the-os-has-it/)
  and [ADR 0030](/architecture/decisions/0030-recording-target-and-area-crop-in-the-compositor/),
  which both rejected a native capture binding for the recorder ("two platform bindings with
  their own Electron ABI rebuilds"). ADR 0037 names this: Plan B is the escape hatch those ADRs
  kept, taken for a reason they did not foresee (window exclusion, not cropping), macOS only,
  and the Windows path stays Chromium with `WDA_EXCLUDEFROMCAPTURE`.
- Plan B gets its own ADR amendment and its own ticket when, and only when, task 0 selects it.

### 3.4 Rejected: hide the bubble during the take

Reliable exclusion for free, but the owner rejected it: the point of the bubble is to see the
framing while recording, and the screen must still be recorded correctly. Recorded in ADR 0037
as a rejected alternative so it is not proposed again.

### 3.5 Task 0 — the exclusion spike

> **Status (2026-10-30): pending owner QA on PR #440.** Plan A is implemented
> (`setContentProtection(true)` from creation, NIW2-576), but the matrix below has **not** been
> run and no row has passed. Until the owner fills the outcome table, "the bubble leaves the
> capture" is the design's intent, not a verified fact. Where Windows before 10 2004 cannot
> exclude a window, the code keeps the legacy path: the bubble stays unprotected and the take
> records no webcam track.

Run by the owner, by hand, on a dev build of a branch that only adds
`setContentProtection(true)` to `CameraBubbleWindow` (one line plus its test). Agents never run
Electron on the owner's machine (repo rule). Budget: one day including the write-up.

Setup, once per machine:

1. Open a full-screen terminal (or any app with text to the bottom edge) and put a line of text
   where the bubble will sit (bottom-left corner, 56 px in) and another under the control bar's
   place (bottom centre).
2. Turn the webcam on so the bubble shows; leave it at its default corner.

Matrix — one 5 s take each, stop, open the file in the library player and in QuickTime:

| #   | Machine        | Target                     | Bubble state                |
| --- | -------------- | -------------------------- | --------------------------- |
| 1   | owner's Mac    | display                    | on before the take          |
| 2   | owner's Mac    | area containing the bubble | on before the take          |
| 3   | owner's Mac    | window (the terminal)      | on before the take, over it |
| 4   | owner's Mac    | display                    | turned on 2 s into the take |
| 5   | owner's Mac    | display                    | moved during the take       |
| 6   | Windows (beta) | display                    | on before the take          |
| 7   | Windows (beta) | area containing the bubble | on before the take          |

What to check in each file, at the bubble's place and at the control bar's place:

- **Pass**: the text under the bubble and under the bar is readable in the video; no bubble, no
  outline, no white, black, grey or blurred patch; the frame is continuous across the bubble's
  rectangle (compare one frame against a screenshot of the same screen without the bubble).
- **Fail — captured**: the bubble (or its chrome) is in the video.
- **Fail — patch**: the bubble is gone but its rectangle shows a blank, black or stale patch.

Record each row as pass / captured / patch plus the macOS and Windows versions. Rows 4 and 5
test the patch's "protected before the stream starts" limit and the move; row 3 tests the
assumption that a window capture never includes the bubble.

Outcome → plan:

| Outcome                                                      | Plan                                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All Mac rows pass                                            | Plan A. Windows rows decide only whether the Windows beta needs the 10 2004 gate (it already exists).                                                                           |
| Rows 1–3 pass, row 4 fails (captured)                        | Plan A, with "protected from creation" as the rule (section 3.2) and a note that a bubble created mid-take may need the capture restarted; measure that cost before shipping.   |
| Any Mac row shows a **patch**                                | Plan B (section 3.3). Also confirms the terminal-line hypothesis: write the result on that backlog page and move the bar off the content line as its fix option 1 suggests.     |
| Any Mac row shows the bubble **captured** with protection on | Plan B. Also records that content protection no longer excludes in-process windows on that macOS version; the shade and the bar need the same native path or a redesign.        |
| Row 3 shows the bubble captured while rows 1–2 pass          | Plan A for display and area; window targets route the capture through the display path with a crop (what Cap does when the target is an excluded window) in a follow-up ticket. |

Close the terminal-line hypothesis either way: a pass at the bar's place disproves it (the bug
is elsewhere, reopen with a fresh repro); a patch confirms it.

## 4. Vault, library, protocol

- `LibraryVault`: `webcamFilePath(id)` → `.kaipu/<id>.webcam.mp4`; `describe()` populates
  `webcam` only when the file exists; `remove()` deletes it (best-effort, in the same
  `allSettled`); `rename` (NIW2-560) moves it with the id; `removeLocalCopy` is refused with
  reason `"webcam-track"` while it exists; `edit-project-probe.ts` adds `webcam: "present" | "missing" | "none"`
  so the editor can show the missing-file state (failure 7).
- `media-protocol.ts`: `kaipu-media://webcam/<id>` → the webcam file, Range-aware, same
  `isUnsafeId` guard. The export runner fetches it to a `Blob` like the source.
- IPC: `recordingCreate(id, kind)`, `recordingWrite(id, data, position, kind)`,
  `recordingAbort(id)` and `recordingStat(id, kind)`; the contract doc
  (`desktop/ipc-contract.mdx`) lists them.
- Cloud: the webcam file is **not** uploaded (no client exists). When plan 03 arrives it goes up
  as an auxiliary object of the asset, like thumbnails per revision, and `removeLocalCopy`'s
  refusal lifts once the cloud copy's hash matches.

## 5. Scene and session model

```ts
// scene.ts — additive, version 1 stays
export interface WebcamLayout {
  shape: "circle" | "rounded";
  /** Bubble side as a fraction of the OUTPUT frame's height, 0.1–0.6. */
  size: number;
  /** Normalized centre in the OUTPUT frame, clamped so the bubble stays inside. */
  position: { x: number; y: number };
  mirrored: boolean;
  framing: { zoom: number; x: number; y: number }; // same ranges as CameraBubbleSettings.framing
  /** 1 = same size inside a zoom; 0.7 = Cap's default. */
  scaleDuringZoom: number;
  shadow: boolean;
}
export interface WebcamSegment {
  id: string;
  /** SOURCE seconds, sorted, non-overlapping, like ZoomSegment. */
  start: number;
  end: number;
  mode: "hidden" | "override";
  layout?: Partial<WebcamLayout>; // override only
}
export interface VideoScene {
  // …existing fields…
  /** null = this recording has no webcam track (sidecar has no `webcam`). */
  webcam: { layout: WebcamLayout; segments: WebcamSegment[] } | null;
}
```

- `initialScene` seeds `webcam` from `LocalRecording.webcam.recordedLayout`, converting the
  bubble's DIP size and corner into fractions of the recorded output
  (`RecordingFinalizeMeta.capture` already carries the output size). A recording without
  `webcam` seeds `null`.
- `session.ts`: `webcam` parses like `zoomSegments` — absent → `null`; wrong type → session
  rejected; numbers clamped; overlapping segments dropped; a segment under `ZOOM_LIMITS.minSeconds`
  rejected. The loader overrides a saved `webcam` with `null` when the sidecar has none
  (failure 7). Older builds ignore the key (the header comment's promise holds).
- `use-video-scene.ts`: `setWebcamLayout`, `addWebcamSegment`, `updateWebcamSegment`,
  `removeWebcamSegment`, all through the same history so undo works; `editFingerprint` includes
  `webcam`.
- Cuts: segments are source-anchored, so a cut never moves them; a segment entirely in deleted
  footage is kept (like a muted range) and costs nothing.

Pure math in `src/renderer/src/features/video-editor/webcam/webcam-layout.ts` (DOM-free, worker-safe,
like `compose-frame.ts`): `webcamAt(webcam, cameraState, t)` → the rectangle to draw in output
pixels (or null), applying segments, `scaleDuringZoom` against `cameraState.scale`, and the
clamp inside the frame; `webcamSourceRect(layout, frameW, frameH)` for the framing crop;
`webcamClipPath(shape, rect)`.

## 6. Preview

`PreviewStage` gains a `webcamLayer` slot rendered after `.content` and before `chrome` — a
sibling, never inside the transformed content (plan 09's contract: content is transformed by the
camera path, chrome is not; the webcam is a third kind, untransformed and above content).

`WebcamLayer` (`components/webcam-layer.tsx`): a `<video src="kaipu-media://webcam/<id>" muted playsInline>`
positioned by `webcamAt` from the frame clock, with `clip-path` for the shape, `transform` for
mirror and framing, and a drop shadow when `shadow`. Sync with the main video:

- On seek: `webcam.currentTime = t − offset` (clamped to the webcam's duration).
- On play/pause: mirror the main element.
- Each `requestVideoFrameCallback` of the main video (`useVideoFrameClock`): if
  `|webcam.currentTime − (t − offset)| > 0.08`, re-seek. The rule is a pure function with a test.
- While the playhead is before the webcam's first frame or after its last, the element is hidden.
- The zoom-edit view (a zoom selected) still draws the layer at its viewport position so the
  user sees what the zoom will not cover. "Hold to see original" hides it (open question 2).

Interaction: pointer drag on the layer updates `layout.position` (or the active override's);
the four corners resize with the aspect locked; the inspector shows Shape, Size, nine position
presets, Mirror, Framing (reusing the camera settings' pad and slider), Shrink during zoom and
Shadow. A **Webcam** lane on the timeline shows the segments as blocks (hidden = striped), with
the Zoom lane's drag and edge handles reused; "Hide webcam here" is a toolbar action over the
selected range or from the playhead to the next segment. Selecting a block switches the
inspector to the override's fields.

A recording with `webcam: null` shows neither lane nor inspector section: the editor looks
exactly as today.

## 7. Export: MP4, GIF, Share

- `export-plan.ts`: `ExportPlan.webcam = scene.webcam` (not filtered by visibility, like the
  camera path: segments are source-anchored and cheap).
- `export-messages.ts`: `ExportStartMessage.webcam: { blob: Blob; startOffsetMs: number; width; height } | null`;
  `GifStartMessage` the same.
- `export-runner.ts` / `use-gif-export.ts`: fetch `kaipu-media://webcam/<id>` when
  `plan.webcam` is set.
- `export-worker.ts` / `gif-worker.ts`: open a second `Input` on the webcam blob, one
  `CanvasSink(webcamTrack, { width, height })` iterator per clip segment over
  `[sourceStart − offset, sourceEnd − offset]`, advanced in lockstep with the screen frames:
  hold the last webcam canvas whose `timestamp + offset ≤ sourceTs` (failure 8). Slides draw no
  webcam.
- `compose-output-frame.ts`: `createOutputComposer` takes `webcam: { layout, segments, frameAt(sourceTs) }`
  and draws it **after** the clip's crop and, for fixed-canvas presets, after `framer.frame()`,
  onto the output canvas: `save → clip(webcamClipPath) → (mirror: scale(−1,1)) → drawImage(webcamCanvas, sourceRect…, rect) → restore`,
  with the shadow drawn first. Direct frames (no zoom, no region) draw it too — the webcam is
  always a composite step, so the "direct" path becomes "direct + webcam" when a webcam exists.
- Poster: the first composed frame already includes the layer.
- Share (`WHOLE_RECORDING_FINGERPRINT`): `export-reuse.ts` computes `whole:<hash(recordedLayout)>`
  for a recording with a webcam and plain `whole` otherwise; the Share path builds a plan from
  `initialScene` (which carries the seeded layout) instead of a bare clip.
- Size: the webcam is decoded at ≤ 720p and drawn once per output frame; the measured cost goes
  on the export status card's estimate only if it moves the number by more than 5 %.

## 8. Back-compat and the cloud dependency

- Recordings made before this feature: no `webcam` on the sidecar, `scene.webcam = null`,
  identical behaviour; their bubble is in the pixels and stays there.
- Sessions: additive key; a session from before opens with `webcam` seeded from the sidecar.
- Older builds: ignore `webcam`; play the screen file; a Share from there has no face
  (changelog note).
- Settings: `AppSettings.cameraBubble` stays the record-time defaults and the bubble's preview
  settings; nothing new is persisted.
- Cloud: no upload of the webcam file; `removeLocalCopy` refused while it exists; plan 03 lifts
  it. The cloud catalog does not need to know about the file until then.
- Recovery: the stranded-recordings sweep salvages pairs; the salvage dialog's "save elsewhere"
  writes both files next to each other.

## 9. Size estimate

| Area            | Changes                                                                                                                                                                    | Effort           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Task 0 spike    | `setContentProtection(true)` on the bubble + test; the owner's matrix; write-up on both backlog pages                                                                      | 1 day + owner QA |
| Recorder        | `recorder-engine.ts` (webcam stream, second output, offsets, pause/stop order), `recorder-store.ts` (second session), `recording-writer.ts` (kind, finalize, salvage), hub | 3–5 days         |
| Bubble          | Protection from creation, raise order, preview constraints decoupled from the recording's, Windows gate                                                                    | 1–2 days         |
| Vault / library | Sidecar `webcam`, `LocalRecording.webcam`, protocol route, remove/rename/removeLocalCopy, probe, IPC contract doc                                                          | 1–2 days         |
| Editor model    | `scene.ts`, `session.ts`, `use-video-scene.ts`, seeding, `webcam-layout.ts`, `src/shared/webcam-track.ts`                                                                  | 2–3 days         |
| Preview + UI    | `WebcamLayer`, sync rule, drag/resize, inspector section, Webcam lane, toolbar action                                                                                      | 4–6 days         |
| Export          | Plan, messages, runner, both workers, composer, framer placement, Share fingerprint                                                                                        | 3–5 days         |
| Docs            | This spec's status, ADR statuses, hub media-pipeline page, QA sheet, changelog                                                                                             | 1–2 days         |
| **Total**       |                                                                                                                                                                            | **16–25 days**   |

Plan B adds a native module (macOS only): 5–8 days plus the rebuild/stamp plumbing, and its own
ticket.

Riskiest, in order: (1) the exclusion on the owner's macOS — task 0 answers it before anything
else is built; (2) the start offset depends on a private mediabunny field with an `estimated`
fallback — the check script and the clap test keep it honest; (3) two `<video>` elements in the
preview — the drift rule is simple, but a stuttering webcam preview would read as a broken
feature, so the lockstep decoder is the fallback for the preview too.

## 10. Tasks (one child ticket each, in order)

Each PR ends with a "How to test it yourself" section; the manual steps below are its seed.

0. **Exclusion spike** (section 3.5). Test yourself: the matrix; fill the outcome table in this
   spec and on the terminal-line page; name the plan in NIW2-565.
1. **Recorder writes the webcam file** (sections 1–2, `webcam-track:check`). Test yourself: a
   take with the webcam on; `ls .kaipu/` shows `<id>.webcam.mp4`; the check script prints an
   `exact` offset; QuickTime plays both; the clap test; pause mid-take and repeat the clap.
2. **Vault, protocol and library** (section 4). Test yourself: delete removes both; rename keeps
   them; "Remove local copy" is refused with the reason; `kaipu-media://webcam/<id>` plays in the
   dev tools.
3. **Scene, session and seeding** (section 5). Test yourself: open a new recording, save, read
   `.edit.json` and see `webcam` with the recorded layout; open an old recording and see no key.
4. **Preview layer, inspector and lane** (section 6). Test yourself: the face shows in its
   corner over a zoom; drag it; hide a range; hold original hides it; scrub and the face never
   lags behind the clap.
5. **Export MP4 and GIF** (section 7 minus Share). Test yourself: export with a zoom; the face is
   in the output in its corner; Vertical Fill and Square Fit keep it whole; GIF matches the MP4.
6. **Share composes the webcam** (section 7 Share). Test yourself: Share from the library; the
   file has the bubble; Share again reuses it ("already exported"); edit and Share does not.
7. **Docs and statuses**: this spec to 🟢, ADR 0037/0038 statuses, hub page, backlog row.

## 11. Sources

Repo (verified while designing, 2026-10-29): `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts`,
`src/main/recording/camera-bubble-window.ts`, `src/main/recording/control-bar-window.ts`,
`src/main/recording/area-geometry.ts` (`canExcludeWindowFromCapture`, then `fullDisplayBorderAllowed`),
`src/renderer/src/features/recording/first-media-timestamp.ts`, `src/main/recording/cursor-clock.ts`,
`src/renderer/src/features/video-editor/{scene,session}.ts`,
`src/renderer/src/features/video-editor/export/{export-plan,export-messages,export-worker,gif-worker,compose-frame,compose-output-frame,export-reuse}.ts`,
`src/renderer/src/features/video-editor/components/preview-stage.tsx`,
`src/main/library/library-vault.ts`, `src/main/media-protocol.ts`.

Products and code:

- Cap — [crates/recording/src/sources/screen_capture/macos.rs](https://raw.githubusercontent.com/CapSoftware/Cap/main/crates/recording/src/sources/screen_capture/macos.rs)
  (`as_content_filter_excluding_windows`, excluded `WindowId`s resolved against `ShareableContent`;
  display path only; an excluded window chosen as target falls back to a display crop with
  exclusions), [PR #1179 "Implement new Window excluder system"](https://github.com/CapSoftware/Cap/pull/1179)
  (`.content_protected(...)` on Cap's own windows, "Cap Camera" in the default exclusion list;
  on Windows only app-owned windows can be excluded),
  [crates/project/src/meta.rs](https://raw.githubusercontent.com/CapSoftware/Cap/main/crates/project/src/meta.rs)
  (`VideoMeta.start_time`, per-track files), [crates/recording/src/recovery.rs](https://raw.githubusercontent.com/CapSoftware/Cap/main/crates/recording/src/recovery.rs)
  (`display.mp4`, `camera.mp4`, `start-times.json`), [crates/timestamp/src/lib.rs](https://raw.githubusercontent.com/CapSoftware/Cap/main/crates/timestamp/src/lib.rs),
  [crates/project/src/configuration.rs](https://raw.githubusercontent.com/CapSoftware/Cap/main/crates/project/src/configuration.rs)
  (`Camera { hide, mirror, position, size, scale_during_zoom, rounding, shadow, shape }`),
  [crates/recording/src/feeds/camera.rs](https://raw.githubusercontent.com/CapSoftware/Cap/main/crates/recording/src/feeds/camera.rs)
  (1280×720 @ 30 fps).
- Screen Studio — [Camera](https://screen.studio/guide/camera), [Dynamic camera layouts](https://screen.studio/guide/dynamic-camera-layouts-),
  [Extracting raw recording files](https://screen.studio/guide/extracting-raw-recording-files).
- Tella — [Use layouts](https://www.tella.com/help/editing/use-layouts.md), [Shrink camera during zooms](https://www.tella.com/docs/help/editing/shrink-camera-during-zooms.md).
- Loom — [Make your camera bubble visible](https://support.atlassian.com/loom/docs/make-your-camera-bubble-visible-in-loom-recordings/) (burned-in, inferred).
- OBS — [Hybrid MP4](https://obsproject.com/blog/obs-studio-hybrid-mp4) (multi-track MP4 exists, for testing).
- Camtasia — [Record and edit webcam](https://www.techsmith.com/learn/tutorials/camtasia/record-edit-webcam/).

Platform:

- Electron `BrowserWindow.setContentProtection` — [docs](https://www.electronjs.org/docs/latest/api/browser-window)
  (`NSWindowSharingNone`; `WDA_EXCLUDEFROMCAPTURE` on Windows 10 2004+, black before; the
  ScreenCaptureKit caveat is about other apps capturing Electron windows).
- Electron's Chromium patch for its own `desktopCapturer`: [PR #34362 commit](https://ayakael.net/mirrors/electron/commit/fd88908457a986f06e310e80499e4b2775d8ba70)
  (in-process `NSWindowSharingNone` windows → `initWithDisplay:excludingWindows:`; protected
  before the stream starts); [electron/electron#48258](https://github.com/electron/electron/issues/48258)
  (third-party capture, closed "not planned").
- Apple — [`SCContentFilter.init(display:excludingWindows:)`](<https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(display:excludingwindows:)>).
- Electron on macOS 14.4+: [PR #41397 commit](https://ayakael.net/mirrors/electron/commit/ddd93529d59002288699c5fc16be4843265e7f89)
  (`ScreenCaptureKitPickerScreen`, `ScreenCaptureKitStreamPickerSonoma`).
- Sync — W3C webrtc list: [separate MediaRecorders cannot be aligned exactly](https://lists.w3.org/Archives/Public/public-webrtc-logs/2021Dec/0029.html);
  mediabunny [media sources](https://mediabunny.dev/guide/media-sources) (tracks in one output
  start at a shared zero), [writing media files](https://mediabunny.dev/guide/writing-media-files),
  [output formats](https://mediabunny.dev/guide/output-formats) (`getSupportedTrackCounts`).

Not verified: how QuickTime and Chromium treat an MP4 with two video tracks today; whether the
Electron patch holds on macOS 15 and later (task 0 answers for the owner's machine); whether two
renderers can share one camera device in Electron (task 0, open question 10).
