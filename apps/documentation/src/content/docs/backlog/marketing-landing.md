---
title: "Marketing landing — the four-moments home, and the shared logo system"
description: "The home page rebuilt from the owner's design: its own token layer scoped to the landing, product mockups rebuilt in HTML, self-hosted fonts, and a viewport ladder keyed on height. Also @kaipu/brand, the logo system the web and the desktop app now share."
---

# Marketing landing — the four-moments home

> **Status: 🟡 In progress** — branch `feat/marketing-landing`, no PR yet.
> The page is complete (hero, moments intro, chapters 01–04 with their mockups,
> "Your files", closing CTA, footer) and `bun run verify` passes. What is left is
> in [Open](#open) below.
>
> Supersedes [Landing redesign — feature showcase with looping demos](./landing-redesign):
> that page's components were deleted on this branch.

## What it is

The home page rebuilt from the owner's design, as four "moments" a reader scrolls
through — record, capture, edit, find — each with a mockup of the app doing that
thing, plus a hero, a "Your files" section and a closing CTA. A fixed top bar and
a chapter rail track position.

Structure lives in `apps/web-hono/src/components/home/`, composed by
`routes/index.tsx`; the style layer is `apps/web-hono/src/styles/landing*.css`.

## Decisions

Settled. Each is here because a later reader will ask "why this and not that".

### The landing owns `--kl-*` tokens, scoped to `[data-kl]`, in `@layer kaipu-landing`

The app shares `PublicShell` with roadmap, legal and the authenticated routes, so
a landing tweak that redefined a `--kaipu-*` token would leak into all of them.
Nothing in `landing*.css` applies without the `data-kl` attribute the shell puts
on its root, which makes that leak impossible rather than merely unlikely.

### Flat, single-purpose custom properties — no nesting, no descendant selectors

They are meant to become StyleX `defineVars` ([stylex-migration](./stylex-migration))
with nothing to untangle first. This is also why the landing uses plain CSS and
CSS Modules rather than Tailwind utilities.

### Product mockups are rebuilt in HTML, never screenshots

Sharp at any density, translatable, and they cannot silently go stale. They
mirror the real renderer's structure but share no code with it: importing the
app's components would let an app refactor break marketing.

### Fonts are self-hosted from `node_modules`

Geist, Geist Mono, Instrument Serif italic and Caveat, via Fontsource. The page's
own pitch is that nothing leaves your machine; asking a CDN for a font on every
visit contradicts it, and it is one more origin that can be slow or down.

### Dark only, for now

The light token values are written and kept in sync with the design system, but
nothing sets `data-kl-theme="light"` yet. The theme and locale switches in the
top bar are inert placeholders with real labels — the owner is building both.

### `@kaipu/brand` exists because there was no shared component library

Web and desktop shared only `@kaipu/i18n` and `@kaipu/tokens`, and dragging
`@kaipu/web-ui` into Electron for one mark was the wrong trade. It follows the
`@kaipu/i18n` shape: source export, React peer, no build step.

Callers pick a **purpose, not an artwork**:

| Use                     | Artwork                             | Where                                 |
| ----------------------- | ----------------------------------- | ------------------------------------- |
| `app`                   | fox with frame corners + record dot | Dock, ⌘-Tab, DMG, onboarding welcome  |
| `product`               | plain fox                           | desktop sidebar, navbars, the web app |
| `micro`                 | plain fox                           | favicons, 16–32px                     |
| `record` / `screenshot` | state marks                         | recording in progress, a capture      |
| `permissions` / `done`  | fox + shield, fox + sparkles        | the onboarding moments                |

`permissions` and `done` are **moment marks**: neither state nor identity, but
the fox reacting to what just happened. Used once, large, as the hero of a full
screen, so a milestone is told by the mascot instead of a generic glyph in a
tinted square.

### Mobile is not the desktop page in one column

The hero's primary CTA mails the link instead of offering a `.dmg` (a phone is
not the machine you would install on), the rail becomes a horizontal strip, and
a sticky bar keeps the download in thumb reach.

### The hero's viewport ladder keys on HEIGHT, not width

