import { describe, expect, it } from "vitest";
import { captureShortcut, conflictingAction, formatAccelerator } from "./keyboard-accelerator";

function event(
  over: Partial<Parameters<typeof captureShortcut>[0]>,
): Parameters<typeof captureShortcut>[0] {
  return {
    code: "KeyC",
    key: "c",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  };
}

describe("captureShortcut", () => {
  it("captures Command+Control+letter", () => {
    expect(captureShortcut(event({ code: "KeyC", metaKey: true, ctrlKey: true }))).toEqual({
      accelerator: "Command+Control+C",
      label: "⌃⌘C",
    });
  });

  it("captures digits and extra modifiers", () => {
    expect(
      captureShortcut(event({ code: "Digit2", key: "2", metaKey: true, altKey: true })),
    ).toEqual({
      accelerator: "Command+Alt+2",
      label: "⌥⌘2",
    });
  });

  it("rejects a combo without Command or Control", () => {
    expect(captureShortcut(event({ code: "KeyC", shiftKey: true, altKey: true }))).toBeNull();
  });

  it("rejects a modifier-only press", () => {
    expect(captureShortcut(event({ code: "MetaLeft", key: "Meta", metaKey: true }))).toBeNull();
  });

  it("rejects unsupported keys (v1 = letters/digits only)", () => {
    expect(captureShortcut(event({ code: "Period", key: ".", metaKey: true }))).toBeNull();
  });
});

describe("formatAccelerator", () => {
  it("renders modifiers in macOS order before the key", () => {
    expect(formatAccelerator("Command+Control+C")).toBe("⌃⌘C");
    expect(formatAccelerator("Command+Control+S")).toBe("⌃⌘S");
    expect(formatAccelerator("Control+Alt+Shift+Command+K")).toBe("⌃⌥⇧⌘K");
  });

  it("understands the cross-platform aliases", () => {
    expect(formatAccelerator("CommandOrControl+Shift+1")).toBe("⇧⌘1");
  });
});

describe("conflictingAction", () => {
  const shortcuts = {
    startRecording: "Command+Control+C",
    stopRecording: "Command+Control+S",
    captureScreenshot: "Command+Control+X",
  };

  it("finds another action already bound to the accelerator", () => {
    // Rebinding stopRecording to startRecording's combo.
    expect(conflictingAction(shortcuts, "stopRecording", "Command+Control+C")).toBe(
      "startRecording",
    );
  });

  it("ignores the action's own current binding (re-picking the same combo is fine)", () => {
    expect(conflictingAction(shortcuts, "startRecording", "Command+Control+C")).toBeNull();
  });

  it("returns null when the accelerator is free", () => {
    expect(conflictingAction(shortcuts, "stopRecording", "Command+Control+K")).toBeNull();
  });
});
