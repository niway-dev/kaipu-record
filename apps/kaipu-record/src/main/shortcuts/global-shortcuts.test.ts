import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_MODES } from "@shared/types/screenshot-capture";
import { SHORTCUT_ACTIONS } from "@shared/types";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";

const DEFAULT_SHORTCUTS = defaultShortcutsFor("darwin");

const register = vi.fn((_accelerator: string, _handler: () => void) => true);
vi.mock("electron", () => ({
  globalShortcut: { register, unregisterAll: vi.fn() },
}));

const { applyGlobalShortcuts, getShortcutStatus, registerGlobalShortcuts } =
  await import("./global-shortcuts");

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
