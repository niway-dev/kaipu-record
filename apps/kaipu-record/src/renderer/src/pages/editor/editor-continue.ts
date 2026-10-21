import type { LibraryVideo } from "@renderer/features/library/types";

/**
 * The Editor home's Continue list: only what was worked on in an editor, newest
 * first. It is not a second Library. A file that was only recorded or captured
 * stays in the Library until it is opened here.
 *
 * What counts as work, per kind, and the label it earns:
 * - a video: its last edit-session save ("Edited"), else its last open ("Opened");
 * - an image: its last manual Save from the image editor ("Saved"), else its last
 *   open ("Opened"). A saved image is a flat PNG with no session, so there is no
 *   "Edited" for images.
 */

export type EditorTab = "images" | "videos";

/** Rows under the "last worked on" card before Show older. */
export const CONTINUE_ROWS = 4;
/** How many more rows each Show older adds. */
export const SHOW_OLDER_STEP = 5;

type Item = Pick<LibraryVideo, "kind" | "editSavedAt" | "editorOpenedAt" | "editorSavedAt">;

export interface Activity {
  at: number;
  label: "edited" | "saved" | "opened";
}

export const tabOf = (item: Pick<LibraryVideo, "kind">): EditorTab =>
  item.kind === "screenshot" ? "images" : "videos";

/** The item's last editor activity, or null when it was never opened in an editor. */
export function activityOf(item: Item): Activity | null {
  const opened = item.editorOpenedAt ?? null;
  const worked = item.kind === "screenshot" ? (item.editorSavedAt ?? null) : item.editSavedAt;
  const workedLabel = item.kind === "screenshot" ? "saved" : "edited";
  if (worked !== null && (opened === null || worked >= opened)) {
    return { at: worked, label: workedLabel };
  }
  return opened !== null ? { at: opened, label: "opened" } : null;
}

export interface ContinueEntry<T> {
  item: T;
  activity: Activity;
}

/** One tab's Continue list: items with editor activity, most recent first. */
export function continueList<T extends Item>(
  items: readonly T[],
  tab: EditorTab,
): ContinueEntry<T>[] {
  return items
    .filter((item) => tabOf(item) === tab)
    .flatMap((item) => {
      const activity = activityOf(item);
      return activity ? [{ item, activity }] : [];
    })
    .sort((a, b) => b.activity.at - a.activity.at);
}

/**
 * The tab to open on: the one holding the most recent activity, so "the last
 * thing I worked on" is what the page shows first. Images when nothing has any,
 * because that tab has a way to start.
 */
export function defaultTab(items: readonly Item[]): EditorTab {
  const latest = (tab: EditorTab): number => continueList(items, tab)[0]?.activity.at ?? -1;
  return latest("videos") > latest("images") ? "videos" : "images";
}

/** "3 hours ago", "yesterday", "last week", in the app's locale. */
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
