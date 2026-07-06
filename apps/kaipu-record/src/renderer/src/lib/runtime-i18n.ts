import { createMainTranslator } from "@kaipu/i18n/main";
import { DEFAULT_LOCALE, type Locale } from "@kaipu/i18n";

/**
 * Locale bridge for non-React renderer code (module singletons / stores) that
 * can't call `useTranslations`. `I18nRoot` keeps this in sync with the provider;
 * `runtimeT()` returns a translator for the current locale using the same catalog.
 */
let currentLocale: Locale = DEFAULT_LOCALE;

export function setRuntimeLocale(locale: Locale): void {
  currentLocale = locale;
}

/** Full-key translator for the current locale (e.g. `runtimeT()("record.errorSave")`). */
export function runtimeT(): ReturnType<typeof createMainTranslator> {
  return createMainTranslator(currentLocale);
}
