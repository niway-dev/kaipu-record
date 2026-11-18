import {
  DEFAULT_EXPORT_SETTINGS,
  sanitizeSettings,
  type ImageExportSettings,
} from "./image-export-settings";

/**
 * The Export popover's last settings, kept in `localStorage` like the redaction notice flag and
 * onboarding. Every access is wrapped: localStorage can throw in restricted renderer contexts.
 * Unreadable means defaults; a failed write only means the next open starts from defaults again.
 */
export const EXPORT_SETTINGS_KEY = "kaipu.imageEditor.exportSettings";

export function readExportSettings(): ImageExportSettings {
  try {
    const raw = localStorage.getItem(EXPORT_SETTINGS_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : { ...DEFAULT_EXPORT_SETTINGS };
  } catch {
    return { ...DEFAULT_EXPORT_SETTINGS };
  }
}

export function writeExportSettings(settings: ImageExportSettings): void {
  try {
    localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore: the next open starts from the defaults.
  }
}
