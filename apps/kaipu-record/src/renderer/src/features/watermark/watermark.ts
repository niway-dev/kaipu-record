/**
 * Pure watermark model: the config shape, the default look, and the corner
 * placement math. No React, no DOM, no electron — so it is unit-testable. The
 * drawing lives in the compositor; whether to draw at all is the user's
 * `showBrandBadge` setting, read by `useWatermark`.
 */

// `as const` sets — no TS enums (see docs: enums-as-const). Type derives from values.
export const WATERMARK_VARIANTS = ["wordmark", "mark"] as const;
export type WatermarkVariant = (typeof WATERMARK_VARIANTS)[number];

export const WATERMARK_POSITIONS = [
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
  "bottom-center",
  "middle-right",
] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

/** `white` re-tints the asset to a white silhouette (legible on any background). */
export const WATERMARK_TINTS = ["white", "original"] as const;
export type WatermarkTint = (typeof WATERMARK_TINTS)[number];

export interface WatermarkConfig {
  variant: WatermarkVariant;
  position: WatermarkPosition;
  tint: WatermarkTint;
  /** 0..1 draw opacity. */
  opacity: number;
  /** Watermark height as a fraction of the video height. */
  heightRatio: number;
  /** Edge margin as a fraction of the video height. */
  marginRatio: number;
}

/**
 * The badge look. The mark is a signature in a corner, not a claim on the
 * frame: `middle-right` at 0.9 opacity sat over the content itself, so it moved
 * to the bottom-right corner and lost a third of its weight. Losing some presence
 * is the intent — the compositor's drop shadow is what keeps it legible on light
 * footage at this opacity.
 *
 * The margin is deliberately larger than a tight corner inset. At 2.5 % the mark
 * read as stuck to the bottom edge, where it collided with whatever bottom bar or
 * dock the recorded content had of its own; 5 % lifts it clear of that band while
 * keeping it a corner placement.
 */
export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  variant: "wordmark",
  position: "bottom-right",
  tint: "white",
  opacity: 0.75,
  heightRatio: 0.059, // tuned up ~30% from the original 0.045 for visibility
  marginRatio: 0.05,
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where to draw the watermark on a `canvasW × canvasH` frame, given the asset's
 * aspect ratio (width / height). Height/margin scale with the frame height so the
 * watermark looks the same relative size at 720p or 4K.
 */
export function watermarkRect(
  canvasW: number,
  canvasH: number,
  assetAspect: number,
  config: WatermarkConfig,
): Rect {
  const height = Math.round(canvasH * config.heightRatio);
  const width = Math.round(height * assetAspect);
  const margin = Math.round(canvasH * config.marginRatio);

  const rightX = canvasW - width - margin;
  const bottomY = canvasH - height - margin;
  const centerX = Math.round((canvasW - width) / 2);
  const middleY = Math.round((canvasH - height) / 2);

  switch (config.position) {
    case "bottom-right":
      return { x: rightX, y: bottomY, width, height };
    case "bottom-left":
      return { x: margin, y: bottomY, width, height };
    case "top-right":
      return { x: rightX, y: margin, width, height };
    case "top-left":
      return { x: margin, y: margin, width, height };
    case "bottom-center":
      return { x: centerX, y: bottomY, width, height };
    case "middle-right":
      return { x: rightX, y: middleY, width, height };
  }
}
