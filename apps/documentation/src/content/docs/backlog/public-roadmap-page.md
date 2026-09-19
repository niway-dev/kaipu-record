---
title: Public roadmap page on kaipu.app
description: The /roadmap page that shows what Kaipu Record already ships and what is planned next, and how to keep it up to date.
---

# Public roadmap page

> **Status: 🟢 Ready to validate.** The page is on this branch and builds clean. It has not
> been reviewed in production or on a real device yet.

A public timeline at `https://kaipu.app/roadmap`, grouped by **state** rather than by date.
The goal is to show momentum — what already works today sits above what is planned — without
committing to delivery dates that age badly the moment a plan moves.

## Where it lives

| Piece           | Path                                                         |
| --------------- | ------------------------------------------------------------ |
| Route           | `apps/web-hono/src/routes/roadmap.tsx`                       |
| Timeline        | `apps/web-hono/src/components/roadmap/roadmap-timeline.tsx`  |
| Source of truth | `apps/web-hono/src/components/roadmap/roadmap-config.ts`     |
| Copy (en + es)  | `roadmap` namespace in `packages/i18n/messages/{en,es}.json` |
| Entry points    | `LandingNav`, `Footer`, `apps/web-hono/public/sitemap.xml`   |

The page reuses the landing shell (`LandingNav` + `Footer`) and the `--kaipu-*` design tokens,
so it follows the light/dark theme and the locale switcher like every other public page.

## How to update it

1. Edit `ROADMAP_ITEMS` in `roadmap-config.ts` — add an entry, or change an item's `status`
   between `shipped`, `inProgress` and `planned`.
2. Add `items.<id>.title` and `items.<id>.description` to **both** `en.json` and `es.json`.
3. Commit and deploy. There is no database and no admin screen; the roadmap is code.

Two guardrails make a half-finished edit fail loudly instead of shipping:

- `ROADMAP_ITEMS` is declared `as const`, so every id is a string literal. `useTranslations`
  rejects an id with no copy **at compile time** rather than rendering a raw key in production.
- The `@kaipu/i18n` parity test fails if a key exists in one locale and not the other, or if
  any value is empty.

A status group with no items is not rendered, so `In progress` stays hidden until something
is actually in flight.

## Deliberate non-goals

- **No dates or quarters.** Statuses stay true when work slips; quarters do not.
- **No database, no admin UI.** Editing a TypeScript array is cheaper than the CRUD that would
  replace it, at the rate this list actually changes.
- **No per-item progress bars or votes.** Neither is honest data today.

## What to validate in production

- The page renders in both themes and both locales (`/roadmap` with the locale switcher).
- The nav and footer links reach it, and the nav "Download" button still jumps to the landing
  download section from `/roadmap` (it was a bare `#download` anchor before this change, which
  did nothing off the landing page).
- The page is indexed: it is in `sitemap.xml` and is not marked `noindex`.
