import { describe, expect, it } from "vitest";
import { resolveShortcutCapture } from "./shortcut-capture";

const ALL = ["frame", "window", "screen"] as const;

describe("resolveShortcutCapture", () => {
  it("the generic shortcut captures with the stored current mode and remembers nothing", () => {
    expect(resolveShortcutCapture("captureScreenshot", "frame", ALL)).toEqual({
      mode: "frame",
      remember: false,
    });
    expect(resolveShortcutCapture("captureScreenshot", "window", ALL).mode).toBe("window");
  });

  it("the generic shortcut falls back to Frame when the stored mode is not served", () => {
    expect(resolveShortcutCapture("captureScreenshot", "window", ["frame", "screen"])).toEqual({
      mode: "frame",
      remember: false,
    });
  });

  it("keeps the stored mode when not even Frame is served, so the capture says why", () => {
    expect(resolveShortcutCapture("captureScreenshot", "screen", []).mode).toBe("screen");
  });

  it("trusts the stored mode while support is unknown", () => {
    expect(resolveShortcutCapture("captureScreenshot", "screen", null).mode).toBe("screen");
  });

  it("a mode-specific shortcut captures with its mode and makes it current", () => {
    expect(resolveShortcutCapture("captureScreen", "frame", ALL)).toEqual({
      mode: "screen",
      remember: true,
    });
    expect(resolveShortcutCapture("captureFrame", "screen", ALL)).toEqual({
      mode: "frame",
      remember: true,
    });
    expect(resolveShortcutCapture("captureWindow", "frame", ALL)).toEqual({
      mode: "window",
      remember: true,
    });
  });

  it("does not rewrite settings when the mode is already current", () => {
    expect(resolveShortcutCapture("captureFrame", "frame", ALL)).toEqual({
      mode: "frame",
      remember: false,
    });
  });

  it("never changes the stored mode during a recording; the capture is still sent to be refused", () => {
    expect(resolveShortcutCapture("captureFrame", "screen", ALL, true)).toEqual({
      mode: "frame",
      remember: false,
    });
    expect(resolveShortcutCapture("captureScreen", "frame", ALL, true)).toEqual({
      mode: "screen",
      remember: false,
    });
    expect(resolveShortcutCapture("captureScreenshot", "frame", ALL, true)).toEqual({
      mode: "frame",
      remember: false,
    });
  });

  it("never remembers a mode the platform cannot serve", () => {
    expect(resolveShortcutCapture("captureWindow", "frame", ["frame", "screen"])).toEqual({
      mode: "window",
      remember: false,
    });
  });
});
