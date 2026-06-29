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
3. Attaches the artifacts to a **draft pre-release** GitHub Release.

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
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                                              | secrets  | desktop → R2 upload (S3 token)    |

> The web app proxies auth/CORS to the backend and never runs Better Auth, so its env is only
> `DATABASE_URL` + `VITE_SERVER_URL` (+ the build-time `VITE_PUBLIC_DOWNLOAD_URL`). `BETTER_AUTH_*` /
> `CORS_ORIGIN` live on the **API** only.

> **R2 credentials:** the upload uses R2's S3-compatible API, which needs **R2-specific** keys
> (`R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`, created in **R2 → Manage R2 API Tokens**) — the
> Cloudflare API token does **not** work for it. The R2 account id reuses `CLOUDFLARE_ACCOUNT_ID`,
> and the bucket name is a plain constant in the workflow (`kaipu-bucket`) — neither is a secret.

## PR validation

`.github/workflows/pr-validation.yml` runs on PRs into `main`: lint, format check, typecheck, build
the packages/web/api, and run the desktop test suite. It does **not** deploy.
