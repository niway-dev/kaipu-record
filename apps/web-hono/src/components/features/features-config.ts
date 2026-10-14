import {
  Captions,
  ClipboardCopy,
  Crop,
  Droplet,
  Download,
  EyeOff,
  Globe,
  AppWindow,
  Layers,
  Library,
  Mic,
  MicOff,
  PanelTop,
  PenLine,
  RefreshCw,
  Save,
  Scissors,
  Search,
  Share,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Stamp,
  Tag,
  Type,
  UploadCloud,
  UserX,
  Video,
  Award,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";

/**
 * Everything the /features page lists, in the order it lists it.
 *
 * The page is a catalogue, so it is data: adding a feature is a row here and its
 * copy in the `features` namespace of `@kaipu/i18n` (en + es, kept complete by the
 * parity test). Message keys are spelled out in full rather than built from the id,
 * because `items.${id}.d${n}` widens to keys that do not exist for every id and
 * TypeScript would stop catching typos.
 *
 * Only shipped features belong in the chapters. Planned work goes in COMING_NEXT,
 * which the page renders in its own muted strip — the brand rule is that nothing
 * planned is presented as available.
 *
 * The chapters reuse the home's ids (`record`, `capture`, `edit`, `find`) and tint
 * tokens on purpose: the home's rail and mobile strip scroll-spy on those ids, so
 * they work here unchanged.
 */

export type ChipKind = "kbd" | "pill" | "fits" | "size" | "tag";

export interface FeatureChip {
  kind: ChipKind;
  /** Message key in the `features` namespace. */
  key: FeatureMessageKey;
  /** A literal prefix shown before the label, e.g. a shortcut's keys. */
  prefix?: string;
  /** Dot colour, for `tag` chips. */
  color?: string;
}

export interface Feature {
  id: string;
  icon: LucideIcon;
  /** Columns the card spans on desktop (out of 3). Phones always use one. */
  span?: 1 | 2 | 3;
  title: FeatureMessageKey;
  body: FeatureMessageKey;
  details?: readonly FeatureMessageKey[];
  chips?: readonly FeatureChip[];
}

export interface FeatureChapter {
  id: "record" | "capture" | "edit" | "find";
  tint: "c1" | "c2" | "c3" | "c4";
  number: "01" | "02" | "03" | "04";
  icon: LucideIcon;
  name: FeatureMessageKey;
  line: FeatureMessageKey;
  title: FeatureMessageKey;
  serif: FeatureMessageKey;
  intro: FeatureMessageKey;
  features: readonly Feature[];
}

/**
 * A key in the `features` namespace. Typed as a string here because the union of
 * every catalog key makes TypeScript walk the whole catalog for each row (see
 * `Translator` in @kaipu/i18n); `features-config.test.ts` checks instead that every
 * key in this file exists in both locales.
 */
type FeatureMessageKey = string;

export const FEATURE_CHAPTERS = [
  {
    id: "record",
    tint: "c1",
    number: "01",
    icon: Video,
    name: "chapters.record.name",
    line: "chapters.record.line",
    title: "chapters.record.title",
    serif: "chapters.record.serif",
    intro: "chapters.record.intro",
    features: [
      {
        id: "screenCamera",
        icon: Video,
        span: 2,
        title: "items.screenCamera.title",
        body: "items.screenCamera.body",
        details: ["items.screenCamera.d1", "items.screenCamera.d2", "items.screenCamera.d3"],
      },
      {
        id: "startAnywhere",
        icon: PanelTop,
        title: "items.startAnywhere.title",
        body: "items.startAnywhere.body",
        chips: [
          { kind: "kbd", prefix: "⌃⌘C", key: "items.startAnywhere.k1" },
          { kind: "kbd", prefix: "⌃⌘S", key: "items.startAnywhere.k2" },
          { kind: "kbd", prefix: "⌃⌘X", key: "items.startAnywhere.k3" },
          { kind: "kbd", prefix: "⌃⌘O", key: "items.startAnywhere.k4" },
        ],
      },
      {
        id: "micPicker",
        icon: Mic,
        title: "items.micPicker.title",
        body: "items.micPicker.body",
      },
      {
        id: "recordingQuality",
        icon: SlidersHorizontal,
        title: "items.recordingQuality.title",
        body: "items.recordingQuality.body",
        chips: [
          { kind: "pill", key: "items.recordingQuality.c1" },
          { kind: "pill", key: "items.recordingQuality.c2" },
          { kind: "pill", key: "items.recordingQuality.c3" },
        ],
      },
      {
        id: "alreadySaved",
        icon: Save,
        title: "items.alreadySaved.title",
        body: "items.alreadySaved.body",
      },
    ],
  },
  {
    id: "capture",
    tint: "c2",
    number: "02",
    icon: Crop,
    name: "chapters.capture.name",
    line: "chapters.capture.line",
    title: "chapters.capture.title",
    serif: "chapters.capture.serif",
    intro: "chapters.capture.intro",
    features: [
      {
        id: "annotations",
        icon: PenLine,
        span: 2,
        title: "items.annotations.title",
        body: "items.annotations.body",
        details: ["items.annotations.d1", "items.annotations.d2", "items.annotations.d3"],
      },
      {
        id: "captureModes",
        icon: Crop,
        title: "items.captureModes.title",
        body: "items.captureModes.body",
      },
      {
        id: "blurFrame",
        icon: Droplet,
        title: "items.blurFrame.title",
        body: "items.blurFrame.body",
      },
      {
        id: "nameIt",
        icon: Type,
        title: "items.nameIt.title",
        body: "items.nameIt.body",
      },
      {
        id: "copyPngPdf",
        icon: ClipboardCopy,
        title: "items.copyPngPdf.title",
        body: "items.copyPngPdf.body",
        chips: [
          { kind: "pill", key: "items.copyPngPdf.c1" },
          { kind: "pill", key: "items.copyPngPdf.c2" },
          { kind: "pill", key: "items.copyPngPdf.c3" },
        ],
      },
      {
        id: "saveEvery",
        icon: RefreshCw,
        span: 3,
        title: "items.saveEvery.title",
        body: "items.saveEvery.body",
      },
    ],
  },
  {
    id: "edit",
    tint: "c3",
    number: "03",
    icon: Scissors,
    name: "chapters.edit.name",
    line: "chapters.edit.line",
    title: "chapters.edit.title",
    serif: "chapters.edit.serif",
    intro: "chapters.edit.intro",
    features: [
      {
        id: "autoZoom",
        icon: ZoomIn,
        span: 2,
        title: "items.autoZoom.title",
        body: "items.autoZoom.body",
        details: ["items.autoZoom.d1", "items.autoZoom.d2", "items.autoZoom.d3"],
      },
      {
        id: "trim",
        icon: Scissors,
        title: "items.trim.title",
        body: "items.trim.body",
        details: ["items.trim.d1", "items.trim.d2", "items.trim.d3"],
      },
      {
        id: "mute",
        icon: MicOff,
        title: "items.mute.title",
        body: "items.mute.body",
      },
      {
        id: "cover",
        icon: Square,
        title: "items.cover.title",
        body: "items.cover.body",
      },
      {
        id: "original",
        icon: ShieldCheck,
        title: "items.original.title",
        body: "items.original.body",
      },
      {
        id: "export",
        icon: Download,
        span: 2,
        title: "items.export.title",
        body: "items.export.body",
        chips: [
          { kind: "pill", key: "items.export.c1" },
          { kind: "pill", key: "items.export.c2" },
          { kind: "pill", key: "items.export.c3" },
          { kind: "pill", key: "items.export.c4" },
          { kind: "pill", key: "items.export.c5" },
        ],
      },
      {
        id: "share",
        icon: Share,
        title: "items.share.title",
        body: "items.share.body",
      },
      {
        id: "background",
        icon: Layers,
        span: 3,
        title: "items.background.title",
        body: "items.background.body",
      },
    ],
  },
  {
    id: "find",
    tint: "c4",
    number: "04",
    icon: Search,
    name: "chapters.find.name",
    line: "chapters.find.line",
    title: "chapters.find.title",
    serif: "chapters.find.serif",
    intro: "chapters.find.intro",
    features: [
      {
        id: "library",
        icon: Library,
        span: 2,
        title: "items.library.title",
        body: "items.library.body",
        details: ["items.library.d1", "items.library.d2", "items.library.d3"],
      },
      {
        id: "tags",
        icon: Tag,
        title: "items.tags.title",
        body: "items.tags.body",
        chips: [
          { kind: "tag", color: "#ef4444", key: "items.tags.c1" },
          { kind: "tag", color: "#8b5cf6", key: "items.tags.c2" },
          { kind: "tag", color: "#14b8a6", key: "items.tags.c3" },
          { kind: "tag", color: "#f59e0b", key: "items.tags.c4" },
        ],
      },
      {
        id: "rename",
        icon: Captions,
        span: 3,
        title: "items.rename.title",
        body: "items.rename.body",
      },
    ],
  },
] as const satisfies readonly FeatureChapter[];

/** The four promises in "Private by design". */
export const PRIVACY = [
  { id: "noAccount", icon: UserX },
  { id: "noWatermark", icon: Award },
  { id: "analytics", icon: EyeOff },
  { id: "languages", icon: Globe },
] as const;

/** Planned, never shipped — rendered muted and labelled as such. Mirrors the roadmap. */
export const COMING_NEXT = [
  { id: "windows", icon: AppWindow },
  { id: "cloudUpload", icon: UploadCloud },
  { id: "imageZoom", icon: ZoomIn },
  { id: "ownWatermark", icon: Stamp },
] as const;

export const FEATURE_COUNT = FEATURE_CHAPTERS.reduce((sum, c) => sum + c.features.length, 0);
