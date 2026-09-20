---
title: "Credential inventory — where every variable goes"
description: "Every secret and config variable in the monorepo, its current homes, and its destination under the Infisical + varlock migration."
---

# Credential inventory — where every variable goes

**Status: 🔵 Proposed — nothing migrated yet.** Working reference for the
migration designed in
[Secrets & Env — Migrate to Infisical + varlock](/specs/2026-09-17-infisical-varlock-secrets-migration/).
Inventory taken 2026-09-17 against `main` at `ecdc957`, cross-checked against the
GitHub `production` environment.

## How to read this

Every variable in the repo lands in exactly one of five destinations:

| Destination        | Meaning                                                           |
| ------------------ | ----------------------------------------------------------------- |
| **Infisical**      | A real credential. Lives in one folder, in `dev` and/or `prod`.   |
| **Schema literal** | A name, URL, or flag. Committed in a `.env.schema`. Not a secret. |
| **GitHub Secrets** | Stays put — deliberately not migrated.                            |
| **Delete**         | Stray, duplicated, or dead.                                       |
| **Out of scope**   | `apps/console`, excluded until it is committed.                   |

The rule: **Infisical holds what grants access. The schema holds everything
else.** If leaking it would let someone do something, it is a credential.

## Target folder layout

```
/cloudflare      CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
                 + CLOUDFLARE_API_TOKEN  (prod only — there are no dev deploys)
/database        DATABASE_URL
/server-hono     BETTER_AUTH_SECRET, RESEND_API_KEY
/kaipu-record    POSTHOG_KEY, CSC_LINK, CSC_KEY_PASSWORD,
                 APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER
```

Four folders, thirteen secrets. Two grouped by the **external system** they
unlock (Cloudflare, Neon), two by the **app** that solely owns them.

R2 is part of Cloudflare, so `/storage` and `/deploy` collapsed into
`/cloudflare` — splitting them would have produced three folders of one or two
variables each, which is filing for its own sake. `/database` stays separate
because Neon is a different vendor with its own rotation cycle, and it grows to
two entries once `TEST_DATABASE_URL` is wired into CI.

`CLOUDFLARE_API_TOKEN` living in the same folder as the R2 keys is deliberate
and safe: it exists **only in `prod`**, so the laptop's `local-dev` identity —
which reads `dev` — never sees it. The environment boundary does that work, not
the path.

`apps/web-hono` gets no folder — everything it needs is a public URL.

## 1. Secrets → Infisical

| Variable                | Folder          | Envs            | Currently lives in                                        |
| ----------------------- | --------------- | --------------- | --------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | `/cloudflare`   | dev + prod      | GH Secret — **absorbs `R2_ACCOUNT_ID`**, see D1           |
| `R2_ACCESS_KEY_ID`      | `/cloudflare`   | dev + prod      | GH Secret · `server-hono/.env`                            |
| `R2_SECRET_ACCESS_KEY`  | `/cloudflare`   | dev + prod      | GH Secret · `server-hono/.env`                            |
| `CLOUDFLARE_API_TOKEN`  | `/cloudflare`   | **prod only**   | GH Secret                                                 |
| `DATABASE_URL`          | `/database`     | dev + prod      | GH Secret · `server-hono/.env` · ~~`web-hono/.env`~~ (D4) |
| `TEST_DATABASE_URL`     | `/database`     | _deferred_      | `server-hono/.env.example` only — not wired into CI yet   |
| `BETTER_AUTH_SECRET`    | `/server-hono`  | dev + prod      | GH Secret · `server-hono/.env`                            |
| `RESEND_API_KEY`        | `/server-hono`  | dev + prod      | GH Secret · `server-hono/.env` (+ a stray copy, see §4)   |
| `POSTHOG_KEY`           | `/kaipu-record` | dev + prod      | `kaipu-record/.env` — one value, two names today (D2)     |
| `CSC_LINK`              | `/kaipu-record` | prod + dev copy | GH Secret · `kaipu-record/.env.signing`                   |
| `CSC_KEY_PASSWORD`      | `/kaipu-record` | prod + dev copy | GH Secret · `kaipu-record/.env.signing`                   |
| `APPLE_API_KEY`         | `/kaipu-record` | prod + dev copy | GH Secret · `kaipu-record/.env.signing`                   |
| `APPLE_API_KEY_ID`      | `/kaipu-record` | prod + dev copy | GH Secret · `kaipu-record/.env.signing`                   |
| `APPLE_API_ISSUER`      | `/kaipu-record` | prod + dev copy | GH Secret · `kaipu-record/.env.signing`                   |

