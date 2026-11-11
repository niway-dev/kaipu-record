---
title: CI/CD pipelines — releases & deploys
description: How the three deployables (desktop, web, api) are versioned and shipped — tag-driven, independent pipelines on GitHub Actions, deploying to Cloudflare (Workers + R2).
---

# CI/CD pipelines — releases & deploys

The monorepo ships **three independent deployables**, each versioned and released on its own. There
is **no `production` branch** — everything is **tag-driven**: you push a component-prefixed tag and
the matching GitHub Actions workflow runs.

| Component                 | Tag pattern      | Workflow                                | Target                                                  |
| ------------------------- | ---------------- | --------------------------------------- | ------------------------------------------------------- |
| **Desktop** (Electron)    | `desktop-v*.*.*` | `.github/workflows/release-desktop.yml` | Signed macOS DMG/zip → Cloudflare R2 + a GitHub Release |
| **Web** (landing + proxy) | `web-v*.*.*`     | `.github/workflows/release-web.yml`     | Cloudflare Worker (`kaipu-web`) → `kaipu.app`           |
| **API** (backend)         | `api-v*.*.*`     | `.github/workflows/release-api.yml`     | Cloudflare Worker (`kaipu-api`)                         |

Each also has a `workflow_dispatch` trigger, so you can run any of them manually from the **Actions**
tab without cutting a tag.

## Versioning

- The three components version **independently** — the tag prefix decides what ships, and each app's
  `package.json` `version` tracks its own line.
- We start at **`0.1.0`** and move `0.1 → 0.2 → …` while pre-1.0. The first real tags are
  `desktop-v0.1.0`, `web-v0.1.0`, `api-v0.1.0`.
- Plain semver: `MAJOR.MINOR.PATCH`. The tag must match `*-v*.*.*` (three dotted numbers after the
  prefix), e.g. `desktop-v0.2.1`.

## Cutting a release

```bash
# Desktop — builds, signs, notarizes the macOS app, uploads to R2 + GitHub Release
git tag desktop-v0.1.0 && git push origin desktop-v0.1.0

# Web — builds and deploys the web Worker (kaipu.app)
git tag web-v0.1.0 && git push origin web-v0.1.0

# API — deploys the backend Worker
git tag api-v0.1.0 && git push origin api-v0.1.0
```

Keep the tag and the component's `package.json` version in sync (bump the file, commit, then tag).

## What each pipeline does

### Desktop — `release-desktop.yml`

1. Builds the macOS app for **arm64 + x64**, **signs with Developer ID** and **notarizes** (secrets in
   the `production` environment).
2. Uploads the update feed (`*-mac.zip` + `.blockmap` + `latest-mac.yml`) to R2 under `updates/`, and
   the installers (`.dmg`) to `download/<version>/` and `download/latest/`.
3. Attaches the artifacts to a **draft pre-release** GitHub Release.

4. **Manual, after Publish: recount the UI catalog.** No workflow does this (the catalog runs the
   real app on the Mac mini and publishes to a private repository, so it cannot run in CI):

   ```bash
   cd apps/kaipu-record && bun run ui-catalog:remote --sha desktop-v<version> && bun run ui-catalog:publish --push
   ```

   `bun run ui-catalog:status` says whether the catalog is `current` or `behind` the newest
   `desktop-v*` tag; `bun run setup` prints the same line. See the
   [UI state catalog](/backlog/ui-state-catalog).

The version is parsed from the tag: `desktop-v0.1.0` → `0.1.0` (used for the DMG filenames). See
[auto-update](/backlog/auto-update) and [version-gate](/backlog/version-gate) for how installed apps
consume the R2 feed.

### Web — `release-web.yml`

1. Installs deps, builds the packages `apps/web-hono` depends on (`web-hono^...`), then builds
   the web app.
2. Deploys the Worker with `scripts/deploy-worker.sh apps/web-hono`. The Worker is attached to `kaipu.app` +
   `www.kaipu.app` (custom domains in `apps/web-hono/wrangler.jsonc`), so DNS + SSL are provisioned
   automatically on deploy.

`VITE_PUBLIC_DOWNLOAD_URL` is set to `https://updates.kaipu.app` at build so the landing's download
buttons point at the R2 installers.

### API — `release-api.yml`

