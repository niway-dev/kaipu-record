---
title: Public roadmap page on kaipu.app
description: The /roadmap page that shows what Kaipu Record already ships and what is planned next, and how to keep it up to date.
---

# Public roadmap page

> **Status: 🟢 Ready to validate.** Redesigned on 2026-10-18 with a state per platform
> (see [refresh log](#refresh-log)). The page builds clean; it has not been reviewed in
> production or on a real device yet.

A public roadmap at `https://kaipu.app/roadmap`: one row per feature, with a **macOS** and a
**Windows** state on each row, grouped by **state** rather than by date. The goal is to show
momentum — what already works today sits above what is planned — without committing to
delivery dates that age badly the moment a plan moves.

The layout comes from the Claude Design project 71546ef1, file `Kaipu Roadmap.dc.html`: a
summary card per platform, a sticky filter bar (platform + states), the grouped list, a
legend, and a Windows section. **Only the layout comes from the mockup.** Its states were
not true — it showed a downloadable Windows beta, Window capture as shipped, an invented
Continuity Camera row, and auto-zoom as in progress — so every state was checked against
the repo instead.

## Where it lives

| Piece           | Path                                                         |
| --------------- | ------------------------------------------------------------ |
| Route           | `apps/web-hono/src/routes/roadmap.tsx`                       |
| Page sections   | `apps/web-hono/src/components/roadmap/roadmap-page.tsx`      |
| Source of truth | `apps/web-hono/src/components/roadmap/roadmap-config.ts`     |
| Copy (en + es)  | `roadmap` namespace in `packages/i18n/messages/{en,es}.json` |
| Entry points    | `TopNav`, `Footer`, `apps/web-hono/public/sitemap.xml`       |

The page renders inside `HomeShell` with the chapter rail off (`chapterNav={false}`), so it
shares the home's top bar, `--kl-*` tokens, theme cookie and locale switcher. Its route
declares `staticData: { shell: "marketing" }`, which tells the root document not to add the
app `Header` and legal footer on top — see [Public page shell](./public-page-shell).

## What "shipped" means

**Shipped means "in the build you can download today".** There is no downloadable Windows
build yet (no Windows job in `release-desktop.yml`, no Windows URL in `lib/download.ts`), so
no Windows cell says shipped: what the Windows build already does is `inProgress`, and the
Windows section says "coming soon" with the Mac download as its button. A test in
`roadmap-config.test.ts` pins this.

When the first Windows installer is on the download feed, the same PR flips the Windows
cells that QA confirmed, puts the "Download for Windows (beta)" button back in
`WindowsComingSoon`, and updates that test — as the
[Windows release design](/specs/2026-10-15-windows-release-design/) (decision 9) asks.

With **Both** selected, a row is grouped under its most advanced platform, so the Shipped
group reads "available somewhere today" and the two cells say where.

## How to update it

1. Edit `ROADMAP_ITEMS` in `roadmap-config.ts` — add an entry, or change its `mac` / `win`
   state between `shipped`, `inProgress` and `planned`. `note: true` adds a caveat line.
2. Add `items.<id>.title` and `items.<id>.description` (and `items.<id>.note` when the row
   has one) to **both** `en.json` and `es.json`.
3. A **planned** row needs a design doc under `backlog/` before anyone builds it, and a row
   in the table below. A sentence on a public page is a promise; the doc is where the
   promise gets a scope, non-goals and a reopen condition.
4. Commit and deploy. There is no database and no admin screen; the roadmap is code.

When something ships, move it to `shipped` **and re-read its copy**: a planned description
says what we hope to build, a shipped one says what the download does today. The
`saveEveryScreenshot` row, for example, was planned as "opt-in" and shipped with automatic
save as the default.

### Shipped rows and their docs

Shipped rows added on 2026-10-14 point at the doc that describes what the download does:

| Id              | Doc                                                             |
| --------------- | --------------------------------------------------------------- |
| `exportPresets` | [Export presets per destination](./export-presets)              |
| `captureTags`   | [Tags as entities](/specs/2026-10-13-tags-as-entities-design/)  |
| `screenshotPdf` | [Screenshot export formats](./export-formats)                   |
| `captureTitle`  | [Editor — name the capture before saving](./editor-title-input) |

### Planned rows and their design docs

| Id                 | Design doc                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Windows column     | [Windows beta — recording first, screenshots later](./windows-beta) — replaces the `windowsBeta` row |
| `signedInstaller`  | Windows only: [Windows release design](/specs/2026-10-15-windows-release-design/), decision 4        |
| `cloudUpload`      | [Cloud recordings upload](./cloud-recordings-upload) · [desktop sync gap](./desktop-cloud-sync-gap)  |
| `photoZoom`        | [Zoom and pan in the image viewer](./image-viewer-zoom)                                              |
| `watermarkUpgrade` | None yet — reworded on 2026-10-07 (below); needs a doc before building                               |
| `brandIdentity`    | [Brand and website rollout](/plans/2026-09-27-brand-and-website-rollout/)                            |

Two guardrails make a half-finished edit fail loudly instead of shipping:

- `ROADMAP_ITEMS` is declared `as const`, so every id is a string literal. `useTranslations`
  rejects an id with no copy **at compile time** rather than rendering a raw key in production.
- The `@kaipu/i18n` parity test fails if a key exists in one locale and not the other, or if
  any value is empty.

A state group with no rows (after the filters) is not rendered.

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

### 2026-10-14

Source of truth checked against `main` (merged PRs since 2026-10-07 and the backlog index):

- **Added to shipped:** `exportPresets` (NIW2-218: destination presets, Balanced and Maximum
  quality, Share button reusing existing exports, redesigned share sheet, background exports
  with progress and Ready to share cards; #286 and the stacked PRs under it), `captureTags`
  (recording tags #245 and tags as colored entities #282), `screenshotPdf` (#259) and
  `captureTitle` (#256).
- **Retired planned rows:** `renameOnSave` became `captureTitle` (shipped, #256) and
  `imageTags` became `captureTags` (shipped): tags live in the vault sidecar, so screenshots
  carry them like recordings. The [tags on images](./image-tags) design doc is superseded by
  that work.
- **Deliberately not listed:** GIF export (#266, on hold behind a flag), export quality
  tiers and the 24 fps encoder (open PRs), cloud upload and the account page (open PRs).

### 2026-10-18 — per-platform redesign

Implemented the `Kaipu Roadmap.dc.html` layout and moved the page from `PublicShell` to
`HomeShell`. Every state was checked against `main` (at #312), not taken from the mockup:

- **A state per platform.** macOS keeps the states the list already had. Every Windows cell
  is `inProgress` or `planned` — see [What "shipped" means](#what-shipped-means).
- **Added rows:** `systemAudio`, `trayPanel`, `frameCapture` (shipped on macOS, #306),
  `blurAndBackground` (redaction, #14), `videoMute` (video editor v2), `windowCapture`
  (`inProgress` on both: built in #309, switched off behind `WINDOW_MODE_ENABLED` in #311)
  and `signedInstaller` (macOS is signed and notarized; Windows ships unsigned first).
- **Retired `windowsBeta`:** the Windows column, its summary card and the Windows section
  now carry it.
- **Left out of the mockup:** "Touch Bar and Continuity Camera" (not in the code), the
  "Version 0.13" label (the app is 0.12.0, and a hardcoded version goes stale), the
  installer size, and the "Help → Send feedback" pointer (not verified).

## What to validate in production

- The page renders in both themes and both locales (`/roadmap` with the locale switcher).
- The platform filter and the state chips regroup the list, and the "N of M features"
  count follows them.
- On a phone each row stacks its two cells, each labelled macOS / Windows.
- The top bar marks Roadmap as current, and Home and Features navigate away from it.
- The page is indexed: it is in `sitemap.xml` and is not marked `noindex`.
