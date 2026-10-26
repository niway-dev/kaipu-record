import { afterEach, describe, expect, it, vi } from "vitest";
import { actionForKey, copyKeyLabel, detectKeyPlatform, recordKeyLabel } from "./overlay-keys";

const api = window.electronAPI as { platform: string };
const original = api.platform;

afterEach(() => {
  api.platform = original;
  vi.unstubAllGlobals();
});

describe("detectKeyPlatform", () => {
  it("reads the preload bridge, not the browser's report", () => {
    // A Mac-looking navigator must not win over a bridge that says Windows.
    vi.stubGlobal("navigator", { ...navigator, platform: "MacIntel" });
    api.platform = "win32";
    expect(detectKeyPlatform()).toBe("other");
    expect(copyKeyLabel(detectKeyPlatform())).toBe("Ctrl+C");

    api.platform = "darwin";
    expect(detectKeyPlatform()).toBe("mac");
    expect(copyKeyLabel(detectKeyPlatform())).toBe("⌘C");
  });

  it("falls back to the browser only when the bridge reports nothing", () => {
    api.platform = "";
    vi.stubGlobal("navigator", { ...navigator, platform: "Win32" });
    expect(detectKeyPlatform()).toBe("other");
    vi.stubGlobal("navigator", { ...navigator, platform: "MacIntel" });
    expect(detectKeyPlatform()).toBe("mac");
  });
});

describe("actionForKey", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("Enter takes the screenshot when the overlay opened to capture", () => {
    expect(actionForKey(key({ key: "Enter" }), "mac", "capture")).toBe("capture");
  });

  it("Enter keeps the selection as the recording target when it opened to record", () => {
    expect(actionForKey(key({ key: "Enter" }), "mac", "record")).toBe("select");
  });

  it("R alone records, in either intent, on every platform", () => {
    expect(actionForKey(key({ key: "r" }), "mac", "capture")).toBe("record");
    expect(actionForKey(key({ key: "R" }), "other", "record")).toBe("record");
  });

  it("⌘R and Ctrl+R are not Record: packaged builds swallow them before the page", () => {
    // @electron-toolkit's watchWindowShortcuts preventDefaults Ctrl/Cmd+R outside dev.
    expect(actionForKey(key({ key: "r", metaKey: true }), "mac", "capture")).toBeNull();
    expect(actionForKey(key({ key: "r", ctrlKey: true }), "other", "capture")).toBeNull();
    expect(actionForKey(key({ key: "r", altKey: true }), "mac", "capture")).toBeNull();
  });

  it("⌘C copies only when the overlay opened to capture", () => {
    expect(actionForKey(key({ key: "c", metaKey: true }), "mac", "capture")).toBe("copy");
    expect(actionForKey(key({ key: "c", metaKey: true }), "mac", "record")).toBeNull();
  });

  it("prints the record key per platform", () => {
    expect(recordKeyLabel("mac")).toBe("R");
    expect(recordKeyLabel("other")).toBe("R");
  });
});
