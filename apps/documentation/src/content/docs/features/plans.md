---
title: Plans — Free and Pro
description: "The canonical description of Kaipu's plans: who gets cloud, how much space each plan includes, the per-file limits, and where the single source of truth lives in code. Other docs link here instead of restating numbers."
---

# Plans — Free and Pro

This is the **canonical** page for what each plan includes. Other docs, specs and copy link
here instead of repeating the numbers. If a number on this page changes, it changes in the
plan table in code first (see [Single source of truth](#single-source-of-truth)) and the
tests that pin it.

All sizes are **decimal**: 1 MB = 1,000,000 bytes, 1 GB = 1,000,000,000 bytes — the units the
product shows and the server enforces.

## The plans

| Plan                                       | Who                                                     | Cloud capacity (total)      | Per video | Per screenshot |
| ------------------------------------------ | ------------------------------------------------------- | --------------------------- | --------- | -------------- |
| No account                                 | Anyone                                                  | — (no cloud; local only)    | —         | —              |
| Registered, email **not** verified         | Signed up, verification pending                         | — (no cloud uploads)        | —         | —              |
| **Free**                                   | Registered **and** email verified                       | **250 MB**                  | 1 GB      | 25 MB          |
| Free + approved beta expansion _(planned)_ | Free account whose expansion request the owner approved | 1 GB total (not 1 GB extra) | 1 GB      | 25 MB          |
| **Pro**                                    | An active `pro` subscription (today: manual grant)      | **15 GB**                   | 1 GB      | 25 MB          |

- **Recording, editing and exporting locally never need an account** and have no limits from
  this table.
- **Free = 250 MB is the sign-up incentive** (decision 2026-10-10, NIW2-232). It replaces the
  1 GB the server used to grant verified Free accounts.
- **Pro = 15 GB** comes from the accepted
  [cloud trial and approval spec](/specs/2026-09-15-cloud-trial-and-approval/), Decision 4,
  which replaced the historical 25 GB. There is no billing yet; an operator grants Pro by hand
  (see [Pro mode](/features/pro-mode/)).
- **The beta expansion to 1 GB is stated in the copy but not enforced yet.** The
  request/approval flow is a separate piece of work; until it ships, a Free account stays at
  250 MB.
- Capacity is **total occupied space** (recordings + screenshots + their thumbnails), not a
  monthly allowance. Reading and deleting never depend on it.
- A lapsed, canceled or `past_due` Pro subscription falls back to Free capacity; the plan
  name is still reported so the UI can explain it.

## When an account is over its capacity

An account can hold more than its plan allows — for example a Free account that uploaded
under the old 1 GB rule, or a Pro grant that lapsed. Then:

- **New uploads are refused** with a `quota-exceeded` error carrying the missing bytes. The
  reservation is checked atomically in the database
  (`used + reserved + new ≤ capacity`), so nothing is written.
- **Nothing is deleted.** Existing assets stay readable, downloadable and deletable.
- `GET /me/storage` reports the real `usedBytes` and `availableBytes: 0`; the desktop bar is
  clamped to full.

## Single source of truth

| What                                                                      | Where                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Plan table (`PLANS`, ids, display-name keys, capacity, per-file limits)   | `packages/domain/src/constants/plans.ts`                                                      |
| Per-file caps and byte formatting                                         | `packages/domain/src/constants/cloud-limits.ts`                                               |
| Plan → entitlements rule (`deriveEntitlements`)                           | `packages/domain/src/schemas/subscription.ts`                                                 |
| API (`GET /me/entitlements`, `GET /me/storage`)                           | `apps/server-hono/src/modules/me/me.router.ts`                                                |
| Copy values (`{freeCapacity}`, `{proCapacity}`, `{expansionCapacity}`, …) | `planCopyValues()` in `plans.ts`, passed to `t(...)` by the desktop and web                   |
| Desktop offline fallback (`FREE_ENTITLEMENTS`, a literal for the preload) | `apps/kaipu-record/src/shared/entitlements.ts`, pinned to `PLANS.free` by its test            |
| Legal text (Cloud terms, rendered verbatim)                               | `packages/i18n/messages/*.json` → `legal.cloud`, pinned to the plan table by `plan-copy.test` |

Tests that pin the numbers: `plans.test.ts` and `subscription.test.ts` (domain),
`entitlements.test.ts` (application), `me.router.test.ts` (server, Free verified = 250 MB),
`plan-copy.test.ts` (i18n), `entitlements.test.ts` (desktop shared).

## Related

- [Pro mode — entitlements conditions](/features/pro-mode/) — how a plan is granted, the
  offline model and the manual grant command.
- [ADR 0002](/architecture/decisions/0002-plan-entitlements-separate-from-auth/) — why plans
  live apart from auth.
- [Cloud trial and approval](/specs/2026-09-15-cloud-trial-and-approval/) — the access states
  and the expansion flow.
