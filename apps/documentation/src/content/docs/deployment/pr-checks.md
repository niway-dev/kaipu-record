---
title: PR checks — validation & E2E
description: The two GitHub Actions workflows that run on every PR into main (PR Validation and E2E Desktop), what each does, why they are deliberately separate, and the desktop E2E harness they gate.
---

# PR checks — validation & E2E

Two GitHub Actions workflows run on every pull request into `main`. They are **deliberately
separate** — this page explains what each does, why the split is intentional, and the E2E
harness behind the second one.

> These are PR-gate checks, not deploys. Releases are tag-driven — see
> [CI/CD pipelines](/deployment/ci-cd-pipelines).

## The two workflows

| Workflow          | File                                  | Runs     | Scope                            |
| ----------------- | ------------------------------------- | -------- | -------------------------------- |
| **PR Validation** | `.github/workflows/pr-validation.yml` | ~4 min   | Cheap, **monorepo-wide** gate    |
| **E2E Desktop**   | `.github/workflows/e2e-desktop.yml`   | ~1–2 min | Expensive, **desktop-only** gate |

### PR Validation (the broad, cheap gate)

Runs on `ubuntu-latest`: `bun install`, then **lint** (`oxlint`), **format check**
(`oxfmt --check .`), **build** of the `@kaipu/*` packages + web + api, **typecheck**, and the
**desktop unit suite** (`vitest`, ~600 tests). It validates the whole monorepo and does not
deploy. This is the check to keep fast and always-on.

### E2E Desktop (the narrow, expensive gate)

Runs the Playwright + Electron E2E suite for `kaipu-record` on `ubuntu-latest`. It needs a
heavier environment than PR Validation:

- **`ffmpeg`** — `ffprobe` validates the exported MP4's streams.
- **`playwright install-deps chromium`** — the system libraries Electron's Chromium links
  against (libnss3, libgbm, …). No browser is downloaded; the tests launch the app's own
  `electron` binary.
- **`xvfb`** — a virtual X display so the Electron window can open headless
  (`xvfb-run --auto-servernum bun run test:e2e`).
- **`--no-sandbox`** — added to the Electron launch args only under `CI`; the Chromium sandbox
  has no SUID helper on headless runners.

## Why two workflows and not one

This is the important part. The split is intentional and matches common industry practice.
The two are not "unit tests vs E2E" — they are **"cheap and universal" vs "expensive and
platform-specific"**, which is a natural seam.

1. **Different setup needs.** Only E2E needs `ffmpeg`, `xvfb`, and Chromium system libs.
   Keeping them apart keeps the always-on validation gate lean.
2. **Independent triggers.** E2E runs only when desktop code changes — it is `paths`-filtered
   to `apps/kaipu-record/**`, the workflow file, and `bun.lock` — so a docs typo or a web-only
   change never boots Electron + xvfb. This is only possible because it is its own workflow;
   folded into the universal gate, every change everywhere would pay the E2E cost. (For
   `pull_request`, GitHub evaluates the filter against the PR's whole diff, so a PR that touches
   the desktop still runs E2E on every push.)
3. **Clear, parallel signal.** They run concurrently and report as two checks. A flaky E2E
   run does not hide the lint/typecheck result, and vice versa.
4. **Independent required-status.** Branch protection is configured per check — you can make
   PR Validation required to merge while E2E stays non-required until it stabilizes (or the
   reverse). That needs two distinct checks.
5. **Independent evolution.** The E2E suite will grow (more flows, possibly a macOS job).
   Isolating it means changes there never risk the critical build/lint gate.

### The one cost, and its real fix

The only downside of separation is a duplicated `bun install` (each workflow checks out and
installs). **Merging does not fix this** — separate _jobs_ run on separate machines and do not
share a filesystem either, and collapsing into one _job_ loses the parallelism and the
per-workflow trigger. The right fix is **dependency caching** — both workflows cache bun's
global install cache (`~/.bun/install/cache`) via `actions/cache`, keyed on `bun.lock` — not
merging.

The design axis to keep straight:

- **Two workflows** (current) — most flexible: independent triggers, required-status, parallel.
- **One workflow, two jobs** — shared trigger, still parallel, but still no shared install and
  no easy per-job `paths` filter.
- **One workflow, one job** — shares install, but sequential and cannot path-filter a sub-step.

## The E2E harness (what E2E Desktop runs)

Playwright drives the **real production build** of `kaipu-record` against a **fully isolated
vault**. See the design [spec](/specs/2026-07-06-e2e-testing-harness-design) and
[plan](/plans/2026-07-06-e2e-testing-harness) for the full rationale.

- **Run locally:** `bun run test:e2e` from `apps/kaipu-record` (builds, then `playwright test`).
- **Isolation:** each run gets a throwaway `--user-data-dir` and a throwaway vault seeded with
  a committed `e2e/fixtures/sample.mp4`, pointed at via `preferences.json` — never the
  developer's real profile or `~/Videos/Kaipu Record`.
- **Helpers:** `e2e/helpers/launch.ts` (isolated launch + `openEditor`, which dismisses the
  onboarding overlay) and `e2e/helpers/ffprobe.ts` (output validation).

### What it guards (both proven by red-green)

- **Playback / seek** — asserts the media protocol answers a `Range` request with `206` +
  `Content-Range` (the seek-wedge bug returned `200`). This assertion **also** guards the
  export `corsEnabled` fix, because the cross-origin `fetch` it uses requires `corsEnabled`.
- **Export** — runs the real export, waits for navigation to the saved recording, and
  `ffprobe`-validates the output (h264 video + aac audio, aligned durations).

### Two platform gotchas worth remembering

- **A small fixture cannot reproduce the seek-wedge via `<video>`.** A clip small enough to
  commit (~77 KB) buffers whole on first load, so a real seek stays in-buffer and never issues
  the `bytes=<offset>-` request that wedged Chromium. That is why the guard asserts the
  protocol's `Range` response **directly** (deterministic) rather than watching the `<video>`.
- **The export test skips on headless Linux CI.** Chromium there has no working WebCodecs
  **H.264 encoder**, so the export throws at runtime ("No pudimos exportar el video").
  `VideoEncoder.isConfigSupported` _falsely_ reports support on Linux, so the test gates on the
  environment instead — `test.skip(process.platform === "linux" && process.env.CI, …)` — a
  **visible** skip, never a silent pass. The export runs in full on macOS/dev machines. CI does
  not lose the root-cause coverage: the `corsEnabled` and `Range` fixes are still guarded on
  Linux by the playback Range-fetch test.

## Follow-ups

**Done:** the `paths:` filter on E2E Desktop and bun dependency caching in both workflows.

**Still open:**

- **A `macos-latest` job** (per-PR if the minute budget allows, otherwise nightly or
  `paths`-gated) to run the export test with a real H.264 encoder — the honest way to get
  full export coverage in CI, since macOS is the production platform.

> **Gotcha — `paths` filters and _required_ checks.** A `paths`-filtered workflow that does not
> run reports **no status**, and GitHub treats a required-but-absent check as perpetually
> pending — which would **block merge** on any PR that doesn't touch the filtered paths. So a
> `paths`-filtered check must stay **non-required**, or you add an always-runs sentinel job
> (same check name) that trivially passes when the paths don't match. Today E2E Desktop is not a
> required check, so this is fine; keep it in mind before enabling branch protection on it.
