import React from "react";
import { useLocale, useSetLocale, useTranslations, type Locale } from "@kaipu/i18n";
import { Row } from "@renderer/ui/row";
import { Button } from "@kaipu/ui";

/** Language picker — writes AppSettings.locale via the provider's onLocaleChange. */
export function LanguageSettings(): React.JSX.Element {
  const t = useTranslations("settings");
  const locale = useLocale();
  const setLocale = useSetLocale();

  const options: ReadonlyArray<{ value: Locale; label: string }> = [
    { value: "es", label: t("spanish") },
    { value: "en", label: t("english") },
  ];

  return (
    <Row
      label={t("languageDescription")}
      action={
        <div style={{ display: "flex", gap: 8 }}>
          {options.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={locale === option.value ? "primary" : "outline"}
              onClick={() => setLocale(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      }
    />
  );
}
