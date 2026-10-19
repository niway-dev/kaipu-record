import { describe, expect, it } from "vitest";

import { detectDesktopOs } from "./desktop-os";

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

describe("detectDesktopOs", () => {
  it("prefers the platform hint when the browser gives one", () => {
    expect(detectDesktopOs({ userAgentData: { platform: "macOS" }, userAgent: WINDOWS_UA })).toBe(
      "mac",
    );
    expect(detectDesktopOs({ userAgentData: { platform: "Windows" }, userAgent: MAC_UA })).toBe(
      "windows",
    );
  });

  it("falls back to the user agent", () => {
    expect(detectDesktopOs({ userAgent: MAC_UA })).toBe("mac");
    expect(detectDesktopOs({ userAgent: WINDOWS_UA })).toBe("windows");
  });

  it("gives phones, tablets, Linux and unknown browsers the plain list", () => {
    expect(detectDesktopOs({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0" })).toBe(
      "other",
    );
    expect(
      detectDesktopOs({
        userAgentData: { platform: "Android" },
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
      }),
    ).toBe("other");
    expect(
      detectDesktopOs({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari" }),
    ).toBe("other");
    expect(detectDesktopOs({})).toBe("other");
    expect(detectDesktopOs(undefined)).toBe("other");
  });
});
