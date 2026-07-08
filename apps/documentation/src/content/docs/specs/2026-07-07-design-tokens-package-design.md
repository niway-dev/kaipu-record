---
title: "Design tokens package — design"
description: "A shared @kaipu/tokens package: one typed TS source of truth generating the CSS custom properties consumed by the desktop app and the web landing, with dark + light themes and theme toggles on both surfaces. Shipped as three sequential PRs."
---

# Design tokens package (`@kaipu/tokens`) — design

> **Status: approved design** (2026-07-07). Replaces the manual token mirror between
> `apps/kaipu-record/src/renderer/src/assets/base.css` (source of truth today) and
> `apps/web-hono/src/index.css` (hand-copied `--kaipu-*` subset). Backlog entry:
> [shared-tokens-package](/backlog/shared-tokens-package).

## Problem

The brand palette lives in two places that drift silently: the desktop's `base.css`
`:root` block (~60 tokens: colors, spacing, radii, typography, transitions, layout
dims) and a hand-mirrored 10-token subset in the web landing, prefixed `--kaipu-*`
to avoid clashing with web-ui's shadcn variables (`--border`, `--primary`, …).
There is no light theme anywhere, and JS code that needs raw values (editor canvas,
video export) hardcodes hex strings.

## Goal

One typed TS source of truth that generates every consumed form of the tokens:

- CSS custom properties for the desktop (unprefixed — existing names, zero churn).
- CSS custom properties for the web (`--kaipu-*` prefixed — zero shadcn collision).
- Importable TS objects for JS consumers (canvas, exports).
- Dark **and** light themes, with a toggle on the web landing and a theme setting
  in the desktop app. Dark remains the default everywhere.

## Non-goals

- Migrating web-ui's shadcn tokens (`--background`, `--primary`, …) into this
  package. The app/auth routes keep shadcn's system untouched.
- A `system` (auto) theme option — follow-up; both surfaces ship `dark | light`.
- Replacing hardcoded hexes in canvas/export code — the TS export makes it
  _possible_; the migration is opportunistic follow-up work, not part of these PRs.
- Style Dictionary / W3C token JSON tooling — 60 tokens and 2 targets don't
  justify the dependency. Revisit if a third platform (mobile) appears.

## Architecture

### Package layout

```
packages/tokens/
  src/
    types.ts          # TokenSet — the typed shape every theme must satisfy
    base.ts           # theme-invariant tokens: spacing, radii, typography,
                      # transitions, layout dims (--sidebar-width, --titlebar-height)
    themes/
      dark.ts         # colors + shadows/glows — today's base.css values, verbatim
      light.ts        # same shape, light values (designed in PR2)
    index.ts          # exports { base, dark, light } for JS/TS consumers
    generate.ts       # TS → CSS generator (~80 lines, zero deps)
  css/
    tokens.css        # GENERATED + COMMITTED — unprefixed (desktop)
    tokens.kaipu.css  # GENERATED + COMMITTED — --kaipu-* prefixed (web)
  package.json        # tsdown + devExports pattern (same as @kaipu/i18n)
  tsdown.config.ts
```

### Key decisions

1. **`base` vs `themes` split.** Spacing/radii/fonts don't vary by theme, so they
   live in `base.ts` and are emitted once under `:root`. Theme files carry only
   colors and shadow/glow values; the generated `[data-theme="light"]` block
   re-declares only those.
2. **Type-enforced theme parity.** `dark` and `light` are both `TokenSet`. A theme
   missing a token is a compile error — an incomplete theme cannot ship.
3. **Generated CSS is committed, guarded by a drift test.** A vitest test runs the
   generator in memory and diffs against `css/*.css`; editing a TS token without
   running `bun run generate` fails CI with a clear message. Same committed-artifact
   pattern as `@kaipu/web-ui`'s `dist/`, plus the guard it lacks.
4. **Two CSS flavors, one source.** The generator emits unprefixed names for the
   desktop (every existing `var(--border)` in CSS modules keeps working untouched)
   and `--kaipu-*` prefixed names for the web (shadcn's `--border`/`--primary`
   are never shadowed). The full token set is emitted in both flavors — no curation.
5. **CSS theme structure.** `tokens.css` = `:root { base + dark }` +
   `[data-theme="light"] { light colors }`. No attribute → dark, exactly today's
   rendering. Light is strictly additive.
6. **Exports.** `.` → TS objects (tsdown-built, `devExports` keeps dev pointed at
   `src/` like `@kaipu/i18n`); `./css` → `css/tokens.css`; `./css/kaipu` →
   `css/tokens.kaipu.css`. The CSS files are static exports — tsdown doesn't touch
   them. Vite resolves bare-specifier `@import` via the exports map in both apps
   (precedent: `@import "@kaipu/web-ui/styles.css"` in web-hono).
