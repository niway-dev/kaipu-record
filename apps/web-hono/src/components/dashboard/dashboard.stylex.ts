import * as stylex from "@stylexjs/stylex";

/**
 * The landing's `--kl-*` layer, as typed references for the signed-in dashboard.
 *
 * The "Kaipu Dashboard" design (Claude Design project 71546ef1) draws with the same two palettes
 * as the landing and the new sign-in pages, so the dashboard does not bring a third one:
 * `DashboardShell` renders inside `[data-kl]` with the visitor's `data-kl-theme`, and styles read
 * the values through these names. The design's extra names map onto existing tokens: its
 * `--field` is `card`, its inverted Google button is `tx` on `bg`.
 *
 * Same shape as `kl` in components/roadmap/roadmap.stylex.ts and the auth pages' auth.stylex.ts.
 * When stage 3 of the StyleX migration folds `--kl-*` into the unified tokens, these files change
 * and the components do not.
 */
export const kl = stylex.defineConsts({
  bg: "var(--kl-bg)",
  bg2: "var(--kl-bg-2)",
  card: "var(--kl-card)",
  card2: "var(--kl-card-2)",
  bd: "var(--kl-bd)",
  bd2: "var(--kl-bd-2)",
  tx: "var(--kl-tx)",
  dim: "var(--kl-dim)",
  faint: "var(--kl-faint)",
  dot: "var(--kl-dot)",
  pink: "var(--kl-pink)",
  pinkTx: "var(--kl-pink-tx)",
  fontSans: "var(--kl-font-sans)",
  fontMono: "var(--kl-font-mono)",
  fontSerif: "var(--kl-font-serif)",
});

/**
 * The state colours the design uses on notices, tags and the storage bar. They read on both
 * themes as they are, so they are literal rather than tokens (same choice as the auth pages'
 * `danger`).
 */
export const tone = stylex.defineConsts({
  red: "#ef4444",
  redSoft: "rgba(239, 68, 68, 0.07)",
  redEdge: "rgba(239, 68, 68, 0.38)",
  amber: "#d97706",
  amberSoft: "rgba(245, 158, 11, 0.08)",
  amberEdge: "rgba(245, 158, 11, 0.35)",
  green: "#16a34a",
  greenSoft: "rgba(34, 197, 94, 0.1)",
  greenEdge: "rgba(34, 197, 94, 0.35)",
  blue: "#3b82f6",
  blueSoft: "rgba(59, 130, 246, 0.1)",
  blueEdge: "rgba(59, 130, 246, 0.35)",
  pinkSoft: "rgba(246, 5, 92, 0.07)",
  pinkEdge: "rgba(246, 5, 92, 0.32)",
  pinkTint: "rgba(246, 5, 92, 0.12)",
  pinkReserved: "rgba(246, 5, 92, 0.4)",
  pinkHover: "#d4044f",
  focus: "rgba(246, 5, 92, 0.18)",
  pinkGlow: "0 12px 28px -12px rgba(246, 5, 92, 0.9)",
});

/** Below this width the sidebar becomes a top bar plus a bottom tab bar. */
export const bp = stylex.defineConsts({
  mobile: "@media (max-width: 767px)",
  reducedMotion: "@media (prefers-reduced-motion: reduce)",
});
