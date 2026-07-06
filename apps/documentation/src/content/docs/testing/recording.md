---
title: "Testing: Recording flow"
description: "How the Record page and start/stop capture flow is built, and why only its options UI is headless-testable."
---

# Recording flow

## The flow

The Record page is the index route (`#/` → `RecordPage`). The user journey has two
sub-parts:

**(a) Configure options.** The user picks _what_ to record and _which inputs_ to mix:

- A **source** — a screen or a window — chosen through the "Select a Screen or
  Window" picker modal (`SourceCard` → opens `ScreenSourceSelector`).
- Three capture **toggles** — _Mic_, _Audio_ (system/loopback audio), _Camera_
  (`RecordingToggles`).
- When _Mic_ is on, a **microphone device dropdown** (`MicPicker`) to choose the
  input device; when _Camera_ is on, a floating camera bubble follows.
- Permission notices (`PermissionNotice`) appear inline when mic/camera/screen
  access is off.

**(b) Start → record → stop.** The user clicks **Start Recording** (`RecordButton`,
disabled until a source is selected). A 3-2-1 `CountdownOverlay` plays, the main
window hides, capture begins, and a floating **control bar** appears over the
recorded screen. The user pauses/resumes/stops from either the on-page controls or
the bar. On Stop the clip is finalized to the vault, the main window returns, and the
app navigates to the new recording's detail page in the library.

## Under the hood

### Renderer: RecordPage + state

- `RecordPage` (`src/renderer/src/pages/record/record-page.tsx:20`) is composition
  only — it wires hooks to dumb components and locks the setup controls (`inert`)
  while recording (`record-page.tsx:95`).
- `useRecordingSetup` (`src/renderer/src/features/recording/hooks/use-recording-setup.ts:65`)
  is the container: source, toggles, mic selection, and the start/stop callbacks.
  `canStartRecording` gates Start on `selectedSource && status === "idle"`
  (`use-recording-setup.ts:179`).
- Options state (source, toggles, selected mic) is **shared across windows** via the
  main process — `useRecordingSettings`
  (`src/renderer/src/features/recording/hooks/use-recording-settings.ts:22`) queries
  `getRecordingSettings()` on mount, subscribes to `onRecordingSettingsChanged`, and
  writes optimistically through `updateRecordingSettings`. The hub is the source of
  truth (`recording-hub.ts:76`-`111`).
- The recording lifecycle itself lives in a **module singleton**, not React state:
  `recorder-store.ts` owns the countdown, the mediabunny engine handle, the disk
  session, and the tick timer, so it survives navigation/remount
  (`recorder-store.ts:46`-`68`). Consumed via `useSyncExternalStore`
  (`use-screen-recorder.ts`). `requestStartRecording` runs the countdown then calls
  `beginEngine` (`recorder-store.ts:117`, `:154`); `stopRecording` finalizes
  (`:244`).

### Native touchpoints (none work headless)

- **Source enumeration** — `desktopCapturer.getSources({types:["screen","window"]})`
  in the main process (`src/main/recording-sources.ts:13`), exposed as the
  `recording:get-screen-sources` IPC handler. The renderer wraps it in
  `useScreenSources` with a blank-thumbnail retry loop
  (`hooks/use-screen-sources.ts:36`). On macOS thumbnails require the Screen
  Recording permission.
- **Stream acquisition** — `navigator.mediaDevices.getUserMedia` with Electron's
  non-standard `chromeMediaSource: "desktop"` constraints for the screen
  (`recorder-engine.ts:89`-`122`), plus a second `getUserMedia({audio:true})` for the
  mic (`:160`). System audio is bundled into the desktop call and is best-effort
  (rejects on macOS) (`:99`-`116`). Encoding is mediabunny → MP4 (H.264/AAC),
  streaming chunks to the main-process writer (`:184`-`232`).
- **Device enumeration** — `useMicrophones` opens a mic stream then
  `enumerateDevices()` to populate the `MicPicker`
  (`hooks/use-microphones.ts:9`-`44`). Needs real devices + labels.
- **OS permissions** — `systemPreferences.getMediaAccessStatus` /
  `askForMediaAccess`, plus a `desktopCapturer` "nudge" for screen recording and
  System Settings deep-links (`src/main/permissions.ts:51`-`102`), behind
  `permissions:check` / `permissions:request` / `permissions:open-settings`.
- **Multi-window orchestration** — `registerRecordingHub` (`recording-hub.ts:52`) is
  the coordinator. On `recording:start` it hides the main window, forces the Dock
  policy, and shows the `ControlBarWindow` on the recorded display
  (`recording-hub.ts:146`-`158`). The bar is a frameless transparent always-on-top
  `BrowserWindow` loaded with `?window=control-bar`
  (`control-bar-window.ts:38`-`71`). The `CameraBubbleWindow` holds the webcam via
  its own `getUserMedia` and is created/destroyed by the Camera toggle
  (`recording-hub.ts:98`-`110`).
