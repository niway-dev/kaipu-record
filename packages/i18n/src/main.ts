import "./app-config";
import { createTranslator } from "use-intl/core";
import type { Messages } from "use-intl";
import es from "../messages/es.json";
import en from "../messages/en.json";
import { TIME_ZONE, type Locale } from "./config";

const messagesByLocale = { es, en } as Record<Locale, Messages>;

/**
 * A translator usable anywhere in the Electron main process (tray, dialogs,
 * notifications). Uses use-intl's non-React core with the same JSON catalog.
 * Call with full, namespaced keys, e.g. `t("tray.open")`.
 */
export function createMainTranslator(locale: Locale) {
  return createTranslator({
    locale,
    messages: messagesByLocale[locale],
    timeZone: TIME_ZONE,
  });
}
