import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { ReactNode } from "react";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * A settings-style row: optional icon, a label with optional description, and a
 * trailing action. Consecutive rows are separated by a hairline.
 *
 * That separator is the one thing that did not translate directly. The CSS used
 * `.row + .row { border-top }` — an adjacent-sibling selector, which StyleX
 * cannot express — so it becomes a top border on every row that is suppressed
 * on the first child. For rows that are consecutive siblings, which is the only
 * way they are ever used, the rendered result is identical.
 */
const styles = stylex.create({
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spaceMd,
    minHeight: "48px",
    paddingBlock: tokens.spaceMd,
    paddingInline: tokens.spaceLg,
    borderTopWidth: { default: "1px", ":first-child": 0 },
    borderTopStyle: { default: "solid", ":first-child": "none" },
    borderTopColor: tokens.border,
  },
  icon: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.bgCardHover,
    color: tokens.textSecondary,
  },
  info: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "1px",
  },
  label: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightMedium,
    color: tokens.textPrimary,
  },
  description: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizeSm,
    color: tokens.textSecondary,
  },
  action: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: tokens.spaceSm,
  },
});

export interface RowProps {
  label: string;
  icon?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Consumer overrides, as StyleX styles rather than a className. */
  style?: StyleXStyles;
  /** Overrides for the trailing action's container. */
  actionStyle?: StyleXStyles;
}

export function Row({ label, icon, description, action, style, actionStyle }: RowProps) {
  return (
    <div {...stylex.props(styles.row, style)}>
      {icon ? (
        <span aria-hidden {...stylex.props(styles.icon)}>
          {icon}
        </span>
      ) : null}
      <div {...stylex.props(styles.info)}>
        <span {...stylex.props(styles.label)}>{label}</span>
        {description ? <span {...stylex.props(styles.description)}>{description}</span> : null}
      </div>
      {action ? <div {...stylex.props(styles.action, actionStyle)}>{action}</div> : null}
    </div>
  );
}