- **IPC contract** — channels in `src/shared/types/ipc.ts:132` (`recordingCreate`,
  `recordingWrite`, `recordingFinalize`, `recordingAbort`, `recordingReportTick`,
  `recordingStart`, `recordingStop`, `controlTick`, `controlCommand`,
  `recordingCommand`, `recordingState`, `recordingSettings*`, `getScreenSources`,
  `checkPermissions`, …). Disk writes land in the vault via `RecordingWriter`
  (`recording-hub.ts:118`-`143`).

## Testability

🔴 **Not headless-testable for the full flow; 🟡 Partial (needs IPC mocking) for the
options UI.**

- **Options UI (sub-part a): 🟡 testable with stubs.** Toggling _Mic_/_Audio_/_Camera_
  updates the shared settings store (optimistic write + broadcast), the source-picker
  modal renders whatever `recording:get-screen-sources` returns, and the `MicPicker`
  renders whatever `enumerateDevices` yields. All of this is deterministic DOM/state
  **only if** the underlying source list and device list are stubbed at the
  main-process IPC boundary. Enumerating real screens/devices is non-deterministic
  and permission-gated, so an un-mocked run is not a valid test.
- **Start/stop capture (sub-part b): 🔴 not headless-testable.** `desktopCapturer`
  returns no real sources, `getUserMedia` cannot acquire screen/mic/camera streams
  without a display + permissions, and the floating control-bar and camera-bubble
  windows plus OS Screen-Recording permission cannot exist in headless CI (Linux
  `xvfb` + `--no-sandbox` still lacks native capture). A real end-to-end recording is
  a manual macOS test.

The current Playwright harness (`e2e/helpers/launch.ts`) launches the built
`out/main/index.js` with a seeded vault; it exercises library/editor/playback, which
operate on a **pre-seeded** fixture MP4 — never on live capture.

## Proposed E2E test(s)

These are only viable if `desktopCapturer.getSources` (and, for the deepest test, the
`getUserMedia`/engine boundary) are faked. Two realistic levels:

1. **Options-UI state, with a stubbed source list (🟡, recommended).**
   Mock the `recording:get-screen-sources` handler to return two fake sources
   (`{id:"screen:1", name:"Fake Display", thumbnail:"data:image/png;base64,…", type:"screen"}`
   and a `window:` entry). In Electron-Playwright this is done in the main process via
   `app.evaluate(({ ipcMain }) => { ipcMain.removeHandler("recording:get-screen-sources");
ipcMain.handle("recording:get-screen-sources", () => [...]) })` — replacing the real
   handler registered in `recording-sources.ts`. Then, from the renderer page:
   - Open the picker (`SourceCard`'s choose button → "Select a Screen or Window"
     modal), assert the stubbed tiles render under the _Screens_ / _Windows_ tabs,
     click one, and assert `SourceCard` shows its name and **Start Recording** becomes
     enabled (`canStartRecording`).
   - Toggle _Mic_/_Audio_/_Camera_ and assert the `data-active`/`ON`/`OFF` state on
     each `RecordingToggle`, and that the state round-trips through the shared settings
     store (re-read `getRecordingSettings` via `page.evaluate`).
   - To exercise the `MicPicker`, also stub `navigator.mediaDevices.enumerateDevices`
     in the renderer (`page.addInitScript`) to return fake `audioinput` devices, then
     open the dropdown and assert the labels + selection.
2. **"Start dispatches the right IPC" (🟡, boundary-level).**
   Additionally spy on / no-op the engine and writer IPCs (`recording:start`,
   `recording:create`, `recording:report-tick`) in the main process, click **Start
   Recording**, let the 3-2-1 countdown elapse, and assert the renderer emitted
   `recording:start` with the selected `sourceId`/`sourceName` (`recorder-store.ts:160`).
   This validates the wiring **up to** stream acquisition without ever capturing a
   frame — `startEngine`'s `getUserMedia` must be stubbed or it will reject/hang in CI.

Both belong in a `*.e2e.ts` file using `launchApp()`; part (1) is the high-value,
low-flake target.

## Not covered / manual

The core of the feature — a **real recording** — is out of headless reach and must be
validated manually on macOS with permissions granted:

- Actual screen/mic/camera **capture** and the encoded MP4's contents/quality.
- OS **permission** prompts and the deny → System-Settings deep-link paths
  (`permissions.ts`).
- The floating **control bar** window (positioning on the recorded display, pause/
  resume/stop, content-protection so it stays out of the recording) and the **camera
  bubble** window.
- Window orchestration side effects: main window hide/show, Dock policy re-assertion,
  multi-monitor bar placement (`recording-hub.ts:146`-`171`).
- **Saved-file verification** end-to-end (finalize → vault → appears in library →
  detail page navigation). Library listing/playback of a _pre-seeded_ clip is already
  covered by `library.e2e.ts` / `playback.e2e.ts`; what stays manual is that a live
  recording produces such a file.

This is the biggest gap in the suite: everything downstream of `getUserMedia` is
native and cannot be observed without real hardware, a display, and granted
permissions.
