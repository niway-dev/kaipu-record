import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { ReactNode } from "react";

/**
 * The parts that fill the source picker's content area: the tile grid, a tile,
 * its thumbnail (an image or a fallback icon), and the two non-grid states — a
 * message and a spinner. Each one imports no other component and holds no
 * state, so they are atoms; `SourcePicker` is the molecule that frames them.
 *
 * A tile does not know what a source is. It takes a thumbnail node and a label,
 * so the picker can be fed screens and windows — or anything else with a name
 * and a picture — without this file learning the desktop's types. Whether a
 * thumbnail loaded, and what to show when it did not, is the caller's call:
 * `SourceThumbImage` and `SourceThumbFallback` are the two things it can pass.
 */
const spin = stylex.keyframes({
  to: { transform: "rotate(360deg)" },
});

const styles = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "12px",
  },
  tile: {
    position: "relative",
    aspectRatio: "16 / 10",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: tokens.border,
      ":hover": "rgba(246, 5, 92, 0.4)",
    },
    borderRadius: tokens.radiusMd,
    backgroundColor: "#101013",
    cursor: "pointer",
    transitionProperty: "border-color",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
  },
  // The selected tile keeps the accent border even under the pointer.
  tileActive: { borderColor: tokens.accentPrimary },
  image: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  fallback: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    color: tokens.textSecondary,
    backgroundImage:
      "repeating-linear-gradient(45deg, #101013, #101013 10px, #131316 10px, #131316 20px)",
  },
  tileLabel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: "8px",
    backgroundImage: "linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent)",
  },
  tileLabelText: {
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    fontSize: tokens.fontSizeSm,
    color: "#fff",
  },
  message: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spaceMd,
    minHeight: "200px",
    fontSize: tokens.fontSizeBase,
    color: tokens.textSecondary,
  },
  loader: {
    width: "28px",
    height: "28px",
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: tokens.border,
    borderTopColor: tokens.accentPrimary,
    borderRadius: "50%",
    animationName: spin,
    animationDuration: "0.8s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});

export function SourceGrid({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.grid)}>{children}</div>;
}

export interface SourceTileProps {
  /** Usually a `SourceThumbImage` or a `SourceThumbFallback`. */
  thumbnail: ReactNode;
  label: string;
  isActive?: boolean;
  onSelect: () => void;
}

export function SourceTile({ thumbnail, label, isActive = false, onSelect }: SourceTileProps) {
  return (
    <div
      data-active={isActive || undefined}
      onClick={onSelect}
      {...stylex.props(styles.tile, isActive && styles.tileActive)}
    >
      {thumbnail}
      <div {...stylex.props(styles.tileLabel)}>
        <div {...stylex.props(styles.tileLabelText)}>{label}</div>
      </div>
    </div>
  );
}

export function SourceThumbImage({
  src,
  alt,
  onError,
}: {
  src: string;
  alt: string;
  onError?: () => void;
}) {
  return <img src={src} alt={alt} onError={onError} {...stylex.props(styles.image)} />;
}

/** Shown when a thumbnail came back blank — a clean icon, not a broken image. */
export function SourceThumbFallback({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden {...stylex.props(styles.fallback)}>
      {children}
    </div>
  );
}

/** The picker's empty, error and permission states: one centered column. */
export function SourcePickerMessage({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.message)}>{children}</div>;
}

/** The picker's loading state: a spinner above its caption. */
export function SourcePickerLoading({ children }: { children: ReactNode }) {
  return (
    <div {...stylex.props(styles.message)}>
      <div {...stylex.props(styles.loader)} />
      {children}
    </div>
  );
}
