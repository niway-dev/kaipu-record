import React from "react";
import { cx } from "./cx";
import styles from "./badge.module.css";

type BadgeVariant = "success" | "info" | "warning" | "danger" | "neutral";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = "neutral", children, className }: BadgeProps): React.JSX.Element {
  return (
    <span className={cx(styles.badge, className)} data-variant={variant}>
      {children}
    </span>
  );
}
