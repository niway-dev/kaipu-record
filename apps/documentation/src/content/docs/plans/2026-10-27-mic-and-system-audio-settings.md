---
title: "Plan — Mic and System audio settings"
description: "Split the Mic and Audio tiles like the Camera tile: a popover on the Record page and an inline drawer in the capture panel, with device, input level, noise reduction, system-audio volume and lowering it while you talk."
---

# Plan — Mic and System audio settings

Working document. The shipping PR deletes it. Backlog doc:
[Mic and System audio settings](/backlog/mic-and-system-audio-settings/).

Design: Claude Design project "Kaipu Camera Controls", section **0 / MIC & AUDIO**
(boards **M** Microphone, **S** System audio, **R** Mic during a recording) and
**0 / CAPTURE PANEL** (the mic drawer in the 300 px panel). The Camera tile already ships this
pattern (`apps/kaipu-record/src/renderer/src/features/camera-settings/`); Mic and Audio copy it.

## Scope

In:

- Mic tile and Audio tile split into toggle body + chevron, Record page (popover) and capture
  panel (inline drawer), same behaviour, focus contract and styles as the Camera split.
- Microphone settings: device list (radio rows, type BUILT-IN/BLUETOOTH/USB, a live level meter
  on the selected row), input level slider, "Reduce background noise" switch.
- During a take: level and noise apply live, the device list is locked, a device that
  disappeared shows DISCONNECTED, a LIVE badge in the header and a note.
- System audio settings: "What to capture" (All sound / One app), volume in the recording,
  "Lower it while I talk".
- The old `MicPicker` row under the toggles goes away on both surfaces: the device list now
  lives in the mic settings.

Out (decided 2026-10-27):

- **One app** capture: Electron's desktop loopback captures the whole system mix; per-app capture
  needs ScreenCaptureKit / WASAPI process loopback natively. The segment renders with One app
  disabled and its reason ("Not available yet"), as the design prescribes for an unsupported
  system. Its own ticket.
- **Leave out Kaipu sounds**: Kaipu plays no start/stop sounds today, so the switch would do
  nothing. Not rendered.

## Settings model

New persisted `AppSettings.audio` (like `cameraBubble`), in `apps/kaipu-record/src/shared/audio-settings.ts`
(no workspace value imports: `shared/**` is reachable from the preload bundle):

```ts
interface AudioSettings {
  micLevel: number;              // percent, 0..200, 100 = unchanged
  noiseSuppression: boolean;     // default true (Chromium's getUserMedia default today)
  systemAudioVolume: number;     // percent, 0..100, default 100
  duckSystemAudioWhileTalking: boolean; // default false
}
```

`sanitizeAudioSettings(stored)` clamps/defaults field by field; `mergeSettings` uses it.
Defaults reproduce today's recording exactly (unity mic gain, noise suppression on, system audio
at full volume, no ducking).

The device stays where it is (`RecordingSettings.selectedMicrophone`, shared across windows).

## Engine (`recorder-engine.ts`)

- `EngineOptions.audio: AudioSettings`. `openMicrophone(deviceId, noiseSuppression)` passes
  `noiseSuppression` in the constraints.
- Mic chain: source → `micLevelGain` (micLevel / 100) → `micMuteGain` (existing on/off ramp) →
  destination. System: source → `sysVolumeGain` (volume / 100) → `sysDuckGain` → `sysMuteGain`
  (existing) → destination. Separate nodes so mute, level and ducking never overwrite each other.
- New handle methods: `setMicLevel(percent)`, `setNoiseSuppression(on)` (`applyConstraints` on
  the live mic track; "unavailable" if no mic), `setSystemAudioVolume(percent)`,
  `setDucking(on)`.
- Ducking: an analyser on the mic *before* the mute gain. A 50 ms interval reads RMS; above a
  threshold (about -40 dBFS) ramp `sysDuckGain` to 0.3 over 80 ms; after 400 ms below it, ramp
  back to 1 over 300 ms. A muted mic never ducks. Pure decision logic in its own module
  (`ducking.ts`) so it is unit-tested without Web Audio.
- `readMicLevels()`: 5 bars from the mic analyser only (the meter in the popover is the mic,
  not the mix).

