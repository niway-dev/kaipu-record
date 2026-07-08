---
title: "Design tokens package — PR2 implementation plan"
description: "Design the real light palette in @kaipu/tokens and add a dark/light theme toggle to the web landing, plus the vite-tsconfig-paths worktree-scoping DX fix."
---

# Design Tokens Package (PR2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the light-theme placeholder with a real designed palette (WCAG-AA-guarded by unit tests) and let the web landing toggle between dark and light; the desktop stays forced-dark until PR3.

**Architecture:** Only `packages/tokens/src/themes/light.ts` carries new values — the generator, CSS structure, and consumers are already wired (PR1). The landing toggle sets `data-theme` on `<html>` + persists to `localStorage`; an inline head script applies the stored theme pre-paint (no flash). Spec: [Design tokens package — design](/specs/2026-07-07-design-tokens-package-design/).

**Tech Stack:** Same as PR1 (Bun, vitest ^4.1.9). No new dependencies.

## Global Constraints

- Branch `feat/design-tokens-light-web` off `feat/design-tokens-package` (PR #38 not merged yet; PR base = `feat/design-tokens-package`, GitHub retargets to main when #38 merges).
- Dark rendering must NOT change — light values live only in the `[data-theme="light"]` blocks; `:root` stays byte-identical (drift test + `light.ts` are the only token-source changes).
- Brand accent `#f6055c` stays the accent in both themes (spec rule).
- Every text-on-background pair in light must meet WCAG AA (4.5:1) — enforced by a unit test, not by eye.
- Desktop stays forced-dark: nothing in `apps/kaipu-record` changes in this PR.
- After editing token sources: run `bun run generate` in `packages/tokens` and commit `css/` (drift test enforces).
- No TS enums; English code/comments; `bunx oxfmt --check .` before push; never `--no-verify`.
- `gh` account: `csdev19`.

---

### Task 1: The light palette + WCAG contrast guard

**Files:**

- Modify: `packages/tokens/src/themes/light.ts` (replace the `{ ...dark }` placeholder)
- Create: `packages/tokens/src/contrast.test.ts`
- Regenerate: `packages/tokens/css/tokens.css`, `packages/tokens/css/tokens.kaipu.css`

**Interfaces:**

- Consumes: `TokenSet` from `./types` (PR1).
- Produces: real `light: TokenSet` values; `[data-theme="light"]` blocks in both CSS flavors carry them. Task 2's toggle relies on these being visually complete.

- [ ] **Step 1: Write the failing contrast test**

`packages/tokens/src/contrast.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dark } from "./themes/dark";
import { light } from "./themes/light";

/** WCAG relative luminance from a #rrggbb hex. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two #rrggbb hex colors. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Every text token must be readable on every surface it can sit on.
const TEXT_TOKENS = ["text-primary", "text-secondary", "text-muted"] as const;
const SURFACE_TOKENS = ["bg-app", "bg-sidebar", "bg-card", "bg-card-hover", "bg-input", "bg-modal"] as const;

describe("light theme", () => {
  it("is no longer the dark placeholder", () => {
    expect(light).not.toEqual(dark);
  });

  it("keeps the brand accent identical to dark", () => {
    expect(light["accent-primary"]).toBe(dark["accent-primary"]);
    expect(light["accent-primary-hover"]).toBe(dark["accent-primary-hover"]);
  });

  it.each(TEXT_TOKENS.flatMap((t) => SURFACE_TOKENS.map((s) => [t, s] as const)))(
    "light %s on %s meets WCAG AA (4.5:1)",
    (text, surface) => {
      expect(contrast(light[text], light[surface])).toBeGreaterThanOrEqual(4.5);
    },
  );
});

// NOTE: the DARK palette is intentionally NOT held to this bar here — the shipped
// dark text-muted (#6b7280) measures ~3.9:1 on bg-app, a pre-existing condition
// outside this PR's scope (spec binds AA on the LIGHT palette only). Flagged in
// the PR body as a known follow-up; do not "fix" dark values in this PR.
```

- [ ] **Step 2: Run to verify the light tests fail** (placeholder equals dark → "no longer the dark placeholder" fails)

```bash
cd packages/tokens && bun run test
```

Expected: FAIL on `is no longer the dark placeholder` (and the AA cases, since the placeholder's dark values don't pass on dark surfaces inverted — any red here is fine at this step).

- [ ] **Step 3: Write the light palette**

`packages/tokens/src/themes/light.ts` (full file):

```ts
import type { TokenSet } from "../types";

/**
 * The Kaipu light theme. Derived from dark with the same hue relationships:
 * near-white neutral surfaces (slightly warm, matching dark's zinc cast),
 * the brand accent unchanged, semantic accents darkened one step for
 * contrast on light surfaces, and the CTA glow softened (the dark value is
 * calibrated for near-black backgrounds).
 * Every text/surface pair is WCAG-AA-guarded by contrast.test.ts.
 */
export const light: TokenSet = {
  "bg-app": "#fafafa",
  "bg-sidebar": "#f4f4f5",
  "bg-card": "#ffffff",
  "bg-card-hover": "#f4f4f5",
  "bg-input": "#ffffff",
  "bg-modal": "#ffffff",
  "bg-overlay": "rgba(9, 9, 11, 0.45)",
  "border": "#e4e4e7",
  "border-light": "#d4d4d8",
  "text-primary": "#18181b",
  "text-secondary": "#52525b",
  "text-muted": "#62626b",
  "accent-primary": "#f6055c",
  "accent-primary-hover": "#d4044f",
  "glow-accent": "0 10px 26px -8px rgba(246, 5, 92, 0.35)",
  "accent-green": "#16a34a",
  "accent-red": "#dc2626",
  "accent-red-hover": "#b91c1c",
  "accent-yellow": "#ca8a04",
  "accent-purple": "#9333ea",
};
```

Palette rationale (for the reviewer): surfaces map dark's ordering inverted (card lighter than app in dark → card whiter than app in light); `border-light` is _more_ prominent than `border` in both themes (lighter in dark, darker in light); `text-muted` `#62626b` keeps the palette's zinc cast and passes 4.5:1 on all six surfaces (worst case vs `#f4f4f5` ≈ 5.5:1, hand-computed). If the contrast test disagrees anywhere, darken the failing TEXT token and re-run — do NOT relax the test or lighten a surface.

- [ ] **Step 4: Regenerate CSS + run all tests**

```bash
cd packages/tokens && bun run generate && bun run test && bun run check-types
```

Expected: all tests pass (11 from PR1 + new contrast suite); drift test green against regenerated css/.

- [ ] **Step 5: Commit**

```bash
git add packages/tokens/src/themes/light.ts packages/tokens/src/contrast.test.ts packages/tokens/css
git commit -m "feat(tokens): real light palette, WCAG-AA-guarded by contrast tests"
```

---

### Task 2: Landing theme toggle (no-flash) + light-proofing the landing

**Files:**

- Create: `apps/web-hono/src/components/theme-toggle.tsx`
- Modify: `apps/web-hono/src/routes/__root.tsx` (inline pre-paint script + criticalStyles)
- Modify: `apps/web-hono/src/components/landing/landing-nav.tsx` (mount the toggle)
- Modify: `apps/web-hono/src/components/locale-switcher.tsx` (fix `border-white/15` → token)

**Interfaces:**

- Consumes: the `[data-theme="light"]` blocks from Task 1 (`--kaipu-*` flavor).
- Produces: `<ThemeToggle />` component; `data-theme` attribute contract on `<html>`; `localStorage` key `kaipu-theme` with values `"dark" | "light"` (absent = dark). PR3's desktop work reuses the same attribute contract (not this component).

- [ ] **Step 1: Create the toggle component**

`apps/web-hono/src/components/theme-toggle.tsx`:

```tsx
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "kaipu-theme";
type Theme = "dark" | "light";

let listeners: Array<() => void> = [];

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function setTheme(next: Theme) {
  // dark is the default: represented as NO attribute + no storage entry.
  if (next === "light") {
    document.documentElement.dataset.theme = "light";
    localStorage.setItem(STORAGE_KEY, "light");
  } else {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem(STORAGE_KEY);
  }
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void) {
  listeners.push(notify);
  return () => {
    listeners = listeners.filter((l) => l !== notify);
  };
}

/** Sun/moon button switching the landing's kaipu tokens via data-theme on <html>. */
export function ThemeToggle() {
  // SSR snapshot is "dark" (the default); the inline head script has already
  // applied any stored "light" before hydration, so the client snapshot agrees.
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "dark" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      onClick={() => setTheme(next)}
      className="rounded-md border border-[var(--kaipu-border)] p-1.5 text-[var(--kaipu-text-secondary)] transition hover:text-[var(--kaipu-text-primary)]"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
```

- [ ] **Step 2: Pre-paint script + theme-aware critical styles in `__root.tsx`**

2a. Replace the `criticalStyles` constant (currently hardcoding dark oklch on `html, body` — it would fight the light theme):

```ts
// Critical inline styles to prevent flash of unstyled content. Theme-aware:
// dark by default, flipped by the pre-paint script below via data-theme.
const criticalStyles = `
  html, body {
    background-color: oklch(14.5% 0 0);
    color: oklch(98.5% 0 0);
    margin: 0;
    padding: 0;
  }
  html[data-theme="light"], html[data-theme="light"] body {
    background-color: #fafafa;
    color: #18181b;
  }
`;

// Applies the stored theme before first paint (dark default, no flash for
// returning light-theme visitors). Must run before criticalStyles resolves.
const themeInitScript = `
  try {
    if (localStorage.getItem("kaipu-theme") === "light") {
      document.documentElement.dataset.theme = "light";
    }
  } catch {}
`;
```

2b. In `RootDocument`'s `<head>`, add the script BEFORE the critical styles:

```tsx
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style dangerouslySetInnerHTML={{ __html: criticalStyles }} />
        <HeadContent />
      </head>
```

Note: `<html className="dark" suppressHydrationWarning>` stays untouched — that class drives shadcn (app/auth routes), NOT the kaipu tokens; the landing keys only off `data-theme`.

- [ ] **Step 3: Mount the toggle in the landing nav**

In `apps/web-hono/src/components/landing/landing-nav.tsx`, import and place it next to the locale switcher:

```tsx
import { ThemeToggle } from "../theme-toggle";
```

```tsx
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <LocaleSwitcher />
```

- [ ] **Step 4: Light-proof the locale switcher**

In `apps/web-hono/src/components/locale-switcher.tsx`, replace `border-white/15` with the token (invisible on light backgrounds otherwise):

```
border-[var(--kaipu-border-light)]
```

(The two `text-white`-on-accent CTA buttons stay — white on `#f6055c` is correct in both themes.)

- [ ] **Step 5: Verify — build + manual smoke**

```bash
cd apps/web-hono
VITE_SERVER_URL=https://placeholder.example.com \
DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
bun run build
```

Expected: client+SSR build green. Then run dev and confirm by hand: landing loads dark (default), toggle flips every section instantly (nav, hero, features, download, footer), reload keeps light (no dark flash), locale switcher border visible in both, app/auth routes unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/web-hono/src/components/theme-toggle.tsx apps/web-hono/src/routes/__root.tsx \
  apps/web-hono/src/components/landing/landing-nav.tsx apps/web-hono/src/components/locale-switcher.tsx
git commit -m "feat(web): dark/light theme toggle on the landing (data-theme + pre-paint script)"
```

---

### Task 3: DX fix — stop vite-tsconfig-paths crawling agent worktrees

**Files:**

- Modify: `apps/web-hono/vite.config.ts:11`

**Interfaces:**

- Consumes/Produces: nothing shared — isolated DX fix. Context: unscoped `tsconfigPaths()` globs every `tsconfig.json` under the git root, including `.claude/worktrees/*` leftovers whose `extends: "@kaipu/config/tsconfig.base.json"` can't resolve there, crashing `bun run dev` with TSConfckParseError.

- [ ] **Step 1: Scope the plugin to the app's own tsconfig**

In `apps/web-hono/vite.config.ts`, change:

```ts
    tsconfigPaths(),
```

to:

```ts
    // Scope to this app's tsconfig — the default crawls every tsconfig under the
    // git root, including stale .claude/worktrees/* checkouts, which crashes dev.
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
```

- [ ] **Step 2: Verify dev boots and aliases resolve**

```bash
cd apps/web-hono
VITE_SERVER_URL=https://placeholder.example.com \
DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
bun run build
```

Expected: build green (the `@/` alias resolves via the scoped tsconfig). No `[tsconfig-paths]` errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web-hono/vite.config.ts
git commit -m "fix(web): scope vite-tsconfig-paths to the app tsconfig (stale worktrees crashed dev)"
```

---

### Task 4: Full verification + PR

- [ ] **Step 1: Full local verification (mirror CI)**

```bash
cd /Users/cristiansotomayor/Documents/Workspace/Personal/Niway/kaipu-record-monorepo
bun run lint
bunx oxfmt --check .
bun run build --filter='@kaipu/*'
bun run check-types
(cd packages/tokens && bun run test)
(cd apps/kaipu-record && bun run test)
```

Expected: every command exits 0. Desktop suite must stay 600/600 — this PR must not touch the desktop.

- [ ] **Step 2: Confirm zero desktop diff**

```bash
git diff feat/design-tokens-package..HEAD --stat -- apps/kaipu-record
```

Expected: empty output (only the shared package's light values changed; desktop renders dark exactly as before because nothing sets data-theme there).

- [ ] **Step 3: Push and open the PR (base = feat/design-tokens-package)**

```bash
git push -u origin feat/design-tokens-light-web
gh pr create --base feat/design-tokens-package \
  --title "feat(tokens): real light palette + landing theme toggle (PR2)" \
  --body "..."
```

PR body: summary (light palette WCAG-AA-guarded, landing toggle with pre-paint script, locale-switcher light-proofing, vite-tsconfig-paths DX fix), validation notes (owner reviews the light landing in the browser; contrast enforced by tests), and the PR chain note (PR2 of 3; base retargets to main when #38 merges).

- [ ] **Step 4: STOP — owner validates the light landing visually before merge; PR3 (desktop theme setting) starts only after.**
