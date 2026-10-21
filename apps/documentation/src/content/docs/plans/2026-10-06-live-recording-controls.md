---
title: Live recording controls — implementation plan
description: Night-shift plan for NIW2-152 — mute the mic, toggle system audio and show or hide the camera during a take, from the Capture Panel, the Record page and three global shortcuts.
---

# Live recording controls — implementation plan

**Status: 🟡 In progress · 2026-10-06.** Implements the spec
[Live recording controls — design](/specs/2026-10-06-live-recording-controls-design/)
(Linear NIW2-152). One phase.

## Steps

1. **Engine** (`features/recording/recorder-engine.ts`)
   - Route each input through its own `GainNode` (`micGain`, `sysGain`) into the single
     `MediaStreamDestination`. Start gain follows the settings.
   - Always try to acquire loopback with the screen (decision 6); `systemAudio` now only
     sets the starting gain. Fix the stale macOS comment (system audio does record in the
     packaged app).
   - Always add the audio track, even when no input is connected (decision 4).
   - Expose `setMicrophoneEnabled(on, deviceId)` (ramp, or late acquisition when the mic
     was off at start; `"unavailable"` on failure, take keeps running) and
     `setSystemAudioEnabled(on)` (`"unavailable"` without loopback), plus
     `hasSystemAudio`. Ramps are ~20 ms `linearRampToValueAtTime`.
2. **Store** (`features/recording/recorder-store.ts`): while a take is active, subscribe
   to `onRecordingSettingsChanged`, forward mic/system-audio changes to the engine, and
   write the setting back to `false` on `"unavailable"`. The tick reports
   `systemAudioAvailable` so other windows know.
3. **Activity** (`main/recording/recording-activity.ts`, `RecordingActivity`/`RecordingTick`):
   carry `systemAudioAvailable` from the tick to every window.
4. **Surfaces**: Capture Panel and Record page move `inert` to the source card and mic
   picker only. `RecordingToggles` gets an optional disabled system-audio state with the
   tooltip "System audio isn't available for this recording" (needs `disabled`/`title` on
   `@kaipu/ui` `StatusToggle`).
5. **Shortcuts**: `toggleMicrophone` (⌃⌘M), `toggleSystemAudio` (⌃⌘A), `toggleCamera`
   (⌃⌘K) — Windows `Control+Alt+<key>` — in `@kaipu/domain`, `SHORTCUT_DEFINITIONS`,
   the main-process handlers (flip the hub's `RecordingSettings`), the Shortcuts page and
   i18n (en/es). The status bar keeps showing only the four existing actions.
6. **Tests**: engine controller (gain targets, late mic, `"unavailable"`, always-audio
   track), store forwarding + write-back, activity tick, shortcut defaults.

## Not in this plan

No control-bar buttons, no device/source switching, no volume levels. The packaged-build
system-audio check is the owner's (`build:mac`).
