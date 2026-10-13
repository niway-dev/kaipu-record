import React, { useEffect, useState } from "react";
import { Check, ExternalLink, Film, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  nextTagColor,
  normalizeTagName,
  TAGS_PER_ITEM_MAX,
  type TagColor,
} from "@kaipu/domain/constants";
import type { TagSummary } from "@shared/types";
import type { LibraryVideo } from "@renderer/features/library/types";
import { ColorMenu, TagChip } from "../tags/tag-chip";
import { TagEditor } from "./tag-editor";
import styles from "./tag-panel.module.css";

/** Library tags offered as one-click toggles, most used first. */
const QUICK_TAGS_SHOWN = 16;

export type TagPanelTab = "item" | "all";

interface TagPanelProps {
  /** The item being tagged; null when the drawer was opened to manage tags only. */
  video: LibraryVideo | null;
  /** Every live tag, most used first. */
  tags: readonly TagSummary[];
  initialTab: TagPanelTab;
  onAssign(tagIds: readonly string[]): void;
  onCreate(name: string, color?: TagColor): Promise<TagSummary | null>;
  onRename(id: string, name: string): Promise<void>;
  onRecolor(id: string, color: TagColor): Promise<void>;
  onDelete(id: string): Promise<void>;
  /** Show only the items carrying this tag in the Library. */
  onFilterTag(id: string): void;
  onOpenDetails(): void;
  onClose(): void;
}

/**
 * The Library's tag drawer: it slides in over the page from the right, behind a
 * curtain that dims the rest and closes it on click. Two tabs — tag the item it
 * was opened for, or manage every tag (create, recolor, rename, delete, filter).
 * Esc closes.
 */
