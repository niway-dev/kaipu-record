---
title: "Technical debt: the open IOUs"
description: Debts left deliberately during the StyleX migration and earlier work — each with the evidence that found it, what it costs today, and the condition that closes it.
---

# Technical debt: the open IOUs

**Status: 🔵 Open ledger** (started 2026-10-03). Every entry here was a conscious
choice to leave something undone, not an oversight discovered later. Each says
what it costs **now**, because a debt whose cost is zero is not a debt — it is a
preference, and preferences do not belong on this page.

Close an entry by deleting it and noting the change where the fix lands.

## The token layer

### The `transition` token cannot be used by StyleX

`base.ts` defines `transition: "150ms ease"` and `transition-slow: "250ms ease"`
— CSS **shorthands**. No longhand accepts them, so every migrated component
splits them by hand into `transitionDuration` and `transitionTimingFunction`
with the literal values repeated.

_Cost today:_ nine components now carry `"150ms"` and `"ease"` inline. Changing
the app's motion speed means editing nine files instead of one token.

_Closes when:_ the token layer exposes duration and easing separately. The CSS
flavors can keep emitting the shorthand for their existing `var()` consumers.

## Styling migration

### Select is the last component on CSS Modules

Not for lack of trying, and the reason generalises:
`apps/kaipu-record/src/renderer/src/ui/select.tsx` carries the long version.
Radix publishes state through data attributes (`[data-state="open"]`,
`[data-highlighted]`, `[data-disabled]`), the stylesheet reacts to them through
a descendant selector, and it consumes Radix's injected
`--radix-select-trigger-width`. StyleX has no attribute selectors and no
descendant selectors.

_Cost today:_ none visible. One component on the old system, fully working.

_Closes when:_ stage 4 settles which headless library both surfaces share — the
desktop uses Radix only here, the web runs `@base-ui/react` — and that rebuild
lifts the open/highlight state into React.

### The two surfaces hold different majors of the same libraries

`lucide-react` is `^1.18.0` on the desktop and `^0.525.0` on the web.

_Cost today:_ a shared component cannot import an icon; `SearchInput` takes one
as a prop. Workable, and arguably better, but it is a constraint nobody chose.

_Closes when:_ the versions converge, or never — the prop is a reasonable
permanent answer.

## Infrastructure

### Cloudflare Access was disabled for a measurement and never confirmed back on

The web vitals runs need Access off on the worker's preview URLs, because
Lighthouse is an unauthenticated client and otherwise measures the login page.
It was turned off for the measurement on 2026-10-01 and again on 2026-10-02.
**Neither re-enable was confirmed.**

_Cost today:_ unknown, and that is the problem — if it is still off, the preview
URLs are open to anyone holding one.

_Closes when:_ someone checks the Cloudflare dashboard. This is the one entry
here that cannot be checked from the repository.

### A git worktree lives inside the repository

`.claude/worktrees/launch-video` is a checkout of `feat/launch-video`. It is
gitignored and excluded from oxfmt and oxlint now, but it was previously
doubling the formatter's file count and failing the push gate on files committed
to another branch.

_Cost today:_ none, now that the tooling ignores it.

_Closes when:_ that branch ships and the worktree is removed, or never — the
ignores make it harmless.

## Database schema

Left out of the migration work ([ADR 0011](/architecture/decisions/0011-committed-migrations-instead-of-push/))
on purpose: each needs a data migration against production, which a baseline-and-integrity
change should not carry.

### Timestamps are `timestamp without time zone`

Every `timestamp(...)` column omits `withTimezone`. Values are written from Workers in UTC, so
nothing is wrong today.

_Cost today:_ none until a second writer in another time zone, or a query comparing against
`now()` in a session with a non-UTC zone, exists. Then the error is silent.

_Closes when:_ a migration converts the columns to `timestamptz` (`USING col AT TIME ZONE 'UTC'`)
with the schema and the mappers updated together.

### Status columns are free text with no CHECK constraint

`cloud_revision.status`, `subscription.plan`, `subscription.status` and `subscription.provider`
are `text`; only the domain enums constrain them. A bad value written by a script or a future
code path is accepted by Postgres.

_Cost today:_ a hand-run SQL statement can store a status the code does not handle.

_Closes when:_ production is checked for out-of-enum values, then CHECK constraints (or Postgres
enums) are added in a migration.

### `derived_from_asset_id` has no foreign key

The asset primary key is `(user_id, asset_id)`, so a reference must be composite. A composite
`ON DELETE SET NULL` would also null the `NOT NULL` `user_id`, and Drizzle cannot emit the
column-list form (`SET NULL (derived_from_asset_id)`, Postgres 15+).

_Cost today:_ a derived asset can point at an asset that never existed. Nothing reads it for
access control.

_Closes when:_ Drizzle supports the column-list `SET NULL`, or the reference moves to a
dedicated single-column surrogate key.

### `cloud_asset.current_revision_id` does not check the revision's owner

The foreign key targets `cloud_revision.revision_id` alone, so it does not prove the revision
belongs to the same user and asset. The application sets it only from the user's own confirm.

_Closes when:_ `cloud_revision` gains a unique `(user_id, asset_id, revision_id)` and the
reference becomes composite.
