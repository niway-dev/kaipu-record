import { Shield, Check, MousePointerClick } from "lucide-react";
import type { AccessibilityStatus, PermissionKind, PermissionStatus } from "@shared/types";
import { useTranslations } from "@kaipu/i18n";
import { Badge } from "@renderer/ui/badge";
import { Button } from "@renderer/ui/button";
import { PERMISSION_META } from "../permissions";
import styles from "./permissions-step.module.css";

interface PermissionsStepProps {
  status: PermissionStatus;
  denied: Record<PermissionKind, boolean>;
  onRequest: (kind: PermissionKind) => void;
  onOpenSettings: (kind: PermissionKind) => void;
  /**
   * macOS Accessibility for the click hook (plans/video-editor-v2/03 § UI). It is not a
   * `PermissionKind` — a single mac-only tri-state, not a per-kind grant — so it gets
   * its own row below the media ones, and no row at all when "not-required".
   */
  accessibility: AccessibilityStatus;
  /** The single onboarding call site for `requestAccessibility()` (the other is Settings). */
  onRequestAccessibility: () => void;
}

export function PermissionsStep({
  status,
  denied,
  onRequest,
  onOpenSettings,
  accessibility,
  onRequestAccessibility,
}: PermissionsStepProps): React.JSX.Element {
  const t = useTranslations("onboarding");
  return (
    <div className={styles.step}>
      <span className={styles.shield}>
        <Shield size={26} strokeWidth={1.8} />
      </span>
      <h1 className={styles.title}>{t("permTitle")}</h1>
      <p className={styles.subtitle}>{t("permSubtitle")}</p>

      <div className={styles.rows}>
        {PERMISSION_META.map(({ kind, icon: Icon, nameKey, required, descriptionKey }) => {
          const granted = status[kind];
          const wasDenied = denied[kind] && !granted;
          return (
            <div key={kind} className={styles.row}>
              <div className={styles.header}>
                <span className={styles.icon}>
                  <Icon size={18} strokeWidth={1.8} />
                </span>
                <div className={styles.nameRow}>
                  <span className={styles.name}>{t(nameKey)}</span>
                  <Badge variant={required ? "info" : "neutral"}>
                    {required ? t("required") : t("optional")}
                  </Badge>
                </div>
              </div>
              <p className={styles.description}>{t(descriptionKey)}</p>
              <div className={styles.action}>
                {granted ? (
                  <Badge variant="success" className={styles.granted}>
                    <Check size={14} strokeWidth={2.4} /> {t("granted")}
                  </Badge>
                ) : wasDenied ? (
                  <Button variant="outline" size="sm" onClick={() => onOpenSettings(kind)}>
                    {t("openSettings")}
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => onRequest(kind)}>
                    {t("grant")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {accessibility !== "not-required" && (
          <div className={styles.row}>
            <div className={styles.header}>
              <span className={styles.icon}>
                <MousePointerClick size={18} strokeWidth={1.8} />
              </span>
              <div className={styles.nameRow}>
                <span className={styles.name}>{t("accessibilityTitle")}</span>
                <Badge variant="neutral">{t("optional")}</Badge>
              </div>
            </div>
            <p className={styles.description}>{t("accessibilityDesc")}</p>
            <div className={styles.action}>
              {accessibility === "granted" ? (
                <Badge variant="success" className={styles.granted}>
                  <Check size={14} strokeWidth={2.4} /> {t("granted")}
                </Badge>
              ) : (
                // Granting happens in System Settings; `requestAccessibility()` registers
                // the app, prompts once and deep-links the pane, so one button covers
                // both the first ask and the retry (there is no "denied" branch to detect).
                <Button variant="primary" size="sm" onClick={onRequestAccessibility}>
                  {t("accessibilityGrant")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
