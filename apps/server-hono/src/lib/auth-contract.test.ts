/**
 * Pins the Better Auth behaviour the apps depend on, so a library upgrade that changes it fails
 * here instead of in production. Runs fully in-process: the drizzle-backed instance never reaches
 * a database (only Better Auth's schema check runs), and the request tests use the in-memory
 * adapter with the same options `lib/auth.ts` builds on top of `baseConfig`.
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { customSession } from "better-auth/plugins";
import { beforeAll, describe, expect, it } from "vitest";

// `@kaipu/infra-db/client` builds a Neon client at import time and throws on an empty URL. Neon
// only parses it; nothing in this file issues a query. Illustrative value, not a real database.
process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/kaipu_test";

const { baseConfig, getCustomSession } = await import("@kaipu/infra-auth");

// Illustrative values only.
const SECRET = "test-secret-at-least-32-characters-long!!";
const BASE_URL = "http://localhost:3000";
const WEB_ORIGIN = "http://localhost:3001";
// Must stay byte-identical to the desktop client and the trustedOrigins entry in lib/auth.ts.
const DESKTOP_ORIGIN = "kaipu-record://app";

// What Electron's main-process fetch() attaches (see apps/kaipu-record/src/main/services/auth-client.ts).
const DESKTOP_HEADERS = {
  "Content-Type": "application/json",
  Origin: DESKTOP_ORIGIN,
  "Sec-Fetch-Site": "cross-site",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
};

function createTestAuth() {
  const db: Record<string, unknown[]> = { user: [], session: [], account: [], verification: [] };
  return betterAuth({
    ...baseConfig,
    database: memoryAdapter(db),
    secret: SECRET,
    baseURL: BASE_URL,
    trustedOrigins: [WEB_ORIGIN, DESKTOP_ORIGIN],
    // Better Auth turns the origin check off when NODE_ENV is "test"; production runs with it on.
    advanced: { ...baseConfig.advanced, disableOriginCheck: false },
    plugins: [...(baseConfig.plugins ?? []), customSession(getCustomSession, baseConfig)],
  });
}

type TestAuth = ReturnType<typeof createTestAuth>;

function post(auth: TestAuth, path: string, body: unknown, headers: Record<string, string>) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

function getSessionWithBearer(auth: TestAuth, token: string) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/get-session`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}

describe("baseConfig database adapter", () => {
  it("passes Better Auth's schema check, so requests are not rejected before reaching the DB", async () => {
    // Since 1.7 every endpoint first compares the adapter's Drizzle schema with the tables
    // Better Auth writes; a model missing from `schema` fails every request, not just the
    // flows that use it. No cookie means getSession answers without a query.
    const auth = betterAuth({ ...baseConfig, secret: SECRET, baseURL: BASE_URL });
    await expect(auth.api.getSession({ headers: new Headers() })).resolves.toBeNull();
  });
});

describe("custom scrypt password hashing", () => {
  const password = baseConfig.emailAndPassword?.password;

  it("still verifies a hash in the stored `salt:hex` format", async () => {
    // Fixed fixture: scrypt("correct horse", salt, 64) computed once, outside this code, in the
    // format the account table already holds. A hash change in the config would break it.
    const stored =
      "00112233445566778899aabbccddeeff:" +
      "3e19ebeabf15ad17c24de695284e79441c0d80c6d98b95a3c052c58a0d57b09f" +
      "83b0742a5805af28a0b5bbcf673af62819b91eb830a104fb0bb42def767f52aa";
    await expect(password?.verify?.({ hash: stored, password: "correct horse" })).resolves.toBe(
      true,
    );
    await expect(password?.verify?.({ hash: stored, password: "wrong" })).resolves.toBe(false);
  });

  it("round-trips through hash and verify", async () => {
    const hash = await password?.hash?.("s3cret-password");
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    await expect(password?.verify?.({ hash: hash!, password: "s3cret-password" })).resolves.toBe(
      true,
    );
  });
});

describe("desktop bearer flow", () => {
  let auth: TestAuth;
  let token: string;

  beforeAll(async () => {
    auth = createTestAuth();
    const res = await post(
      auth,
      "sign-up/email",
      { email: "desktop@example.com", password: "password123", name: "Desk Top" },
      DESKTOP_HEADERS,
    );
    expect(res.status).toBe(200);
    token = res.headers.get("set-auth-token") ?? "";
  });

  it("sign-up returns a signed token in the set-auth-token header", () => {
    // Signed cookie value: `<session token>.<signature>`.
    expect(token).toMatch(/^[^.]+\..+$/);
  });

  it("sign-in with the desktop Origin returns set-auth-token and the user", async () => {
    const res = await post(
      auth,
      "sign-in/email",
      { email: "desktop@example.com", password: "password123" },
      DESKTOP_HEADERS,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-auth-token")).toBeTruthy();
    const body = (await res.json()) as { user: { email: string; name: string } };
    expect(body.user).toMatchObject({ email: "desktop@example.com", name: "Desk Top" });
  });

  it.each(["https://evil.example", "kaipu-record://app.evil.example", "kaipu-record://other"])(
    "rejects sign-in from the untrusted Origin %s",
    async (origin) => {
      const res = await post(
        auth,
        "sign-in/email",
        { email: "desktop@example.com", password: "password123" },
        { ...DESKTOP_HEADERS, Origin: origin },
      );
      expect(res.status).toBe(403);
    },
  );

  it("answers a short sign-up password with the PASSWORD_TOO_SHORT code the desktop maps", async () => {
    const res = await post(
      auth,
      "sign-up/email",
      { email: "short@example.com", password: "short", name: "Short" },
      DESKTOP_HEADERS,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("PASSWORD_TOO_SHORT");
  });

  it("get-session accepts the signed bearer token and returns the customSession shape", async () => {
    const res = await getSessionWithBearer(auth, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: Record<string, unknown>;
      session: Record<string, unknown>;
    };
    expect(Object.keys(body).sort()).toEqual(["session", "user"]);
    expect(body.user).toMatchObject({ email: "desktop@example.com", name: "Desk Top" });
    expect(body.user.id).toEqual(body.session.userId);
    expect(body.session.token).toBe(token.split(".")[0]);
  });

  it("requireSignature: an unsigned session token is not accepted", async () => {
    const res = await getSessionWithBearer(auth, token.split(".")[0]!);
    expect(await res.json()).toBeNull();
  });

  it("sign-out with the bearer token (no Origin, no cookie) ends the session", async () => {
    const signIn = await post(
      auth,
      "sign-in/email",
      { email: "desktop@example.com", password: "password123" },
      DESKTOP_HEADERS,
    );
    const fresh = signIn.headers.get("set-auth-token")!;
    const out = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: { Authorization: `Bearer ${fresh}` },
      }),
    );
    expect(out.status).toBe(200);
    expect(await (await getSessionWithBearer(auth, fresh)).json()).toBeNull();
  });
});
