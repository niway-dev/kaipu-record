import type { LibraryKind, LibraryVideo, StorageState } from "./types";

/** The storage chip selection — every storage state, plus the "all" pass-through. */
export type StorageFilter = "all" | StorageState;

/** The kind chip selection — recording / screenshot, plus the "all" pass-through. */
export type KindFilter = "all" | LibraryKind;

export type SortKey = "newest" | "oldest" | "largest";

export interface FilterCriteria {
  kindFilter: KindFilter;
  storageFilter: StorageFilter;
  sortKey: SortKey;
  searchTerm: string;
}

export interface StorageCounts {
  local: number;
  cloud: number;
  failed: number;
}

export interface KindCounts {
  all: number;
  recording: number;
  screenshot: number;
}

/**
 * Apply the toolbar's storage filter + title search, then sort. Pure: it copies
 * the input before sorting, so the caller's array is never mutated. This is the
 * whole of the Library page's collection logic, lifted out of the component so
 * it can be exercised without rendering.
 */
export function selectVisibleVideos(
  videos: LibraryVideo[],
  criteria: FilterCriteria,
): LibraryVideo[] {
  const term = criteria.searchTerm.trim().toLowerCase();
  const filtered = videos.filter((video) => {
    if (criteria.kindFilter !== "all" && video.kind !== criteria.kindFilter) return false;
    if (criteria.storageFilter !== "all" && video.storage !== criteria.storageFilter) return false;
    if (term && !video.title.toLowerCase().includes(term)) return false;
    return true;
  });
  return [...filtered].sort((a, b) => {
    if (criteria.sortKey === "newest") return b.createdAt - a.createdAt;
    if (criteria.sortKey === "oldest") return a.createdAt - b.createdAt;
    return b.fileSizeBytes - a.fileSizeBytes;
  });
}

/** Tally items by storage state for the filter chips. */
export function countByStorage(videos: LibraryVideo[]): StorageCounts {
  return {
    local: videos.filter((v) => v.storage === "local").length,
    cloud: videos.filter((v) => v.storage === "cloud").length,
    failed: videos.filter((v) => v.storage === "failed").length,
  };
}

/** Tally items by kind (recording vs screenshot) for the kind filter chips. */
export function countByKind(videos: LibraryVideo[]): KindCounts {
  return {
    all: videos.length,
    recording: videos.filter((v) => v.kind === "recording").length,
    screenshot: videos.filter((v) => v.kind === "screenshot").length,
  };
}
