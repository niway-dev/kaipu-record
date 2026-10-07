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
| **Web** (landing + proxy) | `web-v*.*.*`     | `.github/workflows/deploy-web.yml`      | Cloudflare Worker (`kaipu-web`) → `kaipu.app`           |
| **API** (backend)         | `api-v*.*.*`     | `.github/workflows/deploy-api.yml`      | Cloudflare Worker (`kaipu-api`)                         |

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
3. Attaches the artifacts to the GitHub Release release-please created for the tag, published
   and marked **Latest** (`draft: false`, `prerelease: false`, `make_latest: true`). The repo has a
   single Latest shared by desktop/web/api, and the in-app "Update" link defaults to
   `/releases/latest`, so the desktop release must own it: web and api releases are created as
   **pre-release** in `release-please-config.json` and never take the slot (release-please only
   applies that flag while the version is pre-1.0; see the
   [release-please spec](/specs/2026-07-06-release-automation-release-please) for the reopen
   condition). Cutting a desktop release needs no manual `gh release edit` afterwards.

The version is parsed from the tag: `desktop-v0.1.0` → `0.1.0` (used for the DMG filenames). See
[auto-update](/backlog/auto-update) and [version-gate](/backlog/version-gate) for how installed apps
consume the R2 feed.

### Web — `deploy-web.yml`

1. Installs deps, builds the `@kaipu/*` packages, then builds the web app (`apps/web-hono`).
2. Deploys the Worker via `cloudflare/wrangler-action`. The Worker is attached to `kaipu.app` +
   `www.kaipu.app` (custom domains in `apps/web-hono/wrangler.jsonc`), so DNS + SSL are provisioned
   automatically on deploy.

`VITE_PUBLIC_DOWNLOAD_URL` is set to `https://updates.kaipu.app` at build so the landing's download
buttons point at the R2 installers.

### API — `deploy-api.yml`

1. Installs deps, builds the `@kaipu/*` packages.
2. Deploys the Worker (`apps/server-hono`) via `cloudflare/wrangler-action`.

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

The three Worker workflows pin `wrangler@4.148.0`. The workspace still has 4.63.0 for local
development, which lacks `--secrets-file`; bump both together when the workspace upgrades.

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

Two workflows run on PRs into `main` (neither deploys): `pr-validation.yml` (lint, format
check, typecheck, build the packages/web/api, desktop unit suite) and `e2e-desktop.yml` (the
Playwright + Electron E2E suite for the desktop app). They are kept **separate on purpose** — a
cheap monorepo-wide gate vs an expensive desktop-only one. See
[PR checks — validation & E2E](/deployment/pr-checks) for what each does and why the split.
