import { describe, expect, it } from "vitest";
import { resolveShortcutCapture } from "./shortcut-capture";

const ALL = ["frame", "window", "screen"] as const;

describe("resolveShortcutCapture", () => {
  it("the generic shortcut opens with the stored current mode", () => {
    expect(resolveShortcutCapture("captureScreenshot", "frame", ALL)).toEqual({ mode: "frame" });
    expect(resolveShortcutCapture("captureScreenshot", "window", ALL).mode).toBe("window");
  });

  it("the generic shortcut falls back to Frame when the stored mode is not served", () => {
    expect(resolveShortcutCapture("captureScreenshot", "window", ["frame", "screen"])).toEqual({
      mode: "frame",
    });
  });

  it("keeps the stored mode when not even Frame is served, so the capture says why", () => {
    expect(resolveShortcutCapture("captureScreenshot", "screen", []).mode).toBe("screen");
  });

  it("trusts the stored mode while support is unknown", () => {
    expect(resolveShortcutCapture("captureScreenshot", "screen", null).mode).toBe("screen");
  });

  it("a mode-specific shortcut opens with its own mode and remembers nothing by itself", () => {
    expect(resolveShortcutCapture("captureScreen", "frame", ALL)).toEqual({ mode: "screen" });
    expect(resolveShortcutCapture("captureFrame", "screen", ALL)).toEqual({ mode: "frame" });
    expect(resolveShortcutCapture("captureWindow", "frame", ALL)).toEqual({ mode: "window" });
  });

  it("opens with a mode the platform cannot serve, so the capture answers unsupported", () => {
    expect(resolveShortcutCapture("captureWindow", "frame", ["frame", "screen"])).toEqual({
      mode: "window",
    });
  });
});
