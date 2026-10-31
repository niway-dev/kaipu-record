/**
 * The webcam track (ADR 0032): the recorder encodes the webcam into its own file,
 * `.kaipu/<id>.webcam.mp4`, on the same renderer clock as the screen, and the sidecar stores
 * where its time 0 sits against the screen's (`startOffsetMs`).
 *
 * Pure, and its value imports are relative ones inside `src/shared`: this file is reachable
 * from the preload bundle (through `types/ipc.ts`), which cannot load workspace packages.
 */
import {
  cameraCaptureLines,
  sanitizeCameraBubble,
  type CameraBubbleSettings,
} from "./camera-bubble";

/** Lines of webcam image recorded without framing: 1280×720, Cap's default. */
export const WEBCAM_LINES_DEFAULT = 720;
/** The most lines recorded, with framing zoomed in. */
const WEBCAM_LINES_MAX = 1080;
export const WEBCAM_FPS = 30;
export const WEBCAM_BITRATE_BPS = 2_500_000;

/** The second writer session of a take carries the webcam; the first, the screen. */
export const RECORDING_WRITER_KINDS = ["screen", "webcam"] as const;
export type RecordingWriterKind = (typeof RECORDING_WRITER_KINDS)[number];

/** An IPC argument as a writer kind: anything but "webcam" is the screen (older callers send none). */
export function recordingWriterKind(value: unknown): RecordingWriterKind {
  return value === "webcam" ? "webcam" : "screen";
}

export type WebcamOffsetQuality = "exact" | "estimated";

/**
 * The bubble as the user saw it during the take (its persisted settings, without the device).
 * The editor seeds its webcam layout from it; the file itself is raw (no mirror, no framing).
 */
export type WebcamRecordedLayout = Omit<CameraBubbleSettings, "deviceId"> & {
  /**
   * The bubble's centre in the recorded rectangle (the display or the area), 0..1 from its
   * top-left corner, as main saw the bubble window when the take ended. Absent when the
   * bubble was not on the recorded rectangle. The editor seeds the layer's corner from it.
   */
  position?: { x: number; y: number };
  /** The bubble's side as a fraction of the recorded rectangle's height, as main saw it. */
  sizeFraction?: number;
};

/**
 * A period of the take with the camera turned off, in screen ms (the screen file's timeline,
 * pauses removed), [startMs, endMs). The webcam file keeps running through it on the same
 * clock, holding its last frame, so the editor hides the face there (ADR 0032).
 */
export interface WebcamGap {
  startMs: number;
  endMs: number;
}

/** The most gaps a sidecar keeps: far more than anyone toggles a camera in one take. */
const WEBCAM_GAPS_MAX = 1000;

/** The sidecar's `webcam` field, and what the recorder sends with finalize. */
export interface WebcamTrackMeta {
  /** Webcam time 0 − screen time 0, in ms on the recorder renderer's clock. */
  startOffsetMs: number;
  /** "exact" only when both first-media timestamps were read from mediabunny. */
  offsetQuality: WebcamOffsetQuality;
  width: number;
  height: number;
  fps: number;
  recordedLayout?: WebcamRecordedLayout;
  /** The camera-off periods, sorted and apart; absent when the camera stayed on (old sidecars too). */
  gaps?: WebcamGap[];
}

/**
 * Lines to record the webcam at: 720, or the bubble's own capture lines while framing is on
 * (so a zoomed-in bubble stays sharp in the editor), capped at 1080.
 */
export function webcamCaptureLines(bubble: Pick<CameraBubbleSettings, "size" | "framing">): number {
  if (!bubble.framing.enabled) return WEBCAM_LINES_DEFAULT;
  const lines = cameraCaptureLines(bubble.size, bubble.framing);
  return Math.min(WEBCAM_LINES_MAX, Math.max(WEBCAM_LINES_DEFAULT, lines));
}

/**
 * Lines the bubble's preview asks the camera for. The bubble and the recorder open the same
 * device, and Chromium shares one capture per device that each track can only downscale: a
 * preview asking for fewer lines than the webcam file records would starve it. So the
 * preview asks for whichever is more, its own `cameraCaptureLines` or the webcam's.
 */
