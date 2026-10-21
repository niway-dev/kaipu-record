import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { InputHTMLAttributes, ReactNode } from "react";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * A search field with room for a leading icon. The whole thing is a `<label>`,
 * so a click anywhere focuses the input without needing an id — which is why
 * the icon is positioned over padded text rather than laid out beside it.
 *
 * The icon arrives as a prop and is not imported here, for the same reason
 * ADR 0009 keeps routers and translations out: the two surfaces hold
 * incompatible major versions of `lucide-react` (the desktop ^1.18, the web
 * ^0.525), so a component that imported its own icon could only ever work on
 * one of them.
 *
 * `onSearch` is a convenience over `onChange` that hands back the value rather
 * than the event; both fire, `onChange` first.
 */
const styles = stylex.create({
  wrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    width: "100%",
  },
  icon: {
    position: "absolute",
    left: "11px",
    display: "inline-flex",
    color: tokens.textMuted,
    pointerEvents: "none",
  },
  input: {
    width: "100%",
    paddingBlock: "8px",
    paddingInlineEnd: "12px",
    backgroundColor: tokens.bgInput,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: tokens.border,
      ":hover": tokens.borderLight,
      ":focus-visible": tokens.accentPrimary,
    },
    borderRadius: tokens.radiusMd,
    color: tokens.textPrimary,
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizeSm,
    outline: {
      default: null,
      ":focus-visible": "none",
    },
    transitionProperty: "border-color",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
    "::placeholder": {
      color: tokens.textMuted,
    },
  },
  // The icon's lane, reserved only when there is an icon to put in it.
  withIcon: { paddingInlineStart: "32px" },
  withoutIcon: { paddingInlineStart: "12px" },
});

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "style"
> {
  /** Rendered in the field's leading slot. Each surface passes its own icon
   * library's element — see the note above on why this is not imported here. */
  icon?: ReactNode;
  onSearch?: (value: string) => void;
  /** Consumer overrides for the wrapper, as StyleX styles rather than a className. */
  style?: StyleXStyles;
}

export function SearchInput({ icon, onSearch, onChange, style, ...props }: SearchInputProps) {
  return (
    <label {...stylex.props(styles.wrapper, style)}>
      {icon ? (
        <span aria-hidden {...stylex.props(styles.icon)}>
          {icon}
        </span>
      ) : null}
      <input
        type="text"
        onChange={(event) => {
          onChange?.(event);
          onSearch?.(event.target.value);
        }}
        {...props}
        {...stylex.props(styles.input, icon ? styles.withIcon : styles.withoutIcon)}
      />
    </label>
  );
}
