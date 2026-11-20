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
import { sanitizeAudioSettings } from "@shared/audio-settings";
import { sanitizeCaptureWidgetSettings } from "@shared/capture-widget-settings";
import { sanitizeEditorSettings } from "@shared/editor-settings";
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

/**
 * Version of the shortcut set the migration below brings a settings file to. The store writes
 * it next to the settings (`shortcutsVersion`); a file without it, or with an older one,
 * predates the migration steps above that version. Bump it, and add a step tagged with the
 * new number, only for a change that must run once more.
 *
 *   1: the global shortcuts were trimmed to five and the capture ones moved to ⌘⇧1 / ⌘⇧2.
 *   2: ⌃⌘X became the one Kaipu key (`startRecording`, "Start capturing"); ⌃⌘S is gone.
 *   3: the keys open the capture widget: ⌘⇧1 in screenshot intent, ⌘⇧2 (`startRecording`) in
 *      recording intent, and ⌃⌘X is the instant capture. `startRecording` and `captureInstant`
 *      swap keys.
 */
export const SHORTCUTS_VERSION = 3;

/**
 * Shortcuts that were global bindings once and no longer are, by the version that removed
 * them. A settings file written by an older build carries these keys; `mergeShortcuts`
 * already ignores any key outside `SHORTCUT_ACTIONS`, so they vanish on the next write; the
 * list lets the load notice the file predates the removal and persist the clean one right away.
 */
const REMOVED_SHORTCUT_ACTIONS: ReadonlyArray<{ version: number; actions: readonly string[] }> = [
  {
    version: 1,
    actions: [
      "captureScreen",
      "captureFrame",
      "recordArea",
      "toggleMicrophone",
      "toggleSystemAudio",
      "toggleCamera",
    ],
  },
  { version: 2, actions: ["stopRecording"] },
];

/**
 * The previous defaults of an action whose default moved, by the version that moved it. A user
 * still on one of them gets the CURRENT default; a custom binding is never touched. Steps are
 * tagged because a file already at version 1 must not replay version 1's moves: its
 * `captureScreenshot` may be a deliberate ⌃⌘X. Literals, on purpose: they are history, not
 * the current defaults.
 *
 * A step never says where an action lands: that is whatever `defaultShortcutsFor` says now,
 * so a file two versions behind goes straight to the final state instead of through
 * intermediate defaults that no longer exist (version 1's ⌃⌘C and version 2's ⌃⌘X both end
 * on the same new `startRecording` key).
 *
 *   1: captureScreenshot ⌃⌘X -> ⌘⇧1, captureInstant ⌃⌘I -> its current default (and the
 *      Windows pairs).
 *   2: startRecording ⌃⌘C -> its current default (Control+Alt+C on Windows).
 *   3: startRecording ⌃⌘X -> ⌘⇧2; captureInstant ⌘⇧2 -> ⌃⌘X (Control+Alt+X -> 2,
 *      Control+Alt+2 -> X on Windows). ⌃⌘C stays in step 2 only: a version 2 file on ⌃⌘C
 *      chose it after version 2 ran, so it is a custom binding.
 */
const MOVED_SHORTCUT_DEFAULTS: ReadonlyArray<{
  version: number;
  action: ShortcutAction;
  from: readonly string[];
}> = [
  { version: 1, action: "captureScreenshot", from: ["Command+Control+X", "Control+Alt+X"] },
  { version: 1, action: "captureInstant", from: ["Command+Control+I", "Control+Alt+I"] },
  { version: 2, action: "startRecording", from: ["Command+Control+C", "Control+Alt+C"] },
  { version: 3, action: "startRecording", from: ["Command+Control+X", "Control+Alt+X"] },
  { version: 3, action: "captureInstant", from: ["Command+Shift+2", "Control+Alt+2"] },
];

