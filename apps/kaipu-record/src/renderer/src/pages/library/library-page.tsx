import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Library, LayoutGrid, LayoutList, AlertTriangle, RefreshCw } from "lucide-react";
import { SearchInput } from "@renderer/ui/search-input";
import { Button } from "@renderer/ui/button";
import { VideoCard } from "@renderer/features/library/components/video-card";
import { VideoRow } from "@renderer/features/library/components/video-row";
import { DeleteConfirmDialog } from "@renderer/features/library/components/delete-confirm-dialog";
import { SortMenu } from "@renderer/features/library/components/sort-menu";
import { FilterChip } from "@renderer/features/library/components/filter-chip";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { useLibraryFilters } from "@renderer/features/library/hooks/use-library-filters";
import styles from "./library-page.module.css";

export function LibraryPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { videos, isLoading, refresh, remove } = useLocalLibrary();
  const {
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
    clearFilters,
  } = useLibraryFilters(videos);

  const [view, setView] = useState<"grid" | "list">("grid");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  const confirmDelete = (): void => {
    if (!pendingDelete) return;
    void remove(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          <h1 className={styles.pageTitle}>Library</h1>
          <p className={styles.pageSubtitle}>Manage your recordings and perform actions.</p>
        </div>
        <button
          className={styles.headerSyncButton}
          title="Rescan local vault"
          type="button"
          onClick={() => void refresh()}
        >
          <RefreshCw
            size={15}
            strokeWidth={1.8}
            className={isLoading ? styles.spinning : undefined}
          />
          Sync
        </button>
      </div>

      <div className={styles.toolbar}>
        <SearchInput
          placeholder="Search recordings…"
          value={searchTerm}
          onSearch={setSearchTerm}
          className={styles.search}
        />
        <SortMenu sort={sortKey} onChange={setSortKey} />
        <div className={styles.viewToggle}>
          <button
            className={styles.viewToggleButton}
            data-active={view === "grid"}
            onClick={() => setView("grid")}
            title="Gallery view"
            type="button"
          >
            <LayoutGrid size={15} strokeWidth={1.8} />
          </button>
          <button
            className={styles.viewToggleButton}
            data-active={view === "list"}
            onClick={() => setView("list")}
            title="List view"
            type="button"
          >
            <LayoutList size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className={styles.chipRow}>
        <FilterChip active={kindFilter === "all"} onClick={() => setKindFilter("all")}>
          All ({kindCounts.all})
        </FilterChip>
        <FilterChip
          active={kindFilter === "recording"}
          empty={kindCounts.recording === 0}
          onClick={() => setKindFilter("recording")}
        >
          Recordings ({kindCounts.recording})
        </FilterChip>
        <FilterChip
          active={kindFilter === "screenshot"}
          empty={kindCounts.screenshot === 0}
          onClick={() => setKindFilter("screenshot")}
        >
          Screenshots ({kindCounts.screenshot})
        </FilterChip>

        <span className={styles.chipDivider} aria-hidden />

        <FilterChip active={storageFilter === "all"} onClick={() => setStorageFilter("all")}>
          All
        </FilterChip>
        <FilterChip
          active={storageFilter === "local"}
          empty={counts.local === 0}
          onClick={() => setStorageFilter("local")}
        >
          <span className={styles.storageDotChip} data-cloud="false" />
          Local
        </FilterChip>
        <FilterChip
          active={storageFilter === "cloud"}
          empty={counts.cloud === 0}
          onClick={() => setStorageFilter("cloud")}
        >
          <span className={styles.storageDotChip} data-cloud="true" />
          Cloud
        </FilterChip>
        {counts.failed > 0 && (
          <FilterChip
            tone="alert"
            active={storageFilter === "failed"}
            onClick={() => setStorageFilter(storageFilter === "failed" ? "all" : "failed")}
          >
            <AlertTriangle size={12} strokeWidth={2} />
            Failed ({counts.failed})
          </FilterChip>
        )}
      </div>

      {videos.length > 0 && (
        <div className={styles.summaryBar}>
          <span>
            {visibleItems.length} FILE{visibleItems.length !== 1 ? "S" : ""}
          </span>
          {hasActiveFilters && (
            <button className={styles.clearFiltersButton} onClick={clearFilters} type="button">
              Clear filters
            </button>
          )}
        </div>
      )}

      {visibleItems.length === 0 ? (
        <div className={styles.empty}>
          <Library size={48} className={styles.emptyIcon} />
          {videos.length === 0 ? (
            <>
              <h3 className={styles.emptyTitle}>
                {isLoading ? "Loading recordings…" : "No recordings yet"}
              </h3>
              {!isLoading && (
                <>
                  <p className={styles.emptySubtitle}>Your recorded videos will appear here</p>
                  <Button variant="primary" onClick={() => navigate("/")}>
                    Go record something
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <h3 className={styles.emptyTitle}>No recordings match these filters</h3>
              <p className={styles.emptySubtitle}>Try a different search or filter.</p>
              <Button variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            </>
          )}
        </div>
      ) : view === "grid" ? (
        <div className={styles.grid}>
          {visibleItems.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              onNavigate={() => navigate(`/library/${video.id}`)}
              onDelete={() => setPendingDelete({ id: video.id, title: video.title })}
            />
          ))}
        </div>
      ) : (
        <div className={styles.scrollContainer}>
          <div className={styles.listContainer}>
            {visibleItems.map((video, i) => (
              <VideoRow
                key={video.id}
                video={video}
                isLast={i === visibleItems.length - 1}
                onNavigate={() => navigate(`/library/${video.id}`)}
                onDelete={() => setPendingDelete({ id: video.id, title: video.title })}
              />
            ))}
          </div>
        </div>
      )}

      {pendingDelete && (
        <DeleteConfirmDialog
          title={pendingDelete.title}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
