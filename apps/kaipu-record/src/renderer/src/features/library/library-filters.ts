import { hasCloudCopy, hasLocalCopy } from "@shared/types/library-item";
import type { LibraryKind, LibraryVideo } from "./types";

/** The storage chip selection. "local" and "cloud" overlap: an item that is
 *  both matches both chips (see `hasLocalCopy` / `hasCloudCopy`). */
export type StorageFilter = "all" | "local" | "cloud";

/** The kind chip selection — recording / screenshot, plus the "all" pass-through. */
export type KindFilter = "all" | LibraryKind;

export type SortKey = "newest" | "oldest" | "largest";

export interface FilterCriteria {
  kindFilter: KindFilter;
  storageFilter: StorageFilter;
  sortKey: SortKey;
  searchTerm: string;
  /** Selected tag chips. An item must carry every one of them (AND). */
  tags: readonly string[];
}

/** One tag chip: a tag in use and how many items carry it. */
export interface TagCount {
  tag: string;
  count: number;
}

export interface StorageCounts {
  local: number;
  cloud: number;
}

export interface KindCounts {
  all: number;
  recording: number;
  screenshot: number;
}

/**
 * Apply the toolbar's kind, storage and tag filters + search (title or any tag;
 * selected tags narrow with AND), then sort. Pure: it copies
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
    if (criteria.storageFilter === "local" && !hasLocalCopy(video)) return false;
    if (criteria.storageFilter === "cloud" && !hasCloudCopy(video)) return false;
    // No sidecar means no tags: such an item still shows while no tag is selected.
    const tags = video.tags ?? [];
    if (!criteria.tags.every((tag) => tags.includes(tag))) return false;
    if (
      term &&
      !video.title.toLowerCase().includes(term) &&
      !tags.some((tag) => tag.includes(term))
    ) {
      return false;
    }
    return true;
  });
  return [...filtered].sort((a, b) => {
    if (criteria.sortKey === "newest") return b.createdAt - a.createdAt;
    if (criteria.sortKey === "oldest") return a.createdAt - b.createdAt;
    return b.fileSizeBytes - a.fileSizeBytes;
  });
}

/** Tally items by location for the filter chips. Overlapping: an item with
 *  both a local and a cloud copy counts toward both totals. */
export function countByStorage(videos: LibraryVideo[]): StorageCounts {
  return {
    local: videos.filter(hasLocalCopy).length,
    cloud: videos.filter(hasCloudCopy).length,
  };
}

/** Tally tags across items for the tag chips: most used first, ties alphabetical. */
export function countByTag(videos: LibraryVideo[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const video of videos) {
    for (const tag of video.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Tally items by kind (recording vs screenshot) for the kind filter chips. */
export function countByKind(videos: LibraryVideo[]): KindCounts {
  return {
    all: videos.length,
    recording: videos.filter((v) => v.kind === "recording").length,
    screenshot: videos.filter((v) => v.kind === "screenshot").length,
  };
}
