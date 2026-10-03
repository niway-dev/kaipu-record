---
title: Typed styles with StyleX across desktop and web
description: Proposal to evaluate shared typed token references and a gradual migration from desktop CSS Modules and web Tailwind to StyleX.
---

# Typed styles with StyleX across desktop and web

> **Status: 🟡 In progress — stages 0–1 shipped, stage 2 started** (updated
> 2026-10-02). ADR 0008 settled the direction and the four stages; stages 0 and 1
> are on `main` (PR #212). Stage 2 is migrating the desktop's primitives into
> `@kaipu/ui` under `atoms/`. The original proposal below still describes the end
> state.

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

### The working pipeline

How a style written in `@kaipu/ui` reaches a screen, on either surface:

```
packages/ui/src/*.tsx            stylex.create({...}), colors as var(--kaipu-*)
        │
        ├─ JS side:  @stylexjs/babel-plugin, INLINE in @vitejs/plugin-react
        │            (vite.config.ts / electron.vite.config.ts) — turns
        │            stylex.props(...) into class names on the element
        │
        └─ CSS side: @stylexjs/postcss-plugin scans the same sources
                     (narrow include globs; parses with babel.config.cjs)
                     and writes the atomic rules where a sheet says `@stylex;`
                     (web: src/stylex.css · desktop: dev/stylex-probe.css)

var(--kaipu-*) resolves because BOTH surfaces define the prefixed set:
web via index.css, desktop via assets/base.css (both @kaipu/tokens imports).
```

Toolchain invariants learned the hard way, which the migration must keep:

1. The PostCSS plugin's scanner parses its `include` files with its **own** Babel:
   it needs the `babel.config.cjs` each app now carries (that file exists _only_
   for the scanner — Vite's React transform takes its plugins inline and never
   reads it), and its globs must point at StyleX sources only, or it chokes on
   generated TS such as `routeTree.gen.ts`.
2. Babel 8 removed `preset-typescript`'s `isTSX`/`allExtensions`; older recipes
   that pass them fail the build.
3. **Every StyleX transform in the pipeline must agree on its options.** The
   inline plugin ran `dev: true` on the dev server while the scanner ran
   `dev: false`: different class names, a correct sheet nothing referenced, dev
   unstyled while production worked. `dev` is pinned `false` in both configs; to
   ever flip it, flip it everywhere at once.
4. **An undefined `var()` silently unsets the declaration.** The desktop defined
   only the unprefixed token set, the button said `var(--kaipu-accent-primary)`,
   and the background computed transparent with the sheet present and the class
   applied. Both surfaces now import the prefixed set; the permanent fix is typed
   `defineVars` generated from `@kaipu/tokens`, which makes a missing spelling a
   compile error instead of an invisible button.

Probes to see it render: web `/dev/stylex` (unlinked route), desktop
`#stylex-probe` (dev-only, tree-shaken from packaged builds). Both show every
`Button` variant and size, plus a raw control with literal colors: where the
raw control renders and the token-driven buttons do not, the surface's token
variables are missing, not StyleX. Since stage 2 the control is a local button
inside each probe rather than a `Button` variant, so a debugging aid stays out
of the product's API. (`KaipuButton`, named above as the first spike, is now
`Button` in `packages/ui/src/atoms/`.)

