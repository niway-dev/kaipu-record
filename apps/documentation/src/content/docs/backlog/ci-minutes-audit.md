---
title: "CI minutes — where they go and what to cut"
description: "GitHub Actions stopped running jobs because the account's spending limit was reached. What each workflow costs, why a one-line i18n change fires four of them, and the cuts ordered by minutes saved per unit of risk."
---

# CI minutes — audit and cuts

> **Status: 🔵 Proposed — urgent** (2026-09-23). Actions is refusing to start jobs:
> _"The job was not started because recent account payments have failed or your spending
> limit needs to be increased."_ Every PR check and `release-please` on `main` is red for
> this reason, not for anything in the code. Unblocking is a Billing action; this doc is
> about not hitting the ceiling again.

## The billing rule that dominates everything

GitHub bills runners by a multiplier, not by wall time:

| Runner           | Multiplier | 8 wall minutes cost |
| ---------------- | ---------- | ------------------- |
| `ubuntu-latest`  | **×1**     | 8 minutes           |
| `windows-latest` | ×2         | 16 minutes          |
| `macos-latest`   | **×10**    | **80 minutes**      |

Everything below follows from that line.

## What we run today

| Workflow                              | Trigger                                             | Runner    | Wall time (last 5) | Runs / 30 d | Billed ≈ |
| ------------------------------------- | --------------------------------------------------- | --------- | ------------------ | ----------- | -------- |
| `ci.yml` — Lint, build & type-check   | PR, `paths-ignore` md + documentation               | ubuntu    | 2–3 min            | 100+        | ~250     |
| `ci-desktop.yml` — Unit + E2E         | PR touching `apps/kaipu-record/**` or `packages/**` | ubuntu    | 3–5 min            | 100+        | ~400     |
| `ci-web.yml`                          | PR touching `apps/web-hono/**` or `packages/**`     | ubuntu    | <1 min             | 79          | ~79      |
| `ci-api.yml`                          | PR touching `apps/server-hono/**` or `packages/**`  | ubuntu    | ~1 min             | 77          | ~77      |
| `release-please.yml`                  | every push to `main`                                | ubuntu    | <1 min             | 88          | ~88      |
| **`release-desktop.yml`**             | `desktop-v*` tag                                    | **macos** | 6–10 min           | 6           | **~480** |
| `release-web.yml` / `release-api.yml` | tags                                                | ubuntu    | ~1 min             | 7           | ~7       |

Run counts hit the API's 100-item page, so the two CI numbers are floors.

**Reading of the table:** `release-desktop` runs **six times a month** and is plausibly the
single largest line on the bill — the ×10 multiplier turns eight honest minutes into
eighty. The second cost is volume: four workflows on one PR.

## Why one PR fires four workflows

The three per-app CI workflows all list `packages/**` in their `paths`. Any change under
`packages/` — including a two-line addition to `packages/i18n/messages/en.json`, which is
most of this week's PRs — matches **all three**, and `ci.yml` has no path filter beyond
ignoring markdown and the docs site. So a copy change runs: lint + build + type-check,
desktop unit, desktop E2E (with an `apt-get install ffmpeg` and a Playwright browser
download each time), web tests, api tests.

There is also overlap inside that set: `ci.yml` runs `bun run test --filter='@kaipu/*'`
and `bun run check-types` across the monorepo while `ci-desktop.yml` runs `bun run test`
again for the desktop app.

## Cuts, ordered by minutes saved per unit of risk

1. **Narrow the `packages/**`trigger.** A change to`packages/i18n`cannot break the API.
Replace the blanket glob with the packages each app actually consumes, or gate the
per-app workflows behind a`dorny/paths-filter` job that reads the real dependency
   graph. _Biggest volume win, near-zero risk._
2. **Do not re-run desktop unit tests in two workflows.** Either `ci.yml` stops running
   `--filter='@kaipu/*'` tests that `ci-desktop` covers, or `ci-desktop`'s `unit` job goes
   and `ci.yml` owns all unit tests. Pick one owner per suite. _Saves ~2 min × every PR._
3. **Gate the desktop E2E.** It is the most expensive PR job (apt-get, Playwright deps,
   xvfb). Run it on pushes to `main` and on PRs labelled `e2e`, not on every PR.
   _Saves ~3 min × every PR; the risk is a regression caught at merge instead of in review._
4. **Release the desktop app less often, or build fewer targets.** Six macOS releases a
   month at ×10 is the top line. Options: release on demand rather than on every
   release-please merge; build only `arm64` for pre-releases and both arches for real
   ones; check whether the job's slowest step (notarisation waiting) can be cached.
5. **`release-please` on every push to `main`.** Cheap individually (<1 min × 88), but it
   is free to fold into a scheduled run or to keep — lowest priority.
6. **Cache checks.** Confirm the bun cache actually hits; a cold `bun install` in five
   jobs is five times the download.

## Not worth doing

- Moving to self-hosted runners for this size of project.
- Dropping type-checking or lint from CI. They are the cheap jobs.

## Immediate action

Raise the spending limit / fix the payment method in **Settings → Billing & plans**, then
land cut 1 and cut 3 — together they should roughly halve the per-PR cost without giving
up any signal on `main`.

## Reopen if

Desktop releases become more frequent (then cut 4 is the only lever left), or the org
moves to a plan with a different multiplier table.
