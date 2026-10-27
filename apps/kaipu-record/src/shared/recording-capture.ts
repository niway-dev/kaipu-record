/**
 * How a recording was captured, persisted in the vault sidecar so the library (and the
 * Record page's recent grid) can label a take: "FRAME · 16:9", "SCREEN", "WINDOW".
 *
 * Pure and import-free on the value side: this file is reachable from the preload
 * bundle, which cannot load workspace packages at runtime. Words live in
 * `@kaipu/i18n` (`library.capture*`); this module only picks the key and its params.
 *
 * No TS enums (house rule): `as const` arrays + derived types.
 */
import type { RecordingArea } from "./types/ipc";
import {
  RECORDING_RATIO_VALUES,
  isRecordingRatio,
  type RecordingRatio,
} from "./types/screenshot-capture";

export const RECORDING_CAPTURE_MODES = ["screen", "area", "window"] as const;
export type RecordingCaptureMode = (typeof RECORDING_CAPTURE_MODES)[number];

export interface RecordingCapture {
  mode: RecordingCaptureMode;
  /** Output size of the encoded video, in pixels (0 when unknown). */
  width: number;
  height: number;
  /** Area recordings only: the locked ratio, or one inferred from the size. null otherwise. */
  ratio: RecordingRatio | null;
  /** Area recordings only: the display the area was on. */
  displayId?: number;
}

/**
 * The target kind (ADR 0030): a `window:` source is a window; a `screen:` source is a
 * whole display unless an area was set. The same rule feeds `recording_started` analytics.
 */
export function recordingCaptureMode(sourceId: string, hasArea: boolean): RecordingCaptureMode {
  if (sourceId.startsWith("window:")) return "window";
  return hasArea ? "area" : "screen";
}

/** Relative tolerance when inferring a fixed ratio from an encoded size (even rounding shifts it). */
export const RATIO_TOLERANCE = 0.01;

/** 16:9, 9:16 or 1:1 when `width / height` is within 1% of one; "free" otherwise or when unknown. */
export function inferRecordingRatio(width: number, height: number): RecordingRatio {
  if (!(width > 0) || !(height > 0)) return "free";
  const actual = width / height;
  for (const [ratio, value] of Object.entries(RECORDING_RATIO_VALUES) as Array<
    [Exclude<RecordingRatio, "free">, number]
  >) {
    if (Math.abs(actual - value) / value <= RATIO_TOLERANCE) return ratio;
  }
  return "free";
}

function positiveInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export interface BuildRecordingCaptureInput {
  sourceId: string;
  area?: RecordingArea | null;
  /** The size the engine encodes at (compositor target / `fitToCap`). Preferred. */
  output?: { width: number; height: number } | null;
  /** Physical pixels per DIP, for the area fallback when `output` is unknown. Default 1. */
  scale?: number;
}

/**
 * The value stored with a new recording. Size: the engine's output size; without it, an
 * area's DIP rect times `scale`; without either, zeros (the label then omits the size).
 */
export function buildRecordingCapture(input: BuildRecordingCaptureInput): RecordingCapture {
  const area = input.area ?? null;
  const mode = recordingCaptureMode(input.sourceId, area !== null);
  let width = positiveInt(input.output?.width);
  let height = positiveInt(input.output?.height);
  if ((width === 0 || height === 0) && area && mode === "area") {
    const scale = input.scale && input.scale > 0 ? input.scale : 1;
    width = positiveInt(area.rect.width * scale);
    height = positiveInt(area.rect.height * scale);
  }
  if (width === 0 || height === 0) {
    width = 0;
    height = 0;
  }
  if (mode !== "area" || !area) return { mode, width, height, ratio: null };
  const ratio = isRecordingRatio(area.ratio) ? area.ratio : inferRecordingRatio(width, height);
  return { mode, width, height, ratio, displayId: area.displayId };
}

/**
 * Validates a capture value that crossed a trust boundary (IPC from the renderer, or a
 * sidecar on disk someone may have edited). Anything malformed reads as `null`.
 */
export function sanitizeRecordingCapture(value: unknown): RecordingCapture | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!(RECORDING_CAPTURE_MODES as readonly unknown[]).includes(raw.mode)) return null;
  const mode = raw.mode as RecordingCaptureMode;
  const width = positiveInt(raw.width);
  const height = positiveInt(raw.height);
  const sized = width > 0 && height > 0;
  const capture: RecordingCapture = {
    mode,
    width: sized ? width : 0,
    height: sized ? height : 0,
    ratio: mode === "area" && isRecordingRatio(raw.ratio) ? raw.ratio : null,
  };
  if (mode === "area" && typeof raw.displayId === "number" && Number.isFinite(raw.displayId)) {
    capture.displayId = raw.displayId;
  }
  return capture;
}

/** i18n keys under the `library` namespace. */
export type RecordingCaptureLabelKey =
  | "captureScreen"
  | "captureWindow"
  | "captureFrame"
  | "captureFrameRatio"
  | "captureFrameSize";

export type RecordingCaptureLabel =
  | { key: "captureScreen" | "captureWindow" | "captureFrame" }
  | { key: "captureFrameRatio"; params: { ratio: string } }
  | { key: "captureFrameSize"; params: { width: number; height: number } };

/**
 * Which label a capture reads as: SCREEN, WINDOW, FRAME · 16:9 for a fixed ratio,
 * FRAME · 1280 × 720 for a free one, plain FRAME when the size is unknown.
 */
export function recordingCaptureLabelKey(
  capture: RecordingCapture | null | undefined,
): RecordingCaptureLabel | null {
  if (!capture) return null;
  if (capture.mode === "screen") return { key: "captureScreen" };
  if (capture.mode === "window") return { key: "captureWindow" };
  if (capture.ratio && capture.ratio !== "free") {
    return { key: "captureFrameRatio", params: { ratio: capture.ratio } };
  }
  if (capture.width > 0 && capture.height > 0) {
    return {
      key: "captureFrameSize",
      params: { width: capture.width, height: capture.height },
    };
  }
  return { key: "captureFrame" };
}

/** Minimal translator shape (use-intl's `t` fits it). */
export type RecordingCaptureTranslate = (
  key: RecordingCaptureLabelKey,
  params?: Record<string, string | number>,
) => string;

/** The label as text, through the caller's translator; null for an item without capture data. */
export function recordingCaptureLabel(
  capture: RecordingCapture | null | undefined,
  t: RecordingCaptureTranslate,
): string | null {
  const label = recordingCaptureLabelKey(capture);
  if (!label) return null;
  return "params" in label ? t(label.key, label.params) : t(label.key);
}
