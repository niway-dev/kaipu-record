---
title: CI — local-first verification and release gates
description: Status tracker for moving lint/types/tests to a Lefthook pre-push and GitHub Actions to release-time gates, after the account's Actions quota blocked releases in September 2026.
---

# CI — local-first verification and release gates

> **Status: 🟡 In progress (2026-09-24).** Decision recorded in
> [ADR 0004](/architecture/decisions/0004-local-first-release-verification/). Shipped as
> stacked PRs; the account was quota-blocked while they were written, so the release gate
> has not had a cloud run yet. Effort: Low per PR, spread over four PRs.

## Why it is on the map

- September's per-PR-update workflows consumed 802 Linux minutes; `release-please` added
  90 by running on docs merges. The account hit its quota on 2026-09-19 and again on
  2026-09-23, when the desktop release PR stopped updating.
- The local equivalent takes 27 s cold and 3 s warm, measured in a clean worktree.
- The release workflows published to R2 with no lint, type or test job in front of them.

## Stack

| PR                                                                | Scope                                                         | State   |
| ----------------------------------------------------------------- | ------------------------------------------------------------- | ------- |
| [#160](https://github.com/csdev19/kaipu-record-monorepo/pull/160) | `release-please.yml` path filter                              | 🟡 open |
| [#161](https://github.com/csdev19/kaipu-record-monorepo/pull/161) | `verify` script, Lefthook pre-push, ADR 0004, audit docs      | 🟡 open |
| [#162](https://github.com/csdev19/kaipu-record-monorepo/pull/162) | `verify` job in `release-*.yml`, E2E on the macOS release job | 🟡 open |
| retire PR checks                                                  | `ci*.yml` keep only `workflow_dispatch`                       | 🟡 open |

Merge in that order. The last one is only safe after the release gate has passed on a
real release.

## Where the detail lives

- **Decision:** [ADR 0004](/architecture/decisions/0004-local-first-release-verification/).
- **Evidence and run history:** [CI minutes audit](/specs/2026-09-23-ci-minutes-audit/).
- **Billing exports, benchmark and before/after protocol:**
  [September baseline](/specs/2026-09-ci-usage-baseline/).
- **Hook contract:** [Lefthook migration spec](/specs/2026-09-06-lefthook-migration-design/),
  whose pre-push scope this work widens.

## To validate

- [ ] Owner sets a non-zero Actions spending limit and records the quota reset date.
- [ ] A push with a failing test is rejected by the pre-push; `LEFTHOOK=0` bypasses it.
- [ ] The next desktop release runs `verify` and E2E before signing, and blocks R2 on failure.
- [ ] A docs-only merge to `main` does not start `release-please`.
- [ ] Export the next billing report into `public/audits/ci-usage/<date>/` and fill the "after".
