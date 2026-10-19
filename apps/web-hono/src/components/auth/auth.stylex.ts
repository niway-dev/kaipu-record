import * as stylex from "@stylexjs/stylex";

/**
 * The landing's `--kl-*` layer, as typed references for the auth pages.
 *
 * The "Kaipu Web Auth" design (Claude Design project 71546ef1) draws with the landing's own two
 * palettes, so the auth pages do not bring a third one: `AuthShell` renders inside `[data-kl]`
 * with the visitor's `data-kl-theme`, and styles read the values through these names. The design's
 * extra names map onto existing tokens: its `--field` is `card`, its inverted Google button is
 * `tx` on `bg`.
 *
 * Same shape as `kl` in components/roadmap/roadmap.stylex.ts. When stage 3 of the StyleX migration
 * folds `--kl-*` into the unified tokens, both files change and the components do not.
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

/** The error red the design uses for borders, icons and inline messages, in both themes. */
export const danger = stylex.defineConsts({
  line: "#ef4444",
  soft: "rgba(239, 68, 68, 0.08)",
  edge: "rgba(239, 68, 68, 0.35)",
});

/** Below this width the brand panel goes and the form takes the whole screen. */
export const bp = stylex.defineConsts({
  mobile: "@media (max-width: 899px)",
  reducedMotion: "@media (prefers-reduced-motion: reduce)",
});
