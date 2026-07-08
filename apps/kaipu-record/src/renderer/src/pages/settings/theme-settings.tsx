import React from "react";
import { useTranslations } from "@kaipu/i18n";
import type { Theme } from "@shared/types";
import { Row } from "@renderer/ui/row";
import { Button } from "@renderer/ui/button";

/** Theme picker — writes AppSettings.theme; every window re-themes via the settings broadcast. */
export function ThemeSettings({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}): React.JSX.Element {
  const t = useTranslations("settings");

  const options: ReadonlyArray<{ value: Theme; label: string }> = [
    { value: "dark", label: t("themeDark") },
    { value: "light", label: t("themeLight") },
  ];

  return (
    <Row
      label={t("themeDescription")}
      action={
        <div style={{ display: "flex", gap: 8 }}>
          {options.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={theme === option.value ? "primary" : "outline"}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      }
    />
  );
}