Once the headline caps at 112px the hero is a **fixed ~990px tall, whatever the
width**. That is why the page read well on a 27" external (1440px of height,
450px to spare) and broke on a MacBook Pro 14 (950px — 40px short), with the
mockup and the footnote below the fold. A width ladder would not have caught it,
because the failing screen is wide.

Measured before and after, with Playwright against the dev server:

| Viewport  | Before             | After                   |
| --------- | ------------------ | ----------------------- |
| 2560×1440 | 990px, 450 spare   | 909px, fills the screen |
| 1728×1000 | 990px, 10 spare    | fills                   |
| 1512×950  | **overflows +40**  | fills                   |
| 1440×900  | **overflows +88**  | fills                   |
| 1280×800  | **overflows +178** | fills                   |

Three steps — `l` (< 1040px tall), `m` (< 940), `s` (< 860) — each shortening the
same four things in proportion: the section's padding, the headline, the mark and
the rhythm between blocks. Nothing is removed; a short viewport gets the whole
hero, tighter. All of them are scoped to `width >= 1080px`, the two-column
regime: below that the page is a single column meant to scroll, and the existing
breakpoints own it.

The hero also takes `min-height: 100svh` in that regime, so it owns the first
screen and the next section cannot peek above the fold. `min-height`, never
`height` — a short viewport still gets a hero as tall as its content needs — and
`svh` rather than `vh` so a mobile browser's collapsing toolbar does not make it
jump.

### The top bar sits on the page's grid, not the viewport's

The bar is full-bleed (it carries the blur across the whole width) but its
contents live in the same container as every section, so the mark on the left
lands on the hero logo's edge and the Download button on the content's right
edge. It had its own fixed 28px gutter, which drifted further out of the grid the
wider the viewport got.

One subtlety worth keeping: the sections put the gutter **outside** their 1280px
container (padding on the section, `max-width` on the inner grid), so the bar's
container is `calc(var(--kl-max-w) + 2 * var(--kl-gutter))`. With a plain
`max-width` it is symmetric but 24px too far in on both sides.

## Conventions to keep

- Landing CSS never uses a Tailwind utility and never a `--kaipu-*` token.
- New copy needs both `en.json` and `es.json`. The Spanish is real neutral
  Spanish, not translated-looking English, and has **not** been reviewed by the
  owner yet.
- **Grep before adding an i18n key.** A collision already happened once:
  `homeHeroSerif` was overwritten by a later batch and silently broke the moments
  headline.
- Anything that renders on the server and hydrates must be deterministic — the
  pixel grid and the audio waveform use fixed seeds for exactly this reason.
- Mockups expose no focus targets and announce nothing. They are pictures.

## Open

- **Nothing has been reviewed in a browser by the owner.** The page now renders
  and has been measured at five viewports, but every layout decision was reasoned
  from the design images. The owner reviews by screenshot each round.
- **The rail's active-chapter label collides with the mockup.** On the hero the
  label reads "Kaipu" and at 1440×900 it overlaps the mockup's "Change" button.
  Two candidate fixes: show it on hover/focus only, or drop it on the bookends
  (`hero`, `files`) and keep it on the numbered chapters. Undecided.
- **Two desktop E2E failures block `git push`** (`playback.e2e.ts:60`,
  `shortcuts.e2e.ts:15`). Neither asserts on changed code — one is a 120s
  timeout, the other a video that advanced 1.8s instead of 2.1s — and the same
  suite passed 13/13 earlier on another branch under lighter load. Suspected
  contention, **not verified**.
- **The desktop bundle icon** (`build/icon.icns`, `.ico`, `.png`) is still the
  old artwork. Needs a 1024×1024 export from Figma; the source is 778px and
  upscaling looks soft in the Dock.
- **Missing brand assets:** the pink lockup as SVG, a cropped fox head for a true
  favicon, and a monochrome plain fox for the menu-bar idle state.
- **Caveat is 75 kB** — half the font budget, for two handwritten words in one
  mockup. Subsetting brings it to ~8 kB. Worth doing before this ships.
- **The mobile CTA has no backend.** "Send the link to my Mac" scrolls to
  `#download`; there is no mail flow.

## Related

- [Typed styles with StyleX](./stylex-migration) — where the token layer is going.
- [The main window disappears when the app loses focus](./bug-main-window-hides-on-blur)
  — found while testing the desktop side of this branch.
