import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Component tests render without the <I18nProvider>, so stub the i18n hooks and
// pass children through. `useTranslations` resolves keys against the real English
// catalog so assertions can match rendered copy; unknown keys fall back to the
// namespaced key. Config helpers stay real.
vi.mock("@kaipu/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kaipu/i18n")>();
  const { default: en } = await import("@kaipu/i18n/messages/en");
  const messages = en as Record<string, Record<string, string>>;
  return {
    ...actual,
    I18nProvider: ({ children }: { children: unknown }) => children,
    useTranslations: (namespace?: string) => (key: string, values?: Record<string, unknown>) => {
      const value = namespace ? messages[namespace]?.[key] : undefined;
      let str = typeof value === "string" ? value : namespace ? `${namespace}.${key}` : key;
      // Substitute simple ICU `{param}` placeholders so assertions match rendered copy.
      if (values) {
        for (const [k, v] of Object.entries(values)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return str;
    },
    useLocale: () => "en",
    useSetLocale: () => () => {},
  };
});
import { DEFAULT_QUALITY } from "@shared/recording-quality";
import { DEFAULT_SHORTCUTS } from "@shared/types";

// jsdom has no ResizeObserver; components that observe their size (the annotation
// layer) need a no-op so they can render under test.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

const STUB_SETTINGS = {
  theme: "dark",
  locale: "es",
  launchAtLogin: false,
  showInDock: true,
  recordingQuality: DEFAULT_QUALITY,
  showBarInRecording: false,
  shortcuts: DEFAULT_SHORTCUTS,
  deviceId: "",
} as const;

// Vitest does not expose `afterEach` as a global (globals: false), so
// React Testing Library's automatic cleanup never registers. Do it here
// to unmount rendered trees between tests.
afterEach(() => {
  cleanup();
});

// Minimal `window.electronAPI` stub so renderer code that talks to the preload
// bridge (e.g. usePermissions) works under jsdom. Individual tests can override.
window.electronAPI = {
  getAppVersion: async () => "1.0.0",
  notifyReady: () => {},
  getUpdateStatus: async () => ({ state: "idle" }),
  onUpdateStatus: () => () => {},
  installUpdate: () => {},
  getSettings: async () => STUB_SETTINGS,
  updateSettings: async () => STUB_SETTINGS,
  onSettingsChanged: () => () => {},
  getScreenSources: async () => [],
  resizeCapturePanel: () => {},
  openMainWindow: () => {},
  checkPermissions: async () => ({ screen: true, microphone: true, camera: true }),
  requestPermission: async () => true,
  openSystemSettings: async () => {},
  listLocalRecordings: async () => [],
  renameLocalRecording: async () => {},
  backfillLocalRecordingMeta: async () => null,
  deleteLocalRecording: async () => {},
  revealLocalRecording: async () => {},
  getVaultDirectory: async () => ({ path: "/tmp/vault", isCustom: false }),
  chooseVaultDirectory: async () => null,
  resetVaultDirectory: async () => ({ path: "/tmp/vault", isCustom: false }),
  onLibraryChanged: () => () => {},
  listLibraryItems: async () => ({ items: [], vaultError: null, catalogVerifiedAt: null }),
  refreshCloudCatalog: async () => ({ ok: false, reason: "signed-out" }),
  removeLocalCopy: async () => ({ ok: false, reason: "not-found" }),
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
  getRecordingState: async () => ({ active: false, status: "recording", elapsedSeconds: 0 }),
  onRecordingState: () => () => {},
  getRecordingSettings: async () => ({
    selectedSource: null,
    selectedMicrophone: null,
    isMicrophoneEnabled: true,
    isSystemAudioEnabled: false,
    isCameraEnabled: false,
  }),
  updateRecordingSettings: () => {},
  onRecordingSettingsChanged: () => () => {},
  requestStartRecording: () => {},
  onRequestStartRecording: () => () => {},
  requestChooseSource: () => {},
  onRequestChooseSource: () => () => {},
  requestCaptureScreenshot: () => {},
  getShortcutStatus: async () => ({
    startRecording: true,
    stopRecording: true,
    bringToFront: true,
    captureScreenshot: true,
  }),
  suspendShortcuts: () => {},
  resumeShortcuts: () => {},
  reportException: () => {},
  captureScreenshot: async () => null,
  revealAfterCapture: () => {},
  setEditorWindowMode: () => {},
  copyImageToClipboard: async () => {},
  copyScreenshotById: async () => {},
  readScreenshotBytes: async () => new ArrayBuffer(0),
  saveScreenshot: async () => {
    throw new Error("not implemented in test stub");
  },
  onCaptureScreenshotHotkey: () => () => {},
  saveVideoEditSession: async () => {},
  loadVideoEditSession: async () => null,
  getAuthStatus: async () => ({ kind: "signed-out" }),
  signIn: async () => ({ ok: true, status: { kind: "signed-out" } }),
  signUp: async () => ({ ok: true, status: { kind: "signed-out" } }),
  signOut: async () => {},
  onAuthStatusChanged: () => () => {},
};
