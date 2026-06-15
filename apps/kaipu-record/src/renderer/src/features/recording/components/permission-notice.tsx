import React from "react";
import { ShieldAlert } from "lucide-react";
import styles from "./permission-notice.module.css";

interface PermissionNoticeProps {
  label: string;
  onOpenSettings: () => void;
}

/** Inline "permission is off" affordance that deep-links to System Settings. */
export function PermissionNotice({
  label,
  onOpenSettings,
}: PermissionNoticeProps): React.JSX.Element {
  return (
    <div className={styles.notice}>
      <ShieldAlert size={15} className={styles.icon} />
      <span className={styles.label}>{label}</span>
      <button type="button" className={styles.button} onClick={onOpenSettings}>
        Open Settings
      </button>
    </div>
  );
}
