/**
 * The hero demo's pure logic: geometry for the screenshot selection and the
 * crop, the clip's trim rules and the export size estimate. No React and no
 * DOM, so every rule is a plain function a test can call.
 *
 * Every figure the demo shows (1920 × 1080 screen, 30 s clip, file sizes) is
 * invented sample data, not a measurement of the app.
 */

/** A point on the demo screen, as fractions of its width and height (0–1). */
export type Pt = { x: number; y: number };

/** A rectangle on the demo screen, as fractions (0–1). */
export type Region = { x: number; y: number; w: number; h: number };

export const FULL_REGION: Region = { x: 0, y: 0, w: 1, h: 1 };
export const DEFAULT_AREA: Region = { x: 0.16, y: 0.2, w: 0.68, h: 0.56 };

/** The size the demo pretends the screen is, so a selection can show pixels. */
export const SCREEN_PX = { w: 1920, h: 1080 } as const;

/** A drag smaller than this (a click) falls back to the default area. */
export const MIN_REGION = 0.08;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const unit = (v: number) => clamp(v, 0, 1);

/** The rectangle spanned by two corners, whichever way the drag went. */
export function regionFromDrag(a: Pt, b: Pt): Region {
  const x0 = unit(Math.min(a.x, b.x));
  const y0 = unit(Math.min(a.y, b.y));
  const x1 = unit(Math.max(a.x, b.x));
  const y1 = unit(Math.max(a.y, b.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A click, or a drag too short to mean anything, keeps the default area. */
export function settleRegion(region: Region): Region {
  return region.w < MIN_REGION || region.h < MIN_REGION ? DEFAULT_AREA : region;
}

/** The selection in pixels of the pretend screen, for the "1306 × 605" label. */
export function regionPixels(region: Region): { w: number; h: number } {
  return { w: Math.round(region.w * SCREEN_PX.w), h: Math.round(region.h * SCREEN_PX.h) };
}

/**
 * Shows only `region` of the screen, fitted inside the same canvas: the
 * captured image. Applied to the screen layer with `transform-origin: 0 0`,
 * together with `cropClip`, which hides what lies outside the selection.
 */
export function cropTransform(region: Region): string {
  const scale = Math.min(1 / region.w, 1 / region.h);
  const offsetX = (1 - region.w * scale) / 2;
  const offsetY = (1 - region.h * scale) / 2;
  const pct = (n: number) => `${+(n * 100).toFixed(3)}%`;
  return `translate(${pct(offsetX)}, ${pct(offsetY)}) scale(${+scale.toFixed(4)}) translate(${pct(-region.x)}, ${pct(-region.y)})`;
}

export function cropClip(region: Region): string {
  const pct = (n: number) => `${+(n * 100).toFixed(3)}%`;
  return `inset(${pct(region.y)} ${pct(1 - region.x - region.w)} ${pct(1 - region.y - region.h)} ${pct(region.x)})`;
}

/* ---- Annotations -------------------------------------------------------- */

export type Mark =
  | { kind: "pencil"; points: Pt[] }
  | { kind: "arrow"; from: Pt; to: Pt }
  | { kind: "text"; at: Pt };

/** An arrow dragged less than this (a click) is dropped instead of kept. */
const MIN_ARROW = 0.02;

export function keepMark(mark: Mark): boolean {
  if (mark.kind !== "arrow") return true;
  return Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y) >= MIN_ARROW;
}

/* ---- Clip and trim ------------------------------------------------------- */

export const CLIP_SECONDS = 30;
/** The trim never keeps less than this, so the clip cannot collapse to nothing. */
export const MIN_KEPT_SECONDS = 2;

export type Clip = { start: number; end: number; playhead: number };

export const INITIAL_CLIP: Clip = { start: 2, end: 26, playhead: 9 };

export function moveStart(clip: Clip, value: number): Clip {
  const start = clamp(value, 0, clip.end - MIN_KEPT_SECONDS);
  return { start, end: clip.end, playhead: clamp(clip.playhead, start, clip.end) };
}

export function moveEnd(clip: Clip, value: number): Clip {
  const end = clamp(value, clip.start + MIN_KEPT_SECONDS, CLIP_SECONDS);
  return { start: clip.start, end, playhead: clamp(clip.playhead, clip.start, end) };
}

export function movePlayhead(clip: Clip, value: number): Clip {
  return { ...clip, playhead: clamp(value, clip.start, clip.end) };
}

export const keptSeconds = (clip: Clip): number => clip.end - clip.start;

/** 0:09 → "00:09". Whole seconds, like the app's timecode. */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(whole / 60)).padStart(2, "0");
  const ss = String(whole % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/* ---- Export -------------------------------------------------------------- */

export const EXPORT_FORMATS = ["mp4", "gif", "png"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_RESOLUTIONS = ["1080p", "1440p", "4K"] as const;
export type ExportResolution = (typeof EXPORT_RESOLUTIONS)[number];

/** Sample megabytes per second of video at each resolution. */
const VIDEO_MB_PER_SECOND: Record<ExportResolution, number> = {
  "1080p": 0.14,
  "1440p": 0.22,
  "4K": 0.5,
};
/** A GIF of the same clip is several times heavier than an MP4. */
const GIF_FACTOR = 2.4;
/** Sample megabytes of one PNG frame at each resolution. */
const PNG_MB: Record<ExportResolution, number> = { "1080p": 0.4, "1440p": 0.7, "4K": 1.6 };

export function estimateMegabytes(
  format: ExportFormat,
  resolution: ExportResolution,
  seconds: number,
): number {
  if (format === "png") return PNG_MB[resolution];
  const mp4 = VIDEO_MB_PER_SECOND[resolution] * seconds;
  return format === "gif" ? mp4 * GIF_FACTOR : mp4;
}

export function formatMegabytes(mb: number): string {
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/* ---- Export destinations --------------------------------------------------- */

/**
 * Where an export is going. These mirror the desktop app's destinations
 * (`apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts`) and the
 * numbers behind them (`.../video-editor/export/export-presets.ts`): YouTube's
 * 1440p / 4K canvases, the 9:16 and 1:1 canvases, the Light and Balanced tiers
 * and the full-quality archive copy. Every destination is an MP4: GIF and
 * single-frame PNG are separate exports in the editor, so they stay under
 * "Custom". Nothing is uploaded; the app prepares a file you take there yourself.
 */
export const DESTINATIONS = ["youtube", "vertical", "square", "github", "chat", "archive"] as const;
export type DestinationId = (typeof DESTINATIONS)[number];

/** `custom` is the free format + size panel; the rest are the real destinations. */
export type ExportTarget = DestinationId | "custom";

export const YOUTUBE_RESOLUTIONS = ["1440p", "4K"] as const;
export type YoutubeResolution = (typeof YOUTUBE_RESOLUTIONS)[number];

/** GitHub's attachment limits, as `export-presets.ts` states them (decimal MB). */
export const GITHUB_FREE_LIMIT_MB = 10;
export const GITHUB_PAID_LIMIT_MB = 100;

const YOUTUBE_CANVAS: Record<YoutubeResolution, { w: number; h: number; mbps: number }> = {
  "1440p": { w: 2560, h: 1440, mbps: 16 },
  "4K": { w: 3840, h: 2160, mbps: 45 },
};

const SCREEN_1080 = { w: 1920, h: 1080 } as const;
/** The app's 8 Mbps at 1920 × 1080, scaled by pixel count for the 9:16 and 1:1 canvases. */
const scaledMbps = (w: number, h: number) => (8 * (w * h)) / (SCREEN_1080.w * SCREEN_1080.h);

export interface DestinationPlan {
  format: "mp4";
  /** The file's picture size; null for the archive copy (the recording's own). */
  picture: { w: number; h: number } | null;
  /** Estimated megabytes of the sample clip; null where the app gives no estimate. */
  megabytes: number | null;
  /** Frame-rate cap of the tier, if any. */
  maxFps: number | null;
  /** GitHub only: whether the estimate attaches on Free and on the paid plans. */
  github: { free: boolean; paid: boolean } | null;
}

/**
 * What a destination produces for `seconds` of the sample clip. Rates follow the
 * app: YouTube at the top of its SDR bitrate table (16 / 45 Mbps), 9:16 and 1:1
 * scaled from 8 Mbps at 1080p by pixel count, Light at 4.7 MB per minute and
 * Balanced at 6 MB per minute at 1080p, 24 fps. The clip itself is sample data.
 */
export function planDestination(
  destination: DestinationId,
  seconds: number,
  youtube: YoutubeResolution = "1440p",
): DestinationPlan {
  const minutes = seconds / 60;
  const fromMbps = (mbps: number) => (mbps / 8) * seconds;
  let plan: Omit<DestinationPlan, "github">;
  switch (destination) {
    case "youtube": {
      const c = YOUTUBE_CANVAS[youtube];
      plan = {
        format: "mp4",
        picture: { w: c.w, h: c.h },
        megabytes: fromMbps(c.mbps),
        maxFps: null,
      };
      break;
    }
    case "vertical":
      plan = {
        format: "mp4",
        picture: { w: 1080, h: 1920 },
        megabytes: fromMbps(scaledMbps(1080, 1920)),
        maxFps: null,
      };
      break;
    case "square":
      plan = {
        format: "mp4",
        picture: { w: 1080, h: 1080 },
        megabytes: fromMbps(scaledMbps(1080, 1080)),
        maxFps: null,
      };
      break;
    case "github":
      plan = { format: "mp4", picture: SCREEN_1080, megabytes: 4.7 * minutes, maxFps: 24 };
      break;
    case "chat":
      plan = { format: "mp4", picture: SCREEN_1080, megabytes: 6 * minutes, maxFps: 24 };
      break;
    case "archive":
      plan = { format: "mp4", picture: null, megabytes: null, maxFps: null };
      break;
  }
  const mb = plan.megabytes;
  return {
    ...plan,
    github:
      destination === "github" && mb !== null
        ? { free: mb <= GITHUB_FREE_LIMIT_MB, paid: mb <= GITHUB_PAID_LIMIT_MB }
        : null,
  };
}

/* ---- Workspaces ------------------------------------------------------------ */

/**
 * A workspace is a library folder; one is active at a time and everything Kaipu
 * saves lands in it. The default one lives in the Videos folder as "Kaipu Record"
 * (on a Mac, `~/Movies`); a new one gets a sibling `Kaipu Record — <name>`
 * (`shared/workspace-name.ts`). The names here are sample data.
 */
export const WORKSPACE_IDS = ["personal", "work"] as const;
export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

export const DEFAULT_WORKSPACE: WorkspaceId = "personal";

const LIBRARY_PARENT = "~/Movies";
const FOLDER = "Kaipu Record";

/** The folder a workspace saves into; `name` is its (localized) display name. */
export function workspaceFolder(id: WorkspaceId, name: string): string {
  return id === DEFAULT_WORKSPACE
    ? `${LIBRARY_PARENT}/${FOLDER}`
    : `${LIBRARY_PARENT}/${FOLDER} — ${name}`;
}
