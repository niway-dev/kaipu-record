import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "./types";
import { countByKind, countByStorage, selectVisibleVideos } from "./library-filters";

function video(overrides: Partial<LibraryVideo> = {}): LibraryVideo {
  return {
    id: "id",
    kind: "recording",
    title: "Recording",
    createdAt: 0,
    durationSeconds: 10,
    fileSizeBytes: 1000,
    storage: "local",
    ...overrides,
  };
}

const newest = video({ id: "a", title: "Alpha", createdAt: 300, fileSizeBytes: 100 });
const middle = video({ id: "b", title: "Bravo", createdAt: 200, fileSizeBytes: 900 });
const oldest = video({ id: "c", title: "Charlie", createdAt: 100, fileSizeBytes: 500 });
const cloud = video({ id: "d", title: "Delta", createdAt: 250, storage: "cloud" });
const failed = video({ id: "e", title: "Echo", createdAt: 150, storage: "failed" });
const shot = video({ id: "s", title: "Shot", createdAt: 175, kind: "screenshot" });

const criteria = {
  kindFilter: "all" as const,
  storageFilter: "all" as const,
  sortKey: "newest" as const,
  searchTerm: "",
};

describe("selectVisibleVideos", () => {
  it("returns everything sorted newest-first when no filters are active", () => {
    const result = selectVisibleVideos([oldest, newest, middle], criteria);
    expect(result.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts oldest-first", () => {
    const result = selectVisibleVideos([newest, oldest, middle], {
      ...criteria,
      sortKey: "oldest",
    });
    expect(result.map((v) => v.id)).toEqual(["c", "b", "a"]);
  });

  it("sorts largest-first by file size", () => {
    const result = selectVisibleVideos([newest, oldest, middle], {
      ...criteria,
      sortKey: "largest",
    });
    expect(result.map((v) => v.id)).toEqual(["b", "c", "a"]);
  });

  it("filters by storage state, leaving 'all' untouched", () => {
    const videos = [newest, cloud, failed];
    expect(selectVisibleVideos(videos, { ...criteria, storageFilter: "all" })).toHaveLength(3);
    expect(
      selectVisibleVideos(videos, { ...criteria, storageFilter: "cloud" }).map((v) => v.id),
    ).toEqual(["d"]);
  });

  it("filters by kind, leaving 'all' untouched", () => {
    const videos = [newest, shot, middle];
    expect(selectVisibleVideos(videos, { ...criteria, kindFilter: "all" })).toHaveLength(3);
    expect(
      selectVisibleVideos(videos, { ...criteria, kindFilter: "screenshot" }).map((v) => v.id),
    ).toEqual(["s"]);
    expect(
      selectVisibleVideos(videos, { ...criteria, kindFilter: "recording" }).map((v) => v.id),
    ).toEqual(["a", "b"]);
  });

  it("combines the kind and storage filters", () => {
    const cloudShot = video({ id: "cs", kind: "screenshot", storage: "cloud", createdAt: 5 });
    const result = selectVisibleVideos([newest, shot, cloudShot], {
      ...criteria,
      kindFilter: "screenshot",
      storageFilter: "cloud",
    });
    expect(result.map((v) => v.id)).toEqual(["cs"]);
  });

  it("filters by search term, case-insensitively and trimmed, matching the title", () => {
    const result = selectVisibleVideos([newest, middle, oldest], {
      ...criteria,
      searchTerm: "  BRA ",
    });
    expect(result.map((v) => v.id)).toEqual(["b"]);
  });

  it("combines storage filter, search, and sort together", () => {
    const localAlpha = video({ id: "x", title: "Report final", createdAt: 10, storage: "local" });
    const localBeta = video({ id: "y", title: "Report draft", createdAt: 20, storage: "local" });
    const cloudReport = video({ id: "z", title: "Report cloud", storage: "cloud" });
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
    selectVisibleVideos(input, criteria);
    expect(input.map((v) => v.id)).toEqual(["c", "a", "b"]);
  });
});

describe("countByStorage", () => {
  it("counts videos per storage state", () => {
    const counts = countByStorage([newest, middle, cloud, failed]);
    expect(counts).toEqual({ local: 2, cloud: 1, failed: 1 });
  });

  it("returns zeros for an empty library", () => {
    expect(countByStorage([])).toEqual({ local: 0, cloud: 0, failed: 0 });
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
