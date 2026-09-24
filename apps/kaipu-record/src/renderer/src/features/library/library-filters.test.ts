import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "./types";
import { countByKind, countByStorage, selectVisibleVideos } from "./library-filters";

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
    });
    expect(result.map((v) => v.id)).toEqual(["x", "y"]);
  });

  it("does not mutate the input array", () => {
    const input = [oldest, newest, middle];
    selectVisibleVideos(input, base);
    expect(input.map((v) => v.id)).toEqual(["c", "a", "b"]);
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
