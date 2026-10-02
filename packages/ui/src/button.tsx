import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

/**
 * Experimental shared button: the first component styled once and consumed by
 * both the web app and the desktop renderer. Colors come from @kaipu/tokens'
 * CSS custom properties, so each surface's theme block keeps deciding the
 * actual values — StyleX owns the rules, the tokens own the palette.
 */
const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    borderRadius: "10px",
    borderStyle: "none",
    paddingBlock: "10px",
    paddingInline: "18px",
    fontSize: "14px",
    fontWeight: 600,
    lineHeight: "20px",
    cursor: "pointer",
    transitionProperty: "background-color, box-shadow, transform",
    transitionDuration: "150ms",
  },
  primary: {
    color: "#ffffff",
    backgroundColor: {
      default: "var(--kaipu-accent-primary)",
      ":hover": "var(--kaipu-accent-primary-hover)",
    },
    boxShadow: {
      default: "none",
      ":hover": "var(--kaipu-glow-accent)",
    },
  },
  ghost: {
    color: "var(--kaipu-text-primary)",
    backgroundColor: {
      default: "transparent",
      ":hover": "var(--kaipu-bg-card-hover)",
    },
    boxShadow: `inset 0 0 0 1px var(--kaipu-border-light)`,
  },
});

export interface KaipuButtonProps {
  children: ReactNode;
  variant?: "primary" | "ghost";
  onClick?: () => void;
  type?: "button" | "submit";
}

export function KaipuButton({
  children,
  variant = "primary",
  onClick,
  type = "button",
}: KaipuButtonProps) {
  return (
    <button type={type} onClick={onClick} {...stylex.props(styles.base, styles[variant])}>
      {children}
    </button>
  );
}
