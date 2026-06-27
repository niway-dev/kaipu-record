import React, { useState, useRef, useEffect } from "react";
import styles from "./popover.module.css";

export interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
}

export function Popover({ trigger, children, align = "left" }: PopoverProps): React.JSX.Element {
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

  const placement: React.CSSProperties = {
    position: "fixed",
    bottom: `calc(100vh - ${anchor.top}px + 8px)`,
    ...(align === "right" ? { right: anchor.right } : { left: anchor.left }),
  };

  return (
    <div className={styles.wrapper} ref={ref}>
      <div className={styles.trigger} onClick={toggle}>
        {trigger}
      </div>
      {open ? (
        <div className={styles.content} style={placement}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface PopoverItemProps {
  onClick?: () => void;
  children: React.ReactNode;
  danger?: boolean;
}

export function PopoverItem({ onClick, children, danger }: PopoverItemProps): React.JSX.Element {
  return (
    <button type="button" className={styles.item} data-danger={danger} onClick={onClick}>
      {children}
    </button>
  );
}
