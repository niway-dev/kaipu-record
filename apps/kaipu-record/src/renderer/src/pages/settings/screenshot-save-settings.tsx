import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { Row } from "@renderer/ui/row";
import { Toggle } from "@kaipu/ui";
import { useAppSettings } from "./use-app-settings";

/**
 * Auto-save vs explicit save for screenshots — writes AppSettings.screenshotSave.
 * A toggle, not a segmented control: every other binary choice on this page is one,
 * and `Row`'s description is single-line (ellipsized), so the copy stays short.
 */
export function ScreenshotSaveSettings(): React.JSX.Element {
  const t = useTranslations("settings");
  const { settings, update } = useAppSettings();

  return (
    <Row
      label={t("screenshotSave")}
      description={t("screenshotSaveDescription")}
      action={
        <Toggle
          checked={(settings?.screenshotSave ?? "auto") === "auto"}
          onChange={(checked) => void update({ screenshotSave: checked ? "auto" : "manual" })}
        />
      }
    />
  );
}
