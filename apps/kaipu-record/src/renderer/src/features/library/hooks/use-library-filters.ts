import { useMemo, useState } from "react";
import type { LibraryVideo } from "@renderer/features/library/types";
import {
  countByKind,
  countByStorage,
  countByTag,
  selectVisibleVideos,
  type KindCounts,
  type KindFilter,
  type SortKey,
  type StorageCounts,
  type StorageFilter,
  type TagCount,
} from "@renderer/features/library/library-filters";

export interface LibraryFilters {
  kindFilter: KindFilter;
  storageFilter: StorageFilter;
  sortKey: SortKey;
  searchTerm: string;
  setKindFilter(filter: KindFilter): void;
  setStorageFilter(filter: StorageFilter): void;
  setSortKey(key: SortKey): void;
  setSearchTerm(term: string): void;
  /** Selected tag chips (AND), in the order they were picked. */
  selectedTags: readonly string[];
  /** Select or unselect one tag chip. */
  toggleTag(tag: string): void;

  /** Filtered + sorted collection for the current criteria. */
  visibleItems: LibraryVideo[];
  counts: StorageCounts;
  kindCounts: KindCounts;
  /** Tags in use across the library, most used first — the tag chips. */
  tagCounts: TagCount[];
  hasActiveFilters: boolean;
  /** Reset the kind/storage/tag filters and search; leave the sort order alone. */
  clearFilters(): void;
}

/**
 * Owns the Library toolbar state and derives the visible collection from it. The
 * actual filtering/sorting/counting lives in pure `library-filters` helpers; this
 * hook is just the React state wiring around them.
 */
export function useLibraryFilters(videos: LibraryVideo[]): LibraryFilters {
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [storageFilter, setStorageFilter] = useState<StorageFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [searchTerm, setSearchTerm] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const counts = useMemo(() => countByStorage(videos), [videos]);
  const kindCounts = useMemo(() => countByKind(videos), [videos]);
  const tagCounts = useMemo(() => countByTag(videos), [videos]);
  // A selected tag that no item carries any more (its last use was removed)
  // would hide everything with no chip left to unselect it: drop it.
  const selectedTags = useMemo(
    () => tagFilter.filter((tag) => tagCounts.some((entry) => entry.tag === tag)),
    [tagFilter, tagCounts],
  );
  const visibleItems = useMemo(
    () =>
      selectVisibleVideos(videos, {
        kindFilter,
        storageFilter,
        sortKey,
        searchTerm,
        tags: selectedTags,
      }),
    [videos, kindFilter, storageFilter, sortKey, searchTerm, selectedTags],
  );

  const hasActiveFilters =
    kindFilter !== "all" ||
    storageFilter !== "all" ||
    searchTerm.trim().length > 0 ||
    selectedTags.length > 0;

  return {
    kindFilter,
    storageFilter,
    sortKey,
    searchTerm,
    setKindFilter,
    setStorageFilter,
    setSortKey,
    setSearchTerm,
    selectedTags,
    toggleTag: (tag: string) =>
      setTagFilter((current) =>
        current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
      ),
    visibleItems,
    counts,
    kindCounts,
    tagCounts,
    hasActiveFilters,
    clearFilters: () => {
      setKindFilter("all");
      setStorageFilter("all");
      setSearchTerm("");
      setTagFilter([]);
    },
  };
}
