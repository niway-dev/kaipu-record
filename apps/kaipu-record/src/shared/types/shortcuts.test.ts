import { describe, expect, it } from "vitest";
import { defaultShortcutsFor } from "../shortcut-defaults";
import { SHORTCUT_ACTIONS, SHORTCUT_DEFINITIONS } from "./ipc";

/**
 * SHORTCUT_DEFINITIONS is the single source of truth: every surface (Shortcuts
 * page, status bar, default settings) derives from it. These tests guard against
 * drift — a new action without metadata, or the per-platform defaults falling out of sync.
 */
describe("shortcut definitions", () => {
  it("defines exactly the known actions, once each", () => {
    const actions = SHORTCUT_DEFINITIONS.map((d) => d.action).sort();
    expect(actions).toEqual([...SHORTCUT_ACTIONS].sort());
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("derives the per-platform defaults from the definitions", () => {
    for (const def of SHORTCUT_DEFINITIONS) {
      expect(defaultShortcutsFor("darwin")[def.action]).toBe(def.defaultAccelerator.mac);
      expect(defaultShortcutsFor("win32")[def.action]).toBe(def.defaultAccelerator.win);
    }
    expect(Object.keys(defaultShortcutsFor("darwin")).sort()).toEqual([...SHORTCUT_ACTIONS].sort());
  });

  it("gives every action a label, description, status word, and group", () => {
    for (const def of SHORTCUT_DEFINITIONS) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.statusWord.length).toBeGreaterThan(0);
      expect(["recording", "app"]).toContain(def.group);
    }
  });
});
