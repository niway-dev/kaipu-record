import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { ReactNode } from "react";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * A bordered surface. Deliberately nothing more: no padding, no header, no
 * sections. Every one of its callers lays out its own contents, and the desktop
 * version it replaces was the same four declarations.
 *
 * `overflow: hidden` is load-bearing rather than tidiness — it is what keeps a
 * child's square corners from poking through the rounded border.
 */
const styles = stylex.create({
  card: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.bgCard,
    overflow: "hidden",
  },
});

export interface CardProps {
  children: ReactNode;
  /** Consumer overrides, as StyleX styles rather than a className. */
  style?: StyleXStyles;
}

export function Card({ children, style }: CardProps) {
  return <div {...stylex.props(styles.card, style)}>{children}</div>;
}
