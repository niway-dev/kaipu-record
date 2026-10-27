import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_MODES } from "@shared/types/screenshot-capture";
import { SHORTCUT_ACTIONS } from "@shared/types";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";

const DEFAULT_SHORTCUTS = defaultShortcutsFor("darwin");

const register = vi.fn((_accelerator: string, _handler: () => void) => true);
const unregister = vi.fn();
vi.mock("electron", () => ({
  globalShortcut: { register, unregister, unregisterAll: vi.fn() },
}));

const {
  applyGlobalShortcuts,
  getShortcutStatus,
  holdTemporaryShortcut,
  registerGlobalShortcuts,
  releaseTemporaryShortcut,
} = await import("./global-shortcuts");

function handlers() {
  return Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action, vi.fn()])) as never;
}

describe("global shortcuts and Window mode", () => {
  beforeEach(() => register.mockClear());

  it("skips captureWindow with the flag as shipped (Window off)", () => {
    registerGlobalShortcuts({ getShortcuts: () => DEFAULT_SHORTCUTS, handlers: handlers() });
    const registered = register.mock.calls.map(([accelerator]) => accelerator);
    expect(registered).not.toContain(DEFAULT_SHORTCUTS.captureWindow);
    expect(registered).toHaveLength(SHORTCUT_ACTIONS.length - 1);
    expect(getShortcutStatus().captureWindow).toBe(false);
    expect(getShortcutStatus().captureFrame).toBe(true);
  });

  it("re-registers a held temporary shortcut after a settings re-apply, until released", () => {
    registerGlobalShortcuts({ getShortcuts: () => DEFAULT_SHORTCUTS, handlers: handlers() });
    const onEscape = vi.fn();
    expect(holdTemporaryShortcut("Escape", onEscape)).toBe(true);
    register.mockClear();

    // A settings write mid-countdown re-applies everything (unregisterAll first).
    applyGlobalShortcuts();
    expect(register).toHaveBeenCalledWith("Escape", onEscape);

    releaseTemporaryShortcut("Escape");
    expect(unregister).toHaveBeenCalledWith("Escape");
    register.mockClear();
    applyGlobalShortcuts();
    expect(register.mock.calls.map(([accelerator]) => accelerator)).not.toContain("Escape");
  });

  it("registers captureWindow when Window is enabled", () => {
    registerGlobalShortcuts({
      getShortcuts: () => DEFAULT_SHORTCUTS,
      handlers: handlers(),
      enabledModes: CAPTURE_MODES,
    });
    applyGlobalShortcuts();
    const registered = register.mock.calls.map(([accelerator]) => accelerator);
    expect(registered).toContain(DEFAULT_SHORTCUTS.captureWindow);
  });
});
