import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * The labeled navigation rail: a brand mark up top, icon + mono-label items
 * whose active state is a soft accent pill with an indicator bar on the rail's
 * edge, and an optional account item pinned to the footer.
 *
 * The rail knows nothing about routing. Each item is handed to `renderLink`,
 * together with the className, style, title and children it must render, and
 * the caller returns whatever element fits its surface: the desktop returns a
 * router `NavLink`, a surface with no router returns a plain `<span>`. The
 * active flag is part of the item, computed by the caller, so the rail never
 * has to ask a router anything.
 *
 * It lives in `molecules/` because its items are composed from caller-supplied
 * elements rather than being a leaf.
 */
const styles = stylex.create({
  rail: {
    boxSizing: "border-box",
    width: "72px",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    flexShrink: 0,
    overflow: "hidden",
    backgroundColor: tokens.bgSidebar,
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: tokens.border,
  },
  brand: {
    flexShrink: 0,
    // Taller than a nav item: the mark needs air around it at 40px, and the
    // extra row height is what stops it reading as just another item.
    height: "64px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: tokens.accentPrimary,
  },
  sections: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    overflowY: "auto",
    paddingBlock: tokens.spaceSm,
    paddingInline: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spaceXs,
    alignItems: "center",
    width: "100%",
  },
  item: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "5px",
    width: "56px",
    paddingBlock: "9px",
    paddingInline: 0,
    borderRadius: "11px",
    backgroundColor: { default: "transparent", ":hover": tokens.bgCardHover },
    color: { default: tokens.textMuted, ":hover": tokens.textSecondary },
    textDecoration: "none",
    cursor: "pointer",
    transitionProperty: "background-color, color",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
  },
  // Listed after `item`, so it replaces the hover colours as well: an active
  // item does not change on hover.
  itemActive: {
    backgroundColor: "rgba(246, 5, 92, 0.12)",
    color: tokens.accentPrimary,
  },
  label: {
    fontFamily: tokens.fontMono,
    fontSize: "9px",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  // The indicator bar on the rail's left edge, visible only while active.
  bar: {
    position: "absolute",
    left: "-8px",
    top: "50%",
    transform: "translateY(-50%) scaleY(0)",
    width: "3px",
    height: "26px",
    borderRadius: "0 3px 3px 0",
    backgroundColor: tokens.accentPrimary,
    transitionProperty: "transform",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
  },
  barActive: {
    transform: "translateY(-50%) scaleY(1)",
  },
  footer: {
    flexShrink: 0,
    paddingTop: tokens.spaceSm,
    paddingBottom: tokens.spaceMd,
    paddingInline: 0,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spaceSm,
    width: "100%",
  },
  avatar: {
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    backgroundColor: tokens.bgCard,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: tokens.border, ":hover": tokens.accentPrimary },
    color: { default: tokens.textSecondary, ":hover": tokens.textPrimary },
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transitionProperty: "border-color, color",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
  },
});

export interface RailItem {
  /** Stable key for the item. */
  id: string;
  /** Already translated; also used as the link's title. */
  label: string;
  /** Sized by the caller. */
  icon: ReactNode;
  /** Computed by the caller, since only it knows the current location. */
  active?: boolean;
}

/** What `renderLink` must spread onto the element it returns. */
export interface RailLinkProps {
  className?: string;
  style?: CSSProperties;
  title: string;
  "aria-label"?: string;
  "aria-current"?: "page";
  children: ReactNode;
}

export interface RailProps<T extends RailItem = RailItem> {
  /** The mark at the top, sized by the caller. */
  brand: ReactNode;
  brandTitle?: string;
  items: readonly T[];
  /**
   * Turns an item into a link element. Spread `props` onto it, e.g.
   * `(item, props) => <NavLink to={item.to} {...props} />`.
   */
  renderLink: (item: T, props: RailLinkProps) => ReactNode;
  /** An item pinned to the footer, drawn as a round avatar. */
  account?: T;
  /** Consumer overrides, as StyleX styles rather than a className. */
  style?: StyleXStyles;
}

export function Rail<T extends RailItem = RailItem>({
  brand,
  brandTitle,
  items,
  renderLink,
  account,
  style,
}: RailProps<T>) {
  return (
    <nav {...stylex.props(styles.rail, style)}>
      <div title={brandTitle} {...stylex.props(styles.brand)}>
        {brand}
      </div>

      <div {...stylex.props(styles.sections)}>
        {items.map((item) => {
          const { className, style: inline } = stylex.props(
            styles.item,
            item.active && styles.itemActive,
          );
          return (
            <Fragment key={item.id}>
              {renderLink(item, {
                className,
                style: inline,
                title: item.label,
                "aria-current": item.active ? "page" : undefined,
                children: (
                  <>
                    <span
                      aria-hidden
                      {...stylex.props(styles.bar, item.active && styles.barActive)}
                    />
                    {item.icon}
                    <span {...stylex.props(styles.label)}>{item.label}</span>
                  </>
                ),
              })}
            </Fragment>
          );
        })}
      </div>

      {account ? (
        <div {...stylex.props(styles.footer)}>
          {renderLink(account, {
            ...stylex.props(styles.avatar),
            title: account.label,
            "aria-label": account.label,
            "aria-current": account.active ? "page" : undefined,
            children: account.icon,
          })}
        </div>
      ) : null}
    </nav>
  );
}
