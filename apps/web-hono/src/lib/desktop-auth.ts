import {
  DESKTOP_AUTH_CALLBACK_PATH,
  DESKTOP_AUTH_CLIENT_ID,
  DESKTOP_AUTH_SCHEME,
} from "@kaipu/domain/constants";

/**
 * The three values the desktop app puts on `/auth/desktop` (NIW2-471). They travel unchanged
 * through every page of the flow and reach the API as query parameters, where the electron plugin
 * binds the authorization code to them.
 */
export interface DesktopAuthQuery {
  client_id: string;
  state: string;
  code_challenge: string;
}

// S256 challenges are always 43 base64url characters; the desktop's state is 16 alphanumerics.
// The bound is loose for state and strict for the challenge: a malformed challenge can never be
// satisfied, so refusing it here gives the visitor a clearer message than the app could.
const STATE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The desktop query from a route's search params, or null when any value is missing or malformed. */
export function parseDesktopAuthQuery(search: Record<string, unknown>): DesktopAuthQuery | null {
  const { client_id, state, code_challenge } = search;
  if (client_id !== DESKTOP_AUTH_CLIENT_ID) return null;
  if (typeof state !== "string" || !STATE_PATTERN.test(state)) return null;
  if (typeof code_challenge !== "string" || !CHALLENGE_PATTERN.test(code_challenge)) return null;
  return { client_id, state, code_challenge };
}

/** `?client_id=…&state=…&code_challenge=…`, for links and callback URLs. */
export function desktopAuthSearch(query: DesktopAuthQuery): string {
  const params = new URLSearchParams({
    client_id: query.client_id,
    state: query.state,
    code_challenge: query.code_challenge,
  });
  return `?${params.toString()}`;
}

/** Where every successful desktop sign-in lands: the page that hands the code to the app. */
export function desktopDonePath(query: DesktopAuthQuery): string {
  return `/auth/desktop/done${desktopAuthSearch(query)}`;
}

/**
 * The deep link that opens the app, in the exact form `ensureElectronRedirect` builds
 * (`<scheme>:/<callbackPath>#token=<value>`), so "Open Kaipu again" behaves like the first try.
 * `code` is the value of the `better-auth.<client id>` cookie, not the raw 32-character code.
 */
export function desktopCallbackUrl(code: string): string {
  return `${DESKTOP_AUTH_SCHEME}:/${DESKTOP_AUTH_CALLBACK_PATH}#token=${code}`;
}
