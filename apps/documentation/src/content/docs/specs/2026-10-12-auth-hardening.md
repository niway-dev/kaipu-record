---
title: Authentication hardening — design spec
description: Upgrade Better Auth and oRPC past their advisories, turn on durable rate limiting keyed by the Cloudflare client IP, require a verified email before a session exists, reject cross-site cookie writes on /api/v1, and close four smaller gaps (constant-time password compare, secret length, sign-up enumeration, OAuth tokens at rest). Linear NIW2-324.
---

# Authentication hardening — design spec

**Ticket:** NIW2-324 · **Branch:** `feature/niw2-324-harden-authentication-and-upgrade-vulnerable-dependencies` ·
**Status:** implemented on the branch and verified locally (2026-10-21), except decision 5
(verified email required), which is deferred to the owner — see
[Implementation status](#implementation-status). Not yet released.

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

| #   | Decision                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                                                                                                                           | ADR                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | `better-auth` goes to **1.7.12** (`main` had already moved to 1.7.11 for ADR 0025), `@orpc/*` to **1.15.7**, `seroval`/`seroval-plugins` pinned to **1.6.11** through a root `overrides` block; `hono` to the first release past its JSX advisory.                      | 1.7.x closes the advisories and makes the database-backed limiter increments atomic, which decision 3 relies on. oRPC packages must move together. `seroval` is transitive (TanStack Router) and only an override pins it.                                                                                                                    | none                                                                       |
| 2   | Rate limiting is **explicitly enabled** (`rateLimit.enabled`), independent of `NODE_ENV`, and disabled only under the test runner.                                                                                                                                      | The Worker never sets `NODE_ENV`; a limiter that depends on it is a limiter that is off. Explicit beats environmental.                                                                                                                                                                                                                        | none                                                                       |
| 3   | Rate-limit counters live in **Postgres** (`kaipu_rate_limit`, Better Auth `storage: "database"`), per client IP and path, with a **Cloudflare zone rate-limiting rule** on the sign-in path as the outer layer.                                                         | Memory is per isolate; KV is eventually consistent with a one-write-per-second-per-key cap; the Workers Rate Limiting binding is per-location and documented as permissive; Durable Objects are exact but add a binding, a class and a migration for a few requests per minute. The DB is already there and 1.7.7 made its increments atomic. | [ADR 0029](/architecture/decisions/0029-auth-rate-limits-in-the-database/) |
| 4   | Client address comes **only from `cf-connecting-ip`**; the web proxy drops inbound `x-forwarded-for` and `x-real-ip`.                                                                                                                                                   | Cloudflare sets `cf-connecting-ip` at the edge; `x-forwarded-for` is client-controlled and Better Auth's default source.                                                                                                                                                                                                                      | none (context in ADR 0029)                                                 |
| 5   | **Deferred to the owner.** `requireEmailVerification` stays off. The concrete takeover path the audit's F-5 enabled (a squatter's Google link surviving the owner's claim) is closed instead; see [item 3](#3-verified-email-required-f-5-f-13--deferred-to-the-owner). | Turning it on reverses the 2026-09-15 decision ("sign-in stays allowed for unverified accounts; Cloud is gated on `emailVerified`") and breaks the desktop sign-up flow of ADR 0025, whose done page waits for a session that would never come. That is the owner's call, not this PR's.                                                      | none                                                                       |
| 6   | **CSRF**: non-safe `/api/v1` requests that carry a cookie must present an allowed `Origin`, or `Sec-Fetch-Site: same-origin`/`none` when `Origin` is absent. Cookie-less (bearer) requests pass. The check lives in `server-hono`, not the proxy.                       | Better Auth already protects `/api/auth/*`; oRPC routes had nothing. Putting it in the API protects every entry path (proxy, workers.dev, previews), not only the web proxy.                                                                                                                                                                  | none                                                                       |
| 7   | Web session cookie moves to **`SameSite=Lax`**.                                                                                                                                                                                                                         | The browser only ever talks to the web Worker (same origin); the desktop uses a bearer header. `None` buys nothing and makes the cookie ride on cross-site requests.                                                                                                                                                                          | none                                                                       |
| 8   | Password: keep the stored `salt:hash` scrypt format, switch to **async `scrypt` + `timingSafeEqual`**.                                                                                                                                                                  | Changing the format would invalidate every stored hash; Better Auth's default hasher uses different scrypt parameters. Async stops blocking the isolate during a login.                                                                                                                                                                       | none                                                                       |
| 9   | `BETTER_AUTH_SECRET` must be **≥ 32 characters** (env schema).                                                                                                                                                                                                          | Better Auth only warns below 32; the secret signs session cookies and bearer tokens.                                                                                                                                                                                                                                                          | none                                                                       |
| 10  | Sign-up **does not reveal** whether an address is registered.                                                                                                                                                                                                           | Falls out of decision 5: Better Auth ≥ 1.6 answers sign-up with the same 200 for new and existing addresses when verification is required.                                                                                                                                                                                                    | none                                                                       |
| 11  | `account.encryptOAuthTokens: true`.                                                                                                                                                                                                                                     | No social provider exists today; this stops the first one from writing plaintext tokens. Zero migration cost now.                                                                                                                                                                                                                             | none                                                                       |

### Open questions

Resolved on 2026-10-21 by reading Better Auth 1.7.12 and the deployed configuration, unless
marked **owner**.

1. **Rate-limit numbers.** Kept: 5 sign-ins/minute, 10 sign-ups/hour, 5 reset requests/hour,
   5 verification sends/hour, 10 resets/15 min, per address; the desktop code exchange
   (`/electron/token`, `/electron/transfer-user`) 10/minute. `/get-session` is exempt (see
   [item 2](#2-rate-limiting-f-3-f-4)). **Owner** may still loosen the sign-in rule: it is per
   address, so an office behind one NAT shares it.
2. **Resend-on-sign-in.** Moot while decision 5 is deferred; `sendOnSignIn` is not set.
3. **Production secret length.** Still **owner**: the GitHub `production` secret cannot be read
   from the repository. The local Infisical value is 43 characters. The API refuses to boot on a
   shorter secret, so check before the release (owner action 1).
4. **Creating `kaipu_record_rate_limit`.** `bun run db:push` before the API release (owner action
   4). `main` still has no committed migrations, so there is nothing else to carry.
5. **`www.kaipu.app`.** Answered: production `CORS_ORIGIN` and `BETTER_AUTH_URL` are
   `https://kaipu.app`, and `www.kaipu.app` is a 301 to the apex at the Cloudflare edge (path and
   query preserved, checked live). Both Better Auth's origin check and the new CSRF check depend
   on that redirect; it is recorded in [Google OAuth](/deployment/google-oauth/).
6. **Verification table mapping.** `main` mapped `verification` on its own (NIW2-471 needed it),
   so this is no longer a change of this PR.
7. **`NODE_ENV` on the Worker.** Not needed: wrangler inlines `process.env.NODE_ENV` as
   `"production"` at deploy, so Better Auth's production-only behaviour is already on, and the
   limiter is enabled explicitly regardless.

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

| Item                        | Where                                                                                                                                                                                            | What happens today                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate limiting (F-3)         | `packages/infra-auth/src/config/base-config.ts:8-84` (no `rateLimit` key); `apps/server-hono/wrangler.jsonc:1-11` (no `vars`)                                                                    | Better Auth 1.4.18 enables its limiter only when `NODE_ENV === "production"`. The Worker config sets no `NODE_ENV`; the release workflow ships none. When on, the default store is in-memory, which each Workers isolate owns separately. Sign-in, sign-up, password-reset request and verification resend are unauthenticated and the last two send email through Resend. |
| Client IP (F-4)             | `packages/infra-cloudflare/src/proxy-handler.ts:22` (`new Request(targetUrl, request)` copies every inbound header); no `advanced.ipAddress` in `base-config.ts`                                 | A caller-supplied `x-forwarded-for` reaches the API unchanged. Better Auth's default address source is `x-forwarded-for`, so any per-IP counter and `session.ipAddress` can be chosen by the client.                                                                                                                                                                       |
| Email verification (F-5)    | `apps/server-hono/src/lib/auth.ts:27-32` (no `requireEmailVerification`); `:66-70` (`sendOnSignUp: true`, `autoSignInAfterVerification: false`)                                                  | A verification email is sent on sign-up, but sign-in succeeds without verification. An address can be registered by someone who does not own it, and a session obtained. Cloud uploads are separately gated on `emailVerified` (`packages/infra-db/src/repositories/cloud-access.repository.ts`), which is why this is Medium and not High.                                |
| Cookie + CSRF (F-7, web #2) | `packages/infra-auth/src/config/base-config.ts:70-76` (`sameSite: "none"`); `apps/server-hono/src/index.ts:33-41` (`/api/v1/*` handler, no origin check); `apps/web-hono/src/routes/api/v1/$.ts` | The session cookie is attached to cross-site requests. Better Auth checks the origin on `/api/auth/*`; the oRPC handler checks nothing. Exploitability is limited by typed JSON bodies and unguessable ids and was not demonstrated, but the design relies on accident rather than policy.                                                                                 |
| Password compare (F-10)     | `packages/infra-auth/src/config/base-config.ts:26-42`                                                                                                                                            | `scryptSync` (blocks the isolate per attempt) and `Buffer.equals` (not constant-time). Stored format: `hexSalt:hexKey`, 16-byte salt, 64-byte key, Node default scrypt cost.                                                                                                                                                                                               |
| Secret length (F-11)        | `packages/infra-env/src/server.ts:7`                                                                                                                                                             | `BETTER_AUTH_SECRET: z.string().min(1)`.                                                                                                                                                                                                                                                                                                                                   |
| Enumeration (F-13)          | Better Auth 1.4.18 default; `apps/kaipu-record/src/main/services/auth-client.ts:46-58` maps the 422 to `email-taken`                                                                             | Sign-up with a registered address returns a distinguishable error. Password reset already answers uniformly.                                                                                                                                                                                                                                                               |
| OAuth tokens at rest        | `packages/infra-db/src/schema/auth.ts:48-50`; no `account.encryptOAuthTokens`                                                                                                                    | Columns exist, written plaintext if a social provider is ever configured. None is configured.                                                                                                                                                                                                                                                                              |
| Dependencies                | `package.json` catalog: `better-auth 1.4.18`, `@orpc/* 1.13.5`; `bun.lock`: `seroval 1.5.0`, `kysely 0.28.11`                                                                                    | `better-auth` < 1.6.2: one critical (OIDC/MCP plugins — not used here), several high including account-takeover items in plugins not configured here; also pulls `kysely` with SQL-injection advisories. `@orpc/client` ≤ 1.13.5: prototype pollution in the RPC JSON serializer. `seroval` ≤ 1.5.2: unsafe deserialization, shipped to the browser via TanStack Router.   |

Grep of `apps/server-hono/src` and `packages/infra-auth/src` confirms none of the plugins named by
the critical advisory (OIDC provider, MCP, organization, magic link, email OTP) is configured; the
upgrade is still due because the fixed lines are the only supported ones and `kysely` rides along.

---

## Target behaviour

### 1. Dependency upgrade

Root `package.json` catalog:

| Package                                                                                                           | From     | To       |
| ----------------------------------------------------------------------------------------------------------------- | -------- | -------- |
| `better-auth`                                                                                                     | `1.4.18` | `1.7.7`  |
| `@orpc/contract`, `@orpc/server`, `@orpc/openapi`, `@orpc/client`, `@orpc/openapi-client`, `@orpc/tanstack-query` | `1.13.5` | `1.15.6` |
| `seroval`, `seroval-plugins` (root `overrides`, transitive via `@tanstack/router-core`)                           | `1.5.0`  | `1.6.9`  |

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
  storage: "database",          // kaipu_rate_limit, see ADR 0029
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

### 3. Verified email required (F-5, F-13) — deferred to the owner

**Not applied.** `requireEmailVerification` and `sendOnSignIn` are not set. What was verified
(Better Auth 1.7.12 source, `main` at the merge):

- With the flag on, `/sign-up/email` creates the user and returns `200 { token: null }` with no
  session, and `/sign-in/email` answers `403 EMAIL_NOT_VERIFIED` after the password check (so it
  is not an enumeration channel). Sign-up answers the same `200` for a taken address (F-13 closed).
- The desktop signs up through the browser (ADR 0025): the web form pushes to
  `/auth/desktop/done`, which polls for the session cookie and after 10 s shows "No sign-in code
  here". With no session, every desktop email sign-up would end there. The web "Check your email"
  screen's "Go to library" link would bounce to login. The 2026-09-15 transactional-email plan
  says explicitly not to set the flag, and the web auth redesign is built on "never blocks".
- Cloud uploads are already gated on `emailVerified` (`createUploadIntent`); no API route sends
  email; `/change-email` and `/delete-user` are disabled. Unauthenticated
  `/send-verification-email` and `/request-password-reset` are limited to 5/hour per address.

**What this PR does instead.** The one concrete takeover path found: whoever registered an
address without owning the inbox could link their own Google account (FR8 allows a different
email); when the real owner later claimed the address through Google, FR6 dropped only the
password and sessions and left that Google row as a back door into the now-verified account.
`decideLinkSideEffects` now drops every account row attached while the email was unverified;
only the Google row that proved the inbox survives (`apps/server-hono/src/lib/account-linking.ts`,
flow test "a Google account the squatter linked while unverified is dropped with the password").

**Owner decision.** Enabling the flag needs: a desktop done page that says "check your email"
instead of "no code", a sign-in message for `EMAIL_NOT_VERIFIED` with a resend link, a count of
existing unverified users, and the reversal of the 2026-09-15 note. A narrower option that keeps
sign-in open is `autoSignIn: false` for F-13 alone, which has the same sign-up UX cost.
Residual risk accepted until then: a squatter who claims an address by password reset (the mail
goes to the real inbox, so only the owner can finish it) does not get the same cleanup.

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

| Choice                                 | Alternatives rejected                                                                                                                                                                                                                                                                                                                                             | Strongest argument against the choice                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `better-auth` 1.7.7                    | 1.6.22 (audit floor); 1.6.33 (last 1.6). Both close the advisories; neither has the database rate-limit concurrency fix. Staying on 1.4.x with WAF rules only: leaves kysely and the serializer advisories in place.                                                                                                                                              | 1.7 is a larger jump (new sub-packages, schema validation on by default since 1.7.3, a reverted account-schema change in 1.7.0–1.7.2). The reversal history means the upgrade guide and the release notes disagree in places and the first `wrangler dev` boot is the real test.                                 |
| Postgres as the limiter store          | See ADR 0029: memory (per isolate), KV (eventual, write-capped), Workers Rate Limiting binding (per location, permissive by design), Durable Objects (exact, new binding + class + migration), Cloudflare WAF rules alone (web path only, no desktop coverage, no per-route-per-user semantics).                                                                  | Every auth request now costs a read plus a conditional write on Neon, and the table grows one row per (IP, path) with no built-in expiry. If auth volume grows or Neon latency becomes visible on sign-in, a Durable Object is the right next store (reopen condition in the ADR).                               |
| CSRF check in `server-hono`            | In the web proxy only (`apps/web-hono/src/routes/api/v1/$.ts`): cheaper, but leaves the API open to the same request on any other entry (workers.dev, preview URLs, a future mobile origin). Double-submit token: needs client changes on web and a cookie the desktop does not have. oRPC-level middleware: the check must run before body parsing to be useful. | The allow-list is configuration (`CORS_ORIGIN`, `PUBLIC_WEB_URL`); a missing or stale origin blocks every write from the web with a `403` that looks like an auth bug. A unit test covers the logic, not the deployed values — open question 5.                                                                  |
| `SameSite=Lax`                         | `Strict`: breaks arriving at the app from the verification email with a session already set (first navigation has no cookie). Keeping `None`: no benefit, since nothing cross-site needs the cookie.                                                                                                                                                              | If a cross-site flow is ever added (OAuth callback landing on `kaipu.app`), `Lax` is already what it needs; the only loser is an embed of the app in another site, which NIW2-325 is about to forbid anyway.                                                                                                     |
| Required verification + `sendOnSignIn` | Gate data routes on `emailVerified` instead of sign-in (keeps sessions for unverified users; every new route must remember the gate). `sendOnSignIn: false` with a resend form only (desktop has no such form).                                                                                                                                                   | Users who registered before this change and never verified are locked out at the next sign-in with a message that says "check your inbox" for an email they may have deleted weeks ago; the resend is automatic, but the surprise is real.                                                                       |
| Keep the custom scrypt format          | Adopt Better Auth's default hasher: cleaner, but incompatible with every stored hash — would need a re-hash-on-login path. Versioned format with explicit cost: better long-term, out of scope.                                                                                                                                                                   | Node's default scrypt cost (`N=16384, r=8, p=1`) is the 2016 recommendation; it is not weak, but the spec leaves it undocumented in code. A follow-up should pin the parameters explicitly and plan a versioned format.                                                                                          |
| Enumeration closed via decision 5      | `onExistingUserSignUp` notification email; a dedicated "email exists" throttle.                                                                                                                                                                                                                                                                                   | The desktop client cannot distinguish "account created, verify" from "address taken" and shows the same copy for both — correct for enumeration, slightly worse for a user who forgot they had an account (they get no email and no hint). `onExistingUserSignUp` would fix that and is cheap; left as optional. |

---

## Upgrade and migration notes

### Better Auth 1.4.18 → 1.7.7

What the release notes say that touches this codebase (anything not listed was checked and does not
apply — SSO, SAML, SCIM, MCP, OAuth provider, organizations, API keys, Expo, Stripe):

| Version | Change                                                                                                                                                                                                                                                                                                                                                                                          | Effect here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.5.0   | Session freshness measured from creation time (`session.freshAge: 0` to disable). Origin check added to password-reset requests.                                                                                                                                                                                                                                                                | No fresh-session-gated endpoints are used. Reset requests come from the web through the proxy with a trusted origin; the desktop has no reset flow.                                                                                                                                                                                                                                                                                                                                                          |
| 1.6.0   | Adapters split into packages (`@better-auth/drizzle-adapter`); `better-auth/adapters/drizzle` still exported. Rejected requests no longer count toward limits; stricter default limits. Sign-up returns a uniform response when verification is required. `secrets` array for rotation. CSRF and origin checks separated. Removed deprecated names (`onEmailVerification`, `createAdapter`, …). | Import path unchanged. Enumeration fix is what decision 10 relies on. None of the removed names is used.                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1.7.0   | `experimental.joins` → `advanced.database.joins`. `Account.issuer` required (reverted in 1.7.3). Dynamic `baseURL` ignores `x-forwarded-host` unless `advanced.trustedProxyHeaders: true`. Stricter relative callback validation (1.7.2).                                                                                                                                                       | Joins not used. **Do not apply any 1.7.0–1.7.2 account migration.** `BETTER_AUTH_URL` is unset today, so `baseURL` is derived per request: on the web path that is the Service Binding's URL (`VITE_SERVER_URL`), not `kaipu.app`. Email links are built from `PUBLIC_WEB_URL` and the verify callback is absolute, so this should not matter — verify the post-verification redirect lands on `kaipu.app`; if not, set `baseURL`/`BETTER_AUTH_URL` to the public web origin or `trustedProxyHeaders: true`. |
| 1.7.3   | 1.6 account schema restored (`providerId` + `accountId`), no backfill. **Schema validation on by default, including production; a mismatch rejects auth requests.**                                                                                                                                                                                                                             | Our schema matches 1.6 core. Validation is the first thing to run: `wrangler dev` boot with the real schema must print no mismatch. The option to inspect/disable is `advanced.database.validateSchema` (confirm the exact name in 1.7.7 types).                                                                                                                                                                                                                                                             |
| 1.7.6   | Passwords over `maxPasswordLength` rejected before hashing (`PASSWORD_TOO_LONG`).                                                                                                                                                                                                                                                                                                               | New error code; both clients fall through to their generic message, which is acceptable.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1.7.7   | Concurrent Postgres requests no longer exceed database-backed rate limits (Drizzle adapter). Rate-limit errors carry `Content-Type: application/json`. Magic-link and OAuth-proxy security fixes (plugins not used).                                                                                                                                                                            | The store decision depends on the first item.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

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
   new one (`openssl rand -base64 32`), update Infisical (`/auth`) and the GitHub `production`
   environment secret, and accept that every session is signed out on deploy. The local value
   is 43 characters; the production one cannot be read from the repository.
2. Decide on [item 3](#3-verified-email-required-f-5-f-13--deferred-to-the-owner) (verified
   email required). Nothing in this PR depends on the answer.
3. Keep the `www.kaipu.app` → apex redirect in the Cloudflare dashboard. `CORS_ORIGIN` is the apex
   only; without the redirect, sign-in and every write from `www` would answer 403.
4. Run `bun run db:push` against production so `kaipu_record_rate_limit` exists **before** the
   API release: with `storage: "database"`, a missing table fails every auth request.

At deploy:

5. No new Worker binding or secret is required by the chosen store (that is the point of ADR
   0029). Optional: add `"vars": { "NODE_ENV": "production" }` to `apps/server-hono/wrangler.jsonc`
   (open question 7); if added, run `wrangler types` and make sure local `.env` from `env:pull`
   overrides it in `wrangler dev`.
6. **Cloudflare dashboard → Security rules → Rate limiting rules** on the `kaipu.app` zone:
   `http.request.uri.path eq "/api/auth/sign-in/email" and http.request.method eq "POST"`, same
   characteristics IP, 5 requests / 10 s, Block 10 s (Free plan values; Pro+ can use 1 minute and
   Managed Challenge). Repeat for `/api/auth/sign-up/email` and
   `/api/auth/request-password-reset`. This is the outer layer, not the primary control.

After deploy:

7. Watch Workers logs for Better Auth's "Rate limiting could not determine a client IP" warning
   (it would mean `cf-connecting-ip` did not survive the service binding and every user shares
   one bucket per path); confirm `kaipu_record_rate_limit` keys start with real addresses, never
   `no-trusted-ip`, and that `session.ip_address` is populated for a web sign-in.
8. Re-run `bun audit` and record remaining findings in
   [Dependency security upgrades](/backlog/dependency-security-upgrades/).

---

## Test plan

Unit (run by `bun run verify`, in Actions per ADR 0010):

- `apps/server-hono/src/middleware/csrf.test.ts` — safe methods pass; cookie-less writes pass;
  allowed origin passes (with and without trailing slash); foreign, `null`, and look-alike origins
  are rejected; `Sec-Fetch-Site` fallback `same-origin`/`none` pass, `same-site`/`cross-site`/absent
  rejected. _(In the WIP, not yet run.)_
- `apps/server-hono/src/lib/env-schema.test.ts` — 31-character secret rejected, 32 accepted.
  _(In the WIP, not yet run.)_
- `packages/infra-auth`: password `verify` accepts a fixture hash produced by the **old**
  `scryptSync` code, rejects a wrong password, rejects a malformed stored value, and rejects a
  truncated key without throwing. _(To add.)_
- `packages/infra-cloudflare`: proxy drops `x-forwarded-for` / `x-real-ip` and keeps `origin` and
  `sec-fetch-site`. _(To add.)_
- `apps/kaipu-record/src/main/services/auth-client.test.ts` — `403 EMAIL_NOT_VERIFIED` →
  `email-not-verified`; sign-up `200` without token → `email-not-verified`. _(In the WIP, not yet
  run.)_ Add: `429` mapping once decided.
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
- [ ] Documentation: this spec, ADR 0029 and its index row, and the backlog rows for
      [Dependency security upgrades](/backlog/dependency-security-upgrades/) and
      [API abuse controls](/backlog/api-abuse-controls/) updated to point here.

---

## Rollout and backout

**Rollout.** One PR, one API release (`release-api.yml`), one web release; the desktop change
(a `throttled` error state for the code exchange) ships with the next desktop release, and until
then an older desktop shows a 429 on the exchange as "invalid code" — degraded copy, not a broken
app. Order: (1) owner actions 1, 3, 4; (2) merge; (3) release API, then web; (4) owner action 6;
(5) post-deploy checks 7–8.

**Backout.** The change is a set of independent config flags plus one additive table, so partial
backout is possible without a dependency downgrade:

- Limiter: `rateLimit.enabled: false` (keeps the table; nothing else depends on it).
- CSRF: remove the middleware call in `index.ts`; cookie back to `none` only if a concrete flow
  broke.
- Secret length: relax the schema if the deploy fails on boot (then rotate properly).
- The dependency upgrade itself is reverted only by reverting the PR and regenerating `bun.lock`;
  `main` was already on Better Auth 1.7.11, so the dependency part of this PR is a patch bump plus
  oRPC, seroval and hono; nothing wrote to the database that the previous versions cannot read.

---

## Implementation status

### On the branch, verified 2026-10-21

The branch was merged with `main` (359 commits, including Better Auth 1.7.11, the desktop
browser sign-in and the new web auth forms) on 2026-10-21. Five read-only reviewers (Claude
Sonnet) then checked each finding against Better Auth 1.7.12's source and the merged tree; what
they could not prove is listed under "Not verifiable here".

| Finding            | State                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencies       | Done. `better-auth` 1.7.12, `@orpc/*` 1.15.7, `seroval` 1.6.11 (override), `kysely` 0.29.7, `hono` past GHSA-qp7p-654g-cw7p. `bun audit` shows no advisory left on these; the unrelated ones still open are in [Dependency security upgrades](/backlog/dependency-security-upgrades/).                                                               |
| F-3/F-4 rate limit | Done. Explicit, `storage: "database"` (`kaipu_record_rate_limit`), keyed on `cf-connecting-ip`; rules on the credential endpoints and the desktop code exchange; `/get-session` exempt; the proxy strips `x-forwarded-for`/`x-real-ip`; the web SSR session check forwards the client address. Tests: `rate-limit.test.ts`, `proxy-handler.test.ts`. |
| F-5 / F-13         | **Deferred to the owner** ([item 3](#3-verified-email-required-f-5-f-13--deferred-to-the-owner)). The Google-link takeover residue is closed and flow-tested.                                                                                                                                                                                        |
| F-7 / web #2       | Done. `isRequestAllowed` on `/api/v1/*`; cookies `SameSite=Lax`. Every cookie-bearing write in the repo is a same-origin browser fetch through the proxy; nothing server-side writes with a cookie.                                                                                                                                                  |
| F-10               | Done. Async scrypt + `timingSafeEqual` in `packages/infra-auth/src/config/password.ts`, legacy-hash tests.                                                                                                                                                                                                                                           |
| F-11               | Done. `min(32)` in the env schema; fixtures, docs and README updated.                                                                                                                                                                                                                                                                                |
| OAuth tokens       | Already on `main` (`account-linking.ts`, NIW2-219). Nothing in the repo reads the tokens back.                                                                                                                                                                                                                                                       |
| 429 handling       | Done. Web sign-in, sign-up and reset show "too many attempts"; the desktop maps 429 on the code exchange to `throttled`, never `invalid-code`.                                                                                                                                                                                                       |

### Not verifiable here

- That `cf-connecting-ip`, `Origin` and `Sec-Fetch-Site` survive the Cloudflare service binding
  between the web and API Workers (they are copied by `new Request(url, request)`; the binding
  is believed to pass headers unchanged). Owner action 7 is the check.
- The length of the production `BETTER_AUTH_SECRET` (owner action 1).
- Whether `kaipu_record_rate_limit` exists in production (owner action 4).

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
  [ADR 0029](/architecture/decisions/0029-auth-rate-limits-in-the-database/).
