import React, { useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { normalizeTagName, tagSlug, TAGS_PER_ITEM_MAX } from "@kaipu/domain/constants";
import type { TagSummary } from "@shared/types";
import { TagChip } from "../tags/tag-chip";
import styles from "./tag-editor.module.css";

/** Suggestions shown under the input at most. */
const SUGGESTIONS_MAX = 6;

interface TagEditorProps {
  /** The tags the item carries now, in order. */
  assigned: readonly TagSummary[];
  /** Every live tag in the library (most used first), for suggestions. */
  all: readonly TagSummary[];
  /** Called with the item's whole next list of tag ids. */
  onAssign(tagIds: readonly string[]): void;
  /** Create a tag by name; resolves to it (or the existing one with that name). */
  onCreate(name: string): Promise<TagSummary | null>;
}

/**
 * Tag field for one library item: colored chips plus an input. Enter or comma
 * adds the typed tag — the existing one when its name matches (`demo` finds
 * `Demo`), otherwise a new tag. Backspace on an empty input removes the last chip;
 * suggestions match by name or slug (`#arch` finds `Archivos varios`).
 */
export function TagEditor({
  assigned,
  all,
  onAssign,
  onCreate,
}: TagEditorProps): React.JSX.Element {
  const t = useTranslations("library");
  const [draft, setDraft] = useState("");
  const listId = useId();
  const ids = assigned.map((tag) => tag.id);
  const atLimit = ids.length >= TAGS_PER_ITEM_MAX;

  const suggestions = useMemo(() => {
    const needle = tagSlug(draft.replace(/^#/, ""));
    if (needle === "") return [];
    return all
      .filter((tag) => !ids.includes(tag.id) && tag.slug.includes(needle))
      .slice(0, SUGGESTIONS_MAX);
  }, [draft, all, ids]);

  const assign = (tag: TagSummary): void => {
    if (!ids.includes(tag.id) && !atLimit) onAssign([...ids, tag.id]);
  };

  const add = async (raw: string): Promise<void> => {
    setDraft("");
    const name = normalizeTagName(raw.replace(/^#/, ""));
    if (name === null || atLimit) return;
    const existing = all.find((tag) => tag.slug === tagSlug(name));
    const tag = existing ?? (await onCreate(name));
    if (tag) assign(tag);
  };

  const remove = (id: string): void => onAssign(ids.filter((other) => other !== id));

  return (
    <div className={styles.editor}>
      <ul className={styles.chips} aria-label={t("tagsLabel")}>
        {assigned.map((tag) => (
          <li key={tag.id} className={styles.chip}>
            <TagChip name={tag.name} color={tag.color} size="md" />
            <button
              type="button"
              className={styles.remove}
              aria-label={t("tagsRemove", { tag: tag.name })}
              onClick={() => remove(tag.id)}
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
              void pieces.reduce((done, piece) => done.then(() => add(piece)), Promise.resolve());
              setDraft(rest.trimStart());
              return;
            }
            setDraft(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add(draft);
            } else if (e.key === "Backspace" && draft === "" && ids.length > 0) {
              remove(ids[ids.length - 1]!);
            } else if (e.key === "Escape") {
              setDraft("");
            }
          }}
        />
        {suggestions.length > 0 && (
          <ul id={listId} role="listbox" className={styles.suggestions}>
            {suggestions.map((tag) => (
              <li key={tag.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className={styles.suggestion}
                  // mousedown, not click: keep the input focused while picking.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDraft("");
                    assign(tag);
                  }}
                >
                  <TagChip name={tag.name} color={tag.color} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
