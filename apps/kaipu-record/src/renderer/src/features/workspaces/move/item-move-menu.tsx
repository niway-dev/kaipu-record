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
          if (rect) {
            const below = rect.bottom + 6;
            const right = Math.max(8, window.innerWidth - rect.right);
            setPlace(
              below + 260 > window.innerHeight
                ? {
                    position: "fixed",
                    bottom: window.innerHeight - rect.top + 6,
                    right,
                    top: "auto",
                  }
                : { position: "fixed", top: below, right },
            );
          }
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
