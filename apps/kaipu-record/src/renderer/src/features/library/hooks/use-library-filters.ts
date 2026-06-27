import { useMemo, useState } from "react";
import type { LibraryVideo } from "@renderer/features/library/types";
import {
  countByStorage,
  selectVisibleVideos,
  type SortKey,
  type StorageCounts,
  type StorageFilter,
} from "@renderer/features/library/library-filters";

export interface LibraryFilters {
  storageFilter: StorageFilter;
  sortKey: SortKey;
  searchTerm: string;
  setStorageFilter(filter: StorageFilter): void;
  setSortKey(key: SortKey): void;
  setSearchTerm(term: string): void;

  /** Filtered + sorted collection for the current criteria. */
  visibleItems: LibraryVideo[];
  counts: StorageCounts;
  hasActiveFilters: boolean;
  /** Reset the storage filter and search; leave the sort order alone. */
  clearFilters(): void;
}

/**
 * Owns the Library toolbar state and derives the visible collection from it. The
 * actual filtering/sorting/counting lives in pure `library-filters` helpers; this
 * hook is just the React state wiring around them.
 */
export function useLibraryFilters(videos: LibraryVideo[]): LibraryFilters {
  const [storageFilter, setStorageFilter] = useState<StorageFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [searchTerm, setSearchTerm] = useState("");

  const counts = useMemo(() => countByStorage(videos), [videos]);
  const visibleItems = useMemo(
    () => selectVisibleVideos(videos, { storageFilter, sortKey, searchTerm }),
    [videos, storageFilter, sortKey, searchTerm],
  );

  const hasActiveFilters = storageFilter !== "all" || searchTerm.trim().length > 0;

  return {
    storageFilter,
    sortKey,
    searchTerm,
    setStorageFilter,
    setSortKey,
    setSearchTerm,
    visibleItems,
    counts,
    hasActiveFilters,
    clearFilters: () => {
      setStorageFilter("all");
      setSearchTerm("");
    },
  };
}
