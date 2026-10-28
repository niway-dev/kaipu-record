---
title: "Mic and System audio settings"
description: "The Mic and Audio tiles split like the Camera tile: an inline drawer on the Record page (wide, two columns) and in the capture panel (compact) for the input device, input level, noise reduction, system-audio volume and lowering it while you talk."
---

# Mic and System audio settings

> **Status: 🟡 In progress** (2026-10-27). Branch `feature/recording-mic-audio-settings`.
> Unit tests, type checks and lint pass; nothing has been run in the Electron app yet, so the
> audio chain, the live changes mid-take and the meter are untested with a real microphone.
> Design: Claude Design project "Kaipu Camera Controls", section **0 / MIC & AUDIO** and
> **0 / CAPTURE PANEL**. The implementation plan lives in git history (it shipped with this
> branch and was deleted by its PR). Builds on
> [Camera bubble — shape and size](/backlog/camera-bubble-shape-and-size/), whose split tile and
> settings shell it reuses.

## The rule

The Mic · Audio · Camera row looks the same for someone who never touches a chevron. Each tile is
a toggle body plus a 28 px chevron segment (22 px in the capture panel). The old microphone picker
row under the toggles is gone: the device list now lives in the mic settings.

## The settings

`AppSettings.audio`, persisted in `settings.json`, merged field by field in `mergeSettings`
through `sanitizeAudioSettings` (`apps/kaipu-record/src/shared/audio-settings.ts`). The whole
object is replaced on every write, so the UI always spreads the current value.

| Field                         | Values    | Default | Notes                                                  |
| ----------------------------- | --------- | ------- | ------------------------------------------------------ |
| `micLevel`                    | 0–200 (%) | 100     | 100 leaves the signal unchanged. Clamped, not dropped. |
| `noiseSuppression`            | boolean   | `true`  | Chromium's `getUserMedia` default today.               |
| `systemAudioVolume`           | 0–100 (%) | 100     | Volume of the system audio inside the recording.       |
| `duckSystemAudioWhileTalking` | boolean   | `false` | Lower the system audio while the mic hears a voice.    |

The device stays in `RecordingSettings.selectedMicrophone`, shared across windows. The defaults
reproduce the recording from before these settings existed.

## What each surface shows

- **Microphone**: header with the mic icon and a "LIVE" badge during a take; INPUT, a radiogroup of
  devices (name, BUILT-IN / BLUETOOTH / USB / EXTERNAL, a 14-bar level meter on the selected row,
  arrow keys move the selection); INPUT LEVEL, a slider with the value ("70%"); the "Reduce
  background noise" switch. During a take the device list is locked, a device that disappeared
  stays in the list greyed as DISCONNECTED, and a note says level and noise apply live.
- **System audio**: WHAT TO CAPTURE (All sound; One app disabled with "Not available yet");
  VOLUME IN THE RECORDING; the "Lower it while I talk" switch, disabled with "Turn on the
  microphone to use this" while the mic toggle is off.
