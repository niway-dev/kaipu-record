import React from "react";
import { cx } from "@renderer/ui/cx";
import { useAnyFlagOverridden } from "@renderer/features/analytics/use-flag-states";
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
  const overridden = useAnyFlagOverridden();
  if (!import.meta.env.DEV) return null;
  // Feature flags pinned (`KAIPU_FLAG_OVERRIDES` or the Developer page): say so, or a pinned window looks real.
  return (
    <span
      className={cx(styles.badge, className)}
      title="Running from electron-vite dev — not a packaged build"
    >
      local env{overridden ? " · flags overridden" : ""}
    </span>
  );
}