/**
 * Upgrade a persisted `shortcuts` object written by an older build: drop the removed actions'
 * keys and, for an action still on an old default, drop that value too so `mergeShortcuts`
 * falls back to this platform's current default. A custom binding is never touched.
 *
 * The moves are decided together, against the FINAL assignment, never one at a time against
 * stale values: `startRecording` and `captureInstant` swap keys (start takes ⌘⇧2 that instant
 * held, instant takes ⌃⌘X that start held), and a one-at-a-time check would see each other's
 * old key as taken and refuse both. The rule instead: every action on an old default is
 * moving; a moving action whose new default is held by an action that is NOT moving (a user
 * who bound `captureScreenshot` to ⌃⌘X, say) stays on its old binding, which may in turn
 * block another move, so it repeats until nothing changes. The custom binding wins, nothing
 * is registered twice, and the user can rebind on the Shortcuts page.
 *
 * Runs at load only, never inside `mergeSettings` (which runs on every write), and only the
 * steps newer than `fromVersion`. The store persists the new version with the result, so a
 * user who later rebinds an action to an old default keeps it. Returns the input untouched for
 * anything that is not an object.
 */
export function migrateLegacyShortcuts(
  stored: unknown,
  fromVersion = 0,
  platform: string = process.platform,
): { shortcuts: unknown; migrated: boolean } {
  if (fromVersion >= SHORTCUTS_VERSION) return { shortcuts: stored, migrated: false };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { shortcuts: stored, migrated: false };
  }
  const next: Record<string, unknown> = { ...(stored as Record<string, unknown>) };
  const defaults = defaultShortcutsFor(platform);
  let migrated = false;
  const pending = range(fromVersion + 1, SHORTCUTS_VERSION);
  for (const step of REMOVED_SHORTCUT_ACTIONS.filter((entry) => pending.includes(entry.version))) {
    for (const action of step.actions) {
      if (action in next) {
        delete next[action];
        migrated = true;
      }
    }
  }
  const steps = MOVED_SHORTCUT_DEFAULTS.filter((entry) => pending.includes(entry.version));
  const moving = new Set<ShortcutAction>(
    SHORTCUT_ACTIONS.filter((action) => {
      const value = next[action];
      return (
        typeof value === "string" &&
        steps.some((step) => step.action === action && step.from.includes(value))
      );
    }),
  );
  // What each action is bound to once the moving ones took their new defaults.
  const finalBinding = (action: ShortcutAction): string =>
    moving.has(action) ? defaults[action] : mergeShortcuts(next, platform)[action];
  let changed = true;
  while (changed) {
    changed = false;
    for (const action of moving) {
      const taken = SHORTCUT_ACTIONS.some(
        (other) =>
          other !== action && !moving.has(other) && finalBinding(other) === defaults[action],
      );
      if (taken) {
        moving.delete(action);
        changed = true;
      }
    }
  }
  for (const action of moving) {
    delete next[action];
    migrated = true;
  }
  return { shortcuts: migrated ? next : stored, migrated };
}

/** `from..to` inclusive. */
function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n += 1) out.push(n);
  return out;
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

/** The display last used per intent: only whole, finite display ids for the two known intents. */
export function mergeLastFrameDisplay(stored: unknown): AppSettings["lastFrameDisplay"] {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const { capture, record } = stored as Record<string, unknown>;
  const valid = (id: unknown): id is number => typeof id === "number" && Number.isInteger(id);
  return {
    ...(valid(capture) ? { capture } : {}),
    ...(valid(record) ? { record } : {}),
  };
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
    screenshotAfterCapture:
      safe.screenshotAfterCapture === "editor" ? "editor" : DEFAULT_SETTINGS.screenshotAfterCapture,
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
    lastFrameDisplay: mergeLastFrameDisplay(safe.lastFrameDisplay),
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
    audio: sanitizeAudioSettings(safe.audio),
    microphone: sanitizeMicrophone(safe.microphone),
    editor: sanitizeEditorSettings(safe.editor),
    captureWidget: sanitizeCaptureWidgetSettings(safe.captureWidget),
  };
}

/** A remembered microphone needs a device id to be found again; anything else is dropped. */
export function sanitizeMicrophone(stored: unknown): AppSettings["microphone"] {
  if (typeof stored !== "object" || stored === null) return null;
  const { deviceId, label } = stored as { deviceId?: unknown; label?: unknown };
  if (typeof deviceId !== "string" || deviceId === "") return null;
  return { deviceId, label: typeof label === "string" ? label : "" };
}
