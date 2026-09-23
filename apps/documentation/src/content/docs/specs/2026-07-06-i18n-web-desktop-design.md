---
title: "Internationalization (i18n) — web + desktop — design"
description: "A shared @kaipu/i18n package (use-intl v4) that translates the web landing (TanStack Start, cookie + SSR) and the Electron desktop app (locale in AppSettings, tray + all renderer windows) from a single es/en message source. Spanish is the source of truth."
---

# Internationalization (i18n) — web + desktop — design

> **Status: 🔵 Approved design** (2026-07-06). Two locales (`es` default, `en`), one shared
> message source, engine = use-intl v4. Delivered in **two stages**: Stage 1 wires the whole
> system into both apps and translates the principal surfaces (one big PR); Stage 2 propagates
> extraction to the remaining pages/features after Stage 1 merges.

## Motivation

Kaipu ships a marketing/download **web** (`apps/web-hono`, TanStack Start on Cloudflare
Workers) and the **desktop** recorder (`apps/kaipu-record`, Electron). Both need Spanish and
English. Today all copy is **hardcoded and mixed** — Spanish strings (`"Algo salió mal"`,
`"Recientes"`) sit next to English ones (`"Settings"`, `"Library"`, `"Ready to record"`), and
the web landing uses voseo (`"Grabá tu pantalla"`) against the repo's neutral-Spanish rule.
There is no i18n layer at all (no `use-intl`, no message catalog).

We want: one message source of truth, a real translation engine (ICU MessageFormat), a language
switcher on each platform, and the copy consolidated into `es` (source) + `en` (mirror) so it
stops drifting.

## Constraints & fixed decisions

| Decision            | Value                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Engine              | **use-intl v4** (framework-agnostic core; not next-intl)                   |
| Locales             | `es`, `en`                                                                 |
| Default             | **`es`** (`DEFAULT_LOCALE = 'es'`)                                         |
| Source of truth     | Single `messages/{es,en}.json` in the shared package                       |
| Time zone           | `America/Lima`                                                             |
| Type safety         | Augment `interface AppConfig` via `declare module 'use-intl'` (no codegen) |
| Web persistence     | HTTP cookie `KAIPU_LOCALE`, resolved SSR-first (no flash)                  |
| Desktop persistence | New `locale` field on the existing `AppSettings` (no new store)            |

**Non-goals:** URL locale prefixes (`/es/...`), a third locale, a runtime CMS, translating the
`apps/documentation` site, and (in Stage 1) exhaustively extracting every desktop feature.

## Reconciliation with the two source docs

This design merges the two handoff docs the owner brought in, corrected against the **actual**
repo state:

- **"Partial implementation already exists"** — false for this repo. There is no `packages/i18n`,
  no `use-intl`, no `useTranslations`. We start from zero.
- **Standalone `electron-store` + dedicated `i18n:*` IPC channels** (spec §9–§10) — **dropped.**
  The desktop already has an `AppSettings` system (`settings-store.ts`) that persists to
  `settings.json` (atomic write) and **broadcasts changes to every window** via the
  `settings:changed` IPC, plus main-side `onSettingsChanged` listeners. Locale becomes a field on
  `AppSettings` and reuses all of it. No second persistence store, no second broadcast, no new IPC.
- **`Menu.setApplicationMenu` translation** (spec §10) — **not applicable.** The desktop is
  tray-first; there is no application menu. The only native surface is the **tray context menu**
  (`tray.ts`, today `"Open Kaipu Record"` / `"Quit"` hardcoded).
- **Type-safety via codegen** (rakoi guide §4) — **dropped** in favor of the simpler
  `declare module 'use-intl'` augmentation with `Messages: typeof es` (use-intl v4). Key/namespace
  checking works; ICU-argument checking is looser, which the parity test compensates for.
- **Shared workspace package** (both docs) — **kept.** Now genuinely justified: web _and_ desktop
  consume the same JSON and the same engine.

## Architecture overview

```
packages/i18n  (@kaipu/i18n)  ── single source: messages + engine + provider + config + types
      │
      ├── consumed by  apps/web-hono      (renderer + SSR server functions)  → cookie persistence
      └── consumed by  apps/kaipu-record  (4 renderer roots + main process)  → AppSettings persistence
```

The provider owns **no** persistence. It takes `onLocaleChange` (persist) and `subscribeExternal`
(react to out-of-band changes) as props; each platform injects its own. That single seam is what
lets one provider serve cookie-based web and settings-based desktop without branching.

