/**
 * Pure analytics model shared by both processes. No `electron`/`node`/DOM
 * imports — flag names, their offline defaults, identity constants, and the
 * error-serialization helper used to ship exceptions over IPC and to PostHog.
 *
 * No TS enums (house rule): `as const` arrays + derived types, one source for
 * the value and its type — same idiom as IPC_CHANNELS.
 */
import { inferRecordingRatio, recordingCaptureMode } from "./recording-capture";
import type { RecordingRatio } from "./types/screenshot-capture";

/** Feature flags the app reads. Names must match the PostHog dashboard exactly. */
export const FLAG_NAMES = [
  "native-cursor-capture",
  "capture-while-recording",
  "image-canvas",
  "image-inspect",
  "image-text",
] as const;
export type FlagName = (typeof FLAG_NAMES)[number];

/**
 * Value used when a flag is unresolved (offline, still loading, or the SDK is
 * disabled because the key is absent). Unresolved flags fall back to these
 * values, so behavior is deterministic offline, and experiments stay off.
 */
export const FLAG_DEFAULTS: Record<FlagName, boolean> = {
  // Cursor-free macOS capture with an editable cursor, on for Screen, Frame and Window
  // with the webcam and audio. Its PostHog flag was deleted on 2026-11-12, so this default
  // always applies: there is no remote kill switch. To get one back, recreate the flag
  // disabled, then enable it at 0% (see desktop/analytics-and-flags).
  "native-cursor-capture": true,
  // Screenshots during a take (macOS only): off until it is validated in the real app.
  "capture-while-recording": false,
  // Image editor canvas (NIW2-698): off until owner QA.
  "image-canvas": false,
  // Image editor Inspect mode (NIW2-699): off until owner QA.
  "image-inspect": false,
  // Text recognition in the image editor, macOS only for now (NIW2-705): off until owner QA.
  "image-text": false,
};

/** Identity super-properties attached to every event/error for multi-surface filtering. */
export const DEFAULT_PRODUCT = "kaipu-recorder";
export const DEFAULT_SURFACE = "desktop";

/** Serialized exception — Error objects don't survive structured-clone over IPC. */
export interface SerializedError {
  name: string;
  message: string;
  stack: string | null;
}

/** Normalize anything thrown into a plain, IPC-safe shape with name/message/stack. */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message,
      stack: error.stack ?? null,
    };
  }
  if (typeof error === "string") {
    return { name: "Error", message: error, stack: null };
  }
  return { name: "Error", message: "Unknown error", stack: null };
}

/** Event name for a finished (or refused) screenshot capture. */
export const SCREENSHOT_CAPTURED_EVENT = "screenshot_captured";

/** How a capture request ended. */
export const SCREENSHOT_OUTCOMES = ["captured", "cancelled", "unsupported", "failed"] as const;
export type ScreenshotOutcome = (typeof SCREENSHOT_OUTCOMES)[number];

/**
 * The whole payload of `screenshot_captured`. Deliberately closed: no pixels, no
 * coordinates, no file names. The owner only wants to know which mode people use,
 * on which platform, with how many displays, and how it ended.
 */
export interface ScreenshotCapturedProperties {
  mode: string;
  platform: string;
  displays: number;
  outcome: ScreenshotOutcome;
  /** Only on a captured outcome: whether the editor opened or the capture finished quietly. */
  after?: "editor" | "quiet";
}

/** Copies exactly the allowed fields (`after` only when set), so a caller cannot leak an extra one. */
export function buildScreenshotCapturedProperties(
  input: ScreenshotCapturedProperties,
): ScreenshotCapturedProperties {
  return {
    mode: input.mode,
    platform: input.platform,
    displays: input.displays,
    outcome: input.outcome,
    ...(input.after ? { after: input.after } : {}),
  };
}

/** Event name for a recording that started (after the countdown). */
export const RECORDING_STARTED_EVENT = "recording_started";

/**
 * Coarse size buckets for an area recording (spec decision 12), by the area's shorter side
 * in physical pixels: enough to tell a thumbnail-sized clip from a full-HD one, never the
 * exact dimensions.
 */
export const RECORDING_SIZE_BUCKETS = ["<720p", "720p", "1080p", "1440p+"] as const;
export type RecordingSizeBucket = (typeof RECORDING_SIZE_BUCKETS)[number];

export function recordingSizeBucket(width: number, height: number): RecordingSizeBucket {
  const side = Math.min(width, height);
  if (side >= 1440) return "1440p+";
  if (side >= 1080) return "1080p";
  if (side >= 720) return "720p";
  return "<720p";
}

/**
 * The whole payload of `recording_started` (ADR 0030): which target people record — a whole
 * screen, an area of one, or a window — on which platform, with how many displays; for an
 * area, its size bucket and ratio chip. No source names, no window titles, no rectangles.
 */
export interface RecordingStartedProperties {
  mode: "screen" | "area" | "window";
  platform: string;
  displays: number;
  /** Area only. */
  size?: RecordingSizeBucket;
  /** Area only: the chip the box was locked to, or the one its size matches ("free" otherwise). */
  ratio?: RecordingRatio;
}

/**
 * Derives the mode from the source id and whether an area was set; for an area with a known
 * size (physical px), adds its bucket and ratio. Copies nothing else.
 */
export function buildRecordingStartedProperties(input: {
  sourceId: string;
  area: boolean;
  platform: string;
  displays: number;
  /** The area's size in physical pixels (DIP × scale factor). */
  areaSize?: { width: number; height: number } | null;
  /** The ratio the area was locked to, when the overlay reported one. */
  ratio?: RecordingRatio;
}): RecordingStartedProperties {
  const mode = recordingCaptureMode(input.sourceId, input.area);
  const base = { mode, platform: input.platform, displays: input.displays };
  const size = input.areaSize;
  if (mode !== "area" || !size || !(size.width > 0) || !(size.height > 0)) return base;
  return {
    ...base,
    size: recordingSizeBucket(size.width, size.height),
    ratio: input.ratio ?? inferRecordingRatio(size.width, size.height),
  };
}

/** Event name for a change of the editor's preview playback speed (NIW2-666). */
export const EDITOR_SPEED_CHANGED_EVENT = "editor_speed_changed";

/**
 * The whole payload of `editor_speed_changed`: the speed the user switched to (0.5, 1, 1.5
 * or 2). Whether anyone uses 0.5x decides whether the speed control earns its place. No
 * recording id, title, time or duration, and nothing about what is on screen. The speed is
 * preview-only and never reaches the export.
 */
// A type alias, not an interface: `captureEvent` takes a `Record<string, unknown>`.
export type EditorSpeedChangedProperties = {
  speed: number;
};

/** Copies exactly the allowed field, so a caller cannot leak an extra one. */
export function buildEditorSpeedChangedProperties(
  input: EditorSpeedChangedProperties,
): EditorSpeedChangedProperties {
  return { speed: input.speed };
}
