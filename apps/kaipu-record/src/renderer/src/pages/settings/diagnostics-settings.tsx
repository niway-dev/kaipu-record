import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { Row } from "@kaipu/ui";
import { Toggle } from "@kaipu/ui";
import { useAppSettings } from "./use-app-settings";

/**
 * Opt-out for PostHog diagnostics — writes AppSettings.diagnosticsEnabled, which both
 * processes follow without a restart. On by default; the description states the cost
 * of turning it off, since error reports are how the team finds what broke.
 */
export function DiagnosticsSettings(): React.JSX.Element {
  const t = useTranslations("settings");
  const { settings, update } = useAppSettings();

  return (
    <Row
      label={t("diagnostics")}
      description={t("diagnosticsDescription")}
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
