/**
 * Recording tags: short, normalized labels on a library item (`kaipu`, `cricut`,
 * `issue-#1232`). Plain strings, not a managed taxonomy — the vocabulary is just
 * the union of the tags in use.
 *
 * Pure and shared: the desktop validates with it before anything touches the
 * file system, and the cloud catalog (Phase 2) validates with the same rules.
 * `TagSetBuilder` is the only way a tag list should reach a store.
 */

export const TAG_MAX_LENGTH = 32;
export const TAGS_PER_ITEM_MAX = 20;

/** Lowercase letters, digits and `- _ # .` — nothing else after normalization. */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9\-_#.]*$/;

/**
 * Normalize a raw tag: trim, lowercase, whitespace runs → "-", collapse repeated
 * "-", strip leading/trailing "-". Returns null when the result is empty, too
 * long, or contains anything outside {@link TAG_PATTERN} — so a path separator
 * or a control character can never reach a file or a query.
 *
 * `" Cricut "` → `cricut`; `"Issue #1232"` → `issue-#1232`; `"../x"` → null.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (tag.length === 0 || tag.length > TAG_MAX_LENGTH) return null;
  return TAG_PATTERN.test(tag) ? tag : null;
}

export class TagLimitError extends Error {
  constructor() {
    super(`An item can carry at most ${TAGS_PER_ITEM_MAX} tags`);
    this.name = "TagLimitError";
  }
}

/** Builds a normalized, de-duplicated tag list, keeping insertion order. */
export class TagSetBuilder {
  private readonly tags: string[] = [];

  constructor(initial: Iterable<string> = []) {
    for (const raw of initial) this.add(raw);
  }

  /** Add a raw tag. Invalid tags are ignored; duplicates (after normalizing) too. */
  add(raw: string): this {
    const tag = normalizeTag(raw);
    if (tag !== null && !this.tags.includes(tag)) this.tags.push(tag);
    return this;
  }

  remove(tag: string): this {
    const normalized = normalizeTag(tag);
    const i = normalized === null ? -1 : this.tags.indexOf(normalized);
    if (i !== -1) this.tags.splice(i, 1);
    return this;
  }

  /** The tag list. Throws {@link TagLimitError} past {@link TAGS_PER_ITEM_MAX}. */
  build(): readonly string[] {
    if (this.tags.length > TAGS_PER_ITEM_MAX) throw new TagLimitError();
    return [...this.tags];
  }
}
