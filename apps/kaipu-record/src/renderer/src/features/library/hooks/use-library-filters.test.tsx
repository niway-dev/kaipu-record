import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { LibraryVideo } from "@renderer/features/library/types";
import { useLibraryFilters } from "./use-library-filters";

const videos: LibraryVideo[] = [
  {
    id: "a",
    assetId: "asset-a",
    kind: "recording",
    title: "Alpha",
    createdAt: 200,
    durationSeconds: 5,
    fileSizeBytes: 100,
    cloudSizeBytes: null,
    availability: "local",
    comparison: "same",
    editing: "project-available",
    transfer: { state: "idle" },
    derivedFromAssetId: null,
    editSavedAt: null,
    editExportedSavedAt: null,
  },
  {
    id: null,
    assetId: "asset-b",
    kind: "screenshot",
    title: "Bravo",
    createdAt: 100,
    durationSeconds: 5,
    fileSizeBytes: 900,
    cloudSizeBytes: 900,
    availability: "cloud",
    comparison: "same",
    editing: "project-available",
    transfer: { state: "idle" },
    derivedFromAssetId: null,
    editSavedAt: null,
    editExportedSavedAt: null,
  },
];

describe("useLibraryFilters", () => {
  it("starts unfiltered with newest-first ordering and storage + kind counts", () => {
    const { result } = renderHook(() => useLibraryFilters(videos));
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.visibleItems.map((v) => v.id)).toEqual(["a", null]);
    expect(result.current.counts).toEqual({ local: 1, cloud: 1 });
    expect(result.current.kindCounts).toEqual({ all: 2, recording: 1, screenshot: 1 });
  });

  it("filters by kind and flags active filters", () => {
    const { result } = renderHook(() => useLibraryFilters(videos));
    act(() => result.current.setKindFilter("screenshot"));
    expect(result.current.hasActiveFilters).toBe(true);
    expect(result.current.visibleItems.map((v) => v.id)).toEqual([null]);
  });

  it("flags active filters and reflects them in the visible items", () => {
    const { result } = renderHook(() => useLibraryFilters(videos));
    act(() => result.current.setStorageFilter("cloud"));
    expect(result.current.hasActiveFilters).toBe(true);
    expect(result.current.visibleItems.map((v) => v.id)).toEqual([null]);
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
    expect(result.current.visibleItems.map((v) => v.id)).toEqual([null, "a"]);
  });
});
