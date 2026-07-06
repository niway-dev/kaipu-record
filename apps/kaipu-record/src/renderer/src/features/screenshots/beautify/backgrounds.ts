/**
 * Beautify model: the curated background presets and the pure geometry helpers
 * (shadow + frame radius). Single source of truth for these feature-specific
 * values — the gradients aren't system tokens, so they live here, defined once.
 * Solid presets reuse the app's tokens (`--bg-app` / `--bg-card`).
 */

export const BACKGROUND_IDS = [
  "none",
  "dark",
  "carbon",
  "magenta",
  "purple",
  "ocean",
  "sunset",
  "forest",
  "graphite",
] as const;
export type BackgroundId = (typeof BACKGROUND_IDS)[number];

/** Canvas-drawable form of a background (the CSS `var()`/gradient can't be drawn). */
export type BackgroundPaint =
  | { kind: "none" }
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string };

export type BackgroundNameKey =
  | "bgNone"
  | "bgDark"
  | "bgCarbon"
  | "bgMagenta"
  | "bgPurple"
  | "bgOcean"
  | "bgSunset"
  | "bgForest"
  | "bgGraphite";

export interface Background {
  id: BackgroundId;
  /** i18n key (under the `screenshots` namespace) for this preset's a11y name. */
  nameKey: BackgroundNameKey;
  /** A CSS `background` value (gradient, solid, or token var) for the live preview. */
  css: string;
  /** Concrete colours for compositing the export to a canvas. */
  paint: BackgroundPaint;
}

export const BACKGROUNDS: Background[] = [
  {
    id: "none",
    nameKey: "bgNone",
    css: "repeating-conic-gradient(#2a2a2e 0% 25%, #232327 0% 50%) 50% / 16px 16px",
    paint: { kind: "none" },
  },
  {
    id: "dark",
    nameKey: "bgDark",
    css: "var(--bg-app)",
    paint: { kind: "solid", color: "#0f0f11" },
  },
  {
    id: "carbon",
    nameKey: "bgCarbon",
    css: "var(--bg-card)",
    paint: { kind: "solid", color: "#171719" },
  },
  {
    id: "magenta",
    nameKey: "bgMagenta",
    css: "linear-gradient(135deg, #ff2d6e, #a3044a)",
    paint: { kind: "gradient", from: "#ff2d6e", to: "#a3044a" },
  },
  {
    id: "purple",
    nameKey: "bgPurple",
    css: "linear-gradient(135deg, #a855f7, #6d28d9)",
    paint: { kind: "gradient", from: "#a855f7", to: "#6d28d9" },
  },
  {
    id: "ocean",
    nameKey: "bgOcean",
    css: "linear-gradient(135deg, #2563eb, #06b6d4)",
    paint: { kind: "gradient", from: "#2563eb", to: "#06b6d4" },
  },
  {
    id: "sunset",
    nameKey: "bgSunset",
    css: "linear-gradient(135deg, #f59e0b, #ef4444)",
    paint: { kind: "gradient", from: "#f59e0b", to: "#ef4444" },
  },
  {
    id: "forest",
    nameKey: "bgForest",
    css: "linear-gradient(135deg, #22c55e, #0ea5e9)",
    paint: { kind: "gradient", from: "#22c55e", to: "#0ea5e9" },
  },
  {
    id: "graphite",
    nameKey: "bgGraphite",
    css: "linear-gradient(135deg, #3f3f46, #18181b)",
    paint: { kind: "gradient", from: "#3f3f46", to: "#18181b" },
  },
];

export function backgroundCss(id: BackgroundId): string {
  return BACKGROUNDS.find((b) => b.id === id)?.css ?? BACKGROUNDS[0].css;
}

export function backgroundPaint(id: BackgroundId): BackgroundPaint {
  return BACKGROUNDS.find((b) => b.id === id)?.paint ?? { kind: "none" };
}

/** Drop-shadow CSS from the 0–100 "Sombra" slider (formula from the design). */
export function shadowCss(value: number): string {
  if (value <= 0) return "none";
  const y = Math.round(value * 0.45);
  const blur = Math.round(value * 0.9 + 8);
  const spread = Math.round(value * 0.18);
  const alpha = (0.12 + (value / 100) * 0.5).toFixed(2);
  return `0 ${y}px ${blur}px -${spread}px rgba(0, 0, 0, ${alpha})`;
}

/** The frame's outer radius: a touch larger than the shot, unless transparent. */
export function frameRadius(bg: BackgroundId, radius: number): number {
  return bg === "none" ? radius : Math.max(8, radius + 4);
}

/**
 * Slider bounds + defaults. Defaults are 0 so a fresh capture opens as the plain
 * screenshot (no frame): the user sees exactly what they captured and adds beautify
 * only if they want it — friendlier than landing on an already-decorated image.
 */
export const PADDING_RANGE = { min: 0, max: 96, default: 0 } as const;
export const RADIUS_RANGE = { min: 0, max: 28, default: 0 } as const;
export const SHADOW_RANGE = { min: 0, max: 100, default: 0 } as const;

export interface BeautifyState {
  bg: BackgroundId;
  padding: number;
  radius: number;
  shadow: number;
}

/**
 * A fresh capture opens plain — transparent background, no padding/radius/shadow — so
 * the user starts from the raw screenshot and layers beautify on top only if they want.
 */
export const DEFAULT_BEAUTIFY: BeautifyState = {
  bg: "none",
  padding: PADDING_RANGE.default,
  radius: RADIUS_RANGE.default,
  shadow: SHADOW_RANGE.default,
};

/**
 * Unframed beautify: no background/padding/radius/shadow. Used when re-opening an
 * already-composited screenshot so the editor doesn't frame an already-framed shot.
 */
export const FLAT_BEAUTIFY: BeautifyState = {
  bg: "none",
  padding: 0,
  radius: 0,
  shadow: 0,
};
