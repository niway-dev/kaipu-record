---
title: "Design tokens — PR3 implementation plan (desktop theme setting)"
description: "Light/dark theme setting for the desktop app: narrow the existing AppSettings.theme to dark|light, apply data-theme in every window via the shared renderer root, add a Settings page selector, and guard non-text accent contrast in the tokens package."
---

# Design Tokens PR3 — Desktop Theme Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the third and final PR of the design-tokens project: a persisted `dark | light` theme setting in the desktop app that re-themes every open window instantly, plus the tokens-package pre-flight fixes (light `accent-yellow` contrast + a non-text contrast guard).

**Architecture:** The settings backend for `theme` ALREADY EXISTS end-to-end (type, default, validation in `mergeSettings`, disk persistence, `settings:get`/`settings:update` IPC, and `settings:changed` broadcast to every `BrowserWindow`) — it shipped with the settings-store rework and was never surfaced. This PR (a) narrows the stored type from `"light" | "dark" | "system"` to `"light" | "dark"` per the spec (system is an explicit non-goal follow-up), (b) applies `document.documentElement.dataset.theme` in the ONE shared renderer root (`I18nRoot`, mounted by `main.tsx` for all 4 windows), and (c) adds a `ThemeSettings` selector to the Settings page. The tokens CSS (`@kaipu/tokens/css`, imported by `base.css` → `main.css` → `main.tsx`) already ships the `[data-theme="light"]` block in every window, so no CSS wiring is needed.

**Tech Stack:** Electron (main/preload/renderer), React 19, Vitest + Testing Library (jsdom), `@kaipu/tokens` (tsdown package with generated committed CSS), `@kaipu/i18n` message catalogs.

**Spec:** `apps/documentation/src/content/docs/specs/2026-07-07-design-tokens-package-design.md` (see "Theming model → Desktop (PR3)" and "Light palette constraints").

## Global Constraints

