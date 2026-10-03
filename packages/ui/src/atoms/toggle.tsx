import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * An on/off switch. The desktop's version wrapped `@radix-ui/react-switch`;
 * this one is a plain `<button role="switch">`, which is what that primitive
 * renders anyway.
 *
 * Dropping the dependency is the point. The web surface is built on
 * `@base-ui/react`, not Radix, so a shared component carrying Radix would pull
 * a second headless library into whichever surface did not have it. A switch is
 * the one primitive where that trade is clearly bad: the native button already
 * gives keyboard activation and focus, and `role="switch"` plus `aria-checked`
 * is the entire accessibility contract. (Select is the opposite case — there
 * Radix earns its keep with typeahead, collision-aware positioning and a
 * portal, which is why it stays where it is for now.)
 */
const styles = stylex.create({
  track: {
    position: "relative",
    flexShrink: 0,
    width: "36px",
    height: "20px",
    padding: 0,
    borderStyle: "none",
    borderRadius: "10px",
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
    outline: {
      default: "none",
      ":focus-visible": "none",
    },
    boxShadow: {
      default: "none",
      // The focus ring is the accent at 40% alpha — no token covers it, same as
      // the Button's soft hover.
      ":focus-visible": "0 0 0 2px rgba(246, 5, 92, 0.4)",
    },
  },
  off: { backgroundColor: tokens.border },
  on: { backgroundColor: tokens.accentPrimary },
  disabled: {
    opacity: 0.45,
    cursor: "not-allowed",
    pointerEvents: "none",
  },
  thumb: {
    display: "block",
    position: "absolute",
    top: "2px",
    left: "2px",
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    backgroundColor: "#fff",
    transitionProperty: "transform",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
    willChange: "transform",
  },
  thumbOn: { transform: "translateX(16px)" },
});

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  /** Labels it when no visible `<label>` points at it. */
  "aria-label"?: string;
  /** Consumer overrides, as StyleX styles rather than a className. */
  style?: StyleXStyles;
}

export function Toggle({ checked, onChange, disabled = false, id, style, ...aria }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...aria}
      {...stylex.props(
        styles.track,
        checked ? styles.on : styles.off,
        disabled && styles.disabled,
        style,
      )}
    >
      <span {...stylex.props(styles.thumb, checked && styles.thumbOn)} />
    </button>
  );
}
