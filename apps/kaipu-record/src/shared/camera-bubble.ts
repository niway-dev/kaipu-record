/**
 * The camera bubble's look: its shape, its size and the camera it shows. Pure and
 * import-free on purpose: main (settings merge, window bounds), the preload bundle
 * (through `types/ipc.ts`) and the renderer (the settings UI, the bubble) all read it.
 *
 * Only these persist. The bubble's position does not: it starts at the bottom-left
 * corner of the recorded area (spec record-capture-modes, decision 6), the user can drag
 * it elsewhere for the session, and it grows up and to the right from wherever it sits.
 */

export const CAMERA_BUBBLE_SHAPES = ["circle", "rounded"] as const;
export type CameraBubbleShape = (typeof CAMERA_BUBBLE_SHAPES)[number];

export interface CameraBubbleSettings {
  shape: CameraBubbleShape;
  /** The bubble's side in DIP, between {@link CAMERA_BUBBLE_MIN_SIZE} and {@link CAMERA_BUBBLE_MAX_SIZE}. */
  size: number;
  /** The `videoinput` device to open; `null` lets the OS pick its default camera. */
  deviceId: string | null;
  /**
   * Whether the preview is flipped like a selfie cam. The bubble is captured into the
   * recording, so a flipped rear camera (or any text in view) reads reversed in the video.
   */
  mirrored: boolean;
  /** Manual framing: zoom and pan the camera image inside the bubble. */
  framing: CameraFraming;
}

/**
 * Where the camera image sits inside the bubble. Applies only while `enabled`; with it off
 * the bubble renders exactly as it did before framing existed (zoom/x/y are kept for later).
 */
export interface CameraFraming {
  enabled: boolean;
  /** Magnification of the image, {@link CAMERA_FRAMING_MIN_ZOOM}–{@link CAMERA_FRAMING_MAX_ZOOM}. */
  zoom: number;
  /**
   * How far the visible window is panned toward the right edge of what the bubble SHOWS,
   * -1 (touching the left edge) to 1 (touching the right edge); 0 is centered. Mirroring
   * does not change this: positive x always moves the view toward the right of the bubble.
   */
  x: number;
  /** Same, vertically: -1 is the top edge, 1 the bottom edge. */
  y: number;
}

export const CAMERA_FRAMING_MIN_ZOOM = 1;
export const CAMERA_FRAMING_MAX_ZOOM = 3;
export const CAMERA_FRAMING_ZOOM_STEP = 0.05;

export const DEFAULT_CAMERA_FRAMING: CameraFraming = { enabled: false, zoom: 1, x: 0, y: 0 };

export const CAMERA_BUBBLE_MIN_SIZE = 120;
export const CAMERA_BUBBLE_MAX_SIZE = 480;

/**
 * Room the bubble's window keeps around the bubble itself, in DIP: its drop shadow and
 * the hover chrome (size label above, resize grip on the rim). Transparent, so it never
 * shows in the video. Main sizes the window with it; the bubble renderer insets by it.
 */
export const CAMERA_BUBBLE_WINDOW_PAD = 24;

/** The bubble window's distance from the area's (or display's) left and bottom edges, in DIP. */
export const CAMERA_BUBBLE_AREA_MARGIN = 32;

export interface CameraBubbleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The bubble WINDOW's bounds inside `area` for a bubble of `size` (both in the same space,
 * global DIP for main, window-local DIP for the overlay's placeholder): anchored at the
 * area's bottom-left corner, growing up and to the right. A size the area cannot hold (with
 * the margins and the pad on both sides) is clamped down to what fits; `null` when not even
 * the minimum size fits. The visible bubble is these bounds inset by the pad.
 */
export function cameraBubbleWindowInArea(
  area: CameraBubbleRect,
  size: number,
  margin: number = CAMERA_BUBBLE_AREA_MARGIN,
): CameraBubbleRect | null {
  const room = Math.min(area.width, area.height) - 2 * margin - 2 * CAMERA_BUBBLE_WINDOW_PAD;
  const fitted = Math.min(clampCameraBubbleSize(size), Math.floor(room));
  if (fitted < CAMERA_BUBBLE_MIN_SIZE) return null;
  const side = fitted + 2 * CAMERA_BUBBLE_WINDOW_PAD;
  return { x: area.x + margin, y: area.y + area.height - margin - side, width: side, height: side };
}

/** The three named sizes the S · M · L chips pick. */
export const CAMERA_BUBBLE_PRESETS = { S: 160, M: 240, L: 360 } as const;
export type CameraBubblePreset = keyof typeof CAMERA_BUBBLE_PRESETS;
export const CAMERA_BUBBLE_PRESET_IDS = [
  "S",
  "M",
  "L",
] as const satisfies readonly CameraBubblePreset[];

export const DEFAULT_CAMERA_BUBBLE: CameraBubbleSettings = {
  shape: "circle",
  size: CAMERA_BUBBLE_PRESETS.M,
  deviceId: null,
  mirrored: true,
  framing: DEFAULT_CAMERA_FRAMING,
};

/** A finite size, rounded to whole DIP and held inside the allowed range. */
export function clampCameraBubbleSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_CAMERA_BUBBLE.size;
  return Math.min(CAMERA_BUBBLE_MAX_SIZE, Math.max(CAMERA_BUBBLE_MIN_SIZE, Math.round(size)));
}

/** The preset a size equals exactly, or `null` for a custom size. */
export function cameraBubblePresetFor(size: number): CameraBubblePreset | null {
  for (const id of CAMERA_BUBBLE_PRESET_IDS) {
    if (CAMERA_BUBBLE_PRESETS[id] === size) return id;
  }
  return null;
}

