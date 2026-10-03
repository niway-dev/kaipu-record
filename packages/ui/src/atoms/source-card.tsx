import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { ReactNode } from "react";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * The selected-source summary: an icon, a name with a small caption, and either
 * an action button or a LOCKED badge while the source cannot change.
 *
 * Icons and words arrive as props. The two icons are separate props because the
 * summary icon and the lock glyph come from the surface's own icon library.
 *
 * In the compact layout the action button has no hover colours. That is the old
 * stylesheet's behavior, kept as it was: `.compact .button` out-ranked
 * `.button:hover`, so the hover never showed there.
 */
const styles = stylex.create({
  card: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    paddingBlock: "12px",
    paddingInline: "14px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.bgCard,
  },
  cardCompact: {
    gap: "8px",
    paddingBlock: "8px",
    paddingInline: "10px",
    borderRadius: tokens.radiusSm,
    backgroundColor: tokens.bgInput,
  },
  icon: {
    display: "inline-flex",
    flexShrink: 0,
    color: tokens.textSecondary,
  },
  iconCompact: { color: tokens.textMuted },
  info: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  infoCompact: { gap: "1px" },
  name: {
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.textPrimary,
  },
  nameCompact: {
    fontSize: "12px",
    fontWeight: tokens.fontWeightMedium,
  },
  meta: {
    fontFamily: tokens.fontMono,
    fontSize: "10px",
    letterSpacing: "0.6px",
    textTransform: "uppercase",
    color: tokens.textMuted,
  },
  metaCompact: {
    fontSize: "9px",
    letterSpacing: "0.3px",
  },
  action: {
    flexShrink: 0,
    paddingBlock: "5px",
    paddingInline: "12px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.borderLight,
    borderRadius: tokens.radiusSm,
    backgroundColor: "transparent",
    color: tokens.textSecondary,
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizeSm,
    cursor: "pointer",
    transitionProperty: "border-color, color",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
  },
  actionHover: {
    borderColor: { default: null, ":hover": tokens.textMuted },
    color: { default: null, ":hover": tokens.textPrimary },
  },
  actionCompact: {
    paddingBlock: "2px",
    paddingInline: "7px",
    borderColor: tokens.border,
    color: tokens.textMuted,
    fontFamily: tokens.fontMono,
    fontSize: "10px",
    letterSpacing: "0.3px",
    textTransform: "uppercase",
  },
  locked: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    flexShrink: 0,
    paddingBlock: "4px",
    paddingInline: "9px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusSm,
    color: tokens.textMuted,
    fontFamily: tokens.fontMono,
    fontSize: "10px",
    letterSpacing: "0.5px",
    textTransform: "uppercase",
  },
});

export interface SourceCardProps {
  /** The leading icon, sized by the caller. */
  icon: ReactNode;
  name: string;
  /** The small caption under the name. */
  meta: string;
  /** The action's label, already translated. Ignored while `locked`. */
  actionLabel: string;
  onAction: () => void;
  /** While true the action is replaced by a badge built from the two props below. */
  locked?: boolean;
  lockedIcon?: ReactNode;
  lockedLabel?: string;
  variant?: "full" | "compact";
  /** Consumer overrides, as StyleX styles rather than a className. */
  style?: StyleXStyles;
}

export function SourceCard({
  icon,
  name,
  meta,
  actionLabel,
  onAction,
  locked = false,
  lockedIcon,
  lockedLabel,
  variant = "full",
  style,
}: SourceCardProps) {
  const compact = variant === "compact";
  return (
    <div {...stylex.props(styles.card, compact && styles.cardCompact, style)}>
      <span {...stylex.props(styles.icon, compact && styles.iconCompact)}>{icon}</span>
      <div {...stylex.props(styles.info, compact && styles.infoCompact)}>
        <span {...stylex.props(styles.name, compact && styles.nameCompact)}>{name}</span>
        <span {...stylex.props(styles.meta, compact && styles.metaCompact)}>{meta}</span>
      </div>
      {locked ? (
        <span {...stylex.props(styles.locked)}>
          {lockedIcon}
          {lockedLabel}
        </span>
      ) : (
        <button
          type="button"
          onClick={onAction}
          {...stylex.props(styles.action, compact ? styles.actionCompact : styles.actionHover)}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
