/**
 * The video's background (NIW2-668, ADR 0051): the screenshot editor's beautify look — a
 * preset, a padding, a corner radius and a shadow — drawn around the composed picture as
 * the OUTERMOST step of the preview, the MP4 and the GIF. Everything the editor draws
 * (zoom, blur, annotations, the cursor, the webcam) is part of the picture and shrinks with
 * it; the padding is never zoomed or cropped, and the output size never changes.
 *
 * Pure and worker-safe: the export worker bundles this module and the screenshot editor's
 * `backgrounds.ts` it reads (no React, no DOM — pinned by a test). One geometry,
 * `backgroundFrame`, feeds the preview's CSS and the composer's canvas calls, so the two
 * cannot disagree about where the picture sits.
 */
import {
  BACKGROUND_IDS,
  PADDING_RANGE,
  RADIUS_RANGE,
  SHADOW_RANGE,
  type BackgroundId,
} from "../screenshots/beautify/backgrounds";

export interface VideoBackground {
  /** The screenshot editor's preset id; `none` is today's picture, with nothing around it. */
  bg: BackgroundId;
  /** `PADDING_RANGE` (0–96 px), `RADIUS_RANGE` (0–28) and `SHADOW_RANGE` (0–100): read at a
   *  1080 px-high output and scaled by `height / 1080` for any other (`backgroundFrame`). */
  padding: number;
  radius: number;
  shadow: number;
}

export const DEFAULT_BACKGROUND: VideoBackground = { bg: "none", padding: 0, radius: 0, shadow: 0 };

/** The output height the three numbers are expressed at. */
export const BACKGROUND_REFERENCE_HEIGHT = 1080;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A drop shadow in output px: CSS `0 offsetY blur rgba(0, 0, 0, alpha)`, canvas `shadowBlur`. */
export interface BackgroundShadow {
  offsetY: number;
  blur: number;
  alpha: number;
}

/** A finite number clamped to `range`; anything else (NaN, ±Infinity, a string…) is 0. */
function clampNumber(value: unknown, range: { min: number; max: number }): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(range.max, Math.max(range.min, value));
}

/**
 * A saved background, trusted no further than its shape: an unknown preset becomes `none`,
 * each number is clamped to the screenshot editor's slider range and a non-finite one is 0.
 * Absent or not an object → the default. Never throws, so a damaged key never costs a session.
 */
export function parseBackground(raw: unknown): VideoBackground {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_BACKGROUND };
  }
  const r = raw as Record<string, unknown>;
  const bg = (BACKGROUND_IDS as readonly unknown[]).includes(r["bg"])
    ? (r["bg"] as BackgroundId)
    : "none";
  return {
    bg,
    padding: clampNumber(r["padding"], PADDING_RANGE),
    radius: clampNumber(r["radius"], RADIUS_RANGE),
    shadow: clampNumber(r["shadow"], SHADOW_RANGE),
  };
}

/**
 * Whether anything is drawn around the picture. With `none` the padding, radius and shadow
 * are stored but never drawn, in the preview or the export: an MP4 has no alpha, so there is
 * nothing honest to paint around the picture, and the controls are disabled so a slider
 * never moves without a visible change.
 */
export function hasBackground(background: VideoBackground): boolean {
  return background.bg !== "none";
}

/** The screenshot editor's shadow formula (`shadowCss`, the compositor), at `scale`. */
function shadowOf(value: number, scale: number): BackgroundShadow | null {
  if (value <= 0) return null;
  return {
    offsetY: value * 0.45 * scale,
    blur: (value * 0.9 + 8) * scale,
    alpha: Number((0.12 + (value / 100) * 0.5).toFixed(2)),
  };
}

/**
 * The most padding one side may have, as a share of the output's SMALLER dimension. The
 * padding is read at 1080 px high and scaled by `height / 1080`, so on a tall, narrow output
 * (128×2160 scales it by 2) it can pass the output's own width, and the picture then leaves
 * the canvas altogether. Capping each side at a quarter of the smaller dimension leaves the
 * picture at least half of the output on each axis, at any size. The cap is a `min` of two
 * continuous values, so the picture moves smoothly through it, and it never binds for an
 * output no taller than 1 : 2.8 (9:16 is 1 : 1.78): every preset and source-shaped output
 * keeps exactly the geometry it had before the cap.
 */
export const MAX_PADDING_SHARE = 0.25;

export interface BackgroundFrame {
  /** The output inset by the padding on every side: where the picture may sit. */
  box: Rect;
  /** The picture: the output's aspect, as large as fits in `box`, centred. */
  picture: Rect;
  /** The picture's corner radius, in output px. */
  radius: number;
  /** The picture's shadow, or null for none. */
  shadow: BackgroundShadow | null;
}

/**
 * Where the picture sits inside an output of `width × height`, plus its corner radius and
 * shadow in that output's px. The padding insets a `box` on every side; the picture then
 * keeps its own aspect inside it — a uniform inset would squash a 16:9 picture by about 4 %
 * at padding 48 — so on a landscape output the margin is `padding` above and below and wider
 * at the sides. Padding, radius and shadow are read at 1080 px high and scaled by
 * `height / 1080`, so every preset shows the same proportions.
 *
 * Two caps keep an extreme output sane (review C1): each side's padding is at most
 * `MAX_PADDING_SHARE` of the smaller output dimension, so the picture is always inside the
 * canvas, centred and at least half of it on each axis; and the radius is at most half of the
 * picture's smaller side. Neither moves a result at an ordinary size.
 *
 * With `none` (or an output with no size) it is the whole output, no radius and no shadow:
 * the caller needs no branch.
 */
export function backgroundFrame(
  background: VideoBackground,
  width: number,
  height: number,
): BackgroundFrame {
  const whole: Rect = { x: 0, y: 0, width, height };
  if (!hasBackground(background) || !(width > 0) || !(height > 0)) {
    return { box: whole, picture: whole, radius: 0, shadow: null };
  }
  const scale = height / BACKGROUND_REFERENCE_HEIGHT;
  // Capped, `2 * padding <= width / 2` and `<= height / 2`: the box below is never empty.
  const padding = Math.min(
    clampNumber(background.padding, PADDING_RANGE) * scale,
    MAX_PADDING_SHARE * Math.min(width, height),
  );
  const box: Rect = {
    x: padding,
    y: padding,
    width: width - 2 * padding,
    height: height - 2 * padding,
  };
  const fit = Math.min(box.width / width, box.height / height);
  const picture: Rect = {
    x: box.x + (box.width - width * fit) / 2,
    y: box.y + (box.height - height * fit) / 2,
    width: width * fit,
    height: height * fit,
  };
  return {
    box,
    picture,
    radius: Math.min(
      clampNumber(background.radius, RADIUS_RANGE) * scale,
      Math.min(picture.width, picture.height) / 2,
    ),
    shadow: shadowOf(clampNumber(background.shadow, SHADOW_RANGE), scale),
  };
}
