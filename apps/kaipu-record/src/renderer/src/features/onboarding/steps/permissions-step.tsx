import { Shield, Check } from "lucide-react";
import type { PermissionKind, PermissionStatus } from "@shared/types";
import { Badge } from "@renderer/ui/badge";
import { Button } from "@renderer/ui/button";
import { PERMISSION_META } from "../permissions";
import styles from "./permissions-step.module.css";

interface PermissionsStepProps {
  status: PermissionStatus;
  denied: Record<PermissionKind, boolean>;
  onRequest: (kind: PermissionKind) => void;
  onOpenSettings: (kind: PermissionKind) => void;
}

export function PermissionsStep({
  status,
  denied,
  onRequest,
  onOpenSettings,
}: PermissionsStepProps): React.JSX.Element {
  return (
    <div className={styles.step}>
      <span className={styles.shield}>
        <Shield size={26} strokeWidth={1.8} />
      </span>
      <h1 className={styles.title}>Grant permissions</h1>
      <p className={styles.subtitle}>
        Kaipu needs a few permissions to record your screen, voice and meetings. You can change
        these later in Settings.
      </p>

      <div className={styles.rows}>
        {PERMISSION_META.map(({ kind, icon: Icon, name, required, description }) => {
          const granted = status[kind];
          const wasDenied = denied[kind] && !granted;
          return (
            <div key={kind} className={styles.row}>
              <span className={styles.icon}>
                <Icon size={18} strokeWidth={1.8} />
              </span>
              <div className={styles.info}>
                <div className={styles.nameRow}>
                  <span className={styles.name}>{name}</span>
                  <Badge variant={required ? "info" : "neutral"}>
                    {required ? "REQUIRED" : "OPTIONAL"}
                  </Badge>
                </div>
                <p className={styles.description}>{description}</p>
              </div>
              <div className={styles.action}>
                {granted ? (
                  <Badge variant="success" className={styles.granted}>
                    <Check size={14} strokeWidth={2.4} /> GRANTED
                  </Badge>
                ) : wasDenied ? (
                  <Button variant="outline" size="sm" onClick={() => onOpenSettings(kind)}>
                    Open Settings
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => onRequest(kind)}>
                    Grant
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
