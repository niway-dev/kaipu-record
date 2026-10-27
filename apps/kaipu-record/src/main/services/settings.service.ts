import {
  isCaptureMode,
  isRecordingRatio,
  toEnabledCaptureMode,
  type CaptureRect,
  type RememberedArea,
} from "@shared/types/screenshot-capture";
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  SCREENSHOT_COPY_MODES,
  SHORTCUT_ACTIONS,
  type ScreenshotCopyMode,
  type ShortcutAction,
  type ShortcutSettings,
  type Theme,
  UPLOAD_MODES,
  type UploadMode,
  sanitizeCountdownSeconds,
  sanitizeExportQuality,
} from "@shared/types";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";
import { sanitizeQuality } from "@shared/recording-quality";
import { sanitizeCameraBubble } from "@shared/camera-bubble";
import { DEFAULT_LOCALE, isLocale } from "@kaipu/i18n";

/**
 * Pure settings logic — the kind of code that lives in the `main` process but
 * has no Electron/Node side effects, so it is fully unit-testable.
 *
 * Side-effecting concerns (reading/writing disk, registering IPC handlers)
 * belong in `src/main/infrastructure`, not here.
 */

const VALID_THEMES: readonly Theme[] = ["light", "dark"];

export function isValidUploadMode(value: unknown): value is UploadMode {
  return typeof value === "string" && (UPLOAD_MODES as readonly string[]).includes(value);
}

export function isValidTheme(value: unknown): value is Theme {
  return typeof value === "string" && (VALID_THEMES as readonly string[]).includes(value);
}

export function isValidScreenshotCopyMode(value: unknown): value is ScreenshotCopyMode {
  return typeof value === "string" && (SCREENSHOT_COPY_MODES as readonly string[]).includes(value);
}

/**
 * Merge stored shortcuts over the defaults, per action. A binding is kept only
 * if it's a non-empty string; anything else falls back to that action's default.
 * (The accelerator's syntactic validity is enforced where it's registered.)
 */
export function mergeShortcuts(
  stored: unknown,
  platform: string = process.platform,
): ShortcutSettings {
  const defaults = defaultShortcutsFor(platform);
  const safe = (stored && typeof stored === "object" ? stored : {}) as Partial<
    Record<ShortcutAction, unknown>
  >;
  const result = {} as ShortcutSettings;
  for (const action of SHORTCUT_ACTIONS) {
    const value = safe[action];
    result[action] = typeof value === "string" && value.length > 0 ? value : defaults[action];
  }
  return result;
}

function isFrameRect(value: unknown): value is CaptureRect {
  if (!value || typeof value !== "object") return false;
  const { x, y, width, height } = value as Record<string, unknown>;
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  return finite(x) && finite(y) && finite(width) && finite(height) && width > 0 && height > 0;
}

/**
 * Keep only well-formed remembered frames (finite, positive size), keyed by display id.
 * Whether a frame still fits its display is decided when the overlay opens, not here.
 */
export function mergeScreenshotFrames(stored: unknown): Record<string, CaptureRect> {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const result: Record<string, CaptureRect> = {};
  for (const [displayId, value] of Object.entries(stored)) {
    if (!isFrameRect(value)) continue;
    const { x, y, width, height } = value;
    result[displayId] = { x, y, width, height };
  }
  return result;
}

/**
 * The recording area memory: the same well-formed rectangles as `mergeScreenshotFrames`,
 * plus the ratio each was drawn with when it is a known one (an unknown ratio is dropped,
 * so the area loads as Free instead of being lost).
 */
export function mergeRecordingAreas(stored: unknown): Record<string, RememberedArea> {
  const rects = mergeScreenshotFrames(stored);
  const result: Record<string, RememberedArea> = {};
  for (const [displayId, rect] of Object.entries(rects)) {
    const ratio = (stored as Record<string, { ratio?: unknown }>)[displayId]?.ratio;
    result[displayId] = isRecordingRatio(ratio) ? { ...rect, ratio } : rect;
  }
  return result;
}

/**
 * Merge persisted (possibly partial or untrusted) settings on top of the
 * defaults, dropping any invalid fields.
 */
export function mergeSettings(
  stored: Partial<AppSettings> | null | undefined,
  platform: string = process.platform,
): AppSettings {
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
    recordingCountdownSeconds: sanitizeCountdownSeconds(safe.recordingCountdownSeconds),
    showBrandBadge:
      typeof safe.showBrandBadge === "boolean"
        ? safe.showBrandBadge
        : DEFAULT_SETTINGS.showBrandBadge,
    screenshotCopy: isValidScreenshotCopyMode(safe.screenshotCopy)
      ? safe.screenshotCopy
      : DEFAULT_SETTINGS.screenshotCopy,
    shortcuts: mergeShortcuts(safe.shortcuts, platform),
    deviceId: typeof safe.deviceId === "string" ? safe.deviceId : "",
    uploadMode: isValidUploadMode(safe.uploadMode) ? safe.uploadMode : DEFAULT_SETTINGS.uploadMode,
    // Files written before NIW2-218's Export quality still carry `lastExportPreset` /
    // `lastExportFraming`; rebuilding the object here drops them.
    exportQuality: sanitizeExportQuality(safe.exportQuality),
    showRecordingSavedCard:
      typeof safe.showRecordingSavedCard === "boolean"
        ? safe.showRecordingSavedCard
        : DEFAULT_SETTINGS.showRecordingSavedCard,
    screenshotFrame: mergeScreenshotFrames(safe.screenshotFrame),
    recordingArea: mergeRecordingAreas(safe.recordingArea),
    // Every mode is valid here, Window included: it records through the thumbnail picker.
    recordingMode: isCaptureMode(safe.recordingMode)
      ? safe.recordingMode
      : DEFAULT_SETTINGS.recordingMode,
    // A stored "window" reads as Frame while Window mode is off (the file keeps it).
    screenshotMode: toEnabledCaptureMode(safe.screenshotMode),
    trayHintShown:
      typeof safe.trayHintShown === "boolean" ? safe.trayHintShown : DEFAULT_SETTINGS.trayHintShown,
    diagnosticsEnabled:
      typeof safe.diagnosticsEnabled === "boolean"
        ? safe.diagnosticsEnabled
        : DEFAULT_SETTINGS.diagnosticsEnabled,
    cameraBubble: sanitizeCameraBubble(safe.cameraBubble),
  };
}
