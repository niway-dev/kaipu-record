import React from "react";
import { Button, Row, Toggle } from "@kaipu/ui";
import { useTranslations } from "@kaipu/i18n";
import type { AdminModeState } from "@shared/admin-mode";
import { reportError } from "@renderer/features/analytics/report-error";
import { uiArea } from "@renderer/lib/ui-area";
import styles from "./admin-mode-settings.module.css";

/**
 * Settings → App → "Admin mode" (ADR 0067). Shown only to an admin account, or while this process
 * still runs in Admin mode (an admin who signed out keeps the badge, so the row stays to explain
 * it and to offer the restart). The switch writes the preference; it never changes the running
 * mode, so a difference shows "Restart to apply" with a "Restart now" button.
 */
export function AdminModeSettings(): React.JSX.Element | null {
  const t = useTranslations("settings");
  const [state, setState] = React.useState<AdminModeState | null>(null);

  React.useEffect(() => {
    let live = true;
    window.electronAPI
      .getAdminModeState()
      .then((next) => {
        if (live) setState(next);
      })
      .catch((error: unknown) => reportError("Could not read the Admin mode state", error));
    // Main broadcasts when the permission or the preference may have changed (sign-in, sign-out).
    const unsubscribe = window.electronAPI.onAdminModeChanged((next) => setState(next));
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  if (!state || (!state.isAdmin && !state.effective)) return null;

  const toggle = (enabled: boolean): void => {
    window.electronAPI
      .setAdminMode(enabled)
      .then(setState)
      .catch((error: unknown) => reportError("Could not change Admin mode", error));
  };
  const relaunch = (): void => {
    window.electronAPI
      .relaunchApp()
      .catch((error: unknown) => reportError("Could not restart the app", error));
  };

  return (
    <div {...uiArea("settingsApp.adminMode")} className={styles.card}>
      <Row
        label={
          <span className={styles.label}>
            {t("adminMode")}
            <span className={styles.tag}>{t("adminAccount")}</span>
          </span>
        }
        description={
          <span className={styles.description}>
            {t("adminModeDescription")}
            {state.restartPending && (
              <span className={styles.restart}>
                <strong>{t("adminModeRestart")}</strong>
                <Button variant="outline" size="sm" onClick={relaunch}>
                  {t("adminModeRestartNow")}
                </Button>
              </span>
            )}
          </span>
        }
        action={
          <Toggle aria-label={t("adminMode")} checked={state.adminModeSetting} onChange={toggle} />
        }
      />
    </div>
  );
}
