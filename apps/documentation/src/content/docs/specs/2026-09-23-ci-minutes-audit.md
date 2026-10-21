---
title: CI minutes audit — local verification and release gates
description: Evidence from Kaipu and invisible-assistant workflows and proposed local-first verification policy.
---

# CI minutes audit

**Status: audit complete; implementation in progress** as the stacked PRs listed in
[ADR 0004](../../architecture/decisions/0004-local-first-release-verification/) and the
[backlog tracker](../../backlog/ci-local-first-verification/). Reviewed 2026-09-23, updated
2026-09-24. Kaipu baseline: `8a7f996`; invisible-assistant local baseline: `6eb2ac9`.

**Detailed billing follow-up:** the owner subsequently supplied the workflow-level
report. See [September baseline and archived CSVs](../2026-09-ci-usage-baseline/)
for exact attribution, original downloadable evidence and the before/after protocol.
Earlier requests for the detailed export below are historical; that report is now
available. Upgrade/reset dates and a post-change measurement are still outstanding.

## Evidence and limits

The supplied billing screenshot shows gross repository usage of $8.09 for Kaipu and
$9.25 for invisible-assistant. It does not attribute that usage to runner OS, workflows,
or steps, and gross usage is not necessarily an invoice amount.
The audit inspected local workflow definitions, the 40 latest runs per repository,
and job/step timestamps for the two runs linked below. This is a sample, not a monthly
billing reconciliation; durations below are elapsed runner time, not billed minutes.

- **Kaipu PR validation:** Linux lint, formatting, package builds/tests, all-workspace
  types, web/API builds; separate path-filtered desktop unit/E2E and web/API test workflows.
  Local pre-push uses Lefthook for lint and formatting only. macOS runs on desktop release
  tags or manual dispatch.
- **invisible-assistant PR validation:** Linux universal validation plus desktop Linux
  test/build; macOS E2E after desktop Linux succeeds, on non-draft PRs. Local pre-push
  uses Husky to call `verify`: lint, formatting, types and tests. macOS also runs on
  release tags or manual dispatch.

Kaipu already migrated to Lefthook. Its previous spec deliberately left type checking
in CI; ADR 0004 explicitly supersedes that choice. Changing the hook
manager alone does not change coverage or cloud spending.

In invisible-assistant, universal `bun run test` overlaps the separate desktop test job.
Its root `verify` does not reproduce every CI build or E2E check despite the hook's
“identical to CI” comment. Its root install also invokes desktop postinstall tasks.

### Measured examples