export function TagPanel({
  video,
  tags,
  initialTab,
  onAssign,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
  onFilterTag,
  onOpenDetails,
  onClose,
}: TagPanelProps): React.JSX.Element {
  const t = useTranslations("library");
  const [tab, setTab] = useState<TagPanelTab>(video ? initialTab : "all");
  useEffect(() => setTab(video ? initialTab : "all"), [video?.assetId, initialTab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Esc inside a text field belongs to that field (clear, cancel a rename);
      // a menu that handled it already marked it.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
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
            {t("tagPanelTabAll", { count: tags.length })}
          </button>
        </div>

        <div className={styles.body}>
          {tab === "item" && video ? (
            <ItemTags
              video={video}
              tags={tags}
              onAssign={onAssign}
              onCreate={onCreate}
              onOpenDetails={onOpenDetails}
            />
          ) : (
            <AllTags
              tags={tags}
              onCreate={onCreate}
              onRename={onRename}
              onRecolor={onRecolor}
              onDelete={onDelete}
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
  tags,
  onAssign,
  onCreate,
  onOpenDetails,
}: {
  video: LibraryVideo;
  tags: readonly TagSummary[];
  onAssign(tagIds: readonly string[]): void;
  onCreate(name: string): Promise<TagSummary | null>;
  onOpenDetails(): void;
}): React.JSX.Element {
  const t = useTranslations("library");
  const ids = video.tagIds ?? [];
  const assigned = ids.flatMap((id) => tags.filter((tag) => tag.id === id));
  const atLimit = ids.length >= TAGS_PER_ITEM_MAX;
  const quickTags = tags.slice(0, QUICK_TAGS_SHOWN);

  const toggle = (id: string): void => {
    if (ids.includes(id)) onAssign(ids.filter((other) => other !== id));
    else if (!atLimit) onAssign([...ids, id]);
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
        <TagEditor assigned={assigned} all={tags} onAssign={onAssign} onCreate={onCreate} />
        {assigned.length === 0 && <p className={styles.hint}>{t("tagPanelEmpty")}</p>}
      </section>

      {quickTags.length > 0 && (
        <section className={styles.section}>
          <span className={styles.label}>{t("tagPanelQuick")}</span>
          <div className={styles.quick} role="group" aria-label={t("tagPanelQuick")}>
            {quickTags.map((tag) => {
              const on = ids.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={styles.quickTag}
                  data-on={on}
                  aria-pressed={on}
                  aria-label={tag.name}
                  disabled={!on && atLimit}
                  onClick={() => toggle(tag.id)}
                >
                  <TagChip name={tag.name} color={tag.color} size="md" />
                </button>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function CreateTag({
  tags,
  onCreate,
}: {
  tags: readonly TagSummary[];
  onCreate(name: string, color?: TagColor): Promise<TagSummary | null>;
}): React.JSX.Element {
  const t = useTranslations("library");
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>(() => nextTagColor(tags.map((tag) => tag.color)));
  const clean = normalizeTagName(name);
  const taken =
    clean !== null && tags.some((tag) => tag.name.toLowerCase() === clean.toLowerCase());

  const submit = async (): Promise<void> => {
    if (clean === null || taken) return;
    const created = await onCreate(clean, color);
    if (created) {
      setName("");
      setColor(nextTagColor([...tags.map((tag) => tag.color), color]));
    }
  };

  return (
    <section className={styles.section}>
      <span className={styles.label}>{t("tagCreateTitle")}</span>
      <div className={styles.createRow}>
        <ColorMenu value={color} onChange={setColor} label={t("tagColorLabel")} />
        <input
          className={styles.createInput}
          value={name}
          aria-label={t("tagCreateName")}
          placeholder={t("tagCreatePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            else if (e.key === "Escape") setName("");
          }}
        />
        <button
          type="button"
          className={styles.createButton}
          disabled={clean === null || taken}
          onClick={() => void submit()}
        >
          <Plus size={14} strokeWidth={2} />
          {t("tagCreate")}
        </button>
      </div>
      {clean !== null && (
        <p className={styles.hint}>
          {taken ? t("tagNameTaken") : <TagChip name={clean} color={color} size="md" />}
        </p>
      )}
    </section>
  );
}

function AllTags({
  tags,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
  onFilter,
}: {
  tags: readonly TagSummary[];
  onCreate(name: string, color?: TagColor): Promise<TagSummary | null>;
  onRename(id: string, name: string): Promise<void>;
  onRecolor(id: string, color: TagColor): Promise<void>;
  onDelete(id: string): Promise<void>;
  onFilter(id: string): void;
}): React.JSX.Element {
  const t = useTranslations("library");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const commitRename = (tag: TagSummary): void => {
    const name = normalizeTagName(draft);
    setEditing(null);
    if (name !== null && name !== tag.name) void onRename(tag.id, name);
  };

  return (
    <>
      <CreateTag tags={tags} onCreate={onCreate} />

      {tags.length === 0 ? (
        <p className={styles.hint}>{t("tagPanelNoTags")}</p>
      ) : (
        <ul className={styles.tagList} aria-label={t("tagPanelTabAll", { count: tags.length })}>
          {tags.map((tag) => (
            <li key={tag.id} className={styles.tagRow}>
              <span className={styles.tagMain}>
                <ColorMenu
                  value={tag.color}
                  onChange={(color) => void onRecolor(tag.id, color)}
                  label={t("tagRecolor", { tag: tag.name })}
                />
                {editing === tag.id ? (
                  <input
                    className={styles.renameInput}
                    value={draft}
                    autoFocus
                    aria-label={t("tagRenameLabel", { tag: tag.name })}
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
                    title={t("tagFilterBy", { tag: tag.name })}
                    onClick={() => onFilter(tag.id)}
                  >
                    <TagChip name={tag.name} color={tag.color} size="md" />
                    <span className={styles.slug}>#{tag.slug}</span>
                    <span className={styles.count}>{tag.count}</span>
                  </button>
                )}
              </span>

              {confirming === tag.id ? (
                <span className={styles.confirm}>
                  {t("tagDeleteConfirm", { count: tag.count })}
                  <button
                    type="button"
                    className={styles.danger}
                    aria-label={t("tagDelete", { tag: tag.name })}
                    onClick={() => {
                      setConfirming(null);
                      void onDelete(tag.id);
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
                editing !== tag.id && (
                  <span className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.rowAction}
                      aria-label={t("tagRename", { tag: tag.name })}
                      title={t("tagRename", { tag: tag.name })}
                      onClick={() => {
                        setDraft(tag.name);
                        setEditing(tag.id);
                      }}
                    >
                      <Pencil size={13} strokeWidth={1.8} />
                    </button>
                    <button
                      type="button"
                      className={styles.rowAction}
                      aria-label={t("tagDelete", { tag: tag.name })}
                      title={t("tagDelete", { tag: tag.name })}
                      onClick={() => setConfirming(tag.id)}
                    >
                      <Trash2 size={13} strokeWidth={1.8} />
                    </button>
                  </span>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
