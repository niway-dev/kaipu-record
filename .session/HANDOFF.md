# Session handoff

## Goal

Publish Kaipu's brand meaning on the website, so the name's origin is never lost with a chat
session again.

## Mode

code

## Where we stopped

- Last done: the landing's brand origin section is implemented and wired in EN/ES, the three
  brand docs are updated, and `bun run verify` passed (exit 0).
- Next: run `bun run dev:web-hono` (needs Infisical) and visually review the new `#origin`
  section plus the footer signature at ~390px and desktop width, in light and dark, in both
  locales. Check the heading wraps and that the `kay`/`khipu` cards do not overflow. This is the
  only unverified part of the work.

## Decided

- Scope is the bounded origin section, not the phase-D redesign — the creator picked it from
  three options; the redesign is blocked on logo/notch artwork and real product media. Settled;
  do not reopen.
- The section is text-only and carries no Kai artwork — it must work before any artwork is
  selected in phase B. Settled; do not reopen.
- The "not a literal Quechua translation" note ships inside the section, not as a footnote to
  remove later — publishing the coined name without it would present it as a translation.
  Settled; do not reopen.
- The English signature is "This. Captured.", never "This registered." Settled in
  `marketing/brand-identity.md`; do not reopen.
- The section sits between `WhyKaipu` and `DownloadSection` at the `#origin` anchor. Settled.

## Open

- Visual review in both themes and locales has not been done; see "Next".
- Should the origin section get a nav link, or stay reachable only by scrolling and the `#origin`
  anchor? Not decided, not asked.
- The creator was asked "¿Lo commiteo?" and had not answered when the session was parked. The
  work is now inside the checkpoint commit, which `cs-pickup` will undo.
- During `bun run verify`, turbo replayed cached logs for `@invisible-assistant/*` and `desktop`
  packages, which do not exist under those names in this repo — probably stale cache keys left
  from the template this repo was renamed out of. It did not affect the result (exit 0), but
  nobody has explained it.

## State

- Branch `feat/growth-strategy-and-free-watermark`, PR https://github.com/csdev19/kaipu-record-monorepo/pull/192
- Committed: `dd4fd8f` added `marketing/brand-identity.md`, rewrote the README around the real
  product, and added the brand/website rollout plan. `67d9774` aligned the EN/ES landing copy
  with the everyday-capture positioning. Earlier commits on this branch cover the no-watermark
  free tier and the AGPL relicense; they are unrelated to this session.
- Uncommitted at park time (all of it is in the checkpoint commit):
  - `apps/web-hono/src/components/landing/brand-origin.tsx` — new, complete. Renders the eyebrow,
    the signature, the `KAY + khiPU` formula, two term cards, the body and the disclaimer.
  - `apps/web-hono/src/routes/index.tsx` — mounts `<BrandOrigin />` after `<WhyKaipu />`.
  - `apps/web-hono/src/components/landing/footer.tsx` — shows `footerSignature` above
    `footerTagline`.
  - `packages/i18n/messages/{en,es}.json` — nine `landing.origin*` keys plus
    `landing.footerSignature`, in both catalogs.
  - `apps/documentation/src/content/docs/marketing/website-concept.md` — new "Brand origin
    section (implemented)" section with the EN/ES copy table.
  - `apps/documentation/src/content/docs/marketing/brand-identity.md` — new "Where this identity
    is published" table, plus the approved EN/ES one-line mascot story.
  - `apps/documentation/src/content/docs/plans/2026-09-27-brand-and-website-rollout.md` — phase D
    item checked, status and "Restart here" updated.

  Nothing is half-written. The code is finished and passes every automated check; only the
  visual review is missing.

## For the agent

- Original request, verbatim: "tenemos que actualizar el la web" — the closing step of a thread
  that began with "kaipu que era ? en quechua que lo hice significar ?" and settled the meaning
  as **Kaipu = KAY + khiPU → «Esto, registrado» / "This. Captured."**
- Files in play: the eight listed under State, plus `README.md` and
  `apps/documentation/src/content/docs/marketing/brand-identity.md` as the canonical references.
- Check command: `bun run verify` — exit 0 at park time. It covered workflow eligibility, oxlint
  (15 pre-existing warnings, 0 errors), `oxfmt --check` over 2,255 files, the `@kaipu/*` package
  builds, all type checks, and nine test tasks including desktop 188 files / 1,248 tests and
  `@kaipu/i18n` 3 files / 13 tests. Separately: `bun run build` in `apps/documentation` — exit 0,
  227 pages; `bun run build --filter=web-hono` — exit 0. `web-hono` has no test task of its own.
- Conventions to keep:
  - Every repository artifact is written in English, whatever language the chat uses.
  - Landing wording only ever changes through `packages/i18n/messages/{en,es}.json`; an EN/ES
    parity test in `packages/i18n/src/__tests__/parity.test.ts` fails if one catalog drifts.
  - `marketing/brand-identity.md` is canonical for the brand. Change it first, then the README
    and the landing section together — never one surface alone. Its "Where this identity is
    published" table lists all three.
  - Do not invent an etymology for Kaipu or Kai, and do not describe the name as a verified
    Quechua word.
  - Styling uses the existing `--kaipu-*` design tokens only; no new framework, no animation
    library.
