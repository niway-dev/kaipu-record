import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { CSSProperties, ReactNode } from "react";

/**
 * A click-triggered menu anchored above its trigger. A molecule: it owns open
 * state and dismissal, and its items compose into it.
 *
 * It measures the trigger on open and positions itself `fixed` from those
 * coordinates, rather than `absolute` inside the wrapper. That is what lets it
 * escape an ancestor's `overflow: hidden` without a portal — and keeping it out
 * of a portal is what lets a theme class on an ancestor still reach it.
 *
 * Dismissal listens on the document for a pointer outside, and closes on any
 * scroll: the anchor was measured once, so a scrolled page would leave the menu
 * floating where the trigger used to be.
 */
const styles = stylex.create({
  wrapper: {
    position: "relative",
    display: "block",
  },
  trigger: {
    cursor: "pointer",
  },
  content: {
    zIndex: 1000,
    minWidth: "180px",
    paddingBlock: tokens.spaceXs,
    paddingInline: 0,
    backgroundColor: tokens.bgCard,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spaceSm,
    width: "100%",
    paddingBlock: tokens.spaceSm,
    paddingInline: tokens.spaceMd,
    borderStyle: "none",
    textAlign: "left",
    cursor: "pointer",
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizeSm,
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.bgCardHover,
    },
    transitionProperty: "background-color",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
  },
  itemDefault: { color: tokens.textPrimary },
  itemDanger: { color: tokens.accentRed },
});

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
}

export function Popover({ trigger, children, align = "left" }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onScroll = (): void => setOpen(false);
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = (): void => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setAnchor({ top: rect.top, left: rect.left, right: window.innerWidth - rect.right });
    }
    setOpen((prev) => !prev);
  };

  // Coordinates are measured per open, so they stay an inline style — a
  // compile-time styling system has nothing to offer a value only the browser
  // knows.
  const placement: CSSProperties = {
    position: "fixed",
    bottom: `calc(100vh - ${anchor.top}px + 8px)`,
    ...(align === "right" ? { right: anchor.right } : { left: anchor.left }),
  };

  return (
    <div ref={ref} {...stylex.props(styles.wrapper)}>
      <div onClick={toggle} {...stylex.props(styles.trigger)}>
        {trigger}
      </div>
      {open ? (
        <div style={placement} {...stylex.props(styles.content)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface PopoverItemProps {
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}

export function PopoverItem({ children, onClick, danger = false }: PopoverItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...stylex.props(styles.item, danger ? styles.itemDanger : styles.itemDefault)}
    >
      {children}
    </button>
  );
}
