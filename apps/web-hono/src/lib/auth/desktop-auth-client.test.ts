import { afterEach, describe, expect, it } from "vitest";

import { desktopAuthClient } from "./desktop-auth-client";

/**
 * Runs the real `electronProxyClient`. The server sets its readable cookie as
 * `<cookiePrefix>.<clientID>`, so with our client id it is `better-auth.kaipu-desktop` — NOT
 * `better-auth.electron`, which is only the name under the plugin's default client id. Both halves
 * read the id from @kaipu/domain/constants; this pins that the web half looks where the server writes.
 */
function clearCookies() {
  for (const name of ["better-auth.kaipu-desktop", "better-auth.electron"]) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
  }
}

afterEach(clearCookies);

describe("desktopAuthClient.electron.getAuthorizationCode", () => {
  it("reads the cookie named after the desktop client id", () => {
    document.cookie = "better-auth.kaipu-desktop=eyJpZGVudGlmaWVyIjoieCJ9; path=/";
    expect(desktopAuthClient.electron.getAuthorizationCode()).toBe("eyJpZGVudGlmaWVyIjoieCJ9");
  });

  it("ignores the plugin's default cookie name", () => {
    document.cookie = "better-auth.electron=eyJpZGVudGlmaWVyIjoieCJ9; path=/";
    expect(desktopAuthClient.electron.getAuthorizationCode()).toBeNull();
  });
});
