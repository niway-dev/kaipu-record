import "./app-config";
import esMessages from "../messages/es.json";

/** Concrete, JSON-serializable shape of a message catalog (from the es source). */
export type Messages = typeof esMessages;

export { useTranslations, useFormatter, useNow, useTimeZone } from "use-intl";
export { I18nProvider, useLocale, useSetLocale } from "./provider";
export type { I18nProviderProps } from "./provider";
export { SUPPORTED_LOCALES, DEFAULT_LOCALE, TIME_ZONE, isLocale, normalizeLocale } from "./config";
export type { Locale } from "./config";
