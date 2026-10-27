import {
  ENABLED_CAPTURE_MODES,
  type CaptureAction,
  type CaptureIntent,
  type CaptureMode,
} from "@shared/types/screenshot-capture";

/** Which modifier means "copy" on the overlay: ⌘C on macOS, Ctrl+C everywhere else. */
export type KeyPlatform = "mac" | "other";

/**
 * The overlay renderer's platform: the preload bridge's `platform` first (what
 * Electron actually runs on), the browser's own report only when there is no bridge.
 */
export function detectKeyPlatform(): KeyPlatform {
  const bridged = typeof window !== "undefined" ? window.electronAPI?.platform : undefined;
  if (bridged) return bridged === "darwin" ? "mac" : "other";
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "mac" : "other";
}

/** The Copy shortcut as the action bar and the hint pill print it. */
export function copyKeyLabel(platform: KeyPlatform): string {
  return platform === "mac" ? "⌘C" : "Ctrl+C";
}

/** ⌘C on macOS, Ctrl+C elsewhere; no other modifier. */
export function isCopyKey(event: KeyboardEvent, platform: KeyPlatform): boolean {
  if (event.key.toLowerCase() !== "c" || event.altKey || event.shiftKey) return false;
  return platform === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Enter with no modifier: Capture. */
export function isCaptureKey(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
  );
}

/**
 * Keys 1..n with no modifier pick the mode in pill order (`enabledModes`, by default
 * `ENABLED_CAPTURE_MODES`): with Window off, 1 is Frame, 2 is Screen and 3 does nothing.
 */
export function modeForKey(
  event: KeyboardEvent,
  enabledModes: readonly CaptureMode[] = ENABLED_CAPTURE_MODES,
): CaptureMode | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const index = ["1", "2", "3"].indexOf(event.key);
  return index < 0 ? null : (enabledModes[index] ?? null);
}

/** The Record shortcut as the action bar and the hint pill print it: the same everywhere. */
export function recordKeyLabel(_platform: KeyPlatform): string {
  return "R";
}

/**
 * R with no modifier. Not ⌘R / Ctrl+R: outside dev, `optimizer.watchWindowShortcuts` (main
 * installs it on every window) cancels those in `before-input-event` so they cannot reload a
 * page, and the overlay would never see them. Plain letters are free on the overlay.
 */
export function isRecordKey(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === "r" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  );
}

/**
 * P (photo) and V (video) with no modifier switch the overlay between taking a screenshot
 * and recording, as in the owner's "Kaipu Unified Capture" design. Nothing else changes:
 * the selection and the mode stay.
 */
export function intentForKey(event: KeyboardEvent): CaptureIntent | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  return key === "p" ? "capture" : key === "v" ? "record" : null;
}

/**
 * What Enter does: take the screenshot, or (opened to record) start the countdown on the
 * selection. Design "Kaipu Record Modes" moved Mic, System audio and Camera onto the
 * overlay's mode widget, so the old "Use selection" step (`select`) has no seat any more:
 * the overlay never sends it, main still accepts it.
 */
export function primaryAction(intent: CaptureIntent): "capture" | "record" {
  return intent === "record" ? "record" : "capture";
}

/**
 * The action a key fires on a selection: Enter the primary one, R Record in either intent
 * (an alias of Enter when the overlay opened to record), ⌘C / Ctrl+C Copy only when the
 * overlay opened to take a screenshot.
 */
export function actionForKey(
  event: KeyboardEvent,
  platform: KeyPlatform,
  intent: CaptureIntent,
): CaptureAction | null {
  if (isCaptureKey(event)) return primaryAction(intent);
  if (isRecordKey(event)) return "record";
  if (intent === "capture" && isCopyKey(event, platform)) return "copy";
  return null;
}
