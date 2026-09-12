import { describe, expect, it } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import { toLibraryVideo } from "./map-item";

const item: LibraryItem = {
  assetId: "A",
  kind: "recording",
  title: "T",
  createdAt: 5,
  durationSeconds: 9,
  derivedFromAssetId: null,
  local: {
    id: "f",
    assetId: "A",
    kind: "recording",
    title: "T",
    filePath: "/v/f.mp4",
    createdAt: 5,
    sizeBytes: 10,
    durationSeconds: 9,
    thumbnailUrl: "kaipu-media://thumb/f",
    derivedFromAssetId: null,
    contentSha256: null,
  },
  cloud: {
    assetId: "A",
    kind: "recording",
    title: "T",
    revisionId: "r",
    contentType: "video/mp4",
    sizeBytes: 12,
    contentSha256: "x",
    durationSeconds: 9,
    hasThumbnail: true,
    derivedFromAssetId: null,
    autoUploadExcluded: false,
    createdAt: 5,
    lastVerifiedAt: 1,
    lastSeenLocalId: "f",
  },
  availability: "local-and-cloud",
  transfer: { state: "idle" },
  comparison: "local-changes",
  editing: "project-available",
  sharing: "private",
};

describe("toLibraryVideo", () => {
  it("keeps the local id, the asset id, both sizes and the axes", () => {
    expect(toLibraryVideo(item)).toMatchObject({
      id: "f",
      assetId: "A",
      fileSizeBytes: 10,
      cloudSizeBytes: 12,
      availability: "local-and-cloud",
      comparison: "local-changes",
      editing: "project-available",
      thumbnailUrl: "kaipu-media://thumb/f",
    });
  });

  it("a cloud-only item has no local id, no thumbnail yet, and the cloud size as its size", () => {
    const cloudOnly = { ...item, local: null, availability: "cloud" as const };
    expect(toLibraryVideo(cloudOnly)).toMatchObject({
      id: null,
      fileSizeBytes: 12,
      thumbnailUrl: null,
      availability: "cloud",
    });
  });
});
