import { useCallback } from "react";
import type { AppSettings } from "@shared/types";
import { updateSettings, useSettings } from "@renderer/features/settings/settings-store";

export interface AppSettingsStore {
  settings: AppSettings | null;
  update(patch: Partial<AppSettings>): Promise<void>;
}

const wholeSettings = (settings: AppSettings): AppSettings => settings;

/**
 * Reads + updates persisted app settings (main process owns them and the OS side effects).
 * The value comes from the window's settings store, so a change from another window (or another
 * Settings surface) is reflected without a remount, and a window that already holds the settings
 * returns them on the first render. `settings` is `null` only before the window's first read.
 */
export function useAppSettings(): AppSettingsStore {
  const settings = useSettings(wholeSettings);

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    await updateSettings(patch);
  }, []);

  return { settings, update };
}
