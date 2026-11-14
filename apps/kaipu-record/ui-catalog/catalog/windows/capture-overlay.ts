import { catalog, type Step } from "../../types";
import { nc } from "../not-capturable";

// Every pick here ends with Escape (cancelled). The capture widget (ADR 0056) is one toolbar
// docked to the work area; the states below show it per intent, with the box low, in Screen
// mode, after a key toggle and while it counts down.

const cancel: Step = { action: "cancelPick" };
// The countdown state needs a count long enough to be seen, and puts the setting back.
const COUNTDOWN_SECONDS = 5;
const record = (mode: string): Step => ({
  call: "requestRecordSelector",
  args: [mode],
  on: "main",
});
const screenshot = (mode: string): Step => ({
  call: "requestCaptureScreenshot",
  args: [mode],
  on: "main",
});

/**
 * The selector overlay (`?window=capture-overlay`), drawn over the display before a capture
 * or a take. What follows it, the system screenshot selector (ADR 0022), is native and not
 * in the images. Opened the way the Record and Screenshots pages open it; Escape cancels.
 */
export const captureOverlay = catalog(
  "captureOverlay",
  {
    "screenshot-frame": {
      profile: "recording",
      steps: [screenshot("frame"), { waitFor: { window: "capture-overlay" } }],
      demonstrates: [
        "captureOverlay.frameBox:screenshot",
        "captureOverlay.captureWidget:screenshot",
      ],
      ready: { area: "captureOverlay.captureWidget" },
      after: [cancel],
    },
    "record-frame": {
      profile: "recording",
      steps: [record("frame"), { waitFor: { window: "capture-overlay" } }],
      demonstrates: ["captureOverlay.frameBox:record", "captureOverlay.captureWidget:record"],
      ready: { area: "captureOverlay.captureWidget" },
      gates: [
        { recordingSetting: "isMicrophoneEnabled", side: "on" },
        { recordingSetting: "isSystemAudioEnabled", side: "off" },
        { recordingSetting: "isCameraEnabled", side: "off" },
      ],
      after: [cancel],
    },
    "record-frame-inputs": {
      profile: "recording",
      how: "Turn off the mic and turn on system audio, then open the overlay to record a frame.",
      steps: [
        {
          call: "updateRecordingSettings",
          args: [{ isMicrophoneEnabled: false, isSystemAudioEnabled: true }],
          on: "main",
        },
        record("frame"),
        { waitFor: { window: "capture-overlay" } },
      ],
      demonstrates: ["captureOverlay.captureWidget:record"],
      ready: { area: "captureOverlay.captureWidget" },
      gates: [
        { recordingSetting: "isMicrophoneEnabled", side: "off" },
        { recordingSetting: "isSystemAudioEnabled", side: "on" },
      ],
      after: [cancel],
    },
    "record-frame-camera": {
      profile: "recording",
      embedsScreen: true,
      steps: [
        { call: "updateRecordingSettings", args: [{ isCameraEnabled: true }], on: "main" },
        record("frame"),
        { waitFor: { window: "capture-overlay" } },
      ],
      demonstrates: ["captureOverlay.captureWidget:record"],
      ready: { area: "captureOverlay.captureWidget" },
      gates: [{ recordingSetting: "isCameraEnabled", side: "on" }],
      requires: { camera: true },
      after: [cancel],
    },
    "record-ratio": {
      profile: "recording",
      steps: [
        record("frame"),
        { waitFor: { window: "capture-overlay" } },
        {
          click: { area: "captureOverlay.captureWidget", part: { text: "16:9", exact: true } },
        },
      ],
      demonstrates: ["captureOverlay.captureWidget:record"],
      ready: { area: "captureOverlay.captureWidget" },
      after: [cancel],
    },
    "frame-at-bottom": {
      profile: "recording",
      how: "Open the overlay on a frame and drag the box down until it reaches the bottom of the work area: the widget jumps to the top.",
      steps: [
        screenshot("frame"),
        { waitFor: { window: "capture-overlay" } },
        {
          drag: { area: "captureOverlay.frameBox" },
          from: { x: 0.5, y: 0.1 },
          to: { x: 0.5, y: 0.95 },
        },
      ],
      demonstrates: ["captureOverlay.captureWidget:boxAtBottom"],
      ready: { area: "captureOverlay.captureWidget" },
      after: [cancel],
    },
    "record-key-toast": {
      profile: "recording",
      how: "Open the overlay to record and press M: the widget toasts the new microphone state for 1.5 s.",
      steps: [
        record("frame"),
        { waitFor: { window: "capture-overlay" } },
        { waitMs: 500 },
        // On the overlay: without `on` the key goes to the main window and nothing toasts.
        { press: "m", on: "capture-overlay" },
        { waitFor: { area: "captureOverlay.captureWidget", part: { role: "status" } } },
      ],
      demonstrates: ["captureOverlay.captureWidget:keyToast"],
      ready: { area: "captureOverlay.captureWidget" },
      after: [cancel],
    },
    "record-counting": {
      profile: "recording",
      how: "Open the overlay to record and press Record: the widget counts down in place and Esc cancels the count.",
      steps: [
        {
          call: "updateSettings",
          args: [{ recordingCountdownSeconds: COUNTDOWN_SECONDS }],
          on: "main",
        },
        record("frame"),
        { waitFor: { window: "capture-overlay" } },
        // Enter, not a click on "Record": a role match by name also finds the "Recording" chip.
        { waitMs: 500 },
        { press: "Enter", on: "capture-overlay" },
        { waitFor: { area: "captureOverlay.captureWidget", part: { text: "Starting in" } } },
      ],
      demonstrates: ["captureOverlay.captureWidget:counting"],
      ready: { area: "captureOverlay.captureWidget" },
      // The first Escape only ends the count, so it is a bare key press: `cancel` would wait
      // for the overlay to close and time out. The second Escape closes the overlay.
      after: [
        { press: "Escape", on: "capture-overlay" },
        cancel,
        { call: "updateSettings", args: [{ recordingCountdownSeconds: 3 }], on: "main" },
      ],
    },
    "screen-mode": {
      profile: "recording",
      how: "Open the overlay on Screen: each display shows its badge and the widget at the bottom.",
      steps: [screenshot("screen"), { waitFor: { window: "capture-overlay" } }],
      demonstrates: ["captureOverlay.captureWidget:screen", "captureOverlay.screenCard:default"],
      ready: { area: "captureOverlay.captureWidget" },
      after: [cancel],
    },
  },
  {
    notCapturable: {
      "captureOverlay.windowPicker:noWindow": nc(
        "platform",
        "Window mode on macOS is the system selector (ADR 0022); the picker is drawn on Windows only",
      ),
      "captureOverlay.windowPicker:hovered": nc(
        "platform",
        "Window mode on macOS is the system selector (ADR 0022); the picker is drawn on Windows only",
      ),
      "captureOverlay.screenCard:highlighted": nc(
        "needsSetup",
        "the card takes its highlight from the pointer's display, which main reports back; no catalog step moves the real pointer onto the display",
      ),
    },
  },
);
