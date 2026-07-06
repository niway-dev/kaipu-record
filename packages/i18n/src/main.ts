import { createTranslator } from "use-intl/core";
import es from "../messages/es.json";
import en from "../messages/en.json";
import { TIME_ZONE, type Locale } from "./config";

const messagesByLocale: Record<Locale, Record<string, unknown>> = { es, en };

/**
 * A translator usable anywhere in the Electron main process (tray, dialogs,
 * notifications). Uses use-intl's non-React core with the same JSON catalog.
 */
export function createMainTranslator(locale: Locale, namespace?: string) {
  return createTranslator({
    locale,
    messages: messagesByLocale[locale],
    timeZone: TIME_ZONE,
    namespace,
  });
}