Two variable names disappear as stored secrets and become schema mappings
instead — one stored value feeding the name each consumer expects:

| Consumer expects        | Reads from                              |
| ----------------------- | --------------------------------------- |
| `R2_ACCOUNT_ID`         | `/cloudflare` → `CLOUDFLARE_ACCOUNT_ID` |
| `MAIN_VITE_POSTHOG_KEY` | `/kaipu-record` → `POSTHOG_KEY`         |
| `VITE_POSTHOG_KEY`      | `/kaipu-record` → `POSTHOG_KEY`         |

**Why the signing material gets a `dev` copy:** `bun run build:mac` runs on the
laptop and needs prod-shaped signing credentials. Copying those five into `dev`
is cheaper and safer than granting the laptop identity access to `prod`.

## 2. Non-secrets → committed schema literals

None of these belong in Infisical. Several are already sitting in the repo in
plaintext, which settles the question.

| Variable                   | Value(s)                                              | Home                  | Note                                                                     |
| -------------------------- | ----------------------------------------------------- | --------------------- | ------------------------------------------------------------------------ |
| `CORS_ORIGIN`              | `https://kaipu.app` / `http://localhost:3001`         | `server-hono` schema  | currently a GH **Variable**, not a secret                                |
| `PUBLIC_WEB_URL`           | `https://kaipu.app` / `http://localhost:3001`         | `server-hono` schema  | added locally 2026-09-17 for email links                                 |
| `AUTH_EMAIL_FROM`          | `Kaipu <no-reply-kaipu@updates.niway.dev>`            | `server-hono` schema  | optional in `serverEnvSchema`; has a code default                        |
| `R2_BUCKET`                | `kaipu-private-bucket`                                | `server-hono` schema  | user assets (private)                                                    |
| `R2_BUCKET`                | `kaipu-bucket`                                        | `kaipu-record` schema | builds + update feed. Already hardcoded in `release-desktop.yml:103,132` |
| `VITE_SERVER_URL`          | `https://kaipu-api.cristiansotomayor-dev.workers.dev` | `web-hono` schema     | GH Variable                                                              |
| `MAIN_VITE_SERVER_URL`     | same as above                                         | `kaipu-record` schema | GH Variable — see D3                                                     |
| `VITE_PUBLIC_DOWNLOAD_URL` | `https://updates.kaipu.app`                           | `web-hono` schema     | already hardcoded in `release-web.yml`                                   |
| `VITE_VERSION_GATE_URL`    | —                                                     | `kaipu-record` schema | local only                                                               |
| `VITE_PUBLIC_WEB_URL`      | —                                                     | `kaipu-record` schema | in `.env.example` only                                                   |
| `MAIN_VITE_POSTHOG_HOST`   | —                                                     | `kaipu-record` schema | public ingest host                                                       |
| `VITE_POSTHOG_HOST`        | —                                                     | `kaipu-record` schema | public ingest host                                                       |
| `VITE_POSTHOG_PRODUCT`     | —                                                     | `kaipu-record` schema | label                                                                    |
| `VITE_POSTHOG_SURFACE`     | —                                                     | `kaipu-record` schema | label                                                                    |
| `APP_ENV`                  | `development` / `production`                          | root schema           | new — drives `forEnv()`                                                  |

