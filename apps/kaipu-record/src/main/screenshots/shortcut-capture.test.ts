import { describe, expect, it } from "vitest";
import { resolveShortcutCapture } from "./shortcut-capture";

const ALL = ["area", "screen", "frame"] as const;

describe("resolveShortcutCapture", () => {
  it("the generic shortcut captures with the stored current mode and remembers nothing", () => {
    expect(resolveShortcutCapture("captureScreenshot", "frame", ALL)).toEqual({
      mode: "frame",
      remember: false,
    });
    expect(resolveShortcutCapture("captureScreenshot", "area", ALL).mode).toBe("area");
  });

  it("the generic shortcut falls back to Area when the stored mode is not served", () => {
    expect(resolveShortcutCapture("captureScreenshot", "frame", ["area", "screen"])).toEqual({
      mode: "area",
      remember: false,
    });
  });

  it("keeps the stored mode when not even Area is served, so the capture says why", () => {
    expect(resolveShortcutCapture("captureScreenshot", "screen", []).mode).toBe("screen");
  });

  it("trusts the stored mode while support is unknown", () => {
    expect(resolveShortcutCapture("captureScreenshot", "screen", null).mode).toBe("screen");
  });

  it("a mode-specific shortcut captures with its mode and makes it current", () => {
    expect(resolveShortcutCapture("captureScreen", "area", ALL)).toEqual({
      mode: "screen",
      remember: true,
    });
    expect(resolveShortcutCapture("captureFrame", "screen", ALL)).toEqual({
      mode: "frame",
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
    expect(resolveShortcutCapture("captureFrame", "area", ALL, true)).toEqual({
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
    expect(resolveShortcutCapture("captureFrame", "area", ["area", "screen"])).toEqual({
      mode: "frame",
      remember: false,
    });
  });
});
