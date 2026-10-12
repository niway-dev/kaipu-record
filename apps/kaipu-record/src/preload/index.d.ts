import type { KaipuElectronAPI } from "@shared/types/electron-api";

declare global {
  interface Window {
    electronAPI: KaipuElectronAPI;
  }
}