1. Installs deps, builds the packages `apps/server-hono` depends on (`server-hono^...`).
2. Deploys the Worker with `scripts/deploy-worker.sh apps/server-hono`.

### Worker secrets travel with the deploy

Both release jobs write their Worker secrets to a JSON file and run
`wrangler deploy --secrets-file`, so code and secrets go live as **one** version. Do not
use the action's `secrets:` input. It runs `wrangler secret bulk` first, which deploys the
previous code with the new secrets as a separate version, and Cloudflare refuses that edit
outright when the latest uploaded version is not the deployed one — which is exactly the
state `preview-web.yml` leaves behind. That is how `web-v0.9.0` failed on 2026-10-06.

`--secrets-file` is additive: a secret missing from the file keeps its current value, and
the jobs drop empty values so a missing GitHub secret cannot blank one. Removing a secret
from a Worker is a deliberate `wrangler secret delete`, never a side effect of a release.

### One deploy script, dry-run on the release candidate

Both release jobs deploy through `scripts/deploy-worker.sh`. It pins wrangler
(`WRANGLER_VERSION`, 4.148.0), installs it globally with bun if needed, and calls it by
absolute path. The workspace still has 4.63.0 for local development, which lacks
`--secrets-file`; bump both together when the workspace upgrades, and keep the
`preview-web.yml` pin equal.

The jobs do not use `cloudflare/wrangler-action` for the deploy. The action resolves
wrangler with `npx` inside the app directory, so `apps/server-hono`'s own 4.63.0
devDependency shadowed the pinned version and `api-v0.5.0` failed on 2026-10-20 with
`Unknown arguments: secrets-file`. `release-web` kept working only because
`apps/web-hono` has no local wrangler.

The release-candidate PR check (`Web and API - Workers bundle`) runs the same script with
`--dry-run` after building the app, with an empty secrets file: for the Worker the candidate
ships (both on a manual dispatch, neither on a desktop candidate). A deploy command that
cannot run now fails on the release pull request instead of on the tag.

### What a release verifies

A release pull request and its tag workflow verify the component they ship plus that
component's workspace dependencies, nothing else
([ADR 0052](/architecture/decisions/0052-release-candidates-verify-only-the-component-they-ship/)).
The component comes from the release-please branch name; a manual dispatch of `pr-checks.yml`
verifies everything.

- **Release pull request** (`pr-checks.yml`): lint and the docs build always run; type-check
  and workspace tests are scoped to the component; the desktop unit shards and the macOS E2E
  run only for a desktop candidate; the Workers bundle runs only for web and API.
- **Tag workflow**: `bun run verify:release <web|api|desktop>` (`scripts/verify-release.sh`)
  runs the same lint, format, build, type-check and test scope on the exact tagged SHA. Root
  `bun run verify` still checks the whole workspace when you run it; the pre-push hook runs
  `bun run verify:local` (lint, format, builds, types).

## First-deploy order (one-time)

Deploy the **API first**, then the **web**. The web Worker reaches the API through a Cloudflare
**Service Binding** (`API_SERVICE` → `kaipu-api`), so that Worker must already exist. After the
first deploy of each, they ship independently in any order.

## Domains

| Host                | Serves                                               | DNS provisioning                                                          |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `kaipu.app` + `www` | web Worker (landing)                                 | Auto on `wrangler deploy` (custom_domain routes)                          |
| `updates.kaipu.app` | R2 bucket (update feed + DMGs + `version-gate.json`) | R2 → Settings → Custom Domains                                            |
| `api.kaipu.app`     | _(optional)_                                         | Only if exposing the API directly; today it's reached via Service Binding |

## Secrets & variables (GitHub `production` environment)

Deploys read from the repo's **`production`** Environment:

