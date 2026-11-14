import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import type { TrackKey } from "@shared/editor-settings";

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
} as const;

// Vitest does not expose `afterEach` as a global (globals: false), so
// React Testing Library's automatic cleanup never registers. Do it here
// to unmount rendered trees between tests.
afterEach(() => {
  cleanup();
});

// jsdom's `document.hasFocus()` is false until something is focused; a real window has focus.
// Tests of the unfocused case spy on it.
document.hasFocus = () => true;

// Minimal `window.electronAPI` stub so renderer code that talks to the preload
// bridge (e.g. usePermissions) works under jsdom. Individual tests can override.
window.electronAPI = {
  nativeCapture: {
    capability: async () => ({ transportAvailable: false, recordingReady: false, reason: "test" }),
    open: async () => {
      throw new Error("Native transport unavailable");
    },
    next: async () => null,
    begin: async () => {},
    pause: async () => {},
    resume: async () => {},
    stop: async () => {},
    cancel: async () => {},
  },
  flagOverrides: {},
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
  openCaptureSetup: () => {},
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
  // Echoes the title back with the file untouched; tests that care about the move override it.
  renameLocalRecording: async (id, assetId, title) => ({
    file: "unchanged" as const,
    recording: {
      id,
      assetId,
      kind: "recording" as const,
      title,
      filePath: `/vault/${id}.mp4`,
      createdAt: 0,
      sizeBytes: 0,
      durationSeconds: 0,
      derivedFromAssetId: null,
      sourceVideoAssetId: null,
      sourceTimeSeconds: null,
      contentSha256: null,
    },
  }),
  markOpenedInEditor: async () => {},
  acquireEditorSession: async () => null,
  closeEditorSession: () => {},
  listTags: async () => [],
  createTag: async (name) => ({
    id: `tag-${name}`,
    name,
    slug: name.toLowerCase(),
    color: "rose",
    count: 0,
  }),
  renameTag: async () => {},
  recolorTag: async () => {},
  deleteTag: async () => undefined,
  setItemTags: async (_itemId, tagIds) => [...tagIds],
  backfillLocalRecordingMeta: async () => null,
  deleteLocalRecording: async () => {},
  revealLocalRecording: async () => {},
  openLocalRecording: async () => {},
  localRecordingPath: async () => null,
  gifSave: async () => {
    throw new Error("gifSave not stubbed in this test");
  },
  startFileDrag: () => {},
  importVideos: async () => ({ imported: [], failed: [], canceled: true }),
  importVideoFiles: async () => ({ imported: [], failed: [], canceled: false }),
  pathForFile: () => "",
  setExportActive: () => {},
  beginExport: async () => {},
  onExportCommand: () => () => {},
  settingsScope: {
    getScoped: async (scope) => ({
      scope,
      all: STUB_SETTINGS,
      overrides: {},
      effective: STUB_SETTINGS,
      folder: "none",
      pending: null,
      folderSha256: null,
      overriddenIn: {},
    }),
    setOverride: async () => ({ ok: true, settings: STUB_SETTINGS }),
    resetOverrides: async () => ({ ok: true, settings: STUB_SETTINGS }),
    copyToAll: async () => ({ ok: true, settings: STUB_SETTINGS, keptOwn: [] }),
    resolvePending: async () => ({ ok: true, settings: STUB_SETTINGS }),
  },
  workspaces: {
    activeId: () => null,
    list: async () => ({
      activeId: "ws-default",
      generation: 1,
      hintDismissed: true,
      busy: null,
      readOnly: false,
      workspaces: [
        {
          id: "ws-default",
          name: "Default workspace",
          color: "rose",
          initials: "DW",
          path: "/tmp/vault",
          volume: null,
          state: "available",
          itemCount: 0,
          device: "1",
        },
      ],
    }),
    add: async () => ({ ok: false, reason: "cancelled" }),
    create: async () => ({ ok: false, reason: "not-writable" }),
    checkLocation: async () => ({ path: null, state: "parent-missing" }),
    edit: async () => ({ ok: false, reason: "unknown" }),
    relocate: async () => ({ ok: false, reason: "cancelled" }),
    switch: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
    openFolder: async () => {},
    dismissHint: async () => {},
    moveItems: async (request) => ({
      targetId: request.targetId,
      moved: [],
      failed: [],
      skipped: [],
    }),
    cancelMove: async () => {},
    onMoveProgress: () => () => {},
    onChanged: () => () => {},
    onPrepare: () => () => {},
  },
  getStorageUsage: async () => ({ kind: "signed-out" }),
  onLibraryChanged: () => () => {},
  reconcileScan: async () => ({ status: "ok", findings: [], fixableCount: 0, listedSignature: "" }),
  reconcileFix: async () => ({ status: "cancelled" }),
  reconcileCancel: async () => {},
  onReconcileProgress: () => () => {},
  onLibraryMaintenanceEnded: () => () => {},
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
  recordingWebcamEnded: async () => {},
  recordingWebcamTrackSupported: async () => true,
  recordingReportTick: () => {},
  recordingReportMicLevels: () => {},
  getMicLevelsListening: async () => false,
  onMicLevelsListening: () => () => {},
  subscribeMicLevels: () => () => {},
  recordingStart: () => {},
  recordingHideMainWindow: async () => false,
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
    bringToFront: true,
    captureScreenshot: true,
    captureWindow: true,
    captureInstant: true,
  }),
  suspendShortcuts: () => {},
  resumeShortcuts: () => {},
  reportException: () => {},
  captureScreenshot: async () => ({ kind: "cancelled" }),
  screenshotSupportedModes: async () => ["frame", "window", "screen"],
  revealAfterCapture: () => {},
  reportCaptureWhileRecording: () => {},
  reportImageText: () => {},
  captureOverlay: {
    answer: () => {},
    hover: () => {},
    chooseFrameDisplay: () => {},
    setMode: () => {},
    setIntent: () => {},
    onState: () => () => {},
    onHiddenAckRequest: () => () => {},
    hiddenAck: () => {},
    requestState: () => {},
  },
  captureToast: {
    onShow: () => () => {},
    ready: () => {},
    action: () => {},
    hover: () => {},
    onTimer: () => () => {},
  },
  // No floating window in tests unless one asks for it: the page keeps its in-app card.
  showRecordingReady: async () => false,
  recordingReadyCard: {
    onShow: () => () => {},
    ready: () => {},
    action: () => {},
    resize: () => {},
    hover: () => {},
    onTimer: () => () => {},
  },
  onRecordingReadyOpen: () => () => {},
  onOpenSavedScreenshot: () => () => {},
  onOpenQuietCapture: () => () => {},
  applyWindowPreset: () => {},
  setOnboardingWindowMode: () => {},
  copyImageToClipboard: async () => {},
  copyScreenshotById: async () => {},
  readScreenshotBytes: async () => new ArrayBuffer(0),
  readScreenshotCanvas: async () => null,
  statScreenshotCanvas: async () => null,
  recognizeScreenshotText: async () => ({ status: "unavailable" as const }),
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
