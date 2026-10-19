/**
 * Desktop sign-in through the browser (NIW2-471), end to end through a REAL Better Auth 1.7
 * instance in process: the in-memory adapter instead of Postgres, no network, no database, no
 * Infisical, no deployed API.
 *
 * It runs the same plugins the API runs for this flow — `bearer({ requireSignature: true })` from
 * baseConfig and the electron plugin from ./desktop-auth — and the same desktop trusted origins.
 * baseConfig itself is not imported because it opens the Postgres client at import time.
 *
 * What it pins: the web sign-in (or an already signed-in visitor) mints a code bound to PKCE and
 * state, the desktop exchanges it once for its own session, and the signed token the desktop keeps
 * comes back in `set-auth-token` and is accepted by `requireSignature`.
 */
import { DESKTOP_AUTH_CLIENT_ID, DESKTOP_AUTH_ORIGIN } from "@kaipu/domain/constants";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { bearer } from "better-auth/plugins";
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desktopAuthPlugin, DESKTOP_TRUSTED_ORIGINS } from "./desktop-auth";

const WEB_ORIGIN = "http://localhost:3001";
const PASSWORD = "desktop-password-1";
const EMAIL = "ada@example.com";
const REDIRECT_COOKIE = `better-auth.${DESKTOP_AUTH_CLIENT_ID}`;

type Row = Record<string, unknown> & { id: string };
interface Db {
  user: Row[];
  account: Row[];
  session: Row[];
  verification: Row[];
}

function setup(trustedOrigins: string[] = [WEB_ORIGIN, ...DESKTOP_TRUSTED_ORIGINS]) {
  const db: Db = { user: [], account: [], session: [], verification: [] };
  const auth = betterAuth({
    secret: "test-secret-test-secret-test-secret-0123",
    baseURL: WEB_ORIGIN,
    database: memoryAdapter(db as unknown as Record<string, Row[]>),
    emailAndPassword: { enabled: true },
    trustedOrigins,
    // Better Auth skips the origin check when NODE_ENV is "test"; production never does.
    advanced: { disableOriginCheck: false },
    plugins: [bearer({ requireSignature: true }), desktopAuthPlugin()],
  });
  return { db, auth };
}

type Auth = ReturnType<typeof setup>["auth"];

