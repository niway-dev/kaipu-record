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