Still open before widening: dev-server HMR behaviour of the scanner,
[facebook/stylex#1918](https://github.com/facebook/stylex/issues/1918) on our Vite,
and typed `defineVars` generated from `@kaipu/tokens` (the button consumes the
tokens as `var()` strings). The agreed shape: the web-ui CSS dedup ships first,
the auth screens (dark today) are rebuilt on shadcn-cssinjs as the pilot, and the
cloud shell is born in StyleX when it goes live — Tailwind leaves with its last
shadcn screen. The design spec and ADR will carry those decisions.

## What the second pass proved (2026-10-02)

The three things the first pass declared untested, now measured:

- **Live-edit freshness: yes.** With the web dev server running, a style value
  edited in `@kaipu/ui` reached both the served sheet and the component's
  compiled class names within seconds, in lockstep (`.xixl9f9` on both sides).
- **[facebook/stylex#1918](https://github.com/facebook/stylex/issues/1918)
  (stale chunk hash): does not reproduce here.** Two production builds differing
  in one style value produced different sheet filenames, contents and JS chunk
  hashes.
- **Typed tokens: shipped as generated `defineVars`.** `@kaipu/tokens` now also
  generates `stylex/kaipu.stylex.ts` — typed references over the prefixed
  custom properties, so a token typo is a compile error while the existing
  `[data-theme]` blocks keep owning the values. The button consumes
  `tokens.accentPrimary` instead of a `var()` string; both builds emit the
  defining `:root` block (`--xbxcam6: var(--kaipu-accent-primary)`) and the
  atomics referencing it. Replacing the references with literal values +
  `createTheme` (retiring the css imports) stays a spec decision, on purpose.

Invariant 5, learned shipping it: **the import specifier must end in
`.stylex`** — the compiler refuses `@kaipu/tokens/stylex` and accepts
`@kaipu/tokens/kaipu.stylex` (the export map key carries the suffix). And a
corollary of invariant 4 caught in the same hour: the scanner's `include`
globs are part of the correctness surface — a formatter-collapsed config line
silently dropped the tokens glob, and the sheet _used_ the hashed vars without
_defining_ them. The grep that catches it:
`grep -- '--x[a-z0-9]*:var(--kaipu-' <emitted css>` must match.

## Stage 2a — the shared library, as it stands (2026-10-03)

Eleven of the desktop's thirteen primitives are gone from the app and nine of
them live in `@kaipu/ui`. Nothing here changes a pixel: every component was
migrated value for value.

|                        | Components                                                   |
| ---------------------- | ------------------------------------------------------------ |
| `atoms/`               | `Badge` `Button` `Card` `Input` `Row` `SearchInput` `Toggle` |
| `molecules/`           | `Modal` `Popover` `ToastList`                                |
| Deleted — no consumers | `IconButton` `PageHeader`                                    |
| Still in the desktop   | `Select`                                                     |

`Select` is the only one left, and not for want of effort — see the limits
section in the spec. Radix publishes its state through data attributes that
StyleX has no way to select on, so migrating it means lifting that state into
React: a behavioural rewrite of the component whose keyboard handling is the
whole reason Radix is there. Stage 4 settles it, along with which headless
library both surfaces share.

What the desktop's `ui/` folder still holds is no longer components: the toast
host (six lines wiring this app's store to the shared stack), the toast store
itself, and two helpers.

### Dependencies this removed

`@radix-ui/react-switch` is gone. `Toggle` is a `<button role="switch">`, which
is what the primitive rendered anyway, and the native button already provides
keyboard activation and focus. It mattered because the web runs on
`@base-ui/react`: a shared component carrying Radix would pull a second headless
library into whichever surface lacked it.

### What it cost in bytes: almost nothing

Desktop renderer bundle, built before (`228bf47`) and after the whole migration:

|     | Before    | After     |
| --- | --------- | --------- |
| CSS | 172.4 KB  | 170.9 KB  |
| JS  | 2824.1 KB | 2815.7 KB |

−1.5 KB and −8.4 KB, the JS mostly from dropping Radix's switch. **This migration
is not a performance change and should not be sold as one.** Its return is
type-safety and shareability. The landing is untouched so far, so there is
nothing for a web preview to measure yet; that comes when stage 2b replaces the
home's hand-drawn mocks with the real components.

### Decisions inside the Button worth knowing

- **Hover is a separate style layer applied only while enabled**, not a `:hover`
  nested in each variant. The CSS it replaces guarded every hover with
  `:not(:disabled)`; as one declaration the outcome would depend on the
  compiler's pseudo-class ordering instead of on something readable.
- **`type="button"` is now the default.** A bare `<button>` inside a form
  submits it. The only form using the primitive (`features/auth/auth-form.tsx`)
  passes `type="submit"` itself, so the default costs nothing — and that same
  line is the only `className` override on a primitive in the whole renderer.
- **Two values have no token behind them.** The `ghost`/`outline` hover is the
  accent at 10% alpha, hard-coded here as it is in the desktop's stylesheet. And
  the `transition` token is the CSS shorthand `"150ms ease"`, which no longhand
  accepts, so the component splits it into duration and easing. Both are debts
  of the token layer, not of the component.

### Testing

`packages/ui` runs vitest with the renderer's conventions (Testing Library,
jsdom, co-located tests) and **the StyleX babel plugin with the same options as
every other transform** — invariant 3, and not optional either: `stylex.create`
is a compile-time call, so without the plugin the module throws on import.

The tests assert relationships between emitted classes, never a hash: a hash
changes with any value change, which is a refactor the test must survive.
"primary and danger do not look the same" and "a disabled button carries no
hover rule" are the properties whose breakage would reach a user.

The setup file is four lines, against the renderer's ~150 of IPC, i18n and
settings stubs. That gap is ADR 0009's boundary working; if the file starts
growing stubs, the boundary was crossed.

### The CPU-budget test failure this exposed

Adding this test suite took `turbo`'s test tasks from 9 to 10 at
`concurrency: 20`, and two tests in
`pages/video-editor/video-editor-page.test.tsx` then failed under
`bun run verify` — a different one each run, while passing in isolation (25/25),
passing with the desktop suite alone (194 files, 1329 tests), and `verify` green
on a clean tree.

There turned out to be **two** causes, found one at a time because each run
surfaced a different test:

1. **Testing Library's default `findBy*` timeout of 1000 ms.** The two heaviest
   assertions landed at 1016 ms and 1106 ms. They were already `await findBy*` —
   the selectors were never the problem, the budget was. The renderer's setup now
   sets `asyncUtilTimeout: 5000`. A suite's wall-clock under parallel load is not
   a property of the product; a genuinely missing element still fails, five
   seconds later.
2. **Assertions that read the DOM one render too early.** `R arms the Box tool`
   asserted `className` synchronously right after `fireEvent.keyDown`, so it only
   passed when the machine won the race. Five assertions in that file now wait
   for the render or effect they describe.

Three of those five were negatives — `expect(startExport).not.toHaveBeenCalled()`
straight after a click. A negative with nothing to anchor it passes just as
happily when the handler never ran, so each now waits for the guard's toast first
and asserts the negative after. They were green for the wrong reason before.

The file also gained a test: `V` handing the tool back to `select` after `R`
armed Box. `toolForShortcut` proved the mapping as a pure function, but nothing
proved the page acted on it and disarmed the previous tool.

Stability check: `bun run verify` green three consecutive times, 10/10 test
tasks, 26 tests in that file.

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
