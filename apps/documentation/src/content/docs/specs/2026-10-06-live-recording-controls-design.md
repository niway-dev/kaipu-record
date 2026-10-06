---
title: Live recording controls — mic, system audio and camera during a take
description: Design for muting the microphone, turning system (playback) audio on or off and showing or hiding the camera while a recording runs, from the menu-bar panel, the main window and global shortcuts, without ending the session.
---

# Live recording controls — design

**Status: 🔵 Proposed · 2026-10-06.** Supersedes the proposal in
[backlog/live-recording-controls](/backlog/live-recording-controls/) where the two differ
(surfaces, system audio on macOS). Phase A is meant for the night shift; Phase B needs a
person at a Mac.

## Summary (one minute)

Three toggles stop being frozen during a take: **microphone** (your voice), **system
audio** (what the computer plays) and **camera** (the bubble). They are the toggles the
user already has. The menu-bar Capture Panel and the main window stop locking them while
recording, and three global shortcuts flip them. The floating control bar gets no new
buttons. Muting writes silence into the same continuous audio track: one file, no gaps,
A/V sync untouched. On macOS today the app **never records system audio** (the capture
call it uses is rejected and falls back to video only), so Phase A ships the system-audio
toggle where loopback exists. Phase B moves screen capture to the path that gets loopback
on macOS 13+.

| #   | Decision                                                                                                               | Why                                                                                                  | ADR        |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Surfaces: Capture Panel + main window Record page + 3 global shortcuts. **Nothing on the control bar.**                | Owner: "not in the widget". Shortcuts avoid moving the pointer into the frames.                      | —          |
| 2   | Only the three toggles unlock; source and mic device stay locked.                                                      | Changing source or device restarts the encoder or changes levels mid-take.                           | —          |
| 3   | Each input goes through its own `GainNode`; mute = gain 0 with a ~20 ms ramp.                                          | One mixed track already; the encoder never sees inputs. Ramp avoids clicks.                          | —          |
| 4   | The output always has an audio track, silent if no input is on.                                                        | mediabunny cannot add a track after `start()`; an unmute needs somewhere to go.                      | —          |
| 5   | A live change **is** a settings change (`RecordingSettings`), so the final state persists after stop.                  | One source of truth; the camera already works this way.                                              | —          |
| 6   | System audio is acquired whenever the platform can, and "off" means gain 0 — not "not acquired".                       | The only way "turn it on mid-take" can work: loopback can only be acquired with the screen at start. | 0011 (new) |
| 7   | Phase B: screen capture moves to `getDisplayMedia` served by `setDisplayMediaRequestHandler` with `audio: "loopback"`. | Electron 39 gets macOS loopback (CoreAudio Tap / ScreenCaptureKit) only through that path.           | 0011 (new) |

### Open questions

1. Shortcut defaults: proposed `Command+Control+M` (mic), `Command+Control+A` (system
   audio), `Command+Control+K` (camera); Windows `Control+Alt+<same key>`. Owner may rebind.
2. Phase B: does the macOS permission prompt change when moving to `getDisplayMedia`?
   Unverified; Phase B starts with that check.

### Out of scope

Switching mic device or screen source mid-take; volume levels (mute is binary, as decided in
[open decisions §2](/backlog/open-decisions-editor-audio/)); per-input audio tracks in the
file; buttons on the floating control bar; any cursor change.

### Failures this must protect against

- A muted range that is not **exactly** silent (audio the user believed was off leaks).
- Mic light staying on after stop, or after muting a mic acquired mid-take.
- A take whose audio track starts late or is missing because both inputs were off at start.
- A/V drift after several mute/unmute cycles, or across pause + mute + resume.
- Unlocking the source card or mic picker mid-take by accident.
- A shortcut that toggles state while no take is running in a way the Record page does not
  reflect (it must just change the setting, as the toggle does).
- The system-audio toggle claiming "on" when no loopback track exists.

---

## Terms

- **Microphone**: the input device, the user's voice.
- **System audio**: what the computer plays (videos, notifications). Captured as a
  "loopback" track.
- **Camera**: the floating bubble window. It is captured as part of the screen, so showing
  or hiding it needs no encoder work.

## Current state (verified on `main`, 2026-10-06)

- `RecordingSettings` (`isMicrophoneEnabled`, `isSystemAudioEnabled`, `isCameraEnabled`,
  …) live in the main-process hub (`main/recording/recording-hub.ts`). Windows write
  `recordingSettingsUpdate` and receive `recordingSettingsChanged`. Nothing refuses a change
  during a take, and the hub already shows or destroys the camera bubble whenever
  `isCameraEnabled` flips.
- The Capture Panel locks its controls during a take:
  `features/capture-panel/capture-panel.tsx:90-95` (`inert={isBusy}`). The Record page does
  the same: `pages/record/record-page.tsx:97-100` (`inert={isRecording}`).
- `features/recording/recorder-engine.ts:105-127`: system audio is requested with the legacy
  `chromeMediaSource: "desktop"` audio constraint. **On macOS that call rejects** and the
  engine falls back to video only, so macOS takes never contain system audio today.
- `recorder-engine.ts:157-181`: mic and loopback connect straight to one
  `MediaStreamDestination`; the encoder receives that single mixed track
  (`MediaStreamAudioTrackSource`). If neither input exists, no audio track is added
  (`:229-237`).
