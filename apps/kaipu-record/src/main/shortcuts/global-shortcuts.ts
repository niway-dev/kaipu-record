import { globalShortcut } from "electron";
import { SHORTCUT_ACTIONS, type ShortcutAction, type ShortcutSettings } from "@shared/types";

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
}

let deps: GlobalShortcutDeps | null = null;
const status: Record<ShortcutAction, boolean> = {
  startRecording: false,
  stopRecording: false,
  bringToFront: false,
  captureScreenshot: false,
};

function tryRegister(accelerator: string, handler: () => void): boolean {
  try {
    return globalShortcut.register(accelerator, handler);
  } catch (error) {
    console.error(`failed to register global shortcut "${accelerator}"`, error);
    return false;
  }
}

/** (Re)register every global shortcut from the current settings. Idempotent. */
export function applyGlobalShortcuts(): void {
  if (!deps) return;
  globalShortcut.unregisterAll();
  const shortcuts = deps.getShortcuts();
  for (const action of SHORTCUT_ACTIONS) {
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
