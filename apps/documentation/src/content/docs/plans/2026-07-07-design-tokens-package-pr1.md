---
title: "Design tokens package — PR1 implementation plan"
description: "Build @kaipu/tokens (typed TS source → generated CSS, dark real + light placeholder) and switch the desktop app and web landing to consume it, with zero visual change."
---

# Design Tokens Package (PR1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `@kaipu/tokens` — one typed TS source of truth that generates the CSS custom properties consumed by the desktop app (unprefixed) and the web landing (`--kaipu-*` prefixed) — with zero visual change to either app.

**Architecture:** Token names live in `as const` arrays; `TokenSet` (`Record<ThemeTokenName, string>`) enforces dark/light parity at compile time. A ~80-line zero-dependency generator emits two committed CSS files guarded by a vitest drift test. Package follows `@kaipu/i18n`'s tsdown `devExports` pattern. Spec: [Design tokens package — design](/specs/2026-07-07-design-tokens-package-design/).

**Tech Stack:** Bun workspaces, tsdown (catalog), vitest ^4.1.9, TypeScript (catalog).

## Global Constraints

- Branch `feat/design-tokens-package` off `origin/main` — NOT off `ci/per-project-pipelines`.
- Zero visual change: PR1 ships `light.ts = { ...dark }` (placeholder); real light palette is PR2.
- No TS enums — `as const` arrays + `(typeof […])[number]` (repo rule).
- All code/comments in English (repo rule).
- Run `bunx oxfmt --check .` at repo root before every push; never `--no-verify`.
- Token values must be copied **verbatim** from `apps/kaipu-record/src/renderer/src/assets/base.css` — no reformatting, no normalization.
- `packages/tokens/css/**` is generated: excluded from oxfmt via `.oxfmtrc.json`, never hand-edited.
- vitest stays at `^4.1.9` (same as `@kaipu/i18n` — workspace vitest majors must match the app's).
- `gh` account for this repo: `csdev19` (`gh auth switch --user csdev19` if PR creation fails).

---

### Task 1: Branch + docs commits

The working tree currently holds uncommitted docs from this session (backlog status
corrections + the design spec). Land them as two commits on the new branch.

**Files:**

- Commit (group 1): `apps/documentation/src/content/docs/backlog/index.mdx`, `backlog/video-editor.md`, `backlog/playwright-e2e.mdx`, `backlog/i18n.md`, `backlog/shortcuts.mdx`, `backlog/fable-audit-results.md`
- Commit (group 2): `apps/documentation/src/content/docs/specs/2026-07-07-design-tokens-package-design.md`, `backlog/shared-tokens-package.md`, `apps/documentation/src/content/docs/plans/2026-07-07-design-tokens-package-pr1.md` (this file)

- [ ] **Step 1: Create the branch from origin/main**

```bash
git fetch origin
git checkout -b feat/design-tokens-package origin/main
```

Expected: branch created; the uncommitted docs changes carry over (they don't conflict — the CI branch didn't touch docs).

- [ ] **Step 2: Commit the backlog status sync**

```bash
git add apps/documentation/src/content/docs/backlog/index.mdx \
  apps/documentation/src/content/docs/backlog/video-editor.md \
  apps/documentation/src/content/docs/backlog/playwright-e2e.mdx \
  apps/documentation/src/content/docs/backlog/i18n.md \
  apps/documentation/src/content/docs/backlog/shortcuts.mdx \
  apps/documentation/src/content/docs/backlog/fable-audit-results.md
git commit -m "docs(backlog): sync statuses with main (12 shipped features were stale)"
```

- [ ] **Step 3: Commit the spec + plan**

```bash
git add apps/documentation/src/content/docs/specs/2026-07-07-design-tokens-package-design.md \
  apps/documentation/src/content/docs/backlog/shared-tokens-package.md \
  apps/documentation/src/content/docs/plans/2026-07-07-design-tokens-package-pr1.md
git commit -m "docs(tokens): design spec + PR1 plan for the shared design-tokens package"
```

---

### Task 2: Scaffold `@kaipu/tokens` with typed token sources

**Files:**

- Create: `packages/tokens/package.json`
- Create: `packages/tokens/tsconfig.json`
- Create: `packages/tokens/tsdown.config.ts`
- Create: `packages/tokens/vitest.config.ts`
- Create: `packages/tokens/src/types.ts`
- Create: `packages/tokens/src/base.ts`
- Create: `packages/tokens/src/themes/dark.ts`
- Create: `packages/tokens/src/themes/light.ts`
- Create: `packages/tokens/src/index.ts`
- Test: `packages/tokens/src/tokens.test.ts`

**Interfaces:**

- Produces: `BASE_TOKEN_NAMES`, `THEME_TOKEN_NAMES` (`as const` arrays), types `BaseTokenName`, `ThemeTokenName`, `BaseTokens`, `TokenSet`, and values `base: BaseTokens`, `dark: TokenSet`, `light: TokenSet` — all exported from `@kaipu/tokens` (src/index.ts). Task 3's generator consumes these exact names.

- [ ] **Step 1: Write the package scaffolding**

`packages/tokens/package.json`:

```json
{
  "name": "@kaipu/tokens",
  "version": "1.0.0",
  "description": "Kaipu design tokens: one typed TS source generating the CSS custom properties for desktop (unprefixed) and web (--kaipu-* prefixed), dark + light",
  "files": [
    "dist",
    "css",
    "src"
  ],
  "type": "module",
  "main": "./dist/index.mjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.mts",
  "sideEffects": [
    "**/*.css"
  ],
  "exports": {
    ".": "./src/index.ts",
    "./css": "./css/tokens.css",
    "./css/kaipu": "./css/tokens.kaipu.css",
    "./package.json": "./package.json"
  },
  "publishConfig": {
    "exports": {
      ".": "./dist/index.mjs",
      "./css": "./css/tokens.css",
      "./css/kaipu": "./css/tokens.kaipu.css",
      "./package.json": "./package.json"
    }
  },
  "scripts": {
    "build": "tsdown",
    "generate": "bun src/generate.ts",
    "check-types": "tsc --noEmit",
    "test": "vitest run",
    "lint": "oxlint src"
  },
  "devDependencies": {
    "@types/node": "^22.14.1",
    "tsdown": "catalog:",
    "typescript": "catalog:",
    "vitest": "^4.1.9"
  },
  "packageManager": "bun@1.3.4"
}
```

`packages/tokens/tsconfig.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

`packages/tokens/tsdown.config.ts`:

```ts
import { defineConfig } from "tsdown";

// Build the TS exports to `dist/` (used by `publishConfig`); `devExports: true`
// keeps the local monorepo `exports` pointed at source (same pattern as
// @kaipu/i18n). The CSS files are static exports generated by `bun run generate`
// and committed — tsdown never touches them, so re-add their subpaths.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  clean: true,

  exports: {
    devExports: true,
    customExports(exports) {
      exports["./css"] = "./css/tokens.css";
      exports["./css/kaipu"] = "./css/tokens.kaipu.css";
      return exports;
    },
  },
});
```

`packages/tokens/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write the failing test for token values + theme parity**

