import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { ReactNode } from "react";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * The start/stop button of the recorder. Base = the "full" Record page layout;
 * `compact` is the Capture Panel's.
 *
 * Presentational only: the label arrives as a prop, already translated, and the
 * recording state is a boolean the caller derived. The disabled rule stays here
 * because it is part of how the button looks and behaves — a button that is
 * recording is never disabled, since stopping must always be possible.
 *
 * The order of the style list below is the old stylesheet's cascade: the
 * compact border colour beat the base one, but the disabled and recording
 * states beat the compact one. Hover is applied from script rather than as a
 * `:hover:not(:disabled)` pseudo-class, because a disabled button must not
 * brighten and StyleX has no way to say "not disabled" in a condition.
 */
const styles = stylex.create({
  button: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    marginTop: tokens.spaceSm,
    paddingBlock: "16px",
    paddingInline: "20px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.accentPrimary,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.accentPrimary,
    boxShadow: tokens.glowAccent,
    color: "#fff",
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: "-0.2px",
    appearance: "none",
    cursor: "pointer",
    transitionProperty: "filter, box-shadow",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
  },
  hover: {
    filter: { default: null, ":hover": "brightness(1.08)" },
  },
  // The Capture Panel's variant: smaller, no top margin, pinned shortcut.
  compact: {
    marginTop: 0,
    paddingBlock: "10px",
    paddingInline: "12px",
    borderColor: "rgba(246, 5, 92, 0.36)",
    borderRadius: tokens.radiusSm,
    fontSize: "13px",
    justifyContent: "center",
  },
  disabled: {
    backgroundColor: tokens.bgInput,
    borderColor: tokens.border,
    boxShadow: "none",
    cursor: "not-allowed",
  },
  // The recording state is a dark fill, not the accent — no glow.
  recording: {
    backgroundColor: "#2a0010",
    borderColor: "rgba(246, 5, 92, 0.36)",
    boxShadow: "none",
  },
  label: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  shortcut: {
    position: "absolute",
    right: "20px",
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    fontFamily: tokens.fontMono,
    fontSize: "11px",
    fontWeight: tokens.fontWeightNormal,
    letterSpacing: 0,
    opacity: 0.45,
  },
  shortcutCompact: {
    right: "12px",
    fontSize: "10px",
    opacity: 0.5,
  },
});

export interface RecordButtonProps {
  isRecording: boolean;
  /** Ignored while recording: the stop button is always live. */
  disabled?: boolean;
  /** The already-translated label for the current state. */
  children: ReactNode;
  /** Shown only while idle. */
  shortcut?: string;
  variant?: "full" | "compact";
  onClick: () => void;
  /** Consumer overrides, as StyleX styles rather than a className. */
  style?: StyleXStyles;
}

export function RecordButton({
  isRecording,
  disabled = false,
  children,
  shortcut,
  variant = "full",
  onClick,
  style,
}: RecordButtonProps) {
  const compact = variant === "compact";
  const inert = disabled && !isRecording;
  return (
    <button
      type="button"
      data-recording={isRecording || undefined}
      disabled={inert}
      onClick={onClick}
      {...stylex.props(
        styles.button,
        !inert && styles.hover,
        compact && styles.compact,
        inert && styles.disabled,
        isRecording && styles.recording,
        style,
      )}
    >
      <span {...stylex.props(styles.label)}>
        <span>{isRecording ? "■" : "●"}</span>
        {children}
      </span>
      {!isRecording && shortcut ? (
        <kbd {...stylex.props(styles.shortcut, compact && styles.shortcutCompact)}>{shortcut}</kbd>
      ) : null}
    </button>
  );
}
