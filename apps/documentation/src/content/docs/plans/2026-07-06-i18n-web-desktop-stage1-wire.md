---
title: "i18n Stage 1 (WIRE) — implementation plan"
description: "Task-by-task plan to build the shared @kaipu/i18n package and wire it into web (cookie + SSR) and desktop (AppSettings, tray, 4 renderer roots), translating the principal surfaces of both apps."
---

# i18n Stage 1 (WIRE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a shared `@kaipu/i18n` package (use-intl v4) wired into both `apps/web-hono` (cookie + SSR) and `apps/kaipu-record` (locale on `AppSettings`, tray + all 4 renderer roots), with language switchers, a CI parity test, and the principal surfaces of both apps translated into `es`/`en`.

**Architecture:** One workspace package owns the messages (`es` source of truth, `en` mirror), the use-intl engine, an isomorphic `<I18nProvider>` (persistence injected per platform), and a Node-only main-process translator. Web persists via an HTTP cookie resolved SSR-first; desktop persists via a new `locale` field on the existing `AppSettings` (reusing its atomic write + cross-window broadcast — no new store, no new IPC).

**Tech Stack:** use-intl v4 (`use-intl` React root + `use-intl/core`), React 19, TanStack Start (web), Electron + electron-vite (desktop), Vitest, oxfmt/oxlint, bun workspaces.

## Global Constraints

- **Locales:** `es`, `en`. Default `DEFAULT_LOCALE = "es"`. `es` is the source of truth; `en` mirrors its keys exactly.
- **Time zone:** always pass `timeZone = "America/Lima"` to every provider/translator.
- **Type safety:** augment `interface AppConfig` via `declare module "use-intl"` with `Locale` + `Messages: typeof es`. No codegen.
- **Desktop persistence:** reuse `AppSettings` (`shared/types/ipc.ts` + `main/infrastructure/settings-store.ts`). Do NOT add `electron-store` or any `i18n:*` IPC channel.
- **No IPC loop:** the provider's `subscribeExternal` apply path must never call `onLocaleChange`.
- **Copy:** message VALUES are neutral Spanish (no voseo) in `es.json`; English in `en.json`. Code, comments, keys, and namespaces stay English.
- **Naming:** package `@kaipu/i18n`; web cookie `KAIPU_LOCALE`; namespaces are `camelCase` top-level (`common`, `tray`, `nav`, `settings`, `record`, `landing`, `auth`, …).
- **use-intl imports:** React bits (`IntlProvider`, `useTranslations`, `useFormatter`, `useNow`, `useTimeZone`) from `"use-intl"`; the non-React `createTranslator` from `"use-intl/core"` (keeps React out of the Electron main bundle).
- **Format before commit:** the repo's pre-commit runs oxlint + oxfmt via lint-staged; never bypass with `--no-verify`.
- **Bridge name:** the desktop renderer bridge is `window.electronAPI` (exposed in `preload/index.ts`).

---

## File Structure

**New package `packages/i18n/`:**
- `package.json` — `@kaipu/i18n`, `use-intl` dep, `react` peer, subpath exports to `src`/`messages`.
- `tsconfig.json` — bundler resolution, `jsx: react-jsx`, `resolveJsonModule`.
- `vitest.config.ts` — run the parity test.
- `messages/es.json`, `messages/en.json` — the catalog.
- `src/config.ts` — locale constants + `normalizeLocale`/`isLocale`.
- `src/app-config.ts` — `declare module "use-intl"` augmentation (imported for side effects).
- `src/provider.tsx` — `<I18nProvider>` + `useLocale` + `useSetLocale`.
- `src/index.ts` — barrel: use-intl hooks + provider + config.
- `src/web.ts` — cookie detect/persist + `detectLocaleFromRequest` (server-safe).
- `src/main.ts` — `createMainTranslator` (Electron main, `use-intl/core`).
- `src/__tests__/parity.test.ts` — es/en key parity + no-empty-values.

**Web (`apps/web-hono/`):**
- Create `src/server-functions/get-locale.ts`, `src/server-functions/set-locale.ts`, `src/components/locale-switcher.tsx`, `src/server-functions/__tests__/locale.test.ts`.
- Modify `src/routes/__root.tsx` (provider + context + `<html lang>`), `src/router.tsx` (context defaults), `src/components/header.tsx` (switcher), `package.json` (dep).
- Extract copy in `src/components/landing/*`, `src/components/header.tsx`, `src/components/sign-in-form.tsx`, `src/components/sign-up-form.tsx`.

**Desktop (`apps/kaipu-record/`):**
- Modify `src/shared/types/ipc.ts` (`AppSettings.locale`, `DEFAULT_SETTINGS`), `src/main/services/settings.service.ts` (validate locale), `src/main/infrastructure/settings-store.ts` (seed from OS locale), `src/main/tray.ts` (translate + rebuild), `src/main/index.ts` (tray rebuild subscription), `src/renderer/src/main.tsx` (provider wrap), `src/renderer/src/pages/settings/settings-page.tsx` (switcher), `package.json` (dep).
- Create `src/renderer/src/app/i18n-root.tsx` (bootstrap + provider wiring), `src/renderer/src/pages/settings/language-settings.tsx`.
- Extract copy in `src/renderer/src/shell/sidebar.tsx`, `src/renderer/src/pages/settings/settings-page.tsx`, `src/renderer/src/pages/record/record-page.tsx`.

---

## Task 1: Scaffold the `@kaipu/i18n` package (engine + parity test)

