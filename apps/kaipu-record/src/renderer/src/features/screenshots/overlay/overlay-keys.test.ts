import { afterEach, describe, expect, it, vi } from "vitest";
import { copyKeyLabel, detectKeyPlatform } from "./overlay-keys";

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
