import { catalog, type Step, type Target } from "../types";
import { nc } from "./not-capturable";

const micOff: Step = { call: "updateRecordingSettings", args: [{ isMicrophoneEnabled: false }] };
const audioOn: Step = { call: "updateRecordingSettings", args: [{ isSystemAudioEnabled: true }] };
const cameraOn: Step = { call: "updateRecordingSettings", args: [{ isCameraEnabled: true }] };
const cameraOff: Step = { call: "updateRecordingSettings", args: [{ isCameraEnabled: false }] };
// The Microphone card's right zone is named "Microphone settings: <device line>". Before the
// microphones are listed the line is blank (no suffix) and then, with an empty list, "No
// microphones found" (`micSettings.noDevices` in en.json): a real device is any other suffix.
// A hover shot waits for one so a late re-render of the device line cannot drop the pointer's
// hover after it landed. The profile runs with a fake audio input ("Fake Audio Input 1"), so
// the wait is met by that one device; a runner with no microphone times out, which is right,
// because these states `require` one.
const MIC_EMPTY_LIST = "No microphones found";
const micDevicesListed: Step = {
  waitFor: {
    area: "record.mic",
    part: {
      css: `[aria-label^="Microphone settings: "]:not([aria-label$=": ${MIC_EMPTY_LIST}"])`,
    },
  },
};
const micZoneHovered = (zone: "switch" | "button"): Target => ({
  area: "record.mic",
  part: { css: `[${zone === "switch" ? 'role="switch"' : "aria-expanded"}]:hover` },
});
const modeBack: Step = { call: "updateSettings", args: [{ recordingMode: "screen" }] };
const shotModeBack: Step = { call: "updateSettings", args: [{ screenshotMode: "frame" }] };

/**
 * The Capture page (`#/`, still the `record` screen): the two entry cards, the Instant line,
 * and the Recording setup. Recording toggles are reset to the profile's own before
 * each state.
 */
