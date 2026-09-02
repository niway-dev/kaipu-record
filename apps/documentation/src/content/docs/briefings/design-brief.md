---
title: Design Brief
description: Kaipu Record's palette, type scale, and voice, read from the design-tokens package itself.
---

# Kaipu Record — Design Brief

> Paste this into a model doing design or UI work on Kaipu. If anything here
> disagrees with `packages/tokens/src/` (`base.ts`, `themes/dark.ts`,
> `themes/light.ts`), **the tokens package wins** — it's the compiled, contrast-tested
> source; this document is a snapshot of it.
> Current as of 2026-09-02.

## The aesthetic in one paragraph

Kaipu reads as a focused creator tool, not a playful consumer app: dark-native,
near-black neutral surfaces (`#0f0f11`) with a single hot-pink/magenta accent
(`#f6055c`) reserved for action and brand, a calm zinc-gray text hierarchy, small
precise corner radii (4–8px), a tight spacing rhythm, and a compact UI type scale
(11–20px) set in Geist. It sits closer to Linear or Obsidian than to a bubbly
consumer recorder — quiet chrome, one loud accent, status conveyed through color
rather than badges or copy.

## Palette

Dark is the app's native theme; light is derived from it with the same hue
relationships, darkened one contrast step. Every text/surface pair is
WCAG-AA-guarded by `contrast.test.ts` — don't hand-pick a pair that isn't already
in the token set.

| Token                                            | Dark                              | Light                             | Semantic meaning                                                                                                                                             |
| ------------------------------------------------ | --------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bg-app` / `bg-sidebar` / `bg-card`              | `#0f0f11` / `#0c0c0e` / `#171719` | `#fafafa` / `#f4f4f5` / `#ffffff` | Surface hierarchy — decorative, not data                                                                                                                     |
| `border` / `border-light`                        | `#26262a` / `#32323a`             | `#e4e4e7` / `#d4d4d8`             | Structural dividers — decorative                                                                                                                             |
| `text-primary` / `text-secondary` / `text-muted` | `#e5e5e7` / `#a1a1aa` / `#6b7280` | `#18181b` / `#52525b` / `#62626b` | Content hierarchy — decorative                                                                                                                               |
| `accent-primary` (+ `-hover`, `glow-accent`)     | `#f6055c`                         | `#f6055c` (hover `#d4044f`)       | **Brand + primary action.** The one color that always means "the CTA" or "this is Kaipu." Don't reuse it for status.                                         |
| `accent-green`                                   | `#22c55e`                         | `#15803d`                         | **Data.** Success / `ready` state (e.g. a recording finished, sync confirmed).                                                                               |
| `accent-red` (+ `-hover`)                        | `#ef4444` / `#dc2626`             | `#dc2626` / `#b91c1c`             | **Data.** Error / destructive action / failed upload — always paired with a visible message, per product philosophy.                                         |
| `accent-yellow`                                  | `#eab308`                         | `#a16207`                         | **Data.** Warning / pending / needs-attention state.                                                                                                         |
| `accent-purple`                                  | `#a855f7`                         | `#9333ea`                         | Reserved — defined in the token set but **not currently consumed anywhere in app source**. Don't invent a meaning for it; ask before wiring it to something. |

**Color carries data for the four accents** (primary/green/red/yellow): green, red,
and yellow are status colors used in badges and indicators (recording/sync state),
and must not be reused decoratively elsewhere — the product philosophy explicitly
strips pipeline-state badges from the UI, so when one of these colors does appear
it should mean the specific state it's assigned to, nothing else.

## Typography

| Token          | Value                                                                                          | Use                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `font-family`  | `"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` | All UI text                                                                    |
| `font-mono`    | `"Geist Mono", "SF Mono", "Fira Mono", "Cascadia Code", monospace`                             | Code/technical values only                                                     |
| Sizes          | `font-size-xs` 11px → `font-size-xl` 20px (six steps)                                          | Compact desktop-app density — this is a chrome/UI scale, not a marketing scale |
| Weights loaded | 400 (normal), 500 (medium), 600 (semibold)                                                     | Don't reach for a weight outside this set — nothing heavier is loaded          |

**Rule:** the landing page (`apps/web-hono`) currently sets its own larger type
scale directly in Tailwind classes (e.g. `text-4xl`/`text-6xl` for the hero), outside
the token scale above. That's a real inconsistency, not an intentional second scale
— treat the token scale as canonical for anything that isn't marketing hero type,
and flag it rather than extend the untokenized pattern.

## Structure and texture

- **Radii**: `radius-sm` 4px, `radius-md` 5px, `radius-lg` 8px — small and precise,
  never pill-shaped or heavily rounded.
- **Spacing**: `space-xs` 4px through `space-2xl` 32px, six steps, all multiples of 4.
- **Borders**: hairline (`border`/`border-light`), never a heavy or colored border
  for structure.
- **Elevation**: `glow-accent` is the only shadow token, and it's a soft pink glow
  calibrated for near-black backgrounds (`0 10px 26px -8px rgba(246,5,92,0.75)` in
  dark, softened to `0.35` alpha in light) — reserved for the primary CTA, not
  general card elevation.
- **Motion**: two durations only, `transition` 150ms and `transition-slow` 250ms,
  both `ease` — nothing bespoke per component.
- **Desktop chrome tokens**: `sidebar-width` (56px) and `titlebar-height` (38px) are
  specific to the Electron app's custom window chrome, not general layout tokens.

## Brand assets

There is no dedicated brand-assets folder yet. What exists today:

- `apps/kaipu-record/resources/` — the app icon (`icon.png`) and tray icons
  (`tray.png`, `tray-recording.png`, plus `@2x` variants for the recording-active
  tray state).
- `apps/web-hono/public/demos/` — the landing page's demo clips (`hero`, `record`,
  `screenshot`, `editor`), each shipped as `.mp4`/`.webm` plus a poster `.jpg`.

There is no vector logo/wordmark file in the repo today; the "Kaipu" wordmark seen
in the desktop watermark is drawn in the compositor, not sourced from an asset file.

## Voice

Copy is short, benefit-first, and un-hyped — see
`packages/i18n/messages/en.json` (`landing.*` keys) for the canonical tone:
_"Record your screen, without the hassle."_ / _"No sign-ups, no logins. Download and
record."_ / _"Record. Share. No fuss."_ Sentences are short, concrete, and skip
exclamation points; every feature description leads with the outcome, not the
mechanism.

**Off-limits phrases** (per the product's forbidden claims): anything implying an
**enterprise or team-collaboration platform** (seats, org admin, SSO), anything
framing Kaipu as **cloud-first** or a **general/advanced video editor** — the voice
should always read as "a fast, personal tool," never as "a platform."
