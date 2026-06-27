import { type AppSettings, DEFAULT_SETTINGS, type Theme } from "@shared/types";

/**
 * Pure settings logic — the kind of code that lives in the `main` process but
 * has no Electron/Node side effects, so it is fully unit-testable.
 *
 * Side-effecting concerns (reading/writing disk, registering IPC handlers)
 * belong in `src/main/infrastructure`, not here.
 */

const VALID_THEMES: readonly Theme[] = ["light", "dark", "system"];

export function isValidTheme(value: unknown): value is Theme {
  return typeof value === "string" && (VALID_THEMES as readonly string[]).includes(value);
}

/**
 * Merge persisted (possibly partial or untrusted) settings on top of the
 * defaults, dropping any invalid fields.
 */
export function mergeSettings(stored: Partial<AppSettings> | null | undefined): AppSettings {
  const safe = stored ?? {};
  return {
    theme: isValidTheme(safe.theme) ? safe.theme : DEFAULT_SETTINGS.theme,
    launchAtLogin:
      typeof safe.launchAtLogin === "boolean" ? safe.launchAtLogin : DEFAULT_SETTINGS.launchAtLogin,
    showInDock:
      typeof safe.showInDock === "boolean" ? safe.showInDock : DEFAULT_SETTINGS.showInDock,
  };
}
