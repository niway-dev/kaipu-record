import { describe, expect, it } from "vitest";
import { DEFAULT_ACCELERATORS, SHORTCUT_ACTIONS as DOMAIN_ACTIONS } from "@kaipu/domain/constants";
import { defaultShortcutsFor } from "../shortcut-defaults";
import { SHORTCUT_ACTIONS, SHORTCUT_DEFINITIONS } from "./ipc";

/**
 * `ipc.ts` cannot import the shared constants: it is reachable from the preload
 * bundle, which externalizes workspace packages and then fails to load their
 * TypeScript — the app opens to a black window when that happens. So the
 * accelerators are literals there and this is what keeps them honest, the same
 * shape `settings.service.test.ts` uses to pin DEFAULT_LOCALE.
 *
 * This test file is NOT in the preload bundle, so importing domain here is free.
 */
describe("the desktop shortcut defaults", () => {
  it("lists the same actions as @kaipu/domain", () => {
    expect([...SHORTCUT_ACTIONS].sort()).toEqual([...DOMAIN_ACTIONS].sort());
  });

  it("binds each action to the accelerator domain declares for macOS", () => {
    for (const definition of SHORTCUT_DEFINITIONS) {
      expect(definition.defaultAccelerator.mac).toBe(DEFAULT_ACCELERATORS.mac[definition.action]);
    }
  });

  it("pins the capture shortcuts to their documented macOS combos", () => {
    const mac = defaultShortcutsFor("darwin");
    expect(mac.captureScreenshot).toBe("Command+Control+X");
    expect(mac.captureScreen).toBe("Command+Control+Shift+X");
    expect(mac.captureFrame).toBe("Command+Control+Shift+F");
    expect(mac.captureWindow).toBe("Command+Control+W");
  });

  it("pins the capture shortcuts to their documented Windows combos", () => {
    const win = defaultShortcutsFor("win32");
    expect(win.captureScreenshot).toBe("Control+Alt+X");
    expect(win.captureScreen).toBe("Control+Alt+Shift+X");
    expect(win.captureFrame).toBe("Control+Alt+Shift+F");
    expect(win.captureWindow).toBe("Control+Alt+W");
  });

  it("keeps the new capture actions in the app group with their status words", () => {
    const screen = SHORTCUT_DEFINITIONS.find((d) => d.action === "captureScreen");
    const frame = SHORTCUT_DEFINITIONS.find((d) => d.action === "captureFrame");
    const window = SHORTCUT_DEFINITIONS.find((d) => d.action === "captureWindow");
    expect(screen).toMatchObject({ group: "app", statusWord: "screen" });
    expect(frame).toMatchObject({ group: "app", statusWord: "frame" });
    expect(window).toMatchObject({ group: "app", label: "Capture window", statusWord: "window" });
  });

  it("binds each action to the accelerator domain declares for Windows", () => {
    for (const definition of SHORTCUT_DEFINITIONS) {
      expect(definition.defaultAccelerator.win).toBe(
        DEFAULT_ACCELERATORS.windows[definition.action],
      );
    }
  });

  it("has a non-empty default on both platforms for every action", () => {
    for (const platform of ["darwin", "win32"]) {
      const defaults = defaultShortcutsFor(platform);
      for (const action of SHORTCUT_ACTIONS) {
        expect(defaults[action].length).toBeGreaterThan(0);
      }
    }
  });

  it("never puts Command or Super in a Windows default", () => {
    for (const accelerator of Object.values(defaultShortcutsFor("win32"))) {
      expect(accelerator).not.toMatch(/Command|Cmd|Super|Meta/);
    }
  });

  it("resolves win32 to the Windows pair and everything else to macOS's", () => {
    expect(defaultShortcutsFor("win32").startRecording).toBe("Control+Alt+C");
    expect(defaultShortcutsFor("darwin").startRecording).toBe("Command+Control+C");
    // Linux is not a supported target yet; it falls back to the macOS pair.
    expect(defaultShortcutsFor("linux")).toEqual(defaultShortcutsFor("darwin"));
  });

  it("defines every action exactly once", () => {
    const actions = SHORTCUT_DEFINITIONS.map((d) => d.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).toHaveLength(SHORTCUT_ACTIONS.length);
  });
});
