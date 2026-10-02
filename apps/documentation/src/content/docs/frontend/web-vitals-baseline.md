---
title: "Web vitals: the landing's baseline"
description: The first measurement of the marketing home, how it was taken, and the log every later measurement appends to.
---

# Web vitals: the landing's baseline

**Status: 🟡 Baseline recorded 2026-10-01 · optimization not started.** The design is
finished; this page exists so the work that follows has something to be measured against.

The reusable method and the reasoning behind it live in the knowledge hub:
[Core Web Vitals: measuring honestly](https://github.com/csdev19/general-knowledge/blob/main/web/core-web-vitals.md).
This page carries only this product's numbers and the conditions they were taken under.

## The first measurement

Lighthouse 13.5.0, against a **production build** served by `vite preview` on localhost,
commit `78f6dea` (`feat/home-kai-web`, the Kai + light-theme slice, before any optimization).

| Preset                   | Performance | FCP   | LCP   | TBT   | CLS |
| ------------------------ | ----------- | ----- | ----- | ----- | --- |
| Desktop                  | **87**      | 1.5 s | 1.7 s | 0 ms  | 0   |
| Mobile (Slow 4G, CPU 4×) | **57**      | 8.5 s | 9.0 s | 20 ms | 0   |

Other categories, desktop preset: accessibility **96**, best practices **100**, SEO **100**.

**Layout stability is already perfect** — CLS 0 on both presets, and blocking time is
negligible. The landing's entire problem is how long it takes to show anything.

## The second measurement — the edge, as promised

Lighthouse 13.5.0 (same instrument), against a **Cloudflare Version URL** — real edge,
real brotli, real TTFB — serving `main` at `976105a`, uploaded by the manual
[Preview Web](https://github.com/csdev19/kaipu-record-monorepo/actions/workflows/preview-web.yml)
workflow. Same code path as the first row: nothing was optimized in between, so the
delta below is the compression-and-edge effect the first row's caveats predicted, and
nothing else.

| Preset                   | Performance | FCP   | LCP   | TBT   | CLS |
| ------------------------ | ----------- | ----- | ----- | ----- | --- |
| Desktop                  | **95**      | 1.0 s | 1.1 s | 0 ms  | 0   |
| Mobile (Slow 4G, CPU 4×) | **71**      | 4.4 s | 4.8 s | 20 ms | 0   |

Conditions worth recording: headless run, Brave as the Chromium binary (the measuring
machine has no Google Chrome; the landing loads no third parties, where the difference
would live). Cloudflare Access has to be off for the measurement window — Lighthouse is
an unauthenticated client and measures the Access login page otherwise, which is how one
PageSpeed Insights run on this URL produced numbers for the wrong page entirely. Turn it
back on afterwards.

Two readings to take away, one calming and one not:

- **SEO reads 66 on the version URL and that is correct behaviour, not a regression.**
  The only failing audit is `is-crawlable`: Cloudflare stamps `x-robots-tag: noindex`
  on every version URL, which is exactly what keeps previews out of search results.
  `kaipu.app` does not carry that header.
- **The compression caveat is now spent.** The download got its brotli; what remains is
  the work: unused JavaScript and render-blocking CSS are untouched, and mobile 71 —
  not 57 — is the honest floor the optimization effort starts from.

## Two conditions that made the first numbers pessimistic

These applied to the first measurement; the second one above retires the first condition.
Read the first table with both of these in mind, or the first optimization will look like a
miracle it is not.

1. **The local preview sends no compression.** Measured: the main bundle goes over the
   wire at 943 KB, and `gzip -9` alone brings it to 293 KB. Cloudflare serves brotli, so
   a real visitor downloads roughly a third of what this measurement downloaded. Lighthouse
   notices and reports it as "Document request latency — est. savings 86 KiB".
2. **It is a lab measurement, not field data.** No edge cache, no real TTFB, no HTTP/3,
   and no CrUX. The mobile 57 is a worst-case floor, not what visitors see.

What the compression caveat does **not** excuse: JavaScript is parsed and executed from its
decompressed size, so the bundle is as expensive to run either way. Compression changes the
download, not the work.

## What Lighthouse says to fix, in its own order

| Opportunity              | Estimated saving                               |
| ------------------------ | ---------------------------------------------- |
| Reduce unused JavaScript | **2400 ms · 500 KiB** (mobile preset)          |
| Render-blocking requests | 320 ms                                         |
| Improve image delivery   | 144 KiB                                        |
| Document request latency | 86 KiB — this is the missing compression above |

Cross-referenced with what the bundle actually contains (production build, uncompressed):

- **JS 965 KB in 4 files.** The landing ships code it never runs; `cloud-promotion`
  (197 KB) is in the client bundle of a marketing page.
- **CSS 154 KB in 3 render-blocking files.** First paint waits for all three. On the
  desktop preset FCP and LCP are within 200 ms of each other, which is the signature of a
  page gated on its stylesheets rather than on its content.
- **Images 147 KB in 6 files.** Every brand mark is a 778 px PNG regardless of the size it
  renders at — the mood satellites render at 56 px, a 13.9× oversample.
- **Fonts 146 KB in 4 files.** Four families are declared but `unicode-range` means only
  the latin subsets download. Not a problem; do not "fix" it.

## Known failures that are not speed

- **Contrast:** white on the brand pink `#f6055c` measures 4.12:1 against WCAG AA's 4.5.
  Identical in both themes, so it predates this work. A brand decision, not a bug.
- **Missing source maps** for first-party JavaScript, which is why the 965 KB has not been
  attributed to packages yet.

## How to take the next measurement

The series is only a series if every row used the same instrument. Do not substitute a
hand-rolled script, and do not measure the dev server — Vite serves CSS as modules there,
so the page flashes unstyled in development and does not in production.

**The edge way (preferred since the second row):** run the manual **Preview Web** workflow
from Actions; its run summary prints the version URL and these same Lighthouse commands
pointed at it. Disable Cloudflare Access on the worker's preview URLs for the window,
re-enable it after, and record the commit the run uploaded.

**The localhost way (how the first row was taken):**

```bash
cd apps/web-hono && bun run build
bun run serve --port 4173 &

# desktop, then mobile (mobile is the default preset)
bunx lighthouse http://localhost:4173/ --preset=desktop --output=html --output-path=./lh-desktop
bunx lighthouse http://localhost:4173/ --output=html --output-path=./lh-mobile
```

`scripts/measure-web-vitals.mjs` remains for the checks Lighthouse does not do: that the
first paint matches the chosen theme, and that EN/ES both render. It is a correctness
check, not a performance instrument.

## The log

Append a row per measurement. Never edit an old row — a corrected number is a new row with
a note, because the point of the series is the shape of the curve.

| Date       | Commit    | Desktop | Mobile | What changed since the row above                                               |
| ---------- | --------- | ------- | ------ | ------------------------------------------------------------------------------ |
| 2026-10-01 | `78f6dea` | 87      | 57     | Baseline. Design complete, no optimization attempted.                          |
| 2026-10-01 | `976105a` | 95      | 71     | Same code, first edge measurement: Cloudflare Version URL, brotli + real TTFB. |
