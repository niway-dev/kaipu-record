import { createTranslator } from "@kaipu/i18n";
import en from "@kaipu/i18n/messages/en";
import es from "@kaipu/i18n/messages/es";

export type EmailLocale = "en" | "es";

/** Namespaced translator for email copy. Fallback locale is English. */
export function emailT(locale: EmailLocale) {
  return createTranslator({
    locale,
    messages: locale === "es" ? es : en,
    namespace: "emails",
  });
}