- **Record page**: wide inline drawer under the row, in the page's flow (a floating popover was
  clipped at the bottom of the window; the content area scrolls, so a tall drawer pushes and
  scrolls instead). Two columns above ~520 px, one below. **Capture panel**: compact inline
  drawer under the row, kept under the panel's 600 px ceiling: one-line device rows (the type
  is in the row's tooltip; "Disconnected" stays visible), a device list that scrolls past five,
  the noise and ducking hints as tooltips and screen-reader descriptions, and no "One app" line
  under the capture chips (the disabled chip's tooltip says it). `e2e/capture-panel-height.e2e.ts`
  measures every drawer at its tallest against that ceiling. On both, only one drawer (Mic, Audio, Camera) is open at a time. Microphone permission denied keeps the existing notice on the Record page.

## Engine and live changes

The audio graph, the ducking rules and the live forwarding are described in
[Recording pipeline → Audio graph](/desktop/recording-pipeline/#audio-graph). Level, noise
reduction, volume and ducking apply to a running take; the device never changes mid-take.

The meter before a take (`useMicLevelMeter`) opens `getUserMedia` for the selected device (with
the `noiseSuppression` the take will use) only while the settings are open, the mic toggle is on,
nothing is busy and **the window has focus**, and releases the tracks and the `AudioContext` on
close, device change, blur or unmount. Every settings disclosure (Mic, Audio, Camera) also closes
when its window loses focus: the capture panel hides on blur and the main window can sit in the
tray, and neither reliably reports visibility. During a take the meter subscribes to the engine's
mic levels (`useTakeMicLevels` → `subscribeMicLevels`, a channel of its own, see the pipeline
page) only while mounted and focused; the levels are never part of the activity broadcast. The
analyser taps the raw mic before the level gain, so before and during a take the bars mean the
same.

The Record page treats any recorder state other than idle (countdown, starting, recording, saving)
as busy for the Mic and Camera settings, like the capture panel. The Mic and Audio tiles of a
window share one `useAudioSettings` store, because every write sends the whole `audio` object.

## Decisions

| Decision                                                                                                                           | Why                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One app** capture is out of scope; the segment renders disabled with its reason.                                                 | Electron's desktop loopback captures the whole system mix; per-app capture needs ScreenCaptureKit / WASAPI process loopback natively. Its own ticket. |
| **Leave out Kaipu sounds** is not rendered.                                                                                        | Kaipu plays no start/stop sounds today, so the switch would do nothing.                                                                               |
| Extract a shared split tile and settings shell from the camera controls (`features/settings-controls`) instead of copying the CSS. | One look and one focus contract for the three tiles; the camera's tests stayed green.                                                                 |
| Ducking is disabled in the UI while the mic is off.                                                                                | With no mic there is no voice to duck under.                                                                                                          |
| Mic levels travel on their own IPC channel, sent only while a window subscribes.                                                   | On the activity broadcast they re-rendered every window ~10 times a second for the whole take.                                                        |
| The mic analyser taps the source before the level gain.                                                                            | The ducking threshold and the meter must not move with the level slider.                                                                              |
| Noise suppression mid-take reopens the same device and swaps the source; a refusal is written back to the setting.                 | Chromium cannot change processing on a live track; the UI must show the value in effect.                                                              |
| The audio-unavailable tile (no loopback mid-take) keeps its disabled body and tooltip; its chevron still opens the settings.       | The settings stay reachable; only the toggle could not work.                                                                                          |

## Manual checks

1. Record page and capture panel: Mic and Audio tiles look like the Camera tile; chevrons open the
   inline drawer under the row (pushing the page, never clipped); only one drawer at a time.
2. Open Microphone settings with the mic on: the meter on the selected row moves when you talk, and
   the OS mic indicator turns off when you close the drawer.
3. Switch device from the list; Mic off: the meter is flat and the device is not opened.
4. Record with the level at 0% (silent mic), 100% and 200% (loud); the exported audio matches.
5. During a take: drag the level and toggle noise reduction; both apply live (noise reopens the
   mic: no gap in the recording, the meter keeps moving). The device list is locked, "LIVE" and the
   note show. Unplug the selected mic: DISCONNECTED appears. The meter moves the same at 50% and
   200% level, and ducking triggers at the same voice volume.
   Hardware: confirm the OS mic indicator turns off when the capture panel hides on blur with the
   Mic drawer open, and when the main window goes to the tray with the Mic drawer open.
6. System audio at 30%, then 100%, with something playing: the volume in the recording follows.
7. "Lower it while I talk": system audio dips while you speak and returns about half a second
   after; disabled with the mic toggle off; a muted mic does not duck.
8. Microphone permission denied: the "Microphone access is off" notice still shows on the Record page.
9. Countdown: press Record and open Mic settings during the 3-2-1: the device list is locked and
   the meter does not hold the mic. With no microphones, opening Mic settings focuses the panel and
   Esc closes it.
10. Spanish: all new strings are in neutral Spanish.
