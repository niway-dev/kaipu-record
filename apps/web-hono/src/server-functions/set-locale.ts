import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import type { Locale } from "@kaipu/i18n";
import { LOCALE_COOKIE } from "@kaipu/i18n/web";

/** Persist the chosen locale in an HTTP cookie (1 year). */
export const setLocale = createServerFn({ method: "POST" })
  .inputValidator((input: unknown): Locale => {
    if (input === "es" || input === "en") return input;
    throw new Error(`Invalid locale: ${String(input)}`);
  })
  .handler(async ({ data }) => {
    setCookie(LOCALE_COOKIE, data, {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      path: "/",
    });
  });
