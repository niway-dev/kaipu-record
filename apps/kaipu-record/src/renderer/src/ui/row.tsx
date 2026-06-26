import React from "react";
import { cx } from "./cx";
import styles from "./row.module.css";

export interface RowProps {
  icon?: React.ReactNode;
  label: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  actionClassName?: string;
}

export function Row({
  icon,
  label,
  description,
  action,
  className,
  actionClassName,
}: RowProps): React.JSX.Element {
  return (
    <div className={cx(styles.row, className)}>
      {icon ? (
        <span className={styles.icon} aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className={styles.info}>
        <span className={styles.label}>{label}</span>
        {description ? <span className={styles.description}>{description}</span> : null}
      </div>
      {action ? <div className={cx(styles.action, actionClassName)}>{action}</div> : null}
    </div>
  );
}
