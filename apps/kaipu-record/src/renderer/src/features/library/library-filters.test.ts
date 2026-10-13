import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "./types";
import { countByKind, countByStorage, facetCounts, selectVisibleVideos } from "./library-filters";

function video(overrides: Partial<LibraryVideo> = {}): LibraryVideo {
  return {
    id: "id",
    assetId: "asset-id",
    kind: "recording",
    title: "Recording",
    createdAt: 0,
    durationSeconds: 10,
    fileSizeBytes: 1000,
    cloudSizeBytes: null,
    availability: "local",
    comparison: "same",
    editing: "project-available",
    transfer: { state: "idle" },
    derivedFromAssetId: null,
    editSavedAt: null,
    editExportedSavedAt: null,
    ...overrides,
  };
}

const newest = video({ id: "a", title: "Alpha", createdAt: 300, fileSizeBytes: 100 });
const middle = video({ id: "b", title: "Bravo", createdAt: 200, fileSizeBytes: 900 });
const oldest = video({ id: "c", title: "Charlie", createdAt: 100, fileSizeBytes: 500 });
const cloud = video({ id: null, title: "Delta", createdAt: 250, availability: "cloud" });
const shot = video({ id: "s", title: "Shot", createdAt: 175, kind: "screenshot" });

const base = {
  kindFilter: "all" as const,
  storageFilter: "all" as const,
  sortKey: "newest" as const,
  searchTerm: "",
  tags: [] as string[],
};

