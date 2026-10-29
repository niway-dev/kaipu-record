import React, { useId, useMemo, useRef, useState } from "react";
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
  /**
   * Called with the item's whole next list of tag ids. May return a promise; the
   * list counts as in flight until it settles.
   */
  onAssign(tagIds: readonly string[]): void | Promise<void>;
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
  // Latest list this editor knows of: the prop when idle, the last list sent while
  // a save is in flight. Edits build on this, never on the render closure, so two
  // quick edits (or a multi-tag paste) cannot drop each other's changes.
  const idsRef = useRef<readonly string[]>(ids);
  const pending = useRef(0);
  const [, rerender] = useState(0);
  if (pending.current === 0) idsRef.current = ids;
  const atLimit = ids.length >= TAGS_PER_ITEM_MAX;

  const suggestions = useMemo(() => {
    const needle = tagSlug(draft.replace(/^#/, ""));
    if (needle === "") return [];
    return all
      .filter((tag) => !ids.includes(tag.id) && tag.slug.includes(needle))
      .slice(0, SUGGESTIONS_MAX);
  }, [draft, all, ids]);

  const commit = (next: readonly string[]): void => {
    idsRef.current = next;
    pending.current += 1;
    void Promise.resolve(onAssign(next)).finally(() => {
      pending.current -= 1;
      // Re-render so the idle branch above re-syncs the ref with the props (also
      // restores the list when the save failed and the props never changed).
      rerender((n) => n + 1);
    });
  };

  const assignMany = (tagIds: readonly string[]): void => {
    const next = [...idsRef.current];
    for (const id of tagIds) {
      if (next.length >= TAGS_PER_ITEM_MAX) break;
      if (!next.includes(id)) next.push(id);
    }
    if (next.length !== idsRef.current.length) commit(next);
  };

  const assign = (tag: TagSummary): void => assignMany([tag.id]);

  /** Resolves each piece to a tag (creating missing ones one at a time), then assigns all in ONE call. */
  const addMany = async (raws: readonly string[]): Promise<void> => {
    if (idsRef.current.length >= TAGS_PER_ITEM_MAX) return;
    const resolved: string[] = [];
    const seen = new Set<string>();
    for (const raw of raws) {
      // Stop before creating a tag that the per-item cap would refuse to assign.
      if (idsRef.current.length + resolved.length >= TAGS_PER_ITEM_MAX) break;
      const name = normalizeTagName(raw.replace(/^#/, ""));
      if (name === null) continue;
      const slug = tagSlug(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const tag = all.find((candidate) => candidate.slug === slug) ?? (await onCreate(name));
      if (tag) resolved.push(tag.id);
    }
    assignMany(resolved);
  };

  const add = (raw: string): Promise<void> => {
    setDraft("");
    return addMany([raw]);
  };

  const remove = (id: string): void => commit(idsRef.current.filter((other) => other !== id));

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
              void addMany(pieces);
              setDraft(rest.trimStart());
              return;
            }
            setDraft(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add(draft);
            } else if (e.key === "Backspace" && draft === "" && idsRef.current.length > 0) {
              remove(idsRef.current[idsRef.current.length - 1]!);
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
