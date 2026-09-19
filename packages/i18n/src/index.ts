import "./app-config";
import esMessages from "../messages/es.json";

/** Concrete, JSON-serializable shape of a message catalog (from the es source). */
export type Messages = typeof esMessages;

import { useTranslations } from "use-intl";

export { useTranslations };
export { useFormatter, useNow, useTimeZone, useMessages, createTranslator } from "use-intl";

/** Top-level namespaces of the catalog — what `useTranslations` takes. */
export type Namespace = keyof Messages & string;

/**
 * The translator `useTranslations(namespace)` returns, for helpers that receive one
 * as a parameter.
 *
 * Always name the namespace. `ReturnType<typeof useTranslations>` without one looks
 * shorter, but use-intl defaults that generic to `never`, which means "accepts every
 * key in the catalog" — and typing *that* makes TypeScript walk the whole message
 * tree. It compiles until the catalog grows one level deeper, then fails with TS2589
 * (`Type instantiation is excessively deep`) at the first `t()` call, not at the
 * declaration. Requiring the parameter here makes the cheap form the only form.
 */
export type Translator<N extends Namespace> = ReturnType<typeof useTranslations<N>>;
export { I18nProvider, useLocale, useSetLocale } from "./provider";
export type { I18nProviderProps } from "./provider";
export { SUPPORTED_LOCALES, DEFAULT_LOCALE, TIME_ZONE, isLocale, normalizeLocale } from "./config";
export type { Locale } from "./config";