describe("selectVisibleVideos", () => {
  it("returns everything sorted newest-first when no filters are active", () => {
    const result = selectVisibleVideos([oldest, newest, middle], base);
    expect(result.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts oldest-first", () => {
    const result = selectVisibleVideos([newest, oldest, middle], {
      ...base,
      sortKey: "oldest",
    });
    expect(result.map((v) => v.id)).toEqual(["c", "b", "a"]);
  });

  it("sorts largest-first by file size", () => {
    const result = selectVisibleVideos([newest, oldest, middle], {
      ...base,
      sortKey: "largest",
    });
    expect(result.map((v) => v.id)).toEqual(["b", "c", "a"]);
  });

  it("the local and cloud chips overlap: an item with both copies matches both", () => {
    const both = video({ id: "b", availability: "local-and-cloud" });
    const onlyLocal = video({ id: "l", availability: "local" });
    const onlyCloud = video({ id: "c", availability: "cloud" });
    const all = [both, onlyLocal, onlyCloud];
    expect(selectVisibleVideos(all, { ...base, storageFilter: "local" }).map((v) => v.id)).toEqual([
      "b",
      "l",
    ]);
    expect(selectVisibleVideos(all, { ...base, storageFilter: "cloud" }).map((v) => v.id)).toEqual([
      "b",
      "c",
    ]);
    expect(selectVisibleVideos(all, { ...base, storageFilter: "all" })).toHaveLength(3);
    expect(countByStorage(all)).toEqual({ local: 2, cloud: 2 });
  });

  it("filters by kind, leaving 'all' untouched", () => {
    const videos = [newest, shot, middle];
    expect(selectVisibleVideos(videos, { ...base, kindFilter: "all" })).toHaveLength(3);
    expect(
      selectVisibleVideos(videos, { ...base, kindFilter: "screenshot" }).map((v) => v.id),
    ).toEqual(["s"]);
    expect(
      selectVisibleVideos(videos, { ...base, kindFilter: "recording" }).map((v) => v.id),
    ).toEqual(["a", "b"]);
  });

  it("combines the kind and storage filters", () => {
    const cloudShot = video({
      id: null,
      kind: "screenshot",
      availability: "cloud",
      createdAt: 5,
    });
    const result = selectVisibleVideos([newest, shot, cloudShot], {
      ...base,
      kindFilter: "screenshot",
      storageFilter: "cloud",
    });
    expect(result.map((v) => v.id)).toEqual([null]);
  });

  it("filters by search term, case-insensitively and trimmed, matching the title", () => {
    const result = selectVisibleVideos([newest, middle, oldest], {
      ...base,
      searchTerm: "  BRA ",
    });
    expect(result.map((v) => v.id)).toEqual(["b"]);
  });

  it("combines storage filter, search, and sort together", () => {
    const localAlpha = video({ id: "x", title: "Report final", createdAt: 10 });
    const localBeta = video({ id: "y", title: "Report draft", createdAt: 20 });
    const cloudReport = video({ id: null, title: "Report cloud", availability: "cloud" });
    const result = selectVisibleVideos([localAlpha, localBeta, cloudReport], {
      kindFilter: "all",
      storageFilter: "local",
      sortKey: "oldest",
      searchTerm: "report",
      tags: [],
    });
    expect(result.map((v) => v.id)).toEqual(["x", "y"]);
  });

  it("does not mutate the input array", () => {
    const input = [oldest, newest, middle];
    selectVisibleVideos(input, base);
    expect(input.map((v) => v.id)).toEqual(["c", "a", "b"]);
  });
});

describe("selectVisibleVideos with tags", () => {
  // Tags are referenced by id; names and slugs come from the registry.
  const tagText = new Map([
    ["t-cricut", "cricut cricut"],
    ["t-video", "video video"],
    ["t-kaipu", "kaipu kaipu"],
    ["t-issue", "issue #1232 issue_#1232"],
  ]);
  const both = video({
    id: "both",
    title: "Cutting mat",
    tagIds: ["t-cricut", "t-video", "t-kaipu"],
  });
  const cricutOnly = video({ id: "cricut", title: "Vinyl", tagIds: ["t-cricut"] });
  const issue = video({ id: "issue", title: "Bug repro", tagIds: ["t-issue", "t-video"] });
  // An item without a sidecar has no tags at all.
  const noSidecar = video({ id: "bare", title: "Hand imported" });
  const all = [both, cricutOnly, issue, noSidecar];
  const withTags = { ...base, tagText };

  it("narrows with AND: every selected tag must be on the item", () => {
    const result = selectVisibleVideos(all, { ...withTags, tags: ["t-cricut", "t-video"] });
    expect(result.map((v) => v.id)).toEqual(["both"]);
  });

  it("keeps items with no tags (and no sidecar) while no tag is selected", () => {
    const result = selectVisibleVideos(all, withTags);
    expect(result.map((v) => v.id)).toContain("bare");
    expect(result).toHaveLength(4);
  });

  it("matches the search term against tag names and slugs as well as the title", () => {
    expect(selectVisibleVideos(all, { ...withTags, searchTerm: "1232" }).map((v) => v.id)).toEqual([
      "issue",
    ]);
    expect(
      selectVisibleVideos(all, { ...withTags, searchTerm: "#Cricut" })
        .map((v) => v.id)
        .sort(),
    ).toEqual(["both", "cricut"]);
  });

  it("combines tags with the other filters", () => {
    const result = selectVisibleVideos(all, { ...withTags, tags: ["t-video"], searchTerm: "bug" });
    expect(result.map((v) => v.id)).toEqual(["issue"]);
  });
});

describe("countByStorage", () => {
  it("counts videos per location, local and cloud overlapping", () => {
    const counts = countByStorage([newest, middle, cloud]);
    expect(counts).toEqual({ local: 2, cloud: 1 });
  });

  it("returns zeros for an empty library", () => {
    expect(countByStorage([])).toEqual({ local: 0, cloud: 0 });
  });
});

describe("countByKind", () => {
  it("counts items per kind plus the total", () => {
    expect(countByKind([newest, middle, shot])).toEqual({
      all: 3,
      recording: 2,
      screenshot: 1,
    });
  });

  it("returns zeros for an empty library", () => {
    expect(countByKind([])).toEqual({ all: 0, recording: 0, screenshot: 0 });
  });
});

describe("facetCounts (disjunctive faceting)", () => {
  // 3 recordings, 2 screenshots; `example` is on 2 local screenshots, `demo` on one
  // of them and on a cloud recording.
  const items = [
    video({ id: "r1", kind: "recording" }),
    video({ id: "r2", kind: "recording" }),
    video({ id: null, kind: "recording", availability: "cloud", tagIds: ["t-demo"] }),
    video({ id: "s1", kind: "screenshot", tagIds: ["t-example", "t-demo"] }),
    video({ id: "s2", kind: "screenshot", tagIds: ["t-example"] }),
  ];

  it("without filters, counts the whole library", () => {
    const facets = facetCounts(items, base);
    expect(facets.kind).toEqual({ all: 5, recording: 3, screenshot: 2 });
    expect(facets.storage).toEqual({ local: 4, cloud: 1 });
    expect(Object.fromEntries(facets.tags)).toEqual({ "t-example": 2, "t-demo": 2 });
  });

  it("follows the other groups: a tag filter narrows the kind and storage counts", () => {
    const facets = facetCounts(items, { ...base, tags: ["t-example"] });
    expect(facets.kind).toEqual({ all: 2, recording: 0, screenshot: 2 });
    expect(facets.storage).toEqual({ local: 2, cloud: 0 });
    // Tags combine with AND: demo counts only items that also carry example.
    expect(Object.fromEntries(facets.tags)).toEqual({ "t-example": 2, "t-demo": 1 });
  });

  it("ignores its own group: picking Screenshots never zeroes Recordings", () => {
    const facets = facetCounts(items, { ...base, kindFilter: "screenshot" });
    expect(facets.kind).toEqual({ all: 5, recording: 3, screenshot: 2 });
    expect(facets.storage).toEqual({ local: 2, cloud: 0 });
  });

  it("ignores its own group for storage too, and follows the search box", () => {
    const facets = facetCounts(
      [...items, video({ id: "r3", title: "Demo night", kind: "recording" })],
      { ...base, storageFilter: "cloud", searchTerm: "demo" },
    );
    // Search "demo" finds only the titled recording (no tag text supplied here).
    expect(facets.storage).toEqual({ local: 1, cloud: 0 });
    expect(facets.kind).toEqual({ all: 0, recording: 0, screenshot: 0 });
  });
});