**Files:**
- Create: `packages/i18n/package.json`, `packages/i18n/tsconfig.json`, `packages/i18n/vitest.config.ts`, `packages/i18n/messages/es.json`, `packages/i18n/messages/en.json`, `packages/i18n/src/config.ts`, `packages/i18n/src/app-config.ts`, `packages/i18n/src/provider.tsx`, `packages/i18n/src/index.ts`, `packages/i18n/src/web.ts`, `packages/i18n/src/main.ts`
- Test: `packages/i18n/src/__tests__/parity.test.ts`

**Interfaces:**
- Produces:
  - `config.ts`: `SUPPORTED_LOCALES: readonly ["es","en"]`, `type Locale = "es"|"en"`, `DEFAULT_LOCALE: Locale`, `TIME_ZONE: string`, `normalizeLocale(input?: string|null): Locale`, `isLocale(v: unknown): v is Locale`
  - `provider.tsx`: `I18nProvider(props)`, `useLocale(): Locale`, `useSetLocale(): (l: Locale) => void`
  - `index.ts`: re-exports `useTranslations`, `useFormatter`, `useNow`, `useTimeZone` (from use-intl) + `I18nProvider`, `useLocale`, `useSetLocale` + all `config.ts` exports + `type Locale`
  - `web.ts`: `detectLocaleWeb(): Locale`, `persistLocaleWeb(l: Locale): void`, `detectLocaleFromRequest(req: Request): Locale`, `LOCALE_COOKIE = "KAIPU_LOCALE"`
  - `main.ts`: `createMainTranslator(locale: Locale, namespace?: string)` → a translator function `t(key, values?)`
  - `messages`: `@kaipu/i18n/messages/es`, `@kaipu/i18n/messages/en`

- [ ] **Step 1: Create `packages/i18n/package.json`**

```json
{
  "name": "@kaipu/i18n",
  "version": "1.0.0",
  "description": "Shared i18n (use-intl v4): messages, provider, config for web + desktop",
  "type": "module",
  "files": ["src", "messages"],
  "exports": {
    ".": "./src/index.ts",
    "./web": "./src/web.ts",
    "./main": "./src/main.ts",
    "./messages/es": "./messages/es.json",
    "./messages/en": "./messages/en.json",
    "./package.json": "./package.json"
  },
  "scripts": {
    "check-types": "tsc --noEmit",
    "test": "vitest run",
    "lint": "oxlint src"
  },
  "dependencies": {
    "use-intl": "^4.11.0"
  },
  "peerDependencies": {
    "react": "^19"
  },
  "devDependencies": {
    "@types/node": "^22.14.1",
    "@types/react": "^19",
    "typescript": "catalog:",
    "vitest": "^2.1.0"
  },
  "packageManager": "bun@1.3.4"
}
```

- [ ] **Step 2: Create `packages/i18n/tsconfig.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true
  },
  "include": ["src/**/*", "messages/*.json"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `packages/i18n/vitest.config.ts`**

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

- [ ] **Step 4: Create `packages/i18n/src/config.ts`**

```ts
export const SUPPORTED_LOCALES = ["es", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";
export const TIME_ZONE = "America/Lima";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Map a region locale to a supported base: "es-419" → "es", "en-US" → "en", unknown → default. */
export function normalizeLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  const base = input.toLowerCase().split("-")[0] ?? "";
  return isLocale(base) ? base : DEFAULT_LOCALE;
}
```

- [ ] **Step 5: Create `packages/i18n/src/app-config.ts`** (module augmentation — imported for side effects, `.ts` not `.d.ts` so it can be `import`ed)

```ts
// Registers use-intl's compile-time type safety: keys/namespaces come from the
// es.json shape; locales are the supported union. Imported for its side effect
// from index.ts so every consumer of @kaipu/i18n inherits the augmentation.
import type es from "../messages/es.json";

declare module "use-intl" {
  interface AppConfig {
    Locale: "es" | "en";
    Messages: typeof es;
  }
}
```

- [ ] **Step 6: Create `packages/i18n/src/provider.tsx`**

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { IntlProvider } from "use-intl";
import { TIME_ZONE, type Locale } from "./config";

type Messages = Record<string, unknown>;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export interface I18nProviderProps {
  initialLocale: Locale;
  messagesByLocale: Record<Locale, Messages>;
  /** Platform persistence: cookie on web, settings IPC on desktop. */
  onLocaleChange?: (locale: Locale) => void;
  /**
   * External locale changes (e.g. the desktop settings broadcast). Receives an
   * `apply` that sets state WITHOUT re-persisting (prevents an IPC loop) and
   * returns an unsubscribe.
   */
  subscribeExternal?: (apply: (locale: Locale) => void) => () => void;
  children: ReactNode;
}

export function I18nProvider({
  initialLocale,
  messagesByLocale,
  onLocaleChange,
  subscribeExternal,
  children,
}: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      onLocaleChange?.(next);
    },
    [onLocaleChange],
  );

  useEffect(() => {
    if (!subscribeExternal) return;
    return subscribeExternal((next) => setLocaleState(next));
  }, [subscribeExternal]);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <LocaleContext.Provider value={value}>
      <IntlProvider
        locale={locale}
        messages={messagesByLocale[locale]}
        timeZone={TIME_ZONE}
        now={new Date()}
      >
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within <I18nProvider>");
  return ctx.locale;
}

export function useSetLocale(): (locale: Locale) => void {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useSetLocale must be used within <I18nProvider>");
  return ctx.setLocale;
}
```

- [ ] **Step 7: Create `packages/i18n/src/index.ts`**

```ts
import "./app-config";

export { useTranslations, useFormatter, useNow, useTimeZone } from "use-intl";
export { I18nProvider, useLocale, useSetLocale } from "./provider";
export type { I18nProviderProps } from "./provider";
export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  TIME_ZONE,
  isLocale,
  normalizeLocale,
} from "./config";
export type { Locale } from "./config";
```

