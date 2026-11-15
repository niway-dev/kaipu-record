import { catalog, type Step } from "../../types";

const show: Step = { show: "capture-panel" };
const inputs = (patch: Record<string, boolean>): Step => ({
  call: "updateRecordingSettings",
  args: [patch],
  on: "main",
});
const take: Step[] = [{ action: "selectFirstScreen" }, { action: "startTake" }, show];

/**
 * The menu-bar popover (`?mode=capture`). Main prewarms it hidden once the main window has
 * painted; the catalog shows it without focus, as a tray click does.
 */
export const capturePanel = catalog("capturePanel", {
  idle: {
    profile: "default",
    steps: [show],
    demonstrates: [
      "capturePanel.root:idle",
      "capturePanel.header:default",
      "capturePanel.entries:default",
      "capturePanel.switches:idle",
      "capturePanel.footer:default",
    ],
    gates: [
      { recordingSetting: "isMicrophoneEnabled", side: "on" },
      { recordingSetting: "isSystemAudioEnabled", side: "off" },
      { recordingSetting: "isCameraEnabled", side: "off" },
    ],
  },
  "all-off": {
    profile: "default",
    steps: [inputs({ isMicrophoneEnabled: false }), show],
    demonstrates: ["capturePanel.switches:idle"],
    gates: [{ recordingSetting: "isMicrophoneEnabled", side: "off" }],
    after: [inputs({ isMicrophoneEnabled: true })],
  },
  "audio-on": {
    profile: "default",
    steps: [inputs({ isSystemAudioEnabled: true }), show],
    demonstrates: ["capturePanel.switches:idle"],
    gates: [{ recordingSetting: "isSystemAudioEnabled", side: "on" }],
    after: [inputs({ isSystemAudioEnabled: false })],
  },
  "camera-on": {
    profile: "default",
    steps: [inputs({ isCameraEnabled: true }), show],
    demonstrates: ["capturePanel.switches:idle"],
    gates: [{ recordingSetting: "isCameraEnabled", side: "on" }],
    requires: { camera: true },
    after: [inputs({ isCameraEnabled: false })],
  },
  recording: {
    profile: "recording",
    how: "Start a take on the first display, then show the panel: the status box and Stop replace the entries, and the switches are read-only.",
    steps: take,
    demonstrates: [
      "capturePanel.root:recording",
      "capturePanel.recordingStatus:recording",
      "capturePanel.stopButton:recording",
      "capturePanel.switches:locked",
    ],
    ready: { area: "capturePanel.recordingStatus" },
    after: [{ action: "stopTake" }],
  },
  paused: {
    profile: "recording",
    steps: [
      { action: "selectFirstScreen" },
      { action: "startTake" },
      { action: "pauseTake" },
      show,
    ],
    demonstrates: ["capturePanel.recordingStatus:paused"],
    ready: { area: "capturePanel.recordingStatus" },
    after: [{ action: "stopTake" }],
  },
  countdown: {
    profile: "recording",
    how: "Pick the first display and ask for a take; the panel is shot during its 3 s countdown, then the take is cancelled.",
    steps: [
      { action: "selectFirstScreen" },
      { action: "requestTake" },
      show,
      {
        waitFor: { area: "capturePanel.recordingStatus", part: { text: "Starting" } },
        timeoutMs: 10_000,
      },
    ],
    demonstrates: ["capturePanel.recordingStatus:starting"],
    ready: { area: "capturePanel.recordingStatus" },
    after: [{ show: "main" }, { press: "Escape", on: "main" }, { action: "stopTake" }],
  },
});