export const record = catalog(
  "record",
  {
    idle: {
      profile: "default",
      how: "Open the app; the last screenshot mode is Frame, the last recording mode is Screen, the mic is on, system audio and camera are off.",
      demonstrates: [
        "record.page:idle",
        "record.screenshotCard:frame",
        "record.recordingCard:screen",
        "record.instantLine:default",
        "record.setup:default",
        "record.mic:on",
        "record.audio:off",
        "record.camera:off",
      ],
      gates: [
        { setting: "screenshotMode", side: "frame" },
        { setting: "recordingMode", side: "screen" },
        { recordingSetting: "isMicrophoneEnabled", side: "on" },
        { recordingSetting: "isSystemAudioEnabled", side: "off" },
        { recordingSetting: "isCameraEnabled", side: "off" },
      ],
    },
    "idle@min": {
      profile: "default",
      window: "main-min",
      demonstrates: [
        "record.page:idle",
        "record.screenshotCard:frame",
        "record.recordingCard:screen",
      ],
      gates: [
        { setting: "screenshotMode", side: "frame" },
        { setting: "recordingMode", side: "screen" },
      ],
    },
    "screenshot-mode-screen": {
      profile: "default",
      steps: [{ call: "updateSettings", args: [{ screenshotMode: "screen" }] }],
      demonstrates: ["record.screenshotCard:screen"],
      gates: [{ setting: "screenshotMode", side: "screen" }],
      after: [shotModeBack],
    },
    "mode-frame": {
      profile: "default",
      steps: [{ call: "updateSettings", args: [{ recordingMode: "frame" }] }],
      demonstrates: ["record.recordingCard:frame"],
      gates: [{ setting: "recordingMode", side: "frame" }],
      after: [modeBack],
    },
    "mode-window": {
      profile: "default",
      steps: [{ call: "updateSettings", args: [{ recordingMode: "window" }] }],
      demonstrates: ["record.recordingCard:window"],
      gates: [{ setting: "recordingMode", side: "window" }],
      after: [modeBack],
    },
    "mic-off": {
      profile: "default",
      steps: [micOff],
      demonstrates: ["record.mic:off"],
      gates: [{ recordingSetting: "isMicrophoneEnabled", side: "off" }],
    },
    "mic-toggle-hover": {
      profile: "default",
      how: "Rest the pointer on the Microphone card's left zone (name and ON/OFF readout): only that zone lights up, the device zone stays as it was.",
      steps: [
        micDevicesListed,
        { hover: { area: "record.mic", part: { role: "switch", name: "Microphone" } } },
        // The zone must be under the pointer, or the shot would show the card at rest.
        { waitFor: micZoneHovered("switch") },
      ],
      keepPointer: true,
      // Still hovered when the shot is taken, or the run fails instead of keeping the image.
      stillOnScreen: micZoneHovered("switch"),
      demonstrates: ["record.mic:toggleHover"],
      gates: [
        { recordingSetting: "isMicrophoneEnabled", side: "on" },
        { permission: "microphone", side: "granted" },
      ],
      requires: { microphone: true },
    },
    "mic-device-hover": {
      profile: "default",
      how: "Rest the pointer on the Microphone card's right zone (device name and chevron): only that zone lights up, the toggle zone stays as it was.",
      steps: [
        micDevicesListed,
        { hover: { area: "record.mic", part: { role: "button", name: "Microphone settings" } } },
        { waitFor: micZoneHovered("button") },
      ],
      keepPointer: true,
      stillOnScreen: micZoneHovered("button"),
      demonstrates: ["record.mic:deviceHover"],
      gates: [
        { recordingSetting: "isMicrophoneEnabled", side: "on" },
        { permission: "microphone", side: "granted" },
      ],
      requires: { microphone: true },
    },
    "mic-settings": {
      profile: "default",
      steps: [
        { click: { area: "record.mic", part: { role: "button", name: "Microphone settings" } } },
      ],
      demonstrates: ["record.micSettings:open"],
      ready: { area: "record.micSettings" },
      gates: [
        { recordingSetting: "isMicrophoneEnabled", side: "on" },
        { permission: "microphone", side: "granted" },
      ],
      requires: { microphone: true },
    },
    "mic-settings-off": {
      profile: "default",
      steps: [
        micOff,
        { click: { area: "record.mic", part: { role: "button", name: "Microphone settings" } } },
      ],
      demonstrates: ["record.micSettings:open"],
      ready: { area: "record.micSettings" },
      gates: [{ recordingSetting: "isMicrophoneEnabled", side: "off" }],
    },
    "mic-denied": {
      profile: "default",
      demonstrates: ["record.micNotice:denied"],
      gates: [{ permission: "microphone", side: "denied" }],
      requires: { microphone: false },
    },
    "audio-on": {
      profile: "default",
      steps: [audioOn],
      demonstrates: ["record.audio:on"],
      gates: [{ recordingSetting: "isSystemAudioEnabled", side: "on" }],
    },
    "audio-settings": {
      profile: "default",
      steps: [
        audioOn,
        {
          click: { area: "record.audio", part: { role: "button", name: "System audio settings" } },
        },
      ],
      demonstrates: ["record.audioSettings:open"],
      ready: { area: "record.audioSettings" },
      gates: [{ recordingSetting: "isSystemAudioEnabled", side: "on" }],
    },
    "audio-settings-off": {
      profile: "default",
      steps: [
        {
          click: { area: "record.audio", part: { role: "button", name: "System audio settings" } },
        },
      ],
      demonstrates: ["record.audioSettings:open"],
      ready: { area: "record.audioSettings" },
      gates: [{ recordingSetting: "isSystemAudioEnabled", side: "off" }],
    },
    "camera-on": {
      profile: "default",
      embedsScreen: true,
      steps: [cameraOn],
      demonstrates: ["record.camera:on"],
      gates: [
        { recordingSetting: "isCameraEnabled", side: "on" },
        { permission: "camera", side: "granted" },
      ],
      requires: { camera: true },
      after: [cameraOff],
    },
    "camera-settings": {
      profile: "default",
      embedsScreen: true,
      steps: [
        cameraOn,
        { click: { area: "record.camera", part: { role: "button", name: "Camera settings" } } },
      ],
      demonstrates: ["record.cameraSettings:open"],
      ready: { area: "record.cameraSettings" },
      gates: [{ recordingSetting: "isCameraEnabled", side: "on" }],
      after: [cameraOff],
    },
    "camera-settings-off": {
      profile: "default",
      steps: [
        { click: { area: "record.camera", part: { role: "button", name: "Camera settings" } } },
      ],
      demonstrates: ["record.cameraSettings:open"],
      ready: { area: "record.cameraSettings" },
      gates: [{ recordingSetting: "isCameraEnabled", side: "off" }],
    },
    "camera-denied": {
      profile: "default",
      steps: [cameraOn],
      demonstrates: ["record.camera:blocked", "record.cameraNotice:denied"],
      gates: [{ permission: "camera", side: "denied" }],
      requires: { camera: false },
      after: [cameraOff],
    },
    "source-picker-empty": {
      profile: "default",
      how: "Ask main for the source picker (`requestChooseSource`); screen capture is off in this profile, so the list is empty.",
      steps: [{ call: "requestChooseSource" }],
      demonstrates: ["record.sourcePicker:empty"],
      gates: [{ permission: "screen", side: "granted" }],
    },
    "source-picker-screens": {
      profile: "recording",
      embedsScreen: true,
      steps: [{ call: "requestChooseSource" }],
      demonstrates: ["record.sourcePicker:screens"],
      gates: [{ permission: "screen", side: "granted" }],
    },
    "source-picker-windows": {
      profile: "recording",
      embedsScreen: true,
      unpublished: "shows the runner's real open windows",
      steps: [
        { call: "requestChooseSource" },
        { waitFor: { area: "record.sourcePicker" } },
        { click: { area: "record.sourcePicker", part: { text: "Windows", exact: true } } },
      ],
      demonstrates: ["record.sourcePicker:windows"],
      gates: [{ permission: "screen", side: "granted" }],
    },
    "source-picker-no-access": {
      profile: "recording",
      steps: [{ call: "requestChooseSource" }],
      demonstrates: ["record.sourcePicker:noScreenAccess"],
      gates: [{ permission: "screen", side: "denied" }],
      requires: { screen: false },
    },
    countdown: {
      profile: "recording",
      embedsScreen: true,
      how: "Pick the first display and ask for a take; shot during its 3 s countdown, then cancelled.",
      steps: [
        { action: "selectFirstScreen" },
        { action: "requestTake" },
        { show: "main" },
        { waitFor: { area: "record.countdown" }, timeoutMs: 10_000 },
      ],
      demonstrates: ["record.countdown:running"],
      gates: [{ setting: "recordingCountdownSeconds", side: "3" }],
      after: [{ press: "Escape", on: "main" }, { action: "stopTake" }],
    },
    recording: {
      profile: "recording",
      embedsScreen: true,
      how: "Pick the first display and start a take; the main window is shown again over the running take.",
      steps: [
        { action: "selectFirstScreen" },
        { action: "startTake" },
        // The recorder hides the main window once the take runs; show it after that.
        { waitMs: 1_500 },
        { show: "main" },
      ],
      demonstrates: [
        "record.page:recording",
        "record.recordingIndicator:recording",
        "record.recordingControls:recording",
        "record.screenshotCard:locked",
        "record.recordingCard:locked",
        "record.instantLine:locked",
      ],
      after: [{ action: "stopTake" }],
    },
    paused: {
      profile: "recording",
      embedsScreen: true,
      how: "Start a take as in `recording`, then pause it from the control bar's command.",
      steps: [
        { action: "selectFirstScreen" },
        { action: "startTake" },
        { action: "pauseTake" },
        { waitMs: 1_500 },
        { show: "main" },
      ],
      demonstrates: [
        "record.page:paused",
        "record.recordingIndicator:paused",
        "record.recordingControls:paused",
        "record.screenshotCard:locked",
        "record.recordingCard:locked",
        "record.instantLine:locked",
      ],
      after: [{ action: "stopTake" }],
    },
    "reconcile-fixable": {
      profile: "reconcile-fixable",
      demonstrates: ["record.reconcileBanner:fixable"],
    },
    "reconcile-attention": {
      profile: "reconcile-attention",
      demonstrates: ["record.reconcileBanner:attention"],
    },
    "workspace-not-connected": {
      profile: "disconnected",
      demonstrates: ["record.workspaceNotice:notConnected"],
    },
  },
  {
    notCapturable: {
      "record.sourcePicker:loading": nc("transient", "a transient state while sources are listed"),
      "record.audio:unavailable": nc(
        "inducedFailure",
        "only during a take whose system audio could not be captured, which the runner cannot force",
      ),
    },
    oneSided: {
      "record.countdown": "with `recordingCountdownSeconds` 0 there is no countdown to draw",
    },
  },
);
