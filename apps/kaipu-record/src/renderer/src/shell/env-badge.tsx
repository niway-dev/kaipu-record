import React from "react";
import { cx } from "@renderer/ui/cx";
import styles from "./env-badge.module.css";

export interface EnvBadgeProps {
  className?: string;
}

/**
 * "LOCAL ENV" chip, shown only while the app runs from `electron-vite dev`, so a
 * dev window is never mistaken for a packaged build sitting next to it.
 *
 * `import.meta.env.DEV` is a build-time literal the bundler replaces with `false`
 * in a production build, so this component is dead-code eliminated there — the
 * badge can never reach users, whatever the runtime environment.
 */
export function EnvBadge({ className }: EnvBadgeProps): React.JSX.Element | null {
  if (!import.meta.env.DEV) return null;
  return (
    <span
      className={cx(styles.badge, className)}
      title="Running from electron-vite dev — not a packaged build"
    >
      local env
    </span>
  );
}
