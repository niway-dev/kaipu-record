import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { IPC_CHANNELS } from "@shared/types";
import type { AppSettings, ReconcileProgress } from "@shared/types";
import type { AuthError, AuthStatus } from "@shared/types/auth";
import type {
  CaptureRequestPayload,
  CaptureToastPayload,
  OpenSavedScreenshotRequest,
  OverlayState,
  QuietCaptureHandOff,
} from "@shared/types/screenshot-capture";
import { WorkspaceStampGuard } from "@shared/workspace-stamp-guard";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import type { RecordingReadyHandOff, RecordingReadyPayload } from "@shared/types/recording-ready";
import {
  STALE_WORKSPACE,
  type WorkspacePrepareRequest,
  type WorkspacesState,
  type WorkspaceStamp,
} from "@shared/types/workspaces";
import type {
  ControlCommand,
  RecordingActivity,
  RecordingSettings,
  RecordingShadeView,
  RecordingTick,
  UpdateStatus,
} from "@shared/types/ipc";

// ── Workspace stamp (ADR 0032) ────────────────────────────────────────────────
// Every item-scoped call carries the stamp this window holds: main refuses it once the
// active workspace or the generation moved on. Read once, synchronously, before the page
// runs, and replaced by every `workspaces:changed`.
function readInitialStamp(): WorkspaceStamp | null {
  try {
    const value: unknown = ipcRenderer.sendSync(IPC_CHANNELS.workspacesStampSync);
    if (value && typeof value === "object" && "workspaceId" in value && "generation" in value) {
      return value as WorkspaceStamp;
    }
  } catch {
    // main not ready: every scoped call refuses until the first `workspaces:changed`
  }
  return null;
}
const guard = new WorkspaceStampGuard(readInitialStamp());
let prepareHandler: (() => Promise<boolean>) | null = null;

ipcRenderer.on(IPC_CHANNELS.workspacesChanged, (_e: IpcRendererEvent, state: WorkspacesState) => {
  guard.changed(state);
});
ipcRenderer.on(IPC_CHANNELS.workspacesPrepareAbort, () => {
  guard.abort();
});
ipcRenderer.on(
  IPC_CHANNELS.workspacesPrepare,
  (_e: IpcRendererEvent, request: WorkspacePrepareRequest) => {
    void (async () => {
      let ok = true;
      try {
        ok = prepareHandler ? await prepareHandler() : true;
      } catch (error) {
        console.error("workspace switch: preparing this window failed", error);
        ok = false;
      }
      // From here until the switch ends, nothing this window starts can reach main.
      guard.prepared(ok);
      ipcRenderer.send(IPC_CHANNELS.workspacesPrepareResult, { requestId: request.requestId, ok });
    })();
  },
);