/**
 * Stored (possibly partial or hand-edited) bubble settings merged over the defaults,
 * field by field: an invalid shape falls back alone, a size out of range is clamped
 * rather than dropped, a non-boolean `mirrored` falls back to on.
 */
export function sanitizeCameraBubble(value: unknown): CameraBubbleSettings {
  const safe = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const shape = (CAMERA_BUBBLE_SHAPES as readonly unknown[]).includes(safe.shape)
    ? (safe.shape as CameraBubbleShape)
    : DEFAULT_CAMERA_BUBBLE.shape;
  const size =
    typeof safe.size === "number" && Number.isFinite(safe.size)
      ? clampCameraBubbleSize(safe.size)
      : DEFAULT_CAMERA_BUBBLE.size;
  const deviceId =
    typeof safe.deviceId === "string" && safe.deviceId.length > 0 ? safe.deviceId : null;
  const mirrored =
    typeof safe.mirrored === "boolean" ? safe.mirrored : DEFAULT_CAMERA_BUBBLE.mirrored;
  return { shape, size, deviceId, mirrored, framing: sanitizeCameraFraming(safe.framing) };
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A zoom held in range and snapped to the 0.05 step. */
export function clampCameraZoom(zoom: number): number {
  const clamped = Math.min(CAMERA_FRAMING_MAX_ZOOM, Math.max(CAMERA_FRAMING_MIN_ZOOM, zoom));
  return (
    Math.round(Math.round(clamped / CAMERA_FRAMING_ZOOM_STEP) * CAMERA_FRAMING_ZOOM_STEP * 100) /
    100
  );
}

/** A pan held in -1..1, to two decimals (and never -0). */
export function clampCameraPan(pan: number): number {
  return Math.round(Math.min(1, Math.max(-1, pan)) * 100) / 100 + 0;
}

/** Stored framing, field by field: non-numbers fall back, numbers are clamped. */
export function sanitizeCameraFraming(value: unknown): CameraFraming {
  const safe = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    enabled: typeof safe.enabled === "boolean" ? safe.enabled : DEFAULT_CAMERA_FRAMING.enabled,
    zoom: clampCameraZoom(finiteOr(safe.zoom, DEFAULT_CAMERA_FRAMING.zoom)),
    x: clampCameraPan(finiteOr(safe.x, DEFAULT_CAMERA_FRAMING.x)),
    y: clampCameraPan(finiteOr(safe.y, DEFAULT_CAMERA_FRAMING.y)),
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100000) / 1000 + 0}%`;
}

/**
 * The video element's CSS transform for a framed bubble. With `object-fit: cover` the
 * image already fills the bubble, so scaling by z leaves (z-1)/2 of the side spare on each
 * edge; in the pre-scale units a translate lives in, that is (z-1)/(2z). Panning by x·that
 * keeps the image covering the bubble: no empty edges at any zoom.
 *
 * Convention: positive x/y move the VIEW right/down, so the image slides left/up (the
 * translate is negative). The mirror flip is the LAST (innermost) function, applied to
 * the image before it is scaled and translated, so the translate is always in screen
 * space: x = 1 shows the right edge of what the bubble displays, mirrored or not.
 */
export function framingTransform(
  framing: Pick<CameraFraming, "zoom" | "x" | "y">,
  mirrored: boolean,
): string {
  const zoom = clampCameraZoom(finiteOr(framing.zoom, 1));
  const reach = (zoom - 1) / (2 * zoom);
  const tx = -clampCameraPan(finiteOr(framing.x, 0)) * reach;
  const ty = -clampCameraPan(finiteOr(framing.y, 0)) * reach;
  return `scale(${zoom}) translate(${percent(tx)}, ${percent(ty)})${mirrored ? " scaleX(-1)" : ""}`;
}

/** The lines of camera image worth requesting: today's 480, or 720 / 1080 when zoomed in. */
const CAPTURE_LINE_STEPS = [480, 720, 1080] as const;

/**
 * How many lines the camera stream should have. Without framing it stays 480 (what the
 * preview always asked for). With it, the bubble shows `zoom` times less of the image, so
 * the stream needs `size × 2 (Retina) × zoom` lines to stay sharp; rounded UP to a step
 * and capped at 1080, so a slider drag crosses a step rarely and the stream is not
 * reopened on every tick.
 */
export function cameraCaptureLines(size: number, framing: CameraFraming): number {
  if (!framing.enabled) return CAPTURE_LINE_STEPS[0];
  const needed = clampCameraBubbleSize(size) * 2 * clampCameraZoom(finiteOr(framing.zoom, 1));
  return CAPTURE_LINE_STEPS.find((lines) => lines >= needed) ?? CAPTURE_LINE_STEPS[2];
}

/**
 * One keyboard step of the size slider: 10 px, or 40 px with Shift. A step that would
 * jump over a preset stops on it, so the preset's name is always announced on the way.
 */
export function stepCameraBubbleSize(size: number, direction: 1 | -1, large: boolean): number {
  const target = clampCameraBubbleSize(size + direction * (large ? 40 : 10));
  for (const id of direction === 1
    ? CAMERA_BUBBLE_PRESET_IDS
    : [...CAMERA_BUBBLE_PRESET_IDS].reverse()) {
    const preset = CAMERA_BUBBLE_PRESETS[id];
    const crossed =
      direction === 1 ? preset > size && preset < target : preset < size && preset > target;
    if (crossed) return preset;
  }
  return target;
}
