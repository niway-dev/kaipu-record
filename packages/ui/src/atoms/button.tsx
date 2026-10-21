import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * The product's button, shared by the desktop renderer and the web.
 *
 * It is an atom by this package's rule: it imports no other component here, it
 * holds no state, and it knows nothing about routing, translation or IPC. Every
 * label is passed in — the two surfaces name the same string differently
 * (`record.startRecordingBtn` on the desktop, `landing.homeAppStart` on the
 * landing), so a component that translated for itself would have to break one
 * of them.
 *
 * Variants and sizes are the desktop's, migrated value for value from
 * ui/button.module.css: styles move systems, pixels stay.
 */

type ButtonVariant = "primary" | "danger" | "ghost" | "outline";
type ButtonSize = "sm" | "default" | "lg";

const base = stylex.create({
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spaceSm,
    fontFamily: tokens.fontFamily,
    fontWeight: tokens.fontWeightMedium,
    whiteSpace: "nowrap",
    userSelect: "none",
    cursor: "pointer",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: tokens.radiusMd,
    // The `transition` token is the CSS shorthand "150ms ease", which no
    // longhand can take; it is split here until the token layer carries the
    // duration and the easing apart.
    transitionProperty: "background-color, border-color, color, box-shadow, opacity",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
  },
  disabled: {
    opacity: 0.45,
    cursor: "not-allowed",
    boxShadow: "none",
  },
});

const sizes = stylex.create({
  sm: { height: "28px", paddingInline: "10px", fontSize: tokens.fontSizeSm },
  default: { height: "34px", paddingInline: "14px", fontSize: tokens.fontSizeBase },
  lg: { height: "40px", paddingInline: "20px", fontSize: tokens.fontSizeMd },
});

const variants = stylex.create({
  primary: {
    backgroundColor: tokens.accentPrimary,
    color: "#fff",
    boxShadow: tokens.glowAccent,
  },
  danger: {
    backgroundColor: tokens.accentRed,
    color: "#fff",
  },
  ghost: {
    backgroundColor: "transparent",
    color: tokens.accentPrimary,
  },
  outline: {
    backgroundColor: "transparent",
    borderColor: tokens.accentPrimary,
    color: tokens.accentPrimary,
  },
});

/**
 * Hover is a separate layer applied only while the button is enabled, rather
 * than a `:hover` nested inside each variant. The CSS this replaces guarded
 * every hover with `:not(:disabled)`, and expressing that as one declaration
 * would leave the outcome to the compiler's pseudo-class ordering instead of
 * to something readable here.
 *
 * Each `default` repeats the variant's own background, and must. A later style
 * that names a property replaces it whole, so `default: null` does not mean
 * "leave the variant's value alone" — it erases it. That shipped once: every
 * enabled button lost its fill and rendered the browser's white, keeping only
 * the accent glow, while disabled buttons (no hover layer) looked right.
 */
const hovers = stylex.create({
  primary: {
    backgroundColor: { default: tokens.accentPrimary, ":hover": tokens.accentPrimaryHover },
  },
  danger: { backgroundColor: { default: tokens.accentRed, ":hover": tokens.accentRedHover } },
  ghost: { backgroundColor: { default: "transparent", ":hover": tokens.accentPrimarySoft } },
  outline: { backgroundColor: { default: "transparent", ":hover": tokens.accentPrimarySoft } },
});

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Consumer overrides. StyleX styles, not a className — the atomic classes
   * are generated, so a string could never win the cascade predictably. */
  style?: StyleXStyles;
}

export function Button({
  children,
  variant = "primary",
  size = "default",
  disabled = false,
  // A bare <button> inside a form submits it. The only form that uses this
  // primitive passes type="submit" itself, so defaulting to "button" costs
  // nothing and stops the next form from submitting by accident.
  type = "button",
  style,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      {...props}
      {...stylex.props(
        base.button,
        sizes[size],
        variants[variant],
        !disabled && hovers[variant],
        disabled && base.disabled,
        style,
      )}
    >
      {children}
    </button>
  );
}