/** An item-scoped invoke: stamped, and discarded when the answer comes back after a switch. */
async function scopedInvoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!guard.stamp && !guard.switching) {
    // The synchronous read failed: learn the stamp from the registry instead.
    const state = (await ipcRenderer.invoke(IPC_CHANNELS.workspacesList)) as WorkspacesState;
    guard.adopt({ workspaceId: state.activeId, generation: state.generation });
  }
  const sent = guard.stamp;
  if (guard.switching || !sent) throw new Error(STALE_WORKSPACE);
  const result = (await ipcRenderer.invoke(channel, sent, ...args)) as T;
  if (!guard.isCurrent(sent)) throw new Error(STALE_WORKSPACE);
  return result;
}

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
  listLocalRecordings: () => scopedInvoke(IPC_CHANNELS.listLocalRecordings),
  renameLocalRecording: (id, assetId, title) =>
    scopedInvoke(IPC_CHANNELS.renameLocalRecording, id, assetId, title),
  markOpenedInEditor: (id) => scopedInvoke(IPC_CHANNELS.markOpenedInEditor, id),
  acquireEditorSession: (assetId) => scopedInvoke(IPC_CHANNELS.editorSessionAcquire, assetId),
  closeEditorSession: (id) => ipcRenderer.send(IPC_CHANNELS.editorSessionClose, id),
  listTags: () => scopedInvoke(IPC_CHANNELS.listTags),
  createTag: (name, color) => scopedInvoke(IPC_CHANNELS.createTag, name, color),
  renameTag: (id, name) => scopedInvoke(IPC_CHANNELS.renameTag, id, name),
  recolorTag: (id, color) => scopedInvoke(IPC_CHANNELS.recolorTag, id, color),
  deleteTag: (id) => scopedInvoke(IPC_CHANNELS.deleteTag, id),
  setItemTags: (itemId, tagIds) => scopedInvoke(IPC_CHANNELS.setItemTags, itemId, tagIds),
  backfillLocalRecordingMeta: (id, meta) =>
    scopedInvoke(IPC_CHANNELS.backfillLocalRecordingMeta, id, meta),
  deleteLocalRecording: (id) => scopedInvoke(IPC_CHANNELS.deleteLocalRecording, id),
  revealLocalRecording: (id) => scopedInvoke(IPC_CHANNELS.revealLocalRecording, id),
  gifSave: (bytes, meta) => scopedInvoke(IPC_CHANNELS.gifSave, bytes, meta),
  startFileDrag: (id, name) => {
    if (guard.switching || !guard.stamp) return;
    ipcRenderer.send(IPC_CHANNELS.startFileDrag, guard.stamp, id, name);
  },
  importVideos: () => scopedInvoke(IPC_CHANNELS.importVideos),
  importVideoFiles: (paths) => scopedInvoke(IPC_CHANNELS.importVideoFiles, paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  setExportActive: (active) => ipcRenderer.send(IPC_CHANNELS.exportActive, active),
  beginExport: () => ipcRenderer.invoke(IPC_CHANNELS.exportBegin),
  onExportCommand: (callback) => {
    const listener = (_e: IpcRendererEvent, command: "cancel"): void => callback(command);
    ipcRenderer.on(IPC_CHANNELS.exportCommand, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.exportCommand, listener);
  },
  workspaces: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.workspacesList),
    activeId: () => guard.stamp?.workspaceId ?? null,
    add: () => ipcRenderer.invoke(IPC_CHANNELS.workspacesAdd),
    switch: (id) => ipcRenderer.invoke(IPC_CHANNELS.workspacesSwitch, id),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.workspacesRemove, id),
    openFolder: (id) => ipcRenderer.invoke(IPC_CHANNELS.workspacesOpenFolder, id),
    dismissHint: () => ipcRenderer.invoke(IPC_CHANNELS.workspacesDismissHint),
    onChanged: (callback) => {
      const listener = (_e: IpcRendererEvent, state: WorkspacesState): void => callback(state);
      ipcRenderer.on(IPC_CHANNELS.workspacesChanged, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.workspacesChanged, listener);
    },
    onPrepare: (handler) => {
      prepareHandler = handler;
      return () => {
        if (prepareHandler === handler) prepareHandler = null;
      };
    },
  },
  getStorageUsage: () => ipcRenderer.invoke(IPC_CHANNELS.getStorageUsage),
  onLibraryChanged: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on(IPC_CHANNELS.libraryChanged, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.libraryChanged, listener);
  },
  reconcileScan: () => scopedInvoke(IPC_CHANNELS.libraryReconcileScan),
  reconcileFix: () => scopedInvoke(IPC_CHANNELS.libraryReconcileFix),
  reconcileCancel: () => ipcRenderer.invoke(IPC_CHANNELS.libraryReconcileCancel),
  onReconcileProgress: (callback) => {
    const listener = (_e: IpcRendererEvent, progress: ReconcileProgress): void =>
      callback(progress);
    ipcRenderer.on(IPC_CHANNELS.libraryReconcileProgress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.libraryReconcileProgress, listener);
  },
  onLibraryMaintenanceEnded: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on(IPC_CHANNELS.libraryMaintenanceEnded, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.libraryMaintenanceEnded, listener);
  },
  listLibraryItems: () => scopedInvoke(IPC_CHANNELS.listLibraryItems),
  refreshCloudCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.refreshCloudCatalog),
  removeLocalCopy: (id) => scopedInvoke(IPC_CHANNELS.removeLocalCopy, id),
  recordingCreate: (sessionId, kind) =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingCreate, sessionId, kind),
  recordingWrite: (sessionId, data, position, kind) =>
    ipcRenderer.send(IPC_CHANNELS.recordingWrite, sessionId, data, position, kind),
  recordingFinalize: (sessionId, meta) =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingFinalize, sessionId, meta),
  recordingAbort: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.recordingAbort, sessionId),
  recordingStat: (sessionId, kind) =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingStat, sessionId, kind),
  recordingWebcamEnded: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingWebcamEnded, sessionId),
  recordingWebcamTrackSupported: () =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingWebcamTrackSupported),
  recordingReportTick: (tick) => ipcRenderer.send(IPC_CHANNELS.recordingReportTick, tick),
  recordingReportMicLevels: (levels) => ipcRenderer.send(IPC_CHANNELS.micLevelsReport, levels),
  getMicLevelsListening: () => ipcRenderer.invoke(IPC_CHANNELS.micLevelsGetListening),
  onMicLevelsListening: (callback) => {
    const listener = (_e: IpcRendererEvent, listening: boolean): void => callback(listening);
    ipcRenderer.on(IPC_CHANNELS.micLevelsListening, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.micLevelsListening, listener);
  },
  subscribeMicLevels: (callback) => {
    const listener = (_e: IpcRendererEvent, levels: number[]): void => callback(levels);
    ipcRenderer.on(IPC_CHANNELS.micLevelsData, listener);
    ipcRenderer.send(IPC_CHANNELS.micLevelsSubscribe);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      ipcRenderer.removeListener(IPC_CHANNELS.micLevelsData, listener);
      ipcRenderer.send(IPC_CHANNELS.micLevelsUnsubscribe);
    };
  },
  recordingStart: (info) => ipcRenderer.send(IPC_CHANNELS.recordingStart, info),
  recordingHideMainWindow: () => ipcRenderer.invoke(IPC_CHANNELS.recordingHideMainWindow),
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
    const listener = (_e: IpcRendererEvent, state: RecordingShadeView): void => callback(state);
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
    scopedInvoke(IPC_CHANNELS.videoEditSaveSession, id, sessionJson, assets, exported),
  loadVideoEditSession: (id) => scopedInvoke(IPC_CHANNELS.videoEditLoadSession, id),
  loadCursorTrack: (id) => scopedInvoke(IPC_CHANNELS.loadCursorTrack, id),
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
    requestState: () => ipcRenderer.send(IPC_CHANNELS.screenshotOverlayStateRequest),
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
  showRecordingReady: (payload) => ipcRenderer.invoke(IPC_CHANNELS.recordingReadyShow, payload),
  recordingReadyCard: {
    onShow: (callback) => {
      const listener = (_e: IpcRendererEvent, payload: RecordingReadyPayload): void =>
        callback(payload);
      ipcRenderer.on(IPC_CHANNELS.recordingReadyPayload, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingReadyPayload, listener);
    },
    ready: () => ipcRenderer.send(IPC_CHANNELS.recordingReadyCardReady),
    action: (action) => ipcRenderer.send(IPC_CHANNELS.recordingReadyAction, action),
    resize: (height) => ipcRenderer.send(IPC_CHANNELS.recordingReadyResize, { height }),
  },
  onRecordingReadyOpen: (callback) => {
    const listener = (_e: IpcRendererEvent, handOff: RecordingReadyHandOff): void =>
      callback(handOff);
    ipcRenderer.on(IPC_CHANNELS.recordingReadyOpen, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingReadyOpen, listener);
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
  copyScreenshotById: (id) => scopedInvoke(IPC_CHANNELS.screenshotCopyById, id),
  readScreenshotBytes: (id) => scopedInvoke(IPC_CHANNELS.screenshotReadBytes, id),
  readClipboardImage: () => ipcRenderer.invoke(IPC_CHANNELS.clipboardReadImage),
  peekClipboardImage: () => ipcRenderer.invoke(IPC_CHANNELS.clipboardPeekImage),
  saveScreenshot: (png, meta) => scopedInvoke(IPC_CHANNELS.screenshotSave, png, meta),
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
