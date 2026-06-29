---
title: Shared design-tokens package (dark + light)
description: Extract Kaipu's design tokens into a single shared package consumed by both the desktop (Electron) and web apps, with dark and light themes — replacing the manual token mirror that exists today.
---

# Shared design-tokens package (dark + light)

> **Status: 🔵 Proposed** — not a priority. Captured so the duplication created during the
> landing-theming work has a planned, DRY resolution.

## Why

Right now the brand palette lives in **two places**:

- **Desktop (Electron):** `apps/kaipu-record/src/renderer/src/assets/base.css` — plain CSS `:root`
  variables (`--accent-primary: #f6055c`, `--bg-app: #0f0f11`, …). The source of truth today.
- **Web (`web-hono`):** `apps/web-hono/src/index.css` — a **manual mirror** of a subset of those
  values, prefixed `--kaipu-*` to avoid clashing with web-ui's shadcn tokens. Added so the
  marketing landing matches the app.

That's two sources of truth: change `#f6055c` in the desktop and the web silently drifts. The
mirror is fine for the small, stable landing, but it doesn't scale as more web surfaces (or a
second desktop theme) appear.

## Goal

One package that **exports the design tokens**, consumed by both apps, supporting **dark and light
(white) themes**. A single edit propagates everywhere. The desktop is dark-only today and the
landing is dark-only; the package should define **both** themes from the start so a future light
mode (web or desktop) is a config flip, not a rewrite.

## Proposed approach (sketch — refine at brainstorming time)

- **A `@kaipu/tokens` package** (or fold into `@kaipu/web-ui`) exporting tokens in a
  framework-neutral form:
  - The raw values (e.g. a TS/JSON object) so JS can read them.
  - A generated CSS file per theme exposing `:root`/`[data-theme="light"]` (or `.dark` / `.light`)
    custom properties.
- **Both apps import the generated CSS:**
  - Desktop: replace the hardcoded `:root` block in `base.css` with the package's dark theme.
  - Web: replace the `--kaipu-*` mirror in `index.css` with the package's CSS; the landing keeps
    using the same variable names.
- **Theme switching:** a `data-theme` attribute (or `.dark`/`.light` class) on the root element
  selects the active set. Desktop can stay forced-dark; web can offer a toggle later.

## Open questions (resolve when picked up)

- **Naming reconciliation:** desktop uses `--accent-primary` / `--bg-app`; web-ui (shadcn) uses
  `--primary` / `--background`. Pick one canonical naming and map, or export both aliases.
- **Token scope:** colors only first, or also spacing / radii / typography (the desktop already
  tokenizes those in `base.css`)?
- **Light palette:** the dark values exist; the **light theme values need to be designed** (they
  don't exist anywhere yet).
- **Build/consumption:** does the package ship prebuilt CSS (committed, like `@kaipu/web-ui/dist`)
  or build on demand via turbo? Match the existing pattern.
- **web-ui overlap:** does this live inside `@kaipu/web-ui` (already the web's design dependency)
  or as a standalone `@kaipu/tokens` that web-ui itself consumes?

## Why deferred

The current mirror works and the landing is small + stable. This only pays off once branding
iterates often or a real light mode is on the table. Pick it up then, through the normal
brainstorm → spec → plan flow.
