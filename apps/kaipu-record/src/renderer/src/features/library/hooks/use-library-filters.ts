import { useMemo, useState } from "react";
import type { LibraryVideo } from "@renderer/features/library/types";
import {
  countByKind,
  countByStorage,
  selectVisibleVideos,
  type KindCounts,
  type KindFilter,
  type SortKey,
  type StorageCounts,
  type StorageFilter,
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

  /** Filtered + sorted collection for the current criteria. */
  visibleItems: LibraryVideo[];
  counts: StorageCounts;
  kindCounts: KindCounts;
  hasActiveFilters: boolean;
  /** Reset the kind/storage filters and search; leave the sort order alone. */
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

  const counts = useMemo(() => countByStorage(videos), [videos]);
  const kindCounts = useMemo(() => countByKind(videos), [videos]);
  const visibleItems = useMemo(
    () => selectVisibleVideos(videos, { kindFilter, storageFilter, sortKey, searchTerm }),
    [videos, kindFilter, storageFilter, sortKey, searchTerm],
  );

  const hasActiveFilters =
    kindFilter !== "all" || storageFilter !== "all" || searchTerm.trim().length > 0;

  return {
    kindFilter,
    storageFilter,
    sortKey,
    searchTerm,
    setKindFilter,
    setStorageFilter,
    setSortKey,
    setSearchTerm,
    visibleItems,
    counts,
    kindCounts,
    hasActiveFilters,
    clearFilters: () => {
      setKindFilter("all");
      setStorageFilter("all");
      setSearchTerm("");
    },
  };
}
