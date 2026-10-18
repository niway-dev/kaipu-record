import { describe, expect, it } from "vitest";
import {
  autoActionsOnOpen,
  openKindOf,
  shouldAutoCopyOnOpen,
  shouldAutoSaveOnOpen,
} from "./auto-capture-policy";

describe("shouldAutoSaveOnOpen", () => {
  it("saves a fresh capture on open only in auto mode", () => {
    expect(shouldAutoSaveOnOpen("auto", "capture")).toBe(true);
    expect(shouldAutoSaveOnOpen("manual", "capture")).toBe(false);
  });

  it("never re-saves a screenshot re-opened from the Library", () => {
    expect(shouldAutoSaveOnOpen("auto", "local")).toBe(false);
    expect(shouldAutoSaveOnOpen("manual", "local")).toBe(false);
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

describe("autoActionsOnOpen — the four states", () => {
  // The two preferences are independent, so a fresh capture has four outcomes.
  it.each([
    { save: "auto", copy: "auto", expected: { save: true, copy: true } },
    { save: "auto", copy: "manual", expected: { save: true, copy: false } },
    { save: "manual", copy: "auto", expected: { save: false, copy: true } },
    { save: "manual", copy: "manual", expected: { save: false, copy: false } },
  ] as const)("save=$save copy=$copy on a fresh capture", ({ save, copy, expected }) => {
    expect(autoActionsOnOpen(save, copy, "capture")).toEqual(expected);
  });

  it("does nothing at all for a shot re-opened from the Library, in every state", () => {
    for (const save of ["auto", "manual"] as const) {
      for (const copy of ["auto", "manual"] as const) {
        expect(autoActionsOnOpen(save, copy, "local")).toEqual({ save: false, copy: false });
      }
    }
  });

  it("does nothing at all for an image pasted from the clipboard, in every state", () => {
    // It is the user's own image: saving it unasked fills the Library, and copying
    // it back would replace the original on the clipboard with a re-encoded copy.
    for (const save of ["auto", "manual"] as const) {
      for (const copy of ["auto", "manual"] as const) {
        expect(autoActionsOnOpen(save, copy, "paste")).toEqual({ save: false, copy: false });
      }
    }
  });
});

describe("a quiet capture opened by Annotate", () => {
  it("runs no auto action, in every state: main already saved and/or copied it", () => {
    const kind = openKindOf({ kind: "blob", bytes: new ArrayBuffer(1), origin: "quiet" });
    for (const save of ["auto", "manual"] as const) {
      for (const copy of ["auto", "manual"] as const) {
        expect(autoActionsOnOpen(save, copy, kind)).toEqual({ save: false, copy: false });
      }
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
