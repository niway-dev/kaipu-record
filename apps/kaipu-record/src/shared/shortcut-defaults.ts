import { SHORTCUT_DEFINITIONS, type ShortcutSettings } from "./types/ipc";

/**
 * The default global shortcuts for a platform. Main passes `process.platform`;
 * the renderer passes `window.electronAPI.platform` (it must not read
 * `process.platform` itself).
 *
 * `win32` gets the Windows pair; every other platform gets the macOS pair.
 * Linux is not a supported target yet, so it falls back to macOS's for now.
 */
export function defaultShortcutsFor(platform: string): ShortcutSettings {
  const key = platform === "win32" ? "win" : "mac";
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((d) => [d.action, d.defaultAccelerator[key]]),
  ) as ShortcutSettings;
}
