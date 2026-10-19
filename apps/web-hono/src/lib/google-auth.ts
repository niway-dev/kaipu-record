/**
 * Web side of "Continue with Google" (NIW2-219): the feature flag and the mapping from Better
 * Auth's OAuth `?error=` codes to copy.
 */

/**
 * Q8: the Google button shows only when `VITE_GOOGLE_AUTH_ENABLED=true`. The web app cannot see
 * the API's GOOGLE_* secrets, so this flag says "the API has Google configured" for it.
 */
export function isGoogleAuthEnabled(env: ImportMetaEnv = import.meta.env): boolean {
  return env.VITE_GOOGLE_AUTH_ENABLED === "true";
}

export type OAuthErrorKey =
  | "oauthErrorNotLinked"
  | "oauthErrorEmailMismatch"
  | "oauthErrorAlreadyLinked"
  | "oauthErrorUnableToLink"
  | "oauthErrorCancelled"
  | "oauthErrorExpired"
  | "oauthErrorGeneric";

/**
 * Better Auth 1.7.11 redirects to the error URL with `?error=<code>` (api/routes/callback.mjs,
 * oauth2/errors.mjs, oauth2/state.mjs). Known codes get specific copy; anything else gets the generic message, so
 * a raw code is never shown. Keys live in the `auth` namespace.
 */
const CODES: Record<string, OAuthErrorKey> = {
  account_not_linked: "oauthErrorNotLinked",
  email_does_not_match: "oauthErrorEmailMismatch",
  // The 1.4 spelling, kept so an old link or bookmark still gets the right copy.
  "email_doesn't_match": "oauthErrorEmailMismatch",
  account_already_linked_to_different_user: "oauthErrorAlreadyLinked",
  unable_to_link_account: "oauthErrorUnableToLink",
  access_denied: "oauthErrorCancelled",
  invalid_code: "oauthErrorExpired",
  no_code: "oauthErrorExpired",
  state_mismatch: "oauthErrorExpired",
  state_not_found: "oauthErrorExpired",
  state_invalid: "oauthErrorExpired",
  state_security_mismatch: "oauthErrorExpired",
  please_restart_the_process: "oauthErrorExpired",
};

export function oauthErrorKey(code: string): OAuthErrorKey {
  return Object.hasOwn(CODES, code) ? CODES[code]! : "oauthErrorGeneric";
}

/** Keeps a short, printable `?error=` value; anything else is dropped from the URL state. */
export function parseOAuthErrorParam(value: unknown): string | undefined {
  return typeof value === "string" && /^[\w'.-]{1,64}$/.test(value) ? value : undefined;
}
