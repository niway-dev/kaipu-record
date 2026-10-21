import { describe, expect, it } from "vitest";
import {
  autoActionsOnOpen,
  openKindOf,
  shouldAutoCopyOnOpen,
  shouldAutoSaveOnOpen,
} from "./auto-capture-policy";

describe("shouldAutoSaveOnOpen", () => {
  it("saves an in-memory capture on open: every capture belongs in the Library", () => {
    expect(shouldAutoSaveOnOpen("capture")).toBe(true);
  });

  it("never re-saves a shot re-opened from the Library, nor saves a paste unasked", () => {
    expect(shouldAutoSaveOnOpen("local")).toBe(false);
    expect(shouldAutoSaveOnOpen("paste")).toBe(false);
  });
});

describe("shouldAutoCopyOnOpen", () => {
  it("copies a fresh capture on open only in auto mode", () => {
    expect(shouldAutoCopyOnOpen("auto", "capture")).toBe(true);
    expect(shouldAutoCopyOnOpen("manual", "capture")).toBe(false);
  });

  it("never hijacks the clipboard for a screenshot re-opened from the Library", () => {
    expect(shouldAutoCopyOnOpen("auto", "local")).toBe(false);
    expect(shouldAutoCopyOnOpen("manual", "local")).toBe(false);
  });
});

describe("autoActionsOnOpen", () => {
  it.each([
    { copy: "auto", expected: { save: true, copy: true } },
    { copy: "manual", expected: { save: true, copy: false } },
  ] as const)("copy=$copy on an in-memory capture", ({ copy, expected }) => {
    expect(autoActionsOnOpen(copy, "capture")).toEqual(expected);
  });

  it("does nothing at all for a shot re-opened from the Library", () => {
    for (const copy of ["auto", "manual"] as const) {
      expect(autoActionsOnOpen(copy, "local")).toEqual({ save: false, copy: false });
    }
  });

  it("does nothing at all for an image pasted from the clipboard", () => {
    // It is the user's own image: saving it unasked fills the Library, and copying
    // it back would replace the original on the clipboard with a re-encoded copy.
    for (const copy of ["auto", "manual"] as const) {
      expect(autoActionsOnOpen(copy, "paste")).toEqual({ save: false, copy: false });
    }
  });
});

describe("a quiet capture opened by Edit", () => {
  it("runs no auto action: main already copied it", () => {
    const kind = openKindOf({ kind: "blob", bytes: new ArrayBuffer(1), origin: "quiet" });
    for (const copy of ["auto", "manual"] as const) {
      expect(autoActionsOnOpen(copy, kind)).toEqual({ save: false, copy: false });
    }
  });
});

describe("openKindOf", () => {
  const bytes = new ArrayBuffer(1);

  it("treats an in-memory image as a capture unless it says it was pasted", () => {
    expect(openKindOf({ kind: "blob", bytes })).toBe("capture");
    expect(openKindOf({ kind: "blob", bytes, origin: "capture" })).toBe("capture");
    expect(openKindOf({ kind: "blob", bytes, origin: "paste" })).toBe("paste");
  });

  it("treats a vault image as re-opened, whatever else it carries", () => {
    expect(openKindOf({ kind: "local", id: "s1" })).toBe("local");
  });
});
