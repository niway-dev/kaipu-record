import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { Row } from "@renderer/ui/row";
import { Toggle } from "@kaipu/ui";
import { useAppSettings } from "./use-app-settings";

/**
 * Opt-in "Made with Kaipu" mark on new recordings — writes AppSettings.showBrandBadge.
 * Off until the user turns it on: the free app ships no watermark
 * (backlog/free-tier-no-watermark), so this is a signature, not a plan gate.
 */
export function BrandBadgeSettings(): React.JSX.Element {
  const t = useTranslations("settings");
  const { settings, update } = useAppSettings();

  return (
    <Row
      label={t("brandBadge")}
      description={t("brandBadgeDescription")}
      action={
        <Toggle
          checked={settings?.showBrandBadge ?? false}
          onChange={(checked) => void update({ showBrandBadge: checked })}
        />
      }
    />
  );
}
