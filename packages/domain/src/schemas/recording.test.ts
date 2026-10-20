import { describe, expect, it } from "vitest";

import { buildStorageKey, extensionForContentType } from "./recording";

describe("extensionForContentType", () => {
  it("maps known video and image types", () => {
    expect(extensionForContentType("video/webm")).toBe("webm");
    expect(extensionForContentType("video/mp4")).toBe("mp4");
    expect(extensionForContentType("image/png")).toBe("png");
    expect(extensionForContentType("image/jpeg")).toBe("jpg");
  });

  it("ignores codec params and case", () => {
    expect(extensionForContentType("video/webm; codecs=vp9,opus")).toBe("webm");
    expect(extensionForContentType("VIDEO/MP4")).toBe("mp4");
  });

  it("falls back to bin for unknown types", () => {
    expect(extensionForContentType("application/octet-stream")).toBe("bin");
    expect(extensionForContentType("")).toBe("bin");
  });
});

describe("buildStorageKey", () => {
  it("splits videos vs images by kind and namespaces by user", () => {
    expect(
      buildStorageKey({
        userId: "u1",
        recordingId: "r1",
        kind: "recording",
        contentType: "video/webm",
      }),
    ).toBe("videos/u1/r1.webm");
    expect(
      buildStorageKey({
        userId: "u1",
        recordingId: "s1",
        kind: "screenshot",
        contentType: "image/png",
      }),
    ).toBe("img/u1/s1.png");
  });

  it("uses bin for an unknown content type", () => {
    expect(
      buildStorageKey({
        userId: "u1",
        recordingId: "r1",
        kind: "recording",
        contentType: "weird/thing",
      }),
    ).toBe("videos/u1/r1.bin");
  });
});
