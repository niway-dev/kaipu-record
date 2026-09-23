import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "./types";
import { buildLineage, editBadge } from "./lineage";

function video(partial: Partial<LibraryVideo> & { assetId: string }): LibraryVideo {
  return {
    id: partial.assetId,
    kind: "recording",
    title: partial.assetId,
    createdAt: 1_000,
    durationSeconds: 10,
    fileSizeBytes: 1,
    cloudSizeBytes: null,
    thumbnailUrl: null,
    availability: "local",
    comparison: "same",
    editing: "project-available",
    transfer: { state: "idle" },
    derivedFromAssetId: null,
    editSavedAt: null,
    ...partial,
  };
}

describe("buildLineage", () => {
  it("indexes by assetId and groups exports under their source, newest first", () => {
    const src = video({ assetId: "src", createdAt: 100 });
    const older = video({ assetId: "e1", derivedFromAssetId: "src", createdAt: 200 });
    const newer = video({ assetId: "e2", derivedFromAssetId: "src", createdAt: 300 });
    const { byAssetId, exportsOf } = buildLineage([older, src, newer]);
    expect(byAssetId.get("src")).toBe(src);
    expect(exportsOf.get("src")?.map((v) => v.assetId)).toEqual(["e2", "e1"]);
    expect(exportsOf.get("e1")).toBeUndefined();
  });

  it("keeps an export whose source is missing from the list (source deleted)", () => {
    const orphan = video({ assetId: "e", derivedFromAssetId: "gone" });
    const { byAssetId, exportsOf } = buildLineage([orphan]);
    expect(byAssetId.get("gone")).toBeUndefined();
    expect(exportsOf.get("gone")?.map((v) => v.assetId)).toEqual(["e"]);
  });

  it("ignores screenshots on both sides of the relation", () => {
    const shot = video({ assetId: "s", kind: "screenshot", derivedFromAssetId: "src" });
    const { exportsOf } = buildLineage([video({ assetId: "src" }), shot]);
    expect(exportsOf.get("src")).toBeUndefined();
  });
});

describe("editBadge", () => {
  it("is null without a session", () => {
    const v = video({ assetId: "a" });
    expect(editBadge(v, buildLineage([v]))).toBeNull();
  });

  it("is not-exported when the session is newer than every export (or there is none)", () => {
    const v = video({ assetId: "a", editSavedAt: 500 });
    expect(editBadge(v, buildLineage([v]))).toBe("not-exported");
    const olderExport = video({ assetId: "e", derivedFromAssetId: "a", createdAt: 400 });
    expect(editBadge(v, buildLineage([v, olderExport]))).toBe("not-exported");
  });

  it("is edited when an export is newer than the session", () => {
    const v = video({ assetId: "a", editSavedAt: 500 });
    const newerExport = video({ assetId: "e", derivedFromAssetId: "a", createdAt: 600 });
    expect(editBadge(v, buildLineage([v, newerExport]))).toBe("edited");
  });

  it("is null for screenshots and for exports themselves", () => {
    const shot = video({ assetId: "s", kind: "screenshot", editSavedAt: 500 });
    const exp = video({ assetId: "e", derivedFromAssetId: "a", editSavedAt: 500 });
    const lineage = buildLineage([shot, exp]);
    expect(editBadge(shot, lineage)).toBeNull();
    expect(editBadge(exp, lineage)).toBeNull();
  });
});
