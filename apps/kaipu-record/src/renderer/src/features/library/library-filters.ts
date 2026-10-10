import { hasCloudCopy, hasLocalCopy } from "@shared/types/library-item";
import type { LibraryKind, LibraryVideo } from "./types";

/** The storage chip selection. "local" and "cloud" overlap: an item that is
 *  both matches both chips (see `hasLocalCopy` / `hasCloudCopy`). */
export type StorageFilter = "all" | "local" | "cloud";

/** The kind chip selection — recording / screenshot, plus the "all" pass-through. */
/** GIFs have no chip of their own (they group under "recording", see `kindGroup`). */
export type KindFilter = "all" | Exclude<LibraryKind, "gif">;

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
    if (criteria.kindFilter !== "all" && kindGroup(video.kind) !== criteria.kindFilter)
      return false;
    if (criteria.storageFilter === "local" && !hasLocalCopy(video)) return false;
    if (criteria.storageFilter === "cloud" && !hasCloudCopy(video)) return false;
    if (term && !video.title.toLowerCase().includes(term)) return false;
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

/**
 * The filter chip a kind belongs to. GIF exports are grouped under Recordings (NIW2-217:
 * a badge on the card, no chip of their own).
 */
export function kindGroup(kind: LibraryKind): Exclude<LibraryKind, "gif"> {
  return kind === "gif" ? "recording" : kind;
}

/** Tally items by kind (recording vs screenshot) for the kind filter chips. */
export function countByKind(videos: LibraryVideo[]): KindCounts {
  return {
    all: videos.length,
    recording: videos.filter((v) => kindGroup(v.kind) === "recording").length,
    screenshot: videos.filter((v) => v.kind === "screenshot").length,
  };
}