### Package layout

```
packages/i18n/
├── package.json          # @kaipu/i18n · use-intl dep · react peer · subpath exports
├── tsconfig.json
├── vitest.config.ts
├── messages/
│   ├── es.json           # ← SOURCE OF TRUTH (neutral Spanish)
│   └── en.json           # exact key mirror
└── src/
    ├── config.ts         # SUPPORTED_LOCALES, DEFAULT_LOCALE='es', TIME_ZONE, normalizeLocale, isLocale
    ├── app-config.d.ts   # declare module 'use-intl' → AppConfig { Locale; Messages: typeof es }
    ├── provider.tsx      # <I18nProvider> + useLocale + useSetLocale (own setter, injected persistence)
    ├── index.ts          # re-export use-intl hooks + provider + config
    ├── web.ts            # detectLocaleWeb / persistLocaleWeb (cookie) / detectLocaleFromRequest (SSR)
    ├── main.ts           # createMainTranslator(locale, ns) — Electron main, via createTranslator
    └── __tests__/parity.test.ts
```

**Subpath exports:** `.` (isomorphic: provider + hooks + config) · `./web` (server-safe cookie/SSR)
· `./main` (desktop main-process translator) · `./messages/es` · `./messages/en`. Keeping `./web`
and `./main` on their own subpaths stops server-only / Node-only code from leaking into a client
bundle.

### Message shape

Namespaced by feature at the top level. `es.json` is the base and types the augmentation; `en.json`
mirrors its keys exactly (enforced by the parity test). Includes a `tray` namespace consumed by the
Electron main process.

```jsonc
// messages/es.json (source of truth)
{
  "common":   { "appName": "Kaipu Record", "save": "Guardar", "cancel": "Cancelar" },
  "tray":     { "open": "Abrir Kaipu Record", "quit": "Salir" },
  "nav":      { "record": "Grabar", "library": "Biblioteca", "settings": "Ajustes" },
  "settings": { "language": "Idioma", "spanish": "Español", "english": "Inglés" }
}
```

### Type safety

```ts
// packages/i18n/src/app-config.d.ts
import type es from "../messages/es.json";
declare module "use-intl" {
  interface AppConfig {
    Locale: "es" | "en";
    Messages: typeof es;
  }
}
```

`useTranslations("nav")` then autocompletes namespaces and validates keys; `useLocale()` returns
`"es" | "en"`. Each consuming app's `tsconfig` must include this `.d.ts` (verify types resolve;
restart the TS server if not). ICU-argument strictness is intentionally traded away — the parity
test is the guardrail against missing/empty translations.

## Web wiring (`apps/web-hono`) — cookie + SSR

Resolve the locale on the **server** so the first HTML byte is already correct (no flash, no
hydration mismatch). Mirrors the existing auth resolution in `__root.tsx`.

- `src/server-functions/get-locale.ts` — cookie `KAIPU_LOCALE` → `Accept-Language` → default;
  returns `{ locale, messages }`.
- `src/server-functions/set-locale.ts` — writes the cookie (`maxAge` 1 year, `sameSite: "lax"`,
  `path: "/"`).
- `src/routes/__root.tsx` — in `beforeLoad`, resolve locale **in parallel** with `getAuthSession()`;
  put `{ locale, messages }` on the router context; change `<html lang="en">` → `<html lang={locale}>`;
  wrap the body with `<I18nProvider>`. `setLocale` calls the server function then `router.invalidate()`
  to re-run `beforeLoad`.
- `src/components/locale-switcher.tsx` — dropdown in the header (web-ui `DropdownMenu`).

**Stage-1 extraction (web is small → done fully):** landing (hero / features / download / footer /
nav), header, and auth forms. Copy canonicalized to neutral Spanish (the voseo in the landing is
fixed here).

## Desktop wiring (`apps/kaipu-record`) — reuse AppSettings

The biggest departure from the source spec: **no `electron-store`, no `i18n:*` IPC.** Reuse the
settings pipeline.

- **Persistence** — add `locale: Locale` to `AppSettings` (`shared/types/ipc.ts`) and to
  `DEFAULT_SETTINGS`. `mergeSettings` validates it. Persist + broadcast are already handled by
  `settings-store.ts`. _Superseded (2026-09-23):_ the original design seeded a first run from
  `normalizeLocale(app.getLocale())`. That was dropped: a first run now opens in English
  (`DEFAULT_LOCALE`) and the onboarding welcome step carries a language picker, so the user
  chooses explicitly instead of the OS choosing for them.