- [ ] **Step 8: Create `packages/i18n/src/web.ts`**

```ts
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "./config";

export const LOCALE_COOKIE = "KAIPU_LOCALE";

/** Browser: cookie → navigator.language → default. */
export function detectLocaleWeb(): Locale {
  const fromCookie = readCookie(LOCALE_COOKIE);
  if (fromCookie) return normalizeLocale(fromCookie);
  if (typeof navigator !== "undefined") return normalizeLocale(navigator.language);
  return DEFAULT_LOCALE;
}

export function persistLocaleWeb(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
}

/** Server (SSR): cookie → Accept-Language → default. Parses only the primary subtag. */
export function detectLocaleFromRequest(req: Request): Locale {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`${LOCALE_COOKIE}=([^;]+)`));
  if (match?.[1]) return normalizeLocale(match[1]);
  const accept = req.headers.get("accept-language");
  if (accept) return normalizeLocale(accept.split(",")[0]);
  return DEFAULT_LOCALE;
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.split("=")[1];
}
```

- [ ] **Step 9: Create `packages/i18n/src/main.ts`** (Node-only, no React)

```ts
import { createTranslator } from "use-intl/core";
import es from "../messages/es.json";
import en from "../messages/en.json";
import { TIME_ZONE, type Locale } from "./config";

const messagesByLocale: Record<Locale, Record<string, unknown>> = { es, en };

/**
 * A translator usable anywhere in the Electron main process (tray, dialogs,
 * notifications). Uses use-intl's non-React core with the same JSON catalog.
 */
export function createMainTranslator(locale: Locale, namespace?: string) {
  return createTranslator({
    locale,
    messages: messagesByLocale[locale],
    timeZone: TIME_ZONE,
    namespace,
  });
}
```

- [ ] **Step 10: Create the message catalog with the wiring-critical namespaces**

`packages/i18n/messages/es.json`:

```json
{
  "common": {
    "appName": "Kaipu Record",
    "save": "Guardar",
    "cancel": "Cancelar",
    "loading": "Cargando…",
    "error": "Algo salió mal",
    "retry": "Reintentar"
  },
  "tray": {
    "open": "Abrir Kaipu Record",
    "quit": "Salir"
  },
  "nav": {
    "record": "Grabar",
    "library": "Biblioteca",
    "screenshots": "Capturas",
    "shortcuts": "Atajos",
    "settings": "Ajustes"
  },
  "settings": {
    "title": "Ajustes",
    "language": "Idioma",
    "languageDescription": "Elegí el idioma de la aplicación.",
    "spanish": "Español",
    "english": "Inglés"
  }
}
```

`packages/i18n/messages/en.json`:

```json
{
  "common": {
    "appName": "Kaipu Record",
    "save": "Save",
    "cancel": "Cancel",
    "loading": "Loading…",
    "error": "Something went wrong",
    "retry": "Retry"
  },
  "tray": {
    "open": "Open Kaipu Record",
    "quit": "Quit"
  },
  "nav": {
    "record": "Record",
    "library": "Library",
    "screenshots": "Screenshots",
    "shortcuts": "Shortcuts",
    "settings": "Settings"
  },
  "settings": {
    "title": "Settings",
    "language": "Language",
    "languageDescription": "Choose the app language.",
    "spanish": "Spanish",
    "english": "English"
  }
}
```

- [ ] **Step 11: Write the failing parity test** — `packages/i18n/src/__tests__/parity.test.ts`

```ts
import { describe, it, expect } from "vitest";
import es from "../../messages/es.json";
import en from "../../messages/en.json";

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function resolve(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj);
}

describe("es/en message parity", () => {
  const esKeys = flattenKeys(es as Record<string, unknown>);
  const enKeys = flattenKeys(en as Record<string, unknown>);

  it("every es key exists in en", () => {
    const missing = esKeys.filter((k) => !enKeys.includes(k));
    expect(missing, `Missing in en.json: ${missing.join(", ")}`).toEqual([]);
  });

  it("every en key exists in es", () => {
    const extra = enKeys.filter((k) => !esKeys.includes(k));
    expect(extra, `Extra in en.json: ${extra.join(", ")}`).toEqual([]);
  });

  it("es has no empty values", () => {
    expect(esKeys.filter((k) => resolve(es, k) === "")).toEqual([]);
  });

  it("en has no empty values", () => {
    expect(enKeys.filter((k) => resolve(en, k) === "")).toEqual([]);
  });
});
```

- [ ] **Step 12: Install and run the parity test**

Run: `bun install` (from repo root, registers the workspace) then `cd packages/i18n && bun run test`
Expected: 4 tests PASS (the catalogs are in parity).

- [ ] **Step 13: Verify the use-intl API against the installed version**

Run: `ls node_modules/use-intl && grep -rl "AppConfig" node_modules/use-intl/dist/types 2>/dev/null | head`
Expected: `use-intl` present; `AppConfig` referenced in its type declarations. Also confirm `use-intl/core` resolves: `node -e "require.resolve('use-intl/core')"` (or check `exports` in `node_modules/use-intl/package.json`). If the interface name or `/core` subpath differs, adjust `app-config.ts` / `main.ts` accordingly before continuing.

- [ ] **Step 14: Typecheck the package**

Run: `cd packages/i18n && bun run check-types`
Expected: no errors.

- [ ] **Step 15: Commit**

```bash
git add packages/i18n
git commit -m "feat(i18n): scaffold @kaipu/i18n package (use-intl v4, provider, parity test)"
```

---

## Task 2: Web wiring + landing/header/auth extraction (`apps/web-hono`)

