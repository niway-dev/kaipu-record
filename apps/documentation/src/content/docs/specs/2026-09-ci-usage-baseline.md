---
title: September 2026 CI usage baseline and evidence archive
description: Original billing exports, workflow-level cost attribution, and a repeatable before/after comparison protocol.
---

# September 2026 CI usage baseline

**Status: measured baseline, partial month; optimization not implemented.**
This supplements the [CI audit](../2026-09-23-ci-minutes-audit/) and
[ADR 0004](../../architecture/decisions/0004-local-first-release-verification/).
Kaipu code baseline is `8a7f996`. There is no post-change measurement yet.

## Original evidence

The owner requested that both supplied CSVs be preserved in the project. These are
byte-for-byte copies, renamed for stable links; original filenames and SHA-256 hashes
are in the manifest. They are small historical evidence files, not generated build output.

- [Detailed GitHub billing report](/audits/ci-usage/2026-09-baseline/github-detailed-usage.csv)
- [Cumulative repository chart export](/audits/ci-usage/2026-09-baseline/github-repository-chart.csv)
- [Provenance and checksums](/audits/ci-usage/2026-09-baseline/manifest.json)

Tracked location: `apps/documentation/public/audits/ci-usage/2026-09-baseline/`.
Original local location: `workspace-temp/csv-gh-actions/` in the original checkout.
The supplied screenshots are supporting context; image originals were not archived.

These files become downloadable wherever the documentation site is served. They
contain the owner's GitHub username, repository/workflow names and account-wide Actions
usage. The reviewed files contain no access tokens or payment credentials. Future
exports must be reviewed for additional account, identity or payment fields before
being published here; any redacted derivative must be labeled rather than presented
as an untouched original.

## Period and accounting

The detailed report has **190 data rows**, dated September 1–24, 2026. Runner usage
ends September 23; September 24 contains only storage. Despite the source filename
containing “monthly”, this is **month-to-date**, not a completed September statement.
The exact export timestamp and the allowance reset date are not supplied. The Pro upgrade
is dated **2026-09-19** (a $4.00 card payment, reference 1JJBHSYG). The quota was exhausted
again on **2026-09-23**: the two `release-please` runs for PR merges #155 and #156 (21:27
and 21:37 UTC) failed in 4 s with _"The job was not started because recent account payments
have failed or your spending limit needs to be increased"_. That block is why the desktop
release PR stopped updating, and why every workflow change in ADR 0004 was written without
a cloud run.

All source rows satisfy gross minus discount equals net. Sum with decimal arithmetic:

- Gross: **$19.495535192**, or **$19.50** rounded after aggregation.
- Discounts: **$19.495535192**.
- Net billed usage: **$0**.
- Kaipu gross: **$8.089535192**.
- invisible-assistant gross: **$9.246**.
- Other repositories combined: **$2.16**.

The chart's final row sums to $19.51 because it contains separately rounded repository
values. That differs by $0.014464808 from the detailed sum; the rounded chart should
not replace exact billing rows. The detailed report reconciles each repository to
its displayed two-decimal chart value.

Units stay separate by SKU. Storage is GB-hours, not minutes. macOS's $0.062/min
versus Linux's $0.006/min is a price ratio, not an asserted allowance multiplier.
The fractional 42.483870968 macOS minutes in Kaipu are preserved as exported;
do not round them again using the per-job UI rule. The report does not explain the
fractional billing quantity. Sum reported amounts instead of recomputing them from
rounded quantities. Subscription fees are outside this Actions report.

## Kaipu workflow attribution

All paths below are under `.github/workflows/`. Dollar amounts are gross USD.

- `ci-desktop.yml`: **449 Linux min, $2.694**.
- `ci.yml`: **207 Linux min, $1.242**.
- `ci-api.yml`: **85 Linux min, $0.510**.
- `ci-web.yml`: **61 Linux min, $0.366**.
- `release-please.yml`: **90 Linux min, $0.540**.
- `release-api.yml`: **6 Linux min, $0.036**.
- `release-web.yml`: **8 Linux min, $0.048**.
- `release-desktop.yml`: **42.483870968 macOS min, $2.634**.
- Unattributed-to-workflow storage: **58.137588963 GB-hours, $0.019535192**.

The four validation workflows account for **802 Linux minutes and $4.812**,
approximately **59.5%** of Kaipu's gross usage. Desktop validation and desktop
release packaging each contribute about one third of the total. All reported macOS
usage belongs to releases; reducing macOS PR checks cannot save anything in Kaipu
because none are represented here.

Moving validation to release time addresses the largest combined category, but
$4.812 is the historical cost exposed to that policy, **not a promised saving**:
candidate validation will still consume time. Release tooling and packaging also remain.

## invisible-assistant workflow attribution

- `ci-desktop.yml`: **61 Linux min ($0.366)**, **109 macOS min ($6.758)**,
  **13 Windows min ($0.130)**; combined **$7.254**.
- `pr-validation.yml`: **244 Linux min, $1.464**.
- Historical `customizer-test.yml`: **35 Linux min, $0.210**.
- `release-please.yml`: **53 Linux min, $0.318**.

