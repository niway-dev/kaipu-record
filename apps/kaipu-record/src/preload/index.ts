import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { IPC_CHANNELS } from "@shared/types";
import type { KaipuElectronAPI } from "@shared/types/electron-api";

// Custom Kaipu bridge. Only methods with a live main-process handler are exposed.
const kaipuApi: KaipuElectronAPI = {
  getScreenSources: () => ipcRenderer.invoke("recording:get-screen-sources"),
  resizeCapturePanel: (height) => ipcRenderer.send("capture-panel:resize", height),
  openMainWindow: () => ipcRenderer.send("capture-panel:open-main"),
  checkPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.checkPermissions),
  requestPermission: (kind) => ipcRenderer.invoke(IPC_CHANNELS.requestPermission, kind),
  openSystemSettings: (kind) => ipcRenderer.invoke(IPC_CHANNELS.openSystemSettings, kind),
  listLocalRecordings: () => ipcRenderer.invoke(IPC_CHANNELS.listLocalRecordings),
  renameLocalRecording: (id, title) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameLocalRecording, id, title),
  deleteLocalRecording: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteLocalRecording, id),
  revealLocalRecording: (id) => ipcRenderer.invoke(IPC_CHANNELS.revealLocalRecording, id),
  getVaultDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.getVaultDirectory),
  chooseVaultDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.chooseVaultDirectory),
  resetVaultDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.resetVaultDirectory),
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
