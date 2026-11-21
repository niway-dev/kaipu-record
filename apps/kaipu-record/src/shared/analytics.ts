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
  "timeline-levels",
  "zoom-filmstrip",
  "transcription",
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
  // Clips levels (NIW2-770). With the flag off nothing adds media (NIW2-772), so 0.19.0 does not
  // ship the 3 s slide; with it on, Add from Library sends a recording or a screenshot into the
  // sequence or over it (NIW2-771, NIW2-829). A scene that already has floating items still shows
  // and exports them with the flag off.
  "timeline-levels": false,
  // Zoom-aware filmstrip (NIW2-844, ADR 0064): the Clips and Webcam tiles decode a frame of their
  // own time when the timeline is zoomed in. Off until the budgets are proven on the 54-minute
  // take (spec decision 11); with it off the filmstrip is the 24 frames per file it always was.
  "zoom-filmstrip": false,
  // Local transcription with Parakeet, macOS arm64 first (NIW2-818): the model offer in
  // onboarding and settings, the Transcript panel and the Transcribe actions. Off until owner QA.
  transcription: false,
};

/**
 * The release flags: every flag whose code default is `false`, derived from `FLAG_DEFAULTS` (no
 * hand list, so a new unreleased flag is covered the day it is added). Admin mode (ADR 0067)
 * forces exactly these on. A flag that defaults to `true` has shipped and is never touched.
 */
export const RELEASE_FLAGS: readonly FlagName[] = FLAG_NAMES.filter(
  (name) => FLAG_DEFAULTS[name] === false,
);

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

/** Event name for an editor that finished loading (NIW2-849). */
export const EDITOR_OPENED_EVENT = "editor_opened";

/** The two editors people can open. */
export const EDITOR_KINDS = ["video", "image"] as const;
export type EditorKind = (typeof EDITOR_KINDS)[number];

/**
 * The whole payload of `editor_opened`: which editor loaded, the video editor or the image
 * editor. It tells the team which of the two people actually use. No recording id, title,
 * path or duration, and nothing about what is on screen.
 */
// A type alias, not an interface: `captureEvent` takes a `Record<string, unknown>`.
export type EditorOpenedProperties = {
  editor: EditorKind;
};

/** Copies exactly the allowed field, so a caller cannot leak an extra one. */
export function buildEditorOpenedProperties(input: EditorOpenedProperties): EditorOpenedProperties {
  return { editor: input.editor };
}

/**
 * Where a personal path starts: a home folder (`/Users/<name>/…` on macOS, `/home/<name>/…`
 * on Linux), a mounted volume where a custom recordings folder usually lives (`/Volumes/…`,
 * `/mnt/…`, `/media/…`), or any Windows drive path except the system folders (`C:\Users\…`,
 * `D:\Recordings\…`, not `C:\Program Files\…`), or a network share (`\\server\share\…`). Also
 * behind `file://`.
 */
const PATH_ROOT = String.raw`(?:[A-Za-z]:[\\/](?!(?:Windows|Program Files|ProgramData)\b)|\\\\[^\\/\r\n]+[\\/]|[\\/](?:Users|home|Volumes|mnt|media)[\\/])`;

/**
 * Two shapes, tried at each position. A path right after a quote runs to the LAST matching quote
 * on the line that is not followed by a letter or digit, so an apostrophe in `Ana's Videos` or
 * `Clients' Archive` and the brackets in `Screen Recording (2).mov` stay inside it. That can take
 * a few words after a second quoted value: safer than leaving a name. Any other path runs to the end of the
 * line, except that a closing `)` of a stack frame (`at f (/Users/…:1:1)`) is kept. The lookbehind
 * keeps URLs such as `https://site/home/x` and app paths such as `/Applications/…` out.
 */
const PERSONAL_PATH = new RegExp(
  `(?<q>['"\`])${PATH_ROOT}[^\\r\\n]*(?=\\k<q>(?![A-Za-z0-9]))` +
    `|(?<![A-Za-z0-9.])${PATH_ROOT}[^\\r\\n]*?(?=\\)?[ \\t]*$)`,
  "gm",
);

/** What replaces a personal path in an exception message, stack frame or context value. */
export const REDACTED_USER_PATH = "<user-path>";

/**
 * Replaces every personal path in `text` with `<user-path>`. Recordings live in the home
 * folder or on a volume and are named by the user, so the whole path goes, file name
 * included, not just the account name. An unquoted path inside a sentence also takes the rest
 * of that line with it: losing a few words of a message beats leaking a name. A recordings
 * folder outside these roots (say `/data/clips`) is not recognised.
 */
export function scrubPersonalPaths(text: string): string {
  return text.replace(PERSONAL_PATH, (_match, quote?: string) =>
    quote ? `${quote}${REDACTED_USER_PATH}` : REDACTED_USER_PATH,
  );
}

/**
 * A copy of `value` with {@link scrubPersonalPaths} applied to every string inside it,
 * through objects and arrays. Used on whatever leaves the app as an exception or event, so
 * a path in a message, a stack frame or a context value never travels. A cycle and a very deep
 * value are cut instead of followed.
 */
export function scrubPersonalPathsDeep<T>(value: T): T {
  return scrubDeep(value, new WeakSet(), 0) as T;
}

/**
 * Property names that carry a library item's id. A local item's id is a file-name stem
 * projected from its title (ADR 0035), so it can spell the recording's name. Dropped as a
 * top-level property of any event or crash report; an `id` nested inside a context object is not
 * touched, so callers keep ids out of nested context.
 */
export const ITEM_ID_PROPERTIES = ["id", "assetId", "localId"] as const;

/**
 * What `before_send` does to every event, in both processes: scrub personal paths inside the
 * values, and drop the item-id properties. A copy; the input is untouched.
 */
export function scrubEventProperties<T extends Record<string, unknown>>(properties: T): T {
  const scrubbed = scrubPersonalPathsDeep(properties) as Record<string, unknown>;
  for (const key of ITEM_ID_PROPERTIES) delete scrubbed[key];
  return scrubbed as T;
}

const SCRUB_MAX_DEPTH = 12;

function scrubDeep(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") return scrubPersonalPaths(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value) || depth > SCRUB_MAX_DEPTH) return undefined;
  seen.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((item) => scrubDeep(item, seen, depth + 1));
  } else {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = scrubDeep(item, seen, depth + 1);
    out = copy;
  }
  // Only the objects on the way down count as a cycle: one referenced twice is not one.
  seen.delete(value);
  return out;
}
