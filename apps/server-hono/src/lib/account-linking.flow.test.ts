/**
 * End-to-end linking flows through a REAL Better Auth 1.7.11 instance, in process: the in-memory
 * adapter instead of Postgres, and a fake Google token endpoint instead of Google. Nothing here
 * reaches a database, Google, Infisical or a deployed API.
 *
 * What this pins that the unit tests cannot: Better Auth's internal ordering (link → our hook →
 * emailVerified → createSession), how a throw in our hook surfaces, and that revoking sessions in
 * the hook spares the session the sign-in creates. A Better Auth upgrade that changes any of these
 * breaks here, loudly.
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountLinkingHooks, accountOptions, credentialDroppedNoticeId } from "./account-linking";
import { buildSocialProviders } from "./social-providers";

const ORIGIN = "http://localhost:3001";
const PASSWORD = "attacker-password-1";

type Row = Record<string, unknown> & { id: string };
interface Db {
  user: Row[];
  account: Row[];
  session: Row[];
  verification: Row[];
}

/** Google identity the fake token endpoint returns for the next callback. */
let nextGoogle: { sub: string; email: string; email_verified: boolean; name: string };
let failAccountDeletes = false;

function fakeIdToken(claims: object): string {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "RS256", kid: "test" })}.${b64(claims)}.not-a-signature`;
}

function setup() {
  const db: Db = { user: [], account: [], session: [], verification: [] };
  const auth = betterAuth({
    secret: "test-secret-test-secret-test-secret-0123",
    baseURL: ORIGIN,
    database: memoryAdapter(db as unknown as Record<string, Row[]>),
    emailAndPassword: { enabled: true },
    socialProviders: buildSocialProviders({
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
    }),
    account: accountOptions,
    databaseHooks: {
      account: {
        create: accountLinkingHooks.account.create,
        // Test-only fault injection: makes the pre-hijack cleanup fail half-way.
        delete: {
          before: async () => {
            if (failAccountDeletes) throw new Error("simulated database failure");
          },
        },
      },
    },
  });
  return { db, auth };
}

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
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

type Auth = ReturnType<typeof setup>["auth"];
type Jar = ReturnType<typeof cookieJar>;

async function call(
  auth: Auth,
  jar: Jar,
  path: string,
  init: { method?: string; body?: object } = {},
) {
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        cookie: jar.header(),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      redirect: "manual",
    }),
  );
  jar.store(res);
  return res;
}

/** Runs the Google redirect dance: start (sign-in or link) → Google → callback. */
async function googleRoundTrip(
  auth: Auth,
  jar: Jar,
  start: { path: "/sign-in/social" | "/link-social"; body: object },
) {
  const begin = await call(auth, jar, start.path, { body: { provider: "google", ...start.body } });
  expect(begin.status).toBe(200);
  const { url } = (await begin.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  return call(auth, jar, `/callback/google?code=fake-code&state=${state}`);
}

async function signUp(auth: Auth, email: string) {
  const jar = cookieJar();
  const res = await call(auth, jar, "/sign-up/email", {
    body: { email, password: PASSWORD, name: "First Registrant" },
  });
  expect(res.status).toBe(200);
  return jar;
}

async function passwordSignInStatus(auth: Auth, email: string, password = PASSWORD) {
  const res = await call(auth, cookieJar(), "/sign-in/email", { body: { email, password } });
  return res.status;
}

const userByEmail = (db: Db, email: string) => db.user.find((u) => u.email === email)!;
const accountsOf = (db: Db, userId: string) =>
  db.account.filter((a) => a.userId === userId).map((a) => a.providerId);
/** Better Auth's own account id (what `unlinkAccount` takes since 1.7), not the provider's. */
const googleAccountIdOf = (db: Db, userId: string) =>
  db.account.find((a) => a.userId === userId && a.providerId === "google")!.id;
const sessionsOf = (db: Db, userId: string) => db.session.filter((s) => s.userId === userId);

let logs: string[];
beforeEach(() => {
  failAccountDeletes = false;
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // The only network call in the flow: Google's token endpoint. getUserInfo decodes the id_token.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://oauth2.googleapis.com/token")) {
        throw new Error(`unexpected network call in a test: ${url}`);
      }
      return new Response(
        JSON.stringify({
          access_token: "fake-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid email profile",
          id_token: fakeIdToken(nextGoogle),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Continue with Google — implicit sign-in", () => {
  it("new email: creates a verified user with one google account and lands on the callback", async () => {
    const { db, auth } = setup();
    nextGoogle = { sub: "g-new", email: "new@example.com", email_verified: true, name: "New" };
    const jar = cookieJar();
    const res = await googleRoundTrip(auth, jar, {
      path: "/sign-in/social",
      body: { callbackURL: "/dashboard", newUserCallbackURL: "/dashboard" },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard");
    const user = userByEmail(db, "new@example.com");
    expect(user.emailVerified).toBe(true);
    expect(accountsOf(db, user.id)).toEqual(["google"]);
    expect(sessionsOf(db, user.id)).toHaveLength(1);
  });

  it("stores Google's tokens encrypted, never as received", async () => {
    const { db, auth } = setup();
    nextGoogle = { sub: "g-enc", email: "enc@example.com", email_verified: true, name: "Enc" };
    await googleRoundTrip(auth, cookieJar(), {
      path: "/sign-in/social",
      body: { callbackURL: "/dashboard" },
    });
    const google = db.account.find((a) => a.providerId === "google")!;
    expect(google.accessToken).toBeTruthy();
    expect(google.accessToken).not.toBe("fake-access-token");
  });

  it("verified email+password account: links, password and old sessions keep working (FR5)", async () => {
    const { db, auth } = setup();
    const email = "verified@example.com";
    const oldJar = await signUp(auth, email);
    userByEmail(db, email).emailVerified = true;
    nextGoogle = { sub: "g-ver", email, email_verified: true, name: "Google Name" };

    const res = await googleRoundTrip(auth, cookieJar(), {
      path: "/sign-in/social",
      body: { callbackURL: "/dashboard" },
    });

    expect(res.headers.get("location")).toBe("/dashboard");
    const user = userByEmail(db, email);
    expect(accountsOf(db, user.id).sort()).toEqual(["credential", "google"]);
    expect(sessionsOf(db, user.id)).toHaveLength(2);
    expect(await passwordSignInStatus(auth, email)).toBe(200);
    // Q11: linking never overwrites the profile.
    expect(user.name).toBe("First Registrant");
    const oldSession = await call(auth, oldJar, "/get-session");
    expect(await oldSession.json()).not.toBeNull();
  });

  it("UNVERIFIED email+password account: drops the password, revokes old sessions, keeps the new one (FR6)", async () => {
    const { db, auth } = setup();
    const email = "victim@example.com";
    await signUp(auth, email);
    const user = userByEmail(db, email);
    const before = sessionsOf(db, user.id).map((s) => s.id);
    expect(before).toHaveLength(1);
    nextGoogle = { sub: "g-victim", email, email_verified: true, name: "Real Owner" };

    const jar = cookieJar();
    const res = await googleRoundTrip(auth, jar, {
      path: "/sign-in/social",
      body: { callbackURL: "/dashboard" },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard");
    expect(accountsOf(db, user.id)).toEqual(["google"]);
    expect(userByEmail(db, email).emailVerified).toBe(true);
    const after = sessionsOf(db, user.id).map((s) => s.id);
    expect(after).toHaveLength(1);
    expect(after).not.toContain(before[0]);
    // The new browser session works; the old password does not.
    const session = await call(auth, jar, "/get-session");
    expect(((await session.json()) as { user: { id: string } }).user.id).toBe(user.id);
    expect(await passwordSignInStatus(auth, email)).toBe(401);
    // One-time banner (Q3) and the structured event (ids only).
    expect(db.verification.some((v) => v.identifier === credentialDroppedNoticeId(user.id))).toBe(
      true,
    );
    const event = logs
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === "auth.link.unverified_credential_dropped");
    expect(event).toMatchObject({ userId: user.id });
    expect(Object.keys(event!).sort()).toEqual(["name", "ts", "userId"]);
  });

  it("a Google account the squatter linked while unverified is dropped with the password", async () => {
    // The pre-hijack residue: whoever registered victim@ without owning the inbox links their
    // own Google account (FR8 allows a different email), the owner later claims the address
    // through Google, and the squatter's Google row must not stay as a back door.
    const { db, auth } = setup();
    const email = "victim@example.com";
    const squatterJar = await signUp(auth, email);
    nextGoogle = {
      sub: "g-squatter",
      email: "squatter@example.com",
      email_verified: true,
      name: "S",
    };
    await googleRoundTrip(auth, squatterJar, {
      path: "/link-social",
      body: { callbackURL: "/dashboard/profile", errorCallbackURL: "/dashboard/profile" },
    });
    const user = userByEmail(db, email);
    expect(accountsOf(db, user.id).sort()).toEqual(["credential", "google"]);

    nextGoogle = { sub: "g-owner", email, email_verified: true, name: "Real Owner" };
    const res = await googleRoundTrip(auth, cookieJar(), {
      path: "/sign-in/social",
      body: { callbackURL: "/dashboard" },
    });
    expect(res.headers.get("location")).toBe("/dashboard");

    expect(db.account.filter((row) => row.userId === user.id).map((row) => row.accountId)).toEqual([
      "g-owner",
    ]);
    // The squatter's Google account now lands in a fresh user, not in the owner's.
    nextGoogle = {
      sub: "g-squatter",
      email: "squatter@example.com",
      email_verified: true,
      name: "S",
    };
    await googleRoundTrip(auth, cookieJar(), {
      path: "/sign-in/social",
      body: { callbackURL: "/" },
    });
    expect(userByEmail(db, "squatter@example.com").id).not.toBe(user.id);
  });

  it("if the cleanup fails, the sign-in fails and nothing is linked (fails closed)", async () => {
    const { db, auth } = setup();
    const email = "flaky@example.com";
    await signUp(auth, email);
    const user = userByEmail(db, email);
    nextGoogle = { sub: "g-flaky", email, email_verified: true, name: "Owner" };
    failAccountDeletes = true;

    const res = await googleRoundTrip(auth, cookieJar(), {
      path: "/sign-in/social",
      body: { callbackURL: "/dashboard", errorCallbackURL: "/auth/login" },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login?error=unable_to_link_account");
    expect(accountsOf(db, user.id)).toEqual(["credential"]);
    expect(userByEmail(db, email).emailVerified).toBe(false);
  });

  it("Google email not verified + existing user: refused, no account row (FR7)", async () => {
    const { db, auth } = setup();
    const email = "unproven@example.com";
    await signUp(auth, email);
    nextGoogle = { sub: "g-unproven", email, email_verified: false, name: "Someone" };

    const res = await googleRoundTrip(auth, cookieJar(), {
      path: "/sign-in/social",
      body: { callbackURL: "/dashboard", errorCallbackURL: "/auth/login" },
    });

    expect(res.headers.get("location")).toBe("/auth/login?error=account_not_linked");
    expect(db.account.filter((a) => a.providerId === "google")).toHaveLength(0);
    expect(await passwordSignInStatus(auth, email)).toBe(200);
  });

  it("the cancelled consent screen comes back as access_denied on the error URL", async () => {
    const { auth } = setup();
    const jar = cookieJar();
    const begin = await call(auth, jar, "/sign-in/social", {
      body: { provider: "google", callbackURL: "/dashboard", errorCallbackURL: "/auth/login" },
    });
    const state = new URL(((await begin.json()) as { url: string }).url).searchParams.get("state");
    const res = await call(auth, jar, `/callback/google?error=access_denied&state=${state}`);
    expect(res.headers.get("location")).toBe("/auth/login?error=access_denied");
  });

  it("the id-token sign-in path is closed", async () => {
    const { auth } = setup();
    const res = await call(auth, cookieJar(), "/sign-in/social", {
      body: { provider: "google", idToken: { token: fakeIdToken({ sub: "x" }) } },
    });
    // 1.7 answers 404 (no id-token sign-in for this provider); 1.4 answered 401. Closed either way.
    expect(res.status).toBe(404);
  });
});

describe("Sign-in methods — manual link, unlink, set password", () => {
  async function signedIn(auth: Auth, db: Db, email: string, verified: boolean) {
    const jar = await signUp(auth, email);
    userByEmail(db, email).emailVerified = verified;
    return jar;
  }

  it("links a Google account with a different email and keeps the password (FR8)", async () => {
    const { db, auth } = setup();
    const email = "owner@example.com";
    const jar = await signedIn(auth, db, email, false);
    nextGoogle = { sub: "g-work", email: "work@example.com", email_verified: true, name: "Work" };

    const res = await googleRoundTrip(auth, jar, {
      path: "/link-social",
      body: { callbackURL: "/dashboard/profile", errorCallbackURL: "/dashboard/profile" },
    });

    expect(res.headers.get("location")).toBe("/dashboard/profile");
    const user = userByEmail(db, email);
    expect(accountsOf(db, user.id).sort()).toEqual(["credential", "google"]);
    expect(user.email).toBe(email);
    expect(user.emailVerified).toBe(false);
    expect(sessionsOf(db, user.id)).toHaveLength(1);
  });

  it("same verified email by a signed-in unverified user: verifies, keeps the password (Q4)", async () => {
    const { db, auth } = setup();
    const email = "same@example.com";
    const jar = await signedIn(auth, db, email, false);
    nextGoogle = { sub: "g-same", email, email_verified: true, name: "Same" };

    await googleRoundTrip(auth, jar, {
      path: "/link-social",
      body: { callbackURL: "/dashboard/profile" },
    });

    const user = userByEmail(db, email);
    expect(user.emailVerified).toBe(true);
    expect(accountsOf(db, user.id).sort()).toEqual(["credential", "google"]);
    expect(await passwordSignInStatus(auth, email)).toBe(200);
    const session = await call(auth, jar, "/get-session");
    expect(await session.json()).not.toBeNull();
  });

  it("a Google account already linked to another user is refused", async () => {
    const { db, auth } = setup();
    nextGoogle = { sub: "g-taken", email: "taken@example.com", email_verified: true, name: "T" };
    await googleRoundTrip(auth, cookieJar(), {
      path: "/sign-in/social",
      body: { callbackURL: "/dashboard" },
    });
    const jar = await signedIn(auth, db, "other@example.com", true);

    const res = await googleRoundTrip(auth, jar, {
      path: "/link-social",
      body: { callbackURL: "/dashboard/profile", errorCallbackURL: "/dashboard/profile" },
    });

    expect(res.headers.get("location")).toBe(
      "/dashboard/profile?error=account_already_linked_to_different_user",
    );
    expect(accountsOf(db, userByEmail(db, "other@example.com").id)).toEqual(["credential"]);
  });

  it("unlinking the last sign-in method is refused; unlinking Google with a password left works", async () => {
    const { db, auth } = setup();
    nextGoogle = { sub: "g-only", email: "only@example.com", email_verified: true, name: "Only" };
    const googleJar = cookieJar();
    await googleRoundTrip(auth, googleJar, {
      path: "/sign-in/social",
      body: { callbackURL: "/dashboard" },
    });
    const onlyUser = userByEmail(db, "only@example.com");
    const refused = await call(auth, googleJar, "/unlink-account", {
      body: { accountId: googleAccountIdOf(db, onlyUser.id) },
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { code: string }).code).toBe("FAILED_TO_UNLINK_LAST_ACCOUNT");

    const email = "both@example.com";
    const jar = await signedIn(auth, db, email, true);
    nextGoogle = { sub: "g-both", email, email_verified: true, name: "Both" };
    await googleRoundTrip(auth, jar, { path: "/link-social", body: { callbackURL: "/x" } });
    const ok = await call(auth, jar, "/unlink-account", {
      body: { accountId: googleAccountIdOf(db, userByEmail(db, email).id) },
    });
    expect(ok.status).toBe(200);
    expect(accountsOf(db, userByEmail(db, email).id)).toEqual(["credential"]);
  });

  it("a Google-only user sets a password, stays signed in, then signs in with it; a second time fails (FR10)", async () => {
    const { db, auth } = setup();
    const email = "gonly@example.com";
    nextGoogle = { sub: "g-gonly", email, email_verified: true, name: "G" };
    const jar = cookieJar();
    await googleRoundTrip(auth, jar, {
      path: "/sign-in/social",
      body: { callbackURL: "/dashboard" },
    });
    const headers = new Headers({ cookie: jar.header() });

    await auth.api.setPassword({ body: { newPassword: "fresh-password-1" }, headers });

    const user = userByEmail(db, email);
    expect(accountsOf(db, user.id).sort()).toEqual(["credential", "google"]);
    expect(await call(auth, jar, "/get-session").then((r) => r.json())).not.toBeNull();
    expect(await passwordSignInStatus(auth, email, "fresh-password-1")).toBe(200);
    await expect(
      auth.api.setPassword({ body: { newPassword: "another-password-1" }, headers }),
    ).rejects.toMatchObject({ body: { code: "PASSWORD_ALREADY_SET" } });
  });
});
