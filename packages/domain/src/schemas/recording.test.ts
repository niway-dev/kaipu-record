import { describe, expect, it } from "vitest";

import {
  buildStorageKey,
  createRecordingUploadSchema,
  extensionForContentType,
  isWithinUploadLimit,
  MAX_UPLOAD_BYTES,
} from "./recording";

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
  it("namespaces by user and suffixes by extension", () => {
    expect(buildStorageKey({ userId: "u1", recordingId: "r1", contentType: "video/webm" })).toBe(
      "recordings/u1/r1.webm",
    );
  });

  it("uses bin for an unknown content type", () => {
    expect(buildStorageKey({ userId: "u1", recordingId: "r1", contentType: "weird/thing" })).toBe(
      "recordings/u1/r1.bin",
    );
  });
});

describe("isWithinUploadLimit", () => {
  it("accepts a positive size up to the cap", () => {
    expect(isWithinUploadLimit(1)).toBe(true);
    expect(isWithinUploadLimit(MAX_UPLOAD_BYTES)).toBe(true);
  });

  it("rejects zero, negative, and over-cap sizes", () => {
    expect(isWithinUploadLimit(0)).toBe(false);
    expect(isWithinUploadLimit(-5)).toBe(false);
    expect(isWithinUploadLimit(MAX_UPLOAD_BYTES + 1)).toBe(false);
  });
});

describe("createRecordingUploadSchema", () => {
  it("defaults durationSeconds to 0 and requires a positive size", () => {
    const parsed = createRecordingUploadSchema.parse({
      title: "Demo",
      kind: "recording",
      contentType: "video/webm",
      sizeBytes: 1234,
    });
    expect(parsed.durationSeconds).toBe(0);
  });

  it("rejects an empty title and a non-positive size", () => {
    expect(
      createRecordingUploadSchema.safeParse({
        title: "",
        kind: "recording",
        contentType: "video/webm",
        sizeBytes: 1,
      }).success,
    ).toBe(false);
    expect(
      createRecordingUploadSchema.safeParse({
        title: "ok",
        kind: "recording",
        contentType: "video/webm",
        sizeBytes: 0,
      }).success,
    ).toBe(false);
  });
});
