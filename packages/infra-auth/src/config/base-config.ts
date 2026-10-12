import { db } from "@kaipu/infra-db/client";
import {
  userTable,
  accountTable,
  sessionTable,
  verificationTable,
  rateLimitTable,
} from "@kaipu/infra-db/schemas";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const scryptAsync = (password: string, salt: string, keylen: number): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, (err, key) => (err ? reject(err) : resolve(key))),
  );

export const baseConfig: BetterAuthOptions = {
  appName: "Kaipu Record",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: userTable,
      account: accountTable,
      session: sessionTable,
      verification: verificationTable,
      rateLimit: rateLimitTable,
    },
  }),
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 10 * 60, // Cache duration in seconds (10 minutes)
    },
  },
  emailAndPassword: {
    enabled: true,
    // Sign-in is refused until the address is verified. This also makes sign-up answer
    // identically for new and already-registered addresses (no account enumeration),
    // and stops anyone squatting an address they do not own.
    requireEmailVerification: true,
    password: {
      /**
       * Hash password using scrypt from node:crypto (async: does not block the isolate).
       * Stored format is `salt:hash`, unchanged, so existing hashes keep verifying.
       */
      hash: async (password: string): Promise<string> => {
        const salt = randomBytes(16).toString("hex");
        const hash = await scryptAsync(password, salt, 64);
        return `${salt}:${hash.toString("hex")}`;
      },

      /**
       * Verify password against hash in constant time.
       */
      verify: async ({ hash, password }: { hash: string; password: string }): Promise<boolean> => {
        const [salt, key] = hash.split(":");
        if (!salt || !key) return false;

        const keyBuffer = Buffer.from(key, "hex");
        const hashBuffer = await scryptAsync(password, salt, 64);
        if (keyBuffer.length !== hashBuffer.length) return false;
        return timingSafeEqual(keyBuffer, hashBuffer);
      },
    },
  },
  account: {
    // Provider tokens are encrypted at rest with BETTER_AUTH_SECRET. No social provider is
    // configured today; this keeps one from storing plaintext tokens if it is added.
    encryptOAuthTokens: true,
  },
  rateLimit: {
    // Explicit: Better Auth only enables the limiter when NODE_ENV === "production", and the
    // Worker does not set it. Disabled only under the test runner.
    enabled: process.env.NODE_ENV !== "test",
    // Per-isolate memory is useless on Workers (each isolate has its own counters), so the
    // counters live in the database, where Better Auth updates them atomically.
    storage: "database",
    window: 10,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 60, max: 10 },
      "/request-password-reset": { window: 60 * 60, max: 5 },
      "/forget-password": { window: 60 * 60, max: 5 },
      "/reset-password": { window: 15 * 60, max: 10 },
      "/send-verification-email": { window: 60 * 60, max: 5 },
    },
  },
  advanced: {
    // Cloudflare overwrites cf-connecting-ip at the edge, so a client cannot choose it.
    // x-forwarded-for is client-controlled and must not feed rate limits or session metadata.
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip"],
    },
    // Lax: the web app reaches the API through a same-origin proxy and the desktop app uses
    // a bearer token, so no cookie is ever needed on cross-site requests.
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: true,
      httpOnly: true,
    },
  },
  // plugins: [customSession(getCustomSession)],
  // `requireSignature` rejects a bare, unsigned session id in the Authorization header. Without
  // it the plugin re-signs whatever it was handed and then verifies its own signature — a
  // tautology that accepts a raw session id. Desktop always sends the full signed cookie value
  // straight from the `set-auth-token` response header, never a hand-built token, so requiring
  // the signature costs nothing and closes that acceptance path.
  plugins: [bearer({ requireSignature: true })],
};

// export const options = {
//   plugins: [customSession(getCustomSession)],
// } satisfies BetterAuthOptions;
