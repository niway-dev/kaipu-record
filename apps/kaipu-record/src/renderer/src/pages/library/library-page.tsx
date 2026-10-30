import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Library,
  LayoutGrid,
  LayoutList,
  AlertTriangle,
  RefreshCw,
  Search,
  Tags,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import * as stylex from "@stylexjs/stylex";
import { SearchInput } from "@kaipu/ui";
import { Button } from "@kaipu/ui";
import { VideoCard } from "@renderer/features/library/components/video-card";
import { VideoRow } from "@renderer/features/library/components/video-row";
import { DeleteConfirmDialog } from "@renderer/features/library/components/delete-confirm-dialog";
import { SortMenu } from "@renderer/features/library/components/sort-menu";
import { FilterChip } from "@renderer/features/library/components/filter-chip";
import { TagPanel, type TagPanelTab } from "@renderer/features/library/components/tag-panel";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { useLibraryFilters } from "@renderer/features/library/hooks/use-library-filters";
import { resolveTags, useTags } from "@renderer/features/library/hooks/use-tags";
import { TagChip } from "@renderer/features/library/tags/tag-chip";
import { buildLineage, editBadge } from "@renderer/features/library/lineage";
import { canOpenInEditor, useOpenInEditor } from "@renderer/features/editor/open-in-editor";
import { ReconcileBanner } from "@renderer/features/library/reconcile/reconcile-banner";
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
  const { openItem } = useOpenInEditor();
  const { videos, isLoading, hasError, refresh, remove, setTags } = useLocalLibrary();
  const tagApi = useTags();
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
    selectedTags,
    toggleTag,
    visibleItems,
    counts,
    kindCounts,
    tagsInUse,
    tagFacetCounts,
    hasActiveFilters,
    clearFilters,
  } = useLibraryFilters(videos, tagApi.tags);

  // What the summary line says is narrowing the list, so changed counts read as
  // "filtered", not "files went missing".
  const activeFilterNames = [
    ...(kindFilter === "recording" ? [t("filterNameRecordings")] : []),
    ...(kindFilter === "screenshot" ? [t("filterNameScreenshots")] : []),
    ...(storageFilter === "local" ? [t("storageLocal")] : []),
    ...(storageFilter === "cloud" ? [t("storageCloud")] : []),
    ...selectedTags.flatMap((id) => {
      const tag = tagApi.byId.get(id);
      return tag ? [`#${tag.slug}`] : [];
    }),
    ...(searchTerm.trim() ? [`"${searchTerm.trim()}"`] : []),
  ];

  const [view, setView] = useState<"grid" | "list">("grid");

  // A 0-height marker right above the sticky bar: once it scrolls out of view the
  // bar is stuck, and gets a divider so the cards do not run into the filters.
  const stuckSentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const marker = stuckSentinel.current;
    if (!marker || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry!.isIntersecting));
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);

  // The tag drawer: open on an item (by asset id, so it survives a rescan) or on
  // the "all tags" tab alone. The item is looked up in `videos`, not
  // `visibleItems`, so un-tagging it out of a tag filter keeps it in the drawer.
  const [tagDrawer, setTagDrawer] = useState<{ assetId: string | null; tab: TagPanelTab } | null>(
    null,
  );
  const taggingId = tagDrawer?.assetId ?? null;
  const tagging = taggingId ? (videos.find((v) => v.assetId === taggingId) ?? null) : null;
  const closeTagPanel = useCallback(() => setTagDrawer(null), []);
  const openTagPanel = (assetId: string): void => setTagDrawer({ assetId, tab: "item" });
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

      {/* Search, filters and the summary stay in view while the collection scrolls
          under them; the title above scrolls away to leave room. */}
      <div ref={stuckSentinel} aria-hidden />
      <div className={styles.stickyBar} data-stuck={stuck}>
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

        <div className={styles.filterRow}>
          <div className={styles.filterGroup} role="group" aria-label={t("filterKind")}>
            <span className={styles.groupLabel} title={t("filterKindHint")}>
              {t("filterKind")}
            </span>
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
          </div>

          <div className={styles.filterGroup} role="group" aria-label={t("filterStorage")}>
            <span
              className={styles.groupLabel}
              title={t(isWindowsHost() ? "filterStorageHintWindows" : "filterStorageHint")}
            >
              {t("filterStorage")}
            </span>
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
              <span className={styles.tagCount}>{counts.local}</span>
            </FilterChip>
            <FilterChip
              active={storageFilter === "cloud"}
              empty={counts.cloud === 0}
              onClick={() => setStorageFilter("cloud")}
            >
              <span className={styles.storageDotChip} data-cloud="true" />
              {t("storageCloud")}
              <span className={styles.tagCount}>{counts.cloud}</span>
            </FilterChip>
          </div>
        </div>

        <div className={styles.filterRow}>
          <div className={styles.tagGroup} role="group" aria-label={t("filterTags")}>
            <span className={styles.groupLabel} title={t("filterTagsHint")}>
              {t("filterTags")}
            </span>
            {/* At the start of the row so it never moves as tags come and go. */}
            <button
              type="button"
              className={styles.manageTags}
              aria-label={t("tagsManage")}
              title={t("tagsManage")}
              onClick={() => setTagDrawer({ assetId: null, tab: "all" })}
            >
              <Tags size={14} strokeWidth={1.8} />
            </button>
            {/* One line that scrolls sideways when the tags outgrow it. */}
            <div className={styles.tagScroller}>
              {tagsInUse.length === 0 ? (
                <span className={styles.groupEmpty}>{t("filterTagsEmpty")}</span>
              ) : (
                tagsInUse.map((tag) => (
                  <FilterChip
                    key={tag.id}
                    active={selectedTags.includes(tag.id)}
                    empty={(tagFacetCounts.get(tag.id) ?? 0) === 0}
                    onClick={() => toggleTag(tag.id)}
                  >
                    <TagChip name={tag.name} color={tag.color} />
                    <span className={styles.tagCount}>{tagFacetCounts.get(tag.id) ?? 0}</span>
                  </FilterChip>
                ))
              )}
            </div>
          </div>
        </div>

        <ReconcileBanner />

        {canShowVaultBanner && (
          <div className={styles.vaultBanner} role="status" aria-live="polite">
            <AlertTriangle size={14} strokeWidth={2} />
            {t("vaultUnreadableBanner")}
          </div>
        )}

        {videos.length > 0 && (
          <div className={styles.summaryBar}>
            <span>
              {hasActiveFilters
                ? t("fileCountOf", { shown: visibleItems.length, total: videos.length })
                : t("fileCount", { count: visibleItems.length })}
              {activeFilterNames.length > 0 && (
                <span className={styles.filteredBy}>
                  {" · "}
                  {t("filteredBy", { filters: activeFilterNames.join(", ") })}
                </span>
              )}
            </span>
            {hasActiveFilters && (
              <button className={styles.clearFiltersButton} onClick={clearFilters} type="button">
                {t("clearFilters")}
              </button>
            )}
          </div>
        )}
      </div>

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
              onEdit={canOpenInEditor(video) ? () => openItem(video) : undefined}
              onTags={video.id !== null ? () => openTagPanel(video.assetId) : undefined}
              selected={video.assetId === taggingId}
              tags={resolveTags(video.tagIds, tagApi.byId)}
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
                onEdit={canOpenInEditor(video) ? () => openItem(video) : undefined}
                onTags={video.id !== null ? () => openTagPanel(video.assetId) : undefined}
                selected={video.assetId === taggingId}
                tags={resolveTags(video.tagIds, tagApi.byId)}
                onDelete={() => {
                  const { id, title } = video;
                  if (id !== null) setPendingDelete({ id, title });
                }}
              />
            ))}
          </div>
        </div>
      )}
      {tagDrawer && (
        <TagPanel
          video={tagging}
          tags={tagApi.tags}
          initialTab={tagDrawer.tab}
          onAssign={(next) => (tagging?.id ? setTags(tagging.id, next) : undefined)}
          onCreate={tagApi.create}
          onRename={tagApi.rename}
          onRecolor={tagApi.recolor}
          onDelete={tagApi.remove}
          onFilterTag={(id) => {
            if (!selectedTags.includes(id)) toggleTag(id);
            setTagDrawer(null);
          }}
          onOpenDetails={() => tagging && navigate(`/library/${tagging.assetId}`)}
          onClose={closeTagPanel}
        />
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
