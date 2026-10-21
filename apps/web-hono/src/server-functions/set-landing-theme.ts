import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";

import { isLandingTheme, LANDING_THEME_COOKIE, type LandingTheme } from "@/lib/landing-theme";

/** Persist the chosen landing theme in an HTTP cookie (1 year), like the locale. */
export const setLandingTheme = createServerFn({ method: "POST" })
  .inputValidator((input: unknown): LandingTheme => {
    if (isLandingTheme(input)) return input;
    throw new Error(`Invalid landing theme: ${String(input)}`);
  })
  .handler(async ({ data }) => {
    setCookie(LANDING_THEME_COOKIE, data, {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      path: "/",
    });
  });
