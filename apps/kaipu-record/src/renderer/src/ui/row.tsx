import React from "react";
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
  const cls = [styles.row, className].filter(Boolean).join(" ");
  const actionCls = [styles.action, actionClassName].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      {icon && <div className={styles.icon}>{icon}</div>}
      <div className={styles.info}>
        <span className={styles.label}>{label}</span>
        {description && <span className={styles.description}>{description}</span>}
      </div>
      {action && <div className={actionCls}>{action}</div>}
    </div>
  );
}
