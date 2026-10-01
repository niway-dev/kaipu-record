/**
 * The landing's own theme, which is not the app's.
 *
 * `styles/landing-tokens.css` carries two token columns under `[data-kl]`, and
 * the light one only applies when `data-kl-theme="light"` is on that element.
 * This module names the cookie and the values so the server function, the route
 * context and the switch all agree on them.
 *
 * It is a cookie rather than localStorage for the same reason the locale is:
 * the server has to know the answer while it renders, or the first paint is the
 * wrong theme and the page flips once the script runs.
 */
export const LANDING_THEME_COOKIE = "kaipu_landing_theme";

export const LANDING_THEMES = ["dark", "light"] as const;

export type LandingTheme = (typeof LANDING_THEMES)[number];

/** The home was designed dark; light is the opt-in. */
export const DEFAULT_LANDING_THEME: LandingTheme = "dark";

export function isLandingTheme(value: unknown): value is LandingTheme {
  return value === "dark" || value === "light";
}
