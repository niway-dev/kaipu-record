/**
 * Onboarding step for macOS Accessibility (plans/video-editor-v2/03 § UI): explains why
 * the video editor's auto-zoom-on-click needs the permission and what the app keeps
 * (mouse clicks only, never the keyboard — see click-hook.ts). Optional: "Not now"
 * (the overlay's own footer CTA on this step) continues without granting, so auto-zoom
 * still works from pauses alone.
 *
 * The Grant button here is the single onboarding call site for `requestAccessibility()`
 * — the other is the Settings "Zoom on clicks" row. Neither the recorder nor the click
 * hook ever calls it; this step only ever *checks* trust via `useAccessibility`.
 */
import { Check, MousePointerClick } from "lucide-react";
import type { AccessibilityStatus } from "@shared/types";
import { useTranslations } from "@kaipu/i18n";
import { Badge } from "@renderer/ui/badge";
import { Button } from "@renderer/ui/button";
import styles from "./accessibility-step.module.css";

interface AccessibilityStepProps {
  status: AccessibilityStatus;
  onGrant: () => void;
}

export function AccessibilityStep({ status, onGrant }: AccessibilityStepProps): React.JSX.Element {
  const t = useTranslations("onboarding");
  const granted = status === "granted";
  return (
    <div className={styles.step}>
      <span className={styles.shield}>
        <MousePointerClick size={26} strokeWidth={1.8} />
      </span>
      <h1 className={styles.title}>{t("accessibilityTitle")}</h1>
      <p className={styles.subtitle}>{t("accessibilityBody")}</p>
      <div className={styles.action}>
        {granted ? (
          <Badge variant="success">
            <Check size={14} strokeWidth={2.4} /> {t("granted")}
          </Badge>
        ) : (
          <Button variant="primary" size="default" onClick={onGrant}>
            {t("accessibilityGrant")}
          </Button>
        )}
      </div>
      <p className={styles.hint}>{t("accessibilityRestartHint")}</p>
    </div>
  );
}
