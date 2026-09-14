import { describe, expect, it } from "vitest";
import { MAX_SCREENSHOT_BYTES, MAX_VIDEO_BYTES } from "../constants/cloud-limits";
import {
  accountPrefixes,
  buildRevisionStorageKey,
  buildThumbnailStorageKey,
  computeMissingBytes,
  createUploadIntentSchema,
  isSupportedContentType,
  isValidUploadSize,
  toAssetSummary,
  type CloudAsset,
  type CloudRevision,
} from "./cloud-asset";

const SHA = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="; // base64 sha256 of ""
const UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("createUploadIntentSchema", () => {
  const valid = {
    assetId: UUID,
    intentKey: "9b2c1f3e-1111-4222-8333-444455556666",
    kind: "recording" as const,
    title: "Demo",
    contentType: "video/mp4",
    sizeBytes: 1000,
    contentSha256: SHA,
    durationSeconds: 12,
    thumbnail: { sizeBytes: 2000, contentSha256: SHA },
  };

  it("accepts a well-formed intent and defaults optional fields", () => {
    const parsed = createUploadIntentSchema.parse({ ...valid, thumbnail: undefined });
    expect(parsed.durationSeconds).toBe(12);
    expect(parsed.derivedFromAssetId).toBeNull();
    expect(parsed.thumbnail).toBeNull();
  });

  it("rejects non-uuid ids, empty hashes and non-positive sizes", () => {
    expect(() => createUploadIntentSchema.parse({ ...valid, assetId: "x" })).toThrow();
    expect(() => createUploadIntentSchema.parse({ ...valid, contentSha256: "" })).toThrow();
    expect(() => createUploadIntentSchema.parse({ ...valid, sizeBytes: 0 })).toThrow();
  });
});

describe("pure rules", () => {
  it("allows only product-supported content types per kind", () => {
    expect(isSupportedContentType("recording", "video/mp4")).toBe(true);
    expect(isSupportedContentType("recording", "video/webm")).toBe(true);
    expect(isSupportedContentType("recording", "image/png")).toBe(false);
    expect(isSupportedContentType("screenshot", "image/png")).toBe(true);
    expect(isSupportedContentType("screenshot", "application/octet-stream")).toBe(false);
    expect(isSupportedContentType("recording", "video/mp4; codecs=avc1")).toBe(true);
  });

  it("validates size against the per-kind cap", () => {
    expect(isValidUploadSize("recording", MAX_VIDEO_BYTES)).toBe(true);
    expect(isValidUploadSize("recording", MAX_VIDEO_BYTES + 1)).toBe(false);
    expect(isValidUploadSize("screenshot", MAX_SCREENSHOT_BYTES + 1)).toBe(false);
    expect(isValidUploadSize("screenshot", 0)).toBe(false);
  });

  it("computes the missing bytes from committed occupation (used + reserved)", () => {
    expect(
      computeMissingBytes({ capacityBytes: 1000, usedBytes: 800, reservedBytes: 0 }, 550),
    ).toBe(350);
    expect(
      computeMissingBytes({ capacityBytes: 1000, usedBytes: 800, reservedBytes: 150 }, 50),
    ).toBe(0);
    expect(
      computeMissingBytes({ capacityBytes: 1000, usedBytes: 800, reservedBytes: 150 }, 51),
    ).toBe(1);
  });

  it("lays out keys as <prefix>/<userId>/<assetId>/<revisionId>.<ext>", () => {
    expect(
      buildRevisionStorageKey({
        userId: "u1",
        assetId: "a1",
        revisionId: "r1",
        kind: "recording",
        contentType: "video/mp4",
      }),
    ).toBe("videos/u1/a1/r1.mp4");
    expect(
      buildRevisionStorageKey({
        userId: "u1",
        assetId: "a1",
        revisionId: "r1",
        kind: "screenshot",
        contentType: "image/png",
      }),
    ).toBe("img/u1/a1/r1.png");
    expect(
      buildThumbnailStorageKey({
        userId: "u1",
        assetId: "a1",
        revisionId: "r1",
        kind: "recording",
      }),
    ).toBe("videos/u1/a1/r1.thumb.jpg");
    expect(accountPrefixes("u1")).toEqual(["videos/u1/", "img/u1/"]);
  });

  it("summarises an asset with its current ready revision, hiding storage keys", () => {
    const asset: CloudAsset = {
      assetId: "a1",
      userId: "u1",
      kind: "recording",
      title: "Demo",
      currentRevisionId: "r1",
      durationSeconds: 12,
      derivedFromAssetId: null,
      autoUploadExcluded: false,
      createdAt: new Date(1),
      updatedAt: new Date(2),
      deletedAt: null,
    };
    const revision: CloudRevision = {
      revisionId: "r1",
      assetId: "a1",
      userId: "u1",
      intentKey: "k1",
      status: "ready",
      storageKey: "videos/u1/a1/r1.mp4",
      thumbnailKey: "videos/u1/a1/r1.thumb.jpg",
      contentType: "video/mp4",
      sizeBytes: 1000,
      thumbnailBytes: 200,
      contentSha256: SHA,
      reservedBytes: 1200,
      ticketExpiresAt: new Date(3),
      verifiedAt: new Date(4),
      createdAt: new Date(1),
      updatedAt: new Date(4),
    };
    const summary = toAssetSummary(asset, revision);
    expect(summary).toMatchObject({
      assetId: "a1",
      currentRevisionId: "r1",
      sizeBytes: 1000,
      hasThumbnail: true,
    });
    expect(JSON.stringify(summary)).not.toContain("videos/u1");
    expect(toAssetSummary({ ...asset, currentRevisionId: null }, null)).toMatchObject({
      currentRevisionId: null,
      sizeBytes: null,
      contentSha256: null,
      hasThumbnail: false,
    });
  });
});
