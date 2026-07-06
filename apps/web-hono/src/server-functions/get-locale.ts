import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { DEFAULT_LOCALE, isLocale, normalizeLocale, type Locale, type Messages } from "@kaipu/i18n";
import { LOCALE_COOKIE } from "@kaipu/i18n/web";
import es from "@kaipu/i18n/messages/es";
import en from "@kaipu/i18n/messages/en";

const messages: Record<Locale, Messages> = { es, en };

/** Resolve the locale server-side: cookie → Accept-Language → default. */
export const getLocale = createServerFn({ method: "GET" }).handler(async () => {
  const saved = getCookie(LOCALE_COOKIE);
  if (isLocale(saved)) return { locale: saved, messages: messages[saved] };

  const accept = getRequestHeaders().get("accept-language") ?? "";
  const locale = accept ? normalizeLocale(accept.split(",")[0]) : DEFAULT_LOCALE;
  return { locale, messages: messages[locale] };
});
