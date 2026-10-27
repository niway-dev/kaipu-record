import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { IPC_CHANNELS } from "@shared/types";
import type { AppSettings } from "@shared/types";
import type { AuthError, AuthStatus } from "@shared/types/auth";
import type {
  CaptureRequestPayload,
  CaptureToastPayload,
  OpenSavedScreenshotRequest,
  OverlayState,
  QuietCaptureHandOff,
} from "@shared/types/screenshot-capture";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import type {
  ControlCommand,
  RecordingActivity,
  RecordingSettings,
  RecordingShadeState,
  RecordingTick,
  UpdateStatus,
} from "@shared/types/ipc";

// Custom Kaipu bridge. Only methods with a live main-process handler are exposed.
const kaipuApi: KaipuElectronAPI = {
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion),
  notifyReady: () => ipcRenderer.send(IPC_CHANNELS.appReady),
  getUpdateStatus: () => ipcRenderer.invoke(IPC_CHANNELS.updateGetStatus),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.updateCheck),
  onUpdateStatus: (callback) => {
    const listener = (_e: IpcRendererEvent, status: UpdateStatus): void => callback(status);
    ipcRenderer.on(IPC_CHANNELS.updateStatus, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updateStatus, listener);
  },
  installUpdate: () => ipcRenderer.send(IPC_CHANNELS.updateInstall),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch),
  onSettingsChanged: (callback) => {
    const listener = (_e: IpcRendererEvent, settings: AppSettings): void => callback(settings);
    ipcRenderer.on(IPC_CHANNELS.settingsChanged, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.settingsChanged, listener);
  },
  getAuthStatus: () => ipcRenderer.invoke(IPC_CHANNELS.authGetStatus),
  beginBrowserSignIn: (intent) => ipcRenderer.invoke(IPC_CHANNELS.authBeginBrowserSignIn, intent),
  cancelBrowserSignIn: () => ipcRenderer.invoke(IPC_CHANNELS.authCancelBrowserSignIn),
  submitSignInCode: (code) => ipcRenderer.invoke(IPC_CHANNELS.authSubmitCode, code),
  onBrowserSignInFailed: (callback) => {
    const listener = (_e: IpcRendererEvent, error: AuthError): void => callback(error);
    ipcRenderer.on(IPC_CHANNELS.authBrowserSignInFailed, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.authBrowserSignInFailed, listener);
  },
  signOut: () => ipcRenderer.invoke(IPC_CHANNELS.authSignOut),
  resendVerificationEmail: () => ipcRenderer.invoke(IPC_CHANNELS.authResendVerification),
  onAuthStatusChanged: (callback) => {
    const listener = (_e: IpcRendererEvent, status: AuthStatus): void => callback(status);
    ipcRenderer.on(IPC_CHANNELS.authStatusChanged, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.authStatusChanged, listener);
  },
  getScreenSources: (options?: { withThumbnails?: boolean }) =>
    ipcRenderer.invoke("recording:get-screen-sources", options),
  resizeCapturePanel: (height) => ipcRenderer.send("capture-panel:resize", height),
  openMainWindow: () => ipcRenderer.send("capture-panel:open-main"),
  checkPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.checkPermissions),
  requestPermission: (kind) => ipcRenderer.invoke(IPC_CHANNELS.requestPermission, kind),
  getAccessibilityStatus: () => ipcRenderer.invoke(IPC_CHANNELS.accessibilityStatus),
  requestAccessibility: () => ipcRenderer.invoke(IPC_CHANNELS.accessibilityRequest),
  openSystemSettings: (kind) => ipcRenderer.invoke(IPC_CHANNELS.openSystemSettings, kind),
  getCameraAccessStatus: () => ipcRenderer.invoke(IPC_CHANNELS.cameraAccessStatus),
  previewCameraBubbleSize: (size) => ipcRenderer.invoke(IPC_CHANNELS.cameraBubblePreviewSize, size),
  beginCameraBubbleMove: () => ipcRenderer.send(IPC_CHANNELS.cameraBubbleMoveStart),
  moveCameraBubble: (dx, dy) => ipcRenderer.send(IPC_CHANNELS.cameraBubbleMove, dx, dy),
  listLocalRecordings: () => ipcRenderer.invoke(IPC_CHANNELS.listLocalRecordings),
  renameLocalRecording: (id, title) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameLocalRecording, id, title),
  markOpenedInEditor: (id) => ipcRenderer.invoke(IPC_CHANNELS.markOpenedInEditor, id),
  listTags: () => ipcRenderer.invoke(IPC_CHANNELS.listTags),
  createTag: (name, color) => ipcRenderer.invoke(IPC_CHANNELS.createTag, name, color),
  renameTag: (id, name) => ipcRenderer.invoke(IPC_CHANNELS.renameTag, id, name),
  recolorTag: (id, color) => ipcRenderer.invoke(IPC_CHANNELS.recolorTag, id, color),
  deleteTag: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteTag, id),
  setItemTags: (itemId, tagIds) => ipcRenderer.invoke(IPC_CHANNELS.setItemTags, itemId, tagIds),
  backfillLocalRecordingMeta: (id, meta) =>
    ipcRenderer.invoke(IPC_CHANNELS.backfillLocalRecordingMeta, id, meta),
  deleteLocalRecording: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteLocalRecording, id),
  revealLocalRecording: (id) => ipcRenderer.invoke(IPC_CHANNELS.revealLocalRecording, id),
  gifSave: (bytes, meta) => ipcRenderer.invoke(IPC_CHANNELS.gifSave, bytes, meta),
  startFileDrag: (id, name) => ipcRenderer.send(IPC_CHANNELS.startFileDrag, id, name),
  setExportActive: (active) => ipcRenderer.send(IPC_CHANNELS.exportActive, active),
  onExportCommand: (callback) => {
    const listener = (_e: IpcRendererEvent, command: "cancel"): void => callback(command);
    ipcRenderer.on(IPC_CHANNELS.exportCommand, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.exportCommand, listener);
  },
  getVaultDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.getVaultDirectory),
  chooseVaultDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.chooseVaultDirectory),
  resetVaultDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.resetVaultDirectory),
  openVaultDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.openVaultDirectory),
  getStorageUsage: () => ipcRenderer.invoke(IPC_CHANNELS.getStorageUsage),
  onLibraryChanged: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on(IPC_CHANNELS.libraryChanged, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.libraryChanged, listener);
  },
  listLibraryItems: () => ipcRenderer.invoke(IPC_CHANNELS.listLibraryItems),
  refreshCloudCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.refreshCloudCatalog),
  removeLocalCopy: (id) => ipcRenderer.invoke(IPC_CHANNELS.removeLocalCopy, id),
  recordingCreate: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.recordingCreate, sessionId),
  recordingWrite: (sessionId, data, position) =>
    ipcRenderer.send(IPC_CHANNELS.recordingWrite, sessionId, data, position),
  recordingFinalize: (sessionId, meta) =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingFinalize, sessionId, meta),
  recordingAbort: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.recordingAbort, sessionId),
  recordingStat: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.recordingStat, sessionId),
  recordingReportTick: (tick) => ipcRenderer.send(IPC_CHANNELS.recordingReportTick, tick),
  recordingStart: (info) => ipcRenderer.send(IPC_CHANNELS.recordingStart, info),
  recordingStop: () => ipcRenderer.send(IPC_CHANNELS.recordingStop),
  cursorTrackStart: (sessionId, sourceId, area) =>
    ipcRenderer.invoke(IPC_CHANNELS.cursorTrackStart, sessionId, sourceId, area),
  cursorClockNow: () => ipcRenderer.invoke(IPC_CHANNELS.cursorClockNow),
  cursorTrackAnchor: (sessionId, t0MainMs, quality) =>
    ipcRenderer.send(IPC_CHANNELS.cursorTrackAnchor, sessionId, t0MainMs, quality),
  cursorTrackPause: (sessionId, atMainMs) =>
    ipcRenderer.send(IPC_CHANNELS.cursorTrackPause, sessionId, atMainMs),
  cursorTrackResume: (sessionId, atMainMs) =>
    ipcRenderer.send(IPC_CHANNELS.cursorTrackResume, sessionId, atMainMs),
  onRecordingCommand: (callback) => {
    const listener = (_e: IpcRendererEvent, command: ControlCommand): void => callback(command);
    ipcRenderer.on(IPC_CHANNELS.recordingCommand, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingCommand, listener);
  },
  onControlTick: (callback) => {
    const listener = (_e: IpcRendererEvent, tick: RecordingTick): void => callback(tick);
    ipcRenderer.on(IPC_CHANNELS.controlTick, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.controlTick, listener);
  },
  controlCommand: (command) => ipcRenderer.send(IPC_CHANNELS.controlCommand, command),
  getRecordingState: () => ipcRenderer.invoke(IPC_CHANNELS.recordingGetState),
  onRecordingState: (callback) => {
    const listener = (_e: IpcRendererEvent, state: RecordingActivity): void => callback(state);
    ipcRenderer.on(IPC_CHANNELS.recordingState, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingState, listener);
  },
  getRecordingSettings: () => ipcRenderer.invoke(IPC_CHANNELS.recordingSettingsGet),
  updateRecordingSettings: (patch) => ipcRenderer.send(IPC_CHANNELS.recordingSettingsUpdate, patch),
  onRecordingSettingsChanged: (callback) => {
    const listener = (_e: IpcRendererEvent, settings: RecordingSettings): void =>
      callback(settings);
    ipcRenderer.on(IPC_CHANNELS.recordingSettingsChanged, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingSettingsChanged, listener);
  },
  requestStartRecording: () => ipcRenderer.send(IPC_CHANNELS.recordingRequestStart),
  requestCaptureScreenshot: (mode) =>
    ipcRenderer.send(IPC_CHANNELS.screenshotRequestCapture, { mode }),
  requestRecordSelector: (mode) =>
    ipcRenderer.send(IPC_CHANNELS.recordingRequestSelector, mode ? { mode } : {}),
  reportRecorderPhase: (report) => ipcRenderer.send(IPC_CHANNELS.recordingRecorderPhase, report),
  waitForCountdownVisible: () => ipcRenderer.invoke(IPC_CHANNELS.recordingCountdownVisible),
  reportRecordTiming: (label, kind) => ipcRenderer.send(IPC_CHANNELS.recordingTiming, label, kind),
  onRecordingShadeState: (callback) => {
    const listener = (_e: IpcRendererEvent, state: RecordingShadeState): void => callback(state);
    ipcRenderer.on(IPC_CHANNELS.recordingShadeState, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingShadeState, listener);
  },
  getShortcutStatus: () => ipcRenderer.invoke(IPC_CHANNELS.shortcutsGetStatus),
  suspendShortcuts: () => ipcRenderer.send(IPC_CHANNELS.shortcutsSuspend),
  resumeShortcuts: () => ipcRenderer.send(IPC_CHANNELS.shortcutsResume),
  onRequestStartRecording: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on(IPC_CHANNELS.recordingRequestStart, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingRequestStart, listener);
  },
  requestChooseSource: () => ipcRenderer.send(IPC_CHANNELS.recordingRequestSourcePicker),
  onRequestChooseSource: (callback) => {
    const listener = (_e: IpcRendererEvent, request?: { startOnPick?: boolean }): void =>
      callback({ startOnPick: request?.startOnPick === true });
    ipcRenderer.on(IPC_CHANNELS.recordingRequestSourcePicker, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingRequestSourcePicker, listener);
  },
  reportException: (payload, origin, context) =>
    ipcRenderer.send(IPC_CHANNELS.analyticsCaptureException, payload, origin, context),
  saveVideoEditSession: (id, sessionJson, assets, exported) =>
    ipcRenderer.invoke(IPC_CHANNELS.videoEditSaveSession, id, sessionJson, assets, exported),
  loadVideoEditSession: (id) => ipcRenderer.invoke(IPC_CHANNELS.videoEditLoadSession, id),
  loadCursorTrack: (id) => ipcRenderer.invoke(IPC_CHANNELS.loadCursorTrack, id),
  captureScreenshot: (mode, intent) =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotCapture, intent ? { mode, intent } : { mode }),
  screenshotSupportedModes: () => ipcRenderer.invoke(IPC_CHANNELS.screenshotSupportedModes),
  revealAfterCapture: () => ipcRenderer.send(IPC_CHANNELS.screenshotReveal),
  captureOverlay: {
    answer: (answer) => ipcRenderer.send(IPC_CHANNELS.screenshotOverlayAnswer, answer),
    hover: (displayId) => ipcRenderer.send(IPC_CHANNELS.screenshotOverlayHover, { displayId }),
    chooseFrameDisplay: (displayId) =>
      ipcRenderer.send(IPC_CHANNELS.screenshotOverlayFrameDisplay, { displayId }),
    setMode: (mode) => ipcRenderer.send(IPC_CHANNELS.screenshotOverlayMode, { mode }),
    setIntent: (intent) => ipcRenderer.send(IPC_CHANNELS.screenshotOverlayIntent, { intent }),
    onState: (callback) => {
      const listener = (_e: IpcRendererEvent, state: OverlayState): void => callback(state);
      ipcRenderer.on(IPC_CHANNELS.screenshotOverlayState, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.screenshotOverlayState, listener);
    },
    onHiddenAckRequest: (callback) => {
      const listener = (): void => callback();
      ipcRenderer.on(IPC_CHANNELS.screenshotOverlayHiddenAck, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.screenshotOverlayHiddenAck, listener);
    },
    hiddenAck: () => ipcRenderer.send(IPC_CHANNELS.screenshotOverlayHiddenAck),
  },
  captureToast: {
    onShow: (callback) => {
      const listener = (_e: IpcRendererEvent, payload: CaptureToastPayload): void =>
        callback(payload);
      ipcRenderer.on(IPC_CHANNELS.screenshotToastShow, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.screenshotToastShow, listener);
    },
    ready: () => ipcRenderer.send(IPC_CHANNELS.screenshotToastReady),
    action: (action) => ipcRenderer.send(IPC_CHANNELS.screenshotToastAction, { action }),
    hover: (paused) => ipcRenderer.send(IPC_CHANNELS.screenshotToastHover, { paused }),
  },
  onOpenSavedScreenshot: (callback) => {
    const listener = (_e: IpcRendererEvent, request: OpenSavedScreenshotRequest): void =>
      callback(request);
    ipcRenderer.on(IPC_CHANNELS.screenshotOpenSaved, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.screenshotOpenSaved, listener);
  },
  onOpenQuietCapture: (callback) => {
    const listener = (_e: IpcRendererEvent, capture: QuietCaptureHandOff): void =>
      callback(capture);
    ipcRenderer.on(IPC_CHANNELS.screenshotOpenQuietCapture, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.screenshotOpenQuietCapture, listener);
  },
  applyWindowPreset: (preset) => ipcRenderer.send(IPC_CHANNELS.windowApplyPreset, preset),
  setTrayMode: (mode) => ipcRenderer.send(IPC_CHANNELS.traySetMode, mode),
  setOnboardingWindowMode: (active) =>
    ipcRenderer.send(IPC_CHANNELS.windowSetOnboardingMode, active),
  copyImageToClipboard: (png) => ipcRenderer.invoke(IPC_CHANNELS.screenshotCopy, png),
  copyScreenshotById: (id) => ipcRenderer.invoke(IPC_CHANNELS.screenshotCopyById, id),
  readScreenshotBytes: (id) => ipcRenderer.invoke(IPC_CHANNELS.screenshotReadBytes, id),
  readClipboardImage: () => ipcRenderer.invoke(IPC_CHANNELS.clipboardReadImage),
  peekClipboardImage: () => ipcRenderer.invoke(IPC_CHANNELS.clipboardPeekImage),
  saveScreenshot: (png, meta) => ipcRenderer.invoke(IPC_CHANNELS.screenshotSave, png, meta),
  exportScreenshotFile: (bytes, meta) =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotExportFile, bytes, meta),
  onCaptureScreenshotHotkey: (callback) => {
    const listener = (_event: unknown, request: CaptureRequestPayload): void => callback(request);
    ipcRenderer.on(IPC_CHANNELS.screenshotHotkey, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.screenshotHotkey, listener);
  },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("electronAPI", kaipuApi);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.electronAPI = kaipuApi;
}
