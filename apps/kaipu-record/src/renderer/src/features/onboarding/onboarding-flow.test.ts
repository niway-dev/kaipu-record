import { describe, expect, it } from "vitest";
import {
  canAdvanceFrom,
  canJumpTo,
  skipActionFor,
  STEPS,
  triedShortcutCount,
} from "./onboarding-flow";

describe("onboarding flow", () => {
  it("has four steps in order", () => {
    expect(STEPS).toEqual(["welcome", "permissions", "shortcuts", "done"]);
  });

  it("only the permissions step blocks, until screen and microphone are granted", () => {
    expect(canAdvanceFrom("welcome", false)).toBe(true);
    expect(canAdvanceFrom("permissions", false)).toBe(false);
    expect(canAdvanceFrom("permissions", true)).toBe(true);
    // Trying shortcuts is optional: Continue is always on.
    expect(canAdvanceFrom("shortcuts", false)).toBe(true);
  });

  it("a dot cannot jump past permissions while they are missing", () => {
    expect(canJumpTo(0, 1, false)).toBe(true);
    expect(canJumpTo(0, 2, false)).toBe(false);
    expect(canJumpTo(1, 3, false)).toBe(false);
    expect(canJumpTo(3, 0, false)).toBe(true);
    expect(canJumpTo(0, 3, true)).toBe(true);
  });

  it("the skip link goes to permissions first, then skips the tour once they are met", () => {
    expect(skipActionFor("welcome", false)).toBe("toPermissions");
    expect(skipActionFor("welcome", true)).toBe("toPermissions");
    expect(skipActionFor("permissions", false)).toBe("blocked");
    expect(skipActionFor("permissions", true)).toBe("close");
    expect(skipActionFor("shortcuts", true)).toBe("close");
    expect(skipActionFor("done", true)).toBe("none");
  });

  it("counts only the four onboarding shortcuts as tried", () => {
    expect(triedShortcutCount(new Set())).toBe(0);
    expect(triedShortcutCount(new Set(["captureScreenshot", "captureWindow"]))).toBe(1);
    expect(
      triedShortcutCount(
        new Set(["captureScreenshot", "startRecording", "captureInstant", "bringToFront"]),
      ),
    ).toBe(4);
  });
});