- [Kaipu desktop v0.7.0 release](https://github.com/niway-dev/kaipu-record/actions/runs/35897309334):
  macOS job **10m00s**; install **27s**; native rebuild **11s**; combined build/sign/notarize
  **8m23s**. Step timestamps do not separate compilation, packaging, signing, and Apple's
  notarization wait. This release already runs only on a tag or manual request.
- [invisible-assistant Desktop CI](https://github.com/csdev19/invisible-assistant/actions/runs/35820454565):
  Linux job **2m16s**, including tests **78s** and build **20s**; macOS job **61s**, including
  install **12s**, build **8s**, E2E **13s**, and cache post-step **18s**.
  The concern here is repeated paid runner startup and execution, not a long compilation.
- Kaipu's recent run sample shows successive PR updates starting CI, Desktop Tests,
  API Tests, and Web Tests together. Cancellation reduces overlapping work but does
  not recover runner time already consumed.

Kaipu's repository rulesets API returned an empty list; the main protection endpoint
returned `404 Branch not protected`. Hook installation and execution were not tested.
Local hooks can reject a normal push, but users can bypass or omit them; they are not
a server-enforced guarantee about a commit. A dirty working tree can also differ from
the commit being pushed.

## Proposed implementation sequence

1. Establish a canonical Kaipu `verify` command: lint, read-only formatting, all-workspace
   type checks and unit/component tests. Resolve package build prerequisites via Turbo's
   task graph. Do not use `check`, which currently writes formatting. Measure cold and
   warm local runs before declaring the gate usable.
2. Make Lefthook pre-push call that command; keep pre-commit limited to staged formatting
   and lint. Verify normal pushes fail on each failing check and missing prerequisites.
   Verify hook installation in both fresh clones and linked worktrees. For invisible-assistant,
   retain its existing verification coverage while migrating Husky to Lefthook separately.
3. Move automated cloud validation from PR updates to an explicit pre-release boundary.
   Support manual candidate validation and reusable workflow calls from release workflows.
   Validate the exact release SHA, then allow packaging/publication only after success.
   Keep platform-specific E2E on the platform that exercises its assertions.
4. Gate web/API releases too before removing their PR validation: the local-first policy
   must not leave another component's publication dependent on checks that no longer run.
   Inspect those release pipelines and both repositories' effective required checks as
   part of implementation; that integration is not established by this audit.
5. Measure subsequent run counts, runner durations, and billing SKU totals over a comparable
   period. Do not claim an exact percentage saving from these two sampled executions.

## Review priorities

- Kaipu's release workflow currently has no full lint/test/E2E prerequisite job. Removing
  PR checks before adding the release gate would remove coverage rather than relocate it.
- Kaipu publishes the update feed and installers to R2 before creating a draft GitHub
  release. “Draft” does not mean unpublished for the updater. The gate must precede R2 writes.
- Keep local E2E/build commands available for desktop changes; do not make signing,
  notarization, or a full installer build mandatory on every push.
- Confirm what skipped platform/auth/export tests actually cover in a release candidate.
  A green run on a cheaper OS must not substitute for skipped macOS assertions.
- Separate release cadence from merge cadence. Moving macOS from PRs to every main push
  would still charge for frequent iteration and does not meet the requested policy.

## Reproduce the evidence

Use `gh run list --repo niway-dev/kaipu-record --limit 40` and the equivalent
command for `csdev19/invisible-assistant`. For detailed timings, use
`gh run view 35897309334 --repo niway-dev/kaipu-record --json jobs` and
`gh run view 35820454565 --repo csdev19/invisible-assistant --json jobs`.
Inspect root package scripts, `lefthook.yml` / `.husky/pre-push`, and `.github/workflows/`.
No application tests, local timing benchmark, or new cloud build was run for this audit.

## Follow-up: billing exports and screenshot investigation

### Obtain the authoritative billing evidence

In personal Settings → Billing & licensing → Usage / Metered usage, select the billing
period, then **Get usage report → Detailed usage report → Email me the report**.
The detailed report supports up to 31 days. The emailed download link expires after
24 hours. Request the full current period, including dates before the Pro upgrade,
and provide the upgrade date and billing reset date to distinguish the additional
allowance from the entire monthly allowance.

Keep `date`, `product`, `sku`, `quantity`, `unit_type`, `applied_cost_per_quantity`,
`gross_amount`, `discount_amount`, `net_amount`, `repository`, and `workflow_path`.
The detailed report attributes usage to workflows; summarized REST billing does not.
The user billing API request returned 404 with a missing `user` scope hint in this
session. No authentication scopes were changed. The web export is the preferred
missing artifact because the detailed report is not available through `/usage`.

For individual runs, **Run details → Usage** shows billable minutes rounded up per
job, before OS multipliers. Job timestamps and logs are already accessible through
`gh`. Full run logs can also be downloaded from the run UI. The screenshot's empty
Artifacts column does not mean there are no logs: this workflow uploads Playwright
artifacts only on failure. It does not currently retain structured unit-test timing
reports as downloadable workflow artifacts.

Sources:

- [Download usage reports](https://docs.github.com/en/billing/how-tos/products/view-productlicense-use#downloading-usage-reports)
- [Billing report fields](https://docs.github.com/en/billing/reference/billing-reports)
- [Billable job execution time](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-job-execution-time)

### Why the three PRs ran desktop tests

- **PR #155, feature:** the screenshot maps to run `35917895813` (workflow run number
  136). Desktop unit and E2E jobs consumed 239s + 117s = **356 runner-seconds**,
  while the UI shows about four minutes because they ran concurrently.
  The accompanying CI, API and Web jobs took 174s, 70s and 37s. Across those five jobs,
  this update consumed **637 seconds (10m37s)**, approximately **12 Linux billable
  minutes** when rounding each job separately. Confirm billed totals in Usage/export.
- **PR #151, chore:** run `35814059189` (number 120) took 235s unit + 129s E2E.
  It changed `apps/kaipu-record/package.json`, the local macOS build script, native
  rebuild/setup scripts and the release workflow. The desktop path filter matched;
  this was an executable dependency/build change despite the `chore` title.
- **PR #106, docs:** run `35058663144` (number 81) took 205s unit + 113s E2E.
  Its final diff includes nine documentation files **and** English/Spanish catalogs
  in `packages/i18n/messages/`. The broad `packages/**` filter therefore matched.
  This was not docs-only. Renderer test setup uses the real English catalog, so
  translations can affect component assertions. That does not establish a need to
  run the entire desktop E2E suite for every copy change.

Branch names and Conventional Commit prefixes do not control these workflow triggers.
PR path filtering evaluates the PR diff, not only the latest push's changed files.

### Where the 1,145 tests spend time

The exact #155 unit log reports **179 files / 1,145 tests passed** and **207.60s**
Vitest duration: transform 3.77s, setup 38.83s, import 10.93s, test execution 21.71s,
environment 111.76s. These are Vitest's phase measurements, not separately billable
steps; avoid assuming phase totals are wall-clock shares under arbitrary parallelism.
The runner's unit-test step took 208s, within a 239s job.

`apps/kaipu-record/vitest.config.ts` puts all renderer tests in jsdom with the shared
React Testing Library setup. Pure calculations such as `source-time.test.ts` are
included too: its nine tests took 7ms, yet use the same environment as UI components.
The shared setup imports DOM matchers and React cleanup, configures translations,
and stubs `window.electronAPI`. Simply switching an individual file to Node without
separating that setup would fail. This is a concrete optimization candidate, not a
measured speedup: benchmark a Node-only renderer-logic project separately before
changing the full suite, and preserve DOM-dependent component/hook tests in jsdom.

The #155 E2E log reports **10 passed, 3 skipped, 17.8s**, not 1,145 browser tests.
Its 117s job includes 21s dependency install, 31s ffmpeg install, 8s system-library
install and 40s for the combined build/type-check/Playwright step. Playwright uses
one worker intentionally because Electron launches share fixed fixture paths and
single-instance behavior. Configured retries are zero.

There is no evidence here that deleting tests is the right first optimization.
There is evidence for excessive execution frequency, expensive per-file environments,
and provisioning overhead. Passing counts alone do not prove coverage quality or
test necessity; neither coverage nor a redundancy review was performed.

### Frequency baseline

A paginated Actions API query for `created=2026-09-01..2026-09-24`, taken during this
audit, returned **546 Kaipu runs**: 163 CI, 124 Desktop Tests, 78 API Tests, 80 Web Tests,
88 release-please, 6 Release Desktop, 4 Release Web and 3 Release API. Of those,
445 were PR-triggered. Conclusions: 320 success, 53 failure, 146 skipped, 27 cancelled.
There were seven additional run attempts beyond the first attempts.

The same query returned **172 invisible-assistant runs**: 68 PR Validation, 62 Desktop
CI, 36 release-please, 5 historical Customizer Test and 1 PR Integration Tests.
136 were PR-triggered. Conclusions: 108 success, 59 failure, 1 skipped, 4 cancelled;
three additional attempts. No Release Desktop run was returned for this interval.

These **718 workflow records** are not 718 billed jobs: a workflow may spawn several
jobs, skip all jobs, or fail before starting a runner. Deleted/expired history and
billing reconciliation remain outside this count. Do not multiply all records by
the sampled duration. The detailed billing CSV is required to rank actual spend.

### Next evidence to retain

Use the billing CSV for daily repository/workflow/SKU totals, Jobs API for execution
and provisioning times, PR file lists for triggers, and existing logs for test timing.
For a future local benchmark, retain Vitest JSON or JUnit plus its phase summary,
and Playwright JSON plus skipped-test reasons. Profile Node-only versus jsdom logic
with identical tests and worker settings; do not launch paid Actions runs just to
collect information already available in retained logs.

## Supplied chart CSV and runner breakdown

The follow-up source is the local, uncommitted
`workspace-temp/csv-gh-actions/Billing Usage Repositories.csv` in the original checkout,
plus the owner's expanded billing screenshots. The CSV is a **cumulative gross-amount
chart export**, not the detailed billing report: 24 dated rows (September 1–24) and
six repository/group columns. Do not sum its rows. It contains no workflow, SKU,
quantity, discount or net-amount columns. The September 24 row repeats September 23;
it does not establish a complete additional day with no execution.

The final row totals **$19.51 gross** across the displayed repositories/groups.
Kaipu ($8.09) and invisible-assistant ($9.25) account for **$17.34, or 88.9%**.
The screenshots show **$0 billed** for these repositories and their expanded SKUs.

The expanded SKU evidence distinguishes the two optimization targets:

- **invisible-assistant:** Linux 393 min at $0.006/min ($2.36 displayed), macOS
  109 min at $0.062/min ($6.76), Windows 13 min at $0.010/min ($0.13).
  macOS contributes approximately **73%** of its gross amount.
- **Kaipu:** Linux 906 min at $0.006/min ($5.44 displayed), macOS 42.48 min at
  $0.062/min ($2.63), storage 58.14 GB-hours at $0.000336 ($0.02).
  Linux contributes approximately **67%**. Storage is not the material cost driver.

Displayed prices make one macOS minute about 10.33 Linux minutes **in monetary
value**. This price ratio is not proof of the included-minute quota conversion.
Do not add raw cross-OS minutes or divide dollars by the Linux rate to claim the
account's exact quota consumption. The detailed report and plan/reset information
are still needed to reconcile allowance use, discounts and the Pro upgrade.

Subtracting adjacent CSV rows identifies useful investigation windows:

- Kaipu, September 19: $6.11 − $3.38 = **+$2.73**.
- Kaipu, September 23: $8.09 − $6.25 = **+$1.84**.
- Together those increments are **$4.57, or 56.5%** of Kaipu's displayed month-to-date gross.
- invisible-assistant, September 10: **+$1.27**; September 4: **+$1.19**;
  September 22: **+$1.08**.
- From the September 21 row to September 23, the two desktop repositories together
  increased by **$3.50**. Their month-to-date total is not two days of fresh usage.

These are changes in the reported daily series, not yet attribution to execution
dates or individual workflows. Billing ingestion and chart rounding can affect the
comparison. Prioritize September 19 and 23 for Kaipu when the detailed report arrives,
then reconcile daily repository/workflow/SKU gross, discounts and net amounts against
the retained run history. No further cloud runs are needed for that reconciliation.

## Related

- [ADR 0004 — local-first verification with cloud release gates](../../architecture/decisions/0004-local-first-release-verification/)
- [Existing Kaipu hook contract](../2026-09-06-lefthook-migration-design/)
- [Reusable runner-cost guidance](https://github.com/csdev19/general-knowledge/blob/main/monorepos/ci-runner-cost.md)
- [Reusable PR-check guidance](https://github.com/csdev19/general-knowledge/blob/main/monorepos/pr-checks.md)