| Name                                                                                    | Kind     | Used by                          |
| --------------------------------------------------------------------------------------- | -------- | -------------------------------- |
| `CLOUDFLARE_API_TOKEN`                                                                  | secret   | web + api deploy (wrangler auth) |
| `CLOUDFLARE_ACCOUNT_ID`                                                                 | secret   | web + api deploy                 |
| `DATABASE_URL`                                                                          | secret   | web build + web/api Workers      |
| `BETTER_AUTH_SECRET`                                                                    | secret   | api Worker                       |
| `CORS_ORIGIN`                                                                           | variable | api Worker                       |
| `VITE_SERVER_URL`                                                                       | variable | web build + Worker               |
| `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | secrets  | desktop sign/notarize            |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                                              | secrets  | desktop → R2 upload (S3 token)   |

> The web app proxies auth/CORS to the backend and never runs Better Auth, so its env is only
> `DATABASE_URL` + `VITE_SERVER_URL` (+ the build-time `VITE_PUBLIC_DOWNLOAD_URL`). `BETTER_AUTH_*` /
> `CORS_ORIGIN` live on the **API** only.

> **R2 credentials:** the upload uses R2's S3-compatible API, which needs **R2-specific** keys
> (`R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`, created in **R2 → Manage R2 API Tokens**) — the
> Cloudflare API token does **not** work for it. The R2 account id reuses `CLOUDFLARE_ACCOUNT_ID`,
> and the bucket name is a plain constant in the workflow (`kaipu-bucket`) — neither is a secret.

## GitHub Environments: who may reach what

The repository is public, so the Environments are the boundary around the secrets, and their
deployment-branch policies decide which refs may cross it. The reasoning and the audit for the
day a repository goes public are in the hub's
[public-repo-production-protection](https://github.com/csdev19/general-knowledge/blob/main/monorepos/public-repo-production-protection.md);
this is the configuration as applied here (inspected 2026-10-06).

| Environment  | May be declared from                                     | Holds                                                                                 | Declared by                                                                                     |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `production` | `main` (branch), `desktop-v*`, `web-v*`, `api-v*` (tags) | everything in the table above, plus `RELEASE_PLEASE_TOKEN` and `MAIN_VITE_SERVER_URL` | `release-desktop.yml`, `release-web.yml`, `release-api.yml` (tags); `release-please.yml` (main) |
| `preview`    | any ref                                                  | the Cloudflare token and account id, a throwaway `DATABASE_URL`                       | `preview-web.yml` — uploads a version, deploys nothing                                          |
| `testing`    | any ref                                                  | `MAIN_VITE_SERVER_URL` only (a public URL the desktop build inlines)                  | `pr-checks.yml` → `Desktop - E2E tests (macOS)`                                                 |

Rules that follow from the table:

- **A job on a `pull_request` event never declares `production`.** The E2E job used to, only to
  read `MAIN_VITE_SERVER_URL`; that handed every PR branch the signing keys and the database URL.
  A PR-time job that needs a value gets it from `testing`; a value only `testing` needs is added
  there, never to `production`.
- **The administrator bypass on `production` is off**, so the policy applies to the maintainer
  too. A one-off manual deploy from another branch means adding that branch to the policy first.
- **The `main` ruleset requires a pull request** (zero approvals — the maintainer cannot approve
  their own) and the `Release candidate verified` check; force pushes and deletion are blocked.
- **Fork pull requests run nothing until approved** (Actions → General, "all external
  contributors"); a fork's run holds no Environment secrets and a read-only token either way.
- **Secret scanning, push protection and Dependabot alerts are on.** They were off while the
  repository was private; nothing fails when they are off, which is why they are listed here.

## PR checks

One workflow, `pr-checks.yml`, runs on every pull request and deploys nothing. An ordinary pull
request gets an immediate pass from the required check; only release candidates (release-please
pull requests and a manual dispatch) are verified
([ADR 0027](/architecture/decisions/0027-verify-release-candidates-only/)), and each candidate
verifies only the component it ships ([What a release verifies](#what-a-release-verifies),
[ADR 0052](/architecture/decisions/0052-release-candidates-verify-only-the-component-they-ship/)).
The macOS E2E is a job in the same workflow, run for desktop candidates.

## Claude review (advisory)

`agent-review.yml` (a caller of the reusable workflow `niway-dev/wachiman`, pinned to an exact release) posts a Claude code review on a pull request when it is ready for review, and
on the owner's `/wachi review` comment. Findings arrive as inline review comments; nothing blocks
a merge. It needs the **repository** secret `ANTHROPIC_API_KEY` (Settings → Secrets and variables
→ Actions → Repository secrets), not an environment secret. Why and how:
[ADR 0028](/architecture/decisions/0028-advisory-claude-review-on-pull-requests).
