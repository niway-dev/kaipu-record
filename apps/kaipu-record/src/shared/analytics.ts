/**
 * Pure analytics model shared by both processes. No `electron`/`node`/DOM
 * imports — flag names, their offline defaults, identity constants, and the
 * error-serialization helper used to ship exceptions over IPC and to PostHog.
 *
 * No TS enums (house rule): `as const` arrays + derived types, one source for
 * the value and its type — same idiom as IPC_CHANNELS.
 */

/** Feature flags the app reads. Names must match the PostHog dashboard exactly. */
export const FLAG_NAMES = ["bypass-login"] as const;
export type FlagName = (typeof FLAG_NAMES)[number];

/**
 * Value used when a flag is unresolved (offline, still loading, or the SDK is
 * disabled because the key is absent). Chosen so behavior is deterministic
 * offline: login is bypassed (there is no login UI yet).
 */
export const FLAG_DEFAULTS: Record<FlagName, boolean> = {
  "bypass-login": true,
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
 * The whole payload of `recording_started` (ADR 0030): which target people record — a whole
 * screen, an area of one, or a window — on which platform, with how many displays. No source
 * names, no window titles, no rectangles.
 */
export interface RecordingStartedProperties {
  mode: "screen" | "area" | "window";
  platform: string;
  displays: number;
}

/** Derives the mode from the source id and whether an area was set; copies nothing else. */
export function buildRecordingStartedProperties(input: {
  sourceId: string;
  area: boolean;
  platform: string;
  displays: number;
}): RecordingStartedProperties {
  const mode = input.sourceId.startsWith("window:") ? "window" : input.area ? "area" : "screen";
  return { mode, platform: input.platform, displays: input.displays };
}
