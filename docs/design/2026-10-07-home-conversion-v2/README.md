# Home conversion v2 — prototype (NIW2-141)

Static review prototype, **not production code**. Plan:
`apps/documentation/src/content/docs/plans/2026-10-07-home-conversion-v2-implementation.md`.

Open `index.html` from a repo checkout after `bun install` (fonts load from
`apps/web-hono/node_modules`, Kai artwork from `packages/brand/assets`).

URL switches: `?lang=es`, `?theme=light`, `?menu=open`, `?copy=ok|error`, `?notes=1`
(review notes: gated claims, placeholders, new strings), `?skip=1` (skip link visible).

`screenshots/` were rendered headless with Playwright + Chrome at 1440×900, 1280×800 and
390×844, plus one JavaScript-disabled render.
