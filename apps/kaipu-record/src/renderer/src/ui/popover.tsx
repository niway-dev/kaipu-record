import React, { useState, useRef, useEffect } from "react";
import styles from "./popover.module.css";

export interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
}

export function Popover({ trigger, children, align = "left" }: PopoverProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleScroll = () => setOpen(false);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  const handleToggle = () => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setCoords({ top: rect.top, left: rect.left, right: window.innerWidth - rect.right });
    }
    setOpen((prev) => !prev);
  };

  const contentStyle: React.CSSProperties = {
    position: "fixed",
    bottom: `calc(100vh - ${coords.top}px + 8px)`,
    ...(align === "right" ? { right: coords.right } : { left: coords.left }),
  };

  return (
    <div className={styles.wrapper} ref={ref}>
      <div onClick={handleToggle} className={styles.trigger}>
        {trigger}
      </div>
      {open && (
        <div className={styles.content} style={contentStyle}>
          {children}
        </div>
      )}
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
    <button
      className={`${styles.item} ${danger ? styles.danger : ""}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
