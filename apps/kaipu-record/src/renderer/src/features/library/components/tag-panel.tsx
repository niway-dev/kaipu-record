import React, { useEffect, useState } from "react";
import { Check, ExternalLink, Film, Pencil, Trash2, X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { normalizeTag, TagSetBuilder, TAGS_PER_ITEM_MAX } from "@kaipu/domain/constants";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { TagCount } from "@renderer/features/library/library-filters";
import { TagEditor } from "./tag-editor";
import styles from "./tag-panel.module.css";

/** Library tags offered as one-click toggles, most used first. */
const QUICK_TAGS_SHOWN = 16;

export type TagPanelTab = "item" | "all";

interface TagPanelProps {
  /** The item being tagged; null when the drawer was opened to manage tags only. */
  video: LibraryVideo | null;
  /** Every tag in use with its item count, most used first. */
  tagCounts: readonly TagCount[];
  initialTab: TagPanelTab;
  onChange(tags: readonly string[]): void;
  onRenameTag(from: string, to: string): Promise<void>;
  onDeleteTag(tag: string): Promise<void>;
  /** Show only the items carrying this tag in the Library. */
  onFilterTag(tag: string): void;
  onOpenDetails(): void;
  onClose(): void;
}

/**
 * The Library's tag drawer: it slides in over the page from the right, behind a
 * curtain that dims the rest and closes it on click. Two tabs — tag the item it
 * was opened for (typed field plus one-click toggles of the library's tags), or
 * manage every tag in the library (rename, delete, filter by it). Esc closes.
 */
export function TagPanel({
  video,
  tagCounts,
  initialTab,
  onChange,
  onRenameTag,
  onDeleteTag,
  onFilterTag,
  onOpenDetails,
  onClose,
}: TagPanelProps): React.JSX.Element {
  const t = useTranslations("library");
  const [tab, setTab] = useState<TagPanelTab>(video ? initialTab : "all");
  useEffect(() => setTab(video ? initialTab : "all"), [video?.assetId, initialTab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Esc inside a text field belongs to that field (clear, cancel a rename).
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.tagName === "INPUT") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.root}>
      <div className={styles.curtain} onClick={onClose} aria-hidden />
      <aside className={styles.drawer} role="dialog" aria-label={t("tagPanelTitle")}>
        <header className={styles.header}>
          <span className={styles.heading}>{t("tagPanelTitle")}</span>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={t("tagPanelClose")}
            title={t("tagPanelClose")}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </header>

        <div className={styles.tabs} role="tablist">
          {video && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "item"}
              className={styles.tab}
              onClick={() => setTab("item")}
            >
              {t("tagPanelTabItem")}
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={tab === "all"}
            className={styles.tab}
            onClick={() => setTab("all")}
          >
            {t("tagPanelTabAll", { count: tagCounts.length })}
          </button>
        </div>

        <div className={styles.body}>
          {tab === "item" && video ? (
            <ItemTags
              video={video}
              tagCounts={tagCounts}
              onChange={onChange}
              onOpenDetails={onOpenDetails}
            />
          ) : (
            <AllTags
              tagCounts={tagCounts}
              onRename={onRenameTag}
              onDelete={onDeleteTag}
              onFilter={onFilterTag}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function ItemTags({
  video,
  tagCounts,
  onChange,
  onOpenDetails,
}: {
  video: LibraryVideo;
  tagCounts: readonly TagCount[];
  onChange(tags: readonly string[]): void;
  onOpenDetails(): void;
}): React.JSX.Element {
  const t = useTranslations("library");
  const tags = video.tags ?? [];
  const atLimit = tags.length >= TAGS_PER_ITEM_MAX;
  const vocabulary = tagCounts.map((entry) => entry.tag);
  const quickTags = vocabulary.slice(0, QUICK_TAGS_SHOWN);

  const toggle = (tag: string): void => {
    const builder = new TagSetBuilder(tags);
    if (tags.includes(tag)) builder.remove(tag);
    else if (!atLimit) builder.add(tag);
    else return;
    onChange(builder.build());
  };

  return (
    <>
      <div className={styles.item}>
        <div className={styles.thumb}>
          {video.thumbnailUrl ? (
            <img src={video.thumbnailUrl} alt="" />
          ) : (
            <Film size={18} strokeWidth={1.5} aria-hidden />
          )}
        </div>
        <div className={styles.itemText}>
          <p className={styles.title}>{video.title || t("untitled")}</p>
          <button type="button" className={styles.link} onClick={onOpenDetails}>
            <ExternalLink size={12} strokeWidth={1.8} />
            {t("tagPanelOpenDetails")}
          </button>
        </div>
      </div>

      <section className={styles.section}>
        <span className={styles.label}>{t("tagPanelThisItem")}</span>
        <TagEditor tags={tags} vocabulary={vocabulary} onChange={onChange} />
        {tags.length === 0 && <p className={styles.hint}>{t("tagPanelEmpty")}</p>}
      </section>

      {quickTags.length > 0 && (
        <section className={styles.section}>
          <span className={styles.label}>{t("tagPanelQuick")}</span>
          <div className={styles.quick} role="group" aria-label={t("tagPanelQuick")}>
            {quickTags.map((tag) => {
              const on = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={styles.quickTag}
                  data-on={on}
                  aria-pressed={on}
                  disabled={!on && atLimit}
                  onClick={() => toggle(tag)}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function AllTags({
  tagCounts,
  onRename,
  onDelete,
  onFilter,
}: {
  tagCounts: readonly TagCount[];
  onRename(from: string, to: string): Promise<void>;
  onDelete(tag: string): Promise<void>;
  onFilter(tag: string): void;
}): React.JSX.Element {
  const t = useTranslations("library");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  if (tagCounts.length === 0) {
    return <p className={styles.hint}>{t("tagPanelNoTags")}</p>;
  }

  const commitRename = (from: string): void => {
    const to = normalizeTag(draft);
    setEditing(null);
    if (to !== null && to !== from) void onRename(from, to);
  };

  return (
    <ul className={styles.tagList} aria-label={t("tagPanelTabAll", { count: tagCounts.length })}>
      {tagCounts.map(({ tag, count }) => (
        <li key={tag} className={styles.tagRow}>
          {editing === tag ? (
            <input
              className={styles.renameInput}
              value={draft}
              autoFocus
              aria-label={t("tagRenameLabel", { tag })}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitRename(tag)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(tag);
                else if (e.key === "Escape") setEditing(null);
              }}
            />
          ) : (
            <button
              type="button"
              className={styles.tagName}
              title={t("tagFilterBy", { tag })}
              onClick={() => onFilter(tag)}
            >
              {tag}
              <span className={styles.count}>{count}</span>
            </button>
          )}

          {confirming === tag ? (
            <span className={styles.confirm}>
              {t("tagDeleteConfirm", { count })}
              <button
                type="button"
                className={styles.danger}
                aria-label={t("tagDelete", { tag })}
                onClick={() => {
                  setConfirming(null);
                  void onDelete(tag);
                }}
              >
                <Check size={14} strokeWidth={2} />
              </button>
              <button
                type="button"
                className={styles.rowAction}
                aria-label={t("cancel")}
                onClick={() => setConfirming(null)}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </span>
          ) : (
            editing !== tag && (
              <span className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.rowAction}
                  aria-label={t("tagRename", { tag })}
                  title={t("tagRename", { tag })}
                  onClick={() => {
                    setDraft(tag);
                    setEditing(tag);
                  }}
                >
                  <Pencil size={13} strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  className={styles.rowAction}
                  aria-label={t("tagDelete", { tag })}
                  title={t("tagDelete", { tag })}
                  onClick={() => setConfirming(tag)}
                >
                  <Trash2 size={13} strokeWidth={1.8} />
                </button>
              </span>
            )
          )}
        </li>
      ))}
    </ul>
  );
}
