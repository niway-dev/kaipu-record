import { useMemo, useState } from "react";
import type { TagSummary } from "@shared/types";
import type { LibraryVideo } from "@renderer/features/library/types";
import {
  facetCounts,
  selectVisibleVideos,
  type FilterCriteria,
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
  /** Selected tag ids (AND), in the order they were picked. */
  selectedTags: readonly string[];
  /** Select or unselect one tag chip, by tag id. */
  toggleTag(tagId: string): void;

  /** Filtered + sorted collection for the current criteria. */
  visibleItems: LibraryVideo[];
  counts: StorageCounts;
  kindCounts: KindCounts;
  /** Tags carried by at least one item, most used first — the tag chips. Their
   *  order is fixed by library-wide use, so chips never jump under the pointer. */
  tagsInUse: TagSummary[];
  /** Per tag id, the facet count: items you would see with that tag added. */
  tagFacetCounts: ReadonlyMap<string, number>;
  hasActiveFilters: boolean;
  /** Reset the kind/storage/tag filters and search; leave the sort order alone. */
  clearFilters(): void;
}

/**
 * Owns the Library toolbar state and derives the visible collection from it. The
 * actual filtering/sorting/counting lives in pure `library-filters` helpers; this
 * hook is just the React state wiring around them.
 */
export function useLibraryFilters(
  videos: LibraryVideo[],
  tags: readonly TagSummary[] = [],
): LibraryFilters {
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [storageFilter, setStorageFilter] = useState<StorageFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [searchTerm, setSearchTerm] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const tagsInUse = useMemo(() => tags.filter((tag) => tag.count > 0), [tags]);
  const tagText = useMemo(
    () => new Map(tags.map((tag) => [tag.id, `${tag.name.toLowerCase()} ${tag.slug}`])),
    [tags],
  );
  // A selected tag that no item carries any more (its last use was removed, or it
  // was deleted) would hide everything with no chip left to unselect it: drop it.
  const selectedTags = useMemo(
    () => tagFilter.filter((id) => tagsInUse.some((tag) => tag.id === id)),
    [tagFilter, tagsInUse],
  );
  const criteria = useMemo<FilterCriteria>(
    () => ({ kindFilter, storageFilter, sortKey, searchTerm, tags: selectedTags, tagText }),
    [kindFilter, storageFilter, sortKey, searchTerm, selectedTags, tagText],
  );
  const visibleItems = useMemo(() => selectVisibleVideos(videos, criteria), [videos, criteria]);
  // Counts follow the other filters (disjunctive faceting), so they say what a
  // click would show instead of what the whole library holds.
  const facets = useMemo(() => facetCounts(videos, criteria), [videos, criteria]);

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
    counts: facets.storage,
    kindCounts: facets.kind,
    tagsInUse,
    tagFacetCounts: facets.tags,
    hasActiveFilters,
    clearFilters: () => {
      setKindFilter("all");
      setStorageFilter("all");
      setSearchTerm("");
      setTagFilter([]);
    },
  };
}
