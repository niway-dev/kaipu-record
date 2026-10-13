/**
 * The public roadmap, grouped by status rather than by date: statuses stay true
 * as work slips, while quarters go stale the moment a plan moves.
 *
 * To update the roadmap, edit this list. The copy for every id lives in the
 * `roadmap.items` namespace of `@kaipu/i18n` (en + es), whose parity test keeps
 * both locales complete.
 */

/** Rendered top to bottom: what already ships, what is being built, what comes next. */
export const ROADMAP_STATUSES = ["shipped", "inProgress", "planned"] as const;

export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

/**
 * `as const` on purpose: it narrows every id to a literal, so `useTranslations`
 * rejects an item whose copy is missing at compile time instead of rendering a
 * raw key in production.
 */
export const ROADMAP_ITEMS = [
  // Shipped — newest first, so the top of the group is the freshest news.
  { id: "watermark", status: "shipped" },
  { id: "saveEveryScreenshot", status: "shipped" },
  { id: "videoZoom", status: "shipped" },
  { id: "accounts", status: "shipped" },
  { id: "cloudFoundation", status: "shipped" },
  { id: "screenshotAnnotations", status: "shipped" },
  { id: "library", status: "shipped" },
  { id: "themeAndLanguages", status: "shipped" },
  { id: "videoEditor", status: "shipped" },
  { id: "shortcuts", status: "shipped" },
  { id: "screenAndCamera", status: "shipped" },

  // Planned — this order is the order shown, not a commitment to dates.
  // Every planned item has a design doc in the docs site (backlog/) before it is
  // built; the public-roadmap-page doc maps each id to its doc.
  { id: "windowsBeta", status: "planned" },
  { id: "cloudUpload", status: "planned" },
  { id: "photoZoom", status: "planned" },
  { id: "imageTags", status: "planned" },
  { id: "watermarkUpgrade", status: "planned" },
  { id: "renameOnSave", status: "planned" },
  { id: "brandIdentity", status: "planned" },
] as const satisfies readonly { id: string; status: RoadmapStatus }[];

export type RoadmapItem = (typeof ROADMAP_ITEMS)[number];

/** Key into `roadmap.items.<id>.title` and `roadmap.items.<id>.description`. */
export type RoadmapItemId = RoadmapItem["id"];

export function roadmapItemsByStatus(status: RoadmapStatus): readonly RoadmapItem[] {
  return ROADMAP_ITEMS.filter((item) => item.status === status);
}
