import { describe, expect, it } from "vitest";

import { downloadUrls, platformForUrl } from "./download";

describe("platformForUrl", () => {
  it("maps each installer URL to its platform", () => {
    expect(platformForUrl(downloadUrls.macArm64)).toBe("mac-arm64");
    expect(platformForUrl(downloadUrls.macX64)).toBe("mac-x64");
    expect(platformForUrl(downloadUrls.windowsX64)).toBe("windows");
  });

  it("returns null for a URL that is not an installer", () => {
    expect(platformForUrl("https://example.com/other.dmg")).toBeNull();
    expect(platformForUrl("#download")).toBeNull();
  });
});
