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
    // Explicit rather than Better Auth's default (on only when NODE_ENV === "production").
    // wrangler inlines NODE_ENV as "production" at deploy and vitest sets "test", so this is
    // on everywhere except under the test runner; it no longer depends on who sets NODE_ENV.
    enabled: process.env.NODE_ENV !== "test",
    // Per-isolate memory is useless on Workers (each isolate has its own counters), so the
    // counters live in the database, where Better Auth updates them atomically (ADR 0029).
    storage: "database",
    window: 10,
    max: 100,
    // Keys match the endpoint path exactly (Better Auth strips the base path first). A rule
    // here replaces the library's built-in special rule for that path.
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 60, max: 10 },
      "/request-password-reset": { window: 60 * 60, max: 5 },
      "/reset-password": { window: 15 * 60, max: 10 },
      "/send-verification-email": { window: 60 * 60, max: 5 },
      // The desktop code exchange (ADR 0025). The code is single-use, 300 s and PKCE-bound, so
      // the limit only caps database load; the default 100/10 s would be far looser.
      "/electron/token": { window: 60, max: 10 },
      "/electron/transfer-user": { window: 60, max: 10 },
      // Not limited: it is a cookie/bearer read that every page load makes, limiting it costs
      // two database queries per call for no protection, and the web app's SSR calls it
      // server-side where a missing client address would collapse every user into one
      // shared bucket and sign everyone out at once.
      "/get-session": false,
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