7. **Formatting.** The generator's output must be `oxfmt`-stable (generate, then CI's
   `oxfmt --check` sees no diff). If oxfmt fights the generated layout, exclude
   `packages/tokens/css/` the way generated `CHANGELOG.md` is excluded (#36).

### Consumption

- **Desktop:** `base.css` replaces its hand-written `:root` token block with
  `@import "@kaipu/tokens/css";`. Everything else in `base.css` (scrollbar theming,
  body defaults, resets) stays. No CSS-module changes — token names are identical.
- **Web:** `index.css` replaces the `--kaipu-*` mirror block with
  `@import "@kaipu/tokens/css/kaipu";`. The landing's 4-ish references to the
  mirror's divergent names (`--kaipu-accent` → `--kaipu-accent-primary`,
  `--kaipu-accent-hover` → `--kaipu-accent-primary-hover`) are renamed to match
  the generated names.
- **JS consumers (later):** `import { dark } from "@kaipu/tokens"` wherever a raw
  hex is needed at runtime.

### Theming model

- **Web landing (PR2, amended as shipped):** a toggle sets `data-theme` on the
  **landing wrapper div** (not `<html>` — a global attribute leaks the kaipu vars
  into app/auth routes via the shared `LocaleSwitcher` and the root critical
  styles) and persists to `localStorage` (`kaipu-theme`); default is dark.
  Accepted tradeoff: returning light-theme visitors briefly see dark until
  hydration (cookie-based SSR theme is the upgrade path if it ever matters).
- **Desktop (PR3, amended as shipped):** `AppSettings.theme` already existed
  (typed, validated, persisted, broadcast) from the settings-store rework — it
  was declared as `"light" | "dark" | "system"` but never applied. PR3 narrowed
  it to `"light" | "dark"` (default `"dark"`; legacy persisted `"system"`
  coerces to dark in `mergeSettings`) and surfaced it: the shared renderer root
  (`I18nRoot`, the single mount point for all four windows) applies
  `document.documentElement.dataset.theme` on load and on every
  `settings:changed` broadcast. A theme selector ships on the Settings page.

### Light palette constraints (values designed in PR2, not here)

- The brand accent `#f6055c` stays the accent in both themes.
- Every text-on-background token pair meets WCAG AA contrast.
- Shadows/glows get light-specific values — the dark ones are calibrated for
  near-black backgrounds and will look muddy on white.
- Transparent/floating windows (widget, control bar) are a known trap
  (background + shadow interplay) — explicit QA items in PR3.
- Semantic accents (green/red/yellow/purple + the brand accent) meet WCAG 1.4.11
  non-text contrast (3:1) on the light surfaces, guarded in `contrast.test.ts`.
  (PR3 darkened light `accent-yellow` #ca8a04 → #a16207 to clear the bar.)

## Delivery — three sequential PRs, owner-validated each

| PR  | Scope                                                                                                                      | Validation                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| PR1 | `@kaipu/tokens` package (dark real, light placeholder = dark values); desktop + web consume it; landing rename; drift test | Pure refactor: both apps render **byte-identical**. Visual spot-check + full CI            |
| PR2 | Design `light.ts` for real; landing theme toggle                                                                           | Owner reviews light landing in browser; contrast checks                                    |
| PR3 | Desktop `theme` setting (AppSettings + broadcast + Settings UI); light QA across all windows                               | Owner walks every window/editor in light in a packaged build; transparent-window checklist |

Each PR is independently valuable; a stall in PR3's QA doesn't block the
already-shipped package or the web light mode.

## Testing

- **Drift test** (PR1): generator output === committed CSS.
- **Generator unit tests** (PR1): token → CSS emission, prefixing, theme block
  structure.
- **Type parity** (PR1): compile-time via `TokenSet` — no runtime test needed.
- **Existing suites stay green** (all PRs): desktop unit tests, E2E harness, both
  app builds. PR1's bar is "no visual or behavioral change".
- **PR3 manual QA checklist:** every window (main, widget, control bar, screen
  picker, editors ×3, settings, onboarding) in light theme, transparent-window
  rendering, mid-session theme switch reaching every open window.

## Risks

- **Committed generated files invite hand-edits.** Mitigated by the drift test and
  a header comment in each generated file ("GENERATED — edit src/themes/\*, run
  `bun run generate`").
- **Desktop light QA is the long tail.** Isolated to PR3 by design; PR1/PR2 value
  ships regardless.
- **oxfmt vs generated CSS.** Resolved either by emitting oxfmt-stable output or
  excluding the generated dir (both precedented); decided during PR1.