- **No TS enums.** Use `as const` arrays + `(typeof X)[number]` unions (repo rule).
- **Code, comments, and docs are English-only.** End-user UI copy is neutral Spanish (no voseo), friendly.
- **i18n parity:** every key added to `packages/i18n/messages/es.json` must also land in `en.json` (enforced by `packages/i18n/src/__tests__/parity.test.ts`).
- **Generated CSS:** after editing `packages/tokens/src/themes/*.ts`, run `bun run generate` in `packages/tokens/` and commit the regenerated `css/*.css` — the drift test diffs them byte-exact in CI.
- **Before every push:** `bunx oxfmt --check .` from the repo root must pass. Never `--no-verify`.
- **Dark stays the default.** Dark = NO `data-theme` attribute (the tokens' `:root` block); only `"light"` sets the attribute.
- **Do NOT "fix" dark palette values.** Dark `text-muted` (#6b7280, ~3.9:1) is documented pre-existing debt outside this PR's scope.

---

### Task 1: Tokens pre-flight — non-text accent contrast guard + light accent-yellow fix

The light `accent-yellow` (#ca8a04) only reaches ~2.8:1 against the light surfaces — below the WCAG 1.4.11 non-text minimum of 3:1. Add the missing guard first (TDD), watch it fail, then darken the token and regenerate the CSS.

**Files:**
- Modify: `packages/tokens/src/contrast.test.ts`
- Modify: `packages/tokens/src/themes/light.ts` (line 30: `"accent-yellow": "#ca8a04"`)
- Regenerate: `packages/tokens/css/tokens.css`, `packages/tokens/css/tokens.kaipu.css` (via `bun run generate` — NEVER hand-edit)

**Interfaces:**
- Consumes: `light`/`dark` `TokenSet` objects and the existing `contrast()` helper in `contrast.test.ts`.
- Produces: nothing consumed by later tasks (independent pre-flight).

- [ ] **Step 1: Write the failing non-text contrast test**

Add inside the existing `describe("light theme", ...)` block in `packages/tokens/src/contrast.test.ts`, after the AA `it.each` (line 46):

```ts
  // Semantic accents are non-text UI (status dots, badges, icons) — WCAG 1.4.11
  // non-text contrast: >= 3:1 against the surfaces they sit on. bg-app and
  // bg-card cover the distinct light surface values (#fafafa / #ffffff).
  const SEMANTIC_ACCENTS = [
    "accent-primary",
    "accent-green",
    "accent-red",
    "accent-yellow",
    "accent-purple",
  ] as const;
  const ACCENT_SURFACES = ["bg-app", "bg-card"] as const;

  it.each(SEMANTIC_ACCENTS.flatMap((a) => ACCENT_SURFACES.map((s) => [a, s] as const)))(
    "light %s on %s meets WCAG non-text contrast (3:1)",
    (accent, surface) => {
      expect(contrast(light[accent], light[surface])).toBeGreaterThanOrEqual(3);
    },
  );
```

- [ ] **Step 2: Run the test to verify it fails on accent-yellow only**

Run: `cd packages/tokens && bun run test`
Expected: FAIL — exactly the two `accent-yellow` cases (`on bg-app`, `on bg-card`) are below 3; all other accent/surface pairs PASS. If any OTHER pair fails, stop and report — do not tweak other token values silently.

- [ ] **Step 3: Darken the light accent-yellow**

In `packages/tokens/src/themes/light.ts`, change line 30:

```ts
  "accent-yellow": "#a16207",
```

(#a16207 measures ~4.7:1 on #fafafa and ~4.9:1 on #ffffff — comfortably above the 3:1 bar, and stays in the same amber family as dark's yellow.)

- [ ] **Step 4: Regenerate the committed CSS**

Run: `cd packages/tokens && bun run generate`
Expected: `Wrote css/tokens.css and css/tokens.kaipu.css`; `git diff --stat` shows both css files changed (the `--accent-yellow` line in the `[data-theme="light"]` block).

- [ ] **Step 5: Run the full tokens suite (drift + contrast) to verify green**

Run: `cd packages/tokens && bun run test`
Expected: PASS — all tests including `drift.test.ts` (regenerated CSS matches) and the new 10 non-text assertions.

- [ ] **Step 6: Commit**

```bash
git add packages/tokens/src/contrast.test.ts packages/tokens/src/themes/light.ts packages/tokens/css/tokens.css packages/tokens/css/tokens.kaipu.css
git commit -m "fix(tokens): light accent-yellow meets non-text contrast; add the 3:1 guard"
```

---

### Task 2: Narrow `Theme` to `"light" | "dark"` (default dark)

The stored type currently includes `"system"` (default `"system"`), but the spec ships `dark | light` only — `system` is an explicit non-goal follow-up, and the tokens have no `prefers-color-scheme` block, so `"system"` could never render as anything but dark. Narrow the type; persisted `"system"` values from existing installs coerce to `"dark"` through `mergeSettings` (visually identical — theme was never applied before this PR).

**Files:**
- Modify: `apps/kaipu-record/src/shared/types/ipc.ts` (line 13 `Theme`, line 122 `DEFAULT_SETTINGS.theme`)
- Modify: `apps/kaipu-record/src/main/services/settings.service.ts` (line 21 `VALID_THEMES`)
- Modify: `apps/kaipu-record/src/main/services/settings.service.test.ts` (lines 6-18)
- Modify: `apps/kaipu-record/src/renderer/src/pages/settings/use-app-settings.test.tsx` (lines 8, 53-54)
- Modify: `apps/kaipu-record/src/renderer/src/test/setup.ts` (line 45 `STUB_SETTINGS.theme`)

**Interfaces:**
- Consumes: existing `Theme`, `AppSettings`, `DEFAULT_SETTINGS`, `isValidTheme`, `mergeSettings`.
- Produces: `Theme = "light" | "dark"` with `DEFAULT_SETTINGS.theme === "dark"` — Tasks 3 and 4 rely on this exact union and default.

- [ ] **Step 1: Update the theme tests to the narrowed contract (failing first)**

In `apps/kaipu-record/src/main/services/settings.service.test.ts`, replace the `isValidTheme` describe (lines 6-18) with:

```ts
describe("isValidTheme", () => {
  it("accepts the known themes", () => {
    expect(isValidTheme("light")).toBe(true);
    expect(isValidTheme("dark")).toBe(true);
  });

  it("rejects unknown or non-string values", () => {
    // "system" is a legacy stored value from builds that declared but never
    // applied it — it must coerce to the dark default via mergeSettings.
    expect(isValidTheme("system")).toBe(false);
    expect(isValidTheme("blue")).toBe(false);
    expect(isValidTheme(undefined)).toBe(false);
    expect(isValidTheme(42)).toBe(false);
  });
});
```

And add inside `describe("mergeSettings", ...)`, after the "keeps valid stored values" test (line 54):

```ts
  it("coerces a legacy persisted \"system\" theme to the dark default", () => {
    expect(mergeSettings({ theme: "system" as never }).theme).toBe("dark");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/kaipu-record && bunx vitest run src/main/services/settings.service.test.ts`
Expected: FAIL — `isValidTheme("system")` returns `true` (still accepted) and the coercion test gets `"system"` instead of `"dark"`.

- [ ] **Step 3: Narrow the type, default, and validator**

In `apps/kaipu-record/src/shared/types/ipc.ts`, replace line 13:

```ts
/**
 * "system" (follow the OS appearance) is a deliberate non-goal for now — the
 * tokens ship dark (:root default) + light only. Legacy persisted "system"
 * values coerce to "dark" in mergeSettings.
 */
export type Theme = "light" | "dark";
```

And in `DEFAULT_SETTINGS` (line 122): `theme: "dark",`

In `apps/kaipu-record/src/main/services/settings.service.ts`, line 21:

```ts
const VALID_THEMES: readonly Theme[] = ["light", "dark"];
```

- [ ] **Step 4: Fix the two renderer test fixtures that used "system"**

In `apps/kaipu-record/src/renderer/src/test/setup.ts` line 45 and `apps/kaipu-record/src/renderer/src/pages/settings/use-app-settings.test.tsx` line 8, change `theme: "system",` → `theme: "dark",`.

In `use-app-settings.test.tsx`, the broadcast test (lines 53-54) becomes a no-op once the fixture is dark — flip it to light:

```ts
    act(() => subscriber?.({ ...SETTINGS, theme: "light" }));
    expect(result.current.settings?.theme).toBe("light");
```

- [ ] **Step 5: Sweep for any remaining theme-"system" references**

Run: `grep -rn '"system"' apps/kaipu-record/src --include='*.ts' --include='*.tsx'`
Expected: no remaining hits that refer to the `Theme` type (hits about unrelated strings are fine — inspect each). Then run the full desktop suite and typecheck:

Run: `cd apps/kaipu-record && bunx vitest run && bun run typecheck`
Expected: PASS, 0 type errors (typecheck runs both the node and web tsconfigs).

- [ ] **Step 6: Commit**

```bash
git add apps/kaipu-record/src/shared/types/ipc.ts apps/kaipu-record/src/main/services/settings.service.ts apps/kaipu-record/src/main/services/settings.service.test.ts apps/kaipu-record/src/renderer/src/pages/settings/use-app-settings.test.tsx apps/kaipu-record/src/renderer/src/test/setup.ts
git commit -m "refactor(desktop): narrow Theme to light|dark with dark default"
```

---

### Task 3: `applyTheme` + wiring in the shared renderer root

One mount point covers every window: `main.tsx` wraps ALL four render targets (main window, `?window=control-bar`, `?window=camera-bubble`, `?mode=capture`) in `await I18nRoot(...)`, which already awaits `getSettings()` and subscribes to `settings:changed`. Theme application slots in next to `syncLocale`.

**Files:**
- Create: `apps/kaipu-record/src/renderer/src/lib/apply-theme.ts`
- Create: `apps/kaipu-record/src/renderer/src/lib/apply-theme.test.ts`
- Modify: `apps/kaipu-record/src/renderer/src/app/i18n-root.tsx`
- Create: `apps/kaipu-record/src/renderer/src/app/i18n-root.test.tsx`

**Interfaces:**
- Consumes: `Theme` (`"light" | "dark"`) from `@shared/types` (Task 2); `window.electronAPI.getSettings/onSettingsChanged` (existing).
- Produces: `applyTheme(theme: Theme): void` — Task 4's review notes reference it, but no later code imports it outside `i18n-root.tsx`.

- [ ] **Step 1: Write the failing applyTheme test**

Create `apps/kaipu-record/src/renderer/src/lib/apply-theme.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme } from "./apply-theme";

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe("applyTheme", () => {
  it("sets data-theme=\"light\" for the light theme", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("removes the attribute for dark — the :root default must render with no attribute", () => {
    applyTheme("light");
    applyTheme("dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/lib/apply-theme.test.ts`
Expected: FAIL — `Cannot find module './apply-theme'` (or equivalent resolution error).

- [ ] **Step 3: Implement applyTheme**

Create `apps/kaipu-record/src/renderer/src/lib/apply-theme.ts`:

```ts
import type { Theme } from "@shared/types";

/**
 * Reflect the persisted theme on <html> so the tokens' [data-theme="light"]
 * block (from @kaipu/tokens/css, reached by every window through base.css)
 * takes effect. Dark is the :root default and is represented as NO attribute,
 * keeping dark markup identical to pre-theming builds.
 */
export function applyTheme(theme: Theme): void {
  if (theme === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/lib/apply-theme.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing I18nRoot wiring test**

Create `apps/kaipu-record/src/renderer/src/app/i18n-root.test.tsx`. `I18nRoot` is a plain async function, so its element can be inspected without mounting; the `@kaipu/i18n` mock in `test/setup.ts` is irrelevant here because we only touch the element's props.

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppSettings, DEFAULT_SHORTCUTS } from "@shared/types";
import { DEFAULT_QUALITY } from "@shared/recording-quality";
import { I18nRoot } from "./i18n-root";

const SETTINGS: AppSettings = {
  theme: "dark",
  locale: "es",
  launchAtLogin: false,
  showInDock: true,
  recordingQuality: DEFAULT_QUALITY,
  showBarInRecording: false,
  shortcuts: DEFAULT_SHORTCUTS,
  deviceId: "",
};

describe("I18nRoot theme application", () => {
  beforeEach(() => {
    window.electronAPI.getSettings = vi.fn(async () => SETTINGS);
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("applies the persisted theme before the provider mounts", async () => {
    window.electronAPI.getSettings = vi.fn(async () => ({ ...SETTINGS, theme: "light" as const }));
    await I18nRoot({ children: null });
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("leaves dark with no data-theme attribute", async () => {
    await I18nRoot({ children: null });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("re-applies the theme when a settings broadcast arrives", async () => {
    let broadcast: ((settings: AppSettings) => void) | null = null;
    window.electronAPI.onSettingsChanged = ((callback: (settings: AppSettings) => void) => {
      broadcast = callback;
      return () => {};
    }) as typeof window.electronAPI.onSettingsChanged;

    const element = await I18nRoot({ children: null });
    // The provider calls subscribeExternal on mount; invoke it directly since
    // we never mount. `apply` only needs to accept the locale.
    (element.props as { subscribeExternal: (apply: (locale: string) => void) => void })
      .subscribeExternal(() => {});
    broadcast?.({ ...SETTINGS, theme: "light" });
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/app/i18n-root.test.tsx`
Expected: FAIL — the two light assertions get `undefined`/`true` (theme never applied); the dark test may already pass.

- [ ] **Step 7: Wire applyTheme into I18nRoot**

In `apps/kaipu-record/src/renderer/src/app/i18n-root.tsx`:

Add the import (after line 5):

```ts
import { applyTheme } from "@renderer/lib/apply-theme";
```

After `syncLocale(settings.locale);` (line 24) add:

```ts
  applyTheme(settings.theme);
```

And extend the `subscribeExternal` callback (lines 34-39) to:

```tsx
      subscribeExternal={(apply) =>
        window.electronAPI.onSettingsChanged((s) => {
          syncLocale(s.locale);
          applyTheme(s.theme);
          apply(s.locale);
        })
      }
```

Also extend the file's top doc comment (lines 7-14) with one line so the next reader knows this is the theme mount point too:

```
 * It is the single per-window root (main.tsx wraps every render target in it),
 * so applying the persisted theme here covers all four windows.
```

- [ ] **Step 8: Run the wiring test + full renderer suite**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/app/i18n-root.test.tsx && bunx vitest run`
Expected: PASS (3 new tests; no regressions).

- [ ] **Step 9: Commit**

```bash
git add apps/kaipu-record/src/renderer/src/lib/apply-theme.ts apps/kaipu-record/src/renderer/src/lib/apply-theme.test.ts apps/kaipu-record/src/renderer/src/app/i18n-root.tsx apps/kaipu-record/src/renderer/src/app/i18n-root.test.tsx
git commit -m "feat(desktop): apply the persisted theme in every window via the shared root"
```

---

### Task 4: ThemeSettings selector on the Settings page (+ i18n keys)

Mirror `language-settings.tsx` exactly, but theme has no React provider — the component takes `theme` + `onChange` props (the `RecordingQualitySettings` prop pattern) and the page wires them to `useAppSettings()`. `update({ theme })` triggers the main-process broadcast, which re-themes every window including this one (via Task 3's subscription) — no local `applyTheme` call in the component.

**Files:**
- Modify: `packages/i18n/messages/es.json` (settings namespace, after `"english"` line 73)
- Modify: `packages/i18n/messages/en.json` (settings namespace, after `"english"` line 73)
- Create: `apps/kaipu-record/src/renderer/src/pages/settings/theme-settings.tsx`
- Create: `apps/kaipu-record/src/renderer/src/pages/settings/theme-settings.test.tsx`
- Modify: `apps/kaipu-record/src/renderer/src/pages/settings/settings-page.tsx` (imports, stale comment lines 22-35, new Section after Language line 80-82)
- Modify: `apps/kaipu-record/src/renderer/src/pages/settings/settings-page.test.tsx` (add the Theme heading to the wired-sections test)

**Interfaces:**
- Consumes: `Theme` from `@shared/types` (Task 2); `useAppSettings()` (`{ settings, update }`, existing); `Row`/`Button` from `@renderer/ui`; `useTranslations("settings")`.
- Produces: `ThemeSettings({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void })` — consumed only by `settings-page.tsx` in this same task.

- [ ] **Step 1: Add the i18n keys (both catalogs — parity test enforces it)**

In `packages/i18n/messages/es.json`, inside `"settings"`, after `"english": "Inglés",` (line 73) add:

```json
    "theme": "Tema",
    "themeDescription": "Elige la apariencia de la aplicación.",
    "themeDark": "Oscuro",
    "themeLight": "Claro",
```

In `packages/i18n/messages/en.json`, same position (after line 73):

```json
    "theme": "Theme",
    "themeDescription": "Choose the app appearance.",
    "themeDark": "Dark",
    "themeLight": "Light",
```

Run: `cd packages/i18n && bun run test`
Expected: PASS (parity holds).

- [ ] **Step 2: Write the failing component test**

Create `apps/kaipu-record/src/renderer/src/pages/settings/theme-settings.test.tsx` (the setup mock resolves `t()` against the real English catalog, so assert "Dark"/"Light"):

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeSettings } from "./theme-settings";

describe("ThemeSettings", () => {
  it("renders both theme options", () => {
    render(<ThemeSettings theme="dark" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
  });

  it("reports the picked theme", () => {
    const onChange = vi.fn();
    render(<ThemeSettings theme="dark" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(onChange).toHaveBeenCalledWith("light");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/pages/settings/theme-settings.test.tsx`
Expected: FAIL — module `./theme-settings` not found.

- [ ] **Step 4: Implement ThemeSettings**

Create `apps/kaipu-record/src/renderer/src/pages/settings/theme-settings.tsx`:

```tsx
import React from "react";
import { useTranslations } from "@kaipu/i18n";
import type { Theme } from "@shared/types";
import { Row } from "@renderer/ui/row";
import { Button } from "@renderer/ui/button";

/** Theme picker — writes AppSettings.theme; every window re-themes via the settings broadcast. */
export function ThemeSettings({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}): React.JSX.Element {
  const t = useTranslations("settings");

  const options: ReadonlyArray<{ value: Theme; label: string }> = [
    { value: "dark", label: t("themeDark") },
    { value: "light", label: t("themeLight") },
  ];

  return (
    <Row
      label={t("themeDescription")}
      action={
        <div style={{ display: "flex", gap: 8 }}>
          {options.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={theme === option.value ? "primary" : "outline"}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      }
    />
  );
}
```

- [ ] **Step 5: Run the component test to verify it passes**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/pages/settings/theme-settings.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Mount it on the Settings page and retire the stale comment**

In `apps/kaipu-record/src/renderer/src/pages/settings/settings-page.tsx`:

Add the import after line 12 (`LanguageSettings`):

```ts
import { ThemeSettings } from "./theme-settings";
```

Replace the page comment (lines 22-35) with — theme moves from the "absent" list to the wired list:

```ts
/*
 * This page intentionally only surfaces settings that are wired end-to-end:
 *   • Permissions       → window.electronAPI permission bridge
 *   • Recording quality → persisted AppSettings.recordingQuality → encoder
 *   • Theme             → persisted AppSettings.theme → data-theme in every window
 *   • Files             → real on-disk recordings vault
 *   • App / Onboarding  → Dock policy, replay the first-run flow
 *
 * Configurable keyboard shortcuts now ship as their own sidebar page (Shortcuts).
 * Device pickers are still absent because no backend wiring exists for them yet —
 * they were inert local state. They are tracked in the backlog:
 *   apps/documentation/src/content/docs/backlog/settings-roadmap.mdx
 * Re-add each control here only once its IPC + persistence is implemented.
 */
```

Add the Section right after the Language Section (after line 82):

```tsx
        <Section title={t("theme")}>
          <ThemeSettings
            theme={settings?.theme ?? "dark"}
            onChange={(theme) => void update({ theme })}
          />
        </Section>
```

- [ ] **Step 7: Extend the settings-page test to cover the new section**

In `apps/kaipu-record/src/renderer/src/pages/settings/settings-page.test.tsx`, the `"renders only the wired settings sections"` test asserts each wired section heading is present — add the Theme one after the permissions line:

```ts
    expect(screen.getByRole("heading", { name: /^theme$/i })).toBeInTheDocument();
```

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/pages/settings/ && bunx vitest run`
Expected: PASS — the existing assertions (heading, wired sections, no placeholders, permissions, replay) all still hold.

- [ ] **Step 8: Commit**

```bash
git add packages/i18n/messages/es.json packages/i18n/messages/en.json apps/kaipu-record/src/renderer/src/pages/settings/theme-settings.tsx apps/kaipu-record/src/renderer/src/pages/settings/theme-settings.test.tsx apps/kaipu-record/src/renderer/src/pages/settings/settings-page.tsx apps/kaipu-record/src/renderer/src/pages/settings/settings-page.test.tsx
git commit -m "feat(desktop): theme selector on the Settings page"
```

---

### Task 5: Docs — spec amendment, backlog statuses, roadmap row

**Files:**
- Modify: `apps/documentation/src/content/docs/specs/2026-07-07-design-tokens-package-design.md` (Theming model → Desktop paragraph, lines 113-117; Light palette constraints, lines 119-127)
- Modify: `apps/documentation/src/content/docs/backlog/shared-tokens-package.md` (status banner 🟡 → 🟢)
- Modify: `apps/documentation/src/content/docs/backlog/index.mdx` (tokens row 🟡 → 🟢)
- Modify: `apps/documentation/src/content/docs/backlog/settings-roadmap.mdx` (line 28 theme row)

**Interfaces:** N/A (docs only).

- [ ] **Step 1: Amend the spec's Desktop theming paragraph to match reality**

Replace the "**Desktop (PR3):**" bullet (lines 113-117) with:

```markdown
- **Desktop (PR3, amended as shipped):** `AppSettings.theme` already existed
  (typed, validated, persisted, broadcast) from the settings-store rework — it
  was declared as `"light" | "dark" | "system"` but never applied. PR3 narrowed
  it to `"light" | "dark"` (default `"dark"`; legacy persisted `"system"`
  coerces to dark in `mergeSettings`) and surfaced it: the shared renderer root
  (`I18nRoot`, the single mount point for all four windows) applies
  `document.documentElement.dataset.theme` on load and on every
  `settings:changed` broadcast. A theme selector ships on the Settings page.
```

- [ ] **Step 2: Record the accent-yellow amendment in the spec's light-palette constraints**

In the "Light palette constraints" list (lines 119-127), append one bullet:

```markdown
- Semantic accents (green/red/yellow/purple + the brand accent) meet WCAG 1.4.11
  non-text contrast (3:1) on the light surfaces, guarded in `contrast.test.ts`.
  (PR3 darkened light `accent-yellow` #ca8a04 → #a16207 to clear the bar.)
```

- [ ] **Step 3: Flip the backlog statuses to 🟢 Ready to validate**

In `apps/documentation/src/content/docs/backlog/shared-tokens-package.md`: change the status banner from 🟡 to 🟢 ("Ready to validate — all three PRs shipped; prod review of the desktop light theme pending") and mention PR3 alongside PR1/PR2.

In `apps/documentation/src/content/docs/backlog/index.mdx`: update the shared-tokens-package row status from 🟡 to 🟢 with the same one-liner.

In `apps/documentation/src/content/docs/backlog/settings-roadmap.mdx` line 28, replace the theme row's pending description (keep the table shape intact):

```markdown
| Tema claro/oscuro             | App     | 🟢 Shipped in the design-tokens PR3 — `AppSettings.theme` applied as `data-theme` in every window, selector on Settings | —        |
```

- [ ] **Step 4: Build the docs site to verify nothing broke**

Run: `cd apps/documentation && bun run build`
Expected: build succeeds, no broken-link warnings for the touched pages.

- [ ] **Step 5: Commit**

```bash
git add apps/documentation/src/content/docs/specs/2026-07-07-design-tokens-package-design.md apps/documentation/src/content/docs/backlog/shared-tokens-package.md apps/documentation/src/content/docs/backlog/index.mdx apps/documentation/src/content/docs/backlog/settings-roadmap.mdx
git commit -m "docs(tokens): PR3 spec amendment + backlog statuses to ready-to-validate"
```

---

## Manual QA checklist (owner, packaged/dev build — goes in the PR body)

Light theme across every surface, plus mid-session switching:

1. **Settings page**: toggle Oscuro/Claro — the whole main window re-themes instantly, no reload.
2. **Persistence**: quit + relaunch in light — every window comes up light with no dark flash (theme applies before first render).
3. **Main window routes** in light: Record, Library (+ detail), Screenshots, Screenshot editor, Video editor, Shortcuts, Settings, Onboarding replay.
4. **Transparent windows** in light (the known trap — background/shadow interplay, see the transparent-window gotcha): floating control bar, camera bubble, capture panel (tray). Verify: no dark/white box artifacts, readable text, correct borders.
5. **Mid-session broadcast**: with the control bar or capture panel open, switch theme from Settings — the floating window re-themes without being reopened.
6. **Dark regression**: switch back to Oscuro — byte-identical to pre-PR3 rendering everywhere.
7. **Legacy migration**: an install whose `settings.json` has `"theme": "system"` opens dark and Settings shows Oscuro selected.

## Known non-goals / follow-ups (do NOT do in this PR)

- `system` (follow-OS) theme option — needs a `prefers-color-scheme` strategy in the tokens; deferred by spec.
- Dark `text-muted` #6b7280 (~3.9:1) — pre-existing, documented in `contrast.test.ts`.
- Replacing hardcoded hexes in canvas/export code with `@kaipu/tokens` imports — opportunistic follow-up.
