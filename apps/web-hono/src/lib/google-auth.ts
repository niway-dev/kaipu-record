/**
 * Web side of "Continue with Google" (NIW2-219): the mapping from Better Auth's OAuth errors to copy.
 * The button is always shown; a server without Google configured answers with an error, mapped here.
 */

export type OAuthErrorKey =
  | "oauthErrorNotLinked"
  | "oauthErrorEmailMismatch"
  | "oauthErrorAlreadyLinked"
  | "oauthErrorUnableToLink"
  | "oauthErrorCancelled"
  | "oauthErrorExpired"
  | "oauthErrorGeneric"
  | "googleUnavailable";

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

/**
 * The error a start request (`signIn.social`, `linkSocial`) comes back with, as copy. The button is
 * always shown, so a server with no Google provider configured answers `PROVIDER_NOT_FOUND` (404,
 * "Provider not found"); that gets its own message instead of the raw error.
 */
export function googleStartErrorKey(error: unknown): OAuthErrorKey {
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown };
  if (code === "PROVIDER_NOT_FOUND" || (status === 404 && code === undefined))
    return "googleUnavailable";
  return "oauthErrorGeneric";
}
