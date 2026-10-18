import { describe, expect, it } from "vitest";
import { DEFAULT_ACCELERATORS, SHORTCUT_ACTIONS as DOMAIN_ACTIONS } from "@kaipu/domain/constants";
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
      expect(definition.defaultAccelerator).toBe(DEFAULT_ACCELERATORS.mac[definition.action]);
    }
  });

  it("pins the capture shortcuts to their documented macOS combos", () => {
    const byAction = Object.fromEntries(
      SHORTCUT_DEFINITIONS.map((d) => [d.action, d.defaultAccelerator]),
    );
    expect(byAction.captureScreenshot).toBe("Command+Control+X");
    expect(byAction.captureScreen).toBe("Command+Control+Shift+X");
    expect(byAction.captureFrame).toBe("Command+Control+Shift+F");
    expect(byAction.captureWindow).toBe("Command+Control+W");
  });

  it("keeps the new capture actions in the app group with their status words", () => {
    const screen = SHORTCUT_DEFINITIONS.find((d) => d.action === "captureScreen");
    const frame = SHORTCUT_DEFINITIONS.find((d) => d.action === "captureFrame");
    const window = SHORTCUT_DEFINITIONS.find((d) => d.action === "captureWindow");
    expect(screen).toMatchObject({ group: "app", statusWord: "screen" });
    expect(frame).toMatchObject({ group: "app", statusWord: "frame" });
    expect(window).toMatchObject({ group: "app", label: "Capture window", statusWord: "window" });
  });

  it("defines every action exactly once", () => {
    const actions = SHORTCUT_DEFINITIONS.map((d) => d.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).toHaveLength(SHORTCUT_ACTIONS.length);
  });
});
