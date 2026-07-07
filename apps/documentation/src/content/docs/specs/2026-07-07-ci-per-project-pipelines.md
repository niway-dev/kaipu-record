---
title: Per-project CI pipelines
description: Split the monolithic PR check into a fast universal compile check plus path-filtered per-project test workflows, skip release PRs, and normalize release-* naming.
---

## Problem

CI was one monolithic workflow, `pr-validation.yml` ("Validate PR"), triggered on
**every** PR to `main` with no path filter. It ran lint + format + build-all +
type-check-all + build-web + build-backend + type-check-desktop **and the full
desktop test suite** in a single job. Two consequences:

- **No scoping.** A web-only or api-only PR still ran the desktop tests, and vice
  versa. Everything ran on everything.
- **Release PRs paid the full price.** release-please chore PRs (version + CHANGELOG
  only) touch `apps/<app>/package.json`, so they matched the desktop E2E path filter
  and always ran `pr-validation` — running the heavy suites on mechanical version
  bumps.

The dominant cost is the desktop unit suite: **~2m 9s in CI** (the same 600 tests
run in ~10s locally — a CI-parallelism gap tracked as a follow-up, not fixed here).

## Goal

- A **fast universal check** on every PR that answers "does everything still compile,
  lint and format?" — the always-on green light.
- **Per-project test suites** that run **only when that project changes** (or a shared
  package it depends on) — never on unrelated PRs.
- **Zero ceremony on release PRs.**
- Consistent **`release-*`** naming for all release/deploy workflows.

## Design

### Universal check — `ci.yml` ("CI")

Runs on every PR (skips docs-only via `paths-ignore` and release-please branches via
`if`). One job: lint → format → build `@kaipu/*` → type-check all → build web → build
backend → type-check desktop. **No tests.** ~1–1.5 min. This is `pr-validation` minus
the desktop test step.

### Per-project tests (path-filtered, skip release PRs)

| Workflow         | Name              | Paths                                                   | Jobs                                                          |
| ---------------- | ----------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| `ci-desktop.yml` | **Desktop Tests** | `apps/kaipu-record/**`, `packages/**`, `bun.lock`, self | `unit` (vitest) + `e2e` (Electron/Playwright), in parallel    |
| `ci-web.yml`     | **Web Tests**     | `apps/web-hono/**`, `packages/**`, `bun.lock`, self     | `test` — runs `apps/web-hono`'s `test` script when present    |
| `ci-api.yml`     | **API Tests**     | `apps/server-hono/**`, `packages/**`, `bun.lock`, self  | `test` — runs `apps/server-hono`'s `test` script when present |

Each test job carries `if: ${{ !startsWith(github.head_ref, 'release-please--') }}`
so release PRs — which match the path filter via `package.json` — run nothing.

`packages/**` is in all three filters on purpose: a shared-package change can break
any consumer, so all three test suites should run.

**Desktop unit job needs no package build:** kaipu-record's only workspace dep is
`@kaipu/i18n`, resolved from source (tsdown devExports), so vitest runs directly after
install (verified locally).

**Web/api are wired but test-less today:** neither has a `test` script yet. The job's
step checks for one and no-ops with a note until it's added (building `@kaipu/*` first
only when there is actually a test to run). Adding a `test` script is all it takes to
turn each on.

### Naming normalization

Desktop already used `release-desktop.yml` ("Release Desktop"); web/api used
`deploy-web.yml` / `deploy-api.yml`. Renamed to **`release-web.yml`** ("Release Web")
and **`release-api.yml`** ("Release API") so every tag-triggered publish workflow reads
`release-*`. Triggers (`web-v*` / `api-v*`) are unchanged.

## What runs when

| A PR that touches…    | CI (compile) | Desktop Tests | Web Tests | API Tests |
| --------------------- | ------------ | ------------- | --------- | --------- |
| only desktop          | ✅           | ✅            | —         | —         |
| only web              | ✅           | —             | ✅        | —         |
| only api              | ✅           | —             | —         | ✅        |
| a shared `packages/*` | ✅           | ✅            | ✅        | ✅        |
| only docs / `*.md`    | —            | —             | —         | —         |
| a release-please PR   | —            | —             | —         | —         |

## Files

- Add: `.github/workflows/ci.yml`, `ci-desktop.yml`, `ci-web.yml`, `ci-api.yml`.
- Remove: `.github/workflows/pr-validation.yml`, `e2e-desktop.yml` (superseded).
- Rename: `deploy-web.yml` → `release-web.yml`, `deploy-api.yml` → `release-api.yml`.
- Unchanged: `release-please.yml`, `release-desktop.yml`.

No branch protection exists (private repo without Pro), so checks are advisory and
skipping CI on release PRs never blocks a merge.

## Follow-ups (out of scope)

- **CI test speed:** the desktop unit suite is ~10s locally but ~2m 9s in CI — likely
  vitest environment setup not parallelizing on the 2-core runner. Worth investigating
  (sharding / lighter test environment); would make even the per-project suite fast.
- **Web/api test suites:** add a `test` script to each; the workflows then activate.
