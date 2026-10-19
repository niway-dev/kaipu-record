import { describe, expect, it } from "vitest";
import { detectDesktopOs } from "./desktop-os";

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const WIN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

describe("detectDesktopOs", () => {
  it("prefers userAgentData.platform", () => {
    expect(detectDesktopOs({ userAgentData: { platform: "macOS" }, userAgent: "" })).toBe("mac");
    expect(detectDesktopOs({ userAgentData: { platform: "Windows" }, userAgent: "" })).toBe(
      "windows",
    );
  });

  it("falls back to the user agent", () => {
    expect(detectDesktopOs({ userAgent: MAC_UA })).toBe("mac");
    expect(detectDesktopOs({ userAgent: WIN_UA })).toBe("windows");
  });

  it("does not guess for Linux, phones, tablets or no navigator", () => {
    expect(detectDesktopOs({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe("other");
    expect(detectDesktopOs({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" })).toBe(
      "other",
    );
    expect(detectDesktopOs({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" })).toBe(
      "other",
    );
    expect(detectDesktopOs({ userAgentData: { platform: "Android", mobile: true } })).toBe("other");
    // An iPad pretends to be a Mac; the touch screen gives it away.
    expect(detectDesktopOs({ userAgent: MAC_UA, maxTouchPoints: 5 })).toBe("other");
    expect(detectDesktopOs(undefined)).toBe("other");
  });
});
