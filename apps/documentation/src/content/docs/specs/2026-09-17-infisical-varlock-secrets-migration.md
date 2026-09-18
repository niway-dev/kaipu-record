---
title: "Secrets & Env — Migrate to Infisical + varlock"
description: "Replace nine scattered .env files and dotenvx with one Infisical source of truth and committed varlock schemas, resolved the same way on a laptop and in CI."
---

# Secrets & env — migrate scattered `.env` + dotenvx to Infisical + varlock

**Date:** 2026-09-17 · **Branch:** `feat/varlock-phase-1-foundation` · **Scope:** repo-wide tooling

**Status: 🟡 In progress — phase 1 partially landed.** varlock 1.19.0 and the
Infisical plugin 2.1.1 are installed and the root `.env.schema` parses and
resolves (`varlock load` → exit 0). What is **not** yet proven is Infisical
authentication itself: that needs the `local-dev` machine identity's
credentials, which do not exist yet. Phases 2–6 are unchanged and unstarted —
each depends on a load that actually reaches Infisical. The
reusable, product-agnostic guidance lives in the general-knowledge hub at
`infra/infisical-varlock-secrets.md`; this document records only how that
playbook applies to this repository. Kaipu is the **second** adoption — the
first was `invisible-assistant` (2026-09-17), and the traps it found are
carried into the phases below.

## Goal

