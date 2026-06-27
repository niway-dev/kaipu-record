import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { LibraryVideo } from "@renderer/features/library/types";
import { useLibraryFilters } from "./use-library-filters";

const videos: LibraryVideo[] = [
  {
    id: "a",
    title: "Alpha",
    createdAt: 200,
    durationSeconds: 5,
    fileSizeBytes: 100,
    storage: "local",
  },
  {
    id: "b",
    title: "Bravo",
    createdAt: 100,
    durationSeconds: 5,
    fileSizeBytes: 900,
    storage: "cloud",
  },
];

describe("useLibraryFilters", () => {
  it("starts unfiltered with newest-first ordering and storage counts", () => {
    const { result } = renderHook(() => useLibraryFilters(videos));
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.visibleItems.map((v) => v.id)).toEqual(["a", "b"]);
    expect(result.current.counts).toEqual({ local: 1, cloud: 1, failed: 0 });
  });

  it("flags active filters and reflects them in the visible items", () => {
    const { result } = renderHook(() => useLibraryFilters(videos));
    act(() => result.current.setStorageFilter("cloud"));
    expect(result.current.hasActiveFilters).toBe(true);
    expect(result.current.visibleItems.map((v) => v.id)).toEqual(["b"]);
  });

  it("clears the storage filter and search but keeps the sort order", () => {
    const { result } = renderHook(() => useLibraryFilters(videos));
    act(() => {
      result.current.setStorageFilter("cloud");
      result.current.setSearchTerm("brav");
      result.current.setSortKey("largest");
    });
    act(() => result.current.clearFilters());
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.sortKey).toBe("largest");
    expect(result.current.visibleItems.map((v) => v.id)).toEqual(["b", "a"]);
  });
});
