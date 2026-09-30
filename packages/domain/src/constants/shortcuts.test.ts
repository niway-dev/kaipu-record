import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCELERATORS,
  SHORTCUT_ACTIONS,
  formatAccelerator,
  type ShortcutPlatform,
} from "./shortcuts";

describe("DEFAULT_ACCELERATORS", () => {
  it("covers every action on every platform", () => {
    for (const platform of ["mac", "windows"] as const) {
      for (const action of SHORTCUT_ACTIONS) {
        expect(DEFAULT_ACCELERATORS[platform][action]).toBeTruthy();
      }
    }
  });

  it("never binds the same combination twice on a platform", () => {
    for (const platform of ["mac", "windows"] as const) {
      const bindings = Object.values(DEFAULT_ACCELERATORS[platform]);
      expect(new Set(bindings).size).toBe(bindings.length);
    }
  });

  it("keeps Command off the Windows column", () => {
    // Command is macOS-only: Electron maps it to nothing on Windows, so such a
    // binding registers as dead rather than failing loudly.
    for (const accelerator of Object.values(DEFAULT_ACCELERATORS.windows)) {
      expect(accelerator).not.toMatch(/Command/);
    }
  });

  it("never uses CommandOrControl, which would put Ctrl+C on start recording", () => {
    for (const platform of ["mac", "windows"] as const) {
      for (const accelerator of Object.values(DEFAULT_ACCELERATORS[platform])) {
        expect(accelerator).not.toMatch(/CommandOrControl/);
      }
    }
  });
});

describe("formatAccelerator", () => {
  it("renders macOS modifiers as glyphs with no separator", () => {
    expect(formatAccelerator("Command+Control+C")).toBe("⌘⌃C");
    expect(formatAccelerator("Command+Shift+P")).toBe("⌘⇧P");
    expect(formatAccelerator("Command+Alt+X")).toBe("⌘⌥X");
  });

  it("leaves Windows accelerators spelled out", () => {
    expect(formatAccelerator("Control+Alt+C", "windows")).toBe("Control+Alt+C");
  });

  it("passes an unknown part through instead of dropping it", () => {
    // A binding we do not recognise must still render something true.
    expect(formatAccelerator("Command+F13")).toBe("⌘F13");
  });

  it("formats every real default without leaving a stray plus", () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(formatAccelerator(DEFAULT_ACCELERATORS.mac[action])).not.toMatch(/\+/);
    }
  });

  it("defaults to macOS", () => {
    const explicit: ShortcutPlatform = "mac";
    expect(formatAccelerator("Command+Control+S")).toBe(
      formatAccelerator("Command+Control+S", explicit),
    );
  });
});
