import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useOptionalWorkspaces } from "../workspaces-context";
import { notMovableReason, type MovableItem } from "./move-flow";
import { MoveTargetList, useMoveLock } from "./move-target-list";
import styles from "./move.module.css";

/**
 * A Library card's or row's "⋯" menu (spec decision 13): "Move to ▸" with the other
 * workspaces and what a move there costs. Disabled, with the reason, for an item that cannot
 * move (cloud-only, or a record that cannot be read).
 */
/** The menu's width in `move.module.css` (`.menu`). */
const MENU_WIDTH = 300;
/** Room the menu needs below the button before it opens above instead. */
const MENU_HEIGHT = 260;
/** The gap kept between the menu and the window's edges. */
const EDGE = 8;

/**
 * Where the menu goes, in window coordinates: below the button (above it near the bottom),
 * its right edge on the button's right edge, but never past either side of the window. A card
 * in the first column puts the button near the left edge, where a right-aligned 300 px menu
 * would start off-screen.
 */
export function placeItemMenu(
  button: Pick<DOMRect, "top" | "bottom" | "right">,
  viewportWidth: number,
  viewportHeight: number,
): React.CSSProperties {
  const left = Math.max(
    EDGE,
    Math.min(button.right - MENU_WIDTH, viewportWidth - MENU_WIDTH - EDGE),
  );
  const below = button.bottom + 6;
  return below + MENU_HEIGHT > viewportHeight
    ? {
        position: "fixed",
        bottom: viewportHeight - button.top + 6,
        left,
        right: "auto",
        top: "auto",
      }
    : { position: "fixed", top: below, left, right: "auto" };
}

export function ItemMoveMenu({
  item,
  onPick,
}: {
  item: MovableItem;
  onPick(target: string | "new"): void;
}): React.JSX.Element | null {
  const t = useTranslations("move");
  const workspaces = useOptionalWorkspaces();
  const lock = useMoveLock(workspaces?.state ?? null);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // A card clips its content (rounded poster): the menu is placed on the page, by the button.
  const [place, setPlace] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The menu is portaled to the end of the page: focus goes into it on open, and comes back
  // to the "⋯" button on close, so the keyboard does not have to tab through the page.
  useEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']:not(:disabled)")?.focus();
    return () => button?.focus();
  }, [open]);

  if (!workspaces?.state || !workspaces.active) return null;
  const blocked = notMovableReason(item);
  const why =
    blocked === "cloud"
      ? t("notMovableCloud")
      : blocked === "record"
        ? t("notMovableRecord")
        : blocked === "evicted"
          ? t("notMovableEvicted")
          : null;

  return (
    <div className={styles.itemMenuAnchor} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={styles.itemMenuButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("itemMenu")}
        title={why ?? t("itemMenu")}
        disabled={blocked !== null}
        ref={buttonRef}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setPlace(placeItemMenu(rect, window.innerWidth, window.innerHeight));
          setOpen(!open);
        }}
      >
        <MoreHorizontal size={14} strokeWidth={1.8} />
      </button>
      {open &&
        createPortal(
          <div onClick={(event) => event.stopPropagation()}>
            <div className={styles.backdrop} onClick={() => setOpen(false)} aria-hidden />
            <div
              ref={menuRef}
              className={styles.menu}
              data-align="end"
              role="menu"
              aria-label={t("moveTo")}
              style={place}
            >
              <MoveTargetList
                state={workspaces.state}
                active={workspaces.active}
                lock={lock}
                onPick={(target) => {
                  setOpen(false);
                  onPick(target);
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
