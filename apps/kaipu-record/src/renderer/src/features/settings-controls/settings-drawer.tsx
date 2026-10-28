import React, { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import styles from "./settings-drawer.module.css";

/** `panel`: the capture panel's compact drawer. `page`: the Record page's wide one. */
export type SettingsDrawerVariant = "panel" | "page";

export interface SettingsDrawerProps {
  id: string;
  label: string;
  open: boolean;
  variant?: SettingsDrawerVariant;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  children: ReactNode;
}

/**
 * The Mic, Audio and Camera settings, in the layout flow right under the tile row. Used by the
 * capture panel and the Record page for the same reason: a floating popover is clipped at the
 * window's edge (and the panel hides when it loses focus), while content in flow pushes what
 * is below it and the container scrolls or grows (the panel's ResizeObserver resizes its
 * window). Focus never leaves the window. Esc or the chevron closes it.
 */
export function SettingsDrawer({
  id,
  label,
  open,
  variant = "panel",
  onKeyDown,
  children,
}: SettingsDrawerProps): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  // On the Record page a drawer opened low in the window would start below the fold: bring
  // it into view. The panel grows its own window instead, so it never needs this.
  useEffect(() => {
    if (open && variant === "page") ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [open, variant]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      id={id}
      role="region"
      aria-label={label}
      className={styles.drawer}
      data-variant={variant}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
