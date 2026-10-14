---
title: "Web bundle size: the log"
description: "What the landing ships to a visitor, measured in bytes at every change that matters, so growth is caught when it happens and not when a score drops."
---

# Web bundle size: the log

Lighthouse scores move with the machine, the network model and the day. Bytes do not. This
page tracks the one number that is entirely ours: **what `apps/web-hono` ships**, raw and
brotli, measured from the build output. The [web vitals series](/frontend/web-vitals-baseline/)
says how fast the page is; this one says how heavy it is, and it is the number to watch for
growth, because every regression the vitals series has caught so far was a byte regression
first.

## How to measure

```bash
cd apps/web-hono && bun run build          # same build the release runs
cd ../.. && bun run measure:web-bundle     # prints the table below; --json for the numbers
```

`scripts/measure-web-bundle.mjs` reads `apps/web-hono/dist/client/assets`, compresses every
file with brotli at quality 11 (what Cloudflare serves, within a few percent of the `zstd` it
answers with today), groups by kind, and reads the route manifest TanStack Start emits into
the server build to name the **landing critical set**: the root entry chunk, the `/` route's
chunks, and the stylesheets a first visit to `/` loads before it can paint. Fonts are listed
but kept out of that set — `font-display: swap` keeps them off the first paint, and a visitor
downloads only the subsets their text needs (four of the nineteen files, 148 KiB).

The build must be the production one, with the same env the release passes (`VITE_SERVER_URL`,
`DATABASE_URL` can be placeholders; `VITE_PUBLIC_DOWNLOAD_URL` as in the workflow), because a
dev build inlines different things.

## Budget

The lines below are the proposal, not a rule yet: the owner sets them. Until then the log is
the alarm — a row that crosses a line gets a note saying why, in the same PR that crossed it.

| What                              | Today     | Proposed ceiling | Why this line                                                                     |
| --------------------------------- | --------- | ---------------- | --------------------------------------------------------------------------------- |
| Landing critical set, brotli      | 144.1 KiB | **160 KiB**      | ~10% headroom; above it the mobile first paint starts to be bytes again           |
| Main bundle (`main-*.js`), brotli | 107.4 KiB | **120 KiB**      | The chunk every route pays for; it was 295 KiB raw-transfer before the root diet  |
| Everything in `assets/`, brotli   | 735.2 KiB | —                | Not a budget: it counts every route and every font subset, which no visitor loads |

## The log

Append a row per measurement. Never edit an old row.

| Date       | Commit    | Critical (br) | Main (br) | Scripts (br) | CSS (br) | All assets (br) | What changed since the row above                                                                      |
| ---------- | --------- | ------------- | --------- | ------------ | -------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| 2026-10-06 | `357b84d` | **144.1 KiB** | 107.4 KiB | 282.5 KiB    | 22.4 KiB | 735.2 KiB       | First row. After the root diet (`762ca6b`), lazy hydration (`818ad04`) and the SVG logos. Production. |

### First measurement, in full

Build at `357b84d`, 61 files in `assets/`:

| What                                        | Files |        Raw |        Brotli |
| ------------------------------------------- | ----: | ---------: | ------------: |
| script                                      |    32 | 1080.3 KiB | **282.5 KiB** |
| font                                        |    19 |  425.4 KiB | **425.2 KiB** |
| stylesheet                                  |     4 |  128.4 KiB |  **22.4 KiB** |
| image                                       |     6 |   17.3 KiB |   **5.1 KiB** |
| **everything in assets/**                   |    61 | 1651.4 KiB | **735.2 KiB** |
| landing critical (entry + `/` chunks + CSS) |     9 |  572.5 KiB | **144.1 KiB** |
| main bundle (`main-CHGMR08v.js`)            |     1 |  394.5 KiB | **107.4 KiB** |

The critical set: `main-CHGMR08v.js`, `index-CtY-udJZ.js`, `index-C27nYC-4.js`,
`sun-BXi_RGfq.js`, `check-BrnsarDt.js`, `kaipu.stylex-qlcxhY3S.js`, `index-BPND-WF9.css`,
`stylex-C7hijh0W.css`, `index-BnserSUI.css`.

Largest files by what they cost over the wire: the main bundle (107 KiB), then the Caveat
font — 75 KiB for the Cyrillic subset and 73 KiB for Latin, the two heaviest files after the
bundle, for a display face used in a handful of headings. `index.es-kvbabQYw.js` (56 KiB) and
`cloud-promotion-BUcNi_YH.js` (38 KiB) belong to the authenticated app, not the landing.

**How this relates to the vitals row of the same day.** Lighthouse reported the main bundle
at 128 KiB _transferred_ on production; the 107 KiB here is brotli-11 on the same bytes.
The gap is headers plus Cloudflare's `zstd` level — expect the edge number to sit 10–20%
above this one, consistently. Compare rows of this log with each other, and vitals rows with
each other, never across.

## Reconstructing older rows

Every earlier commit can be measured the same way: check it out in a worktree, build, run the
script. The two commits worth a row are `0b6f4c4` (the CSS dedup, before the root diet) and
`976105a` (the first edge measurement), because they bracket the biggest change in the
series. They are left for the next sitting; the script did not exist when they shipped.

## Related

- [Web vitals: the landing's baseline](/frontend/web-vitals-baseline/) — the speed series this
  one explains.
- [Bundle splitting](https://github.com/csdev19/general-knowledge/blob/main/web/bundle-splitting.md)
  and [Core Web Vitals](https://github.com/csdev19/general-knowledge/blob/main/web/core-web-vitals.md)
  in the hub.
