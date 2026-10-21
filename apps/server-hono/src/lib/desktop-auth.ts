import { electron } from "@better-auth/electron";
import { DESKTOP_AUTH_CLIENT_ID, DESKTOP_AUTH_ORIGIN } from "@kaipu/domain/constants";

/**
 * Server half of desktop sign-in through the browser (NIW2-471). The plugin adds:
 *
 * - hooks on `/sign-in/*`, `/sign-up/*` and `/callback/*`: when the request carries
 *   `client_id` + `code_challenge` + `state`, a new session also mints a 32-character
 *   authorization code (stored in `verification` as `electron:<code>`, single use, 300 s) and a
 *   readable `better-auth.<client id>` cookie the web page hands to the app;
 * - `POST /electron/transfer-user`: the same code for a visitor who is already signed in on the web;
 * - `POST /electron/token`: the desktop exchanges code + PKCE verifier + state for a NEW session.
 *   The bearer plugin then returns the signed token in `set-auth-token`.
 *
 * `GET /electron/init-oauth-proxy` also exists but the web pages do not use it: it fetches the
 * API's own base URL from inside the Worker, which the browser-driven flow does not need.
 */
export function desktopAuthPlugin() {
  return electron({ clientID: DESKTOP_AUTH_CLIENT_ID });
}

/**
 * Trusted origins for the desktop app.
 *
 * - `kaipu:/` is the bare-scheme pattern for the `Origin: kaipu:/` the Electron client sends on
 *   `/electron/token`. Better Auth 1.7 matches a host-bearing pattern against the host exactly, so
 *   a pattern like `kaipu://app` would not match it.
 * - `kaipu-record://app` is the literal the current in-app email/password form sets as its Origin
 *   (apps/kaipu-record/src/main/services/auth-client.ts). The browser sign-in desktop build still
 *   sends it on its resend-verification-email call, so it can be dropped only once no supported
 *   desktop build sends it any more.
 */
export const DESKTOP_TRUSTED_ORIGINS = [DESKTOP_AUTH_ORIGIN, "kaipu-record://app"] as const;
