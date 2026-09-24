import { describe, expect, it } from "vitest";
import type { LocalRecording } from "@shared/types/library-storage";
import type { CloudCatalogEntry } from "@shared/types/library-item";
import { composeLibrary } from "./compose-library";

const SHA = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const OTHER = "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=";

const local = (
  id: string,
  assetId: string,
  overrides: Partial<LocalRecording> = {},
): LocalRecording => ({
  id,
  assetId,
  kind: "recording",
  title: `Local ${id}`,
  filePath: `/v/${id}.mp4`,
  createdAt: 100,
  sizeBytes: 10,
  durationSeconds: 5,
  thumbnailUrl: null,
  derivedFromAssetId: null,
  contentSha256: SHA,
  ...overrides,
});
const cloud = (assetId: string, overrides: Partial<CloudCatalogEntry> = {}): CloudCatalogEntry => ({
  assetId,
  kind: "recording",
  title: `Cloud ${assetId}`,
  revisionId: "r1",
  contentType: "video/mp4",
  sizeBytes: 10,
  contentSha256: SHA,
  durationSeconds: 5,
  hasThumbnail: false,
  derivedFromAssetId: null,
  autoUploadExcluded: false,
  createdAt: 50,
  lastVerifiedAt: 1,
  lastSeenLocalId: null,
  ...overrides,
});

describe("composeLibrary", () => {
  it("merges a local file and its cloud revision into ONE entry, local title wins", () => {
    const { items, catalogUpdates } = composeLibrary({
      local: [local("f1", "A")],
      catalog: [cloud("A")],
      editing: {},
      editSavedAt: {},
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      assetId: "A",
      title: "Local f1",
      availability: "local-and-cloud",
      comparison: "same",
    });
    expect(catalogUpdates[0]?.lastSeenLocalId).toBe("f1");
  });

  it("keeps cloud-only items visible without a local file, and local-only items without cloud", () => {
    const { items } = composeLibrary({
      local: [local("f1", "A")],
      catalog: [cloud("B")],
      editing: {},
      editSavedAt: {},
    });
    expect(items.map((i) => [i.assetId, i.availability])).toEqual([
      ["A", "local"],
      ["B", "cloud"],
    ]);
  });

  it("flags local changes when hashes differ and pending when the local hash is unknown", () => {
    const changed = composeLibrary({
      local: [local("f1", "A", { contentSha256: OTHER })],
      catalog: [cloud("A")],
      editing: {},
      editSavedAt: {},
    });
    expect(changed.items[0]?.comparison).toBe("local-changes");
    const unknown = composeLibrary({
      local: [local("f1", "A", { contentSha256: null })],
      catalog: [cloud("A")],
      editing: {},
      editSavedAt: {},
    });
    expect(unknown.items[0]?.comparison).toBe("pending");
  });

  it("an unreadable vault shows items last seen locally as local-unavailable, never as cloud-only", () => {
    const { items } = composeLibrary({
      local: null,
      catalog: [cloud("A", { lastSeenLocalId: "f1" }), cloud("B")],
      editing: {},
      editSavedAt: {},
    });
    expect(items.map((i) => [i.assetId, i.availability])).toEqual([
      ["A", "local-unavailable"],
      ["B", "cloud"],
    ]);
  });

  it("a readable vault where the file is gone shows the item as cloud (download to edit)", () => {
    const { items } = composeLibrary({
      local: [],
      catalog: [cloud("A", { lastSeenLocalId: "f1" })],
      editing: {},
      editSavedAt: {},
    });
    expect(items[0]?.availability).toBe("cloud");
    expect(items[0]?.editing).toBe("needs-source");
  });

  it("after the file is gone on a readable vault, catalogUpdates clears lastSeenLocalId", () => {
    const { catalogUpdates } = composeLibrary({
      local: [],
      catalog: [cloud("A", { lastSeenLocalId: "f1" })],
      editing: {},
      editSavedAt: {},
    });
    expect(catalogUpdates[0]?.lastSeenLocalId).toBeNull();
  });

  it("does not associate by filename: same local id, different assetId is a different item", () => {
    const { items } = composeLibrary({
      local: [local("f1", "NEW")],
      catalog: [cloud("OLD", { lastSeenLocalId: "f1" })],
      editing: {},
      editSavedAt: {},
    });
    expect(items.map((i) => i.assetId).sort()).toEqual(["NEW", "OLD"]);
  });

  it("an export is a separate item related to its source; the editing axis comes from the probe", () => {
    const { items } = composeLibrary({
      local: [local("src", "S"), local("exp", "E", { derivedFromAssetId: "S", createdAt: 200 })],
      catalog: null,
      editing: { src: "project-available", exp: "exported-only" },
      editSavedAt: {},
    });
    expect(items.map((i) => i.assetId)).toEqual(["E", "S"]); // newest first
    expect(items[0]).toMatchObject({ derivedFromAssetId: "S", editing: "exported-only" });
    expect(items[1]).toMatchObject({
      editing: "project-available",
      transfer: { state: "idle" },
      sharing: "private",
    });
  });

  it("carries editSavedAt from the probe for local items and null for cloud-only ones", () => {
    const { items } = composeLibrary({
      local: [local("f1", "A")],
      catalog: [cloud("B")],
      editing: {},
      editSavedAt: { f1: 1_700_000_000_000 },
    });
    expect(items.find((i) => i.assetId === "A")?.editSavedAt).toBe(1_700_000_000_000);
    expect(items.find((i) => i.assetId === "B")?.editSavedAt).toBeNull();
  });

  it("with no account there are only local items", () => {
    const { items, catalogUpdates } = composeLibrary({
      local: [local("f1", "A")],
      catalog: null,
      editing: {},
      editSavedAt: {},
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.cloud).toBeNull();
    expect(catalogUpdates).toEqual([]);
  });
});