`packages/tokens/src/tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BASE_TOKEN_NAMES, THEME_TOKEN_NAMES, base, dark, light } from "./index";

describe("token sources", () => {
  it("dark carries the exact values from the desktop's base.css", () => {
    // Spot-check the brand-critical values verbatim (source of truth migration).
    expect(dark["accent-primary"]).toBe("#f6055c");
    expect(dark["bg-app"]).toBe("#0f0f11");
    expect(dark["text-primary"]).toBe("#e5e5e7");
    expect(dark["glow-accent"]).toBe("0 10px 26px -8px rgba(246, 5, 92, 0.75)");
  });

  it("base carries the theme-invariant values verbatim", () => {
    expect(base["space-md"]).toBe("12px");
    expect(base["radius-lg"]).toBe("8px");
    expect(base["titlebar-height"]).toBe("38px");
    expect(base["transition"]).toBe("150ms ease");
  });

  it("every declared token name has a value in every set", () => {
    // TokenSet already enforces this at compile time; this guards the arrays
    // and the objects against drifting apart at runtime too.
    for (const name of THEME_TOKEN_NAMES) {
      expect(dark[name], `dark.${name}`).toBeTruthy();
      expect(light[name], `light.${name}`).toBeTruthy();
    }
    for (const name of BASE_TOKEN_NAMES) {
      expect(base[name], `base.${name}`).toBeTruthy();
    }
  });

  it("light is the dark placeholder until PR2 designs the real palette", () => {
    expect(light).toEqual(dark);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/tokens && bun install && bun run test
```

