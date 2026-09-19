---
title: Public page shell and the English-first locale default
description: How a public web page declares which chrome wraps it, and why English is now the fallback locale for the web and for a fresh desktop install.
---

# Public page shell and the English-first default

> **Status: 🟢 Ready to validate.** On this branch, verified against the dev server's
> server-rendered HTML. Not yet reviewed in production.

Two fixes that turned out to share a root cause: something global was deciding per-page
behaviour from a hard-coded assumption instead of from the page itself.

## The two headers

`__root.tsx` decided which chrome to render with `pathname === "/"`: the landing page got no
app `Header`, everything else got one. That was true while the landing page was the only public
page. Once `/roadmap` shipped — bringing its own `LandingNav` and `Footer` — it got both: two
headers, two footers, and a `<main>` nested inside another `<main>`. The legal pages had the
same problem in a quieter form.

The fix makes the decision belong to the route:

```ts
// apps/web-hono/src/routes/roadmap.tsx
export const Route = createFileRoute("/roadmap")({
  staticData: { shell: "marketing" },
  // …
});
```

```ts
// apps/web-hono/src/routes/__root.tsx
const isMarketing = useRouterState({
  select: (s) => s.matches.some((m) => m.staticData.shell === "marketing"),
});
```

`shell` is typed by augmenting `StaticDataRouteOption` in `apps/web-hono/src/types/router.d.ts`,
so a typo fails the build.

The chrome itself lives in one place, `apps/web-hono/src/components/landing/public-shell.tsx`:
`LandingNav` + children + `Footer` + the landing theme. The landing page, `/roadmap` and all four
legal pages render inside it.

**Adding a public page:** render `PublicShell`, declare `staticData: { shell: "marketing" }`, and
do **not** add your own `<main>` — the root document already wraps the `Outlet` in one.

Legal pages changed visibly here: they lost the app `Header` and the duplicated `LegalLinks`
footer, and gained the marketing nav with its theme and locale switchers.

## English as the fallback locale

`DEFAULT_LOCALE` in `packages/i18n/src/config.ts` is now `"en"`. It applies only where nobody
has stated a preference:

| Situation                                 | Locale    |
| ----------------------------------------- | --------- |
| No cookie, no usable `Accept-Language`    | `en`      |
| `Accept-Language: es-…`                   | `es`      |
| `KAIPU_LOCALE=es` cookie, or the switcher | `es`      |
| Fresh desktop install                     | `en`      |
| Desktop with a stored locale              | unchanged |

The desktop app shares this constant through `settings.service.ts`, so a fresh install now
starts in English. Existing installs keep whatever they stored.

`DEFAULT_SETTINGS.locale` in `apps/kaipu-record/src/shared/types/ipc.ts` is a second copy of the
same value — that module is shared with preload, so it cannot import the i18n package without
pulling React and both message catalogs into that bundle. A test in `settings.service.test.ts`
asserts the two agree, which is what caught the drift in the first place.

## SEO copy follows the locale

The tab title used to be a hard-coded Spanish string in `lib/seo.ts`, so it stayed Spanish even
with the switcher on English. Titles and descriptions now live in the `seo` namespace of
`packages/i18n/messages/{en,es}.json` and are resolved per request.

`head()` runs outside React, so `lib/seo.ts` reads the catalogs directly rather than through
`useTranslations`, and takes the locale from `match.context.locale` — the value the root's
`beforeLoad` already resolves. `og:locale` follows the locale too instead of being pinned to
`es_PE`.

**Adding a public page's SEO:** add a `seo.pages.<id>` entry to both catalogs and call
`pageHead({ locale: match.context.locale, page: "<id>", path: "/…" })`. The `SeoPage` type is
derived from the English catalog, so an id with no copy fails to compile.

## What to validate in production

- `/`, `/roadmap` and each legal page show exactly one header and one footer, in both themes.
- A browser with no Spanish preference gets an English tab title; one set to Spanish still gets
  Spanish, and the switcher still flips both the page and the title.
- A fresh desktop install starts in English, and an existing install keeps its language.
