---
title: "Shared styling on StyleX: one token source, portable product UI"
description: "Design spec for migrating Kaipu's styles to StyleX over typed tokens — the decisions, the staged order (tokens, the portable product shell, the home, then shadcn with the cloud), and what each stage must protect."
---

# Shared styling on StyleX: one token source, portable product UI

## Summary (one minute)

Kaipu writes styles three ways today (desktop CSS Modules on `--accent-*`, web
Tailwind/shadcn, landing CSS Modules on `--kl-*`). The experiment on
`experiment/stylex-button` proved a fourth way works on both Vite pipelines with
official StyleX pieces only, and left seven toolchain invariants written down.
This spec turns that verdict into a staged migration whose first product payoff
is the owner's ask: **the mini Kaipu screen the home draws by hand becomes the
real product shell, imported as a shared component** — a portable shell that can
never drift from the app. Tailwind leaves the repo with its last shadcn screen.

| #   | Decision                                                                                                                                                                                                                    | Why                                                                                                                                                                 | ADR        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | `@kaipu/tokens` becomes the single typed source: `defineVars` with **literal values**, `createTheme` for light/dark. The css flavors keep being generated until the last `var(--accent-*)` / `var(--kaipu-*)` consumer dies | Typos become compile errors; the invisible-button class of bug becomes unwritable; three spellings converge into one                                                | 0008 (new) |
| 2   | Light/dark in the StyleX world is `createTheme`, applied at each surface's root; the `[data-theme]` attribute mechanism keeps working for legacy CSS during the transition                                                  | It is the same dark/light product behavior, typed; two mechanisms coexist only while legacy consumers exist                                                         | 0008       |
| 3   | Migration order: **tokens → portable product shell → home's remaining CSS → cloud/auth on shadcn-cssinjs**. The auth/shadcn stage waits for the cloud to go live                                                            | The home is plain CSS (near-1:1 translation) and is the only stage that delivers the portable shell; shadcn depends on a young community port and on product timing | 0008       |
| 4   | The desktop's 91 CSS Modules migrate **opportunistically**: shared pieces and touched surfaces only, no big-bang rewrite                                                                                                    | The win is sharing and type-safety, not churn; a module nobody touches costs nothing                                                                                | —          |
| 5   | Tailwind and shadcn-Radix are removed when the last shadcn screen is rebuilt (the cloud stage). Removing them earlier is out of scope                                                                                       | "Unused dependency" was measured false: auth/cloud screens are built on them, dark but routed                                                                       | 0008       |
| 6   | The landing's `--kl-*` layer folds into the unified tokens during the home stage; untouched before that                                                                                                                     | It is the third spelling of the same values; folding it any earlier couples stages                                                                                  | 0008       |

**Open questions:** shadcn-cssinjs coverage of the 18 components (inventory gates
the cloud stage, not earlier stages); whether the browser repaints live style
edits without a refresh on `<link>`-loaded sheets (observation pending, server
side is proven); `build:mac` packaging with StyleX in the renderer (expected
no-op — `electron-vite build` passes — but unverified).

**Out of scope:** any visual redesign (styles move systems, pixels stay);
the mobile app; auth/cloud UX changes; replacing Base UI/Radix behavior
decisions, which belong to the cloud stage's own review.

## Failures this must protect against

- **An undefined `var()` silently unsets a declaration** (seen: transparent
  button). Typed tokens kill it at compile time; while css flavors live, the
  emitted-sheet grep from the backlog doc stays the check.
- **Two StyleX transforms disagreeing on options** (seen: dev unstyled,
  production fine). The options live in one shape in both configs; flipping
  `dev` means flipping it everywhere.
- **Exports regenerators eating subpaths** (seen: tsdown ate `./kaipu.stylex`
  after one build). Generated subpaths are declared where the generator reads
  them (`customExports`), never by hand in `package.json`.
- **A replica drifting from the product.** The current hand-drawn home mocks
  can silently diverge from the real app; the portable shell exists to make
  that impossible. The failure to watch for is the inverse: a product change
  breaking the landing — the shell's consumers build in CI, so a break is loud.
