import type { CaptureMode } from "@shared/types/screenshot-capture";

/** The three global shortcuts that start a screenshot. */
export type CaptureShortcut = "captureScreenshot" | "captureScreen" | "captureFrame";

const SHORTCUT_MODE: Record<Exclude<CaptureShortcut, "captureScreenshot">, CaptureMode> = {
  captureScreen: "screen",
  captureFrame: "frame",
};

export interface ShortcutCapture {
  /** The mode to capture with (sent to the renderer as the hotkey payload). */
  mode: CaptureMode;
  /** True when this shortcut makes `mode` the current one, so main persists it. */
  remember: boolean;
}

/**
 * What a capture shortcut does with the one current screenshot mode:
 *
 *   • `captureScreenshot` (the generic ⌃⌘X) captures with the stored current mode. If the
 *     platform cannot serve it, it captures with Area — the same fallback the page and the
 *     tray show — rather than answering "unsupported" for a mode the user cannot pick.
 *   • `captureScreen` / `captureFrame` capture with their own mode and make it current,
 *     unless the platform cannot serve it: then nothing is remembered and the capture
 *     answers "unsupported" as before, so the stored mode never becomes one that cannot run.
 *
 * `supported` is `null` when it is not known yet (the screenshot IPC not registered); the
 * stored mode is then trusted.
 *
 * `recording`: a take is active or paused. The capture is still sent so the renderer's
 * recording block answers it ("finish the recording first"), but nothing is remembered: a
 * shortcut that did not capture must not change the default.
 */
export function resolveShortcutCapture(
  action: CaptureShortcut,
  stored: CaptureMode,
  supported: readonly CaptureMode[] | null,
  recording = false,
): ShortcutCapture {
  const serves = (mode: CaptureMode): boolean => supported === null || supported.includes(mode);
  if (action === "captureScreenshot") {
    return { mode: serves(stored) || !serves("area") ? stored : "area", remember: false };
  }
  const mode = SHORTCUT_MODE[action];
  return { mode, remember: !recording && serves(mode) && mode !== stored };
}
