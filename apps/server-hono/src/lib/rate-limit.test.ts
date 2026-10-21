/**
 * Pins the rate limiting the API relies on (audit F-3/F-4): explicitly enabled, keyed on
 * cf-connecting-ip only, per path, with the stricter rules on the credential endpoints.
 * Runs in-process on the in-memory adapter, which implements the same conditional increment
 * the database storage uses.
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { desktopAuthPlugin } from "./desktop-auth";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/kaipu_test";

const { baseConfig } = await import("@kaipu/infra-auth");

const SECRET = "test-secret-at-least-32-characters-long!!";
const BASE_URL = "http://localhost:3000";
const WEB_ORIGIN = "http://localhost:3001";

function createLimitedAuth() {
  const db: Record<string, unknown[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
  };
  return betterAuth({
    ...baseConfig,
    database: memoryAdapter(db),
    secret: SECRET,
    baseURL: BASE_URL,
    trustedOrigins: [WEB_ORIGIN],
    // The limiter is off under the test runner; this suite is about the limiter itself.
    rateLimit: { ...baseConfig.rateLimit, enabled: true, storage: "memory" },
    // lib/auth.ts adds the desktop plugin; its endpoints have rules above.
    plugins: [...(baseConfig.plugins ?? []), desktopAuthPlugin()],
  });
}

type Auth = ReturnType<typeof createLimitedAuth>;

function signIn(auth: Auth, headers: Record<string, string>) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB_ORIGIN, ...headers },
      body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password" }),
    }),
  );
}

function getSession(auth: Auth, headers: Record<string, string>) {
  return auth.handler(new Request(`${BASE_URL}/api/auth/get-session`, { headers }));
}

describe("baseConfig rate limiting", () => {
  it("is explicitly enabled and stored in the database outside the test runner", () => {
    expect(baseConfig.rateLimit?.storage).toBe("database");
    expect(baseConfig.rateLimit?.enabled).toBe(process.env.NODE_ENV !== "test");
    expect(baseConfig.advanced?.ipAddress?.ipAddressHeaders).toEqual(["cf-connecting-ip"]);
  });

  it("names only endpoints Better Auth registers (a stale key would be dead config)", async () => {
    const auth = createLimitedAuth();
    const registered = new Set(Object.values(auth.api).map((endpoint) => endpoint.path));
    for (const path of Object.keys(baseConfig.rateLimit?.customRules ?? {})) {
      expect(registered.has(path), path).toBe(true);
    }
  });

  it("allows five sign-in attempts per address and minute, then answers 429", async () => {
    const auth = createLimitedAuth();
    const ip = { "cf-connecting-ip": "203.0.113.7" };
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await signIn(auth, ip)).status, `attempt ${attempt}`).toBe(401);
    }
    const limited = await signIn(auth, ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("x-retry-after"))).toBeGreaterThan(0);
  });

  it("keys the limit on cf-connecting-ip: another address is not limited", async () => {
    const auth = createLimitedAuth();
    for (let attempt = 1; attempt <= 6; attempt++) {
      await signIn(auth, { "cf-connecting-ip": "203.0.113.7" });
    }
    expect((await signIn(auth, { "cf-connecting-ip": "203.0.113.8" })).status).toBe(401);
  });

  it("ignores x-forwarded-for, so a client cannot pick its own bucket", async () => {
    const auth = createLimitedAuth();
    const ip = { "cf-connecting-ip": "203.0.113.7" };
    for (let attempt = 1; attempt <= 5; attempt++) {
      await signIn(auth, { ...ip, "x-forwarded-for": `198.51.100.${attempt}` });
    }
    expect((await signIn(auth, { ...ip, "x-forwarded-for": "198.51.100.99" })).status).toBe(429);
  });

  it("never limits get-session, the read every page load and SSR check makes", async () => {
    const auth = createLimitedAuth();
    for (let call = 1; call <= 120; call++) {
      const res = await getSession(auth, { "cf-connecting-ip": "203.0.113.7", cookie: "x=1" });
      expect(res.status, `call ${call}`).toBe(200);
    }
  });
});
