---
title: "Live recording controls — mic, system audio and camera while recording"
description: "Proposal: let the user mute the microphone, turn system audio on or off and show or hide the camera bubble while a recording is running, from the floating control bar and the global shortcuts, without stopping the take."
---

# Live recording controls

> **Status: 🔵 Proposed** (2026-09-23). Owner request after the video editor v2 wave:
> "I want to change the recording settings while the recording is happening — mute,
> turn audio on or off, and the camera." Not scheduled. Parent reference:
> [Recording pipeline](/desktop/recording-pipeline/) · sibling:
> [Roadmap → Video editor v2 wave](./roadmap#video-editor-v2-wave-2026-09-22--23).

> **2026-10-06 — superseded by the [design spec](/specs/2026-10-06-live-recording-controls-design/)**
> where they differ: no buttons on the floating control bar (the Capture Panel, the Record
> page and shortcuts carry the toggles), and system audio is always acquired so its toggle
> only moves a gain ([ADR 0011](/architecture/decisions/0011-system-audio-acquired-whenever-available/)).

## Problem

Once a take starts, every input is frozen. The main window hides, the floating
[control bar](/desktop/recording-pipeline/#ventanas-flotantes-transparentes-barra-y-burbuja)
offers **pause · resume · stop** and nothing else, and the three toggles the user set
before recording — microphone, system audio, camera — cannot be touched until the take
ends. The situations this hurts are the ordinary ones:

- someone walks in and you want the mic off for a moment, without a pause that cuts
  the screen too;
- a notification sound or a video plays and you realise system audio is on (or off);
- the camera bubble is covering the thing you are about to show, or you want to appear
  only for the intro and the outro.

Today the only answers are pause (which also stops the screen) or stop and start again
(which splits the take into two files).

## What exists already

The pieces are further along than the UI suggests:

- **Recording settings are global and live.** `RecordingSettings` (`selectedSource`,
  `selectedMicrophone`, `isMicrophoneEnabled`, `isSystemAudioEnabled`, `isCameraEnabled`)
  live in the main-process hub, every window updates them through
  `recordingSettingsUpdate` and receives `recordingSettingsChanged`
  (`main/recording/recording-hub.ts`). Nothing in the hub refuses a change while a take
  is running.
- **The camera already follows its toggle at any moment.** The hub shows or destroys the
  camera bubble whenever `isCameraEnabled` flips, "no matter which window flipped it".
  The bubble is a floating window captured as part of the screen, so hiding it mid-take
  simply removes it from the frames. The only reason this does not work today is that no
  reachable surface exposes the toggle while recording — the main window is hidden.
- **Audio is one mixed track.** `recorder-engine.ts` acquires the mic (best-effort) and
  the loopback track (best-effort, only alongside desktop video), connects both to a
  single `AudioContext` `MediaStreamDestination`, and hands that one track to mediabunny
  (`MediaStreamAudioTrackSource`). The encoder never sees the inputs, only the mix. Which
  means muting an input is a change to the graph, not to the encoder.
- **The control bar already speaks to the recorder.** `controlCommand` (`pause` /
  `resume` / `stop`) goes bar → hub → main window → engine. The bar shows a live mic
  level from the engine's analyser, so it is already the place that displays audio state.

What is missing is small: three toggles on the bar, a way for the engine to react to
`RecordingSettings` changes after `start()`, and the two constraints below handled
honestly.

## Proposal

### Behaviour

| Control          | While recording                                                                                                                                                                     | Constraint                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Microphone**   | Mute / unmute. The take keeps its audio track; the mic contributes silence while muted. The bar's level meter drops to zero and the mic button shows the muted state.               | If the mic was **off when the take started**, "unmute" must acquire it (`getUserMedia`) and connect it to the running graph. That is allowed: the mix's output track does not change identity. |
| **System audio** | On / off. Same mechanism: the loopback input's gain goes to 0 / 1.                                                                                                                  | Loopback can only be acquired **with** the desktop video call. If system audio was off at start, the toggle is **disabled** during the take with a tooltip — it cannot be added mid-take.      |
| **Camera**       | Show / hide the bubble. Reuses the hub's existing follow logic. Hiding destroys the window and releases the device (green light off), exactly as it does outside a recording today. | The bubble is captured from the screen, so it appears in the frames from the moment it is shown. No compositor work.                                                                           |

- **Pause is unchanged.** These toggles are independent of pause/resume; a paused take
  can still have its mic muted so it resumes silent.
- **Persisted toggles vs live state.** A live change **is** a settings change: it writes
  `RecordingSettings` like the Record page does, so after the take the toggles show what
  was active at the end. That is the simplest rule and the one the camera already
  follows. The alternative — a transient state restored at stop — needs a second source
  of truth and surprises the user who muted on purpose.
- **Silence, not a gap.** Muting writes silence into the same continuous track. The file
  stays a single MP4 with an audio track of the full length, so the editor's timeline and
  cuts keep working and A/V sync is untouched.

### Surfaces

1. **Floating control bar** — three icon buttons between the level meter and pause:
   mic (`Mic` / `MicOff`), system audio (`Volume2` / `VolumeX`), camera (`Video` /
   `VideoOff`). Muted/off states use the bar's existing muted colour, disabled system
   audio gets `aria-disabled` and the tooltip "System audio was off when the recording
   started".
2. **Global shortcuts** — three new rebindable actions in `SHORTCUT_DEFINITIONS`
   (`toggleMicrophone`, `toggleSystemAudio`, `toggleCamera`), group `recording`, with
   defaults in the existing `Command+Control+<key>` family. Global shortcuts matter more
   here than on the bar: the user is in the app they are recording, and reaching for the
   bar means moving the pointer into the frames.
3. **Menu bar / Capture Panel** — the panel already renders the three toggles when idle;
   while recording it should keep them enabled instead of freezing (out of scope if the
   panel hides during recording — verify).

### Engine change (the only non-trivial part)

`recorder-engine.ts` builds the audio graph once. The change is to keep the graph's
nodes and expose a live controller:

```
mic  ──► GainNode (micGain)   ──┐
                                 ├──► MediaStreamDestination ──► mediabunny
sys  ──► GainNode (sysGain)   ──┘
```

- `setMicrophoneEnabled(on)`: `micGain.gain.value = on ? 1 : 0`. If no mic source exists
  (mic was off at start), acquire one with the persisted `selectedMicrophone`, connect it
  through a new `micGain`, and remember to stop its tracks on `stop()` (the existing
  teardown comment already warns that closing the `AudioContext` does not stop tracks).
- `setSystemAudioEnabled(on)`: `sysGain.gain.value = on ? 1 : 0`; no-op with a returned
  `"unavailable"` when there is no loopback track.
- **Always create an audio track.** Today, if both inputs are off at start the output
  has no audio track at all, and mediabunny cannot add one after `start()`. With live
  controls the destination track must be added **always**, so an "unmute" later has
  somewhere to go. Cost: a silent AAC track on mic-less takes (a few KB/min). Worth it.
- The gain ramp should be a short `linearRampToValueAtTime` (≈ 20 ms) to avoid a click
  on the transition.
- The analyser stays on the destination, so the bar's level meter reflects the mix the
  file actually gets — muted mic shows zero, which is the right feedback.

The camera needs **no engine change**: the hub's existing `recordingSettingsUpdate`
handler already shows/destroys the bubble.

### Wiring

`recorder-store.ts` (renderer, main window) subscribes to `recordingSettingsChanged`
while a take is active and forwards `isMicrophoneEnabled` / `isSystemAudioEnabled` to
the engine controller. The bar and the shortcuts only ever write `RecordingSettings`;
they never talk to the engine directly, which keeps the single-source-of-truth rule the
hub introduced (see [roadmap → shipped beyond the kill order](./roadmap#shipped-beyond-the-kill-order-)).

## Non-goals

- **Switching the microphone device** mid-take. Possible with the same graph, but it
  changes latency and level between segments; leave it for a later item.
- **Changing the source, resolution or quality** mid-take. Those restart the encoder.
- **Adding system audio** when it was off at start (constraint above). The honest UI is a
  disabled toggle, not a silent failure.
- **Per-segment audio tracks** in the file. One mixed track, always.

## Acceptance

- [ ] Mute the mic 5 s into a 20 s take, unmute at 15 s: one MP4, one audio track of
      20 s, silence between 5 and 15, no click at the transitions, screen continuous.
- [ ] Start with mic **off**, unmute mid-take: the mic is acquired (light on), audio from
      that point onwards; the take had an audio track from 0 s.
- [ ] Start with system audio **off**: the toggle is disabled on the bar with the tooltip.
- [ ] Hide the camera mid-take: the bubble vanishes from the frames and the green light
      goes off; show it again and it is back. `isCameraEnabled` reflects the final state
      after stop.
- [ ] Shortcuts work while another app is focused and are rebindable on the Shortcuts
      page; the bar's icons reflect a shortcut-driven change.
- [ ] Pause + mute + resume: resumes silent; unmute restores audio.
- [ ] Editor: a take recorded with mute segments opens with a continuous timeline and
      exports in sync.

## Reopen if

- mediabunny gains the ability to add a track after `start()` — then the "always add
  an audio track" rule can go.
- Loopback becomes acquirable on its own (e.g. a native ScreenCaptureKit path) — then
  the system-audio constraint disappears and the toggle is always enabled.
