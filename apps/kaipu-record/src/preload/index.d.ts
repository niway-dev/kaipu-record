import { ElectronAPI } from "@electron-toolkit/preload";
import type { KaipuElectronAPI } from "@shared/types/electron-api";

declare global {
  interface Window {
    electron: ElectronAPI;
    electronAPI: KaipuElectronAPI;
  }
}
