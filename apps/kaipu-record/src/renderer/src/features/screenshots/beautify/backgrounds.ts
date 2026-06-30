/**
 * Beautify model: the curated background presets and the pure geometry helpers
 * (shadow + frame radius). Single source of truth for these feature-specific
 * values — the gradients aren't system tokens, so they live here, defined once.
 * Solid presets reuse the app's tokens (`--bg-app` / `--bg-card`).
 */

export const BACKGROUND_IDS = [
  "ninguno",
  "oscuro",
  "carbon",
  "magenta",
  "purpura",
  "oceano",
  "atardecer",
  "bosque",
  "grafito",
] as const;
export type BackgroundId = (typeof BACKGROUND_IDS)[number];

export interface Background {
  id: BackgroundId;
  name: string;
  /** A CSS `background` value (gradient, solid, or token var). */
  css: string;
}

export const BACKGROUNDS: Background[] = [
  { id: "ninguno", name: "Ninguno", css: "repeating-conic-gradient(#2a2a2e 0% 25%, #232327 0% 50%) 50% / 16px 16px" },
  { id: "oscuro", name: "Oscuro", css: "var(--bg-app)" },
  { id: "carbon", name: "Carbón", css: "var(--bg-card)" },
  { id: "magenta", name: "Magenta", css: "linear-gradient(135deg, #ff2d6e, #a3044a)" },
  { id: "purpura", name: "Púrpura", css: "linear-gradient(135deg, #a855f7, #6d28d9)" },
  { id: "oceano", name: "Océano", css: "linear-gradient(135deg, #2563eb, #06b6d4)" },
  { id: "atardecer", name: "Atardecer", css: "linear-gradient(135deg, #f59e0b, #ef4444)" },
  { id: "bosque", name: "Bosque", css: "linear-gradient(135deg, #22c55e, #0ea5e9)" },
  { id: "grafito", name: "Grafito", css: "linear-gradient(135deg, #3f3f46, #18181b)" },
];

export function backgroundCss(id: BackgroundId): string {
  return BACKGROUNDS.find((b) => b.id === id)?.css ?? BACKGROUNDS[0].css;
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
  return bg === "ninguno" ? radius : Math.max(8, radius + 4);
}

/** Slider bounds + defaults (from the design). */
export const PADDING_RANGE = { min: 0, max: 96, default: 40 } as const;
export const RADIUS_RANGE = { min: 0, max: 28, default: 12 } as const;
export const SHADOW_RANGE = { min: 0, max: 100, default: 60 } as const;

export interface BeautifyState {
  bg: BackgroundId;
  padding: number;
  radius: number;
  shadow: number;
}

export const DEFAULT_BEAUTIFY: BeautifyState = {
  bg: "magenta",
  padding: PADDING_RANGE.default,
  radius: RADIUS_RANGE.default,
  shadow: SHADOW_RANGE.default,
};
