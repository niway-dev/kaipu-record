import { ENABLED_CAPTURE_MODES, type CaptureMode } from "@shared/types/screenshot-capture";

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