- Shortcut defaults live in `@kaipu/domain` (`constants/shortcuts.ts`), labels in
  `SHORTCUT_DEFINITIONS` (`shared/types/ipc.ts`). The app already depends on `@kaipu/domain`.

## Phase A — live toggles (night shift)

### Engine

Keep the graph's nodes and return a live controller from the engine:

```
mic  ──► GainNode micGain ──┐
                            ├──► MediaStreamDestination ──► mediabunny (AAC)
sys  ──► GainNode sysGain ──┘                 └──► AnalyserNode (level meter)
```

- `setMicrophoneEnabled(on: boolean): Promise<"ok" | "unavailable">`
  - Mic exists: ramp `micGain` to 1 or 0 over ~20 ms (`linearRampToValueAtTime`).
  - Mic was off at start and `on` is true: acquire it with the persisted
    `selectedMicrophone`, connect through a new `micGain`, push the stream into
    `inputStreams` so `stop()` releases it. Acquisition failure returns `"unavailable"` and
    leaves the take running.
  - Muting does **not** release the device in Phase A (keeps unmute instant). The light stays
    on while muted. Recorded as a known trade-off.
- `setSystemAudioEnabled(on: boolean): "ok" | "unavailable"`: ramp `sysGain`; returns
  `"unavailable"` when there is no loopback track.
- **Always add the audio track** (decision 4). When no input is connected the destination
  still produces silence. Cost: a few KB/min of silent AAC.
- Start state follows the settings: an input that exists but is off starts at gain 0.
- The analyser stays on the destination, so the meter shows what the file gets.

### Wiring

`recorder-store.ts` (main window renderer, owner of the engine) subscribes to
`recordingSettingsChanged` while a take is active and forwards `isMicrophoneEnabled` and
`isSystemAudioEnabled` to the controller. When the controller answers `"unavailable"`, the
store writes the setting back to `false` so every surface shows the truth. The camera needs
no engine change.

Surfaces and shortcuts only write `RecordingSettings`. They never call the engine.

### Surfaces

- **Capture Panel** and **Record page**: move `inert` from the whole block to the source
  card and mic picker only. `RecordingToggles` stays interactive during a take.
- **System-audio toggle when loopback is unavailable** during a take: disabled, with the
  tooltip "System audio isn't available for this recording". Before a take it behaves as
  today.
- **Global shortcuts**: add `toggleMicrophone`, `toggleSystemAudio`, `toggleCamera` to
  `SHORTCUT_ACTIONS` and defaults (open question 1), and to `SHORTCUT_DEFINITIONS` with
  labels in the `recording` group, translated in `@kaipu/i18n`. They work with or without a
  take; outside a take they flip the pre-recording setting.

### Acceptance (Phase A)

- [ ] Mute mic at 5 s, unmute at 15 s in a 20 s take: one MP4, one 20 s audio track, every
      sample in 5–15 s is zero (± the 20 ms ramps), no click.
- [ ] Mic off at start, unmute mid-take: light turns on, audio from that point; track exists
      from 0 s.
- [ ] Both inputs off for the whole take: the file still has a silent audio track.
- [ ] Camera off → on → off mid-take from the Capture Panel: bubble appears and disappears
      in the frames; green light off when hidden; `isCameraEnabled` shows the final state.
- [ ] Source card and mic picker stay locked during a take.
- [ ] Shortcuts work with another app focused; the panel and Record page reflect them.
- [ ] Pause + mute + resume resumes silent; unmute restores audio; A/V in sync on export.
- [ ] Unit tests for the controller (gain targets, late mic acquisition, `"unavailable"`
      path) and for the store's write-back.

## Phase B — system audio on macOS (needs a person at a Mac)

Electron 39 exposes macOS loopback only through the standard display-media path: the main
process answers `getDisplayMedia()` in `session.setDisplayMediaRequestHandler` with the
chosen source and `audio: "loopback"`, with Chromium's `MacLoopbackAudioForScreenShare`
(and on some versions `MacSckSystemAudioLoopbackOverride`) enabled. Chromium made the
CoreAudio Tap API the default for this from Electron 39 betas.

Steps:

1. Spike (½ day, on a Mac): serve the existing source picker's choice through the handler
   with `audio: "loopback"`; record 10 s of a playing video. Check: loopback track present,
   permission prompts, macOS minimum version, latency vs the current path.
2. If it works: replace the `getUserMedia({chromeMediaSource: "desktop"})` call in the engine
   with `getDisplayMedia`, keep the video constraints, and **always** request loopback when
   the platform supports it (decision 6). Off = gain 0.
3. Re-run Phase A acceptance with system audio on macOS.

The same path is where a cursor-free capture would be tried
([cursor research](/specs/2026-10-06-cursor-styling-research/)); Phase B should leave a note
there with what it learned.

## References

- [Electron issue #47490 — ScreenCaptureKit loopback on macOS](https://github.com/electron/electron/issues/47490)
- [Electron issue #42605 — MacLoopbackAudioForScreenShare](https://github.com/electron/electron/issues/42605)
- [Finally, easy audio loopback in Electron](https://alec.is/posts/bringing-system-audio-loopback-to-electron/)
- [Recording system audio in Electron on macOS — approaches](https://stronglytyped.uk/articles/recording-system-audio-electron-macos-approaches)
- Prior proposal: [backlog/live-recording-controls](/backlog/live-recording-controls/)
