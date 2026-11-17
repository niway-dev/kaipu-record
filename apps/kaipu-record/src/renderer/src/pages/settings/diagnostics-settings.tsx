import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { Row } from "@kaipu/ui";
import { Toggle } from "@kaipu/ui";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import { useAppSettings } from "./use-app-settings";
import styles from "./diagnostics-settings.module.css";

/**
 * Opt-out for usage and crash reports — writes AppSettings.diagnosticsEnabled, which both
 * processes follow without a restart. On by default. The description says what is shared,
 * what never is, and that turning it off still leaves the feature-flag check for this
 * computer, which is the one thing that keeps running (NIW2-849). The onboarding's privacy
 * step says the same in the same words.
 */
export function DiagnosticsSettings(): React.JSX.Element {
  const t = useTranslations("settings");
  const { settings, update } = useAppSettings();

  return (
    <Row
      label={t("diagnostics")}
      description={
        <span className={styles.description}>
          {t(isWindowsHost() ? "diagnosticsDescriptionWindows" : "diagnosticsDescription")}
        </span>
      }
      action={
        <Toggle
          aria-label={t("diagnostics")}
          checked={settings?.diagnosticsEnabled ?? true}
          onChange={(checked) => void update({ diagnosticsEnabled: checked })}
        />
      }
    />
  );
}
