---
title: Recording widget — screenshot and live input toggles
description: Take a screenshot of the current recording target and toggle microphone, system audio and camera from the floating recording widget.
---

> **Status: 🟢 Ready to validate (prod review pending).** Owner-approved scope: a screenshot button and microphone,
> system-audio and camera toggles in the recording widget. Screenshots cover only the
> target already being recorded, with no new selection.

## Behaviour

- The screenshot button reuses Kai with four capture corners from the small-size tray mark,
  in the current foreground colour. The camera keeps its existing camera icon.
- The screenshot button uses the same request as Command + Control + X. During a take,
  the existing direct-capture flow captures the recorded display, region or window.
  It never opens a selector or changes the take's target. The content-protected confirmation
  stays out of the video. Idle shortcuts keep their existing selection behaviour.
- Screenshot availability is resolved by main and sent in the control tick. The button
  follows the existing macOS-only `capture-while-recording` flag, including live flag changes.
- Microphone, system audio and camera remain visible as pressed/unpressed icon buttons.
  They update the existing recording-settings hub and follow changes from global shortcuts
  and other windows. Controls are unavailable until the initial settings load.
- System audio is disabled when the current take has no loopback track; its tooltip explains why.
- The camera can be enabled even if the take began with it off. The engine opens the selected
  camera and creates its separate webcam writer on demand, then keeps that same file through
  later off/on gaps. Its start offset excludes time the screen recording spent paused.
  Camera acquisition or writer failure keeps the screen recording running and resets the toggle.
- Starting and saving retain their existing restricted controls. Stop's shortcut is in its
  tooltip to make room for the new buttons. The widget remains content-protected by default;
  the existing option to include it in the recording is unchanged.

## Acceptance and verification

| Criterion                                                            | Verification                                                                                                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Widget screenshot and shortcut capture the existing recording target | Widget bridge tests; Mac mini widget click saved a 320 × 200 image for a 320 × 200 recording region, without a visible selector                                                   |
| All three toggles support both directions and reflect broadcasts     | Control-bar root tests and existing live-settings engine/store tests                                                                                                              |
| Camera first enabled mid-take records a separate track               | Engine/store tests cover the late camera and its clock; Mac mini proof started the camera while paused, toggled off/on, then parsed its saved MP4                                 |
| Unavailable loopback cannot be switched on                           | Control-bar disabled-state test and existing engine/store tests                                                                                                                   |
| Recording and paused layouts fit the actual widget window            | Mac mini catalog captured recording, paused, inputs-off and inputs-on states at the real 688 × 82 window size; inspected without clipping                                         |
| Widget and confirmation remain absent from the saved video           | Prior flow validated by owner after PR #562; real widget click confirmed the protected screenshot notice. Saved whole-display video exclusion was not re-inspected in this change |

## Implementation

The widget reuses `useRecordingSettings` and `requestCaptureScreenshot`; it introduces no new IPC
channel. `RecordingTick.screenshotAvailable` is optional and supplied by main. The camera uses the
existing webcam writer, relay and gap metadata, initialized on first enable when necessary.

## Manual validation on the Mac mini

1. Enable `capture-while-recording`, record a region with the camera initially off, and click
   the widget's screenshot button. Repeat with Command + Control + X. Both images must match
   the selected recording region, with no selector opening.
2. Switch microphone and system audio off and on; listen to the saved take to confirm the
   input changes, without stopping or splitting the screen recording.
3. Enable camera, disable it, then enable it again. Save and inspect the webcam layer and its
   hidden gaps, including a first camera enable after a pause/resume and while paused.
4. Repeat capture for a display and a window. Inspect the saved recording to confirm that
   neither the widget (default setting) nor the screenshot confirmation appears in the video.

Electron and desktop Playwright run on the Mac mini only. Unit tests, type checks and builds
can run on the laptop.

## Remaining validation

- Listening to a physical microphone and system audio, and inspecting a saved whole-display
  video for widget/confirmation exclusion, remain owner validation. No Windows runtime was
  exercised.
