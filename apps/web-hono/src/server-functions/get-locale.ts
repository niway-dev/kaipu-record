import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { DEFAULT_LOCALE, isLocale, normalizeLocale, type Locale } from "@kaipu/i18n";
import { LOCALE_COOKIE } from "@kaipu/i18n/web";
import es from "@kaipu/i18n/messages/es";
import en from "@kaipu/i18n/messages/en";

import { pickMessages, type MessageTree } from "@/lib/i18n/pick-messages";
import type { MessageSlice } from "@/lib/i18n/route-messages";

// Imported here, inside a server function, so the catalogs stay in the server
// bundle: the client only ever receives the slices a route asks for.
const catalogs: Record<Locale, MessageTree> = { es, en };

function resolveLocale(): Locale {
  const saved = getCookie(LOCALE_COOKIE);
  if (isLocale(saved)) return saved;

  const accept = getRequestHeaders().get("accept-language") ?? "";
  return accept ? normalizeLocale(accept.split(",")[0]) : DEFAULT_LOCALE;
}

/**
 * Resolve the locale server-side (cookie → Accept-Language → default) and return
 * the active locale's messages, filtered to the requested slices.
 */
export const getLocale = createServerFn({ method: "GET" })
  .inputValidator((input: unknown): { slices: MessageSlice[] } => {
    const slices = (input as { slices?: unknown } | null)?.slices;
    if (!Array.isArray(slices) || !slices.every((s) => typeof s === "string")) {
      throw new Error("Invalid message slices");
    }
    return { slices: slices as MessageSlice[] };
  })
  .handler(async ({ data }) => {
    const locale = resolveLocale();
    return { locale, messages: pickMessages(catalogs[locale], data.slices) };
  });
