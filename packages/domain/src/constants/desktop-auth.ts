/**
 * Desktop sign-in through the browser (NIW2-471, `@better-auth/electron`). The server plugin, the
 * web pages and the desktop client must agree on every value here, so they live in one place.
 */

/**
 * Public identifier of the desktop app. It is not a secret: the server only checks that the
 * `client_id` query parameter equals it before minting an authorization code. PKCE (S256) and
 * `state` are what bind the code to the app instance that started the flow.
 */
export const DESKTOP_AUTH_CLIENT_ID = "kaipu-desktop";

/** Custom URL scheme the desktop app registers; the web returns to `kaipu:/<callback path>`. */
export const DESKTOP_AUTH_SCHEME = "kaipu";

/** Path the browser opens on the scheme: `kaipu://auth/callback#token=<code>`. */
export const DESKTOP_AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * The `Origin` the desktop sends on its own requests. Better Auth 1.7 matches a host-bearing
 * trusted origin against the host exactly, so the server trusts the bare scheme pattern.
 */
export const DESKTOP_AUTH_ORIGIN = `${DESKTOP_AUTH_SCHEME}:/`;

/** Better Auth cookie prefix (the default). The plugin's redirect cookie is `<prefix>.<client id>`. */
export const DESKTOP_AUTH_COOKIE_PREFIX = "better-auth";
