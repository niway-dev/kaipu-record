import { describe, expect, it } from "vitest";
import {
  autoActionsOnOpen,
  shouldAutoCopyOnOpen,
  shouldAutoSaveOnOpen,
} from "./auto-capture-policy";

describe("shouldAutoSaveOnOpen", () => {
  it("saves a fresh capture on open only in auto mode", () => {
    expect(shouldAutoSaveOnOpen("auto", "blob")).toBe(true);
    expect(shouldAutoSaveOnOpen("manual", "blob")).toBe(false);
  });

  it("never re-saves a screenshot re-opened from the Library", () => {
    expect(shouldAutoSaveOnOpen("auto", "local")).toBe(false);
    expect(shouldAutoSaveOnOpen("manual", "local")).toBe(false);
  });
});

describe("shouldAutoCopyOnOpen", () => {
  it("copies a fresh capture on open only in auto mode", () => {
    expect(shouldAutoCopyOnOpen("auto", "blob")).toBe(true);
    expect(shouldAutoCopyOnOpen("manual", "blob")).toBe(false);
  });

  it("never hijacks the clipboard for a screenshot re-opened from the Library", () => {
    expect(shouldAutoCopyOnOpen("auto", "local")).toBe(false);
    expect(shouldAutoCopyOnOpen("manual", "local")).toBe(false);
  });
});

describe("autoActionsOnOpen — the four states", () => {
  // The two preferences are independent, so a fresh capture has four outcomes.
  it.each([
    { save: "auto", copy: "auto", expected: { save: true, copy: true } },
    { save: "auto", copy: "manual", expected: { save: true, copy: false } },
    { save: "manual", copy: "auto", expected: { save: false, copy: true } },
    { save: "manual", copy: "manual", expected: { save: false, copy: false } },
  ] as const)("save=$save copy=$copy on a fresh capture", ({ save, copy, expected }) => {
    expect(autoActionsOnOpen(save, copy, "blob")).toEqual(expected);
  });

  it("does nothing at all for a shot re-opened from the Library, in every state", () => {
    for (const save of ["auto", "manual"] as const) {
      for (const copy of ["auto", "manual"] as const) {
        expect(autoActionsOnOpen(save, copy, "local")).toEqual({ save: false, copy: false });
      }
    }
  });
});
