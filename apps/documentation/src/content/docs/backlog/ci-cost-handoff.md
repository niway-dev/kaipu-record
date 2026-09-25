---
title: "CI cost work — handoff (2026-09-24)"
description: "Resume point for the Actions cost work: what shipped, the one manual step left, the duplication to clean up, and the measurement that turns the whole thing from a bet into a number."
---

# CI cost work — handoff

> **Status: 🟡 In progress** (2026-09-24, end of session). A resume point, not a design
> doc. Everything below is merged to `main` unless it says otherwise. Delete this page
> once the October measurement is in and the follow-ups are closed.

## The one thing blocking everything

**GitHub Actions is refusing to start jobs.** Every check fails in 2–6 seconds with zero
steps executed:

> The job was not started because recent account payments have failed or your spending
> limit needs to be increased.

Fix it in **Settings → Billing & plans** on the account. Until then nothing merged below
can run, so none of it is verified in the cloud — and every PR looks broken when it is
not. A 2-second failure with no steps is the billing block, not your branch.

## What shipped

Two axes. Frequency was the big one; duration was the follow-up.

| PR                                                                | What it does                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#159](https://github.com/csdev19/kaipu-record-monorepo/pull/159) | Fixes the "Edited · not exported" badge, which was wrong on every export — it compared a session's `savedAt` against an export's `createdAt`, two different clocks. Now a stamp |
| [#160](https://github.com/csdev19/kaipu-record-monorepo/pull/160) | `release-please` runs only when a releasable path changes (was: every push to `main`, ~88 runs in September)                                                                    |
| [#161](https://github.com/csdev19/kaipu-record-monorepo/pull/161) | **Local `verify` gate on pre-push** (lefthook) + **ADR 0004** + the September billing baseline in `public/audits/ci-usage/2026-09-baseline/`                                    |
| [#162](https://github.com/csdev19/kaipu-record-monorepo/pull/162) | Every release workflow gates its build/deploy job behind `needs: verify`                                                                                                        |
| [#163](https://github.com/csdev19/kaipu-record-monorepo/pull/163) | Retires the `pull_request` triggers from the four validation workflows — **this is the 802 minutes**                                                                            |
| [#164](https://github.com/csdev19/kaipu-record-monorepo/pull/164) | Verifies the release candidate before the tag exists                                                                                                                            |
| [#166](https://github.com/csdev19/kaipu-record-monorepo/pull/166) | Caches turbo outputs in the nine jobs that run `check-types` or `build`                                                                                                         |
| [#167](https://github.com/csdev19/kaipu-record-monorepo/pull/167) | Deletes a PR's caches when it closes; stops the per-SHA turbo key minting one per push                                                                                          |
| [#168](https://github.com/csdev19/kaipu-record-monorepo/pull/168) | The **`verify` label** is both the trigger and the gate for the candidate verify, plus the always-running `Release candidate verified` job that reports the required check      |

### The numbers

- September baseline: **802 Linux minutes** on per-PR-update validation (measured, CSV in
  the audit spec, not estimated).
- #163 takes that to zero.
- The candidate verify then became the new leak: 6m30 per merge to `main`. #168's label
  turns that into one run per release.
- Cache: **8,745 MB → 578 MB** of the 10 GB ceiling. 43 entries from 21 closed PRs,
  deleted by hand; #167 stops them accumulating again.

### The correction worth remembering

The first audit measured **whole workflows** and concluded the tests were expensive. Opened
at step level, one job was: type-check 1m05 (**38 %**), builds 55s (32 %), **tests 8s
(5 %)**. Two of the proposed cuts targeted the eight seconds. Measure inside the job before
ranking cuts.

## The one manual step left

`main` has **no branch protection**, so the merge button is green on every PR regardless
of checks. To make the `verify` label an actual precondition:

> Settings → Rules → Rulesets → **New branch ruleset**
> · Enforcement: **Active** · Bypass list: **empty** (the escape hatch is setting
> Enforcement back to Disabled)
> · Target: **Include default branch**
> · Rules: **Require status checks to pass** → add **`Release candidate verified`**

Nothing else. In particular not "Require a pull request before merging" — that blocks
direct pushes to `main`, which is not the goal here.

**Do this after Billing is fixed**, or every release PR is blocked waiting for a check
that cannot run.

## Follow-ups, in order

1. **Fix Billing.** Everything else waits on it.
2. **Measure October against the September baseline** in
   `public/audits/ci-usage/2026-09-baseline/`. Export the new CSV and compare. This is what
   turns the work from a bet into a number, and it is the only way to know whether the
   remaining cost is frequency or duration.
3. **Clean up a docs duplication I created.** `backlog/ci-minutes-audit.md` (my estimates,
   from #158) and `specs/2026-09-23-ci-minutes-audit.md` (the measured one with the CSV,
   from #161) cover the same audit. The backlog one should become a pointer to the spec.
4. **#165** (`release desktop 0.8.0`) is mergeable and waiting.
5. **#130, #112, #86** are conflicting and belong to another workstream (Infisical →
   varlock, and a single-instance fix). Unrelated to this work.

## Things that surprised us, worth not re-learning

- **Deleting the branch on merge does not delete the PR's caches.** They live on
  `refs/pull/<n>/merge`, which outlives the branch. The 7-day eviction is real, but 21
  merges in ten days outrun it.
- **Cache entries are immutable**, so a key containing `github.sha` mints a new entry on
  every push — times every caching job.
- **The tag is the deploy.** `release-web` and `release-api` run `wrangler deploy` on the
  tag; `release-desktop` writes the update feed to R2 at step 178, which is what installed
  apps read. The `draft: true` GitHub Release is cosmetic — users have the update before
  you publish the draft.
- **A required check that never reports blocks merge forever.** That is why the expensive
  `verify` job cannot be the required one and a cheap always-running gate reports for it.

The reusable half of all of this lives in the hub, not here:
[ci-runner-cost](https://github.com/csdev19/general-knowledge/blob/main/monorepos/ci-runner-cost.md) ·
[actions-cache-lifecycle](https://github.com/csdev19/general-knowledge/blob/main/monorepos/actions-cache-lifecycle.md) ·
[pr-checks](https://github.com/csdev19/general-knowledge/blob/main/monorepos/pr-checks.md) ·
[release-gated-verification](https://github.com/csdev19/general-knowledge/blob/main/monorepos/release-gated-verification.md).

## Resuming on another machine

```bash
git fetch --prune && git checkout main && git pull
bun install && bun run rebuild:native     # no postinstall; the rebuild is explicit
bun run setup && infisical login          # secrets are per machine
```

The pre-push hook now runs `bun run verify` (~28 s warm). If a push seems to hang, that is
it working. `LEFTHOOK=0 git push` bypasses it.
