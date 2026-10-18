import {
  AppWindow,
  Award,
  BadgeCheck,
  Cloud,
  Download,
  Droplet,
  FileText,
  Frame,
  Globe,
  Image,
  Keyboard,
  Library,
  MicOff,
  PanelTop,
  PenLine,
  RefreshCw,
  Scissors,
  Sparkles,
  Stamp,
  Tag,
  Type,
  UploadCloud,
  User,
  Video,
  Volume2,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";

/**
 * The public roadmap: one row per feature, one state per platform. Grouped by
 * state rather than by date, because states stay true as work slips while
 * quarters go stale the moment a plan moves.
 *
 * To update the roadmap, edit this list. The copy for every id lives in the
 * `roadmap.items` namespace of `@kaipu/i18n` (en + es), whose parity test keeps
 * both locales complete.
 *
 * "shipped" means "in the build you can download". There is no downloadable
 * Windows build yet, so no Windows cell says shipped: what already runs there is
 * `inProgress` until the beta installer is on the download feed, and flipping
 * those cells belongs in the same PR as that first build.
 */

/** Rendered top to bottom: what already ships, what is being built, what comes next. */
export const ROADMAP_STATES = ["shipped", "inProgress", "planned"] as const;

export type RoadmapState = (typeof ROADMAP_STATES)[number];

export const ROADMAP_PLATFORMS = ["mac", "win"] as const;

export type RoadmapPlatform = (typeof ROADMAP_PLATFORMS)[number];

/** The filter's platform choice: one platform, or both side by side. */
export type PlatformFilter = RoadmapPlatform | "all";

/** Each area's tint lives with the page's styles (`areaTint` in roadmap-page.tsx). */
export const ROADMAP_AREAS = ["record", "capture", "edit", "find", "cloud", "app"] as const;

export type RoadmapArea = (typeof ROADMAP_AREAS)[number];

interface RoadmapRow {
  id: string;
  area: RoadmapArea;
  icon: LucideIcon;
  mac: RoadmapState;
  win: RoadmapState;
  /** The row has `items.<id>.note`: a caveat shown under the description. */
  note?: true;
}

/**
 * `as const` on purpose: it narrows every id to a literal, so `useTranslations`
 * rejects an item whose copy is missing at compile time instead of rendering a
 * raw key in production.
 *
 * Within a state group rows keep this order, so the list reads area by area.
 * Every planned row has a design doc in the docs site (backlog/) before it is
 * built; the public-roadmap-page doc maps each id to its doc.
 */
export const ROADMAP_ITEMS = [
  // Record
  { id: "screenAndCamera", area: "record", icon: Video, mac: "shipped", win: "inProgress" },
  { id: "systemAudio", area: "record", icon: Volume2, mac: "shipped", win: "inProgress" },
  {
    id: "shortcuts",
    area: "record",
    icon: Keyboard,
    mac: "shipped",
    win: "inProgress",
    note: true,
  },
  { id: "trayPanel", area: "record", icon: PanelTop, mac: "shipped", win: "inProgress" },

  // Capture
  {
    id: "screenshotAnnotations",
    area: "capture",
    icon: PenLine,
    mac: "shipped",
    win: "inProgress",
  },
  { id: "frameCapture", area: "capture", icon: Frame, mac: "shipped", win: "inProgress" },
  {
    id: "windowCapture",
    area: "capture",
    icon: AppWindow,
    mac: "inProgress",
    win: "inProgress",
    note: true,
  },
  { id: "blurAndBackground", area: "capture", icon: Droplet, mac: "shipped", win: "inProgress" },
  {
    id: "saveEveryScreenshot",
    area: "capture",
    icon: RefreshCw,
    mac: "shipped",
    win: "inProgress",
  },
  { id: "captureTitle", area: "capture", icon: Type, mac: "shipped", win: "inProgress" },
  { id: "screenshotPdf", area: "capture", icon: FileText, mac: "shipped", win: "inProgress" },

  // Edit
  { id: "videoEditor", area: "edit", icon: Scissors, mac: "shipped", win: "inProgress" },
  { id: "videoZoom", area: "edit", icon: ZoomIn, mac: "shipped", win: "inProgress" },
  { id: "videoMute", area: "edit", icon: MicOff, mac: "shipped", win: "inProgress" },
  { id: "exportPresets", area: "edit", icon: Download, mac: "shipped", win: "inProgress" },

  // Find
  { id: "library", area: "find", icon: Library, mac: "shipped", win: "inProgress" },
  { id: "captureTags", area: "find", icon: Tag, mac: "shipped", win: "inProgress" },
  { id: "photoZoom", area: "find", icon: Image, mac: "planned", win: "planned" },

  // Cloud
  { id: "accounts", area: "cloud", icon: User, mac: "shipped", win: "inProgress" },
  { id: "cloudFoundation", area: "cloud", icon: Cloud, mac: "shipped", win: "inProgress" },
  { id: "cloudUpload", area: "cloud", icon: UploadCloud, mac: "planned", win: "planned" },

  // App
  { id: "themeAndLanguages", area: "app", icon: Globe, mac: "shipped", win: "inProgress" },
  { id: "watermark", area: "app", icon: Award, mac: "shipped", win: "inProgress" },
  {
    id: "signedInstaller",
    area: "app",
    icon: BadgeCheck,
    mac: "shipped",
    win: "planned",
    note: true,
  },
  { id: "watermarkUpgrade", area: "app", icon: Stamp, mac: "planned", win: "planned" },
  { id: "brandIdentity", area: "app", icon: Sparkles, mac: "planned", win: "planned" },
] as const satisfies readonly RoadmapRow[];

export type RoadmapItem = (typeof ROADMAP_ITEMS)[number];

/** Key into `roadmap.items.<id>.title` and `roadmap.items.<id>.description`. */
export type RoadmapItemId = RoadmapItem["id"];

/** Ids that also carry `roadmap.items.<id>.note`. */
export type RoadmapNotedItemId = Extract<RoadmapItem, { note: true }>["id"];

/**
 * The state a row is grouped under. With one platform chosen it is that
 * platform's cell; with both, it is the most advanced of the two, so "Shipped"
 * means "you can use it today somewhere" and the cells say where.
 */
export function stateOf(item: RoadmapItem, platform: PlatformFilter): RoadmapState {
  if (platform !== "all") return item[platform];
  const rank = (state: RoadmapState) => ROADMAP_STATES.indexOf(state);
  return rank(item.mac) <= rank(item.win) ? item.mac : item.win;
}

/** Per-state counts for one platform — the summary cards and their bars. */
export function platformCounts(platform: RoadmapPlatform): Record<RoadmapState, number> {
  const counts: Record<RoadmapState, number> = { shipped: 0, inProgress: 0, planned: 0 };
  for (const item of ROADMAP_ITEMS) counts[item[platform]] += 1;
  return counts;
}
