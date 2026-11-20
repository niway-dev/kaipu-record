import type { TrackKey } from "@shared/editor-settings";
import { DEFAULT_QUALITY } from "@shared/recording-quality";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";

/** What the stubbed `window.electronAPI.getSettings` answers in a renderer test. */
export const STUB_SETTINGS = {
  theme: "dark",
  locale: "es",
  launchAtLogin: false,
  showInDock: true,
  recordingQuality: DEFAULT_QUALITY,
  showBarInRecording: false,
  recordingCountdownSeconds: 3,
  showBrandBadge: false,
  screenshotCopy: "auto",
  screenshotAfterCapture: "preview",
  shortcuts: defaultShortcutsFor("darwin"),
  deviceId: "",
  uploadMode: "local-only",
  exportQuality: "balanced",
  showRecordingSavedCard: true,
  screenshotFrame: {},
  recordingArea: {},
  lastFrameDisplay: {},
  recordingMode: "screen",
  screenshotMode: "frame",
  trayHintShown: false,
  diagnosticsEnabled: true,
  cameraBubble: {
    shape: "circle",
    cornerRadius: 0.18,
    size: 240,
    deviceId: null,
    mirrored: true,
    framing: { enabled: false, zoom: 1, x: 0, y: 0 },
  },
  audio: {
    micLevel: 100,
    noiseSuppression: true,
    systemAudioVolume: 100,
    duckSystemAudioWhileTalking: false,
  },
  microphone: null,
  editor: { hiddenTracks: [] as TrackKey[] },
  captureWidget: { screenshotExpanded: false, recordingExpanded: false },
} as const;
