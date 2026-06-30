import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, SHORTCUT_DEFINITIONS } from "./ipc";

/**
 * SHORTCUT_DEFINITIONS is the single source of truth: every surface (Shortcuts
 * page, status bar, default settings) derives from it. These tests guard against
 * drift — a new action without metadata, or DEFAULT_SHORTCUTS falling out of sync.
 */
describe("shortcut definitions", () => {
  it("defines exactly the known actions, once each", () => {
    const actions = SHORTCUT_DEFINITIONS.map((d) => d.action).sort();
    expect(actions).toEqual([...SHORTCUT_ACTIONS].sort());
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("derives DEFAULT_SHORTCUTS from the definitions", () => {
    for (const def of SHORTCUT_DEFINITIONS) {
      expect(DEFAULT_SHORTCUTS[def.action]).toBe(def.defaultAccelerator);
    }
    expect(Object.keys(DEFAULT_SHORTCUTS).sort()).toEqual([...SHORTCUT_ACTIONS].sort());
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
