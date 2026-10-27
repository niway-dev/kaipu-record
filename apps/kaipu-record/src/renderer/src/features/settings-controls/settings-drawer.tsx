import React, { type KeyboardEvent, type ReactNode } from "react";
import styles from "./settings-drawer.module.css";

export interface SettingsDrawerProps {
  id: string;
  label: string;
  open: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  children: ReactNode;
}

/**
 * The capture panel's settings. The panel hides when it loses focus, so a popover (a second
 * layer, or a second window) is out: the chevron expands this drawer inline, the panel
 * grows downward (its ResizeObserver resizes the window) and focus never leaves the window.
 * Esc or the chevron closes it.
 */
export function SettingsDrawer({
  id,
  label,
  open,
  onKeyDown,
  children,
}: SettingsDrawerProps): React.JSX.Element | null {
  if (!open) return null;
  return (
    <div id={id} role="region" aria-label={label} className={styles.drawer} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
