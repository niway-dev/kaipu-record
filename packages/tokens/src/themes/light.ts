import type { TokenSet } from "../types";

/**
 * The Kaipu light theme. Derived from dark with the same hue relationships:
 * near-white neutral surfaces (slightly warm, matching dark's zinc cast),
 * the brand accent unchanged, semantic accents darkened one step for
 * contrast on light surfaces, and the CTA glow softened (the dark value is
 * calibrated for near-black backgrounds).
 * Every text/surface pair is WCAG-AA-guarded by contrast.test.ts.
 */
export const light: TokenSet = {
  "bg-app": "#fafafa",
  "bg-sidebar": "#f4f4f5",
  "bg-card": "#ffffff",
  "bg-card-hover": "#f4f4f5",
  "bg-input": "#ffffff",
  "bg-modal": "#ffffff",
  "bg-overlay": "rgba(9, 9, 11, 0.45)",
  border: "#e4e4e7",
  "border-light": "#d4d4d8",
  "text-primary": "#18181b",
  "text-secondary": "#52525b",
  "text-muted": "#62626b",
  "accent-primary": "#f6055c",
  "accent-primary-hover": "#d4044f",
  "accent-primary-soft": "rgba(246, 5, 92, 0.1)",
  "accent-primary-tint": "rgba(246, 5, 92, 0.12)",
  "accent-primary-ring": "rgba(246, 5, 92, 0.4)",
  "glow-accent": "0 10px 26px -8px rgba(246, 5, 92, 0.35)",
  "accent-green": "#15803d",
  "accent-red": "#dc2626",
  "accent-red-hover": "#b91c1c",
  "accent-yellow": "#a16207",
  "accent-purple": "#9333ea",
};
