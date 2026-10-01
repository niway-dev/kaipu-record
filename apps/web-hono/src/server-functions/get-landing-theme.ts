import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

import {
  DEFAULT_LANDING_THEME,
  isLandingTheme,
  LANDING_THEME_COOKIE,
  type LandingTheme,
} from "@/lib/landing-theme";

/**
 * Resolve the landing theme server-side: cookie → dark.
 *
 * There is deliberately no `prefers-color-scheme` fallback. The header is not
 * readable per-request in a way that matches what the browser would later
 * compute, so honouring the system preference here would mean rendering one
 * theme and correcting it on hydration — the flash the cookie exists to avoid.
 * A visitor who wants light picks it once and it sticks for a year.
 */
export const getLandingTheme = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ theme: LandingTheme }> => {
    const saved = getCookie(LANDING_THEME_COOKIE);
    return { theme: isLandingTheme(saved) ? saved : DEFAULT_LANDING_THEME };
  },
);
