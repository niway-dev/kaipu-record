import * as stylex from "@stylexjs/stylex";

/**
 * The landing's `--kl-*` layer, as typed references for StyleX.
 *
 * The values still live in styles/landing-tokens.css, scoped to [data-kl], and
 * that file still owns the light theme. This is the one place the roadmap
 * spells a `--kl-*` name: a typo in a key is a compile error, and when stage 3
 * of the StyleX migration folds `--kl-*` into the unified tokens (shared
 * styling spec, decision 6) this file is what changes, not the page.
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
  glass: "var(--kl-glass)",
  glassBlur: "blur(var(--kl-glass-blur))",
  pink: "var(--kl-pink)",
  pinkTx: "var(--kl-pink-tx)",
  c1: "var(--kl-c1)",
  c2: "var(--kl-c2)",
  c3: "var(--kl-c3)",
  c4: "var(--kl-c4)",
  c5: "var(--kl-c5)",
  fontMono: "var(--kl-font-mono)",
  fontSerif: "var(--kl-font-serif)",
  fsH2Serif: "var(--kl-fs-h2-serif)",
  trackingLabel: "var(--kl-tracking-label)",
  trackingH1: "var(--kl-tracking-h1)",
  trackingH2: "var(--kl-tracking-h2)",
  leadingBody: "var(--kl-leading-body)",
  maxW: "var(--kl-max-w)",
  gutter: "var(--kl-gutter)",
  glowBtn: "var(--kl-glow-btn)",
});

/**
 * The state colours: only this page has states, so they are not landing
 * tokens. Each has a separate value for TEXT, darker in the light theme, for
 * the same reason --kl-pink-tx exists: bright green and amber do not carry
 * enough contrast as type on warm white.
 */
export const palette = stylex.defineVars({
  shipped: "#22c55e",
  shippedTx: "#22c55e",
  progress: "#f59e0b",
  progressTx: "#f59e0b",
  planned: "#8a8a92",
  plannedTx: "#8a8a92",
  win: "#58a6ff",
});

export const paletteLight = stylex.createTheme(palette, {
  shipped: "#22c55e",
  shippedTx: "#15803d",
  progress: "#f59e0b",
  progressTx: "#b45309",
  planned: "#76767f",
  plannedTx: "#5f5f68",
  win: "#1f6fd1",
});

/**
 * One state's colour, set per element by a variant and read by everything
 * inside it — so a cell, its dot and its label agree without three variants
 * each.
 */
export const tone = stylex.defineVars({
  c: "transparent",
  cTx: "inherit",
});

/** A row's area tint, or a summary card's platform tint, handed to its children. */
export const tint = stylex.defineVars({
  area: "transparent",
  platform: "transparent",
});