Expected: FAIL — `Cannot find module './index'` (or equivalent resolution error).

- [ ] **Step 4: Write the token sources**

`packages/tokens/src/types.ts`:

```ts
/*
 * Canonical token names. The CSS custom property for a token is `--<name>`
 * (desktop) or `--kaipu-<name>` (web). Names are kebab-case string keys so the
 * TS objects, the generated CSS, and every `var(--…)` reference stay greppable
 * as one identifier.
 */

/** Theme-invariant tokens: spacing, radii, typography, layout, motion. */
export const BASE_TOKEN_NAMES = [
  "space-xs",
  "space-sm",
  "space-md",
  "space-lg",
  "space-xl",
  "space-2xl",
  "radius-sm",
  "radius-md",
  "radius-lg",
  "font-family",
  "font-mono",
  "font-size-xs",
  "font-size-sm",
  "font-size-base",
  "font-size-md",
  "font-size-lg",
  "font-size-xl",
  "font-weight-normal",
  "font-weight-medium",
  "font-weight-semibold",
  "sidebar-width",
  "titlebar-height",
  "transition",
  "transition-slow",
] as const;

/** Per-theme tokens: colors, overlays, glows. Every theme must define all of them. */
export const THEME_TOKEN_NAMES = [
  "bg-app",
  "bg-sidebar",
  "bg-card",
  "bg-card-hover",
  "bg-input",
  "bg-modal",
  "bg-overlay",
  "border",
  "border-light",
  "text-primary",
  "text-secondary",
  "text-muted",
  "accent-primary",
  "accent-primary-hover",
  "glow-accent",
  "accent-green",
  "accent-red",
  "accent-red-hover",
  "accent-yellow",
  "accent-purple",
] as const;

export type BaseTokenName = (typeof BASE_TOKEN_NAMES)[number];
export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

export type BaseTokens = Record<BaseTokenName, string>;

/** The full shape a theme must satisfy — a missing token is a compile error. */
export type TokenSet = Record<ThemeTokenName, string>;
```

`packages/tokens/src/base.ts` (values verbatim from `base.css`):

```ts
import type { BaseTokens } from "./types";

/** Theme-invariant tokens — identical in dark and light. */
export const base: BaseTokens = {
  "space-xs": "4px",
  "space-sm": "8px",
  "space-md": "12px",
  "space-lg": "16px",
  "space-xl": "24px",
  "space-2xl": "32px",
  "radius-sm": "4px",
  "radius-md": "5px",
  "radius-lg": "8px",
  "font-family":
    '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  "font-mono": '"Geist Mono", "SF Mono", "Fira Mono", "Cascadia Code", monospace',
  "font-size-xs": "11px",
  "font-size-sm": "12px",
  "font-size-base": "13px",
  "font-size-md": "14px",
  "font-size-lg": "16px",
  "font-size-xl": "20px",
  "font-weight-normal": "400",
  "font-weight-medium": "500",
  "font-weight-semibold": "600",
  "sidebar-width": "56px",
  "titlebar-height": "38px",
  "transition": "150ms ease",
  "transition-slow": "250ms ease",
};
```

`packages/tokens/src/themes/dark.ts` (values verbatim from `base.css`):