**Files:**
- Create: `apps/web-hono/src/server-functions/get-locale.ts`, `apps/web-hono/src/server-functions/set-locale.ts`, `apps/web-hono/src/components/locale-switcher.tsx`, `apps/web-hono/src/server-functions/__tests__/locale.test.ts`
- Modify: `apps/web-hono/package.json`, `apps/web-hono/src/router.tsx`, `apps/web-hono/src/routes/__root.tsx`, `apps/web-hono/src/components/header.tsx`, and the copy files `apps/web-hono/src/components/landing/{hero,features,download-section,footer,landing-nav,download-buttons}.tsx`, `apps/web-hono/src/components/{sign-in-form,sign-up-form}.tsx`

**Interfaces:**
- Consumes: `@kaipu/i18n` (`I18nProvider`, `useTranslations`, `useLocale`, `useSetLocale`, `type Locale`, `SUPPORTED_LOCALES`), `@kaipu/i18n/web` (`detectLocaleFromRequest`, `LOCALE_COOKIE`), `@kaipu/i18n/messages/{es,en}`
- Produces: `getLocale()` server fn → `{ locale: Locale, messages: Record<string, unknown> }`; `setLocale({ data: Locale })` server fn; router context fields `locale`, `messages`

- [ ] **Step 1: Add the dependency**

Edit `apps/web-hono/package.json` dependencies, add: `"@kaipu/i18n": "workspace:*"`. Run `bun install`.

- [ ] **Step 2: Write the failing server-function test** — `apps/web-hono/src/server-functions/__tests__/locale.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const cookies = new Map<string, string>();
const headers = new Map<string, string>();

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (k: string) => cookies.get(k),
  setCookie: (k: string, v: string) => cookies.set(k, v),
  getRequestHeaders: () => new Headers(Object.fromEntries(headers)),
}));

// createServerFn(...).handler(fn) must expose `fn` callable in tests.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const build = { handler: (fn: (ctx?: unknown) => unknown) => fn };
    return { ...build, inputValidator: () => build };
  },
}));

import { getLocale } from "../get-locale";

describe("getLocale", () => {
  beforeEach(() => {
    cookies.clear();
    headers.clear();
  });

  it("prefers a valid cookie", async () => {
    cookies.set("KAIPU_LOCALE", "en");
    const result = (await getLocale()) as { locale: string };
    expect(result.locale).toBe("en");
  });

  it("falls back to Accept-Language", async () => {
    headers.set("accept-language", "en-US,en;q=0.9");
    const result = (await getLocale()) as { locale: string };
    expect(result.locale).toBe("en");
  });

  it("defaults to es", async () => {
    const result = (await getLocale()) as { locale: string };
    expect(result.locale).toBe("es");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/web-hono && bunx vitest run src/server-functions/__tests__/locale.test.ts`
Expected: FAIL (cannot find `../get-locale`).

- [ ] **Step 4: Create `apps/web-hono/src/server-functions/get-locale.ts`**

```ts
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { DEFAULT_LOCALE, isLocale, normalizeLocale, type Locale } from "@kaipu/i18n";
import { LOCALE_COOKIE } from "@kaipu/i18n/web";
import es from "@kaipu/i18n/messages/es";
import en from "@kaipu/i18n/messages/en";

const messages: Record<Locale, Record<string, unknown>> = { es, en };

export const getLocale = createServerFn({ method: "GET" }).handler(async () => {
  const saved = getCookie(LOCALE_COOKIE);
  if (isLocale(saved)) return { locale: saved, messages: messages[saved] };

  const accept = getRequestHeaders().get("accept-language") ?? "";
  const locale = accept ? normalizeLocale(accept.split(",")[0]) : DEFAULT_LOCALE;
  return { locale, messages: messages[locale] };
});
```

- [ ] **Step 5: Create `apps/web-hono/src/server-functions/set-locale.ts`**

```ts
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { SUPPORTED_LOCALES } from "@kaipu/i18n";
import { LOCALE_COOKIE } from "@kaipu/i18n/web";

export const setLocale = createServerFn({ method: "POST" })
  .inputValidator((input: unknown): (typeof SUPPORTED_LOCALES)[number] => {
    if (input === "es" || input === "en") return input;
    throw new Error(`Invalid locale: ${String(input)}`);
  })
  .handler(async ({ data }) => {
    setCookie(LOCALE_COOKIE, data, {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      path: "/",
    });
  });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/web-hono && bunx vitest run src/server-functions/__tests__/locale.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 7: Add locale defaults to the router context** — edit `apps/web-hono/src/router.tsx`

In `createTanStackRouter({ ... context: { queryClient, isAuthenticated: false, session: null } ... })`, extend the context to `{ queryClient, isAuthenticated: false, session: null, locale: "es" as const, messages: {} as Record<string, unknown> }`. (These are type-satisfying defaults; `beforeLoad` provides the resolved values before render.)

- [ ] **Step 8: Wire the provider in `__root.tsx`** — edit `apps/web-hono/src/routes/__root.tsx`

Add to `RouterAppContext`:

```ts
import type { Locale } from "@kaipu/i18n";
// ...
export interface RouterAppContext {
  queryClient: QueryClient;
  isAuthenticated: boolean;
  session: AuthSession | null;
  locale: Locale;
  messages: Record<string, unknown>;
}
```

Resolve locale in `beforeLoad` in parallel with auth:

```ts
import { getLocale } from "@/server-functions/get-locale";
// ...
beforeLoad: async () => {
  const [session, i18n] = await Promise.all([getAuthSession(), getLocale()]);
  return {
    session: session ?? null,
    isAuthenticated: !!session,
    locale: i18n.locale,
    messages: i18n.messages,
  };
},
```

Wrap the document body and drive the switch. Replace the `RootDocument` body with the provider, set `<html lang={locale}>`:

```tsx
import { useRouter } from "@tanstack/react-router";
import { I18nProvider, type Locale } from "@kaipu/i18n";
import es from "@kaipu/i18n/messages/es";
import en from "@kaipu/i18n/messages/en";
import { setLocale as setLocaleFn } from "@/server-functions/set-locale";

