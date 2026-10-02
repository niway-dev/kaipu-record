---
title: Typed styles with StyleX across desktop and web
description: Proposal to evaluate shared typed token references and a gradual migration from desktop CSS Modules and web Tailwind to StyleX.
---

# Typed styles with StyleX across desktop and web

> **Status: 🟡 In progress — feasibility proven, migration not started** (updated
> 2026-10-01). The owner chose StyleX as the direction; the first experiment is
> committed on `experiment/stylex-button` and the design spec is next. The original
> proposal below still describes the end state.

## What the first experiment proved (2026-10-01, `be6eed7`)

One `KaipuButton` written with `stylex.create` in a new source-exported package,
`packages/ui` (`@kaipu/ui`), compiles in **both** pipelines with official StyleX
pieces only (0.19.1) — no community Vite plugin:

- `@stylexjs/babel-plugin` passed **inline** to `@vitejs/plugin-react`, in
  `apps/web-hono/vite.config.ts` and the renderer section of
  `apps/kaipu-record/electron.vite.config.ts`;
- `@stylexjs/postcss-plugin` scanning the StyleX sources and writing atomics where a
  stylesheet says `@stylex;` (`apps/web-hono/src/stylex.css`,
  `apps/kaipu-record/src/renderer/src/dev/stylex-probe.css`).

Both production builds exit 0. The web build emits a separate ~1 KB `stylex-*.css`;
the renderer merges the atomics into its `index-*.css`. Every color in the emitted
CSS is a `var(--kaipu-*)` reference, so the existing theme blocks style the shared
button with no theming code in the component — the token layer crossed the
desktop/web boundary exactly as this proposal hoped.

Toolchain invariants learned the hard way, which the migration must keep:

1. The PostCSS plugin's scanner parses its `include` files with its **own** Babel:
   it needs the `babel.config.cjs` each app now carries (that file exists _only_
   for the scanner — Vite's React transform takes its plugins inline and never
   reads it), and its globs must point at StyleX sources only, or it chokes on
   generated TS such as `routeTree.gen.ts`.
2. Babel 8 removed `preset-typescript`'s `isTSX`/`allExtensions`; older recipes
   that pass them fail the build.

Probes to see it render: web `/dev/stylex` (unlinked route), desktop
`#stylex-probe` (dev-only, tree-shaken from packaged builds).

Still open before widening: dev-server HMR behaviour of the scanner,
[facebook/stylex#1918](https://github.com/facebook/stylex/issues/1918) on our Vite,
and typed `defineVars` generated from `@kaipu/tokens` (the button consumes the
tokens as `var()` strings). The agreed shape: the web-ui CSS dedup ships first,
the auth screens (dark today) are rebuilt on shadcn-cssinjs as the pilot, and the
cloud shell is born in StyleX when it goes live — Tailwind leaves with its last
shadcn screen. The design spec and ADR will carry those decisions.

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
