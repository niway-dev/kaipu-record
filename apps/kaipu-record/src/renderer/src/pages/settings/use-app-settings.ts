import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "@shared/types";

export interface AppSettingsStore {
  settings: AppSettings | null;
  update(patch: Partial<AppSettings>): Promise<void>;
}

/** Reads + updates persisted app settings (main process owns them and the OS side effects). */
export function useAppSettings(): AppSettingsStore {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    void window.electronAPI.getSettings().then(setSettings);
  }, []);

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings(await window.electronAPI.updateSettings(patch));
  }, []);

  return { settings, update };
}
