import React from "react";
import { useTranslations } from "@kaipu/i18n";
import type { ScreenshotSaveMode } from "@shared/types";
import { Row } from "@renderer/ui/row";
import { Button } from "@renderer/ui/button";
import { useAppSettings } from "./use-app-settings";

/** Auto-save vs explicit save for screenshots — writes AppSettings.screenshotSave. */
export function ScreenshotSaveSettings(): React.JSX.Element {
  const t = useTranslations("settings");
  const { settings, update } = useAppSettings();
  const current = settings?.screenshotSave ?? "auto";

  const options: ReadonlyArray<{ value: ScreenshotSaveMode; label: string }> = [
    { value: "auto", label: t("screenshotSaveAuto") },
    { value: "manual", label: t("screenshotSaveManual") },
  ];

  return (
    <Row
      label={t("screenshotSave")}
      description={t("screenshotSaveDescription")}
      action={
        <div style={{ display: "flex", gap: 8 }}>
          {options.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={current === option.value ? "primary" : "outline"}
              aria-pressed={current === option.value}
              onClick={() => void update({ screenshotSave: option.value })}
            >
              {option.label}
            </Button>
          ))}
        </div>
      }
    />
  );
}
