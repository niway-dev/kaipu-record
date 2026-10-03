import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { ReactNode } from "react";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * One tile of the recorder's input toggles: an icon, an optional label, and an
 * ON/OFF readout. Not the `Toggle` switch — this is a stacked tile that reads
 * as a status, and the two never shared markup.
 *
 * The icon and every word arrive as props, so the desktop can pass its own
 * icon library's elements and translated labels.
 */
const styles = stylex.create({
  tile: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    paddingTop: "14px",
    paddingInline: "8px",
    paddingBottom: "12px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.bgInput,
    color: tokens.textMuted,
    fontFamily: tokens.fontFamily,
    appearance: "none",
    cursor: "pointer",
    filter: { default: null, ":hover": "brightness(1.1)" },
    transitionProperty: "background-color, border-color",
    transitionDuration: "120ms",
    transitionTimingFunction: "ease",
  },
  tileCompact: {
    gap: "4px",
    paddingTop: "9px",
    paddingBottom: "9px",
    paddingInline: "4px",
    borderRadius: tokens.radiusSm,
  },
  tileActive: {
    backgroundColor: "rgba(246, 5, 92, 0.12)",
    borderColor: "rgba(246, 5, 92, 0.32)",
    color: tokens.accentPrimary,
  },
  icon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightMedium,
    color: tokens.textSecondary,
  },
  status: {
    fontFamily: tokens.fontMono,
    fontSize: "10px",
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: "0.8px",
    textTransform: "uppercase",
    color: "#3a3a3e",
  },
  statusCompact: { fontSize: "9px" },
  statusActive: { color: tokens.accentPrimary },
});

export interface StatusToggleProps {
  icon: ReactNode;
  /** Omit for the compact layout, which drops the text label. */
  label?: string;
  isActive: boolean;
  compact?: boolean;
  /** The readout words, already translated if the surface is. */
  onText?: string;
  offText?: string;
  onToggle: () => void;
  /** Consumer overrides, as StyleX styles rather than a className. */
  style?: StyleXStyles;
}

export function StatusToggle({
  icon,
  label,
  isActive,
  compact = false,
  onText = "ON",
  offText = "OFF",
  onToggle,
  style,
}: StatusToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-active={isActive || undefined}
      {...stylex.props(
        styles.tile,
        compact && styles.tileCompact,
        isActive && styles.tileActive,
        style,
      )}
    >
      <span {...stylex.props(styles.icon)}>{icon}</span>
      {label ? <span {...stylex.props(styles.label)}>{label}</span> : null}
      <span
        {...stylex.props(
          styles.status,
          compact && styles.statusCompact,
          isActive && styles.statusActive,
        )}
      >
        {isActive ? onText : offText}
      </span>
    </button>
  );
}
