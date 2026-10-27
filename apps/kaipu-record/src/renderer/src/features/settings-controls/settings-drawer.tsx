import React, { type KeyboardEvent, type ReactNode } from "react";
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
  if (!open) return null;
  return (
    <div
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
