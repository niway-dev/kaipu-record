import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { IPC_CHANNELS } from "@shared/types";
import type { AppSettings } from "@shared/types";
import type { AuthStatus } from "@shared/types/auth";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import type {
  ControlCommand,
  RecordingActivity,
  RecordingSettings,
  RecordingTick,
  UpdateStatus,
} from "@shared/types/ipc";

// Custom Kaipu bridge. Only methods with a live main-process handler are exposed.
const kaipuApi: KaipuElectronAPI = {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion),
  notifyReady: () => ipcRenderer.send(IPC_CHANNELS.appReady),
  getUpdateStatus: () => ipcRenderer.invoke(IPC_CHANNELS.updateGetStatus),
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
  signIn: (credentials) => ipcRenderer.invoke(IPC_CHANNELS.authSignIn, credentials),
  signUp: (input) => ipcRenderer.invoke(IPC_CHANNELS.authSignUp, input),
  signOut: () => ipcRenderer.invoke(IPC_CHANNELS.authSignOut),
  onAuthStatusChanged: (callback) => {
    const listener = (_e: IpcRendererEvent, status: AuthStatus): void => callback(status);
    ipcRenderer.on(IPC_CHANNELS.authStatusChanged, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.authStatusChanged, listener);
  },
  getScreenSources: () => ipcRenderer.invoke("recording:get-screen-sources"),
  resizeCapturePanel: (height) => ipcRenderer.send("capture-panel:resize", height),
  openMainWindow: () => ipcRenderer.send("capture-panel:open-main"),
  checkPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.checkPermissions),
  requestPermission: (kind) => ipcRenderer.invoke(IPC_CHANNELS.requestPermission, kind),
  openSystemSettings: (kind) => ipcRenderer.invoke(IPC_CHANNELS.openSystemSettings, kind),
  listLocalRecordings: () => ipcRenderer.invoke(IPC_CHANNELS.listLocalRecordings),
  renameLocalRecording: (id, title) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameLocalRecording, id, title),
  backfillLocalRecordingMeta: (id, meta) =>
    ipcRenderer.invoke(IPC_CHANNELS.backfillLocalRecordingMeta, id, meta),
  deleteLocalRecording: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteLocalRecording, id),
  revealLocalRecording: (id) => ipcRenderer.invoke(IPC_CHANNELS.revealLocalRecording, id),
  getVaultDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.getVaultDirectory),
  chooseVaultDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.chooseVaultDirectory),
  resetVaultDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.resetVaultDirectory),
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
  recordingReportTick: (tick) => ipcRenderer.send(IPC_CHANNELS.recordingReportTick, tick),
  recordingStart: (info) => ipcRenderer.send(IPC_CHANNELS.recordingStart, info),
  recordingStop: () => ipcRenderer.send(IPC_CHANNELS.recordingStop),
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
  requestCaptureScreenshot: () => ipcRenderer.send(IPC_CHANNELS.screenshotRequestCapture),
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
    const listener = (): void => callback();
    ipcRenderer.on(IPC_CHANNELS.recordingRequestSourcePicker, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingRequestSourcePicker, listener);
  },
  reportException: (payload, origin, context) =>
    ipcRenderer.send(IPC_CHANNELS.analyticsCaptureException, payload, origin, context),
  saveVideoEditSession: (id, sessionJson, assets) =>
    ipcRenderer.invoke(IPC_CHANNELS.videoEditSaveSession, id, sessionJson, assets),
  loadVideoEditSession: (id) => ipcRenderer.invoke(IPC_CHANNELS.videoEditLoadSession, id),
  captureScreenshot: () => ipcRenderer.invoke(IPC_CHANNELS.screenshotCapture),
  revealAfterCapture: () => ipcRenderer.send(IPC_CHANNELS.screenshotReveal),
  setEditorWindowMode: (active) => ipcRenderer.send(IPC_CHANNELS.windowSetEditorMode, active),
  copyImageToClipboard: (png) => ipcRenderer.invoke(IPC_CHANNELS.screenshotCopy, png),
  copyScreenshotById: (id) => ipcRenderer.invoke(IPC_CHANNELS.screenshotCopyById, id),
  readScreenshotBytes: (id) => ipcRenderer.invoke(IPC_CHANNELS.screenshotReadBytes, id),
  saveScreenshot: (png, meta) => ipcRenderer.invoke(IPC_CHANNELS.screenshotSave, png, meta),
  onCaptureScreenshotHotkey: (callback) => {
    const listener = (): void => callback();
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
