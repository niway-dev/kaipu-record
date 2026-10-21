/**
 * The four moments the page is built around, plus the two bookends the rail also
 * tracks. One list, consumed by the rail, the hero chips and the sections, so a
 * chapter cannot exist in the navigation and not on the page — or drift in
 * colour between the two.
 *
 * Written as a literal (`as const`) with the types derived from it rather than
 * declared over it: that keeps `labelKey` a union of real message keys, so a
 * typo is a compile error instead of a blank label in production.
 *
 * `tint` names a token in landing-tokens.css rather than carrying a hex — the
 * colour stays in the stylesheet, where the theme can reach it.
 */
export const CHAPTERS = [
  { id: "hero", slug: "top", number: null, tint: null, labelKey: "navBrand" },
  { id: "record", slug: "record", number: "01", tint: "c1", labelKey: "homeChapter1Label" },
  { id: "capture", slug: "capture", number: "02", tint: "c2", labelKey: "homeChapter2Label" },
  { id: "edit", slug: "edit", number: "03", tint: "c3", labelKey: "homeChapter3Label" },
  { id: "find", slug: "find", number: "04", tint: "c4", labelKey: "homeChapter4Label" },
  { id: "files", slug: "files", number: null, tint: "c5", labelKey: "homeFilesLabel" },
] as const;

export type Chapter = (typeof CHAPTERS)[number];
export type ChapterId = Chapter["id"];

/** The numbered chapters only — what the hero's four chips list. */
export const NUMBERED = CHAPTERS.filter(
  (c): c is Extract<Chapter, { number: string }> => c.number !== null,
);
