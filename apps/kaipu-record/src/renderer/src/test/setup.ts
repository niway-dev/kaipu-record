import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest does not expose `afterEach` as a global (globals: false), so
// React Testing Library's automatic cleanup never registers. Do it here
// to unmount rendered trees between tests.
afterEach(() => {
  cleanup();
});

// Minimal `window.electronAPI` stub so renderer code that talks to the preload
// bridge (e.g. usePermissions) works under jsdom. Individual tests can override.
window.electronAPI = {
  getScreenSources: async () => [],
  resizeCapturePanel: () => {},
  openMainWindow: () => {},
  checkPermissions: async () => ({ screen: true, microphone: true, camera: true }),
  requestPermission: async () => true,
  openSystemSettings: async () => {},
  listLocalRecordings: async () => [],
  renameLocalRecording: async () => {},
  deleteLocalRecording: async () => {},
  revealLocalRecording: async () => {},
  getVaultDirectory: async () => ({ path: "/tmp/vault", isCustom: false }),
  chooseVaultDirectory: async () => null,
  resetVaultDirectory: async () => ({ path: "/tmp/vault", isCustom: false }),
  recordingCreate: async () => ({ tempPath: "/tmp/session" }),
  recordingWrite: () => {},
  recordingFinalize: async () => {
    throw new Error("not implemented in test stub");
  },
  recordingAbort: async () => {},
  recordingReportTick: () => {},
  recordingStart: () => {},
  recordingStop: () => {},
  onRecordingCommand: () => () => {},
  onControlTick: () => () => {},
  controlCommand: () => {},
  getRecordingState: async () => ({ active: false, status: "recording" }),
  onRecordingState: () => () => {},
};
