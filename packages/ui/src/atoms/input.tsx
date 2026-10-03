import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { InputHTMLAttributes } from "react";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * A text field, optionally with its label above it. Migrated value for value
 * from the desktop's ui/input.module.css.
 *
 * The label is rendered here rather than left to each caller because the
 * `htmlFor`/`id` pairing is the part people forget, and forgetting it produces
 * a field no screen reader can announce — a bug that looks like nothing.
 */
const styles = stylex.create({
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spaceXs,
  },
  label: {
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightMedium,
    color: tokens.textSecondary,
  },
  input: {
    paddingBlock: "8px",
    paddingInline: "12px",
    backgroundColor: tokens.bgInput,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusSm,
    color: tokens.textPrimary,
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizeBase,
    transitionProperty: "border-color",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
    "::placeholder": {
      color: tokens.textMuted,
    },
    outline: {
      default: null,
      ":focus-visible": "none",
    },
  },
  // Hover and focus are separate layers for the same reason the Button's are:
  // the CSS guarded hover with `:not(:disabled)`, and expressing that inline
  // would leave the result to the compiler's pseudo-class ordering.
  enabled: {
    borderColor: {
      default: tokens.border,
      ":hover": tokens.borderLight,
      ":focus-visible": tokens.accentPrimary,
    },
  },
  disabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
});

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "style"> {
  label?: string;
  /** Consumer overrides, as StyleX styles rather than a className. */
  style?: StyleXStyles;
}

export function Input({ label, id, disabled = false, style, ...props }: InputProps) {
  const field = (
    <input
      id={id}
      disabled={disabled}
      {...props}
      {...stylex.props(
        styles.input,
        !disabled && styles.enabled,
        disabled && styles.disabled,
        style,
      )}
    />
  );

  if (!label) return field;

  return (
    <div {...stylex.props(styles.wrapper)}>
      <label htmlFor={id} {...stylex.props(styles.label)}>
        {label}
      </label>
      {field}
    </div>
  );
}
