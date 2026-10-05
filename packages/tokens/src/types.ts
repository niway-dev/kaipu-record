/*
 * Canonical token names. The CSS custom property for a token is `--<name>`
 * (desktop) or `--kaipu-<name>` (web). Names are kebab-case string keys so the
 * TS objects, the generated CSS, and every `var(--…)` reference stay greppable
 * as one identifier.
 */

/** Theme-invariant tokens: spacing, radii, typography, layout, motion. */
export const BASE_TOKEN_NAMES = [
  "space-xs",
  "space-sm",
  "space-md",
  "space-lg",
  "space-xl",
  "space-2xl",
  "radius-sm",
  "radius-md",
  "radius-lg",
  "font-family",
  "font-mono",
  "font-size-xs",
  "font-size-sm",
  "font-size-base",
  "font-size-md",
  "font-size-lg",
  "font-size-xl",
  "font-weight-normal",
  "font-weight-medium",
  "font-weight-semibold",
  "sidebar-width",
  "titlebar-height",
  "transition",
  "transition-slow",
] as const;

/** Per-theme tokens: colors, overlays, glows. Every theme must define all of them. */
export const THEME_TOKEN_NAMES = [
  "bg-app",
  "bg-sidebar",
  "bg-card",
  "bg-card-hover",
  "bg-input",
  "bg-modal",
  "bg-overlay",
  "border",
  "border-light",
  "text-primary",
  "text-secondary",
  "text-muted",
  "accent-primary",
  "accent-primary-hover",
  "accent-primary-soft",
  "accent-primary-tint",
  "accent-primary-ring",
  "glow-accent",
  "accent-green",
  "accent-red",
  "accent-red-hover",
  "accent-yellow",
  "accent-purple",
] as const;

export type BaseTokenName = (typeof BASE_TOKEN_NAMES)[number];
export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

export type BaseTokens = Record<BaseTokenName, string>;

/** The full shape a theme must satisfy — a missing token is a compile error. */
export type TokenSet = Record<ThemeTokenName, string>;
