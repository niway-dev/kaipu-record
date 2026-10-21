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
import { hashPassword, verifyPassword } from "./password";

export const baseConfig: BetterAuthOptions = {
  appName: "Kaipu Record",
  database: drizzleAdapter(db, {
    provider: "pg",
    // Every model Better Auth writes must be listed. Since 1.7 the adapter checks this map
    // against the tables it expects before every endpoint call, and a missing one fails all
    // requests (SCHEMA_MISMATCH), not just the flows that use it. `verification` holds OAuth
    // state (storeStateStrategy defaults to "database" when a database is configured),
    // password-reset tokens and one-time notices. `rateLimit` holds the limiter's counters
    // (`rateLimit.storage: "database"` below).
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
    password: {
      // Async scrypt + constant-time compare (audit F-10), same `salt:hash` stored format as
      // before so existing hashes keep verifying. See ./password.ts and its tests.
      hash: hashPassword,
      verify: verifyPassword,
    },
  },
  rateLimit: {
    // Explicit: Better Auth only enables the limiter when NODE_ENV === "production", and the
    // Worker does not set it. Disabled only under the test runner.
    enabled: process.env.NODE_ENV !== "test",
    // Per-isolate memory is useless on Workers (each isolate has its own counters), so the
    // counters live in the database, where Better Auth updates them atomically (ADR 0029).
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
  // `requireSignature` rejects a bare, unsigned session id in the Authorization header. Without
  // it the plugin re-signs whatever it was handed and then verifies its own signature — a
  // tautology that accepts a raw session id. Desktop always sends the full signed cookie value
  // straight from the `set-auth-token` response header, never a hand-built token, so requiring
  // the signature costs nothing and closes that acceptance path.
  plugins: [bearer({ requireSignature: true })],
};