```ts
import type { TokenSet } from "../types";

/** The Kaipu dark theme — the app's original palette, migrated verbatim. */
export const dark: TokenSet = {
  "bg-app": "#0f0f11",
  "bg-sidebar": "#0c0c0e",
  "bg-card": "#171719",
  "bg-card-hover": "#1e1e21",
  "bg-input": "#1a1a1c",
  "bg-modal": "#131315",
  "bg-overlay": "rgba(0, 0, 0, 0.72)",
  "border": "#26262a",
  "border-light": "#32323a",
  "text-primary": "#e5e5e7",
  "text-secondary": "#a1a1aa",
  "text-muted": "#6b7280",
  "accent-primary": "#f6055c",
  "accent-primary-hover": "#d4044f",
  "glow-accent": "0 10px 26px -8px rgba(246, 5, 92, 0.75)",
  "accent-green": "#22c55e",
  "accent-red": "#ef4444",
  "accent-red-hover": "#dc2626",
  "accent-yellow": "#eab308",
  "accent-purple": "#a855f7",
};
```

`packages/tokens/src/themes/light.ts`:

```ts
import type { TokenSet } from "../types";
import { dark } from "./dark";

/**
 * PLACEHOLDER — light currently mirrors dark so the two-theme architecture
 * ships without visual change. The real light palette is designed in PR2
 * (see specs/2026-07-07-design-tokens-package-design).
 */
export const light: TokenSet = { ...dark };
```

`packages/tokens/src/index.ts`:

```ts
export {
  BASE_TOKEN_NAMES,
  THEME_TOKEN_NAMES,
  type BaseTokenName,
  type BaseTokens,
  type ThemeTokenName,
  type TokenSet,
} from "./types";
export { base } from "./base";
export { dark } from "./themes/dark";
export { light } from "./themes/light";
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd packages/tokens && bun run test && bun run check-types
```

Expected: 4 tests PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/tokens
git commit -m "feat(tokens): scaffold @kaipu/tokens with typed base + dark/light token sources"
```

---

### Task 3: The CSS generator

**Files:**

- Create: `packages/tokens/src/generate.ts`
- Test: `packages/tokens/src/generate.test.ts`

**Interfaces:**

- Consumes: `base`, `dark`, `light`, `BASE_TOKEN_NAMES`, `THEME_TOKEN_NAMES` from Task 2.
- Produces: `generateCss(prefix?: string): string` — full CSS file content (header + `:root` with dark+base + `[data-theme="light"]` block). `prefix` prepends to every var name (web uses `"kaipu-"`). Running the file directly (`bun src/generate.ts`) writes `css/tokens.css` and `css/tokens.kaipu.css`.

- [ ] **Step 1: Write the failing tests**

`packages/tokens/src/generate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateCss } from "./generate";
import { BASE_TOKEN_NAMES, THEME_TOKEN_NAMES } from "./types";

