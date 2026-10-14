import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, ImagePlus, PenLine } from "lucide-react";
import { ROUTES } from "@shared/routes";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { KindBadge } from "@renderer/features/library/components/kind-badge";
import { EditBadge } from "@renderer/features/library/components/edit-badge";
import { buildLineage, editBadge } from "@renderer/features/library/lineage";
import { canOpenInEditor, useOpenInEditor } from "@renderer/features/editor/open-in-editor";
import {
  formatAgo,
  lastActivity,
  paginate,
  RECENT_FILTERS,
  recentItems,
  wasEdited,
  type RecentFilter,
} from "./recent-editable";
import styles from "./editor-page.module.css";

const FILTER_LABEL = {
  all: "filterAll",
  videos: "filterVideos",
  images: "filterImages",
  unedited: "filterUnedited",
} as const satisfies Record<RecentFilter, string>;

/**
 * `/editor` with nothing open: every item that can be edited, most recently
 * worked on first, a page at a time. Each row says when it was last edited (or
 * created) and has an Edit action that lands in its editor.
 */
export function EditorHomePage(): React.JSX.Element {
  const t = useTranslations("editor");
  const locale = useLocale();
  const { videos, isLoading } = useLocalLibrary();
  const { openItem } = useOpenInEditor();
  const [filter, setFilter] = useState<RecentFilter>("all");
  const [page, setPage] = useState(0);

  const editable = useMemo(() => videos.filter(canOpenInEditor), [videos]);
  const listed = useMemo(() => recentItems(editable, filter), [editable, filter]);
  const current = paginate(listed, page);
  // The same export-state signal the library shows: this list is "what you are
  // working on", and whether those edits are in any file yet is the one fact a
  // visitor of this page needs before picking an item.
  const lineage = useMemo(() => buildLineage(videos), [videos]);
  const now = Date.now();

  const pickFilter = (next: RecentFilter): void => {
    setFilter(next);
    setPage(0);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t("title")}</h1>
        <Link to={ROUTES.editorNew} className={styles.newButton} title={t("newTitle")}>
          <ImagePlus size={16} strokeWidth={1.8} />
          {t("new")}
        </Link>
      </div>
      <p className={styles.subtitle}>{t("subtitle")}</p>

      <div className={styles.listHeader}>
        <h2 className={styles.sectionTitle}>{t("recentTitle")}</h2>
        {editable.length > 0 && (
          <div className={styles.filters} role="group" aria-label={t("filtersLabel")}>
            {RECENT_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={styles.filter}
                aria-pressed={filter === f}
                onClick={() => pickFilter(f)}
              >
                {t(FILTER_LABEL[f])}
              </button>
            ))}
          </div>
        )}
      </div>

      {!isLoading && editable.length === 0 ? (
        <p className={styles.empty}>{t("empty")}</p>
      ) : !isLoading && listed.length === 0 ? (
        <p className={styles.empty}>{t("emptyFilter")}</p>
      ) : (
        <ul className={styles.list}>
          {current.rows.map((item) => (
            <li key={item.assetId} className={styles.row}>
              {item.thumbnailUrl ? (
                <img src={item.thumbnailUrl} alt="" className={styles.thumb} />
              ) : (
                <span className={styles.thumb} aria-hidden />
              )}
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{item.title}</span>
                <span className={styles.rowMeta}>
                  {t(wasEdited(item) ? "editedAgo" : "createdAgo", {
                    when: formatAgo(lastActivity(item), now, locale),
                  })}
                </span>
              </span>
              <KindBadge kind={item.kind} />
              <EditBadge state={editBadge(item, lineage)} />
              <button
                type="button"
                className={styles.edit}
                onClick={() => openItem(item)}
                aria-label={t("editItem", { title: item.title })}
              >
                <PenLine size={14} strokeWidth={1.8} />
                {t("edit")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {current.pageCount > 1 && (
        <nav className={styles.pager} aria-label={t("pagerLabel")}>
          <span className={styles.pagerRange}>
            {t("pageRange", { from: current.from, to: current.to, total: current.total })}
          </span>
          <button
            type="button"
            className={styles.pagerButton}
            disabled={current.page === 0}
            onClick={() => setPage(current.page - 1)}
            aria-label={t("pagePrev")}
            title={t("pagePrev")}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className={styles.pagerButton}
            disabled={current.page >= current.pageCount - 1}
            onClick={() => setPage(current.page + 1)}
            aria-label={t("pageNext")}
            title={t("pageNext")}
          >
            <ChevronRight size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}
