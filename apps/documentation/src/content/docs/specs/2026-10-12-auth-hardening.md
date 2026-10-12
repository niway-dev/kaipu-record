---
title: Authentication hardening — design spec
description: Upgrade Better Auth and oRPC past their advisories, turn on durable rate limiting keyed by the Cloudflare client IP, require a verified email before a session exists, reject cross-site cookie writes on /api/v1, and close four smaller gaps (constant-time password compare, secret length, sign-up enumeration, OAuth tokens at rest). Linear NIW2-324.
---

# Authentication hardening — design spec

**Ticket:** NIW2-324 · **Branch:** `feature/niw2-324-harden-authentication-and-upgrade-vulnerable-dependencies` ·
**Status:** design — the branch holds one unverified WIP commit (`b0837f3`) plus this spec; nothing
here is marked done unless the [Implementation status](#implementation-status) section says the
branch contains it and it has been verified.

**Source:** the 2026-10-12 security audit (private, not in the repository): API report findings
F-3, F-4, F-5, F-7, F-10, F-11, F-13; web report finding #2; dependency scan. The audit ran on
`49b1780`; every claim below was re-checked against `main` at `400c80e` and file:line references
point at that revision unless stated otherwise.

---

## One-minute block

### Summary

Kaipu's API (`apps/server-hono`, Hono + oRPC on Cloudflare Workers, Better Auth 1.4.18) has no
effective brute-force protection: Better Auth's limiter is only on when `NODE_ENV=production`,
which nothing sets for the Worker, and its default store is per-isolate memory, which Workers do
not share. Sign-in does not require a verified email, so anyone can register an address they do
not own and hold a session on it. Browser sessions travel in a `SameSite=None` cookie and the
oRPC mutation routes under `/api/v1` do no origin check. Four small gaps sit next to those: a
non-constant-time password compare, no minimum length on `BETTER_AUTH_SECRET`, a sign-up response
that reveals whether an email is registered, and plaintext OAuth token columns. Finally, three
shipped dependencies carry published advisories: `better-auth` 1.4.18, `@orpc/client` 1.13.5 and
`seroval` 1.5.0.

This spec upgrades the dependencies, turns the limiter on with a store that survives across
isolates (Postgres, through Better Auth's `storage: "database"`), reads the client address only
from `cf-connecting-ip`, requires a verified email before any session is issued, adds an
Origin/`Sec-Fetch-Site` check in front of cookie-authenticated writes on `/api/v1`, moves the web
cookie to `SameSite=Lax`, and fixes the four small gaps. The desktop app keeps its bearer-token
transport and is unaffected by the cookie and CSRF changes; it gains one new error state
(`email-not-verified`).

### Decisions

| #   | Decision                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                                                                            | ADR                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | `better-auth` goes to **1.7.7** (not the 1.6.22 floor the audit named), `@orpc/*` to **1.15.6**, `seroval`/`seroval-plugins` pinned to **1.6.9** through a root `overrides` block.                        | 1.7.7 is the first release that both closes the advisories and fixes concurrent Postgres requests exceeding database-backed rate limits — the store decision 3 relies on. oRPC packages must move together. `seroval` is transitive (TanStack Router) and only an override pins it.             | none                                                          |
| 2   | Rate limiting is **explicitly enabled** (`rateLimit.enabled`), independent of `NODE_ENV`, and disabled only under the test runner.                                                                       | The Worker never sets `NODE_ENV`; a limiter that depends on it is a limiter that is off. Explicit beats environmental.                                                                                                                                                                         | none                                                          |
| 3   | Rate-limit counters live in **Postgres** (`kaipu_rate_limit`, Better Auth `storage: "database"`), per client IP and path, with a **Cloudflare zone rate-limiting rule** on the sign-in path as the outer layer. | Memory is per isolate; KV is eventually consistent with a one-write-per-second-per-key cap; the Workers Rate Limiting binding is per-location and documented as permissive; Durable Objects are exact but add a binding, a class and a migration for a few requests per minute. The DB is already there and 1.7.7 made its increments atomic. | [ADR 0017](/architecture/decisions/0017-auth-rate-limits-in-the-database/) |
| 4   | Client address comes **only from `cf-connecting-ip`**; the web proxy drops inbound `x-forwarded-for` and `x-real-ip`.                                                                                    | Cloudflare sets `cf-connecting-ip` at the edge; `x-forwarded-for` is client-controlled and Better Auth's default source.                                                                                                                                                                       | none (context in ADR 0017)                                    |
| 5   | **Verified email required** to sign in (`requireEmailVerification: true`); the verification mail is sent on sign-up (already so) and re-sent on a sign-in attempt by an unverified user (`sendOnSignIn`). | Closes address squatting and makes sign-up answer identically for new and existing addresses (decision 8). Resend on sign-in gives the user a way out of a lost email without a new UI.                                                                                                        | none                                                          |
| 6   | **CSRF**: non-safe `/api/v1` requests that carry a cookie must present an allowed `Origin`, or `Sec-Fetch-Site: same-origin`/`none` when `Origin` is absent. Cookie-less (bearer) requests pass. The check lives in `server-hono`, not the proxy. | Better Auth already protects `/api/auth/*`; oRPC routes had nothing. Putting it in the API protects every entry path (proxy, workers.dev, previews), not only the web proxy.                                                                                                                   | none                                                          |
| 7   | Web session cookie moves to **`SameSite=Lax`**.                                                                                                                                                          | The browser only ever talks to the web Worker (same origin); the desktop uses a bearer header. `None` buys nothing and makes the cookie ride on cross-site requests.                                                                                                                            | none                                                          |
| 8   | Password: keep the stored `salt:hash` scrypt format, switch to **async `scrypt` + `timingSafeEqual`**.                                                                                                  | Changing the format would invalidate every stored hash; Better Auth's default hasher uses different scrypt parameters. Async stops blocking the isolate during a login.                                                                                                                        | none                                                          |
| 9   | `BETTER_AUTH_SECRET` must be **≥ 32 characters** (env schema).                                                                                                                                           | Better Auth only warns below 32; the secret signs session cookies and bearer tokens.                                                                                                                                                                                                           | none                                                          |
| 10  | Sign-up **does not reveal** whether an address is registered.                                                                                                                                            | Falls out of decision 5: Better Auth ≥ 1.6 answers sign-up with the same 200 for new and existing addresses when verification is required.                                                                                                                                                     | none                                                          |
| 11  | `account.encryptOAuthTokens: true`.                                                                                                                                                                      | No social provider exists today; this stops the first one from writing plaintext tokens. Zero migration cost now.                                                                                                                                                                              | none                                                          |

### Open questions

1. **Rate-limit numbers.** The WIP sets 5 sign-ins/minute, 10 sign-ups/hour, 5 reset requests/hour,
   5 verification sends/hour and 10 resets/15 min, per IP. Better Auth 1.6+ defaults are stricter
   per 10 seconds (3) and looser per hour. Owner to confirm or adjust; office/NAT users share an IP.
2. **Resend-on-sign-in email volume.** `sendOnSignIn: true` sends a verification email on every
   sign-in attempt by an unverified user, bounded only by the sign-in limit. Alternative: leave it
   off and rely on the existing resend form at `/auth/email-verified?error=…`. Recommendation in
   [item 3](#3-verified-email-required-f-5-f-13).
3. **Production secret length.** If the deployed `BETTER_AUTH_SECRET` is shorter than 32 characters
   the API will refuse to boot after this change. Rotating it signs every web and desktop session
   out. Better Auth 1.6+ accepts a `secrets` array for rotation; the env schema does not model it.
   Owner to check the length before merging (see [Owner actions](#owner-actions)).
4. **Creating `kaipu_rate_limit`.** `bun run db:push` now, or a committed migration if NIW2-328
   lands first. The spec assumes whichever of the two tickets merges second carries the table the
   way the first one established.
5. **`www.kaipu.app`.** The CSRF allow-list is `CORS_ORIGIN` + `PUBLIC_WEB_URL`. If users can
   reach the app on `www.kaipu.app` without a redirect to the apex, that origin must be in
   `CORS_ORIGIN` or every write from it is rejected.
6. **Did verification and reset work on `main`?** `main` passes only `user`, `account` and
   `session` to the Drizzle adapter (`packages/infra-auth/src/config/base-config.ts:12`); the
   `verification` table exists in the schema but is not mapped. The WIP adds the mapping. Owner to
   confirm whether password reset / email verification was working in production, which decides
   whether this is a fix or a no-op.
7. **`NODE_ENV=production` on the Worker.** Not needed for the limiter after decision 2, but Better
   Auth still uses it for other production-only behaviour (secret required, warnings). Set it as a
   non-secret `vars` entry, or leave it unset and keep everything explicit?

### Out of scope

- Security headers, CSP, clickjacking, source maps, console Access (NIW2-325).
- Upload abuse paths: ticket replay, legacy `/recordings` routes (NIW2-323).
- Scheduled jobs, R2 purge, committed migrations, FK cleanup (NIW2-328) — this spec only notes
  where it depends on them.
- Electron hardening and the Electron upgrade (NIW2-327) — only the `bun.lock` interaction is
  noted.
- `workers.dev` / preview-URL exposure of the API (audit F-12), the 10-minute session cookie cache
  (F-8), cursor validation (F-9), the placeholder mobile CORS list (F-14).
- Per-user limits on `/api/v1` routes (upload intents, downloads) — tracked in
  [API abuse controls](/backlog/api-abuse-controls/).
- Social sign-in, two-factor, passkeys.
- A permanent `bun audit` CI gate — recommended follow-up, see
  [Dependency security upgrades](/backlog/dependency-security-upgrades/).

---

## Current behaviour (main at `400c80e`)

| Item                        | Where                                                                                                                                                                                | What happens today                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rate limiting (F-3)         | `packages/infra-auth/src/config/base-config.ts:8-84` (no `rateLimit` key); `apps/server-hono/wrangler.jsonc:1-11` (no `vars`)                                                        | Better Auth 1.4.18 enables its limiter only when `NODE_ENV === "production"`. The Worker config sets no `NODE_ENV`; the release workflow ships none. When on, the default store is in-memory, which each Workers isolate owns separately. Sign-in, sign-up, password-reset request and verification resend are unauthenticated and the last two send email through Resend. |
| Client IP (F-4)             | `packages/infra-cloudflare/src/proxy-handler.ts:22` (`new Request(targetUrl, request)` copies every inbound header); no `advanced.ipAddress` in `base-config.ts`                      | A caller-supplied `x-forwarded-for` reaches the API unchanged. Better Auth's default address source is `x-forwarded-for`, so any per-IP counter and `session.ipAddress` can be chosen by the client.                                                                                                                                                                      |
| Email verification (F-5)    | `apps/server-hono/src/lib/auth.ts:27-32` (no `requireEmailVerification`); `:66-70` (`sendOnSignUp: true`, `autoSignInAfterVerification: false`)                                     | A verification email is sent on sign-up, but sign-in succeeds without verification. An address can be registered by someone who does not own it, and a session obtained. Cloud uploads are separately gated on `emailVerified` (`packages/infra-db/src/repositories/cloud-access.repository.ts`), which is why this is Medium and not High.                                |
| Cookie + CSRF (F-7, web #2) | `packages/infra-auth/src/config/base-config.ts:70-76` (`sameSite: "none"`); `apps/server-hono/src/index.ts:33-41` (`/api/v1/*` handler, no origin check); `apps/web-hono/src/routes/api/v1/$.ts` | The session cookie is attached to cross-site requests. Better Auth checks the origin on `/api/auth/*`; the oRPC handler checks nothing. Exploitability is limited by typed JSON bodies and unguessable ids and was not demonstrated, but the design relies on accident rather than policy.                                                                                   |
| Password compare (F-10)     | `packages/infra-auth/src/config/base-config.ts:26-42`                                                                                                                                | `scryptSync` (blocks the isolate per attempt) and `Buffer.equals` (not constant-time). Stored format: `hexSalt:hexKey`, 16-byte salt, 64-byte key, Node default scrypt cost.                                                                                                                                                                                             |
| Secret length (F-11)        | `packages/infra-env/src/server.ts:7`                                                                                                                                                 | `BETTER_AUTH_SECRET: z.string().min(1)`.                                                                                                                                                                                                                                                                                                                                 |
| Enumeration (F-13)          | Better Auth 1.4.18 default; `apps/kaipu-record/src/main/services/auth-client.ts:46-58` maps the 422 to `email-taken`                                                                 | Sign-up with a registered address returns a distinguishable error. Password reset already answers uniformly.                                                                                                                                                                                                                                                              |
| OAuth tokens at rest        | `packages/infra-db/src/schema/auth.ts:48-50`; no `account.encryptOAuthTokens`                                                                                                        | Columns exist, written plaintext if a social provider is ever configured. None is configured.                                                                                                                                                                                                                                                                             |
| Dependencies                | `package.json` catalog: `better-auth 1.4.18`, `@orpc/* 1.13.5`; `bun.lock`: `seroval 1.5.0`, `kysely 0.28.11`                                                                         | `better-auth` < 1.6.2: one critical (OIDC/MCP plugins — not used here), several high including account-takeover items in plugins not configured here; also pulls `kysely` with SQL-injection advisories. `@orpc/client` ≤ 1.13.5: prototype pollution in the RPC JSON serializer. `seroval` ≤ 1.5.2: unsafe deserialization, shipped to the browser via TanStack Router.     |

Grep of `apps/server-hono/src` and `packages/infra-auth/src` confirms none of the plugins named by
the critical advisory (OIDC provider, MCP, organization, magic link, email OTP) is configured; the
upgrade is still due because the fixed lines are the only supported ones and `kysely` rides along.

---

## Target behaviour

### 1. Dependency upgrade

Root `package.json` catalog:

| Package                                                                                                       | From     | To       |
| ------------------------------------------------------------------------------------------------------------- | -------- | -------- |
| `better-auth`                                                                                                 | `1.4.18` | `1.7.7`  |
| `@orpc/contract`, `@orpc/server`, `@orpc/openapi`, `@orpc/client`, `@orpc/openapi-client`, `@orpc/tanstack-query` | `1.13.5` | `1.15.6` |
| `seroval`, `seroval-plugins` (root `overrides`, transitive via `@tanstack/router-core`)                        | `1.5.0`  | `1.6.9`  |

Carried along by the lockfile: `kysely` → `0.29.6`, `@better-auth/*` 1.7.7 workspace packages
(`core`, `drizzle-adapter`, `kysely-adapter`, …).

**Also required:** `drizzle-orm` ≥ `0.45.2`. `@better-auth/drizzle-adapter@1.7.7` declares the
peer range `^0.45.2 || >=1.0.0-rc.1`; the lockfile still resolves `0.45.1` (`packages/infra-db`
and `apps/server-hono` pin `^0.45.1`). Bun treats the mismatch as a warning, not an error, so the
WIP install did not fail — but `0.45.1` is also the version the dependency backlog lists as
advisory-affected. Bump both ranges to `^0.45.2`.

### 2. Rate limiting (F-3, F-4)

In `packages/infra-auth/src/config/base-config.ts`:

```ts
rateLimit: {
  enabled: process.env.NODE_ENV !== "test",
  storage: "database",          // kaipu_rate_limit, see ADR 0017
  window: 10,
  max: 100,
  customRules: {
    "/sign-in/email":            { window: 60,      max: 5  },
    "/sign-up/email":            { window: 60 * 60, max: 10 },
    "/request-password-reset":   { window: 60 * 60, max: 5  },
    "/reset-password":           { window: 15 * 60, max: 10 },
    "/send-verification-email":  { window: 60 * 60, max: 5  },
  },
},
advanced: {
  ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
},
```

- `enabled` is explicit. `process.env` exists on the Worker because
  `nodejs_compat_populate_process_env` is on (`wrangler.jsonc:6`); Vitest sets `NODE_ENV=test`.
- Keys are `ip:path`. Better Auth ≥ 1.6 does not count rejected requests against the limit and
  answers `429` with `X-Retry-After` (seconds).
- The rule paths must be checked against the 1.7.7 route list before merging; `/forget-password`
  in the WIP is the pre-1.5 name of `/request-password-reset` and is harmless but dead.
- New table `kaipu_rate_limit` (`packages/infra-db/src/schema/auth.ts`): `id text pk`,
  `key text unique`, `count integer`, `last_request bigint` — the shape Better Auth documents for
  the `rateLimit` model. Rows are keyed per IP and path and are not expired by Better Auth; a
  periodic delete of rows older than the longest window belongs to the scheduled-jobs ticket
  (NIW2-328).
- The web proxy (`packages/infra-cloudflare/src/proxy-handler.ts`) deletes inbound
  `x-forwarded-for` and `x-real-ip` before forwarding. The API never reads them after this change,
  so the strip is defence in depth for anything added later.
- **Fail mode.** If Postgres is unreachable, Better Auth's limiter throws before the handler runs,
  so auth fails closed — which it would anyway, since every auth request reads the same database.
  No separate decision is needed; document it in the ADR.
- **Outer layer (owner action).** A Cloudflare zone rate-limiting rule on
  `POST kaipu.app/api/auth/sign-in/email` (and the sign-up / reset paths) keyed by IP. Cloudflare
  documents this as the first line for credential stuffing; on the Free plan the period is 10
  seconds and the action is Block, Pro and above allow Managed Challenge and longer periods. This
  rule protects the web path only — the desktop talks to the API directly — which is why the
  application-level limiter is the one that must be correct.

**Verification that matters most:** after deploy, confirm in Workers logs that Better Auth sees a
client address on requests arriving through the web proxy's Service Binding. If `cf-connecting-ip`
were absent on that hop, Better Auth logs a warning and does not limit — the feature would be
silently off for the web while on for the desktop.

### 3. Verified email required (F-5, F-13)

`apps/server-hono/src/lib/auth.ts` / `base-config.ts`:

```ts
emailAndPassword: { enabled: true, requireEmailVerification: true, … },
emailVerification: { sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: false, expiresIn: 60 * 60 * 24, … },
```

Resulting server behaviour (Better Auth 1.7.7):

| Call                                 | Result                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /sign-up/email`, new address   | `200`, user created, **no session, no `set-auth-token`**, verification email sent.                                                                        |
| `POST /sign-up/email`, taken address | Same `200` shape (synthetic user, no session, no email to the caller). Better Auth 1.6 added this specifically to prevent enumeration when verification is required. The existing owner can be notified through `onExistingUserSignUp` (optional, not in scope). |
| `POST /sign-in/email`, unverified    | `403` with body code `EMAIL_NOT_VERIFIED`; a fresh verification email is sent (`sendOnSignIn`).                                                           |
| `GET /verify-email?token`            | Marks the user verified and redirects to the `callbackURL` built in `lib/email-links.ts` (`/auth/email-verified`); no auto sign-in.                        |

**Recommendation on open question 2:** keep `sendOnSignIn: true`. The cost is bounded by the
sign-in rule (decision 2) and the email goes only to the address's owner; the benefit is that a
user whose first email went to spam gets a second one by doing the natural thing (trying to sign
in) on both web and desktop, without the desktop needing a resend screen. Revisit if Resend volume
or reputation becomes a problem; the fallback is `sendOnSignIn: false` plus the existing web
resend form.

Existing users with `email_verified = false` will be locked out until they verify. Count them
before deploying (owner action) and decide whether to pre-notify.

### 4. CSRF on `/api/v1` and `SameSite=Lax` (F-7, web #2)

New `apps/server-hono/src/middleware/csrf.ts`, applied in `index.ts` before the oRPC handler:

1. `GET`, `HEAD`, `OPTIONS` pass.
2. A request with no `cookie` header passes (no ambient credential to abuse; this is the desktop's
   bearer path).
3. Otherwise `Origin` must parse to one of `CORS_ORIGIN ∪ {PUBLIC_WEB_URL}`; the opaque origin
   `null` is rejected.
4. If `Origin` is absent, `Sec-Fetch-Site` must be `same-origin` or `none`; `same-site`,
   `cross-site` and absence are rejected.
5. Rejection is `403 {"error":"Cross-site request rejected"}` before any routing or auth lookup.

The browser's `Origin` and `Sec-Fetch-Site` reach the API because the proxy copies request
headers. Modern browsers send `Origin` on every `POST`, `PUT`, `PATCH`, `DELETE`, including
same-origin, so rule 4 is a fallback, not the main path.

Cookie attributes become `sameSite: "lax", secure: true, httpOnly: true`. The email-verification
link is a top-level `GET` navigation, which `Lax` allows. The console (`console.kaipu.app`) proxies
only three auth paths through its own origin and never calls `/api/v1`, so it is unaffected. The
desktop sends no cookie.

### 5. Password compare (F-10)

Same stored format, async primitives:

```ts
hash:   salt = randomBytes(16).hex; key = await scrypt(password, salt, 64); `${salt}:${key.hex}`
verify: split; length check; timingSafeEqual(storedKey, await scrypt(password, salt, 64))
```

`node:crypto` is fully supported under `nodejs_compat` on Workers (Cloudflare lists only
`argon2`, DSA/DH key generation and two curves as exceptions), so async `scrypt` is available; the
sync variant was already in use. Explicit cost parameters are deliberately **not** changed:
changing `N`/`r`/`p` would invalidate existing hashes unless a versioned format is introduced,
which is a separate decision. Better Auth's own default hasher is not adopted for the same reason
(different parameters, incompatible with stored values).

### 6. Secret length (F-11)

`packages/infra-env/src/server.ts`: `BETTER_AUTH_SECRET: z.string().min(32, …)`. The schema is
parsed at Worker boot (`apps/server-hono/src/env.ts:4`), so a short secret fails the deploy's first
request rather than running weakly. `.env.example` already documents `openssl rand -base64 32`
(44 characters).

### 7. OAuth tokens at rest

`account: { encryptOAuthTokens: true }`. Better Auth encrypts `access_token`, `refresh_token` and
`id_token` with the app secret before writing. No rows exist today, so no backfill.

---

## Alternatives considered

Each row gives the strongest argument against the choice made, not only against the rejected ones.

| Choice                                   | Alternatives rejected                                                                                                                                                                                                                                                                                                                                                 | Strongest argument against the choice                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `better-auth` 1.7.7                      | 1.6.22 (audit floor); 1.6.33 (last 1.6). Both close the advisories; neither has the database rate-limit concurrency fix. Staying on 1.4.x with WAF rules only: leaves kysely and the serializer advisories in place.                                                                                                                                                  | 1.7 is a larger jump (new sub-packages, schema validation on by default since 1.7.3, a reverted account-schema change in 1.7.0–1.7.2). The reversal history means the upgrade guide and the release notes disagree in places and the first `wrangler dev` boot is the real test.                                                                                                                       |
| Postgres as the limiter store            | See ADR 0017: memory (per isolate), KV (eventual, write-capped), Workers Rate Limiting binding (per location, permissive by design), Durable Objects (exact, new binding + class + migration), Cloudflare WAF rules alone (web path only, no desktop coverage, no per-route-per-user semantics).                                                                      | Every auth request now costs a read plus a conditional write on Neon, and the table grows one row per (IP, path) with no built-in expiry. If auth volume grows or Neon latency becomes visible on sign-in, a Durable Object is the right next store (reopen condition in the ADR).                                                                                                                     |
| CSRF check in `server-hono`              | In the web proxy only (`apps/web-hono/src/routes/api/v1/$.ts`): cheaper, but leaves the API open to the same request on any other entry (workers.dev, preview URLs, a future mobile origin). Double-submit token: needs client changes on web and a cookie the desktop does not have. oRPC-level middleware: the check must run before body parsing to be useful. | The allow-list is configuration (`CORS_ORIGIN`, `PUBLIC_WEB_URL`); a missing or stale origin blocks every write from the web with a `403` that looks like an auth bug. A unit test covers the logic, not the deployed values — open question 5.                                                                                                                                                            |
| `SameSite=Lax`                           | `Strict`: breaks arriving at the app from the verification email with a session already set (first navigation has no cookie). Keeping `None`: no benefit, since nothing cross-site needs the cookie.                                                                                                                                                                  | If a cross-site flow is ever added (OAuth callback landing on `kaipu.app`), `Lax` is already what it needs; the only loser is an embed of the app in another site, which NIW2-325 is about to forbid anyway.                                                                                                                                                                                              |
| Required verification + `sendOnSignIn`   | Gate data routes on `emailVerified` instead of sign-in (keeps sessions for unverified users; every new route must remember the gate). `sendOnSignIn: false` with a resend form only (desktop has no such form).                                                                                                                                                       | Users who registered before this change and never verified are locked out at the next sign-in with a message that says "check your inbox" for an email they may have deleted weeks ago; the resend is automatic, but the surprise is real.                                                                                                                                                             |
| Keep the custom scrypt format            | Adopt Better Auth's default hasher: cleaner, but incompatible with every stored hash — would need a re-hash-on-login path. Versioned format with explicit cost: better long-term, out of scope.                                                                                                                                                                       | Node's default scrypt cost (`N=16384, r=8, p=1`) is the 2016 recommendation; it is not weak, but the spec leaves it undocumented in code. A follow-up should pin the parameters explicitly and plan a versioned format.                                                                                                                                                                                  |
| Enumeration closed via decision 5        | `onExistingUserSignUp` notification email; a dedicated "email exists" throttle.                                                                                                                                                                                                                                                                                       | The desktop client cannot distinguish "account created, verify" from "address taken" and shows the same copy for both — correct for enumeration, slightly worse for a user who forgot they had an account (they get no email and no hint). `onExistingUserSignUp` would fix that and is cheap; left as optional.                                                                                        |

---

## Upgrade and migration notes

### Better Auth 1.4.18 → 1.7.7

What the release notes say that touches this codebase (anything not listed was checked and does not
apply — SSO, SAML, SCIM, MCP, OAuth provider, organizations, API keys, Expo, Stripe):

| Version | Change                                                                                                                                              | Effect here                                                                                                                                                                                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.5.0   | Session freshness measured from creation time (`session.freshAge: 0` to disable). Origin check added to password-reset requests.                    | No fresh-session-gated endpoints are used. Reset requests come from the web through the proxy with a trusted origin; the desktop has no reset flow.                                                                                                                                      |
| 1.6.0   | Adapters split into packages (`@better-auth/drizzle-adapter`); `better-auth/adapters/drizzle` still exported. Rejected requests no longer count toward limits; stricter default limits. Sign-up returns a uniform response when verification is required. `secrets` array for rotation. CSRF and origin checks separated. Removed deprecated names (`onEmailVerification`, `createAdapter`, …). | Import path unchanged. Enumeration fix is what decision 10 relies on. None of the removed names is used.                                                                                                                                                                                 |
| 1.7.0   | `experimental.joins` → `advanced.database.joins`. `Account.issuer` required (reverted in 1.7.3). Dynamic `baseURL` ignores `x-forwarded-host` unless `advanced.trustedProxyHeaders: true`. Stricter relative callback validation (1.7.2). | Joins not used. **Do not apply any 1.7.0–1.7.2 account migration.** `BETTER_AUTH_URL` is unset today, so `baseURL` is derived per request: on the web path that is the Service Binding's URL (`VITE_SERVER_URL`), not `kaipu.app`. Email links are built from `PUBLIC_WEB_URL` and the verify callback is absolute, so this should not matter — verify the post-verification redirect lands on `kaipu.app`; if not, set `baseURL`/`BETTER_AUTH_URL` to the public web origin or `trustedProxyHeaders: true`. |
| 1.7.3   | 1.6 account schema restored (`providerId` + `accountId`), no backfill. **Schema validation on by default, including production; a mismatch rejects auth requests.** | Our schema matches 1.6 core. Validation is the first thing to run: `wrangler dev` boot with the real schema must print no mismatch. The option to inspect/disable is `advanced.database.validateSchema` (confirm the exact name in 1.7.7 types).                                             |
| 1.7.6   | Passwords over `maxPasswordLength` rejected before hashing (`PASSWORD_TOO_LONG`).                                                                   | New error code; both clients fall through to their generic message, which is acceptable.                                                                                                                                                                                                 |
| 1.7.7   | Concurrent Postgres requests no longer exceed database-backed rate limits (Drizzle adapter). Rate-limit errors carry `Content-Type: application/json`. Magic-link and OAuth-proxy security fixes (plugins not used). | The store decision depends on the first item.                                                                                                                                                                                                                                             |

Things that were **not** verified and must be, in `wrangler dev` against a dev database:

- `bearer({ requireSignature: true })` still accepted and still emits `set-auth-token` on
  sign-in; the desktop's full sign-in/sign-out/restart cycle works.
- `trustedOrigins: [..., "kaipu-record://app"]` still satisfies the origin check for the desktop's
  `Origin: kaipu-record://app` on `/sign-in/email` and `/sign-up/email` (1.6 "separated CSRF and
  origin checks"; 1.7 tightened custom-scheme checks for the Electron plugin, which we do not use).
- `customSession(getCustomSession, baseConfig)` typing under 1.7.7.
- The cookie-cache + `getSession` fix in 1.7.3 does not change the 10-minute cache behaviour the
  web relies on (`base-config.ts:14-19`).

### Database schema impact

- **New table** `kaipu_rate_limit` (4 columns, unique index on `key`). No change to `user`,
  `session`, `account`, `verification`. The audit noted `session.updated_at` / `account.updated_at`
  have no DB default; Better Auth writes them explicitly, and NIW2-328 owns that cleanup.
- **How it reaches production:** today the repo ships schema by `bun run db:push`
  (`drizzle.config.ts` points `out` at a `src/migrations` folder that does not exist). NIW2-328
  introduces committed migrations with a baseline. If NIW2-328 merges first, this branch adds a
  delta migration for `kaipu_rate_limit` (`bun run db:generate`) instead of relying on `push`; if
  this branch merges first, the table is pushed and NIW2-328's baseline must include it. Either
  way: never run `db:push`/`db:migrate` from an agent session — owner runs it.
- **No data migration.** No existing hash, session or account row changes meaning.

### `bun.lock` and NIW2-327

Both this branch and `feature/niw2-327-harden-the-electron-desktop-app` modify `bun.lock` (this
one: the better-auth / oRPC / seroval graph; that one: workspace version bumps today, and the
Electron 41 bump when it lands). The file does not merge by hand. Whichever merges second rebases
onto `main`, discards its `bun.lock` hunk, runs `bun install` to regenerate, and commits the
result; CI's `bun install --frozen-lockfile` then confirms the lock matches the manifests.

---

## Impact on desktop and web flows

### Desktop (`apps/kaipu-record`)

- Transport unchanged: bearer token from `set-auth-token`, no cookie, so decisions 6 and 7 do not
  touch it. The CSRF middleware passes cookie-less writes by rule 2.
- **New `AuthError` kind `email-not-verified`** (`src/shared/types/auth.ts`). Raised when
  sign-in returns `403 EMAIL_NOT_VERIFIED`, and when sign-up returns `200` without a
  `set-auth-token` (the verify-first flow, same shape for a taken address).
- **Sign-up UX changes meaning.** Today a successful sign-up lands the user signed in. After this
  change sign-up ends with "check your inbox, then sign in" and no session. `auth-form.tsx` maps
  the new kind to `errorEmailNotVerified`, which renders in the error slot — for sign-up that is a
  success message in error styling. Remaining task: render it as an informational state and return
  the user to the sign-in page, not the sign-up form.
- Sign-in by an unverified user shows the same copy; a fresh email was just sent (`sendOnSignIn`).
- Rate limits apply per public IP of the machine; `429` currently falls into the `invalid-credentials`
  / `email-taken` default. Remaining task: map `429` to a `rate-limited` kind with the
  `X-Retry-After` seconds, or at least to `unknown` with a clear message.

### Web (`apps/web-hono`)

- Sign-up form: no `router.invalidate()` / redirect to `/recordings`; toast `signUpCheckEmail` and
  navigate to `/auth/login`.
- Sign-in form: `EMAIL_NOT_VERIFIED` → toast `emailNotVerified` ("we sent you a new link").
- The existing resend form at `/auth/email-verified?error=…` stays as the manual fallback.
- Cookie is `Lax`; nothing in the app relies on cross-site cookie delivery. The `beforeLoad`
  session fetch and all oRPC calls are same-origin through the proxy.
- `429` from auth endpoints surfaces as `error.error.message` in the existing toasts (Better Auth
  1.7.7 sends JSON); acceptable for v1.

### Console (`apps/console`)

Unaffected: it proxies sign-in / sign-out / get-session on its own origin and never calls
`/api/v1`. Its operator sign-in now also requires a verified email, which operator accounts
already have (owner to confirm).

---

## Owner actions

Before merge:

1. **Check the production `BETTER_AUTH_SECRET` length** (≥ 32 characters). If shorter, generate a
   new one (`openssl rand -base64 32`), update Infisical (`/server-hono`) and the GitHub
   `production` environment secret, and accept that every session is signed out on deploy.
2. **Count users with `email_verified = false`** and decide whether to email them before the
   change locks them out of sign-in.
3. Confirm `CORS_ORIGIN` (GitHub `vars`, Infisical) contains every browser origin that will send
   cookie writes: `https://kaipu.app`, and `https://www.kaipu.app` unless it redirects to the apex.
   `PUBLIC_WEB_URL` is also added to the CSRF allow-list.
4. Decide open question 4 (`db:push` vs migration) and run it yourself: `bun run db:push` creates
   `kaipu_rate_limit`.

At deploy:

5. No new Worker binding or secret is required by the chosen store (that is the point of ADR
   0017). Optional: add `"vars": { "NODE_ENV": "production" }` to `apps/server-hono/wrangler.jsonc`
   (open question 7); if added, run `wrangler types` and make sure local `.env` from `env:pull`
   overrides it in `wrangler dev`.
6. **Cloudflare dashboard → Security rules → Rate limiting rules** on the `kaipu.app` zone:
   `http.request.uri.path eq "/api/auth/sign-in/email" and http.request.method eq "POST"`, same
   characteristics IP, 5 requests / 10 s, Block 10 s (Free plan values; Pro+ can use 1 minute and
   Managed Challenge). Repeat for `/api/auth/sign-up/email` and
   `/api/auth/request-password-reset`. This is the outer layer, not the primary control.

After deploy:

7. Watch Workers logs for Better Auth's "no IP address" warning on auth routes (would mean the
   limiter is not keying on the client); confirm `kaipu_rate_limit` receives rows with real
   addresses.
8. Re-run `bun audit` and record remaining findings in
   [Dependency security upgrades](/backlog/dependency-security-upgrades/).

---

## Test plan

Unit (run by `bun run verify`, in Actions per ADR 0010):

- `apps/server-hono/src/middleware/csrf.test.ts` — safe methods pass; cookie-less writes pass;
  allowed origin passes (with and without trailing slash); foreign, `null`, and look-alike origins
  are rejected; `Sec-Fetch-Site` fallback `same-origin`/`none` pass, `same-site`/`cross-site`/absent
  rejected. *(In the WIP, not yet run.)*
- `apps/server-hono/src/lib/env-schema.test.ts` — 31-character secret rejected, 32 accepted.
  *(In the WIP, not yet run.)*
- `packages/infra-auth`: password `verify` accepts a fixture hash produced by the **old**
  `scryptSync` code, rejects a wrong password, rejects a malformed stored value, and rejects a
  truncated key without throwing. *(To add.)*
- `packages/infra-cloudflare`: proxy drops `x-forwarded-for` / `x-real-ip` and keeps `origin` and
  `sec-fetch-site`. *(To add.)*
- `apps/kaipu-record/src/main/services/auth-client.test.ts` — `403 EMAIL_NOT_VERIFIED` →
  `email-not-verified`; sign-up `200` without token → `email-not-verified`. *(In the WIP, not yet
  run.)* Add: `429` mapping once decided.
- Type-check both apps against 1.7.7 (`bun run check-types`).

Local end-to-end (`wrangler dev` + a dev Neon branch, owner's machine):

1. Boot: no schema-validation complaint from Better Auth; `kaipu_rate_limit` present.
2. Web: sign up → "check your email" → open link → `/auth/email-verified` on `kaipu.app` origin
   (not the API origin) → sign in → `/recordings` loads → create an upload intent (cookie write
   through the proxy passes the CSRF check) → sign out.
3. Web: sign in before verifying → `EMAIL_NOT_VERIFIED` toast and a second email arrives.
4. Web: sign up with the same address again → same success copy, no second account, no email.
5. Web: a `POST` to `/api/v1/assets/upload-intents` with the session cookie and a foreign `Origin`
   → `403` before auth (unit-level reproduction is enough; no live cross-site page is needed).
6. Desktop: sign up → `email-not-verified` state; verify in browser; sign in → token issued →
   restart → session restored → sign out. Bearer writes to `/api/v1` succeed with no cookie.
7. Six sign-in attempts in a minute from one IP → the sixth is `429` with `X-Retry-After`; wait
   → allowed. Confirm a row in `kaipu_rate_limit` with the client's address.
8. Password reset end to end (confirms the `verification` mapping, open question 6).

Audit: `bun audit` shows no critical/high in `better-auth`, `@orpc/*`, `seroval`, `kysely`,
`drizzle-orm`.

---

## Acceptance criteria

- [ ] `bun run verify` green on the branch; Actions `Merge requirements` green.
- [ ] Lockfile resolves `better-auth 1.7.7`, `@orpc/* 1.15.6`, `seroval 1.6.9`, `kysely ≥ 0.28.17`,
      `drizzle-orm ≥ 0.45.2`; `bun audit` reports no critical or high advisory in those packages.
- [ ] Better Auth boots with schema validation on and reports no mismatch.
- [ ] A sign-in attempt for an unverified address never yields a session or a bearer token, on web
      and desktop.
- [ ] Sign-up with a registered address and with a new address return the same status and body
      shape.
- [ ] Limiter counters are in `kaipu_rate_limit`, keyed by the `cf-connecting-ip` address, on both
      the proxied web path and the direct desktop path; the sixth sign-in attempt in a minute is a
      `429`.
- [ ] `x-forwarded-for` supplied by a client does not reach Better Auth through the web proxy.
- [ ] Cookie-bearing non-safe `/api/v1` requests without an allowed origin are rejected with `403`;
      bearer requests without a cookie are not affected; the web app's own writes pass.
- [ ] Session cookie is issued with `SameSite=Lax; Secure; HttpOnly`.
- [ ] Existing users sign in with their current passwords (the stored format is unchanged); the
      compare path uses `timingSafeEqual`.
- [ ] A `BETTER_AUTH_SECRET` under 32 characters fails env parsing at boot.
- [ ] `account.encryptOAuthTokens` is on.
- [ ] Desktop and web copy for the verify-first flow exists in `en` and `es`.
- [ ] Documentation: this spec, ADR 0017 and its index row, and the backlog rows for
      [Dependency security upgrades](/backlog/dependency-security-upgrades/) and
      [API abuse controls](/backlog/api-abuse-controls/) updated to point here.

---

## Rollout and backout

**Rollout.** One PR, one API release (`release-api.yml`), one web release; the desktop change
ships with the next desktop release, and until then an older desktop sees the new server
behaviour: sign-up without a token already maps to `unknown` with a readable message in the shipped
client, and `403` on sign-in maps to `invalid-credentials` — degraded copy, not a broken app.
Order: (1) owner actions 1–4; (2) merge; (3) release API, then web; (4) owner action 6; (5)
post-deploy checks 7–8.

**Backout.** The change is a set of independent config flags plus one additive table, so partial
backout is possible without a dependency downgrade:

- Limiter: `rateLimit.enabled: false` (keeps the table; nothing else depends on it).
- Verification gate: `requireEmailVerification: false` and `sendOnSignIn: false` — users verified
  in the meantime stay verified.
- CSRF: remove the middleware call in `index.ts`; cookie back to `none` only if a concrete flow
  broke.
- Secret length: relax the schema if the deploy fails on boot (then rotate properly).
- The dependency upgrade itself is reverted only by reverting the PR and regenerating `bun.lock`;
  Better Auth 1.7.7 wrote nothing to the database that 1.4.18 cannot read (no schema change beyond
  the new table), so a downgrade does not need a data rollback.

---

## Implementation status

### What the WIP commit does (`b0837f3`, unverified — `bun run verify` has not run on it)

| Area                      | Change                                                                                                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencies              | Catalog: `better-auth 1.7.7`, `@orpc/* 1.15.6`; root `overrides` for `seroval`/`seroval-plugins 1.6.9`; `bun.lock` regenerated (resolves `kysely 0.29.6`, `@better-auth/* 1.7.7`). `drizzle-orm` **not** bumped (still `0.45.1`, below the adapter's peer range).                      |
| `packages/infra-auth`     | `base-config.ts`: adapter schema now maps `verification` and `rateLimit`; `requireEmailVerification: true`; async `scrypt` + `timingSafeEqual` (same stored format); `account.encryptOAuthTokens: true`; explicit `rateLimit` block with `storage: "database"` and the rules in item 2; `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`; cookies `sameSite: "lax"`; dead commented-out hasher removed. |
| `packages/infra-db`       | `schema/auth.ts`: `rateLimitTable` (`kaipu_rate_limit`).                                                                                                                                                                                                                                 |
| `packages/infra-env`      | `BETTER_AUTH_SECRET` min length 32.                                                                                                                                                                                                                                                      |
| `packages/infra-cloudflare` | Proxy deletes inbound `x-forwarded-for` and `x-real-ip`.                                                                                                                                                                                                                              |
| `apps/server-hono`        | `middleware/csrf.ts` + test; `index.ts` applies it to `/api/v1/*` with `CORS_ORIGIN ∪ PUBLIC_WEB_URL`; `lib/auth.ts` adds `sendOnSignIn: true`; `lib/env-schema.test.ts`.                                                                                                                 |
| `apps/web-hono`           | Sign-up form navigates to `/auth/login` with a "check your email" toast; sign-in form handles `EMAIL_NOT_VERIFIED`.                                                                                                                                                                      |
| `apps/kaipu-record`       | `AuthError` gains `email-not-verified`; `auth-client.ts` maps `403 EMAIL_NOT_VERIFIED` and token-less sign-up to it; `auth-form.tsx` maps it to `errorEmailNotVerified`; tests for both mappings.                                                                                       |
| `packages/i18n`           | `en`/`es`: `signUpCheckEmail`, `emailNotVerified`, `errorEmailNotVerified`.                                                                                                                                                                                                              |

Not in the WIP: this spec and the ADR (added by the follow-up docs commit), the `drizzle-orm`
bump, the infra-auth and infra-cloudflare tests, the desktop `429`/success-state UX, docs updates,
and every verification step.

### What remains — resumable, in order

Each task is independent enough to be a commit; tasks 1–3 gate everything after them.

1. **Install and run the suite.** `bun install` (lock already regenerated; expect the
   `drizzle-orm` peer warning), then `bun run verify`. Fix type errors from the 1.7.7 types first
   (`customSession`, `bearer`, `BetterAuthOptions` shape for `rateLimit`/`ipAddress`), then the
   test failures.
2. **Bump `drizzle-orm` to `^0.45.2`** in `packages/infra-db/package.json` and
   `apps/server-hono/package.json`; `bun install`; re-run verify.
3. **Boot check in `wrangler dev`** with a dev database: no schema-validation complaint; confirm
   the rate-limit rule paths against the 1.7.7 route table and drop `/forget-password` if it no
   longer exists; confirm `cf-connecting-ip` is populated locally (miniflare) or temporarily log the
   address Better Auth resolves.
4. **Create `kaipu_rate_limit`** (owner runs `db:push`, or generate a migration if NIW2-328 is in).
5. **Password tests** in `packages/infra-auth` (legacy-hash fixture, wrong password, malformed and
   truncated stored values) — `packages/infra-auth` has no test script today; add `vitest` the way
   `apps/server-hono` does.
6. **Proxy test** in `packages/infra-cloudflare` for the header strip.
7. **Desktop UX:** render `email-not-verified` after sign-up as an informational state and return
   to the sign-in page; map `429` to a dedicated kind (or a clear `unknown` message) with the retry
   seconds; copy in `en`/`es`.
8. **Web:** on `/auth/login`, when the server answers `EMAIL_NOT_VERIFIED`, offer the link to the
   existing resend form; surface `429` with the retry seconds instead of the raw message.
9. **Local end-to-end** per the test plan, including the desktop cycle and the post-verification
   redirect origin (decides the `baseURL` / `trustedProxyHeaders` question).
10. **Docs:** ADR index row (added with this spec), backlog rows for dependency upgrades and API
    abuse controls, and the three `authentication/*.mdx` pages that currently state
    `SameSite=Lax` as if it were already so — after this change it is.
11. **Rebase on `main`** once NIW2-327 / NIW2-328 land; regenerate `bun.lock` with `bun install`,
    never by hand; re-run verify.
12. **Owner actions 1–4**, mark the PR ready for review, release, owner actions 5–8.

---

## References

- Better Auth — [Rate limiting](https://www.better-auth.com/docs/concepts/rate-limit) (storage
  options, `rateLimit` table shape, `ipAddressHeaders`, `cf-connecting-ip` example);
  [Email & password](https://www.better-auth.com/docs/authentication/email-password)
  (`requireEmailVerification`, uniform sign-up response); [Options
  reference](https://www.better-auth.com/docs/reference/options) (`encryptOAuthTokens`,
  `sendOnSignIn`, `validateSchema`); [Bearer plugin](https://www.better-auth.com/docs/plugins/bearer).
- Better Auth releases — [v1.5.0](https://github.com/better-auth/better-auth/releases/tag/v1.5.0),
  [v1.6.0](https://github.com/better-auth/better-auth/releases/tag/v1.6.0),
  [v1.7.0](https://github.com/better-auth/better-auth/releases/tag/v1.7.0),
  [v1.7.3](https://github.com/better-auth/better-auth/releases/tag/v1.7.3),
  [v1.7.7](https://github.com/better-auth/better-auth/releases) (database rate-limit concurrency
  fix); [1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide).
- Cloudflare — [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
  (per-location, "permissive, eventually consistent"); [KV limits](https://developers.cloudflare.com/kv/platform/limits/)
  (one write per second per key); [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/);
  [WAF rate limiting best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/)
  and [Stop account takeover attacks](https://developers.cloudflare.com/use-cases/solutions/stop-account-takeover-attacks/)
  (Free-plan parameters); [`node:crypto` on Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).
- In-repo: [Desktop authentication — design spec](/specs/2026-09-02-desktop-authentication-design/)
  (bearer transport, the `kaipu-record://app` origin); [API abuse controls](/backlog/api-abuse-controls/);
  [Dependency security upgrades](/backlog/dependency-security-upgrades/);
  [ADR 0017](/architecture/decisions/0017-auth-rate-limits-in-the-database/).