## Live forwarding (`recorder-store.ts`)

`forwardLiveSettings` already forwards `RecordingSettings`. Add a subscription to
`window.electronAPI.onSettingsChanged` that forwards changes in `AppSettings.audio` to the four
new handle methods, serialized on the same queue. The device is never switched mid-take.

## UI

New feature folder `renderer/src/features/audio-settings/`, mirroring `camera-settings/`:

- A generic split tile. Prefer extracting the shared shell of `CameraToggleSplit` (body +
  chevron, data-attributes, CSS) into a reusable `ToggleSplit` taking icon, label and chevron
  label, and making `CameraToggleSplit` a thin wrapper, over copying the CSS twice. The
  camera's tests must still pass unchanged.
- Popover / drawer containers: reuse the camera's positioning, outside-press and focus code
  (`useSettingsFocus`) — extract to a shared place rather than duplicate.
- `MicSettingsContent`: header (Mic icon, "Microphone", "● LIVE" while recording), INPUT
  radiogroup, INPUT LEVEL slider (`role="slider"`, ←/→ by 5, Shift by 25, value text "70%"),
  noise switch (`role="switch"`), live note while recording (`aria-live="polite"`).
- `SystemAudioSettingsContent`: header, WHAT TO CAPTURE segmented radiogroup (One app
  disabled with its reason), VOLUME IN THE RECORDING slider, "Lower it while I talk" switch
  (disabled with a hint when the mic is off: there is no voice to duck under).
- Pre-take level meter: while the mic popover/drawer is open and the mic toggle is on and not
  recording, open the selected device with `getUserMedia` for metering only and release it on
  close (`useMicLevelMeter`). During a take, read levels from the engine via the existing
  activity broadcast (add `micLevels` next to `levels`).
- `RecordingToggles` gains `micSlot` / `audioSlot`, like `cameraSlot`.
- Record page and capture panel: wire the slots, drawers under the row (only one drawer open at
  a time in the panel: opening one closes the others), remove `MicPicker` usage. Delete
  `MicPicker` and its CSS if nothing else uses it.
- i18n: new `micSettings` and `systemAudioSettings` namespaces in `packages/i18n/messages/en.json`
  and `es.json` (neutral Spanish). Copy from the design:

| EN | ES |
| --- | --- |
| Microphone | Micrófono |
| Input | Entrada |
| Input level | Nivel de entrada |
| Reduce background noise | Reducir el ruido de fondo |
| Fans, keyboard and street noise | Ventiladores, teclado y ruido de la calle |
| Disconnected | Desconectado |
| Live | En vivo |
| Level and noise apply live. Switching the device is locked until you stop. | El nivel y el ruido se aplican en vivo. El dispositivo queda bloqueado hasta que detengas. |
| System audio | Audio del sistema |
| What to capture | Qué capturar |
| All sound | Todo el sonido |
| One app | Una app |
| Not available yet | Todavía no disponible |
| Volume in the recording | Volumen en la grabación |
| Lower it while I talk | Bajarlo mientras hablo |
| Keeps your voice on top | Mantiene tu voz por encima |
| Turn on the microphone to use this | Activa el micrófono para usarlo |

## Tasks (TDD each)

1. `shared/audio-settings.ts` + `AppSettings.audio` + `mergeSettings` + tests.
2. `ducking.ts` pure decision logic + tests.
3. Engine: gain chain, noise constraint, new handle methods, ducking loop, mic-only levels +
   tests (extend `recorder-engine` tests with the existing Web Audio fakes).
4. Store: pass `audio` at start, forward live app-setting changes, `micLevels` in activity +
   tests.
5. Extract `ToggleSplit` and the popover/drawer shell from camera-settings; camera tests green.
6. Mic settings content + `useMicLevelMeter` + tests.
7. System audio settings content + tests.
8. Wire Record page and capture panel, remove `MicPicker`; update their tests; i18n.
9. Docs: backlog doc status, `desktop/recording-pipeline.mdx` audio-graph paragraph.

Verification per task: `bun run --filter kaipu-record test` for touched files, `tsc` for the app,
`oxfmt --check` with the main checkout's pinned binary. No local Playwright E2E.
