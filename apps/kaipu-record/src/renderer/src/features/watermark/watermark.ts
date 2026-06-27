/**
 * Pure watermark model: the config shape, the default look, and the two pieces of
 * pure logic (the gating decision + the corner placement math). No React, no DOM,
 * no electron — so both are unit-testable. The drawing lives in the compositor;
 * the decision lives in `useWatermark`.
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

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  variant: "wordmark",
  position: "middle-right",
  tint: "white",
  opacity: 0.9,
  heightRatio: 0.054, // ~20% larger than the original 0.045 — readable past player chrome
  marginRatio: 0.03,
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

export interface WatermarkInputs {
  /** Feature flag (today always on; tomorrow PostHog). */
  flagOn: boolean;
  /** Real entitlement (today stubbed; tomorrow a backend). */
  isPaid: boolean;
  /** DEV-only force override; `null` in prod. */
  devForce: "free" | "paid" | null;
}

/** The single gating rule: paid (or forced paid) removes it; the flag can kill it. */
export function resolveWatermarkEnabled({ flagOn, isPaid, devForce }: WatermarkInputs): boolean {
  const paid = devForce ? devForce === "paid" : isPaid;
  return flagOn && !paid;
}