One source of truth for secret **values** (Infisical), one committed schema per
app declaring what env **exists** (varlock's `.env.schema`), and the same
resolution flow on a laptop, a fresh laptop, GitHub Actions, and Cloudflare
Workers.

The golden rule: **the repo never contains secrets** — not encrypted, not in the
clear. What travels with git is the schema. What travels outside git is a single
"secret zero" (one machine-identity credential in a gitignored `.env.local`), or
nothing at all in CI thanks to OIDC.

## What we found in this repo (evidence)

Inventory taken 2026-09-17 against `main` at `ecdc957`.

### Env files (9 real + 1 stray + 1 build artifact)

| File                                        | Gitignored   | Declares                                                                                                                                                                                                          |
| ------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server-hono/.env`                     | ✅           | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CORS_ORIGIN`, `PUBLIC_WEB_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `RESEND_API_KEY`                                                 |
| `apps/kaipu-record/.env`                    | ✅           | `MAIN_VITE_SERVER_URL`, `MAIN_VITE_POSTHOG_KEY`, `MAIN_VITE_POSTHOG_HOST`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_POSTHOG_PRODUCT`, `VITE_POSTHOG_SURFACE`, `VITE_VERSION_GATE_URL`, **`RESEND_API_KEY`** |
| `apps/kaipu-record/.env.signing`            | ✅           | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`                                                                                                                           |
| `apps/web-hono/.env`                        | ✅           | `DATABASE_URL`, `VITE_SERVER_URL`, `VITE_PUBLIC_DOWNLOAD_URL`                                                                                                                                                     |
| `apps/console/.env.example`                 | ❌ untracked | `DATABASE_URL`, `CONSOLE_API_URL`, `CONSOLE_ENVIRONMENT`, `CONSOLE_ADMIN_USER_IDS`                                                                                                                                |
| `.env.x`                                    | committed    | `DOTENVX_PROJECT_ID` (dotenvx metadata)                                                                                                                                                                           |
| `*.env.example` (4 files)                   | committed    | mirror the above, drift silently                                                                                                                                                                                  |
| `apps/kaipu-record/.env.bak-20260905122924` | ✅           | stray backup — delete                                                                                                                                                                                             |

No `.env.schema` and no `varlock`/`infisical` reference exists anywhere in the
repo today.

### Consumers

- **dotenvx — 7 root scripts**, all pointing at one app's file:
  `db:command`, `db:push`, `db:studio`, `db:generate`, `db:migrate`, `plan`,
  `test:integration` run `dotenvx run -f apps/server-hono/.env --`. This is
  exactly the trap the playbook records from `invisible-assistant`: deleting the
  app's `.env` breaks the repo-root database workflow.
- **`@kaipu/infra-env`** (zod) — `serverEnvSchema` / `webServerEnvSchema` /
  `webClientEnvSchema`, imported by `apps/server-hono/src/env.ts`,
  `apps/web-hono/src/env/{server,client}.ts`, and
  `apps/console/src/lib/backend.server.ts`.
- **Direct `process.env`, no validation** — `packages/infra-db/src/client/index.ts`,
  `packages/infra-db/drizzle.config.ts`, `apps/server-hono/scripts/plan.ts`.
- **`dotenv.config()`** — `apps/web-hono/alchemy.run.ts` loads its own `.env`.
- **electron-vite implicit loading** — `apps/kaipu-record` has _no_ env module; it
  reads `import.meta.env.MAIN_VITE_*` / `VITE_*` inlined at build time.
- **Turborepo** — `turbo.json` lists `.env*` as a cache input and declares
  `DATABASE_URL` / `TEST_DATABASE_URL` on the relevant tasks.

### CI

- 8 workflows. **No workflow uses OIDC** — no `id-token` permission anywhere.
- GitHub Secrets in use: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `DATABASE_URL`, `BETTER_AUTH_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `RESEND_API_KEY`, `RELEASE_PLEASE_TOKEN`,
  `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `CSC_LINK`,
  `CSC_KEY_PASSWORD`.
- **The four CI/test workflows use no real secrets** — only hardcoded
  placeholders. Nothing to migrate there.
- **All three release workflows already declare `environment: production`.**
  This is load-bearing for the OIDC design below.

### Cloudflare

All three Workers (`server-hono`, `web-hono`, `console`) already satisfy the
playbook's two prerequisites: `nodejs_compat` is present in
`compatibility_flags`, and **none declares a `vars` block**. `server-hono` also
carries `nodejs_compat_populate_process_env`.

### Findings worth acting on independently

1. **`RESEND_API_KEY` sits in `apps/kaipu-record/.env`** — a server-side
   credential in a desktop app's env file. It is _not_ prefixed `VITE_`/
   `MAIN_VITE_`, so Vite does not inline it and it does **not** ship in the
   binary. It is still stray and must be deleted, not migrated.
2. **`DATABASE_URL` in `apps/web-hono`** is already annotated "marked for future
   removal" in `webServerEnvSchema`. Migrating it forward would cement a
   dependency the code wants gone. Confirm before carrying it over.
3. `apps/kaipu-record/.env.bak-20260905122924` is dead weight.

## Decision

Adopt the hub playbook, with four repo-specific deviations:

1. **`apps/console/` is out of scope.** It is untracked work-in-progress; a
   migration touching it would collide with in-flight changes.
2. **No `ci` machine identity for now.** The CI/test workflows consume no real
   secrets, so the third identity the playbook suggests has nothing to
   authenticate for. Add it when `TEST_DATABASE_URL` is actually wired into CI.
3. **OIDC subject is scoped to the environment, not the repo wildcard.** Because
   every release workflow already sets `environment: production`, the subject can
   be `repo:csdev19/kaipu-record-monorepo:environment:production` instead of the
   playbook's `repo:<owner>/<repo>:*`. Strictly tighter at no cost.
4. **`RELEASE_PLEASE_TOKEN` stays in GitHub Secrets.** It authenticates
   release-please against GitHub itself, before and independently of varlock —
   moving it to Infisical would buy nothing and add a bootstrap dependency.

### Sensitivity rule

Credentials and anything that grants access go to Infisical. URLs, flags,
labels, and per-environment config stay as committed literals in the schema.

Account IDs and bucket names are borderline — they are identifiers, not
credentials — but they stay in Infisical **next to the credentials they pair
with**, because splitting one credential set across two sources of truth is an
operational footgun. Flip this only deliberately.

### Alternatives rejected — secret organisation

- **A flat environment, no paths at all.** Tempting because several values are
  shared and folders imply duplication. Rejected on one concrete blocker:
  `R2_BUCKET` already holds **two different values** in this repo
  (`kaipu-private-bucket` for server storage, `kaipu-bucket` for the desktop
  update feed). Flat forces renaming one of them and touching the code that
  reads it. A secondary reason: retrofitting paths later means editing every
  schema and every workflow at once, whereas adding them now costs a few clicks.
- **Paths by consumer (`/server`, `/desktop-release`), as the hub playbook
  suggests.** Rejected because "which consumer owns this?" is an opinion that has
  to be re-litigated on every new secret, and because it splits one app's schema
  across several paths — `kaipu-record` would read both `/desktop` and
  `/desktop-release`.
- **Paths strictly by app, with no shared paths.** Closest runner-up; it gives
  each app schema a single path and mirrors the repo layout with zero mental
  translation. Rejected because it cannot actually stay pure: the repo-root
  `db:*` scripts and the Cloudflare deploy token belong to no app, so at least
  one non-app path is required anyway — and it would put `DATABASE_URL` in two
  to four copies.

**Honest note on what paths buy today.** The main argument for paths is usually
per-path access control. In this repo that benefit is mostly _deferred_: the
strong isolation comes from the environment boundary (`local-dev` → `dev`,
`github-actions` → `prod`), and because all three release workflows share
`environment: production` they produce an identical OIDC subject, so they cannot
be told apart by identity no matter how the paths are drawn. Splitting them
would require separate GitHub Environments and separate identities — explicitly
out of scope here. Paths are adopted for organisation, for the `R2_BUCKET`
collision, and to keep that future split cheap.

### Alternatives rejected — tooling

- **`infisical run -- <cmd>` alone, no varlock.** Simpler, and it does solve
  "get secrets out of the repo". Rejected because it gives no committed record
  of _what env exists_, no type validation, no leak scanning — and with five
  apps across three runtimes (Workers, Electron, Node scripts) it would mean
  five bespoke invocations and no single source of truth for variable names.
- **Keep dotenvx, add Infisical underneath.** Rejected: dotenvx is already only
  used for seven local scripts and touches no pipeline. Keeping two injection
  tools for one job is strictly worse than replacing one with the other.
- **Delete `@kaipu/infra-env` during the migration.** Rejected per the
  playbook's proven guidance — deprecate in place. A few lines of dead code make
  the revert trivial while the migration proves itself.

## Target configuration

> ✅ **Verified against varlock 1.19.0 / `@varlock/infisical-plugin` 2.1.1**
> on 2026-09-18 during phase 1. Two corrections were needed versus the hub
> playbook and are already applied below:
>
> 1. **`secretPath` is positional, not a named argument.** The real signature is
>    `infisical(instanceId, secretName, secretPath)` — the playbook's
>    `infisical(dev, path="/x")` does not parse.
> 2. **The secret zero has dedicated types.** `@type=infisicalClientId` and
>    `@type=infisicalClientSecret` exist and are better than `@type=string`.
>
> Also learned the hard way: a comment line that begins with `@` is parsed as a
> decorator. Prose must not start with `@` or it produces a confusing
> "decorator cannot be used twice" error.

### Infisical project

Project ID `57a29646-d9c1-4bcf-a61e-434ddb21eeb9`. Secrets already exist in both
`dev` and `prod` and need reorganising into paths.

**Organising principle: a credential belongs to the system it unlocks, not to
the app that happens to use it.** Shared external systems get their own path;
what remains in an app path is genuinely that app's own (its session secret, its
analytics key, its bucket name). The result is that **every credential exists in
exactly one place**, so rotation has exactly one target.

| Path            | Contents                                                                                                       | Envs                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `/cloudflare`   | `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — plus `CLOUDFLARE_API_TOKEN` in prod only | dev + prod                                    |
| `/database`     | `DATABASE_URL`                                                                                                 | dev + prod                                    |
| `/server-hono`  | `BETTER_AUTH_SECRET`, `RESEND_API_KEY`                                                                         | dev + prod                                    |
| `/kaipu-record` | `POSTHOG_KEY`, `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`         | prod **+ a dev copy** of the signing material |

Thirteen secrets in four folders. R2 is part of Cloudflare, so storage and
deploy credentials share `/cloudflare` rather than splitting into three folders
holding one or two variables each. `/database` stays separate because Neon is a
different vendor on its own rotation cycle.

`CLOUDFLARE_API_TOKEN` sits beside the R2 keys but exists **only in `prod`**, so
the laptop identity (which reads `dev`) can never deploy or destroy a Worker.
That isolation comes from the environment boundary, not the path.

The full variable-by-variable mapping — including the non-secrets, the deletions
and the four settled decisions — lives in the
[credential inventory](/backlog/secrets-inventory/).

`apps/web-hono` gets **no path**: everything it needs (`VITE_SERVER_URL`,
`VITE_PUBLIC_DOWNLOAD_URL`) is a public URL and lives as a committed literal in
its schema. An app only earns a path once it owns a real secret.

Four consequences worth stating explicitly:

- **`/database` is shared on purpose.** `DATABASE_URL` is consumed by
  `server-hono` at runtime, by the seven repo-root `db:*` scripts (which belong
  to no app), and by `console` once it is migrated. Giving it an app path would
  force the most critical secret in the project to exist in three copies.
- **`R2_BUCKET` is not stored in Infisical at all.** It is a name, not a
  credential — and both values are _already_ committed in plaintext
  (`release-desktop.yml:103,132` hardcodes `kaipu-bucket`). Each app declares its
  own as a schema literal: `kaipu-private-bucket` for user assets,
  `kaipu-bucket` for builds and the update feed. Same variable name, two values,
  no collision, nothing to protect.
- **`R2_ACCOUNT_ID` is not stored either.** It is the same value as
  `CLOUDFLARE_ACCOUNT_ID`; the schema maps it so application code keeps the name
  it already uses. Likewise `MAIN_VITE_POSTHOG_KEY` and `VITE_POSTHOG_KEY` both
  map from a single stored `POSTHOG_KEY`.
- **`TEST_DATABASE_URL` will join `/database`** when CI actually consumes it
  (deferred, see Decision #2).

The `dev` copy of the `kaipu-record` signing material is the playbook's
least-privilege wrinkle: `build:mac` runs locally and needs prod-shaped signing
material. Copy those specific secrets into `dev` rather than granting the laptop
identity `prod` access.

PostHog note: the ingest key ships inside a distributed binary, so it is not a
secret in the strict sense. It lives in Infisical anyway so rotation has one
place to happen.

### Machine identities

| Identity         | Auth                                | Access              |
| ---------------- | ----------------------------------- | ------------------- |
| `local-dev`      | Universal Auth (client id + secret) | read-only on `dev`  |
| `github-actions` | OIDC                                | read-only on `prod` |

`github-actions` OIDC configuration:

| Field                  | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| Discovery URL / Issuer | `https://token.actions.githubusercontent.com`               |
| Audience               | `https://github.com/csdev19`                                |
| Subject                | `repo:csdev19/kaipu-record-monorepo:environment:production` |

### Environment map

| `APP_ENV` (varlock) | Infisical env | Used by                    |
| ------------------- | ------------- | -------------------------- |
| `development`       | `dev`         | laptops                    |
| `production`        | `prod`        | release + deploy workflows |

### Version pinning

Add to the existing root `workspaces.catalog`:

```jsonc
"varlock": "1.19.0",
"@varlock/infisical-plugin": "2.1.1",
"@varlock/cloudflare-integration": "1.5.2"
```

Root `devDependencies` take `varlock` + `@varlock/infisical-plugin`;
`@varlock/cloudflare-integration` goes per-app only where a Worker deploys.
Exact versions, not ranges — varlock releases frequently.

### Root `.env.schema` (committed)

```bash
# @plugin(@varlock/infisical-plugin)
# @initInfisical(id=dev,  projectId=57a29646-d9c1-4bcf-a61e-434ddb21eeb9, environment=dev,  clientId=$INFISICAL_CLIENT_ID, clientSecret=$INFISICAL_CLIENT_SECRET, cacheTtl="1h")
# @initInfisical(id=prod, projectId=57a29646-d9c1-4bcf-a61e-434ddb21eeb9, environment=prod, identityId=<GITHUB_ACTIONS_IDENTITY_ID>)
# @defaultSensitive=false @defaultRequired=infer @currentEnv=$APP_ENV
# ---

# @type=enum(development, production, test)
APP_ENV=development

# --- secret zero: only ever set in .env.local; CI uses OIDC ---
# @type=string @optional
INFISICAL_CLIENT_ID=
# @type=string @sensitive @internal @optional
INFISICAL_CLIENT_SECRET=
```

`@internal` means varlock authenticates with the client secret but never injects
it into the application process.

### App schema shape

`apps/server-hono/.env.schema` — it reads three paths, one per system it talks
to, which is the deliberate cost of sharing `/cloudflare` and `/database`:

```bash
# @import(../../.env.schema)
# @generateTsTypes(path='env.d.ts')
# ---

# --- shared systems ---
# @type=url @sensitive
DATABASE_URL=forEnv(production, infisical(prod, "DATABASE_URL", "/database"), infisical(dev, "DATABASE_URL", "/database"))
# @sensitive
R2_ACCESS_KEY_ID=forEnv(production, infisical(prod, "R2_ACCESS_KEY_ID", "/cloudflare"), infisical(dev, "R2_ACCESS_KEY_ID", "/cloudflare"))
# @sensitive
R2_SECRET_ACCESS_KEY=forEnv(production, infisical(prod, "R2_ACCESS_KEY_ID", "/cloudflare"), infisical(dev, "R2_ACCESS_KEY_ID", "/cloudflare"))
# stored once as CLOUDFLARE_ACCOUNT_ID; the app keeps the name it already uses
R2_ACCOUNT_ID=forEnv(production, infisical(prod, "CLOUDFLARE_ACCOUNT_ID", "/cloudflare"), infisical(dev, "CLOUDFLARE_ACCOUNT_ID", "/cloudflare"))

# --- this app's own ---
# @sensitive
BETTER_AUTH_SECRET=forEnv(production, infisical(prod, "BETTER_AUTH_SECRET", "/server-hono"), infisical(dev, "BETTER_AUTH_SECRET", "/server-hono"))
# @sensitive
RESEND_API_KEY=forEnv(production, infisical(prod, "BETTER_AUTH_SECRET", "/server-hono"), infisical(dev, "BETTER_AUTH_SECRET", "/server-hono"))

# --- non-sensitive config: committed literals, never Infisical ---
R2_BUCKET=kaipu-private-bucket
CORS_ORIGIN=forEnv(production, "https://kaipu.app", "http://localhost:3001")
PUBLIC_WEB_URL=forEnv(production, "https://kaipu.app", "http://localhost:3001")
AUTH_EMAIL_FROM=Kaipu <no-reply-kaipu@updates.niway.dev>
```

The `infisical(<instance>, "<secret name>", path=…)` form — naming the stored
secret explicitly when it differs from the variable name — is what makes D1 and
D2 possible without touching application code. **Verify this spelling against
the installed varlock version before relying on it**; if the two-argument form
is unavailable, store the duplicate names instead and record that in the
migration log.

`apps/web-hono/.env.schema` reaches no Infisical path at all:

```bash
# @import(../../.env.schema)
# ---
VITE_SERVER_URL=forEnv(production, "https://kaipu.app", "http://localhost:3000")
VITE_PUBLIC_DOWNLOAD_URL=https://updates.kaipu.app
```

If the repetition of `forEnv(production, infisical(prod, …), infisical(dev, …))`
proves noisy, check whether the installed varlock version supports a per-file
default path or an alias — worth doing once in phase 2 rather than duplicating
the pattern across four schemas.

### Local files after migration

| File                             | Committed     | Contents                                               |
| -------------------------------- | ------------- | ------------------------------------------------------ |
| `.env.schema` (root + per app)   | ✅            | the schemas                                            |
| `.env.local`                     | ❌ gitignored | only `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` |
| `.env`, `.env.example`, `.env.x` | **deleted**   | —                                                      |

Verify the `.gitignore` `.env*` pattern does not swallow `.env.schema`; add
`!.env.schema` if needed.

## The Electron case (verified)

`apps/kaipu-record` is the only app with no env module — electron-vite loads
variables by prefix convention and inlines them at build time. There is no
official varlock↔electron-vite integration, which initially looked like the
hardest part of this migration. It is not.

Vite's `loadEnv` reads `process.env` **after** the `.env` files, so process
environment wins (verified in `vite/dist/node/chunks/config.js`, `loadEnv`):

```js
for (const [key, value] of Object.entries(parsed))   // .env files first
  if (prefixes.some(p => key.startsWith(p))) env[key] = value;
for (const key in process.env)                        // process.env second — wins
  if (prefixes.some(p => key.startsWith(p))) env[key] = process.env[key];
```

So the entire integration is:

```bash
varlock run -- bun run build
```

**This is already proven in this repo.** `release-desktop.yml` and
`ci-desktop.yml` supply `MAIN_VITE_SERVER_URL` through the GitHub Actions `env:`
block — that is `process.env`, with no file involved — and the build consumes it
correctly today. varlock changes only where the value comes from.

The one discipline this imposes: **names in the schema must carry the exact
prefix** (`MAIN_VITE_*` for the main process, `VITE_*` for the renderer). A
mismatched prefix is ignored silently by Vite — a mute failure, not a loud one.
Phase 4 therefore requires grepping the built bundle for an expected value
rather than trusting that the build succeeded.

## Migration phases

Each phase is its own PR. Phases 1–3 are independently revertable; phase 6 is
gated on green runs from 4 and 5.

**Phase 1 — foundation.** Organise Infisical into the paths above; create both
machine identities. Pin the three packages in the catalog; add root
`devDependencies`. Write the root `.env.schema` and a local `.env.local`. Add
`.vscode/extensions.json` recommending `env-spec`. Start the migration log at
`apps/documentation/src/content/docs/backlog/infisical-varlock-migration.md`.
**Exit criterion: a green `varlock load`** — this validates plugin auth before
any app is touched.

**Phase 2 — `server-hono` + root scripts (retires dotenvx).** App schema; swap
`apps/server-hono/src/env.ts` to the varlock-resolved env; replace all seven
`dotenvx run -f apps/server-hono/.env --` invocations with `varlock run --`;
delete `.env.x` and drop the dotenvx dependency. Mark `@kaipu/infra-env`
deprecated in place — comment plus package description, no deletion. Delete
`apps/server-hono/.env` and `.env.example` only after `varlock load` passes
_and_ `bun run dev` boots _and_ `db:push` works.

**Phase 3 — `web-hono`.** App schema; `@varlock/cloudflare-integration`;
`varlock-wrangler` for deploys. Resolve the `DATABASE_URL` question (finding #2)
before carrying it forward. `alchemy.run.ts` drops its own `dotenv.config()`.

**Phase 4 — desktop build-time env.** Schema with exact `MAIN_VITE_*` / `VITE_*`
names; wrap the build in `varlock run --`. Delete the stray `RESEND_API_KEY`
line (finding #1) and the `.env.bak-*` file. **Verify by grepping the built
bundle**, not by a green exit code.

**Phase 5 — CI on OIDC.** Add `permissions: { id-token: write, contents: read }`
to the three release workflows; set `APP_ENV=production`; add an early
`bunx varlock load` step to fail fast on schema/Infisical mismatch. Both paths
work at this point — GitHub Secrets are still populated.

**Phase 6 — gated cleanup.** Only after each migrated workflow has **one
verified green run** on the new path: empty the migrated GitHub Secrets, add
`varlock scan` to the lefthook pre-commit hook (before lint), and promote this
spec's outcome into a reference doc.

## Verification

Per phase, before merge:

- `bunx varlock --version` matches the pinned catalog version.
- `varlock load` exits green and shows every expected variable, secrets masked.
- `bun run dev` boots the migrated app; `bun run build` succeeds.
- `bun run db:push` works from the repo root (phase 2 — proves dotenvx is
  genuinely replaced, not merely bypassed).
- Desktop only: the built bundle contains the expected inlined value (phase 4).
- `varlock scan` reports no leaked secrets in the tree.
- The migrated workflow has one green run **before** its GitHub Secrets are
  emptied.

## Non-goals

- **`apps/console/`** — untracked WIP, excluded entirely. Migrate it in a
  follow-up once it is committed.
- **Deleting `@kaipu/infra-env`** — deprecated in place this round; removal is a
  separate decision once varlock has proven itself across a release cycle.
- **`RELEASE_PLEASE_TOKEN`** — stays in GitHub Secrets by design.
- **A `staging` environment / `ci` identity** — deferred until CI consumes a
  real secret.
- **Keyless Cloudflare or AWS auth** — this migration moves _where secrets
  live_, not _whether Cloudflare uses tokens_.
- **Rotating any existing credential** — migration and rotation are separate
  operations; conflating them makes a failure impossible to diagnose.

## What would reopen this

- varlock introduces a breaking schema-syntax change that makes pinning
  impractical, or the project becomes unmaintained.
- The overlap with `@kaipu/infra-env` proves to be friction rather than
  transitional debt — at which point one of the two layers goes, deliberately.
- Infisical's free tier stops covering the identities, environments, or audit
  logging this design depends on.
- A second product needs these same secrets, making a per-product Infisical
  project the wrong granularity.

## References

- Hub playbook: `general-knowledge/infra/infisical-varlock-secrets.md`
- First adoption: `invisible-assistant`, `feat/infisical-varlock-migration`
- varlock Infisical plugin: <https://varlock.dev/plugins/infisical/>
- varlock Cloudflare integration: <https://varlock.dev/integrations/cloudflare/>
- varlock OIDC guide: <https://varlock.dev/guides/oidc/>
- GitHub OIDC subject claims: <https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect>