- **Theme mismatch between surfaces** during the transition: a component on
  typed tokens rendering dark values on a light surface. Stage 1 keeps values
  flowing through the existing custom properties until `createTheme` lands per
  surface, so both mechanisms cannot disagree while they coexist.

## The stages

Each stage is independently shippable and leaves `main` releasable.

**Stage 1 — tokens become the typed source.** `generateStylex()` switches from
`var()` references to literal values from `base.ts`/`themes/*`, plus a
generated `themes.stylex.ts` (`createTheme` for light). The drift tests extend
to the stylex outputs. The css flavors keep being generated and imported
exactly as today. Exit: `@kaipu/ui` components carry no `var()` strings and
render correctly in both themes on both surfaces.

**Stage 2 — the portable product shell.** The pieces of the real desktop UI
that the home's mocks replicate move into `@kaipu/ui` in StyleX, the desktop
adopts them in place of its local modules for those pieces, and the home's
`mock-*` components are replaced by the real imports. Exit: the landing's
mini-Kaipu is the product's own shell, and a visual change to it ships to both
surfaces from one file.

The inventory taken on 2026-10-02 corrects this stage's first sketch, which
read "window chrome + rail + record controls":

| What the landing draws         | The real piece                                                        | Portable                              |
| ------------------------------ | --------------------------------------------------------------------- | ------------------------------------- |
| titlebar with the three lights | drawn by macOS; no code exists                                        | **No** — the landing paints a photo   |
| sidebar with logo + icons      | `shell/sidebar.tsx` (6 items, labels, avatar)                         | Yes, with navigation injected         |
| screen selector                | `features/recording/components/screen-source-selector`, `source-card` | Yes                                   |
| mic / audio / camera sources   | `features/recording/components/recording-toggles`                     | Yes                                   |
| start button with its shortcut | `features/recording/components/record-button`                         | Yes                                   |
| the menu-bar card              | `src/main/tray.ts`, the native tray                                   | **No** — not React                    |
| `mock-record`                  | `features/control-bar`, `capture-panel`, `camera-bubble`              | Yes                                   |
| `mock-capture`                 | `features/screenshots/{annotations,beautify}`                         | Yes, later                            |
| `mock-edit`                    | `features/video-editor` (16 CSS modules)                              | Yes, later                            |
| `mock-find`                    | `features/library` (10 CSS modules)                                   | Yes, later                            |
| `mock-finder`                  | a Finder window, on purpose                                           | **No** — the section's point needs it |
| `rail.module.css`              | the landing's own chapter rail, not the app's                         | **No** — belongs to stage 3           |

So "window chrome" is almost nothing: the chrome is the operating system's. What
stage 2 actually carries is the primitives those pieces are built on, then the
pieces themselves. The primitives go first — migrating the controls before them
would mean migrating the controls twice, once against CSS Modules and again when
the primitives change API. The order and the components' dependency boundary are
[ADR 0009](/architecture/decisions/0009-shared-ui-takes-no-dependencies/).

**Stage 3 — the home's remaining CSS.** The 15 landing modules translate to
StyleX near-1:1; `--kl-*` values fold into the unified tokens (decision 6).
Exit: the landing carries no `.module.css` and no `--kl-*` definitions.

**Stage 4 — cloud/auth on shadcn-cssinjs, Tailwind leaves.** Gated on the
cloud going live and on the coverage inventory. The auth screens rebuild on
the port, the cloud shell is born in StyleX, and Tailwind, shadcn-Radix,
`tw-animate-css`, `tailwind-merge` and the `@source` machinery leave in the
same change that deletes the last shadcn screen.

## Sources

- Measured groundwork: `backlog/stylex-migration.md` (pipeline + invariants),
  the experiment branch (`be6eed7` → `0554710`), and the owner's series log in
  the personal site repo (Step 1–2 evidence).
- Owner decisions recorded here verbatim from the 2026-10-02 session: tokens as
  typed variables now; home before shadcn; Tailwind goes; the home's mini
  screen as a portable component is the point of the exercise.
