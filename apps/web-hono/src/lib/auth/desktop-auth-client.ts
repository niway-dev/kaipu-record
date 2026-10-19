import { electronProxyClient } from "@better-auth/electron/proxy";
import {
  DESKTOP_AUTH_CALLBACK_PATH,
  DESKTOP_AUTH_CLIENT_ID,
  DESKTOP_AUTH_COOKIE_PREFIX,
  DESKTOP_AUTH_SCHEME,
} from "@kaipu/domain/constants";
import { createAuthClient } from "better-auth/react";

/**
 * The auth client for the `/auth/desktop` pages only (NIW2-471). It adds the electron proxy
 * plugin — `electron.transferUser`, `electron.getAuthorizationCode` and `ensureElectronRedirect` —
 * which no other page needs, so it lives apart from `auth-client.ts` and only the desktop routes
 * import it.
 */
export const desktopAuthClient = createAuthClient({
  fetchOptions: {
    credentials: "include",
  },
  plugins: [
    electronProxyClient({
      protocol: DESKTOP_AUTH_SCHEME,
      clientID: DESKTOP_AUTH_CLIENT_ID,
      cookiePrefix: DESKTOP_AUTH_COOKIE_PREFIX,
      callbackPath: DESKTOP_AUTH_CALLBACK_PATH,
    }),
  ],
});
