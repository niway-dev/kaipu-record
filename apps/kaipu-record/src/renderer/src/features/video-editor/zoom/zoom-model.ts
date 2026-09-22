/**
 * Zoom + privacy data carried by the video scene (see scene.ts). Every time here is
 * SOURCE seconds (position in the original recording), NOT timeline seconds — these
 * describe the content, so a cut earlier in the timeline must not shift them. The
 * timeline UI maps them through `sourceRangeToTimelineBlocks` (source-time.ts).
 */

export type ZoomMode = "follow" | "fixed";

export interface ZoomSegment {
  id: string;
  /** Source seconds, inclusive. */
  start: number;
  /** Source seconds, exclusive; end - start >= ZOOM_LIMITS.minSeconds. */
  end: number;
  /** Magnification, ZOOM_LIMITS.minScale–maxScale. */
  scale: number;
  mode: ZoomMode;
  /** Normalized camera CENTER for "fixed"; null for "follow". */
  anchor: { x: number; y: number } | null;
  /** 0 = snappy, 100 = floaty. */
  smoothing: number;
  /** "auto" segments are replaced when detection re-runs; any user edit flips to "manual". */
  origin: "auto" | "manual";
  /** What produced an auto segment (inspector badge); null for hand-made ones. */
  trigger: "click" | "dwell" | null;
}

export const ZOOM_LIMITS = {
  minScale: 1,
  maxScale: 4,
  minSeconds: 1,
  /** Length of a zoom added by hand at the playhead. */
  manualSeconds: 3,
} as const;

/**
 * Defaults shared by the detector, the camera and the scene. They live in this module —
 * the smallest one, with no imports at all — so `scene.ts` can read them without
 * value-importing the detector (which would drag it into the export worker bundle).
 */
export const ZOOM_DEFAULTS = {
  /** Detection sensitivity of a fresh scene, 0–100. */
  sensitivity: 55,
  /** Camera smoothing of a new segment: 0 = snappy, 100 = floaty. */
  smoothing: 70,
} as const;
