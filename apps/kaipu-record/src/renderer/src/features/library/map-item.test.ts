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
  editSavedAt: 123,
  editExportedSavedAt: null,
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
  it("carries an MP4 export's preset and fingerprint, null for anything else (NIW2-218)", () => {
    expect(toLibraryVideo(item).export).toBeNull();
    const exported = {
      ...item,
      local: { ...item.local!, export: { preset: "youtube" as const, fingerprint: "whole" } },
    };
    expect(toLibraryVideo(exported).export).toEqual({ preset: "youtube", fingerprint: "whole" });
  });

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
      editSavedAt: 123,
      editExportedSavedAt: null,
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
