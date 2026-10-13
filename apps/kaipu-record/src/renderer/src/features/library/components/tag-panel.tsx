import React, { useEffect } from "react";
import { ExternalLink, Film, X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { TagSetBuilder, TAGS_PER_ITEM_MAX } from "@kaipu/domain/constants";
import type { LibraryVideo } from "@renderer/features/library/types";
import { TagEditor } from "./tag-editor";
import styles from "./tag-panel.module.css";

/** Library tags offered as one-click toggles, most used first. */
const QUICK_TAGS_SHOWN = 12;

interface TagPanelProps {
  video: LibraryVideo;
  /** Tags in use across the library, most used first (autocomplete + quick picks). */
  vocabulary: readonly string[];
  onChange(tags: readonly string[]): void;
  onOpenDetails(): void;
  onClose(): void;
}

/**
 * Side panel for tagging one library item without leaving the Library. The
 * typed field is the same `TagEditor` the detail page uses; below it, the
 * library's most used tags toggle on and off with one click, which is the fast
 * path once a vocabulary exists. Esc closes it.
 */
export function TagPanel({
  video,
  vocabulary,
  onChange,
  onOpenDetails,
  onClose,
}: TagPanelProps): React.JSX.Element {
  const t = useTranslations("library");
  const tags = video.tags ?? [];
  const atLimit = tags.length >= TAGS_PER_ITEM_MAX;
  const quickTags = vocabulary.slice(0, QUICK_TAGS_SHOWN);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Esc inside the tag field clears the draft (TagEditor); elsewhere it closes.
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.tagName === "INPUT") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (tag: string): void => {
    const builder = new TagSetBuilder(tags);
    if (tags.includes(tag)) builder.remove(tag);
    else if (!atLimit) builder.add(tag);
    else return;
    onChange(builder.build());
  };

  return (
    <aside className={styles.panel} aria-label={t("tagPanelTitle")}>
      <header className={styles.header}>
        <span className={styles.heading}>{t("tagPanelTitle")}</span>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label={t("tagPanelClose")}
          title={t("tagPanelClose")}
        >
          <X size={15} strokeWidth={1.8} />
        </button>
      </header>

      <div className={styles.item}>
        <div className={styles.thumb}>
          {video.thumbnailUrl ? (
            <img src={video.thumbnailUrl} alt="" />
          ) : (
            <Film size={18} strokeWidth={1.5} aria-hidden />
          )}
        </div>
        <p className={styles.title}>{video.title || t("untitled")}</p>
      </div>

      <section className={styles.section}>
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

      <button type="button" className={styles.details} onClick={onOpenDetails}>
        <ExternalLink size={13} strokeWidth={1.8} />
        {t("tagPanelOpenDetails")}
      </button>
    </aside>
  );
}
