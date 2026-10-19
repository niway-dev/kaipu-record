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
    editExportedSavedAt: null,
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

  it("is never-exported while the recording has no export at all", () => {
    const v = video({ assetId: "a", editSavedAt: 500 });
    expect(editBadge(v, buildLineage([v]))).toBe("never-exported");
  });

  it("is edited when the stamp matches the session, whatever the export's date says", () => {
    // `createdAt: 400` is BEFORE `editSavedAt: 500` — the shape that made the old rule
    // wrong. An export's createdAt is its birthtime, the moment the encode started, and
    // exporting always saves the session afterwards, so a correct export looks "older"
    // than the scene it contains. The stamp is what settles it.
    const v = video({ assetId: "a", editSavedAt: 500, editExportedSavedAt: 500 });
    const exported = video({ assetId: "e", derivedFromAssetId: "a", createdAt: 400 });
    expect(editBadge(v, buildLineage([v, exported]))).toBe("edited");
  });

  it("is stale when the session was saved again after the export", () => {
    const v = video({ assetId: "a", editSavedAt: 900, editExportedSavedAt: 500 });
    const exported = video({ assetId: "e", derivedFromAssetId: "a", createdAt: 1_000 });
    expect(editBadge(v, buildLineage([v, exported]))).toBe("stale");
  });

  it("is stale for a session written before the stamp existed", () => {
    // Pre-existing sessions have no `exportedSavedAt`. Reading that as "the newest edits
    // are in no file" points at the export button; reading it as "edited" would promise
    // a file we have no evidence exists.
    const v = video({ assetId: "a", editSavedAt: 900, editExportedSavedAt: null });
    const exported = video({ assetId: "e", derivedFromAssetId: "a", createdAt: 1_000 });
    expect(editBadge(v, buildLineage([v, exported]))).toBe("stale");
  });

  it("returns to never-exported when the only export is deleted", () => {
    // The stamp still says this scene was exported once, but the file is gone, so no
    // file carries the edits any more — which is what the badge is actually about.
    const v = video({ assetId: "a", editSavedAt: 500, editExportedSavedAt: 500 });
    expect(editBadge(v, buildLineage([v]))).toBe("never-exported");
  });

  it("is null for screenshots and for exports themselves", () => {
    const shot = video({ assetId: "s", kind: "screenshot", editSavedAt: 500 });
    const exp = video({ assetId: "e", derivedFromAssetId: "a", editSavedAt: 500 });
    const lineage = buildLineage([shot, exp]);
    expect(editBadge(shot, lineage)).toBeNull();
    expect(editBadge(exp, lineage)).toBeNull();
  });
});

describe("GIF exports in the lineage (NIW2-217)", () => {
  it("lists a GIF export under its source like an MP4 export", () => {
    const source = video({ assetId: "src", editSavedAt: 5, editExportedSavedAt: 5 });
    const gif = video({ assetId: "g", kind: "gif", derivedFromAssetId: "src" });
    const lineage = buildLineage([source, gif]);
    expect(lineage.exportsOf.get("src")?.map((v) => v.assetId)).toEqual(["g"]);
    expect(editBadge(source, lineage)).toBe("edited");
    expect(editBadge(gif, lineage)).toBeNull();
  });
});
