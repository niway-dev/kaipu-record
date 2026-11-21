import {
  Crop,
  Folder,
  Scissors,
  Search,
  Send,
  Sparkles,
  Video,
  type LucideIcon,
} from "lucide-react";

/**
 * The moments the page is built around, plus the bookends the rail also tracks.
 * One list per page, consumed by the rail, the mobile strip and the sections, so a
 * chapter cannot exist in the navigation and not on the page — or drift in
 * colour between the two.
 *
 * Written as a literal (`as const`) with the types derived from it rather than
 * declared over it: that keeps `labelKey` a union of real message keys, so a
 * typo is a compile error instead of a blank label in production.
 *
 * `tint` names a token in landing-tokens.css rather than carrying a hex — the
 * colour stays in the stylesheet, where the theme can reach it.
 *
 * Two lists exist because two pages wear the same rail. The home merged Record and
 * Capture into one Capture chapter and added Share and On the way; the features
 * catalogue still groups its feature cards by the original four chapters
 * (record, capture, edit, find), and its sections carry those ids.
 */

export interface ChapterDef {
  /** Section id and scroll-spy target. */
  id: string;
  slug: string;
  number: string | null;
  tint: "c1" | "c2" | "c3" | "c4" | "c5" | null;
  labelKey:
    | "navBrand"
    | "homeChapter1Label"
    | "homeChapter2Label"
    | "homeChapter3Label"
    | "homeChapter4Label"
    | "homeChapter5Label"
    | "homeOnTheWayEyebrow"
    | "homeFilesLabel";
  /** The rail icon; the bookend "hero" has none (the rail draws the logo). */
  icon: LucideIcon | null;
}

/** The home: Capture, Edit, Share, Find, then what is on the way and the files bookend. */
export const CHAPTERS = [
  { id: "hero", slug: "top", number: null, tint: null, labelKey: "navBrand", icon: null },
  {
    id: "capture",
    slug: "capture",
    number: "01",
    tint: "c1",
    labelKey: "homeChapter2Label",
    icon: Crop,
  },
  {
    id: "edit",
    slug: "edit",
    number: "02",
    tint: "c3",
    labelKey: "homeChapter3Label",
    icon: Scissors,
  },
  {
    id: "share",
    slug: "share",
    number: "03",
    tint: "c2",
    labelKey: "homeChapter5Label",
    icon: Send,
  },
  {
    id: "find",
    slug: "find",
    number: "04",
    tint: "c4",
    labelKey: "homeChapter4Label",
    icon: Search,
  },
  {
    id: "on-the-way",
    slug: "on-the-way",
    number: null,
    tint: "c2",
    labelKey: "homeOnTheWayEyebrow",
    icon: Sparkles,
  },
  {
    id: "files",
    slug: "files",
    number: null,
    tint: "c5",
    labelKey: "homeFilesLabel",
    icon: Folder,
  },
] as const satisfies readonly ChapterDef[];

/** The features catalogue keeps the original four chapters, so its section ids still match. */
export const FEATURES_CHAPTERS = [
  { id: "hero", slug: "top", number: null, tint: null, labelKey: "navBrand", icon: null },
  {
    id: "record",
    slug: "record",
    number: "01",
    tint: "c1",
    labelKey: "homeChapter1Label",
    icon: Video,
  },
  {
    id: "capture",
    slug: "capture",
    number: "02",
    tint: "c2",
    labelKey: "homeChapter2Label",
    icon: Crop,
  },
  {
    id: "edit",
    slug: "edit",
    number: "03",
    tint: "c3",
    labelKey: "homeChapter3Label",
    icon: Scissors,
  },
  {
    id: "find",
    slug: "find",
    number: "04",
    tint: "c4",
    labelKey: "homeChapter4Label",
    icon: Search,
  },
  {
    id: "files",
    slug: "files",
    number: null,
    tint: "c5",
    labelKey: "homeFilesLabel",
    icon: Folder,
  },
] as const satisfies readonly ChapterDef[];

export type Chapters = readonly ChapterDef[];

/** The numbered chapters only — what the mobile strip lists. */
export function numbered(chapters: Chapters): ChapterDef[] {
  return chapters.filter((c) => c.number !== null);
}
