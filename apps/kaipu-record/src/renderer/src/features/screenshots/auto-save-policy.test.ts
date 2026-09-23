import { describe, expect, it } from "vitest";
import { shouldAutoSaveOnOpen } from "./auto-save-policy";

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
