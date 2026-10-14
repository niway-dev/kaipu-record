import type { LibraryVideo } from "@renderer/features/library/types";

/**
 * The Editor home's list: "what was I working on?". Not a second Library — no
 * search, no management — just every editable item ordered by when it was last
 * touched, a few filters, and pages instead of a cut-off at the newest five.
 */

/** How many rows one page of the Editor home shows. */
export const RECENT_PAGE_SIZE = 8;

export type RecentFilter = "all" | "videos" | "images" | "unedited";
export const RECENT_FILTERS: readonly RecentFilter[] = ["all", "videos", "images", "unedited"];

type Item = Pick<LibraryVideo, "kind" | "createdAt" | "editSavedAt" | "derivedFromAssetId">;

/**
 * When the item was last worked on: its last edit-session save, or its creation
 * when it was never edited. A recording edited today outranks one recorded today
 * and edited last week, which is the order "the last one I edited" asks for.
 */
export function lastActivity(item: Item): number {
  return Math.max(item.createdAt, item.editSavedAt ?? 0);
}

/** True when the item's last activity is an edit, not its creation. */
export function wasEdited(item: Item): boolean {
  return item.editSavedAt !== null && item.editSavedAt >= item.createdAt;
}

/**
 * Whether an item belongs under a filter. "Not edited" is the recordings waiting
 * for a first edit: an export is already the result of one, and a screenshot has
 * no edit session to tell.
 */
export function matchesFilter(item: Item, filter: RecentFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "videos":
      return item.kind !== "screenshot";
    case "images":
      return item.kind === "screenshot";
    case "unedited":
      return item.kind === "recording" && !item.derivedFromAssetId && item.editSavedAt === null;
  }
}

/** Filter, then newest activity first. Ties keep the newer creation first. */
export function recentItems<T extends Item>(items: readonly T[], filter: RecentFilter): T[] {
  return items
    .filter((item) => matchesFilter(item, filter))
    .sort((a, b) => lastActivity(b) - lastActivity(a) || b.createdAt - a.createdAt);
}

export interface Page<T> {
  rows: T[];
  /** Zero-based, clamped to the pages that exist. */
  page: number;
  pageCount: number;
  /** One-based range shown, for "9–16 of 23". `from` is 0 when there are no rows. */
  from: number;
  to: number;
  total: number;
}

/**
 * One page of `items`. An out-of-range page (the list shrank under the user, a
 * filter left fewer pages) clamps to the last page rather than showing nothing.
 */
export function paginate<T>(items: readonly T[], page: number, size = RECENT_PAGE_SIZE): Page<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(0, page), pageCount - 1);
  const start = current * size;
  const rows = items.slice(start, start + size);
  return {
    rows,
    page: current,
    pageCount,
    from: rows.length ? start + 1 : 0,
    to: start + rows.length,
    total,
  };
}

/** "3 hours ago", "yesterday", in the app's locale. */
export function formatAgo(epochMs: number, now: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const seconds = Math.round((epochMs - now) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, span] of units) {
    if (Math.abs(seconds) >= span) return rtf.format(Math.round(seconds / span), unit);
  }
  return rtf.format(0, "minute");
}
