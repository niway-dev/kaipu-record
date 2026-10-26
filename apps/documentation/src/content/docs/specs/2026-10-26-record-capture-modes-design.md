---
title: Record capture modes — record a display or a selected area through the capture overlay
description: Design for choosing what a recording covers the way screenshots already do — one display picked visually, or a rectangle drawn and adjusted on the shared capture overlay — with the crop done in the existing recording compositor, a dark shade outside the recorded area while the take runs, the cursor sidecar normalized to the recorded rectangle, and a redesigned menu-bar widget and Record page that show the selection next to the camera, audio and microphone controls.
---

# Record capture modes — design

**Status: 🔵 Proposed · 2026-10-26.** Linear: [NIW2-513](https://linear.app/niway/issue/NIW2-513/record-capture-modes-record-a-display-or-a-selected-area-through-the)
(parent; one child per task in section 8 once this design is approved). Builds on the
[screenshot capture modes design](/specs/2026-10-15-screenshot-capture-modes-design/) and
[screenshot modes v2](/specs/2026-10-17-screenshot-modes-v2-design/), whose decision 12 reserved
the Record seat this design fills. ADRs: [0030](/architecture/decisions/0030-recording-target-and-area-crop-in-the-compositor/)
(new) alongside [0022](/architecture/decisions/0022-screenshot-capture-native-where-the-os-has-it/),
[0024](/architecture/decisions/0024-window-mode-and-quiet-capture/) and
[0029](/architecture/decisions/0029-floating-windows-never-change-the-activation-policy/), which
stand, except that 0030 amends 0024's non-goal "recording through the overlay". Design file: Claude Design project "kaipu-recorder", new file "Kaipu Record Modes" to
be produced from the brief in section 7. Window mode in the overlay stays behind its flag
([NIW2-469](https://linear.app/niway/issue/NIW2-469/window-screenshot-mode-fix-what-the-owner-found-buggy-and-re-enable));
the Window target keeps the thumbnail picker.

## Summary (one minute)

Today a recording covers a whole screen or a window chosen from the thumbnail source picker, and
the engine captures that source at native resolution through `getUserMedia` with a
`chromeMediaSourceId`. Screenshots already let the user pick **Frame** or **Screen** inside a
shared overlay (one translucent window per display) and that overlay carries a disabled Record
button put there for this feature. This design makes a recording **target** a first-class value:
a **display**, an **area** (a display-relative rectangle in DIP) or a **window**. The user picks
a display or an area on the same overlay, opened with a `record` intent from the menu-bar widget,
the Record page or a shortcut; the action bar carries both Capture and Record in every intent, so
a selection made for a screenshot can be recorded and a selection made for a recording can be
shot. Pixels still come from a full-display capture: an area is **cropped in the recording
compositor** — the canvas pass the engine already runs to downscale and watermark — with the crop
rectangle computed by the tested DPI geometry the screenshot backend uses on Windows. No native
module is added, so macOS and Windows share one path. While an area records, a click-through,
content-protected **shade** window covers the recorded display: clear inside the rectangle, dark
outside, never in the video. The cursor sidecar is normalized to the recorded rectangle so
auto-zoom keeps pointing at the right place, the camera bubble is anchored inside the rectangle so
it stays in the shot, and the control bar stays where it is. The widget and the Record page get a
new layout: a mode row (Screen · Area · Window), a card for the current selection that can be
changed at any time before the take, and the camera, system-audio and microphone controls beside
it.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                                                                                                                                                          | ADR         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | A recording has a **target**: `{ kind: "display", displayId }`, `{ kind: "area", displayId, rect }` or `{ kind: "window", sourceId }`. It travels in `RecordingStartInfo` and `RecordingSettings`; the current mode (`screen`, `area`, `window`) is a persisted setting like `screenshotMode`.                                                                                                           | `sourceId` alone cannot say "this rectangle". One typed value lets main, the engine, the cursor tracker and the bubble agree on what is recorded.                                                                                                                                                                                                                            | 0030 (new)  |
| 2   | **The picker is the capture overlay, opened with an intent** (`capture` today, `record` new). The action bar carries Capture and Record in both intents; the intent decides which one Enter fires and which is drawn primary. In `record` intent Enter is **Use selection** (back to the widget with the target set), **Record** starts the countdown at once, and the pill hides Window while disabled. | ADR 0024 decision 5: one "this display or this selection" picker. The owner wants to switch between shooting and recording without leaving the overlay. Setting the target without recording lets the user adjust camera and audio first.                                                                                                                                    | reuses 0024 |
| 3   | **An area is cropped in the recording compositor from a full-display capture.** The source rectangle is `cropForDisplay(trackSize, display, rect)`; the output size is `fitToCap(cropWidth, cropHeight, capHeight)` with even dimensions. With an area target the compositor always runs.                                                                                                                | Chromium's Region Capture crops tab captures only, never screen or window. A native crop (ScreenCaptureKit, Windows.Graphics.Capture) would be two platform modules for a `drawImage` source rectangle. The compositor already runs on every MacBook because native size never matches the cap. The owner's condition is one implementation that works on macOS and Windows. | 0030 (new)  |
| 4   | **A recording shade** covers the recorded display while an area records: clear inside the rectangle with a 1.5 px border, dark outside, click-through (`setIgnoreMouseEvents(true)`), content-protected, a `panel` with the ADR 0029 flag on macOS. It is shown after the countdown and hidden at stop; pause keeps it. Other displays are untouched.                                                    | The owner: "what is inside is visible, outside is a black overlay". The user must know where the pixels end; the shade must never be in the video (content protection) and never block the apps being recorded (click-through).                                                                                                                                              | reuses 0029 |
| 5   | **The cursor sidecar is normalized to the recorded rectangle.** `CursorTrack.display` keeps the rectangle's DIP size and the display's scale factor; a new optional `region: { displayId, x, y }` records where on the display it was. The editor does not change.                                                                                                                                       | The zoom detector measures pointer pauses against `track.display`'s diagonal and the camera path moves in that space; a track normalized to the whole display would zoom at the wrong place in an area recording.                                                                                                                                                            | 0030 (new)  |
| 6   | **The camera bubble is anchored inside the recorded rectangle** (bottom-left corner with the same margin as today). When the rectangle cannot hold the bubble (224 px plus margins), the bubble is not shown and the widget's camera toggle says why.                                                                                                                                                    | The bubble is recorded as part of the screen (no content protection). Outside the rectangle it would be lost silently.                                                                                                                                                                                                                                                       | —           |
| 7   | **The control bar does not move**: bottom centre of the recorded display, content-protected as today, even when it overlaps the rectangle.                                                                                                                                                                                                                                                               | It is excluded from the video already; moving it per area adds a positioning rule with no benefit.                                                                                                                                                                                                                                                                           | —           |
| 8   | **Entry points.** The widget's Record tab and the Record page render a mode row (Screen · Area · Window) and a selection card. Screen with one display sets the target at once, with several it opens the overlay chooser. Area opens the overlay in Frame with the remembered rectangle for that display. Window opens the thumbnail picker as today. "Change" on the card reopens the same path.       | Mirrors the screenshot chips the owner already uses; keeps Window on the path that works until NIW2-469.                                                                                                                                                                                                                                                                     | —           |
| 9   | **Shortcuts.** `recordArea` is new (`Command+Control+Shift+R`, `Control+Alt+Shift+R`): opens the overlay in `record` intent, Frame mode. `startRecording` records the current target; with an area target and no remembered rectangle for the current display it opens the overlay first.                                                                                                                | One key per mode is the pattern of `captureFrame` and `captureScreen`.                                                                                                                                                                                                                                                                                                       | —           |
| 10  | **Area memory is per display and separate from the screenshot Frame memory.**                                                                                                                                                                                                                                                                                                                            | A recording area is usually a 16:9 stage; a screenshot frame is whatever was interesting. Sharing one memory would make each feature undo the other's last choice.                                                                                                                                                                                                           | —           |
| 11  | **Full-screen and Window recordings are unchanged in the engine**: a `display` target resolves to the `screen:<id>` source and encodes as today; a `window` target keeps `sourceId`.                                                                                                                                                                                                                     | The feature adds a path; it must not touch the two that ship.                                                                                                                                                                                                                                                                                                                | —           |
| 12  | **Analytics.** The recording-start event gains `mode: "screen" \| "area" \| "window"` and, for an area, its output size bucket. No rectangles, no titles.                                                                                                                                                                                                                                                | The owner wants to know whether Area is used before investing in presets or exact dimensions.                                                                                                                                                                                                                                                                                | —           |
| 13  | A `record` action during a running recording is refused with the system notification from #374, never a second take.                                                                                                                                                                                                                                                                                     | Same rule as a screenshot during a recording.                                                                                                                                                                                                                                                                                                                                | —           |

### Open questions

1. **Compositor cost for an area in the hidden main window.** The compositor draws on
   `requestAnimationFrame` in a window that is hidden while recording; it works today for
   downscale and watermark, so the assumption is that it keeps the frame rate for a crop. Not
   measured. Task 3 measures dropped frames for a 1280×720 area on the Mac mini and on the
   first Windows build; if the hidden window throttles, the draw loop moves to a timer or an
   `OffscreenCanvas` in a worker, inside decision 3.
2. **Shade and full-screen apps.** The shade is a `panel` with the ADR 0029 recipe, so it floats
   over a full-screen Space without touching the Dock; whether a click-through panel still lets
   the full-screen app receive every gesture (scroll, drag) is QA, not design.
3. **"Use selection" versus "Record" as Enter in `record` intent.** This design makes Enter set
   the target and return to the widget, because the owner wants to adjust camera and audio
   after choosing the area. If the common path turns out to be "choose and record", swap the
   two: one constant.
4. **Recording from a screenshot overlay** uses the widget's current camera, audio and
   microphone settings. Confirm that is expected, or the overlay would need its own toggles.
5. **The analytics event name.** No recording-start event exists in `shared/analytics.ts`
   today; task 6 adds `recording_started` with the closed payload of decision 12, or extends the
   event if one is added before then.
6. **The owner wrote "windows e iOS".** This design reads it as macOS and Windows: the desktop
   app has no iOS target.

### Out of scope

- Changing the area while a recording runs (the output dimensions are fixed at start).
- Exact dimensions, aspect-ratio locks and size presets in the Frame box (Screen Studio and
  CleanShot offer them; v1 draws a free rectangle with a minimum size and even dimensions).
- Window mode inside the overlay for recording (follows NIW2-469), a window-following area, and
  Linux.
- Compositing the camera into the canvas instead of recording the bubble from the screen (the
  [camera box UX](/backlog/video-editor-camera-box-ux/) owns that direction).
- Any change to the editor's tools, the vault layout, export or the cloud.

### Failures this must protect against

Input for tests; each line is at least one test.

1. A 2× or 150 % display records the wrong pixels for an area → `cropForDisplay` with the
   measured track size, mixed-DPI fixtures reused from the screenshot geometry tests.
2. An odd-sized area makes the encoder reject the track → `fitToCap` rounds to even; a 1×1 area
   is clamped to the minimum (64×64 DIP) before the overlay answers.
3. The shade appears in the video → window options pinned like `floating-window-policy.test.ts`
   (`setContentProtection(true)`, `type: "panel"`, `skipTransformProcessType: true`).
4. The shade swallows clicks meant for the recorded app → `setIgnoreMouseEvents(true)` pinned.
5. The cursor track is normalized to the display instead of the area → builder test: a pointer at
   the area's centre serializes as (0.5, 0.5); a pointer outside the area serializes outside
   [0, 1].
6. The camera bubble lands outside the area → position test for a rectangle in each corner of a
   display; a rectangle smaller than the bubble yields "not shown" and the toggle notice.
7. The display disappears between picking and starting (unplugged) → start fails with the
   existing start-error path and the target is cleared, never a recording of another display.
8. A `display` or `window` target changes the encoded output of today's recordings → golden test
   on the engine options: same `sourceId`, no compositor when no watermark and no resize.
9. A remembered area that no longer fits (display changed resolution) → `clampFrameToDisplay`
   shrinks it instead of dropping it.
10. The screenshot Frame memory and the recording area memory overwrite each other → two
    settings keys, one test each.
11. `recordArea` or a Record click while recording → refused with the #374 notification; the
    running take is untouched.
12. The overlay answers `record` and the widget is closed or the main window is gone → the
    hub recreates the main window (the engine lives there) before starting, as the tray start
    does today.

## 1. Model and contract

### Target and mode

Preload-reachable: literals and types only, next to `screenshot-capture.ts`.

```ts
export const RECORDING_MODES = ["screen", "area", "window"] as const;
export type RecordingMode = (typeof RECORDING_MODES)[number];

export type RecordingTarget =
  | { kind: "display"; displayId: number }
  | { kind: "area"; displayId: number; rect: CaptureRect /* DIP, display-relative */ }
  | { kind: "window"; sourceId: string };
```

The shape is ADR 0030's. The label the control bar shows is not part of the target: it stays the
source name main resolves, as `selectedSource.name` is today.

`AppSettings.recordingMode: RecordingMode` (default `"screen"`) and
`AppSettings.recordingAreaByDisplay: Record<string, CaptureRect>` (decision 10) join
`screenshotMode`. `RecordingSettings.selectedSource` becomes `target: RecordingTarget | null`;
`RecordingStartInfo` becomes `{ target: RecordingTarget }`. Main resolves a `display` target to
the `screen:<id>` source with the inverse of `displayIdForSource`, which already lists
`desktopCapturer` sources and reads `display_id`; the engine keeps receiving a `sourceId` and,
for an area, a `crop` rectangle in physical pixels of the captured track plus the output size.

### Engine options

```ts
interface EngineOptions {
  sourceId: string;
  /** Area targets only: display-relative DIP rectangle and the display it is on. */
  area?: { rect: CaptureRect; display: DisplayLike };
  // …microphone, system audio, quality, watermark as today
}
```

After `getUserMedia`, the engine reads the track's measured size as today, and for an area
computes `source = cropForDisplay({ width, height }, display, rect)` and
`target = fitToCap(source.width, source.height, capHeight)`. The compositor gains a `source`
rectangle: `drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)` where the destination is the
letterboxed fit it already computes. With `area` set, the compositor runs even when no resize and
no watermark are needed.

## 2. The overlay with an intent

- Query gains `&intent=capture|record` (default `capture`), built by `overlayQuery`. The
  provider's `pick(ui, displays)` gains `intent` in its options; `CaptureOverlayWindows` forwards it.
- `CaptureAction` becomes `"capture" | "copy" | "record" | "select"`. `OverlayAnswer` carries it
  as today; the overlay never captures or records (ADR 0022 decision 3).
- Action bar by intent:
  - `capture`: **Capture** (Enter, primary) · Copy (⌘C / Ctrl+C) · Record (⌘R / Ctrl+R) · Cancel (Esc).
  - `record`: **Use selection** (Enter, primary) · Record (⌘R / Ctrl+R) · Capture (⌘⇧C / Ctrl+Shift+C) · Cancel (Esc).
- The Screen card gets the same bar in place of its "Record this display · soon" label.
- The pill lists `ENABLED_CAPTURE_MODES` as today; in `record` intent the Frame box starts from
  the recording area memory, not the screenshot one (decision 10).
- A new main-side **record request handler** (sibling of `capture-handler.ts`) runs the pick
  with the capture window hooks (every window of ours leaves before the overlay opens), then:
  - `select` → stores the target in `RecordingSettings`, restores the windows, shows the widget
    or the Record page where the user came from;
  - `record` → stores the target and asks the hub to start (countdown as today);
  - `capture` / `copy` from a `record` intent → hands the answer to the capture handler, which
    continues exactly as a screenshot;
  - `cancelled` → restores the windows.

## 3. Main: hub, shade, bubble

- `recording-hub.ts` receives `RecordingStartInfo { target }`, resolves the source id for a
  display or area target, and hands the engine options to the renderer. The cursor tracker
  receives the rectangle (section 5). It refuses a start while a take runs (decision 13).
- `recording-shade-window.ts` (new, next to `control-bar-window.ts`): one `BrowserWindow` on the
  recorded display with `display.bounds`, `frame: false`, `transparent: true`, `focusable: false`,
  `skipTaskbar: true`, `hasShadow: false`, `setIgnoreMouseEvents(true)`,
  `setContentProtection(true)`, `setAlwaysOnTop(true, "screen-saver")`; on macOS `type: "panel"`
  and `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })`.
  Renderer route `?window=recording-shade&bounds=…&rect=…` paints the sheet with the same
  "clear box, huge spread shadow" technique as the Frame box, at the dim level the design
  brief fixes. Shown when the countdown ends, hidden on stop or abort; `floating-window-policy.test.ts`
  pins its options.
- `camera-bubble-window.ts` takes the recorded rectangle (global DIP) and positions inside it
  (decision 6); without a rectangle it positions as today. The "cannot fit" state is reported to
  the widget through the existing recording activity relay.

## 4. Renderer: engine and compositor

Section 1 covers the options. Two more points:

- Failure detection keeps watching the raw screen track (the canvas track never ends).
- `recordingCompositor.stop()` releases the canvas as today; nothing new leaks.

## 5. Cursor sidecar

`cursor-tracker.ts` samples global pointer positions and normalizes against `CapturedDisplay`.
It gains an optional `region` (display-relative DIP): normalization uses the region's origin and
size when present, the display otherwise. `CursorTrack.display` holds `{ id, width, height,
scaleFactor }` of the recorded rectangle (the editor reads width and height as the frame's DIP
size) and `CursorTrack.region?: { displayId: string; x: number; y: number }` is added for
diagnostics. `CURSOR_TRACK_VERSION` stays 1: the new field is optional and every consumer
ignores unknown fields.

## 6. Widget and Record page

Both render the same model (`useRecordingSetup`):

- **Mode row** (Screen · Area · Window), the `CaptureModeButtons` pattern. A click changes the
  mode and opens the path of decision 8; it never starts a recording.
- **Selection card**: icon, name and size ("Area · 1280 × 720 · Display 1", "Display 2 · 2560 ×
  1440", "Safari — Kaipu"), a Change button, and a thumbnail when the source is a window (today's
  picker already has it) or nothing for a display or an area in v1.
- **Controls**: microphone (toggle + device), system audio, camera, as today. Before the take
  everything is editable; during the take the selection and the microphone device are locked and
  the three toggles stay live, as the panel already does.
- **Record button** with the `startRecording` shortcut hint; while recording, Stop and the
  elapsed banner.

The widget keeps its 340 px width and the Record / Capture tabs. The design brief below produces
the layout; the logic above is independent of it.

## 7. Design brief (Claude Design)

Paste into the Claude Design project "kaipu-recorder" (https://claude.ai/design/p/71546ef1-baf5-42e9-8fcc-9b9b44f2c7ab)
as a new file "Kaipu Record Modes". It is written for the designer, not for the implementer.

```text
Design the recording controls of Kaipu, a macOS and Windows screen recorder and screenshot tool,
for a new capability: before recording, the user chooses WHAT to record — a whole display, a
rectangular area drawn on the screen, or a window — and can change that choice at any time, the
way the app's screenshot modes already work. Camera, system audio and microphone are set beside
the selection. Keep the existing visual language (tokens, radii, type scale and the pink accent
of the capture overlay from "Kaipu Screenshot Modes v2"); do not invent a new style.

Surfaces to design, each with its states:

1. Menu-bar widget, Record tab (fixed width 340 px, variable height, dark and light).
   Content: header; segmented Record / Capture tabs; a MODE ROW with three equal chips —
   Screen, Area, Window — the current one selected; a SELECTION CARD under it that names what
   will be recorded ("Area · 1280 × 720 · Display 1", "Display 2 · 2560 × 1440", "Safari —
   Kaipu" with a thumbnail for windows only) with a Change action; CONTROLS: microphone toggle
   with device picker, system audio toggle, camera toggle; a RECORD button with the shortcut
   hint. States: idle with each mode selected; no selection yet ("Choose an area" placeholder);
   area too small for the camera bubble (camera toggle disabled with a one-line reason);
   recording (elapsed banner, selection and mic device locked and dimmed, the three toggles
   live, Stop button); paused.

2. Record page in the main window (desktop width ≥ 960 px). The same model as the widget, as a
   hero: mode row as three cards with an icon and a one-line description, the selection card,
   the controls, the Record button. Reuse the hierarchy of the Screenshots page's mode cards.

3. Capture overlay in RECORD intent (full-display translucent sheet, one per display). The
   Frame box with eight handles, size label and the vertical mode pill (Frame, Screen) on its
   right edge as in v2. The ACTION BAR under the box changes: primary "Use selection" (Enter),
   then "Record" (⌘R), then "Capture" (⌘⇧C), then Cancel (Esc). Also the Screen card variant
   with the same bar. Show the CAPTURE intent bar beside it for contrast: primary Capture
   (Enter), Copy (⌘C), Record (⌘R), Cancel — the Record button is enabled now, not "soon".

4. Recording shade: the recorded display while an area is being recorded. The area is fully
   clear with a 1.5 px border; everything outside is covered by a dark translucent shade (pick
   the opacity; it must leave the desktop recognisable, roughly 55–70 %). No controls on the
   shade. Show the floating control bar at the bottom centre of the display and the camera
   bubble anchored inside the area's bottom-left corner. One frame with the area small
   (640 × 360) and one large (most of the display).

5. Tray menu: the Record entry becomes a submenu — Record screen, Record area, Record window —
   plus Stop while recording. Text only.

Deliverables: one artboard per surface and state above, light and dark for 1 and 2, a short
note on each design decision (why the mode row sits above the card, why Enter is Use selection
in record intent), and the measurements the implementer needs (chip height, card padding, bar
button sizes, shade opacity, border width).

Do not design: the editor, exports, the Library, settings pages, or a window picker inside the
overlay (Window keeps the existing thumbnail picker).
```

## 8. Tasks (one child ticket each, in order)

1. **Contract and settings.** `RecordingTarget`, `RecordingMode`, settings keys, `RecordingStartInfo`
   and `RecordingSettings` migration (`selectedSource` → `target`), source resolution for a display
   target, `ipc-contract.mdx` update. Tests: migration, resolution, failures 8 and 10.
2. **Overlay intent and actions.** `intent` in the query and the port, the two action bars, the
   `record` and `select` answers, the record request handler, refusal during a take. Tests:
   failures 11 and 12, overlay keys per intent.
3. **Engine crop.** `area` in the engine options, compositor source rectangle, output size, the
   frame-rate measurement of open question 1. Tests: failures 1, 2 and 8.
4. **Shade, bubble and cursor.** Shade window and route, bubble anchoring, cursor normalization and
   the `region` field. Tests: failures 3 to 7 and 9.
5. **Widget and Record page.** Mode row, selection card, controls, from the approved design; tray
   submenu; shortcuts (`recordArea`). Tests: panel and page rendering per state, shortcut defaults
   pinned against `@kaipu/domain`.
6. **Analytics and docs.** `recording_started` with `mode`; the recording pipeline doc and the
   backlog page flipped to 🟢.

Tasks 1–4 are independent of the design file; task 5 waits for it.

## 9. Platform notes

- **macOS.** `getUserMedia` on a `screen:` source already needs Screen Recording permission; no
  new prompt. The shade is a non-activating panel (ADR 0029).
- **Windows.** `desktopCapturer` frames arrive at physical size; `cropForDisplay` derives the scale
  from the measured track, so a 125 % or 150 % display is covered by the fixtures the screenshot
  backend already has. `type: "panel"` stays behind the platform check. Real-hardware QA needs the
  Windows build.
- **Both.** The output of an area recording is smaller than the display's, so a quality preset's
  bitrate is generous for it; nothing changes in the presets in v1.

## 10. Sources and prior art

- Screen Studio — [recording area guide](https://www.screen.studio/guide/recording-area): Display,
  Window and Area in one picker; Area drags or takes exact dimensions; a shortcut starts an area
  recording.
- CleanShot X 5 — [region first, then format](https://www.podfeet.com/blog/2026/09/cleanshot-5/);
  [custom dimensions before recording](https://setapp.com/apps/cleanshot%20).
- Screenity — [custom area without tab audio](https://help.screenity.io/recording/setting-a-custom-area-to-record-in):
  the cost of cropping on the web side.
- Chromium Region Capture — [`cropTo()` applies to tab capture only](https://developer.chrome.com/docs/web-platform/region-capture),
  [MDN](https://developer.mozilla.org/en-US/docs/Web/API/BrowserCaptureMediaStreamTrack/cropTo):
  why the crop is ours.
- In the repo: the capture geometry module and its tests, the recording compositor, the overlay
  action bar with the reserved Record seat, ADR 0022, 0024 and 0029.
