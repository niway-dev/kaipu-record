import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import { StatusToggle } from "../atoms/status-toggle";
import { Fragment, type ReactNode } from "react";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * A row of `StatusToggle` tiles sharing the width. It composes the atom, which
 * is what puts it in `molecules/`. The compact variant tightens the gap and is
 * passed down to every tile so the two cannot disagree.
 */
const styles = stylex.create({
  row: {
    display: "flex",
    gap: tokens.spaceSm,
  },
  compact: { gap: "5px" },
});

export interface StatusToggleItem {
  id: string;
  icon: ReactNode;
  /** Shown only in the full variant. */
  label: string;
  isActive: boolean;
  onToggle: () => void;
  /** Not clickable; reads as dimmed. */
  disabled?: boolean;
  /** Native tooltip, e.g. why the tile is disabled. */
  title?: string;
  /**
   * Renders this element in the tile's place, sharing the row like a tile does. For a
   * consumer that needs more than a toggle in one slot (the desktop's camera tile, split
   * into a toggle and a settings chevron); the other fields are then ignored.
   */
  element?: ReactNode;
}

export interface StatusToggleRowProps {
  items: StatusToggleItem[];
  variant?: "full" | "compact";
  onText?: string;
  offText?: string;
  /** Consumer overrides, as StyleX styles rather than a className. */
  style?: StyleXStyles;
}

export function StatusToggleRow({
  items,
  variant = "full",
  onText,
  offText,
  style,
}: StatusToggleRowProps) {
  const compact = variant === "compact";
  return (
    <div {...stylex.props(styles.row, compact && styles.compact, style)}>
      {items.map((item) =>
        item.element !== undefined ? (
          <Fragment key={item.id}>{item.element}</Fragment>
        ) : (
          <StatusToggle
            key={item.id}
            icon={item.icon}
            label={compact ? undefined : item.label}
            isActive={item.isActive}
            compact={compact}
            onText={onText}
            offText={offText}
            onToggle={item.onToggle}
            disabled={item.disabled}
            title={item.title}
          />
        ),
      )}
    </div>
  );
}
