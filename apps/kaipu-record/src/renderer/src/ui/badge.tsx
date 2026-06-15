import React from "react";
import styles from "./badge.module.css";

type BadgeVariant = "success" | "info" | "warning" | "danger" | "neutral";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = "neutral", children, className }: BadgeProps): React.JSX.Element {
  const cls = [styles.badge, styles[variant], className].filter(Boolean).join(" ");
  return <span className={cls}>{children}</span>;
}