`ci-desktop.yml` changed shape on **2026-09-19** (a Linux gate before the macOS E2E, and
draft PRs skipped), so most of the 109 macOS minutes predate that change. This
repository's month is therefore two configurations, and a later "after" cannot be
attributed to the local-first policy alone.

Desktop CI alone contributes approximately **78.5%** of this repository's gross
usage, and its macOS leg contributes **73.1%**. Every exported macOS minute is in
`ci-desktop.yml`; **no release workflow usage appears**. This conclusively separates
the expensive PR-validation policy here from Kaipu's release packaging costs.
The Windows and customizer entries reflect historical workflow behavior; do not
assume those configurations remain active or count their removal as a new saving.

## The two Kaipu spikes explained

**September 19: $2.735007730 gross.**

- macOS desktop release: **$1.828**, approximately **66.8%** of the day.
- Linux: **151 min, $0.906**. Within that, desktop validation is $0.384,
  universal CI $0.198, API validation $0.108 and web validation $0.066.
- Storage: **$0.003007730**.

**September 23: $1.837914232 gross.**

- Linux: **192 min, $1.152**, approximately **62.7%** of the day.
  Desktop validation is $0.546, universal CI $0.252, API validation $0.162,
  web validation $0.096 and release-please $0.096.
- macOS desktop release: **$0.682**.
- Storage: **$0.003914232**.

The first spike was primarily release packaging; the second was primarily Linux
iteration plus a release. The report aggregates by date/workflow/SKU, so it does
not separate individual runs, jobs, attempts, unit tests or E2E. Use the linked run
logs in the audit for those timings; do not attribute all `ci-desktop` minutes to tests.

## Local verification benchmark (2026-09-24)

Measured in a fresh worktree of `8a7f996` on the owner's machine (Apple Silicon, 12
threads) after `bun install`. "Cold" forces Turbo to ignore its cache; "warm" is the
second run. The desktop suite reported 181 files and 1,167 tests (two files more than
the CI log quoted in the audit, which was a different commit).

| Step                                  | Cold | Warm |
| ------------------------------------- | ---- | ---- |
| `oxlint`                              | <1 s | <1 s |
| `oxfmt --check .`                     | 2 s  | 2 s  |
| `turbo run check-types` (22 tasks)    | 8 s  | <1 s |
| `turbo run test` (9 tasks)            | 18 s | <1 s |
| `turbo run build --filter='@kaipu/*'` | 3 s  | <1 s |
| `bun run verify` (all of the above)   | 27 s | 3 s  |

The desktop Vitest run took 16.85 s here against 208 s on the GitHub runner for the same
suite. Vitest's per-phase totals (environment 105 s, setup 30 s) exceed wall-clock because
workers run in parallel; they are not additive. The jsdom/Node split remains unmeasured
and is not needed for the gate.

## Retention and before/after protocol

Keep the two original exports and this manifest as the immutable **before** snapshot.
Store each later export in a new dated directory under `public/audits/ci-usage/`, with
original filename, checksum, row count, coverage dates and partial/full-period status.
Never overwrite the baseline with a newer file using the same link. Small CSVs belong
in Git; logs, recordings, traces and installer binaries do not belong in this archive.

For the **after** comparison:

1. Record the implementation commit, activation timestamp and changed workflows/hooks
   separately for each repository. A proposal or merged doc is not activation.
2. Collect a comparable post-activation window after billing data has settled. Compare
   matching day counts, or matching days within a billing period. Do not compare this
   partial month directly to an entire future month.
3. Report gross, discounts and net separately, and quantity by SKU/workflow. Gross and
   quantities expose efficiency even when both periods have $0 net billing.
4. Record development activity: PR updates, releases/candidates, actual job starts,
   cancellations/retries and billing-blocked attempts. Obtain these from Actions/PR APIs;
   billing CSV rows are not run counts. A quota-blocked period can falsely look efficient.
5. Show both absolute consumption and consumption per PR update / release candidate.
   Record rate changes; compare physical minutes by OS as well as money.
6. Measure local verification cold/warm latency and release validation outcomes. Savings
   are not complete if routine hook bypass or untested publications replace cloud checks.

No “after” or savings percentage should be filled in until those observations exist.
The original month already includes earlier workflow changes; it is not a controlled
single-configuration experiment. Retained Actions history and activation dates are
needed to segment it when evaluating individual optimizations.

## Reproduce the aggregation

From the repository root, run:

```sh
python3 scripts/audit-actions-usage.py apps/documentation/public/audits/ci-usage/2026-09-baseline/github-detailed-usage.csv
```

The standard-library-only script reads UTF-8 with optional BOM, validates row monetary
identities, preserves decimal precision and emits JSON to stdout. It groups by
repository/workflow/SKU/unit/rate and includes daily repository gross amounts and the
source SHA-256. It writes no files and makes no network requests. Expected: 190 Actions
rows, $19.495535192 gross and discounts, $0 net, and the manifest's detailed-report hash.
It intentionally rejects the cumulative chart CSV as the wrong input schema.

## Remaining limits

The exports do not establish exactly how the Pro upgrade affected remaining quota,
the cause of every blocked run, test coverage quality, or post-change savings.
No new cloud builds were triggered for this analysis. The documentation-site build
and published download links have not been exercised; the source files and sums have.
