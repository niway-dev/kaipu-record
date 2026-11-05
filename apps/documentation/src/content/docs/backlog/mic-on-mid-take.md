---
title: Turn the microphone on mid-take
description: A take that starts with the mic off can turn it on later. The engine already supports it; this entry tracks the missing failure feedback and the unconfirmed field report (NIW2-651).
---

# Turn the microphone on mid-take

> **Status: 🟡 In progress.** Linear: NIW2-651. The engine and store already open the mic late;
> what was missing is any feedback when that fails. The owner's field report (mic cannot be
> turned on in a take that started without it) is not yet reproduced or explained.

## How it works today

- The mixed `AudioContext` and its destination track are always created at start, even with
  the mic and system audio both off (the destination produces silence). mediabunny cannot
  add a track after `start()`, so the track must exist from the first frame.
- `setMicrophoneEnabled(true, deviceId)` on an engine whose mic was never opened acquires the
  device then, and connects it into the same graph (level gain, mute gain, destination). The
  file has silence before and the voice after, on the same clock.
- Afterwards off/on only ramps the mute gain; the device is not opened again.
- Both transports (Chromium and native) share this path: audio is always Chromium-side.
- The mic tiles are never disabled during a take (Record page, capture panel, shortcut).

## This change

- The engine keeps the browser's reason when a late open fails (`microphoneError()`).
- The store reports `record.micUnavailable` with that reason (phase `mic-late`) when a late
  open fails. The toggle was already written back to off; before this, nothing else said why.
- Limit: the main window is hidden during a take, so the toast is seen only afterwards. The
  analytics report carries the reason either way. A muted-mic icon on the control bar (plan
  `plans/audit-2026-10-15/23-mic-failure-feedback`) is the visible cue and is still open.

## Open

- Reproduce the field report in the real app and read the reported reason.
- Hypothesis, unconfirmed: a `MediaStreamAudioDestinationNode` with nothing connected may
  deliver no frames in Chromium. If so, connect a silent constant source at start.
