import { safeRedirectPath } from "./safe-redirect";

/** Where every web sign-in ends when the visitor did not ask for a specific page. */
export const DEFAULT_SIGNED_IN_PATH = "/dashboard";

/**
 * The one place that decides where a visitor lands after signing in or up, or when they open
 * `/auth/login` while already signed in: a valid same-origin `redirect` wins, anything else
 * (missing, absolute URL, `//host`, backslash, control characters) falls back to the dashboard.
 * Imported by the sign-in and sign-up forms, the auth routes and the Google button.
 */
export function resolvePostSignInPath(search: { redirect?: unknown }): string {
  return safeRedirectPath(search.redirect) ?? DEFAULT_SIGNED_IN_PATH;
}
