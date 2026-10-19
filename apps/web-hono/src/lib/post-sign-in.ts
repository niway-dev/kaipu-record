import { safeRedirectPath } from "./safe-redirect";

/** Where every web sign-in ends when the visitor did not ask to go somewhere specific. */
export const DEFAULT_SIGNED_IN_PATH = "/dashboard";

/**
 * The page a visitor lands on after signing in: the `redirect` search param when it is a safe
 * same-origin path, otherwise the dashboard. One function so the sign-in form, the sign-up form,
 * the already-signed-in bounce and the Google button cannot drift apart.
 */
export function resolvePostSignInPath(search: { redirect?: unknown } | undefined): string {
  return safeRedirectPath(search?.redirect) ?? DEFAULT_SIGNED_IN_PATH;
}