**On `R2_BUCKET` appearing twice:** this is not duplication of a secret. They
are two different buckets that happen to share a variable name, and bucket names
are not credentials — both already appear in plaintext in committed files. The
R2 _credentials_ exist once, in `/cloudflare`.

**On the PostHog keys:** the ingest key ships inside a distributed binary, so it
is not a secret in the strict sense. It goes to Infisical anyway so rotation has
a single target.

## 3. Stays in GitHub Secrets

| Variable               | Why                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RELEASE_PLEASE_TOKEN` | Authenticates release-please against GitHub itself, before and independently of varlock. Moving it would add a bootstrap dependency and buy nothing. |

## 4. Delete, do not migrate

| What                          | Where                    | Why                                                                                                                                                                                                   |
| ----------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`              | `apps/kaipu-record/.env` | A server-side credential in the desktop app's env file. It carries no `VITE_`/`MAIN_VITE_` prefix so Vite never inlines it — it does **not** ship in the binary — but it has no business being there. |
| `DATABASE_URL`                | `apps/web-hono/.env`     | Already annotated "marked for future removal" in `webServerEnvSchema`. Confirmed removed — see D4.                                                                                                    |
| `.env.bak-20260905122924`     | `apps/kaipu-record/`     | Stray backup.                                                                                                                                                                                         |
| `.env.x`                      | repo root                | dotenvx project metadata; dies with dotenvx in phase 2.                                                                                                                                               |
| All four `.env.example` files | per app                  | Replaced by the committed `.env.schema`, which cannot drift from the code.                                                                                                                            |

## 4b. Already pre-loaded into Infisical — remove in phase 6

Secrets were loaded into Infisical ahead of this design, including a number of
variables that turn out not to be secrets. They are **harmless where they are**:
the schema will never reference them with an `infisical()` resolver, so varlock
never reads them. They sit inert until the gated cleanup.

**Do not delete them during phases 1–5.** Same rule as the GitHub Secrets —
nothing is removed until the new path has a verified green run, so rollback
stays a `git revert`.

| Pre-loaded in Infisical    | Becomes                                                   | Removed in |
| -------------------------- | --------------------------------------------------------- | ---------- |
| `CORS_ORIGIN`              | schema literal                                            | phase 6    |
| `MAIN_VITE_SERVER_URL`     | schema literal                                            | phase 6    |
| `VITE_SERVER_URL`          | schema literal                                            | phase 6    |
| `VITE_PUBLIC_DOWNLOAD_URL` | schema literal                                            | phase 6    |
| `VITE_VERSION_GATE_URL`    | schema literal                                            | phase 6    |
| `MAIN_VITE_POSTHOG_HOST`   | schema literal                                            | phase 6    |
| `VITE_POSTHOG_HOST`        | schema literal                                            | phase 6    |
| `VITE_POSTHOG_PRODUCT`     | schema literal                                            | phase 6    |
| `VITE_POSTHOG_SURFACE`     | schema literal                                            | phase 6    |
| `VITE_POSTHOG_KEY`         | duplicate — the value survives as `POSTHOG_KEY`           | phase 6    |
| `R2_ACCOUNT_ID`            | duplicate — the value survives as `CLOUDFLARE_ACCOUNT_ID` | phase 6    |
| `R2_BUCKET`                | schema literal, one per app                               | phase 6    |

Why they should not stay, even though they are not sensitive: keeping public
config in Infisical buys **no operational flexibility** here. Worker vars are
resolved at `varlock-wrangler deploy` time and desktop vars are inlined at build
time, so changing a value in Infisical does nothing until the next deploy or
rebuild — exactly what a committed literal already requires. What it costs is
real: the value stops appearing in pull-request diffs, `varlock load` needs the
network for it, and the same variable ends up defined in three places (`.env`,
GitHub Variables, Infisical) with nothing keeping them in sync.

## 5. Out of scope — `apps/console`

Untracked work-in-progress; excluded until committed. For the record, it will
need: `DATABASE_URL` (reads `/database`, no new secret), plus `CONSOLE_API_URL`,
`CONSOLE_ENVIRONMENT`, `CONSOLE_ADMIN_USER_IDS` — all three non-secret config
that will become schema literals in a `/console` follow-up.