- **Main / tray** — the tray context menu builds its labels via
  `createMainTranslator(getAppSettings().locale, "tray")` and rebuilds by subscribing to the existing
  main-side `onSettingsChanged`. `createTranslator` (use-intl's non-React core) runs fine in the
  Node main process. Always pass `timeZone`.
- **Renderer (4 roots)** — `main.tsx` wraps all four render targets (`app`, `capture-panel`,
  `control-bar`, `camera-bubble`) with `<I18nProvider>`. `initialLocale` comes from
  `window.api.getSettings()`. Injected props:
  - `onLocaleChange = (locale) => window.api.updateSettings({ locale })`
  - `subscribeExternal = (apply) => window.api.onSettingsChanged((s) => apply(s.locale))`

  No new IPC channel, and no loop (the `subscribeExternal` path only applies, never re-persists).

- **Switcher** — a language control on `SettingsPage`, mirroring the existing `theme` control.

**Stage-1 extraction (principal surfaces):** app shell + sidebar nav, `SettingsPage`, `RecordPage`
(the app's primary screen), and the tray. This exercises all four roots + the main process + the
cross-window broadcast end to end.

## Locale sync flows

```
Web — change from UI:
  useSetLocale() → onLocaleChange=setLocale serverFn (writes cookie) → router.invalidate()
      → beforeLoad re-resolves → <I18nProvider> re-renders in the new language

Desktop — change from Settings UI:
  useSetLocale() → onLocaleChange → window.api.updateSettings({locale})
      → main: settings-store persists + rebuilds tray + broadcasts settings:changed
      → every window: subscribeExternal applies s.locale (no re-persist, no loop)

Desktop — change from any window:
  same broadcast reaches all 4 windows + the tray simultaneously (single source of truth = main)
```

## Testing & installation (Stage 1 deliverables)

- **Install/build** — `@kaipu/i18n` added to the workspace; `bun install`; `wrangler types` if the
  web worker config changes; `typecheck` green in both apps; web-ui rebuilt if the switcher touches it.
- **Parity (CI gate)** — a test comparing `es.json` vs `en.json` keys that fails on any missing key,
  extra key, or empty-string value. Prevents missing translations reaching runtime.
- **Web** — unit tests for `get-locale` / `set-locale` (cookie-first, `Accept-Language` fallback,
  invalid cookie → default) and that the switcher calls `setLocale`.
- **Desktop** — a test (extending the existing Playwright + Electron harness) asserting that changing
  the locale flips a rendered string, and that the tray label rebuilds.

## Gotchas (carried into the plan)

1. **Verify use-intl v4 API against the installed version** (≥ 4.13): interface name `AppConfig`,
   `createTranslator({ locale, messages, namespace, timeZone })`, `IntlProvider` props.
2. **Always pass `timeZone`** — both Cloudflare Workers (UTC) and Electron run outside `America/Lima`;
   omitting it breaks date/number formatting.
3. **Static JSON imports only** — the Cloudflare Worker does static bundle analysis; no computed
   `import(\`../messages/${locale}.json\`)` paths.
4. **electron-vite must bundle the message JSON** in both the main and renderer builds; if it doesn't
   resolve `@kaipu/i18n/messages/*`, fall back to reading from disk with `fs`.
5. **Reuse `AppSettings`** — do not add `electron-store` or `i18n:*` IPC channels.
6. **No IPC loop** — `subscribeExternal`'s `apply` must never re-trigger `onLocaleChange`.
7. **`app.getLocale()` returns a region** (`es-419`, `en-US`) → `normalizeLocale` maps to base;
   call only after `app.whenReady()`. (No longer called by the desktop app — see Persistence.)
8. **Four renderer roots** all need the provider — a window left unwrapped won't react to changes.
9. **Neutral Spanish** — canonicalize copy during extraction (fix the landing's voseo); code and
   comments stay English.

## Delivery plan

- **Stage 1 — WIRE (one large PR):** the `@kaipu/i18n` package + full wiring into both apps +
  switchers + parity/install tests + the principal surfaces translated (all of web; desktop shell /
  settings / record / tray). Reviewed and merged.
- **Stage 2 — PROPAGATION (after merge):** extract the remaining desktop features (library,
  screenshots, video-editor, onboarding, permissions, control-bar, camera-bubble, updater,
  version-gate, watermark, …) in organized batches on top of the merged foundation. Run the parity
  test after each batch.