function RootDocument() {
  const context = Route.useRouteContext();
  const router = useRouter();
  const { isAuthenticated, session, locale } = context;

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLanding = pathname === "/";

  const handleSetLocale = async (next: Locale) => {
    await setLocaleFn({ data: next });
    await router.invalidate();
  };

  return (
    <html lang={locale} className="dark" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: criticalStyles }} />
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <I18nProvider
          initialLocale={locale}
          messagesByLocale={{ es, en }}
          onLocaleChange={(l) => void handleSetLocale(l)}
        >
          <div className="min-h-svh">
            {!isLanding && (
              <Header
                isAuthenticated={isAuthenticated}
                userName={session?.user?.name ?? ""}
                userEmail={session?.user?.email ?? ""}
              />
            )}
            <main className={isLanding ? "" : "pt-12"}>
              <Outlet />
            </main>
          </div>
        </I18nProvider>
        <Toaster richColors />
        <TanStackRouterDevtools position="bottom-left" />
        <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}
```

> Note: `onLocaleChange` here both persists (cookie via server fn) AND invalidates the router so `beforeLoad` re-runs with the new messages. No `subscribeExternal` on web.

- [ ] **Step 9: Create the switcher** — `apps/web-hono/src/components/locale-switcher.tsx`

```tsx
import { useLocale, useSetLocale, useTranslations, SUPPORTED_LOCALES } from "@kaipu/i18n";

export function LocaleSwitcher() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useTranslations("settings");
  return (
    <select
      aria-label={t("language")}
      value={locale}
      onChange={(e) => setLocale(e.target.value as (typeof SUPPORTED_LOCALES)[number])}
      className="rounded-md border border-white/15 bg-transparent px-2 py-1 text-sm"
    >
      <option value="es">{t("spanish")}</option>
      <option value="en">{t("english")}</option>
    </select>
  );
}
```

- [ ] **Step 10: Mount the switcher in the header** — edit `apps/web-hono/src/components/header.tsx`

Import `LocaleSwitcher` and render it in the header's action area (next to the user menu). Because the landing hides the header, also render `<LocaleSwitcher />` inside `landing-nav.tsx` so the switcher is reachable on `/`.

- [ ] **Step 11: Extract web copy into the catalog**

Add `landing`, `header`, and `auth` namespaces to `packages/i18n/messages/es.json` and `en.json` (keep them in parity). Then, in each of these files, replace every user-facing string with `const t = useTranslations("<namespace>")` + `t("<key>")`:
- `landing/hero.tsx`, `landing/features.tsx`, `landing/download-section.tsx`, `landing/footer.tsx`, `landing/landing-nav.tsx`, `landing/download-buttons.tsx` → `landing.*`
- `header.tsx` → `header.*`
- `sign-in-form.tsx`, `sign-up-form.tsx` → `auth.*`

For the `es` values, canonicalize to neutral Spanish (fix the landing voseo, e.g. `"Grabá tu pantalla"` → `"Graba tu pantalla"`); put the English originals/translations in `en`. Add one key per distinct string; reuse `common.*` where a string already exists there.

- [ ] **Step 12: Verify parity + typecheck + build**

Run: `cd packages/i18n && bun run test` → parity PASS.
Run: `cd apps/web-hono && bunx tsc --noEmit` → no errors (this catches any `t("badKey")`).
Run: `cd apps/web-hono && bun run build` → succeeds (confirms static JSON imports bundle in the Worker build).

- [ ] **Step 13: Manually verify the switch**

Run the web app (`cd apps/web-hono && bun run dev`), open `/`, switch the locale in the nav, confirm the landing copy flips and reloads in the chosen language, and that a refresh keeps it (cookie). Expected: no flash of the wrong language on load.

- [ ] **Step 14: Commit**

```bash
git add apps/web-hono packages/i18n/messages
git commit -m "feat(i18n): wire web (cookie + SSR) + translate landing/header/auth"
```

---

## Task 3: Desktop settings + tray translation (`apps/kaipu-record` main)

**Files:**
- Modify: `apps/kaipu-record/package.json`, `apps/kaipu-record/src/shared/types/ipc.ts`, `apps/kaipu-record/src/main/services/settings.service.ts`, `apps/kaipu-record/src/main/infrastructure/settings-store.ts`, `apps/kaipu-record/src/main/tray.ts`, `apps/kaipu-record/src/main/index.ts`
- Test: `apps/kaipu-record/src/main/services/settings.service.test.ts` (extend existing)

**Interfaces:**
- Consumes: `@kaipu/i18n` (`type Locale`, `isLocale`, `normalizeLocale`, `DEFAULT_LOCALE`), `@kaipu/i18n/main` (`createMainTranslator`)
- Produces: `AppSettings.locale: Locale`; `createTray(panel, showMainWindow, getLocale)` reads locale via a getter; a tray-rebuild function `rebuildTrayMenu(locale)`

- [ ] **Step 1: Add the dependency**

Edit `apps/kaipu-record/package.json` dependencies, add `"@kaipu/i18n": "workspace:*"`. Run `bun install`.

- [ ] **Step 2: Add `locale` to the settings type** — edit `apps/kaipu-record/src/shared/types/ipc.ts`

Add an import and the field:

```ts
import type { Locale } from "@kaipu/i18n";
// ... inside interface AppSettings:
  /** UI language for the app (renderer windows + tray). */
  locale: Locale;