export function bubblePreviewLines(bubble: Pick<CameraBubbleSettings, "size" | "framing">): number {
  return Math.max(cameraCaptureLines(bubble.size, bubble.framing), webcamCaptureLines(bubble));
}

interface FirstMediaTime {
  rendererMs: number;
  quality: WebcamOffsetQuality;
}

/**
 * Where the webcam file's time 0 sits on the screen file's timeline. Both outputs are stamped
 * from the same `performance.now()`, so the files differ only by their first accepted sample.
 */
export function webcamStartOffset(
  screen: FirstMediaTime,
  webcam: FirstMediaTime,
): { startOffsetMs: number; offsetQuality: WebcamOffsetQuality } {
  return {
    startOffsetMs: Math.round((webcam.rendererMs - screen.rendererMs) * 1000) / 1000,
    offsetQuality: screen.quality === "exact" && webcam.quality === "exact" ? "exact" : "estimated",
  };
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isPositive = (value: unknown): value is number => isFiniteNumber(value) && value > 0;

/** A point with both coordinates finite, clamped to 0..1; null for anything else. */
function sanitizeUnitPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as Record<string, unknown>;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const unit = (n: number): number => Math.min(1, Math.max(0, n));
  return { x: unit(x), y: unit(y) };
}

/**
 * Renderer-supplied gaps, made safe: each malformed, empty or backwards one is dropped on its
 * own, a start before time 0 is clamped to it, and overlapping ones are merged. Sorted.
 */
function sanitizeWebcamGaps(value: unknown): WebcamGap[] {
  if (!Array.isArray(value)) return [];
  const parsed: WebcamGap[] = [];
  for (const raw of value as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const { startMs, endMs } = raw as Record<string, unknown>;
    if (!isFiniteNumber(startMs) || !isFiniteNumber(endMs)) continue;
    const start = Math.max(0, startMs);
    if (endMs <= start) continue;
    parsed.push({ startMs: start, endMs });
  }
  parsed.sort((a, b) => a.startMs - b.startMs);
  const gaps: WebcamGap[] = [];
  for (const gap of parsed) {
    const previous = gaps[gaps.length - 1];
    if (previous && gap.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, gap.endMs);
      continue;
    }
    if (gaps.length === WEBCAM_GAPS_MAX) break;
    gaps.push(gap);
  }
  return gaps;
}

/** A renderer-supplied webcam meta, validated before it lands on disk; null when unusable. */
export function sanitizeWebcamTrackMeta(value: unknown): WebcamTrackMeta | null {
  if (!value || typeof value !== "object") return null;
  const safe = value as Record<string, unknown>;
  if (!isFiniteNumber(safe.startOffsetMs)) return null;
  if (safe.offsetQuality !== "exact" && safe.offsetQuality !== "estimated") return null;
  if (!isPositive(safe.width) || !isPositive(safe.height) || !isPositive(safe.fps)) return null;
  const meta: WebcamTrackMeta = {
    startOffsetMs: safe.startOffsetMs,
    offsetQuality: safe.offsetQuality,
    width: Math.round(safe.width),
    height: Math.round(safe.height),
    fps: safe.fps,
  };
  if (safe.recordedLayout && typeof safe.recordedLayout === "object") {
    const { shape, size, mirrored, framing } = sanitizeCameraBubble(safe.recordedLayout);
    const position = sanitizeUnitPoint((safe.recordedLayout as Record<string, unknown>).position);
    const fraction = (safe.recordedLayout as Record<string, unknown>).sizeFraction;
    const sizeFraction = isPositive(fraction) ? Math.min(1, fraction) : null;
    meta.recordedLayout = {
      shape,
      size,
      mirrored,
      framing,
      ...(position ? { position } : {}),
      ...(sizeFraction ? { sizeFraction } : {}),
    };
  }
  const gaps = sanitizeWebcamGaps(safe.gaps);
  if (gaps.length > 0) meta.gaps = gaps;
  return meta;
}

/** Where a take's webcam file goes when its screen file is saved to `screenPath` by hand. */
export function webcamSiblingPath(screenPath: string): string {
  return `${screenPath.replace(/\.mp4$/i, "")}.webcam.mp4`;
}
