import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { Row } from "@renderer/ui/row";
import { Toggle } from "@kaipu/ui";
import { useAppSettings } from "./use-app-settings";

/**
 * Auto-copy vs explicit Copy for screenshots — writes AppSettings.screenshotCopy.
 * Deliberately independent of the save toggle above it: a capture can be kept, or
 * pasted, or both, or neither, and the editor honours all four.
 */
export function ScreenshotCopySettings(): React.JSX.Element {
  const t = useTranslations("settings");
  const { settings, update } = useAppSettings();

  return (
    <Row
      label={t("screenshotCopy")}
      description={t("screenshotCopyDescription")}
      action={
        <Toggle
          checked={(settings?.screenshotCopy ?? "auto") === "auto"}
          onChange={(checked) => void update({ screenshotCopy: checked ? "auto" : "manual" })}
        />
      }
    />
  );
}
