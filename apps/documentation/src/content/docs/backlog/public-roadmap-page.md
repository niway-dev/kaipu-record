---
title: Public roadmap page on kaipu.app
description: The /roadmap page that shows what Kaipu Record already ships and what is planned next, and how to keep it up to date.
---

# Public roadmap page

> **Status: 🟢 Ready to validate.** The page builds clean and its content was refreshed on
> 2026-10-07 (see [refresh log](#refresh-log)). It has not been reviewed in production or on
> a real device yet.

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

The page renders inside `PublicShell` (`LandingNav` + `Footer` + the landing theme) and uses the
`--kaipu-*` design tokens, so it follows light/dark and the locale switcher like every other
public page. Its route declares `staticData: { shell: "marketing" }`, which is what tells the
root document not to add the app `Header` and legal footer on top — see
[Public page shell](./public-page-shell).

## How to update it

1. Edit `ROADMAP_ITEMS` in `roadmap-config.ts` — add an entry, or change an item's `status`
   between `shipped`, `inProgress` and `planned`.
2. Add `items.<id>.title` and `items.<id>.description` to **both** `en.json` and `es.json`.
3. A **planned** row needs a design doc under `backlog/` before anyone builds it, and a row
   in the table below. A sentence on a public page is a promise; the doc is where the
   promise gets a scope, non-goals and a reopen condition.
4. Commit and deploy. There is no database and no admin screen; the roadmap is code.

When something ships, move it to `shipped` **and re-read its copy**: a planned description
says what we hope to build, a shipped one says what the download does today. The
`saveEveryScreenshot` row, for example, was planned as "opt-in" and shipped with automatic
save as the default.

### Planned rows and their design docs

| Id                 | Design doc                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `windowsBeta`      | [Windows beta — recording first, screenshots later](./windows-beta)                                 |
| `cloudUpload`      | [Cloud recordings upload](./cloud-recordings-upload) · [desktop sync gap](./desktop-cloud-sync-gap) |
| `photoZoom`        | [Zoom and pan in the image viewer](./image-viewer-zoom)                                             |
| `imageTags`        | [Tags on images](./image-tags)                                                                      |
| `watermarkUpgrade` | None yet — reworded on 2026-10-07 (below); needs a doc before building                              |
| `renameOnSave`     | [Editor — name the capture before saving](./editor-title-input)                                     |
| `brandIdentity`    | [Brand and website rollout](/plans/2026-09-27-brand-and-website-rollout/)                           |

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

## Refresh log

### 2026-10-07

Source of truth checked against `main` (backlog index, feature docs, and the desktop code):

- **Moved to shipped:** `videoZoom` (video editor v2's automatic cursor-following zoom, blur
  and cover, merged in #132–#141) and `saveEveryScreenshot` (Settings → Screenshots, #155).
  Both descriptions were rewritten to describe what shipped rather than what was hoped for.
- **Reworded `watermark` (shipped):** the free tier
  [no longer burns a watermark](./free-tier-no-watermark); the mark survives as an opt-in
  "Made with Kaipu" badge, off by default. The old copy ("stamp your exports with a
  watermark") described a feature we had removed.
- **Reworded `watermarkUpgrade` (planned):** it used to promise "a better watermark", which
  after the decision above reads as "we will improve the thing we took away". It now reads
  as **your own watermark**: the user's logo, with position, size and opacity controls,
  explicitly separate from Kaipu's optional badge. Whether that feature is still wanted is
  the owner's call; it stays on the list until a doc says otherwise.
- **Added `windowsBeta` (planned, first in the group):** the
  [recording-only Windows beta](./windows-beta) is the P0 in
  [product growth](./product-growth) and was missing entirely. The copy states the
  screenshot gap on purpose, which is the checklist item in that doc.
- **Design docs written** for the two planned rows that had none:
  [tags on images](./image-tags) and [zoom and pan in the image viewer](./image-viewer-zoom).

## What to validate in production

- The page renders in both themes and both locales (`/roadmap` with the locale switcher).
- The nav and footer links reach it, and the nav "Download" button still jumps to the landing
  download section from `/roadmap` (it was a bare `#download` anchor before this change, which
  did nothing off the landing page).
- The page is indexed: it is in `sitemap.xml` and is not marked `noindex`.
