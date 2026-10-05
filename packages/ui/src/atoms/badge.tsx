import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { ReactNode } from "react";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * A small status pill. An atom by this package's rule: it composes no other
 * component here, holds no state, and takes its text as children — the surface
 * decides what the status is called.
 *
 * Migrated value for value from the desktop's ui/badge.module.css, which drove
 * its tones through a `--badge-bg` / `--badge-fg` pair set per `data-variant`.
 * Here the pair is just the two properties of a variant style, which is the
 * same thing with one less indirection.
 */

type BadgeVariant = "success" | "info" | "warning" | "danger" | "neutral";

const base = stylex.create({
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    paddingBlock: "2px",
    paddingInline: "8px",
    borderRadius: "10px",
    whiteSpace: "nowrap",
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
  },
});

/**
 * The tinted backgrounds are the accent colors at 12–15% alpha and have no
 * token behind them — the desktop's stylesheet hard-codes the same values. They
 * are candidates for the token layer, not a decision this atom should make.
 */
const variants = stylex.create({
  neutral: {
    backgroundColor: tokens.bgCardHover,
    color: tokens.textSecondary,
  },
  success: {
    backgroundColor: "rgba(34, 197, 94, 0.15)",
    color: tokens.accentGreen,
  },
  info: {
    backgroundColor: tokens.accentPrimaryTint,
    color: tokens.accentPrimary,
  },
  warning: {
    backgroundColor: "rgba(234, 179, 8, 0.15)",
    color: tokens.accentYellow,
  },
  danger: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    color: tokens.accentRed,
  },
});

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  /** Consumer overrides, as StyleX styles rather than a className — the atomic
   * classes are generated, so a string could not win the cascade predictably. */
  style?: StyleXStyles;
}

export function Badge({ children, variant = "neutral", style }: BadgeProps) {
  return <span {...stylex.props(base.badge, variants[variant], style)}>{children}</span>;
}
