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
  /** Selected tag ids. An item must carry every one of them (AND). */
  tags: readonly string[];
  /** Names and slugs by tag id, so the search box also matches tags. */
  tagText?: ReadonlyMap<string, string>;
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
  const filtered = videos.filter((video) => matches(video, criteria));
  return [...filtered].sort((a, b) => {
    if (criteria.sortKey === "newest") return b.createdAt - a.createdAt;
    if (criteria.sortKey === "oldest") return a.createdAt - b.createdAt;
    return b.fileSizeBytes - a.fileSizeBytes;
  });
}

/** A filter group whose own selection a facet count leaves out. */
type Facet = "kind" | "storage";

/**
 * Whether `video` passes the criteria, optionally ignoring one group's own
 * selection — the rule behind facet counts (see {@link facetCounts}).
 */
function matches(video: LibraryVideo, criteria: FilterCriteria, skip?: Facet): boolean {
  if (skip !== "kind" && criteria.kindFilter !== "all" && video.kind !== criteria.kindFilter) {
    return false;
  }
  if (skip !== "storage") {
    if (criteria.storageFilter === "local" && !hasLocalCopy(video)) return false;
    if (criteria.storageFilter === "cloud" && !hasCloudCopy(video)) return false;
  }
  // No sidecar means no tags: such an item still shows while no tag is selected.
  const tags = video.tagIds ?? [];
  if (!criteria.tags.every((tag) => tags.includes(tag))) return false;
  const term = criteria.searchTerm.trim().toLowerCase().replace(/^#/, "");
  if (
    term &&
    !video.title.toLowerCase().includes(term) &&
    !tags.some((id) => criteria.tagText?.get(id)?.includes(term))
  ) {
    return false;
  }
  return true;
}

export interface FacetCounts {
  kind: KindCounts;
  storage: StorageCounts;
  /** Per tag id: how many items you would see with that tag added to the filters. */
  tags: ReadonlyMap<string, number>;
}

/**
 * Disjunctive facet counts: each chip shows how many items you would see if you
 * picked it, with every *other* group's filters as they are. A group ignores its
 * own selection, so picking "Recordings" never turns "Screenshots" into 0 — a 0
 * means "nothing there with the rest of the filters", not "you picked something
 * else". Tags combine with AND, so a tag's count is taken over the current result.
 */
export function facetCounts(videos: LibraryVideo[], criteria: FilterCriteria): FacetCounts {
  const kind = countByKind(videos.filter((v) => matches(v, criteria, "kind")));
  const storage = countByStorage(videos.filter((v) => matches(v, criteria, "storage")));
  const tags = new Map<string, number>();
  for (const video of videos) {
    if (!matches(video, criteria)) continue;
    for (const id of video.tagIds ?? []) tags.set(id, (tags.get(id) ?? 0) + 1);
  }
  return { kind, storage, tags };
}

/** Tally items by location for the filter chips. Overlapping: an item with
 *  both a local and a cloud copy counts toward both totals. */
export function countByStorage(videos: LibraryVideo[]): StorageCounts {
  return {
    local: videos.filter(hasLocalCopy).length,
    cloud: videos.filter(hasCloudCopy).length,
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
