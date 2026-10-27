import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Testing Library's default `findBy*` timeout is 1000 ms, which is this suite's
// own CPU budget rather than a property of the product: under `turbo run test`
// the renderer's 194 files compete with every other package's suite, and the
// editor's heaviest assertions landed at 1016 ms and 1106 ms — failing by
// milliseconds while passing in isolation. A slow machine or one more parallel
// task should not read as a broken editor.
//
// It must stay WELL BELOW vitest's `testTimeout` (20 s, in vitest.config.ts):
// set to the same value, a waiting `findBy*` eats the whole test budget and the
// run dies with "Test timed out" instead of Testing Library's own message
// naming the element it could not find — the useful error replaced by a
// useless one.
//
// 10 s is deliberately generous rather than "a bit more than last time". These
// assertions were observed at 1016 ms, 1106 ms and 3199 ms on the same machine,
// depending only on what else turbo was running; a ceiling that tracks the
// worst observed value just gets raised again on a busier day. It costs nothing
// when the element shows up, which is every passing run.
configure({ asyncUtilTimeout: 10_000 });

// Component tests render without the <I18nProvider>, so stub the i18n hooks and
// pass children through. `useTranslations` resolves keys against the real English
// catalog using the real translator (including rich links); unknown keys fall back to the
// namespaced key. Config helpers stay real.
vi.mock("@kaipu/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kaipu/i18n")>();
  const { default: en } = await import("@kaipu/i18n/messages/en");
  return {
    ...actual,
    I18nProvider: ({ children }: { children: unknown }) => children,
    useTranslations: (namespace?: keyof typeof en) =>
      actual.createTranslator({
        locale: "en",
        messages: en,
        namespace,
        getMessageFallback: ({ namespace, key }) => (namespace ? `${namespace}.${key}` : key),
      }),
    useLocale: () => "en",
    useSetLocale: () => () => {},
  };
});
import { DEFAULT_QUALITY } from "@shared/recording-quality";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";

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
  showBrandBadge: false,
  screenshotCopy: "auto",
  shortcuts: defaultShortcutsFor("darwin"),
  deviceId: "",
  uploadMode: "local-only",
  exportQuality: "balanced",
  showRecordingSavedCard: true,
  screenshotFrame: {},
  recordingArea: {},
  recordingMode: "screen",
  screenshotMode: "frame",
  trayHintShown: false,
  diagnosticsEnabled: true,
  cameraBubble: { shape: "circle", size: 240, deviceId: null },
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
  platform: "darwin",
  getAppVersion: async () => "1.0.0",
  notifyReady: () => {},
  getUpdateStatus: async () => ({ state: "idle" }),
  checkForUpdates: async () => ({ state: "idle" }) as const,
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
  getAccessibilityStatus: async () => "not-required" as const,
  requestAccessibility: async () => "not-required" as const,
  openSystemSettings: async () => {},
  getCameraAccessStatus: async () => "granted" as const,
  previewCameraBubbleSize: async (size: number) => size,
  beginCameraBubbleMove: () => {},
  moveCameraBubble: () => {},
  listLocalRecordings: async () => [],
  renameLocalRecording: async () => {},
  markOpenedInEditor: async () => {},
  listTags: async () => [],
  createTag: async (name) => ({
    id: `tag-${name}`,
    name,
    slug: name.toLowerCase(),
    color: "rose",
    count: 0,
  }),
  renameTag: async (id, name) => ({ id, name, slug: name.toLowerCase(), color: "rose", count: 0 }),
  recolorTag: async (id, color) => ({ id, name: id, slug: id, color, count: 0 }),
  deleteTag: async () => undefined,
  setItemTags: async (_itemId, tagIds) => [...tagIds],
  backfillLocalRecordingMeta: async () => null,
  deleteLocalRecording: async () => {},
  revealLocalRecording: async () => {},
  gifSave: async () => {
    throw new Error("gifSave not stubbed in this test");
  },
  startFileDrag: () => {},
  setExportActive: () => {},
  onExportCommand: () => () => {},
  getVaultDirectory: async () => ({ path: "/tmp/vault", isCustom: false }),
  chooseVaultDirectory: async () => null,
  resetVaultDirectory: async () => ({ path: "/tmp/vault", isCustom: false }),
  openVaultDirectory: async () => {},
  getStorageUsage: async () => ({ kind: "signed-out" }),
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
  recordingStat: async () => 0,
  recordingReportTick: () => {},
  recordingStart: () => {},
  recordingStop: () => {},
  cursorTrackStart: async () => ({ enabled: false }),
  cursorClockNow: async () => 0,
  cursorTrackAnchor: () => {},
  cursorTrackPause: () => {},
  cursorTrackResume: () => {},
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
    area: null,
  }),
  updateRecordingSettings: () => {},
  onRecordingSettingsChanged: () => () => {},
  requestStartRecording: () => {},
  onRequestStartRecording: () => () => {},
  requestChooseSource: () => {},
  onRequestChooseSource: () => () => {},
  requestCaptureScreenshot: () => {},
  requestRecordSelector: () => {},
  reportRecorderPhase: () => {},
  waitForCountdownVisible: async () => {},
  reportRecordTiming: () => {},
  onRecordingShadeState: () => () => {},
  getShortcutStatus: async () => ({
    startRecording: true,
    stopRecording: true,
    bringToFront: true,
    captureScreenshot: true,
    captureScreen: true,
    captureFrame: true,
    captureWindow: true,
    recordArea: true,
    toggleMicrophone: true,
    toggleSystemAudio: true,
    toggleCamera: true,
  }),
  suspendShortcuts: () => {},
  resumeShortcuts: () => {},
  reportException: () => {},
  captureScreenshot: async () => ({ kind: "cancelled" }),
  screenshotSupportedModes: async () => ["frame", "window", "screen"],
  revealAfterCapture: () => {},
  captureOverlay: {
    answer: () => {},
    hover: () => {},
    chooseFrameDisplay: () => {},
    setMode: () => {},
    setIntent: () => {},
    onState: () => () => {},
    onHiddenAckRequest: () => () => {},
    hiddenAck: () => {},
  },
  captureToast: {
    onShow: () => () => {},
    ready: () => {},
    action: () => {},
    hover: () => {},
  },
  onOpenSavedScreenshot: () => () => {},
  onOpenQuietCapture: () => () => {},
  applyWindowPreset: () => {},
  setTrayMode: () => {},
  setOnboardingWindowMode: () => {},
  copyImageToClipboard: async () => {},
  copyScreenshotById: async () => {},
  readScreenshotBytes: async () => new ArrayBuffer(0),
  readClipboardImage: async () => null,
  peekClipboardImage: async () => null,
  saveScreenshot: async () => {
    throw new Error("not implemented in test stub");
  },
  exportScreenshotFile: async () => null,
  onCaptureScreenshotHotkey: () => () => {},
  saveVideoEditSession: async () => {},
  loadVideoEditSession: async () => null,
  loadCursorTrack: async () => null,
  getAuthStatus: async () => ({ kind: "signed-out" }),
  beginBrowserSignIn: async () => ({ ok: true }),
  cancelBrowserSignIn: async () => {},
  submitSignInCode: async () => ({ ok: true, status: { kind: "signed-out" } }),
  onBrowserSignInFailed: () => () => {},
  signOut: async () => {},
  resendVerificationEmail: async () => ({ ok: true, sentAt: Date.now() }),
  onAuthStatusChanged: () => () => {},
};
