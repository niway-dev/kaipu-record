/**
 * Parsing for the `kaipu://` links the operating system hands to the app.
 *
 * Pure on purpose: no Electron import, so every platform's way of delivering the link (macOS
 * `open-url`, Windows/Linux argv, cold start) can be unit-tested with plain strings.
 */

import { DESKTOP_AUTH_CALLBACK_PATH, DESKTOP_AUTH_SCHEME } from "@kaipu/domain/constants";

export const DEEP_LINK_SCHEME = DESKTOP_AUTH_SCHEME;

export type DeepLink =
  /** The browser finished signing in and hands back a single-use code (`#token=<base64url>`). */
  | { kind: "auth-callback"; token: string }
  /** A link we recognise as ours but do not act on yet (e.g. the reserved `billing/refresh`). */
  | { kind: "unhandled"; path: string };

/** True when `value` looks like one of our links — the cheap test used to pick it out of argv. */
export function isDeepLink(value: unknown): value is string {
  return typeof value === "string" && value.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`);
}

/** Parse one URL string. Null when it is not a Kaipu link at all. */
export function parseDeepLink(raw: string): DeepLink | null {
  if (!isDeepLink(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null;

  // `kaipu:/auth/callback` has an empty host and the path in `pathname`; `kaipu://auth/callback`
  // parses "auth" as the host. Accept both so the exact slash count the server emits is not
  // something the app silently depends on.
  const path = `/${url.hostname}${url.pathname}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");

  if (path === DESKTOP_AUTH_CALLBACK_PATH) {
    const match = /^#token=(.+)$/.exec(url.hash);
    if (!match?.[1]) return { kind: "unhandled", path };
    try {
      return { kind: "auth-callback", token: decodeURIComponent(match[1]) };
    } catch {
      return { kind: "unhandled", path };
    }
  }
  return { kind: "unhandled", path };
}

/**
 * The first Kaipu link in a command line. On Windows and Linux the OS launches the app (or the
 * running copy, via `second-instance`) with the link as an argument; in dev there are extra
 * leading arguments (the app path, flags), so the link is searched for, not assumed last.
 */
export function findDeepLinkInArgv(argv: readonly string[]): string | null {
  return argv.find(isDeepLink) ?? null;
}