/** Collects Set-Cookie values into a Cookie header, the way a browser would. */
function cookieJar() {
  const jar = new Map<string, string>();
  return {
    store(res: Response) {
      for (const raw of res.headers.getSetCookie()) {
        const [pair] = raw.split(";");
        const index = pair!.indexOf("=");
        const name = pair!.slice(0, index);
        const value = pair!.slice(index + 1);
        if (/max-age=0/i.test(raw) || value === "") jar.delete(name);
        else jar.set(name, value);
      }
    },
    get: (name: string) => jar.get(name),
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}
type Jar = ReturnType<typeof cookieJar>;

async function call(
  auth: Auth,
  path: string,
  init: {
    jar?: Jar;
    body?: object;
    origin?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: init.origin ?? WEB_ORIGIN,
    ...init.headers,
  };
  if (init.jar) headers.cookie = init.jar.header();
  const res = await auth.handler(
    new Request(`${WEB_ORIGIN}/api/auth${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      redirect: "manual",
    }),
  );
  init.jar?.store(res);
  return res;
}

/** What the desktop does before opening the browser: a verifier it keeps, and its S256 hash. */
function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: randomBytes(16).toString("base64url") };
}

function electronQuery(p: { challenge: string; state: string }, clientId = DESKTOP_AUTH_CLIENT_ID) {
  return new URLSearchParams({
    client_id: clientId,
    code_challenge: p.challenge,
    state: p.state,
  }).toString();
}

/** The value of the `better-auth.<client id>` cookie, which is what the desktop's authenticate() decodes. */
function decodeRedirectCookie(value: string): { identifier: string; state: string } {
  return JSON.parse(Buffer.from(decodeURIComponent(value), "base64url").toString("utf8"));
}

async function signUp(auth: Auth) {
  const res = await call(auth, "/sign-up/email", {
    body: { email: EMAIL, password: PASSWORD, name: "Ada" },
  });
  expect(res.status).toBe(200);
}

/** The web sign-in form, carrying the electron query the way fetchOptions.query forwards it. */
async function webSignIn(auth: Auth, p: ReturnType<typeof pkce>, clientId?: string) {
  const jar = cookieJar();
  const res = await call(auth, `/sign-in/email?${electronQuery(p, clientId)}`, {
    jar,
    body: { email: EMAIL, password: PASSWORD },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { electron_authorization_code?: string };
  return { jar, body };
}

async function exchange(
  auth: Auth,
  body: { token: string; state: string; code_verifier: string },
  origin = DESKTOP_AUTH_ORIGIN,
) {
  return call(auth, "/electron/token", { body, origin });
}

async function sessionFor(auth: Auth, bearerToken: string) {
  const res = await call(auth, "/get-session", {
    headers: { authorization: `Bearer ${bearerToken}` },
  });
  return (await res.json()) as { user: { email: string }; session: { token: string } } | null;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("desktop sign-in through the browser", () => {
  it("signs in on the web, exchanges the code and gets a signed bearer token for a new session", async () => {
    const { db, auth } = setup();
    await signUp(auth);
    const p = pkce();

    const { jar, body } = await webSignIn(auth, p);
    const code = body.electron_authorization_code;
    expect(code).toMatch(/^[A-Za-z0-9]{32}$/);

    // The readable cookie the web page hands to the app carries the same code plus the state.
    const cookie = jar.get(REDIRECT_COOKIE);
    expect(cookie).toBeDefined();
    expect(decodeRedirectCookie(cookie!)).toEqual({ identifier: code, state: p.state });
    expect(db.verification.some((v) => v.identifier === `electron:${code}`)).toBe(true);

    const sessionsBefore = db.session.length;
    const res = await exchange(auth, { token: code!, state: p.state, code_verifier: p.verifier });
    expect(res.status).toBe(200);
    const exchanged = (await res.json()) as { token: string; user: { email: string } };
    expect(exchanged.user.email).toBe(EMAIL);

    // A NEW session for the desktop, separate from the browser's.
    expect(db.session.length).toBe(sessionsBefore + 1);
    expect(db.session.at(-1)!.token).toBe(exchanged.token);

    // The bearer plugin hands back the SIGNED token; requireSignature accepts it and nothing else.
    const signed = res.headers.get("set-auth-token");
    expect(signed).toBeTruthy();
    expect(signed!.startsWith(`${exchanged.token}.`)).toBe(true);
    expect((await sessionFor(auth, signed!))?.session.token).toBe(exchanged.token);
    expect(await sessionFor(auth, exchanged.token)).toBeNull();

    // The code is single use: it is gone from the verification table.
    expect(db.verification.some((v) => v.identifier === `electron:${code}`)).toBe(false);
  });

  it("transfers a visitor who is already signed in on the web", async () => {
    const { auth } = setup();
    await signUp(auth);
    const jar = cookieJar();
    await call(auth, "/sign-in/email", { jar, body: { email: EMAIL, password: PASSWORD } });

    const p = pkce();
    const res = await call(auth, `/electron/transfer-user?${electronQuery(p)}`, { jar, body: {} });
    expect(res.status).toBe(200);
    const { electron_authorization_code: code } = (await res.json()) as {
      electron_authorization_code: string;
    };
    expect(decodeRedirectCookie(jar.get(REDIRECT_COOKIE)!)).toEqual({
      identifier: code,
      state: p.state,
    });

    const exchanged = await exchange(auth, {
      token: code,
      state: p.state,
      code_verifier: p.verifier,
    });
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get("set-auth-token")).toBeTruthy();
  });

  it("mints a code on sign-up too, so a new user lands in the app", async () => {
    const { auth } = setup();
    const p = pkce();
    const res = await call(auth, `/sign-up/email?${electronQuery(p)}`, {
      body: { email: EMAIL, password: PASSWORD, name: "Ada" },
    });
    expect(res.status).toBe(200);
    const { electron_authorization_code: code } = (await res.json()) as {
      electron_authorization_code: string;
    };
    const exchanged = await exchange(auth, {
      token: code,
      state: p.state,
      code_verifier: p.verifier,
    });
    expect(exchanged.status).toBe(200);
  });

  it("rejects a wrong PKCE verifier, and the attempt burns the code", async () => {
    const { auth } = setup();
    await signUp(auth);
    const p = pkce();
    const code = (await webSignIn(auth, p)).body.electron_authorization_code!;

    const wrong = await exchange(auth, {
      token: code,
      state: p.state,
      code_verifier: pkce().verifier,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.headers.get("set-auth-token")).toBeNull();

    // consumeVerificationValue deletes the code before the checks run: an attacker who guesses
    // wrong also destroys it, and the real app must start over.
    const retry = await exchange(auth, { token: code, state: p.state, code_verifier: p.verifier });
    expect(retry.status).toBe(404);
  });

  it("rejects a reused code", async () => {
    const { auth } = setup();
    await signUp(auth);
    const p = pkce();
    const code = (await webSignIn(auth, p)).body.electron_authorization_code!;
    const body = { token: code, state: p.state, code_verifier: p.verifier };

    expect((await exchange(auth, body)).status).toBe(200);
    const reuse = await exchange(auth, body);
    expect(reuse.status).toBe(404);
    expect(reuse.headers.get("set-auth-token")).toBeNull();
  });

  it("rejects an expired code (older than 300 s)", async () => {
    const { auth } = setup();
    await signUp(auth);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T12:00:00Z") });
    const p = pkce();
    const code = (await webSignIn(auth, p)).body.electron_authorization_code!;

    vi.setSystemTime(new Date("2026-10-19T12:05:01Z"));
    const res = await exchange(auth, { token: code, state: p.state, code_verifier: p.verifier });
    expect(res.status).toBe(404);
  });

  it("accepts a code just inside its 300 s lifetime", async () => {
    const { auth } = setup();
    await signUp(auth);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T12:00:00Z") });
    const p = pkce();
    const code = (await webSignIn(auth, p)).body.electron_authorization_code!;

    vi.setSystemTime(new Date("2026-10-19T12:04:50Z"));
    const res = await exchange(auth, { token: code, state: p.state, code_verifier: p.verifier });
    expect(res.status).toBe(200);
  });

  it("rejects a wrong state", async () => {
    const { auth } = setup();
    await signUp(auth);
    const p = pkce();
    const code = (await webSignIn(auth, p)).body.electron_authorization_code!;

    const res = await exchange(auth, {
      token: code,
      state: "someone-elses-state",
      code_verifier: p.verifier,
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("set-auth-token")).toBeNull();
  });

  it("mints nothing for a client_id other than the desktop's", async () => {
    const { db, auth } = setup();
    await signUp(auth);
    const p = pkce();

    const { jar, body } = await webSignIn(auth, p, "not-kaipu");
    expect(body.electron_authorization_code).toBeUndefined();
    expect(jar.get(REDIRECT_COOKIE)).toBeUndefined();
    expect(db.verification.some((v) => String(v.identifier).startsWith("electron:"))).toBe(false);

    const transfer = await call(auth, `/electron/transfer-user?${electronQuery(p, "not-kaipu")}`, {
      jar,
      body: {},
    });
    expect(transfer.status).toBe(400);
  });

  it("trusts the desktop's bare-scheme Origin and still refuses an unknown one", async () => {
    const { auth } = setup();
    // A request that carries a cookie is always origin-checked; an untrusted origin is refused.
    const withCookie = { cookie: "better-auth.session_token=anything" };
    const body = { token: "x".repeat(32), state: "s", code_verifier: "v" };

    const desktop = await call(auth, "/electron/token", {
      body,
      origin: DESKTOP_AUTH_ORIGIN,
      headers: withCookie,
    });
    // Passes the origin check and reaches the handler, which finds no such code.
    expect(desktop.status).toBe(404);

    const evil = await call(auth, "/electron/token", {
      body,
      origin: "https://evil.example",
      headers: withCookie,
    });
    expect(evil.status).toBe(403);
  });

  it("needs the bare-scheme pattern: a host-bearing desktop pattern does not match `kaipu:/`", async () => {
    const { auth } = setup([WEB_ORIGIN, "kaipu://app", "kaipu-record://app"]);
    const res = await call(auth, "/electron/token", {
      body: { token: "x".repeat(32), state: "s", code_verifier: "v" },
      origin: DESKTOP_AUTH_ORIGIN,
      headers: { cookie: "better-auth.session_token=anything" },
    });
    expect(res.status).toBe(403);
  });
});
