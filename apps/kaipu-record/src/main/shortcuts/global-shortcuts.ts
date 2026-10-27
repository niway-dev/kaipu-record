import { globalShortcut } from "electron";
import {
  isShortcutActionEnabled,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type ShortcutSettings,
} from "@shared/types";
import type { CaptureMode } from "@shared/types/screenshot-capture";

/**
 * Global (system-wide) keyboard shortcuts. They work even when the app isn't
 * focused — essential because the user is usually in the app they're recording.
 *
 * Bindings are user-rebindable (`AppSettings.shortcuts`); call `applyGlobalShortcuts`
 * again after they change. `register` can throw on a malformed accelerator or
 * return false when another app already owns it — both are captured in `status`
 * so the UI can surface a binding that didn't take.
 */

type ShortcutHandlers = Record<ShortcutAction, () => void>;

interface GlobalShortcutDeps {
  getShortcuts: () => ShortcutSettings;
  handlers: ShortcutHandlers;
  /** Modes the user can reach; defaults to `ENABLED_CAPTURE_MODES`. */
  enabledModes?: readonly CaptureMode[];
}

let deps: GlobalShortcutDeps | null = null;
const status: Record<ShortcutAction, boolean> = {
  startRecording: false,
  stopRecording: false,
  bringToFront: false,
  captureScreenshot: false,
  captureScreen: false,
  captureFrame: false,
  captureWindow: false,
  recordArea: false,
  toggleMicrophone: false,
  toggleSystemAudio: false,
  toggleCamera: false,
};

function tryRegister(accelerator: string, handler: () => void): boolean {
  try {
    return globalShortcut.register(accelerator, handler);
  } catch (error) {
    console.error(`failed to register global shortcut "${accelerator}"`, error);
    return false;
  }
}

/**
 * Temporary registrations owned by another module (the countdown's Esc in the recording
 * hub). `applyGlobalShortcuts` starts with `unregisterAll`, which runs on every settings
 * write; these are registered again after it, so a write mid-countdown never drops them.
 */
const temporary = new Map<string, () => void>();

/** Hold `accelerator` until {@link releaseTemporaryShortcut}. False when it did not take. */
export function holdTemporaryShortcut(accelerator: string, handler: () => void): boolean {
  if (!tryRegister(accelerator, handler)) return false;
  temporary.set(accelerator, handler);
  return true;
}

export function releaseTemporaryShortcut(accelerator: string): void {
  if (!temporary.delete(accelerator)) return;
  try {
    globalShortcut.unregister(accelerator);
  } catch (error) {
    console.error(`failed to release global shortcut "${accelerator}"`, error);
  }
}

/** (Re)register every global shortcut from the current settings. Idempotent. */
export function applyGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
  for (const [accelerator, handler] of temporary) tryRegister(accelerator, handler);
  if (!deps) return;
  const shortcuts = deps.getShortcuts();
  for (const action of SHORTCUT_ACTIONS) {
    // A switched-off action (Window mode) is never registered, so its combo stays free.
    if (!isShortcutActionEnabled(action, deps.enabledModes)) {
      status[action] = false;
      continue;
    }
    status[action] = tryRegister(shortcuts[action], deps.handlers[action]);
  }
}

/** Wire dependencies and perform the initial registration. Call once, after `app.whenReady`. */
export function registerGlobalShortcuts(next: GlobalShortcutDeps): void {
  deps = next;
  applyGlobalShortcuts();
}

/** Per-action registration result (false = malformed or owned by another app). */
export function getShortcutStatus(): Record<ShortcutAction, boolean> {
  return { ...status };
}

/** Release all global shortcuts. Call on quit. */
export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}
