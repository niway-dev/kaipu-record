import { createAuthClient } from "better-auth/client";
import { electronClient } from "@better-auth/electron/client";
import {
  DESKTOP_AUTH_CLIENT_ID,
  DESKTOP_AUTH_COOKIE_PREFIX,
  DESKTOP_AUTH_SCHEME,
} from "@kaipu/domain/constants";
import type { AuthError, BrowserSignInIntent } from "@shared/types/auth";
import type { SignInResult } from "./auth-client";

export interface BrowserSignInConfig {
  /** The API origin (`MAIN_VITE_SERVER_URL`); better-auth lives under `/api/auth`. */
  serverUrl: string;
  /** The website origin (`MAIN_VITE_WEB_URL`) that hosts `/auth/desktop`. */
  webUrl: string;
}

/**
 * What the auth store needs from the browser hand-off. An interface so the store's tests do not
 * pull in the plugin (which imports `electron` at load time).
 */
export interface BrowserSignInClient {
  /** Open the system browser on the web sign-in page and remember the PKCE state. */
  begin(intent: BrowserSignInIntent): Promise<void>;
  /** Exchange the single-use code (the `#token=` value of the link, or the pasted code) for a
   *  session. Throws an {@link AuthError}-shaped object on failure. */
  exchange(token: string): Promise<SignInResult>;
}

/**
 * The plugin keeps the session cookie it receives in a "jar" it reads and writes through this
 * object. Keeping it in memory means there is exactly one persistent copy of the session — the
 * bearer token in `auth.enc` (auth-store.ts) — instead of a second, differently-shaped one that
 * would have to be kept in step with it. The jar is emptied after every exchange, so the
 * cookie only lives for the duration of the one request that produces it.
 *
 * The interface is synchronous: the plugin treats a returned Promise as "nothing stored".
 */
function createMemoryStorage(): {
  getItem(name: string): unknown | null;
  setItem(name: string, value: unknown): void;
  clear(): void;
} {
  const map = new Map<string, unknown>();
  return {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => void map.set(name, value),
    clear: () => map.clear(),
  };
}

/** The decoded form of the code: base64url JSON of `{ identifier, state }`. */
function isWellFormedCode(token: string): boolean {
  try {
    const json = Buffer.from(decodeURIComponent(token.trim()), "base64url").toString("utf8");
    const parsed = JSON.parse(json) as { identifier?: unknown; state?: unknown };
    return typeof parsed.identifier === "string" && typeof parsed.state === "string";
  } catch {
    return false;
  }
}

/** The signed session token from a `Set-Cookie` header, URL-decoded — the same `token.signature`
 *  string the server hands out in `set-auth-token`. Fallback for when the header is missing. */
export function sessionTokenFromSetCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = /(?:^|[,;]\s*)(?:__Secure-)?[\w.-]*session_token=([^;,\s]+)/.exec(setCookie);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function toAuthError(err: unknown): AuthError {
  const message = err instanceof Error ? err.message : String(err);
  // better-auth's `authenticate` throws this when the state in the code has no verifier: the
  // sign-in was started by another run of the app, already used, or never started.
  if (/verifier not found/i.test(message)) return { kind: "state-mismatch" };
  // A rejected fetch (offline, DNS, refused connection) is a TypeError in Chromium's net stack.
  if (err instanceof TypeError) return { kind: "network" };
  return { kind: "unknown", message };
}

export function createBrowserSignInClient(config: BrowserSignInConfig): BrowserSignInClient {
  const storage = createMemoryStorage();
  const webUrl = config.webUrl.replace(/\/$/, "");

  // One plugin client per intent: the plugin appends client_id/state/code_challenge to a fixed
  // `signInURL`, so the sign-up variant carries its own `intent` marker in that URL.
  function makeClient(intent: BrowserSignInIntent) {
    const signInURL = new URL(`${webUrl}/auth/desktop`);
    if (intent === "sign-up") signInURL.searchParams.set("intent", "sign-up");
    return createAuthClient({
      baseURL: config.serverUrl,
      basePath: "/api/auth",
      plugins: [
        electronClient({
          signInURL,
          protocol: { scheme: DESKTOP_AUTH_SCHEME },
          clientID: DESKTOP_AUTH_CLIENT_ID,
          // The web done page hands back the readable `<cookiePrefix>.<clientID>` cookie, which
          // is what `authenticate({ token })` parses; both halves must match the server plugin.
          cookiePrefix: DESKTOP_AUTH_COOKIE_PREFIX,
          storage,
        }),
      ],
    });
  }
  const clients = new Map<BrowserSignInIntent, ReturnType<typeof makeClient>>();
  function clientFor(intent: BrowserSignInIntent): ReturnType<typeof makeClient> {
    let client = clients.get(intent);
    if (!client) {
      client = makeClient(intent);
      clients.set(intent, client);
    }
    return client;
  }

  return {
    async begin(intent) {
      await clientFor(intent).requestAuth();
    },

    async exchange(token) {
      if (!isWellFormedCode(token)) throw { kind: "invalid-code" } satisfies AuthError;

      let sessionToken: string | null = null;
      let result: Awaited<ReturnType<ReturnType<typeof makeClient>["authenticate"]>>;
      try {
        result = await clientFor("sign-in").authenticate({
          token,
          fetchOptions: {
            onSuccess: (ctx) => {
              sessionToken =
                ctx.response.headers.get("set-auth-token") ??
                sessionTokenFromSetCookie(ctx.response.headers.get("set-cookie"));
            },
          },
        });
      } catch (err) {
        throw toAuthError(err);
      } finally {
        // Whatever the jar received has served its purpose (see createMemoryStorage).
        storage.clear();
      }

      if (result.error) {
        // 4xx: the server refused the code (expired, used, wrong verifier). Anything else is
        // the server, or the path to it, not the code.
        const status = result.error.status;
        if (status >= 400 && status < 500) throw { kind: "invalid-code" } satisfies AuthError;
        throw { kind: "network" } satisfies AuthError;
      }
      if (!sessionToken || !result.data?.user) {
        throw {
          kind: "unknown",
          message: "sign-in succeeded but no session token was issued",
        } satisfies AuthError;
      }
      const user = result.data.user;
      return { token: sessionToken, userId: user.id, email: user.email, name: user.name };
    },
  };
}
