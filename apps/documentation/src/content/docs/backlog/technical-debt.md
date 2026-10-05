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