describe("generateCss", () => {
  const css = generateCss();
  const prefixed = generateCss("kaipu-");

  it("starts with the GENERATED header comment", () => {
    expect(css.startsWith("/*\n * GENERATED by @kaipu/tokens")).toBe(true);
  });

  it("emits every token under :root with the dark values", () => {
    expect(css).toContain(":root {");
    expect(css).toContain("  --bg-app: #0f0f11;");
    expect(css).toContain("  --accent-primary: #f6055c;");
    expect(css).toContain("  --space-md: 12px;");
    const declarations = css.match(/^ {2}--[a-z0-9-]+:/gm) ?? [];
    // :root declares theme + base once; the light block re-declares theme tokens.
    expect(declarations.length).toBe(
      THEME_TOKEN_NAMES.length * 2 + BASE_TOKEN_NAMES.length,
    );
  });

  it("emits the light theme as a [data-theme='light'] override of theme tokens only", () => {
    const lightBlock = css.slice(css.indexOf('[data-theme="light"]'));
    expect(lightBlock).toContain("  --bg-app:");
    expect(lightBlock).not.toContain("  --space-md:");
  });

  it("prefixes every custom property when a prefix is given", () => {
    expect(prefixed).toContain("  --kaipu-bg-app: #0f0f11;");
    expect(prefixed).toContain("  --kaipu-space-md: 12px;");
    expect(prefixed).not.toMatch(/^ {2}--(?!kaipu-)/m);
  });

  it("ends with a trailing newline (POSIX file)", () => {
    expect(css.endsWith("}\n")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/tokens && bun run test
```

Expected: FAIL — `Cannot find module './generate'`.

- [ ] **Step 3: Implement the generator**

`packages/tokens/src/generate.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { base } from "./base";
import { dark } from "./themes/dark";
import { light } from "./themes/light";
import { BASE_TOKEN_NAMES, THEME_TOKEN_NAMES } from "./types";

const HEADER = `/*
 * GENERATED by @kaipu/tokens — do not edit by hand.
 * Edit src/base.ts or src/themes/*.ts, then run \`bun run generate\` here.
 * Dark is the default (:root); [data-theme="light"] overrides theme tokens.
 */`;

/**
 * Render the full tokens stylesheet. `prefix` is prepended to every custom
 * property name — the desktop consumes the unprefixed flavor, the web consumes
 * `kaipu-` so it can never shadow web-ui's shadcn variables.
 */
export function generateCss(prefix = ""): string {
  const declare = (name: string, value: string) => `  --${prefix}${name}: ${value};`;

  const rootLines = [
    ...THEME_TOKEN_NAMES.map((name) => declare(name, dark[name])),
    ...BASE_TOKEN_NAMES.map((name) => declare(name, base[name])),
  ];
  const lightLines = THEME_TOKEN_NAMES.map((name) => declare(name, light[name]));

  return [
    HEADER,
    "",
    ":root {",
    ...rootLines,
    "}",
    "",
    '[data-theme="light"] {',
    ...lightLines,
    "}",
    "",
  ].join("\n");
}

if (import.meta.main) {
  const outDir = fileURLToPath(new URL("../css/", import.meta.url));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}tokens.css`, generateCss());
  writeFileSync(`${outDir}tokens.kaipu.css`, generateCss("kaipu-"));
  console.log("Wrote css/tokens.css and css/tokens.kaipu.css");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/tokens && bun run test && bun run check-types
```

Expected: all tests PASS (Task 2's included); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add packages/tokens/src/generate.ts packages/tokens/src/generate.test.ts
git commit -m "feat(tokens): CSS generator — one TS source, unprefixed + --kaipu-* flavors"
```

---

### Task 4: Generate + commit the CSS, drift guard, oxfmt exclusion

**Files:**

- Create (generated): `packages/tokens/css/tokens.css`, `packages/tokens/css/tokens.kaipu.css`
- Modify: `.oxfmtrc.json`
- Test: `packages/tokens/src/drift.test.ts`

**Interfaces:**

- Produces: the two committed CSS files that Tasks 5–6 `@import`. Export paths: `@kaipu/tokens/css` and `@kaipu/tokens/css/kaipu`.

- [ ] **Step 1: Write the failing drift test**

`packages/tokens/src/drift.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateCss } from "./generate";

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../css/${file}`, import.meta.url)), "utf8");

describe("committed CSS is in sync with the TS sources", () => {
  // If these fail: run `bun run generate` in packages/tokens and commit css/.
  it("css/tokens.css matches generateCss()", () => {
    expect(read("tokens.css")).toBe(generateCss());
  });

  it("css/tokens.kaipu.css matches generateCss('kaipu-')", () => {
    expect(read("tokens.kaipu.css")).toBe(generateCss("kaipu-"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/tokens && bun run test
```

Expected: drift tests FAIL — `ENOENT … css/tokens.css` (not generated yet).

- [ ] **Step 3: Generate the CSS and exclude it from oxfmt**

```bash
cd packages/tokens && bun run generate
```

In `.oxfmtrc.json`, add the generated dir to `ignorePatterns` (generated files are
excluded like `routeTree.gen.ts` / `CHANGELOG.md`):

```json
    "**/CHANGELOG.md",
    "packages/tokens/css/**",
```

(insert the new line right after `"**/CHANGELOG.md",`.)

- [ ] **Step 4: Run tests + format check to verify green**

```bash
cd packages/tokens && bun run test
cd ../.. && bunx oxfmt --check .
```

Expected: all tokens tests PASS (including drift); oxfmt reports no issues.

- [ ] **Step 5: Commit**

```bash
git add packages/tokens/css packages/tokens/src/drift.test.ts .oxfmtrc.json
git commit -m "feat(tokens): generated CSS (committed) + drift guard + oxfmt exclusion"
```

---

### Task 5: Desktop consumes `@kaipu/tokens` (zero visual change)

**Files:**

- Modify: `apps/kaipu-record/package.json` (add dependency)
- Modify: `apps/kaipu-record/src/renderer/src/assets/base.css:1-73` (replace the `:root` token block with the package import)
- Modify: `.github/workflows/ci-desktop.yml:46-47` (stale comment)

**Interfaces:**

- Consumes: `@kaipu/tokens/css` from Task 4.
- Produces: nothing new — every existing `var(--token)` in the desktop's CSS modules keeps resolving to the identical value.

- [ ] **Step 1: Add the workspace dependency**

In `apps/kaipu-record/package.json` `dependencies`, next to `"@kaipu/i18n": "workspace:*"`, add:

```json
    "@kaipu/tokens": "workspace:*",
```

Then from the repo root:

```bash
bun install
```

- [ ] **Step 2: Replace base.css's `:root` block with the import**

In `apps/kaipu-record/src/renderer/src/assets/base.css`, replace everything from the
opening file comment through the closing `}` of the `:root` block (lines 1–73 — the
comment plus the whole `:root { … }`) with:

```css
/*
 * Kaipu base styles.
 * Design tokens come from @kaipu/tokens — the single source of truth shared
 * with the web landing. Edit packages/tokens/src, not CSS, to change a token.
 * All components reference tokens via var(--token).
 */
@import "@kaipu/tokens/css";
```

Everything after the old `:root` block (the `*, *::before, *::after` reset, body
styles, scrollbar theming, …) stays byte-identical.

- [ ] **Step 3: Update the stale CI comment**

In `.github/workflows/ci-desktop.yml`, replace:

```yaml
      # kaipu-record's only workspace dep is @kaipu/i18n, resolved from source
      # (tsdown devExports), so the vitest suite needs no package build first.
```

with:

```yaml
      # kaipu-record's workspace deps (@kaipu/i18n, @kaipu/tokens) resolve from
      # source (tsdown devExports) + committed CSS — no package build needed.
```

- [ ] **Step 4: Verify — unit tests, build, and token presence in the bundle**

```bash
cd apps/kaipu-record && bun run test && bun run build
grep -rl "accent-primary: #f6055c" out/ | head -1
```

Expected: full desktop suite PASSES (600/600); build succeeds; grep finds at least
one bundled CSS file containing the token (proves Vite resolved the package
`@import` and inlined identical values).

- [ ] **Step 5: Commit**

```bash
git add apps/kaipu-record/package.json apps/kaipu-record/src/renderer/src/assets/base.css .github/workflows/ci-desktop.yml bun.lock
git commit -m "refactor(desktop): consume design tokens from @kaipu/tokens (zero visual change)"
```

---

### Task 6: Web consumes `@kaipu/tokens` (zero visual change)

**Files:**

- Modify: `apps/web-hono/package.json` (add dependency)
- Modify: `apps/web-hono/src/index.css` (replace the hand-mirror with the prefixed import)
- Modify (rename `--kaipu-accent` → `--kaipu-accent-primary`, `--kaipu-accent-hover` → `--kaipu-accent-primary-hover`): `apps/web-hono/src/components/landing/landing-nav.tsx:9,15`, `landing/footer.tsx:8`, `landing/hero.tsx:10`, `landing/features.tsx:21`, `landing/download-buttons.tsx:12`

**Interfaces:**

- Consumes: `@kaipu/tokens/css/kaipu` from Task 4.
- Produces: the landing now reads generated `--kaipu-*` vars; the two divergent mirror names are gone.

- [ ] **Step 1: Add the workspace dependency**

In `apps/web-hono/package.json` `dependencies`, next to the other `@kaipu/*` entries, add:

```json
    "@kaipu/tokens": "workspace:*",
```

Then from the repo root: `bun install`.

- [ ] **Step 2: Replace the mirror block in index.css**

Replace the entire contents of `apps/web-hono/src/index.css` (the web-ui import +
the explanatory comment + the `:root { --kaipu-* }` mirror) with:

```css
@import "@kaipu/web-ui/styles.css";
/*
 * Kaipu brand tokens, generated by @kaipu/tokens (shared with the desktop app).
 * The --kaipu- prefix keeps them from ever shadowing web-ui's shadcn variables
 * (--border, --primary, …) used by the app/auth routes.
 */
@import "@kaipu/tokens/css/kaipu";
```

- [ ] **Step 3: Rename the two divergent var names in the landing (hover FIRST — its name contains the other)**

```bash
cd apps/web-hono/src
grep -rl -- "--kaipu-accent" . | xargs sed -i '' \
  -e 's/--kaipu-accent-hover/--kaipu-accent-primary-hover/g' \
  -e 's/--kaipu-accent)/--kaipu-accent-primary)/g'
grep -rn -- "--kaipu-accent" . | grep -v "accent-primary"
```

Expected: the final grep prints **nothing** (no stragglers with the old names).

- [ ] **Step 4: Verify — web build**

```bash
cd apps/web-hono
VITE_SERVER_URL=https://placeholder.example.com \
DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
bun run build
grep -rl "kaipu-accent-primary: #f6055c" dist/ | head -1
```

Expected: build succeeds; grep finds a bundled CSS file with the prefixed token.

- [ ] **Step 5: Commit**

```bash
git add apps/web-hono bun.lock
git commit -m "refactor(web): consume design tokens from @kaipu/tokens (drop the hand-mirror)"
```

---

### Task 7: CI drift guard + full verification + PR

**Files:**

- Modify: `.github/workflows/ci.yml` (add a tokens-test step to the universal compile job)

**Interfaces:**

- Consumes: everything above.
- Produces: PR `feat(tokens)` targeting `main`.

- [ ] **Step 1: Add the drift check to the universal CI job**

In `.github/workflows/ci.yml`, right after the `- name: Build packages` step, add:

```yaml
      - name: Design-tokens drift check
        working-directory: packages/tokens
        run: bun run test
```

(The drift test is a build-integrity guard — it belongs in the universal job, not a
per-project suite: any PR that edits token TS without regenerating must fail fast.)

- [ ] **Step 2: Full local verification (mirror CI)**

```bash
cd /Users/cristiansotomayor/Documents/Workspace/Personal/Niway/kaipu-record-monorepo
bun run lint
bunx oxfmt --check .
bun run build --filter='@kaipu/*'
bun run check-types
(cd packages/tokens && bun run test)
(cd apps/kaipu-record && bun run test)
```

Expected: every command exits 0. If oxfmt flags files, run `bun run format` and re-check.

- [ ] **Step 3: Commit the CI change**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the design-tokens drift check in the universal compile job"
```

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/design-tokens-package
gh pr create --title "feat(tokens): shared @kaipu/tokens design-tokens package (PR1 — dark, zero visual change)" --body "$(cat <<'EOF'
## Summary
- New `@kaipu/tokens` package: one typed TS source of truth (dark real + light placeholder) generating the CSS custom properties both apps consume
- Desktop: `base.css` `:root` block replaced by `@import "@kaipu/tokens/css"` — same names, same values, zero churn in CSS modules
- Web: hand-mirrored `--kaipu-*` block replaced by the generated prefixed flavor; 2 divergent names renamed (`--kaipu-accent[-hover]` → `--kaipu-accent-primary[-hover]`)
- Drift test guards the committed generated CSS; wired into universal CI

PR1 of 3 — spec: `specs/2026-07-07-design-tokens-package-design`. PR2 = real light palette + landing toggle; PR3 = desktop theme setting.

## Validation
Pure refactor — both apps must render byte-identical. Desktop 600/600 unit tests, E2E, and both app builds green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If `gh` fails with "Could not resolve to a Repository": `gh auth switch --user csdev19` and retry.

- [ ] **Step 5: STOP — owner validation gate**

Per the owner's workflow: one PR at a time. Do not start PR2 (light palette) until
this PR is reviewed, validated (visual spot-check of desktop + landing), and merged.