## Decisions

Settled 2026-09-17.

**D1 — `CLOUDFLARE_ACCOUNT_ID` is the single stored name.** It and
`R2_ACCOUNT_ID` were always the same value under two names, a duplication that
crept in as the project grew. One entry now lives in `/cloudflare`; the
`server-hono` schema maps `R2_ACCOUNT_ID` from it, so application code keeps the
name it already uses and nothing in the codebase has to change.

**D2 — one `POSTHOG_KEY`, mapped to both names.** `MAIN_VITE_POSTHOG_KEY` and
`VITE_POSTHOG_KEY` carry the same value (the main process and the renderer each
need it under their own Vite prefix). Stored once, mapped twice in the schema.

**D3 — `MAIN_VITE_SERVER_URL` keeps pointing at the `workers.dev` URL.** The API
is deliberately not exposed under the custom domain, and the desktop app targets
the same origin as the web app's backend. It stays a committed literal.

> Worth knowing, not worth blocking on: this URL is inlined into the distributed
> desktop binary at build time, so anyone with a copy of the app can read it.
> Keeping it off the custom domain raises the bar for casual discovery but is not
> an access control. Whatever protects that endpoint has to be auth, not the
> URL being hard to find.

**D4 — `web-hono` drops `DATABASE_URL`.** Its own `webServerEnvSchema` already
flags it for removal and it is not needed. Remove it in phase 3 rather than
migrating a dependency the code wants gone.

## Infisical checklist

Per environment (`dev` and `prod`), create the folders and move the existing
secrets in. Names must be **identical across both environments** — the varlock
schema names the path once and lets `APP_ENV` pick the environment.

- [ ] `dev/cloudflare` — `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` _(no API token)_
- [ ] `dev/database` — `DATABASE_URL`
- [ ] `dev/server-hono` — `BETTER_AUTH_SECRET`, `RESEND_API_KEY`
- [ ] `dev/kaipu-record` — `POSTHOG_KEY` + the five signing secrets (copied from prod)
- [ ] `prod/cloudflare` — `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_API_TOKEN`
- [ ] `prod/database` — `DATABASE_URL`
- [ ] `prod/server-hono` — `BETTER_AUTH_SECRET`, `RESEND_API_KEY`
- [ ] `prod/kaipu-record` — `POSTHOG_KEY` + the five signing secrets

Note the asymmetry: `dev/cloudflare` deliberately omits `CLOUDFLARE_API_TOKEN`.
There are no deploys from a laptop, so the identity that reads `dev` must never
be able to deploy or destroy a Worker.

Then the two machine identities:

- [ ] `local-dev` — Universal Auth, read-only on `dev`. Client secret shown once;
      store it in the password manager immediately.
- [ ] `github-actions` — OIDC, read-only on `prod`: - Issuer `https://token.actions.githubusercontent.com` - Audience `https://github.com/csdev19` - Subject `repo:csdev19/kaipu-record-monorepo:environment:production`

**Do not empty any GitHub Secret yet.** They come out only after each migrated
workflow has one verified green run on the new path (phase 6 of the spec).

## Security observations (separate from this migration)

Found while taking the inventory. Neither is caused by the migration, and
neither should be bundled into it — rotation and migration must stay separate so
a failure is diagnosable.

1. **One R2 credential covers both buckets.** `release-api.yml:63` and
   `release-desktop.yml:98` use the same `R2_ACCESS_KEY_ID` /
   `R2_SECRET_ACCESS_KEY`. That means the token used to publish public builds
   can also read and write `kaipu-private-bucket`, which holds users' private
   recordings. R2 supports per-bucket scoped tokens; splitting into two would
   shrink the blast radius considerably. Deliberately deferred.
2. **`RESEND_API_KEY` sits in the desktop app's env file.** It does not ship (no
   Vite prefix), but it should not be there. Deleted in phase 4.
