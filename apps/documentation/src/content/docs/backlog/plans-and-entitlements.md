---
title: Plans and entitlements — billing kept apart from auth
description: Status tracker for the plan/entitlements vertical (free/pro, watermark removal). The decision and the exact conditions now have their own pages — this tracks what's shipped and what's still pending validation.
---

# Plans and entitlements — billing kept apart from auth

> **Status: 🟢 Ready to validate (2026-09-06).** Full vertical shipped and test-first:
> domain rules + port, application use case, `subscription` table + repository, the
> `GET /api/v1/me/entitlements` route, and the desktop side (fetch, on-disk cache, `AuthStatus`,
> `useWatermark`). Verified end-to-end against the real API and database: no row → `free`;
> no token → 401; a manual `pro` row → `watermarkRemoval: true`. Schema applied with `db:push`.
> Pending: a real user flipping themselves to `pro` and confirming the watermark drops in an
> actual exported recording. Effort: Medium.

> **2026-09-27.** The watermark is no longer the feature this vertical gates: the free app
> ships without one ([decision](./free-tier-no-watermark)). The vertical stays as built; its
> next consumers are the cloud features. The "real user flips to pro and the watermark drops"
> validation below is therefore moot and replaced by the cloud-feature validation.

## Where the detail lives

What each plan includes (capacity, limits): **[Plans — Free and Pro](/features/plans)**.

This page tracks status only. The design and the operational detail were split out into
their permanent homes, following the project's own convention of keeping an ADR separate
from the operational document once a decision is made:

- **[ADR 0002 — Plan entitlements kept separate from auth](/architecture/decisions/0002-plan-entitlements-separate-from-auth)**
  — the decision, why identity and billing are two modules, and every alternative that was
  rejected (`additionalFields`, the `admin` plugin, `@better-auth/stripe`, a shared
  `profile` table) with the reasoning for each.
- **[Pro mode — entitlements conditions](/features/pro-mode)** — the reviewable reference:
  the exact grant/revoke rule, the offline behavior table, every file involved, how to grant
  or revoke a plan by hand, and the test commands.

## What's left before this leaves the backlog

- A real account flipping to `pro` (via the manual-grant SQL in the [pro mode
  doc](/features/pro-mode#how-to-grant-or-revoke-pro-by-hand)) and confirming an exported
  recording has no watermark. Once run, flip this page's status to ✅ and fold it into
  `features/pro-mode.mdx` directly (drop this row per the usual backlog → feature promotion).
- A payment provider is not chosen yet. See ADR 0002's "Alternatives considered" for how
  Stripe or Autumn plug into the existing `ISubscriptionRepository` port without changing
  the route or the desktop.

Related: [Desktop ↔ cloud sync gap](./desktop-cloud-sync-gap) lists "no plan entitlement" as
the same missing concept seen from the storage side; a storage quota would be a second key
in `features`.
