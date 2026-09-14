---
title: Typed styles with StyleX across desktop and web
description: Proposal to evaluate shared typed token references and a gradual migration from desktop CSS Modules and web Tailwind to StyleX.
---

# Typed styles with StyleX across desktop and web

> **Status: 🔵 Proposed — pending analysis** (2026-09-12). This records a direction
> to evaluate later, not an approved implementation plan. No migration has started.

## Motivation

Write component styles and token references in TypeScript across desktop and web,
with autocomplete, safer token renames, and compile-time feedback for invalid
references. Use the existing shared token package as the foundation. The desired
end state removes Tailwind from the web and replaces desktop CSS Modules with
StyleX, subject to a technical evaluation and visual parity checks.

The expected benefit is maintainability and consistency. Runtime performance,
bundle size, and build speed improvements are hypotheses to measure, not promises.

## Current architecture (checked 2026-09-12)

| Layer            | Desktop                                              | Web                                              |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------ |
| App              | `apps/kaipu-record` (Electron renderer)              | `apps/web-hono`                                  |
| Component styles | CSS Modules: 77 `.module.css` files, plus global CSS | Tailwind and `@kaipu/web-ui`                     |
| Components       | Local `src/renderer/src/ui/` primitives              | `packages/web-ui` plus app-local components      |
| Shared tokens    | `@kaipu/tokens/css`, unprefixed CSS variables        | `@kaipu/tokens/css/kaipu`, `--kaipu-*` variables |

`@kaipu/tokens` already exports both TypeScript and generated CSS:

- `src/index.ts` exports `base`, `dark`, `light`, token names, and types.
- `src/base.ts` and `src/themes/*.ts` are the source of truth for values.
- `src/generate.ts` produces `css/tokens.css` and `css/tokens.kaipu.css`.
- Both apps currently consume the CSS exports for styling. Desktop imports them
  through `assets/base.css`; web imports them through `src/index.css`.

The web prefix prevents collisions with shadcn variables. The landing consumes
Kaipu tokens, while web UI also has its own semantic variables such as
`--primary` and `--background`. Unifying those semantics needs an explicit mapping.

Desktop and web share token values today, but do not share their button, input,
or other primitive implementations. A desktop `var(--accent-primary)` and a web
`bg-[var(--kaipu-accent-primary)]` refer to the same underlying design value;
they do not imply shared layout, variants, or behavior.

The earlier [shared tokens proposal](/backlog/shared-tokens-package/) contains a
historical pre-extraction sketch. This proposal builds on the package that now
exists; it does not propose extracting it again.

## Proposed direction

### Keep one token source and expose typed StyleX references

Retain framework-neutral token values in `@kaipu/tokens`. Evaluate generating an
additional `.stylex.ts` export with `defineVars` and corresponding theme definitions,
so consumers use typed references without maintaining a second palette by hand.
Preserve CSS exports for existing consumers during migration.

Do not assume arbitrary imported TS objects can be passed directly into StyleX
compilation. Validate its static analysis and workspace module resolution first.
A generated adapter is a candidate implementation, not a settled API.

Components should reference theme-aware variables rather than importing raw
`dark` or `light` values into each style. TypeScript authoring still produces CSS
for the browser: CSS variables provide theme inheritance and switching.

### Use StyleX in both applications

Evaluate the official Vite integration in the Electron renderer, the web app,
and the `web-ui` package build. Preserve development hot reload, production CSS
extraction, test tooling, and package exports. Compatibility with the repository's
installed versions has not been validated.

Move component styles into TS/TSX with explicit variants and composition. Keep a
small global CSS entry point where appropriate for resets, scrollbars, and
Electron window rules. The objective is typed component styling, not eliminating
every emitted or authored CSS file regardless of purpose.

### Evaluate shared UI separately

A common styling system makes shared primitives easier but does not automatically
create them. Compare Button, Input, Card, and other candidates across apps before
extracting a shared library. Share components only where visual and interaction
contracts align; keep app-specific behavior close to its consumer. The package
name and the future role of `@kaipu/web-ui` remain open.

## Candidate migration sequence

1. **Feasibility and baseline:** inventory styles, selectors, themes, portals,
   animation utilities, and package consumers; capture representative screenshots
   and current build/bundle measurements.
2. **Tokens and build integration:** prototype typed token exports and StyleX in
   both apps, including development, production, and tests. Verify dark/light
   behavior before committing to the wider migration.
3. **Primitives:** migrate representative components with focus, hover, disabled,
   size, and variant states. Decide which primitives should be shared.
4. **Screens:** migrate desktop pages and floating windows, plus the landing,
   authentication, and authenticated web routes incrementally.
5. **Cleanup:** remove replaced CSS Modules, Tailwind plugins/configuration and
   dependencies, and obsolete utilities only once no consumers remain. Check
   `tailwind-merge`, animation utilities, shadcn styling, and generated web-ui
   artifacts explicitly. Retain needed CSS exports and global rules.

Each increment should remain buildable and reviewable. Temporary coexistence
requires checking specificity and style precedence; rollback should be possible
without reverting unrelated product work.

## Questions for the later analysis

- Generate a StyleX adapter from existing TS values, or redesign the token source?
  How are generated artifacts and drift checks maintained?
- What is the public token naming contract, and how do shadcn semantics map to it
  without unintentionally redesigning existing screens?
- How are themes applied to roots, portals, and every independent Electron window?
- How do StyleX composition and component props replace `className` overrides,
  data-attribute selectors, and existing variant helpers?
- How are dynamic editor dimensions, animations, vendor properties, and descendant
  selectors represented while retaining current behavior?
- Where does compilation happen for shared packages, and how do consuming builds
  discover their CSS and token definitions?
- What is the measured migration effort, and is the maintenance benefit worth it
  compared with retaining the current CSS Modules/Tailwind setup?

## Acceptance criteria for a future implementation

- A single token source supplies typed references and working dark/light themes;
  invalid token references fail type checking and generated outputs cannot drift.
- Both apps and shared UI build successfully in development and production, with
  hot reload and existing relevant tests working.
- Visual and interaction checks cover web landing/auth/recordings, desktop main
  screens, editors, modals/select portals, capture panel, camera bubble, and
  control bar, including keyboard focus and disabled states.
- Theme persistence and window-specific layout/scroll/drag behavior remain intact.
- Tailwind is removed from migrated web surfaces and their build dependencies;
  replaced desktop CSS Modules are removed, with any retained global CSS explained.
- Build time and generated asset size are compared with the baseline; performance
  claims are made only where supported by measurements.

## References for the feasibility review

- [StyleX Vite integration](https://stylexjs.com/docs/learn/installation/vite/)
- [StyleX variable definitions and file constraints](https://stylexjs.com/docs/learn/theming/defining-variables/)
- [Existing shared token design](/specs/2026-07-07-design-tokens-package-design/)

Recheck upstream integration details and installed versions when this work is picked up.
