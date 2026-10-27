/**
 * The camera bubble's look: its shape, its size and the camera it shows. Pure and
 * import-free on purpose: main (settings merge, window bounds), the preload bundle
 * (through `types/ipc.ts`) and the renderer (the settings UI, the bubble) all read it.
 *
 * Only these persist. The bubble's position does not: it lives at the bottom-left
 * corner of the recorded area and grows up and to the right from there (spec
 * record-capture-modes, decision 6).
 */

export const CAMERA_BUBBLE_SHAPES = ["circle", "rounded"] as const;
export type CameraBubbleShape = (typeof CAMERA_BUBBLE_SHAPES)[number];

export interface CameraBubbleSettings {
  shape: CameraBubbleShape;
  /** The bubble's side in DIP, between {@link CAMERA_BUBBLE_MIN_SIZE} and {@link CAMERA_BUBBLE_MAX_SIZE}. */
  size: number;
  /** The `videoinput` device to open; `null` lets the OS pick its default camera. */
  deviceId: string | null;
}

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
 * rather than dropped.
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
  return { shape, size, deviceId };
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
