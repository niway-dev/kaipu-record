import React, { useEffect, useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { normalizeTag, TagSetBuilder, TAGS_PER_ITEM_MAX } from "@kaipu/domain/constants";
import styles from "./tag-editor.module.css";

/** Suggestions shown under the input at most. */
const SUGGESTIONS_MAX = 6;

interface TagEditorProps {
  tags: readonly string[];
  /** Called with the whole next list, already normalized by `TagSetBuilder`. */
  onChange: (tags: readonly string[]) => void;
  /** Tags in use across the library (most used first), for autocomplete. */
  vocabulary: readonly string[];
}

/**
 * Tag field for one library item: chips plus an input. Enter or comma adds the
 * typed tag, Backspace on an empty input removes the last chip, and suggestions
 * come from the library's vocabulary. Every list leaves through `TagSetBuilder`,
 * so `Cricut` and `cricut` can never become two tags.
 */
export function TagEditor({ tags, onChange, vocabulary }: TagEditorProps): React.JSX.Element {
  const t = useTranslations("library");
  const [draft, setDraft] = useState("");
  const listId = useId();
  const atLimit = tags.length >= TAGS_PER_ITEM_MAX;

  const suggestions = useMemo(() => {
    const needle = normalizeTag(draft);
    if (needle === null) return [];
    return vocabulary
      .filter((tag) => tag !== needle && tag.includes(needle) && !tags.includes(tag))
      .slice(0, SUGGESTIONS_MAX);
  }, [draft, vocabulary, tags]);

  const add = (...raws: string[]): void => {
    setDraft("");
    const builder = new TagSetBuilder(tags);
    // Stop at the limit instead of letting build() throw: the rest is dropped.
    for (const raw of raws) {
      const before = builder.build().length;
      if (before >= TAGS_PER_ITEM_MAX) break;
      builder.add(raw);
    }
    const next = builder.build();
    if (next.length !== tags.length) onChange(next);
  };

  const remove = (tag: string): void => {
    onChange(new TagSetBuilder(tags).remove(tag).build());
  };

  return (
    <div className={styles.editor}>
      <ul className={styles.chips} aria-label={t("tagsLabel")}>
        {tags.map((tag) => (
          <li key={tag} className={styles.chip}>
            {tag}
            <button
              type="button"
              className={styles.remove}
              aria-label={t("tagsRemove", { tag })}
              onClick={() => remove(tag)}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.field}>
        <input
          className={styles.input}
          value={draft}
          aria-label={t("tagsLabel")}
          aria-autocomplete="list"
          aria-controls={suggestions.length > 0 ? listId : undefined}
          placeholder={atLimit ? t("tagsLimit", { max: TAGS_PER_ITEM_MAX }) : t("tagsPlaceholder")}
          disabled={atLimit}
          onChange={(e) => {
            const value = e.target.value;
            // A pasted "a, b" adds every complete piece and keeps the last typing.
            if (value.includes(",")) {
              const pieces = value.split(",");
              const rest = pieces.pop() ?? "";
              add(...pieces);
              setDraft(rest.trimStart());
              return;
            }
            setDraft(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
              remove(tags[tags.length - 1]);
            } else if (e.key === "Escape") {
              setDraft("");
            }
          }}
        />
        {suggestions.length > 0 && (
          <ul id={listId} role="listbox" className={styles.suggestions}>
            {suggestions.map((tag) => (
              <li key={tag} role="option" aria-selected={false}>
                <button
                  type="button"
                  className={styles.suggestion}
                  // mousedown, not click: keep the input focused while picking.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(tag);
                  }}
                >
                  {tag}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Loads the library's tag vocabulary once for autocomplete (most used first). */
export function useTagVocabulary(refreshKey: unknown): string[] {
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .getTagVocabulary()
      .then((entries) => {
        if (!cancelled) setVocabulary(entries.map((entry) => entry.tag));
      })
      // Autocomplete is a convenience: without it the field still works.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return vocabulary;
}