// ... inside DEFAULT_SETTINGS:
  locale: "es",
```

- [ ] **Step 3: Write the failing settings-merge test** — extend `apps/kaipu-record/src/main/services/settings.service.test.ts`

```ts
it("keeps a valid persisted locale", () => {
  expect(mergeSettings({ locale: "en" }).locale).toBe("en");
});

it("falls back to the default locale for an invalid value", () => {
  expect(mergeSettings({ locale: "fr" as unknown as "es" }).locale).toBe("es");
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd apps/kaipu-record && bunx vitest run src/main/services/settings.service.test.ts`
Expected: FAIL (invalid locale not sanitized).

- [ ] **Step 5: Validate locale in `mergeSettings`** — edit `apps/kaipu-record/src/main/services/settings.service.ts`

Import `isLocale`, `DEFAULT_LOCALE` from `@kaipu/i18n` and, in the merge, coerce: `locale: isLocale(input?.locale) ? input.locale : DEFAULT_LOCALE`. (Follow the file's existing per-field merge style.)

- [ ] **Step 6: Run to verify it passes**

Run: `cd apps/kaipu-record && bunx vitest run src/main/services/settings.service.test.ts`
Expected: PASS.

- [ ] **Step 7: Seed the OS locale on first load** — edit `apps/kaipu-record/src/main/infrastructure/settings-store.ts`

In `load()`, after computing `settings`, if the persisted file had no `locale` key, seed it from the OS and persist:

```ts
import { normalizeLocale } from "@kaipu/i18n";
// ... in load(), after the try/catch that sets `settings`:
const hadLocale =
  (() => {
    try {
      return "locale" in JSON.parse(readFileSync(settingsPath(), "utf-8"));
    } catch {
      return false;
    }
  })();
if (!hadLocale) {
  settings = { ...settings, locale: normalizeLocale(app.getLocale()) };
  persist();
}
```

> `app.getLocale()` is only valid after `app.whenReady()`; `load()` is called from `registerSettings()` which runs inside `whenReady` — safe.

- [ ] **Step 8: Translate the tray + expose a rebuild** — edit `apps/kaipu-record/src/main/tray.ts`

```ts
import { app, Menu, nativeImage, Tray } from "electron";
import trayIconPath from "../../resources/tray.png?asset";
import { createMainTranslator } from "@kaipu/i18n/main";
import type { Locale } from "@kaipu/i18n";
import type { CapturePanelWindow } from "./capture-panel-window";

let trayRef: Tray | null = null;
let showMainRef: (() => void) | null = null;

function buildContextMenu(locale: Locale): Menu {
  const t = createMainTranslator(locale, "tray");
  return Menu.buildFromTemplate([
    { label: t("open"), click: () => showMainRef?.() },
    { type: "separator" },
    { label: t("quit"), click: () => app.quit() },
  ]);
}

export function createTray(
  panel: CapturePanelWindow,
  showMainWindow: () => void,
  initialLocale: Locale,
): Tray {
  const icon = nativeImage.createFromPath(trayIconPath);
  icon.setTemplateImage(true);

  const tray = new Tray(icon);
  tray.setToolTip("Kaipu Record");
  tray.on("click", () => panel.toggle(tray.getBounds()));

  trayRef = tray;
  showMainRef = showMainWindow;

  let contextMenu = buildContextMenu(initialLocale);
  tray.on("right-click", () => tray.popUpContextMenu(contextMenu));

  // Reassigned by rebuildTrayMenu on locale change.
  rebuildTrayMenu = (locale: Locale) => {
    contextMenu = buildContextMenu(locale);
  };

  return tray;
}

/** Rebuild the tray context menu in a new language (labels can't be mutated in place). */
export let rebuildTrayMenu: (locale: Locale) => void = () => {};
```

- [ ] **Step 9: Pass the locale + subscribe to rebuild** — edit `apps/kaipu-record/src/main/index.ts`

- At the `createTray(capturePanel, showMainWindow)` call, pass the current locale: `createTray(capturePanel, showMainWindow, getAppSettings().locale)` (import `getAppSettings` from the settings store if not already; it is already imported alongside `registerSettings`).
- Add a rebuild subscription next to the existing `onSettingsChanged(() => applyGlobalShortcuts());`:

```ts
import { rebuildTrayMenu } from "./tray";
// ...
onSettingsChanged((s) => rebuildTrayMenu(s.locale));
```

- [ ] **Step 10: Typecheck the desktop main**

Run: `cd apps/kaipu-record && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add apps/kaipu-record/src/shared apps/kaipu-record/src/main apps/kaipu-record/package.json
git commit -m "feat(i18n): desktop locale in AppSettings + translated tray (rebuild on change)"
```

---

## Task 4: Desktop renderer provider wiring + settings switcher

**Files:**
- Create: `apps/kaipu-record/src/renderer/src/app/i18n-root.tsx`, `apps/kaipu-record/src/renderer/src/pages/settings/language-settings.tsx`
- Modify: `apps/kaipu-record/src/renderer/src/main.tsx`, `apps/kaipu-record/src/renderer/src/pages/settings/settings-page.tsx`

**Interfaces:**
- Consumes: `@kaipu/i18n` (`I18nProvider`, `useTranslations`, `useLocale`, `useSetLocale`, `type Locale`), `@kaipu/i18n/messages/{es,en}`, `window.electronAPI` (`getSettings`, `updateSettings`, `onSettingsChanged`), `useAppSettings`
- Produces: `renderWithI18n(node: ReactNode): Promise<void>`; `<LanguageSettings />`

- [ ] **Step 1: Create the i18n bootstrap** — `apps/kaipu-record/src/renderer/src/app/i18n-root.tsx`

```tsx
import type { ReactNode } from "react";
import { I18nProvider, type Locale } from "@kaipu/i18n";
import es from "@kaipu/i18n/messages/es";
import en from "@kaipu/i18n/messages/en";

/**
 * Wraps any renderer root in <I18nProvider>, resolving the initial locale from
 * persisted AppSettings (the main process owns it). Persistence + external
 * changes reuse the existing settings bridge — no i18n-specific IPC.
 */
export async function I18nRoot({ children }: { children: ReactNode }): Promise<React.JSX.Element> {
  const settings = await window.electronAPI.getSettings();
  const initialLocale = settings.locale as Locale;

  return (
    <I18nProvider
      initialLocale={initialLocale}
      messagesByLocale={{ es, en }}
      onLocaleChange={(locale) => void window.electronAPI.updateSettings({ locale })}
      subscribeExternal={(apply) =>
        window.electronAPI.onSettingsChanged((s) => apply(s.locale as Locale))
      }
    >
      {children}
    </I18nProvider>
  );
}
```

> `I18nRoot` is async (it awaits settings). It is resolved in `main.tsx` before `root.render`, so the provider mounts with the correct locale (no flash). The `subscribeExternal` path only calls `apply` (state), never `onLocaleChange` — no loop.

- [ ] **Step 2: Wrap all four renderer roots** — edit `apps/kaipu-record/src/renderer/src/main.tsx`

Wrap the render logic so every branch is wrapped in the provider. Convert the four `root.render(...)` targets to resolve the provider element first. Replace the branch block with:

```tsx
import { I18nRoot } from "./app/i18n-root";

async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const isCapturePanel = params.get("mode") === "capture";
  const windowKind = params.get("window");
  const isControlBar = windowKind === "control-bar";
  const isCameraBubble = windowKind === "camera-bubble";

  let node: React.JSX.Element;
  if (isControlBar) {
    document.body.style.background = "transparent";
    document.body.dataset.window = "control-bar";
    installCrashForwarder("control-bar");
    node = <ControlBarWindowRoot />;
  } else if (isCameraBubble) {
    document.body.style.background = "transparent";
    document.body.dataset.window = "camera-bubble";
    installCrashForwarder("camera-bubble");
    node = <CameraBubble />;
  } else if (isCapturePanel) {
    document.body.style.background = "transparent";
    document.body.dataset.window = "capture-panel";
    installCrashForwarder("capture-panel");
    node = <CapturePanel />;
  } else {
    node = <App />;
  }

  const withI18n = await I18nRoot({ children: node });
  root.render(<StrictMode>{withI18n}</StrictMode>);
}

void bootstrap();
```

> Keep the existing imports (`StrictMode`, `createRoot`, the four components, `installCrashForwarder`) and the `const root = createRoot(...)` line. Only the branch/`render` block changes.

- [ ] **Step 3: Create the language settings control** — `apps/kaipu-record/src/renderer/src/pages/settings/language-settings.tsx`

```tsx
import React from "react";
import { useLocale, useSetLocale, useTranslations, type Locale } from "@kaipu/i18n";
import { Row } from "@renderer/ui/row";
import { Button } from "@renderer/ui/button";

/** Language picker — writes AppSettings.locale via the provider's onLocaleChange. */
export function LanguageSettings(): React.JSX.Element {
  const t = useTranslations("settings");
  const locale = useLocale();
  const setLocale = useSetLocale();

  const options: ReadonlyArray<{ value: Locale; label: string }> = [
    { value: "es", label: t("spanish") },
    { value: "en", label: t("english") },
  ];

  return (
    <Row label={t("language")} description={t("languageDescription")}>
      <div style={{ display: "flex", gap: 8 }}>
        {options.map((o) => (
          <Button
            key={o.value}
            variant={locale === o.value ? "primary" : "secondary"}
            onClick={() => setLocale(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </Row>
  );
}
```

> Verify `Row`'s prop names (`label`, `description`) and `Button`'s `variant` values against `@renderer/ui/row` and `@renderer/ui/button`; adjust to the actual API if they differ.

- [ ] **Step 4: Mount the control in the settings page** — edit `apps/kaipu-record/src/renderer/src/pages/settings/settings-page.tsx`

Import `LanguageSettings` and render a new `<Section title={t("language")}>` (using a `settings` translator) containing `<LanguageSettings />`, placed near the top (below the page title, above Permissions). Add `const t = useTranslations("settings")` to the page.

- [ ] **Step 5: Typecheck**

Run: `cd apps/kaipu-record && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manually verify the switch end-to-end**

Run: `cd apps/kaipu-record && bun run dev`. Open Settings, switch to English: the settings labels flip, and the tray right-click menu shows "Open Kaipu Record"/"Quit" (already English) — switch back to Spanish and confirm the tray shows "Abrir Kaipu Record"/"Salir". Confirm the control-bar/capture-panel windows don't crash (they're now wrapped). Restart the app and confirm the choice persisted.

- [ ] **Step 7: Commit**

```bash
git add apps/kaipu-record/src/renderer
git commit -m "feat(i18n): wrap all renderer roots + language switch in Settings"
```

---

## Task 5: Desktop principal-surface extraction (sidebar, settings, record)

**Files:**
- Modify: `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx`, `apps/kaipu-record/src/renderer/src/pages/settings/settings-page.tsx`, `apps/kaipu-record/src/renderer/src/pages/record/record-page.tsx`
- Modify: `packages/i18n/messages/es.json`, `packages/i18n/messages/en.json`

**Interfaces:**
- Consumes: `@kaipu/i18n` (`useTranslations`)

- [ ] **Step 1: Add the `record` namespace + extend `nav`/`settings`**

In `packages/i18n/messages/es.json` and `en.json`, ensure `nav.*` covers every sidebar label, `settings.*` covers every settings section title/label/button, and add a `record.*` namespace covering every visible Record-page string. Keep both files in parity. (Read each file first and enumerate its user-facing strings; `es` values in neutral Spanish, `en` in English.)

- [ ] **Step 2: Extract `sidebar.tsx`**

Replace each hardcoded nav label with `const t = useTranslations("nav")` + `t("record")`, `t("library")`, `t("screenshots")`, `t("shortcuts")`, `t("settings")`. Keep icons and routing unchanged.

- [ ] **Step 3: Extract `settings-page.tsx`**

Replace `"Settings"`, section titles, permission row labels, and button copy with `settings.*` (and `common.*` where shared) via `const t = useTranslations("settings")`. The `PERMISSION_ROWS` labels move to keys (e.g. `settings.permissionScreen`, `settings.permissionMic`, `settings.permissionCamera`).

- [ ] **Step 4: Extract `record-page.tsx`**

Replace every visible string (`"Ready to record"`, `"Paused"`, `"Stop from here or the floating bar"`, etc.) with `const t = useTranslations("record")` + the matching key. Canonicalize any Spanish already present to neutral Spanish in `es`, and provide the English in `en`.

- [ ] **Step 5: Verify parity + typecheck**

Run: `cd packages/i18n && bun run test` → parity PASS (no missing/extra/empty).
Run: `cd apps/kaipu-record && bunx tsc --noEmit` → no errors (catches any bad key).

- [ ] **Step 6: Manually verify**

Run: `cd apps/kaipu-record && bun run dev`. On the Record page and sidebar, switch es↔en and confirm every label flips with no leftover hardcoded string. Expected: fully bilingual shell + record + settings.

- [ ] **Step 7: Commit**

```bash
git add apps/kaipu-record/src/renderer packages/i18n/messages
git commit -m "feat(i18n): translate desktop shell, settings, and record page"
```

---

## Task 6: Full verification, formatting, and PR prep

**Files:** none new — verification + docs status flip.

- [ ] **Step 1: Run every test suite**

Run: `cd packages/i18n && bun run test` (parity), `cd apps/web-hono && bunx vitest run` (server fns), `cd apps/kaipu-record && bunx vitest run` (settings + any i18n unit tests).
Expected: all green.

- [ ] **Step 2: Typecheck both apps + the package**

Run: `cd packages/i18n && bun run check-types`, `cd apps/web-hono && bunx tsc --noEmit`, `cd apps/kaipu-record && bunx tsc --noEmit`.
Expected: no errors anywhere (this is the real guard that no `t("badKey")` slipped in).

- [ ] **Step 3: Build both apps**

Run: `cd apps/web-hono && bun run build` and `cd apps/kaipu-record && bun run build`.
Expected: both succeed (confirms the message JSON bundles in the Worker build AND both electron-vite main + renderer builds).

- [ ] **Step 4: Format the whole repo**

Run: `bunx oxfmt --check .` from the repo root. If it reports changes, run `bunx oxfmt .` and re-check. Expected: clean.

- [ ] **Step 5: Flip the backlog status**

Edit `apps/documentation/src/content/docs/backlog/i18n.md`: Stage 1 → 🟢 (ready to validate), and update the row in `backlog/index.mdx` accordingly.

- [ ] **Step 6: Final commit + open the PR**

```bash
git add -A
git commit -m "chore(i18n): verify + flip Stage 1 status to ready-to-validate"
```

Then open the PR from `feat/i18n-web-desktop` per the repo's one-PR-at-a-time workflow (switch the gh account to `csdev19` if `gh` errors on repo resolution). Title: `feat(i18n): web + desktop i18n foundation (Stage 1 — wire)`.

---

## Self-Review

**Spec coverage:**
- Shared package w/ subpath exports, `es` source of truth, `AppConfig` augmentation, parity test → Task 1. ✅
- Web cookie + SSR, `__root` wiring, `<html lang>`, switcher, landing extraction → Task 2. ✅
- Desktop `AppSettings.locale` (no electron-store/IPC), OS seed, tray translate + rebuild → Task 3. ✅
- 4 renderer roots wrapped, settings switcher, reuse settings bridge, no loop → Task 4. ✅
- Principal-surface extraction (sidebar/settings/record) → Task 5. ✅
- Tests + install + build + parity CI gate + format → Tasks 1,2,3,6. ✅
- Gotchas: `timeZone` always passed (provider + main), static JSON imports (build step verifies), `app.getLocale()` after whenReady (Task 3 note), no IPC loop (Task 4 note), verify use-intl API (Task 1 Step 13). ✅

**Placeholder scan:** Extraction steps (Task 2 Step 11, Task 5) name exact files + namespaces + the transform rule + a parity/typecheck/visual gate; they are mechanical, not vague. No "TBD/handle edge cases" left.

**Type consistency:** `Locale`, `normalizeLocale`, `isLocale`, `DEFAULT_LOCALE`, `SUPPORTED_LOCALES` used consistently from Task 1's `config.ts`. `createMainTranslator(locale, namespace?)` (Task 1) matches its use in `tray.ts` (Task 3). `I18nProvider` prop names (`initialLocale`, `messagesByLocale`, `onLocaleChange`, `subscribeExternal`) consistent across Tasks 1/2/4. `window.electronAPI.{getSettings,updateSettings,onSettingsChanged}` matches the real bridge.
