---
title: Home conversion v2 — implementation plan
description: Execution plan and prototype review for the remaining home conversion work (NIW2-141), sliced into reviewable PRs, with the evidence and copy decisions the owner has to make first.
---

# Home conversion v2 — implementation plan

**Status: 🟡 Proposed · 2026-10-07.** Plan-first delivery for
[NIW2-141](https://linear.app/niway/issue/NIW2-141). It executes the umbrella
[Home conversion and Kai implementation v2](/plans/2026-10-01-home-conversion-v2/)
(spec read at `309c3199beb5cf83dcec64e2040639550e5dccbb`) against the code as it
stands after [PR #202](https://github.com/niway-dev/kaipu-record/pull/202), and tracks the
open items of [Marketing landing](/backlog/marketing-landing/#open) (read at
`43a7613e2476884a5ab9e67e32dbc768896249ae`). The umbrella stays the contract for _what_;
this page is the _how, in which order, and what is still undecided_. Delete both in the
shipping PR, as the umbrella already asks.

A static prototype of the key screens lives at
`docs/design/2026-10-07-home-conversion-v2/index.html` (open it from a repo checkout),
with screenshots in `screenshots/`. It is a review artifact, not production code: it
copies the `--kl-*` tokens and the shipped catalog copy, and adds nothing to
`apps/web-hono`.

## What changed since the umbrella was written

The umbrella's audit table is from 2026-10-01. Re-checked against the code on
`night/niw2-181-app-icon` (which contains `main` plus the app-icon stack):

| Area                      | Umbrella said              | Code today                                                                                                                             | Consequence                                                     |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Locale switch             | Visually present but inert | Works: `useSetLocale` in `top-nav.tsx`, `aria-pressed` reflects state                                                                  | Task 4.1–4.2 shrink to tests                                    |
| Theme switch              | Inert                      | Works: `setLandingTheme` cookie + `router.invalidate()`, SSR reads `landingTheme`                                                      | Same — tests only; light tokens are live                        |
| Mobile menu button        | Inert                      | Still inert: `<button>` with no handler, no `aria-expanded`                                                                            | Task 4.3 stands                                                 |
| Generic download actions  | Force ARM64                | Still: `top-nav.tsx`, `hero.tsx` (desktop), `sticky-cta.tsx` link `downloadUrls.macArm64`                                              | Task 4.4–4.5 stand                                              |
| Mobile primary CTA        | Copy-link not implemented  | `hero.tsx` mobile CTA is “Send the link to my Mac” → `#download`; there is no mail backend                                             | Copy-link replaces it; the label must change (it promises mail) |
| `homeCtaFootnote`         | —                          | Claims “macOS 13 or later”; `electron-builder.yml` sets no `minimumSystemVersion`                                                      | Unverified claim live on the page — remove until Task 1 passes  |
| `homeFilesBody` / Check2  | Overclaims, fixed path     | Still `~/Movies/Kaipu Record` and “Nothing leaves your Mac unless you share it”                                                        | Task 3 copy fix stands                                          |
| Mockup text               | Hardcoded English          | Still: `mock-record.tsx` (Checkout, Card number, Pay $48.00…), `mock-edit.tsx`, `mock-find.tsx`, `mock-finder.tsx`, `mock-capture.tsx` | Task 3 stands                                                   |
| Skip link, faint contrast | Missing / failing          | No skip link in `home-shell.tsx`; dark `--kl-faint` `#6b6b74` on `#0b0b0d` ≈ 3.7:1; white on `#f6055c` ≈ 4.47:1                        | Task 6 stands; two token proposals below                        |
| Reveal                    | Content hidden until JS    | `useReveal` starts `shown=false` → `.kl-reveal` hidden in SSR HTML                                                                     | Task 6.3 stands                                                 |

## Prototype — what to look at

| Screenshot                              | Shows                                                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `01-desktop-1440-en-dark-full.png`      | Whole proposed page order: hero → (unchanged band) → localized scene → files + proof → trust strip → FAQ → download chooser |
| `02-desktop-1440-es-dark-full.png`      | Same in Spanish, including the Record scene’s inner labels                                                                  |
| `03-desktop-1440-en-light-full.png`     | Light theme with the existing light tokens                                                                                  |
| `04-desktop-1440-review-notes-full.png` | Review notes: every gated claim, placeholder and new string, inline                                                         |
| `05-desktop-1280-hero-skip-link.png`    | Skip link in its focused state                                                                                              |
| `06-desktop-1440-download-chooser.png`  | `#download`: explicit Apple Silicon / Intel choice plus “which Mac do I have?” helper                                       |
| `07`–`10` mobile 390                    | Hero, menu open (ES), copy-link success, copy-link failure with selectable fallback (ES)                                    |
| `11-mobile-390-es-full.png`             | Full mobile page in Spanish, sticky CTA                                                                                     |
| `12-mobile-390-faq-trust-light.png`     | Trust strip and FAQ on mobile, light                                                                                        |
| `13-desktop-1440-no-js-full.png`        | JavaScript disabled: everything readable (the SSR-visible baseline Task 6.3 asks for)                                       |

URL switches for live review: `?lang=es`, `?theme=light`, `?menu=open`,
`?copy=ok|error`, `?notes=1`, `?skip=1`.

Composition decisions the prototype makes (the umbrella left them open):

- **Proof sits inside “Your files”**, as _what you caught → what you sent_, directly
  under the folder message. The “it’s just a folder” clip is the second card: poster
  first, plays only on request, never autoplays. One `done` mark stays in the closing.
- **Trust strip is four plain facts in one ruled row**, no icons, no numbers. Only
  claims that need no release evidence: local use, no account to work locally, MP4/PNG
  files, separate Apple Silicon/Intel downloads.
- **FAQ is native `<details>`** (first item open): readable without JavaScript, no
  custom accordion code. Copy verbatim from the umbrella, EN and ES.
- **`#download` is a two-card chooser**, Apple Silicon primary only because it is the
  first card, plus a one-line “About This Mac → Chip / Processor” helper. Width never
  chooses.
- **Mobile menu is implemented**, not removed: a disclosure under the bar with the
  section links, the language pair and the theme toggle (Esc closes, focus returns).
- **Mobile primary copies the `#download` page link** (not the `.dmg`), with a polite
  live region for success and a selectable read-only field on failure. The sticky CTA
  runs the same action and reports in the same region.

## Delivery: four PRs, in order

Each slice is independently reviewable and shippable. Branch from `main` once this plan
is approved; stack only if the previous slice is not merged yet.

### PR 1 — Truthful controls and downloads (Tasks 4, part of 1)

- `top-nav.tsx`, `hero.tsx`, `sticky-cta.tsx`: generic Download → `href="#download"`;
  drop `downloadUrls.macArm64` from all three. `closing.tsx` keeps both explicit links.
- `top-nav.tsx` + `top-nav.module.css`: mobile menu as a disclosure
  (`aria-expanded`, `aria-controls`, Esc, focus return, closes on link click). Reuse the
  existing locale/theme handlers; no new store.
- New `copy-link.tsx` (client component): `navigator.clipboard.writeText` →
  `role="status"` message; on rejection or missing API, show a read-only, auto-selected
  `<input>` with the URL. Used by the hero mobile CTA and `StickyCta`.
- `packages/i18n/messages/{en,es}.json`: replace `homeHeroCtaMobile` /
  `homeHeroMobileNote` / `homeStickyCta` values; add `homeCopyLinkOk`,
  `homeCopyLinkError`, `homeCopyLinkFallbackLabel`, `homeMenuClose`. Grep first.
- Remove “macOS 13 or later” from `homeCtaFootnote` (EN/ES) until Task 1 evidence.
- Tests (`apps/web-hono`, vitest + Testing Library): no generic action resolves to a
  `.dmg`; menu toggles `aria-expanded` and closes on Esc; copy success and failure
  render their states; locale buttons’ `aria-pressed` follows `useLocale`.

### PR 2 — Localized scenes and copy fixes (Task 3)

- Move meaningful labels in `mock-record.tsx`, `mock-capture.tsx`, `mock-edit.tsx`,
  `mock-find.tsx`, `mock-finder.tsx` into `landing.homeMock*` keys. Keep URLs,
  filenames used as identifiers, card numbers and prices literal.
- One scenario across all five (the Acme checkout payment failure already in Record).
  Find’s visible result count must match title-only search.
- Each scene: `<figure role="img" aria-labelledby>` with a one-sentence localized
  summary (`homeMock*Summary`); every descendant `aria-hidden`.
- `homeFilesBody` → “your local library folder”; `homeFilesCheck2` → a local-save
  statement (draft: “Recordings are saved on your Mac” / “Tus grabaciones se guardan en
  tu Mac”).
- Tests: EN/ES key parity for `homeMock*`; a render test that no mock contains the old
  English literals when the locale is `es`; raw-JSON duplicate-key check.

### PR 3 — Proof, trust strip, FAQ (Task 5)

- New `home/proof.tsx`, `home/trust.tsx`, `home/faq.tsx` (+ CSS modules on `--kl-*`
  only), composed in `routes/index.tsx` after `Files` and before `Closing`.
- Proof uses a real Kaipu export provided by the owner (see open questions): a poster
  `<img>` plus `<video controls preload="none" poster=…>`; no autoplay, so reduced
  motion needs nothing extra. Assets self-hosted, never a CDN.
- FAQ keys `homeFaq{1..4}{Q,A}` with the umbrella’s copy; Q4 links to `/roadmap`.
- Trust keys `homeTrust{1..4}{Label,Body}`; only the four ungated facts.
- Tests: FAQ renders four `<details>` with content in SSR output; trust strip contains
  no gated phrase (“watermark”, “macOS 1”, “notarized”, “open source”).

### PR 4 — Accessibility, resilient rendering, docs (Tasks 6–7)

- `home-shell.tsx`: skip link to `<main id="main" tabIndex={-1}>`.
- `use-reveal.ts` / `landing-effects.css`: content visible by default; JS adds the
  hidden-then-reveal class only after mount, and never under
  `prefers-reduced-motion: reduce`.
- `rail.tsx`: real `href="#id"` anchors; drop forced smooth scrolling.
- `kl-anim-float` and any other loop: finite iterations, none under reduced motion.
- Contrast (token proposals, owner to approve): dark `--kl-faint` `#6b6b74` →
  `#8b8b94` (≈ 5.7:1); a text-bearing button pink `--kl-pink-btn: #e0004f` (white ≈
  4.9:1) while `--kl-pink` stays the brand fill for non-text uses. Alternative: keep
  `#f6055c` and make button labels ≥ 18.66px bold (large-text threshold).
- `scroll-margin-top` on sections so the fixed bar never covers a focused target;
  `main` bottom padding on mobile so the sticky CTA never covers the last control.
- Docs: fold the outcomes into `marketing/website-concept.md`,
  `marketing/home-conversion-audit.md`, `backlog/marketing-landing.md`; delete the
  umbrella and this plan.

Task 1 (release evidence) runs alongside PR 1 and gates only the claims it names.

## Release evidence (Task 1) — recorded tonight

| Claim                    | Evidence                                                                                                                                          | Result                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| ARM64 download URL       | `HEAD https://updates.kaipu.app/download/latest/kaipu-arm64.dmg` → 200, `application/x-apple-diskimage`, 130,117,019 bytes                        | ✅ resolves; version not checked         |
| Intel download URL       | `HEAD …/kaipu-x64.dmg` → 200, `application/x-apple-diskimage`, 138,397,322 bytes                                                                  | ✅ resolves; version not checked         |
| Mute export is silent    | `apps/kaipu-record/e2e/mute-export.e2e.ts` exists (asserts no audio track); not run at night (needs the packaged app + ffmpeg)                    | ⏳ unverified                            |
| Watermark off by default | `backlog/free-tier-no-watermark.md` says off by default; not checked on a distributed build                                                       | ⏳ unverified                            |
| Minimum macOS            | `electron-builder.yml` has no `minimumSystemVersion`; the effective value comes from Electron 39’s default. Not read from a packaged `Info.plist` | ⏳ unverified — page currently claims 13 |
| Signed and notarized     | Not checked                                                                                                                                       | ⏳ unverified                            |

Unverified claims stay off the page (umbrella rule). Morning check for the last four:
mount the current DMG, read `Kaipu.app/Contents/Info.plist` `LSMinimumSystemVersion`,
run `spctl -a -vv Kaipu.app`, export a short recording with mute on and with defaults,
and inspect the files with `ffprobe`.

## Open questions

Each has the default the prototype and this plan assume.

1. **Genuine output for the proof.** Who records it, and with what sample? _Default:_
   the owner records ~15 s of the Acme checkout scenario in the packaged app and exports
   an MP4 + a poster PNG; PR 3 waits for the files and ships with the section hidden
   until then.
2. **What the mobile copy-link copies.** _Default:_ the page URL with `#download`
   (`https://kaipu.app/#download`, locale-prefixed if the route is), so the Mac shows
   the architecture chooser. Copying a `.dmg` URL would pick the architecture on a phone.
3. **New mobile CTA wording.** “Send the link to my Mac” promises mail that does not
   exist. _Default:_ “Copy the download link” / “Copiar el enlace de descarga” (hero) and
   “Copy the link for your Mac” / “Copia el enlace para tu Mac” (sticky). Draft.
4. **Contrast fixes touch brand values.** _Default:_ new `--kl-pink-btn: #e0004f` for
   text-bearing buttons and dark `--kl-faint: #8b8b94`; `--kl-pink` unchanged.
5. **Is the library folder user-configurable?** The trust strip says “in a folder you
   choose”. _Default:_ yes (the umbrella says “configurable-library wording”); confirm in
   Settings, else use “in your local library folder”.
6. **“Not sure which Mac?” helper and arch subtitles** (“M1, M2, M3, M4 and later”,
   “Macs with an Intel processor”). _Default:_ ship them; draft copy.
7. **FAQ in the nav.** The prototype adds an “FAQ” tab between “Your files” and
   “Roadmap”. _Default:_ add it (new key `homeNavFaq`); drop if the bar gets crowded at
   1080 px.

## Out of scope (unchanged from the umbrella)

Redesigning the four moments, new Kai artwork, analytics infrastructure, a mail
backend, CPU auto-detection, testimonials, counters, pricing, Windows work, StyleX.
