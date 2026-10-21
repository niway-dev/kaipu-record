/**
 * Tags are entities (ADR 0020): a stable id, a display name, a lowercase slug
 * derived from the name, and a color from a fixed palette. Items reference tags
 * by id, so a rename or a recolor never touches an item.
 *
 * Pure and shared: the desktop validates with it before anything touches the
 * file system, and the cloud (Phase 2) validates with the same rules.
 */

export const TAG_NAME_MAX_LENGTH = 32;
export const TAGS_PER_ITEM_MAX = 20;

/**
 * The palette, stored by name (never hex) so it can be retuned without migrating
 * data. The renderer maps each name to fill, border and text tokens.
 */
export const TAG_COLORS = [
  "rose",
  "coral",
  "amber",
  "lime",
  "mint",
  "lagoon",
  "sky",
  "iris",
  "orchid",
  "slate",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export function isTagColor(value: unknown): value is TagColor {
  return typeof value === "string" && (TAG_COLORS as readonly string[]).includes(value);
}

export interface Tag {
  /** UUID, minted on any device. The only identity: names and slugs change. */
  id: string;
  /** Display name: free text, unique case-insensitively (through the slug). */
  name: string;
  /** Lowercase form of the name, for typing (`#archivos_varios`) and search. */
  slug: string;
  color: TagColor;
  createdAt: number;
  updatedAt: number;
  /** Device ids, for traceability (where a tag came from, where it last changed). */
  createdOn: string;
  updatedOn: string;
  /** Tombstone: set when deleted, so a stale device cannot bring it back. */
  deletedAt: number | null;
}

/**
 * Clean a raw tag name: trim, collapse whitespace, refuse control characters and
 * path separators. Returns null when nothing usable is left or it is too long.
 *
 * `"  Archivos   varios "` → `"Archivos varios"`; `"a/b"` → null.
 */
export function normalizeTagName(raw: string): string | null {
  const name = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > TAG_NAME_MAX_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f/\\]/.test(name)) return null;
  return tagSlug(name) === "" ? null : name;
}

/**
 * The slug of a name: lowercase, spaces and separators to `_`, anything but
 * letters, digits, `_`, `-` and `#` dropped. Two names with the same slug are the
 * same tag, so `Demo` and `demo` can never both exist.
 *
 * `"Archivos varios"` → `"archivos_varios"`; `"Issue #1232"` → `"issue_#1232"`.
 */
export function tagSlug(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s.,;:]+/g, "_")
    .replace(/[^\p{L}\p{N}_\-#]/gu, "")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The palette color used by the fewest live tags (first in palette order on ties). */
export function nextTagColor(used: readonly TagColor[]): TagColor {
  const counts = new Map<TagColor, number>(TAG_COLORS.map((c) => [c, 0]));
  for (const color of used) counts.set(color, (counts.get(color) ?? 0) + 1);
  return TAG_COLORS.reduce((best, color) =>
    counts.get(color)! < counts.get(best)! ? color : best,
  );
}

export class TagLimitError extends Error {
  constructor() {
    super(`An item can carry at most ${TAGS_PER_ITEM_MAX} tags`);
    this.name = "TagLimitError";
  }
}

export class TagNameTakenError extends Error {
  constructor(readonly existingId: string) {
    super("A tag with this name already exists");
    this.name = "TagNameTakenError";
  }
}
