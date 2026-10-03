import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Library, LayoutGrid, LayoutList, AlertTriangle, RefreshCw, Search } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import * as stylex from "@stylexjs/stylex";
import { SearchInput } from "@kaipu/ui";
import { Button } from "@kaipu/ui";
import { VideoCard } from "@renderer/features/library/components/video-card";
import { VideoRow } from "@renderer/features/library/components/video-row";
import { DeleteConfirmDialog } from "@renderer/features/library/components/delete-confirm-dialog";
import { SortMenu } from "@renderer/features/library/components/sort-menu";
import { FilterChip } from "@renderer/features/library/components/filter-chip";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { useLibraryFilters } from "@renderer/features/library/hooks/use-library-filters";
import { buildLineage, editBadge } from "@renderer/features/library/lineage";
import styles from "./library-page.module.css";

/** The search field's share of the toolbar, moved out of the module: the shared
 *  SearchInput takes StyleX styles, not a className. */
const sxLibrary = stylex.create({
  search: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
  },
});

export function LibraryPage(): React.JSX.Element {
  const t = useTranslations("library");
  const navigate = useNavigate();
  const { videos, isLoading, hasError, refresh, remove } = useLocalLibrary();
  const canShowVaultBanner = hasError && videos.length > 0;
  // Built from the unfiltered `videos`, not `visibleItems`: an export filtered out of
  // the current view must still count toward its source's badge.
  const lineage = useMemo(() => buildLineage(videos), [videos]);
  const showFullPageError = hasError && videos.length === 0;
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
          <h1 className={styles.pageTitle}>{t("title")}</h1>
          <p className={styles.pageSubtitle}>{t("subtitle")}</p>
        </div>
        <button
          className={styles.headerSyncButton}
          title={t("rescan")}
          type="button"
          onClick={() => void refresh()}
        >
          <RefreshCw
            size={15}
            strokeWidth={1.8}
            className={isLoading ? styles.spinning : undefined}
          />
          {t("sync")}
        </button>
      </div>

      <div className={styles.toolbar}>
        <SearchInput
          placeholder={t("searchPlaceholder")}
          value={searchTerm}
          onSearch={setSearchTerm}
          icon={<Search size={14} strokeWidth={1.8} />}
          style={sxLibrary.search}
        />
        <SortMenu sort={sortKey} onChange={setSortKey} />
        <div className={styles.viewToggle}>
          <button
            className={styles.viewToggleButton}
            data-active={view === "grid"}
            onClick={() => setView("grid")}
            title={t("galleryView")}
            type="button"
          >
            <LayoutGrid size={15} strokeWidth={1.8} />
          </button>
          <button
            className={styles.viewToggleButton}
            data-active={view === "list"}
            onClick={() => setView("list")}
            title={t("listView")}
            type="button"
          >
            <LayoutList size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className={styles.chipRow}>
        <FilterChip active={kindFilter === "all"} onClick={() => setKindFilter("all")}>
          {t("kindAll", { count: kindCounts.all })}
        </FilterChip>
        <FilterChip
          active={kindFilter === "recording"}
          empty={kindCounts.recording === 0}
          onClick={() => setKindFilter("recording")}
        >
          {t("kindRecordings", { count: kindCounts.recording })}
        </FilterChip>
        <FilterChip
          active={kindFilter === "screenshot"}
          empty={kindCounts.screenshot === 0}
          onClick={() => setKindFilter("screenshot")}
        >
          {t("kindScreenshots", { count: kindCounts.screenshot })}
        </FilterChip>

        <span className={styles.chipDivider} aria-hidden />

        <FilterChip active={storageFilter === "all"} onClick={() => setStorageFilter("all")}>
          {t("storageAll")}
        </FilterChip>
        <FilterChip
          active={storageFilter === "local"}
          empty={counts.local === 0}
          onClick={() => setStorageFilter("local")}
        >
          <span className={styles.storageDotChip} data-cloud="false" />
          {t("storageLocal")}
        </FilterChip>
        <FilterChip
          active={storageFilter === "cloud"}
          empty={counts.cloud === 0}
          onClick={() => setStorageFilter("cloud")}
        >
          <span className={styles.storageDotChip} data-cloud="true" />
          {t("storageCloud")}
        </FilterChip>
      </div>

      {canShowVaultBanner && (
        <div className={styles.vaultBanner} role="status" aria-live="polite">
          <AlertTriangle size={14} strokeWidth={2} />
          {t("vaultUnreadableBanner")}
        </div>
      )}

      {videos.length > 0 && (
        <div className={styles.summaryBar}>
          <span>{t("fileCount", { count: visibleItems.length })}</span>
          {hasActiveFilters && (
            <button className={styles.clearFiltersButton} onClick={clearFilters} type="button">
              {t("clearFilters")}
            </button>
          )}
        </div>
      )}

      {showFullPageError ? (
        <div className={styles.empty}>
          <AlertTriangle size={48} className={styles.emptyIcon} />
          <h3 className={styles.emptyTitle}>{t("errorTitle")}</h3>
          <p className={styles.emptySubtitle}>{t("errorSubtitle")}</p>
          <Button variant="primary" onClick={() => void refresh()}>
            <RefreshCw size={15} strokeWidth={1.8} />
            {t("retry")}
          </Button>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className={styles.empty}>
          <Library size={48} className={styles.emptyIcon} />
          {videos.length === 0 ? (
            <>
              <h3 className={styles.emptyTitle}>{isLoading ? t("loadingList") : t("empty")}</h3>
              {!isLoading && (
                <>
                  <p className={styles.emptySubtitle}>{t("emptySubtitle")}</p>
                  <Button variant="primary" onClick={() => navigate("/")}>
                    {t("goRecord")}
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <h3 className={styles.emptyTitle}>{t("noMatch")}</h3>
              <p className={styles.emptySubtitle}>{t("noMatchSubtitle")}</p>
              <Button variant="ghost" onClick={clearFilters}>
                {t("clearFilters")}
              </Button>
            </>
          )}
        </div>
      ) : view === "grid" ? (
        <div className={styles.grid}>
          {visibleItems.map((video) => (
            <VideoCard
              key={video.assetId}
              video={video}
              badge={editBadge(video, lineage)}
              onNavigate={() => navigate(`/library/${video.assetId}`)}
              onDelete={() => {
                const { id, title } = video;
                if (id !== null) setPendingDelete({ id, title });
              }}
            />
          ))}
        </div>
      ) : (
        <div className={styles.scrollContainer}>
          <div className={styles.listContainer}>
            {visibleItems.map((video, i) => (
              <VideoRow
                key={video.assetId}
                video={video}
                isLast={i === visibleItems.length - 1}
                badge={editBadge(video, lineage)}
                onNavigate={() => navigate(`/library/${video.assetId}`)}
                onDelete={() => {
                  const { id, title } = video;
                  if (id !== null) setPendingDelete({ id, title });
                }}
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
