import {
  type AppSettings,
  DEFAULT_SETTINGS,
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type ShortcutSettings,
  type Theme,
} from "@shared/types";
import { sanitizeQuality } from "@shared/recording-quality";
import { DEFAULT_LOCALE, isLocale } from "@kaipu/i18n";

/**
 * Pure settings logic — the kind of code that lives in the `main` process but
 * has no Electron/Node side effects, so it is fully unit-testable.
 *
 * Side-effecting concerns (reading/writing disk, registering IPC handlers)
 * belong in `src/main/infrastructure`, not here.
 */

const VALID_THEMES: readonly Theme[] = ["light", "dark"];

export function isValidTheme(value: unknown): value is Theme {
  return typeof value === "string" && (VALID_THEMES as readonly string[]).includes(value);
}

/**
 * Merge stored shortcuts over the defaults, per action. A binding is kept only
 * if it's a non-empty string; anything else falls back to that action's default.
 * (The accelerator's syntactic validity is enforced where it's registered.)
 */
export function mergeShortcuts(stored: unknown): ShortcutSettings {
  const safe = (stored && typeof stored === "object" ? stored : {}) as Partial<
    Record<ShortcutAction, unknown>
  >;
  const result = {} as ShortcutSettings;
  for (const action of SHORTCUT_ACTIONS) {
    const value = safe[action];
    result[action] =
      typeof value === "string" && value.length > 0 ? value : DEFAULT_SHORTCUTS[action];
  }
  return result;
}

/**
 * Merge persisted (possibly partial or untrusted) settings on top of the
 * defaults, dropping any invalid fields.
 */
export function mergeSettings(stored: Partial<AppSettings> | null | undefined): AppSettings {
  const safe = stored ?? {};
  return {
    theme: isValidTheme(safe.theme) ? safe.theme : DEFAULT_SETTINGS.theme,
    locale: isLocale(safe.locale) ? safe.locale : DEFAULT_LOCALE,
    launchAtLogin:
      typeof safe.launchAtLogin === "boolean" ? safe.launchAtLogin : DEFAULT_SETTINGS.launchAtLogin,
    showInDock:
      typeof safe.showInDock === "boolean" ? safe.showInDock : DEFAULT_SETTINGS.showInDock,
    recordingQuality: sanitizeQuality(safe.recordingQuality),
    showBarInRecording:
      typeof safe.showBarInRecording === "boolean"
        ? safe.showBarInRecording
        : DEFAULT_SETTINGS.showBarInRecording,
    shortcuts: mergeShortcuts(safe.shortcuts),
    deviceId: typeof safe.deviceId === "string" ? safe.deviceId : "",
  };
}
