---
title: "Home: Kai, the hero copy, and the fox on camera"
description: Two-agent plan — one ships the compact Moments band, Kai section, Kai camera illustration, and closing mark using pre-applied EN/ES copy; the other reconciles the brand docs with the implemented fox.
---

# Home: Kai, the hero copy, and the fox on camera — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: 🔵 Approved design; copy pre-applied · 2026-10-01.** Owner-approved in chat on 2026-10-01: option 2 (Kai as the third section), the four assumptions of the proposal, and the defaults listed under [Decisions](#decisions). The exact EN/ES values in the [Copy contract](#copy-contract) were applied to both catalogs with this plan, before delegation. This document and those catalog values are the contract between the two agents; neither edits them during execution (see [Coordination protocol](#coordination-protocol)).

**Goal:** The home positions Kaipu in one line, moves faster from "look at this" to the product, introduces Kai as the third section, puts Kai's face in the recording illustration's camera bubble, and the brand docs stop describing a knot that was never drawn.

**Architecture:** Content and composition only, inside mechanisms that already exist: `@kaipu/brand` (`KaipuLogo` picks artwork by purpose), the `landing` namespace in `packages/i18n/messages/{en,es}.json` (EN/ES parity test), CSS Modules with `--kl-*` tokens scoped to `[data-kl]`. One new section component (`home/kai.tsx`) follows the shape of `home/files.tsx`. No new dependency, token, store, or event.

**Tech Stack:** TanStack Start (React 19) in `apps/web-hono`, CSS Modules, `@kaipu/i18n` (`useTranslations("landing")`), `@kaipu/brand` (`KaipuLogo`), Vitest in `packages/i18n`, Astro Starlight in `apps/documentation`, Bun + Turbo, oxlint + oxfmt.

**Spec:** No separate spec. The design was settled in chat from three documents, which the executors read first: the [home audit](/marketing/home-conversion-audit/) (findings H11, H12, H13), the [EN/ES copy review](/marketing/home-copy-review/), and the [canonical brand identity](/marketing/brand-identity/). The decisions table below is the spec.

## Why two agents, and how they split

| Agent        | Branch                    | Owns                    | Must not touch                                       |
| ------------ | ------------------------- | ----------------------- | ---------------------------------------------------- |
| **A — web**  | `feat/home-kai-web`       | `apps/web-hono/**`      | `apps/documentation/**`, `packages/i18n/messages/**` |
| **B — docs** | `docs/home-kai-reconcile` | `apps/documentation/**` | `apps/web-hono/**`, `packages/**`                    |

Both branch from `main` **after this plan is committed to `main`**, so both read the same contract. Each opens its own PR. B's PR depends on A's and merges second (its text says "shipped in #A"; that must be true when it lands). Neither edits the other's files, so there is nothing to merge between them.

## Decisions

| #   | Decision                                                                                                                           | Why                                                                                                                                                                                                                       | Alternative rejected                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | Kai is the **third** section: Hero → Moments (compact) → Kai → chapters 01–04                                                      | The owner wants Kai early; the hero still sells first                                                                                                                                                                     | Second section (delays the first product proof); folded into Moments (Kai gets no room to say who he is) |
| 2   | Moments becomes a **band**, not a 92vh screen; its `<h1>` becomes `<h2>`; the four chapter chips go                                | Two full introductions in a row read slow (audit H13); the rail and the mobile chapter strip already are the table of contents                                                                                            | Keep the chips (a third navigation for the same four anchors)                                            |
| 3   | The camera bubble shows **`KaipuLogo use="product"`** (the plain fox), no text, decorative                                         | The bubble is a camera feed; the fox stands in for your face. `record` would duplicate the REC chrome and is a "recording in progress" state, not a camera                                                                | `use="record"`; a human photo                                                                            |
| 4   | The hero eyebrow carries the **category** ("Screen recording & screenshots for Mac") instead of "Kaipu Record"                     | The brand is already in the mark beside it and in the top bar (audit, Hero row)                                                                                                                                           | A new key and a third line in the identity row                                                           |
| 5   | Kai's body copy is the **long** proposal, with its appearance rewritten to what is true today                                      | "finish something ready to share" is not an app moment: `done` appears only at the end of onboarding and, by this plan, in the home closing. The desktop menu-bar mark reflects the selected recording or screenshot mode | The short copy-review line (no origin, no character)                                                     |
| 6   | The origin block in the Kai section **reuses `landing.origin*`** keys; new keys are only `homeKaiHeading` and `homeKaiBody`        | The copy review forbids a second etymology; the catalogs already carry the approved wording                                                                                                                               | New `homeKaiOrigin*` keys with the one-paragraph story                                                   |
| 7   | The closing's mark becomes **`use="done"`**                                                                                        | The audit's "one quiet celebration near the close"; `app` already opened the page                                                                                                                                         | Keep `app` (the frame corners explain nothing at the end)                                                |
| 8   | **The fox is Kai.** `brand-identity.md` records the replacement with the date 2026-10-01; the knot and the vizcacha become history | The code has shipped the fox everywhere (`packages/brand`, menu bar, onboarding, web); the docs contradict it                                                                                                             | Keep "exploration pending" wording                                                                       |
| 9   | Translating the five mockups (audit H06) is **out of scope**; a second PR                                                          | Dozens of keys mixed into a composition change would make both hard to review                                                                                                                                             | —                                                                                                        |

## Copy contract

All keys are inside the `landing` namespace of `packages/i18n/messages/en.json` and `es.json`. They were applied before delegation. Agent A consumes them without editing them; Agent B documents them verbatim. Typographic apostrophes (’) and Spanish quotes («») remain as written.

**Modified keys**

| Key                  | EN                                                                                                                                      | ES                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `homeHeroEyebrow`    | Screen recording & screenshots for Mac                                                                                                  | Grabación de pantalla y capturas para Mac                                                                                             |
| `homeHeroSerif`      | Get back to work. _(unchanged)_                                                                                                         | Sigue con lo tuyo.                                                                                                                    |
| `homeHeroBody`       | Record a bug. Explain a change. Annotate a screenshot. Turn what’s on your screen into something clear to share and easy to find again. | Graba un error. Explica un cambio. Anota una captura. Convierte lo que ves en algo claro para compartir y fácil de encontrar después. |
| `homeHeroCtaPrimary` | Download Kaipu for Mac                                                                                                                  | Descargar Kaipu para Mac                                                                                                              |
| `homeMomentsSub`     | Some things take three paragraphs to explain and ten seconds to show. Kaipu is for those moments.                                       | Hay cosas que toman tres párrafos explicar y diez segundos mostrar. Kaipu es para esos momentos.                                      |

**New keys**

| Key              | EN                                                                                                                                                   | ES                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `homeKaiHeading` | Meet Kai.                                                                                                                                            | Conoce a Kai.                                                                                                                                                                |
| `homeKaiBody`    | Kai is the fox behind Kaipu, the companion for moments worth capturing. You’ll see him in the menu bar when you choose recording or screenshot mode. | Kai es el zorro de Kaipu, el compañero de los momentos que vale la pena capturar. Lo verás en la barra de menús cuando elijas el modo de grabación o de captura de pantalla. |

**Reused keys (already in both catalogs, values unchanged):** `originHeading`, `originFormula`, `originKayTerm`, `originKayBody`, `originKhipuTerm`, `originKhipuBody`, `originBody`, `originSignature`, `originNote`.

**Removed text:** the camera bubble's "Your face / or browse files" (hardcoded English, `mock-record.tsx`). Nothing replaces it; the bubble shows the fox.

**Artwork per surface:** hero identity row `app` (unchanged) · Kai section `product` · camera bubble `product` · closing `done` · top bar and footer `product` (unchanged).

## Global Constraints

- Everything durable is English: code, comments, commit messages, PR text, docs. Chat may be Spanish.
- Spanish copy is neutral — no voseo (`graba`, not `grabá`), no regional slang.
- The EN/ES copy contract already exists in both catalogs. Agents verify it but do not add, rename, or rewrite those keys. `packages/i18n` parity tests must pass.
- Landing CSS never uses a Tailwind utility and never a `--kaipu-*` token; only `--kl-*` inside CSS Modules.
- Mockups are pictures: no focus targets, nothing announced, decorative images `aria-hidden`.
- Server render and hydration must be deterministic; `useReveal` is the only client-only behavior allowed in a section and it falls back to visible.
- Kai never implies an AI assistant, automatic editing, or a lossless-recording guarantee. No floating mascot, no constant animation.
- The documentation does not call anything done that `main` does not contain. Status language: "🟢 Ready to validate — shipped in #N" only once PR N is merged.
- `main` is never pushed to directly. GitHub as `csdev19` with the `github-csdev` SSH alias; `git config user.email` in this repo must be `cristiansotomayor.dev@gmail.com` (see `~/GITHUB_ACCOUNTS.md`).
- Commit messages: the repo's style is a lowercase conventional prefix and a sentence that says what changed and why (`feat(web): the fox everywhere the web still showed the old play-mark`). End them with the attribution lines your session gives you.

## Review Focus

Five conditions no automated test in this repo exercises (`apps/web-hono` has no test runner; the only tests are `packages/i18n`'s). Each is pinned to a manual check in the owning task.

1. **Spanish renders every new key** — a visitor with `KAIPU_LOCALE=es` must see "Conoce a Kai.", never a raw key name. → Task A6, the ES screenshot.
2. **The hero identity row at 1280×800** — the category eyebrow is 20 characters longer than "Kaipu Record"; it must not wrap into a third line beside the 72px mark, which would push the mockup below the fold again (the viewport ladder is keyed on height). → Task A6, the 1280×800 screenshot.
3. **The bubble is a circle on mobile** — at 72px the fox PNG's own rounded corners must not show as a square inside the ring; the image must fill and clip. → Task A4 check, Task A6 390×844 screenshot.
4. **No-script baseline** — the Kai section's reveal must be visible when JavaScript has not run (audit H17 pattern). → Task A3 uses `useReveal` on the figure only and keeps the text outside it.
5. **Reduced motion** — the `done` mark in the closing inherits `kl-anim-float`, which `landing-effects.css` already stops under `prefers-reduced-motion`; nothing new animates. → Task A5 check with the macOS "Reduce motion" setting or DevTools emulation.

## Coordination protocol

Documents are the channel; no agent assumes what the other did.

1. **This plan and the EN/ES catalogs on `main` are the contract.** Nobody edits the Copy contract, the Decisions table, the ownership table, or the seven approved catalog values during execution. A deviation is written as a comment titled **Deviation** on the author's own PR, and the other agent reads the other PR's comments before finishing.
2. **Agent A opens a draft PR after its first web commit** (Task A2), titled exactly `feat(web): Kai meets the visitor — hero copy, a Kai section, the fox on camera`. Agent B finds its number with `gh pr list --head feat/home-kai-web --json number,url` and uses it in every doc that says "shipped in".
3. **Agent A's final PR comment is titled `Copy contract verified`** and states that the rendered home consumes the seven pre-applied EN/ES values without changing them. Agent B compares the catalogs on `main` against the Copy contract before marking its PR ready.
4. **Agent B's PR body opens with `Depends on #<A>`** and B marks it ready for review only after A's PR is merged. Until then its status banners say "🟡 In progress — PR #<A>".
5. **Neither agent rebases the other's branch, pushes to the other's branch, or touches the other's files.** If B needs a code fact (a class name, a key), it reads A's branch read-only (`git fetch origin feat/home-kai-web && git show origin/feat/home-kai-web:<path>`).
6. **Both agents hand off with the `cs-write-handoff` skill** in the PR body: what changed, where to start reviewing, how to check, whether it is safe to merge.

---

# Agent A — web

Working directory: the monorepo root. Start:

```bash
git checkout main && git pull --ff-only
git config user.email            # must print cristiansotomayor.dev@gmail.com
gh auth status                   # must show csdev19 active
git checkout -b feat/home-kai-web
bun install
```

Local dev needs Infisical (`infisical login` once per machine; `bun run dev:web-hono` pulls the env itself). If the CLI is missing, `bun run setup` says how to get it. The dev server serves the home at `http://localhost:3000/`; the locale follows the `KAIPU_LOCALE` cookie (`es` or `en`) or `Accept-Language`.

### Task A1: Verify the pre-applied copy contract

**Files:**

- Read only: `packages/i18n/messages/en.json` (the `landing` object)
- Read only: `packages/i18n/messages/es.json` (the `landing` object)
- Verify: `packages/i18n/src/__tests__/parity.test.ts` (existing; no new test file)

**Interfaces:**

- Consumes: the seven values already present on `main`.
- Produces: no code change. Tasks A2 and A3 read the values through `useTranslations("landing")`.

- [ ] **Step 1: Verify the new keys and exact values exist**

```bash
cd packages/i18n && grep -n 'homeKaiHeading\|homeKaiBody' messages/en.json messages/es.json
```

Expected: both keys appear in both catalogs with the Copy contract values. If a value differs, stop and report the mismatch; do not silently rewrite the contract.

- [ ] **Step 2: Verify the complete contract against both catalogs**

Check these values in `en.json`:

```json
"homeHeroEyebrow": "Screen recording & screenshots for Mac",
"homeHeroBody": "Record a bug. Explain a change. Annotate a screenshot. Turn what’s on your screen into something clear to share and easy to find again.",
"homeHeroCtaPrimary": "Download Kaipu for Mac",
"homeMomentsSub": "Some things take three paragraphs to explain and ten seconds to show. Kaipu is for those moments.",
```

`homeHeroSerif` must remain `"Get back to work."` in EN.

- [ ] **Step 3: Check the Spanish values**

```json
"homeHeroEyebrow": "Grabación de pantalla y capturas para Mac",
"homeHeroSerif": "Sigue con lo tuyo.",
"homeHeroBody": "Graba un error. Explica un cambio. Anota una captura. Convierte lo que ves en algo claro para compartir y fácil de encontrar después.",
"homeHeroCtaPrimary": "Descargar Kaipu para Mac",
"homeMomentsSub": "Hay cosas que toman tres párrafos explicar y diez segundos mostrar. Kaipu es para esos momentos.",
```

- [ ] **Step 4: Check the two Kai values**

They must appear after `homeMomentsSub` in each file so the catalogs keep the same order.

`en.json`:

```json
"homeKaiHeading": "Meet Kai.",
"homeKaiBody": "Kai is the fox behind Kaipu, the companion for moments worth capturing. You’ll see him in the menu bar when you choose recording or screenshot mode.",
```

`es.json`:

```json
"homeKaiHeading": "Conoce a Kai.",
"homeKaiBody": "Kai es el zorro de Kaipu, el compañero de los momentos que vale la pena capturar. Lo verás en la barra de menús cuando elijas el modo de grabación o de captura de pantalla.",
```

- [ ] **Step 5: Run the parity tests**

```bash
cd packages/i18n && bun run test
```

Expected: all tests pass, including "every en key exists in es" and "every es key exists in en". A failure names the missing key.

- [ ] **Step 6: Check the raw JSON for a duplicate key** (the parser keeps the last one silently)

```bash
cd packages/i18n && for f in messages/en.json messages/es.json; do python3 - "$f" <<'EOF'
import json, sys, collections
pairs = collections.Counter()
def hook(items):
    for k, _ in items: pairs[k] += 1
    return dict(items)
json.load(open(sys.argv[1]), object_pairs_hook=hook)
dupes = [k for k, n in pairs.items() if n > 1 and k.startswith("home")]
print(sys.argv[1], "duplicates:", dupes)
EOF
done
```

Expected: `duplicates: []` for both files.

- [ ] **Step 7: Continue without committing**

This task verifies the baseline and changes no files. The first web commit and draft PR happen in Task A2. Agent B can begin its fact-only work before the PR number exists.

### Task A2: Moments becomes a band

**Files:**

- Modify: `apps/web-hono/src/components/home/moments.tsx`
- Modify: `apps/web-hono/src/components/home/moments.module.css`
- Keep untouched: `apps/web-hono/src/components/home/chapters.ts` (`NUMBERED` is still used by `chapter-strip.tsx`)

**Interfaces:**

- Consumes: `landing.homeEyebrow`, `homeMomentsLead`, `homeMomentsSerif`, `homeMomentsSub` (A1).
- Produces: a section `#moments` with no chips. Task A3 mounts Kai directly after it.

- [ ] **Step 1: Confirm who else uses `NUMBERED` before removing the chips**

```bash
rg -n "NUMBERED" apps/web-hono/src
```

Expected: `chapter-strip.tsx` and `moments.tsx`. Only `moments.tsx` loses its import; `chapters.ts` is not edited.

- [ ] **Step 2: Rewrite `moments.tsx`**

Replace the whole file with:

```tsx
import { useTranslations } from "@kaipu/i18n";

import styles from "./moments.module.css";

/**
 * The turn from the hero to the chapters: one promise, in one breath. It used to
 * be a second full-screen opening with the four chapter chips; the rail and the
 * mobile chapter strip already list the chapters, and a page that introduces
 * itself twice reads slow. So this is a band, and the next section (Kai) is the
 * first thing that scrolls into view after the hero.
 */
export function Moments() {
  const t = useTranslations("landing");

  return (
    <section id="moments" className={`${styles.band} kl-dots`}>
      <div className={styles.inner}>
        <p className={styles.eyebrow}>{t("homeEyebrow")}</p>
        <h2 className={styles.title}>
          {t("homeMomentsLead")} <span className={styles.serif}>{t("homeMomentsSerif")}</span>
        </h2>
        <p className={styles.sub}>{t("homeMomentsSub")}</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Rewrite `moments.module.css`**

Replace the whole file with (the `.title`/`.serif`/`.sub`/`.eyebrow` rules are the originals; only the container changes and the chip/glyph rules go):

```css
/*
 * A band between the hero and the Kai section: as tall as its three lines of
 * text and their breathing room, never a viewport. The previous version pinned
 * 92vh here, which put a second full screen between the opening and the first
 * product proof (home audit H13).
 */
.band {
  position: relative;
  display: grid;
  place-items: center;
  padding: 96px var(--kl-gutter) 72px;
  overflow: hidden;
}

.inner {
  position: relative;
  z-index: 1;
  max-width: 1120px;
  text-align: center;
}

.eyebrow {
  font-family: var(--kl-font-mono);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: var(--kl-tracking-label);
  text-transform: uppercase;
  color: var(--kl-faint);
}

/*
 * The page's voice in one rule: a tight sans statement, then a serif italic
 * answer in pink. Both live in the same heading because they are one sentence —
 * splitting them into two elements would let a screen reader read them as two.
 * An h2, not a second h1: the hero owns the page's title.
 */
.title {
  margin: 18px 0 0;
  font-size: var(--kl-fs-h2);
  font-weight: 700;
  line-height: var(--kl-leading-h);
  letter-spacing: var(--kl-tracking-h1);
  text-wrap: balance;
}

.serif {
  font-family: var(--kl-font-serif);
  font-size: var(--kl-fs-h2-serif);
  font-style: italic;
  font-weight: 400;
  letter-spacing: -0.01em; /* the serif is already open; it does not want the sans tracking */
  color: var(--kl-pink-tx);
}

.sub {
  max-width: 620px;
  margin: 26px auto 0;
  font-size: var(--kl-fs-body);
  line-height: var(--kl-leading-body);
  color: var(--kl-dim);
  text-wrap: pretty;
}

@media (width < 980px) {
  .band {
    padding: 64px 20px 48px;
  }
}
```

- [ ] **Step 4: Type-check and lint the app**

```bash
cd apps/web-hono && bun run check-types && cd ../.. && bun run lint
```

Expected: no errors. An unused-import error here means a leftover `lucide-react` or `chapters` import in `moments.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/web-hono/src/components/home/moments.tsx apps/web-hono/src/components/home/moments.module.css
git commit -m "feat(web): the moments intro is a band, not a second opening screen"
git push -u origin feat/home-kai-web
gh pr create --draft --title "feat(web): Kai meets the visitor — hero copy, a Kai section, the fox on camera" --body "Implements the web half of the plan at apps/documentation/src/content/docs/plans/2026-10-01-home-kai-and-hero-copy.md. The approved EN/ES catalog values were applied on main before this branch. Docs are reconciled in a separate PR by agent B."
```

Note the PR number; Agent B needs it.

### Task A3: The Kai section

**Files:**

- Create: `apps/web-hono/src/components/home/kai.tsx`
- Create: `apps/web-hono/src/components/home/kai.module.css`
- Modify: `apps/web-hono/src/routes/index.tsx:30-51` (mount order)
- Maybe delete: `apps/web-hono/src/components/landing/brand-origin.tsx` (only if nothing imports it)

**Interfaces:**

- Consumes: `landing.homeKaiHeading`, `homeKaiBody` (A1); `landing.originHeading`, `originFormula`, `originKayTerm`, `originKayBody`, `originKhipuTerm`, `originKhipuBody`, `originBody`, `originSignature`, `originNote` (existing); `KaipuLogo` from `@kaipu/brand`; `useReveal` from `./use-reveal`.
- Produces: `export function Kai()` rendering `<section id="kai">`. Nothing else depends on it.

- [ ] **Step 1: Check whether the old origin component still has a consumer**

```bash
rg -n "BrandOrigin|brand-origin" apps/web-hono/src
```

Expected: only its own file. If a route imports it, keep the file and skip Step 6.

- [ ] **Step 2: Write `kai.tsx`**

```tsx
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";

import { useReveal } from "./use-reveal";
import styles from "./kai.module.css";

/**
 * Who Kai is, and where the name comes from — the page's third section, between
 * the moments band and chapter 01, so the character is met before he shows up
 * on camera in the recording illustration.
 *
 * The origin block reuses the `origin*` messages that the earlier home carried
 * in `BrandOrigin`: one etymology, one set of strings, as brand-identity.md
 * requires. Kai makes no product claim here beyond what the app does today —
 * the menu-bar mark reflects the selected recording or screenshot mode.
 */
export function Kai() {
  const t = useTranslations("landing");
  const { ref, shown } = useReveal<HTMLElement>();

  return (
    <section id="kai" className={`${styles.section} kl-dots`}>
      <div className={styles.grid}>
        {/* The figure reveals; the text does not, so a visitor without script
            still reads the section. */}
        <figure ref={ref} className={`${styles.stage} kl-reveal`} data-kl-shown={shown}>
          <KaipuLogo use="product" size={240} className={styles.fox} />
        </figure>

        <div>
          <h2 className={styles.title}>{t("homeKaiHeading")}</h2>
          <p className={styles.body}>{t("homeKaiBody")}</p>

          <div className={styles.origin}>
            <p className={styles.eyebrow}>{t("originHeading")}</p>
            <p className={styles.formula}>{t("originFormula")}</p>
            <dl className={styles.terms}>
              <div className={styles.term}>
                <dt className={styles.termName}>{t("originKayTerm")}</dt>
                <dd className={styles.termBody}>{t("originKayBody")}</dd>
              </div>
              <div className={styles.term}>
                <dt className={styles.termName}>{t("originKhipuTerm")}</dt>
                <dd className={styles.termBody}>{t("originKhipuBody")}</dd>
              </div>
            </dl>
            <p className={styles.originBody}>{t("originBody")}</p>
            <p className={styles.signature}>{t("originSignature")}</p>
            <p className={styles.note}>{t("originNote")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Write `kai.module.css`**

```css
/*
 * Kai sits on the base surface between the moments band and chapter 01: the fox
 * at the left, the introduction and the name's origin at the right. Compact on
 * purpose — it is the third section and the product proof is next.
 */
.section {
  position: relative;
  padding: 72px var(--kl-gutter) 110px;
  overflow: hidden;
}

.grid {
  position: relative;
  z-index: 1;
  display: grid;
  max-width: var(--kl-max-w);
  margin: 0 auto;
  align-items: center;
  gap: 64px;
  grid-template-columns: 240px minmax(0, 1fr);
}

.grid > * {
  min-width: 0;
}

.stage {
  margin: 0;
}

/* The same pink lift the hero's mark carries, so the two read as one character. */
.fox {
  box-shadow: 0 26px 60px -20px rgb(246 5 92 / 0.85);
}

.title {
  margin: 0;
  font-size: var(--kl-fs-h2);
  font-weight: 700;
  line-height: var(--kl-leading-h);
  letter-spacing: var(--kl-tracking-h2);
}

.body {
  max-width: 560px;
  margin-top: 20px;
  font-size: var(--kl-fs-body);
  line-height: var(--kl-leading-body);
  color: var(--kl-dim);
  text-wrap: pretty;
}

.origin {
  max-width: 560px;
  margin-top: 36px;
  padding-top: 28px;
  border-top: 1px solid var(--kl-bd);
}

.eyebrow {
  margin: 0;
  font-family: var(--kl-font-mono);
  font-size: 12.5px;
  letter-spacing: var(--kl-tracking-label);
  text-transform: uppercase;
  color: var(--kl-faint);
}

.formula {
  margin: 12px 0 0;
  font-family: var(--kl-font-mono);
  font-size: 13px;
  color: var(--kl-faint);
}

.terms {
  display: grid;
  gap: 18px;
  margin: 18px 0 0;
  grid-template-columns: 1fr 1fr;
}

.term {
  margin: 0;
}

.termName {
  font-family: var(--kl-font-serif);
  font-size: 22px;
  font-style: italic;
  color: var(--kl-pink-tx);
}

.termBody {
  margin: 6px 0 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--kl-dim);
}

.originBody {
  margin: 18px 0 0;
  font-size: 15.5px;
  line-height: 1.55;
  color: var(--kl-tx);
  text-wrap: pretty;
}

.signature {
  margin: 14px 0 0;
  font-family: var(--kl-font-serif);
  font-size: 24px;
  font-style: italic;
  color: var(--kl-pink-tx);
}

.note {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--kl-faint);
}

@media (width < 1080px) {
  .grid {
    grid-template-columns: 1fr;
    gap: 40px;
  }

  .stage {
    justify-self: start;
  }

  .fox {
    width: 160px;
    height: 160px;
  }
}

@media (width < 980px) {
  .section {
    padding: 48px 20px 70px;
  }

  .terms {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Mount it in `routes/index.tsx`**

Add the import next to the other home imports and place `<Kai />` between `<Moments />` and the first `<Chapter>`:

```tsx
import { Kai } from "@/components/home/kai";
```

```tsx
    <HomeShell>
      <Hero />
      <Moments />
      <Kai />
      <Chapter id="record" tint="c1" number="01" icon={Video} keyPrefix="homeChapter1">
```

- [ ] **Step 5: Type-check, lint, and look at it**

```bash
cd apps/web-hono && bun run check-types && cd ../.. && bun run lint
bun run dev:web-hono
```

Open `http://localhost:3000/` at 1440×900. Expected: after the hero and the band, "Meet Kai." with the fox at the left, the body, then "Where the name comes from" with _kay_ / _khipu_, the one-sentence origin, "This. Captured." in pink serif, and the small disclaimer. Scroll past: the fox lifts in once (reveal), never again.

- [ ] **Step 6: Delete the unmounted `BrandOrigin` if Step 1 found no consumer**

```bash
git rm apps/web-hono/src/components/landing/brand-origin.tsx
cd apps/web-hono && bun run check-types
```

Expected: no errors (nothing imported it). If this step was skipped, say so in the PR body.

- [ ] **Step 7: Commit**

```bash
git add apps/web-hono/src/components/home/kai.tsx apps/web-hono/src/components/home/kai.module.css apps/web-hono/src/routes/index.tsx
git commit -m "feat(web): meet Kai — the fox and the name's origin as the home's third section"
```

### Task A4: Kai on camera

**Files:**

- Modify: `apps/web-hono/src/components/home/mock-record.tsx:6-12,112-116`
- Modify: `apps/web-hono/src/components/home/mocks.module.css:290-306` and the `.bubble` rule in the `< 980px` block (~line 782)

**Interfaces:**

- Consumes: `KaipuLogo` (`use="product"`), which renders an `<img>` with `width`/`height` attributes and an inline `borderRadius: size * 0.22` that a later `style` prop overrides.
- Produces: nothing.

- [ ] **Step 1: Replace the placeholder in `mock-record.tsx`**

Replace lines 112–116:

```tsx
      <div className={styles.bubble}>
        Your face
        <br />
        <span style={{ opacity: 0.7, fontSize: 10 }}>or browse files</span>
      </div>
```

with:

```tsx
      {/* The real product surface is a live webcam bubble. This marketing
          illustration uses Kai as an intentionally nonliteral sample subject. */}
      <div className={styles.bubble}>
        <KaipuLogo
          use="product"
          size={92}
          className={styles.bubbleFox}
          style={{ borderRadius: 999 }}
        />
      </div>
```

`style` is spread after the component's own inline `borderRadius`, so this is how a caller makes the mark round without `!important`.

And update the file's header comment so the last line reads `and the camera bubble, with Kai in it.` (`KaipuLogo` is already imported at the top of the file.)

- [ ] **Step 2: Make the bubble clip the image**

Replace the `.bubble` rule at ~line 290 of `mocks.module.css`:

```css
/* The camera bubble, ringed so it reads as a live circle. The fox fills it and
 * is clipped round: the PNG's own rounded corners would otherwise show as a
 * square inside the ring, and at the 72px mobile size that is all you'd see. */
.bubble {
  position: absolute;
  right: 22px;
  bottom: 24px;
  width: 96px;
  height: 96px;
  overflow: hidden;
  border: 2px solid var(--kl-pink);
  border-radius: 999px;
  background: #0e0e11;
}

.bubbleFox {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

The `< 980px` override keeps `right`, `bottom`, `width: 72px`, `height: 72px`; delete its `font-size: 10px` line.

- [ ] **Step 3: Check it in the browser at both sizes**

With the dev server running, open chapter 01 at 1440×900 and at 390×844 (DevTools device toolbar). Expected: a pink ring with the pink fox avatar fully round at both sizes; no square corners, no text. Compare against the owner's screenshot in the plan's origin conversation: same position over the "Order" card, next to the recording bar.

- [ ] **Step 4: Commit**

```bash
git add apps/web-hono/src/components/home/mock-record.tsx apps/web-hono/src/components/home/mocks.module.css
git commit -m "feat(web): Kai on camera — the recording illustration's bubble shows the fox instead of a placeholder"
```

### Task A5: The closing celebrates with `done`

**Files:**

- Modify: `apps/web-hono/src/components/home/closing.tsx:22`

- [ ] **Step 1: Swap the purpose**

```tsx
          <KaipuLogo use="done" size={112} className={`${styles.logo} kl-anim-float`} />
```

Add one line above it:

```tsx
          {/* `done`, once: the quiet celebration the audit asked for at the close. */}
```

- [ ] **Step 2: Check reduced motion**

In DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce". Expected: the `done` mark stops floating (the existing rule in `landing-effects.css` covers `.kl-anim-float`). Nothing else on the page moves.

- [ ] **Step 3: Commit**

```bash
git add apps/web-hono/src/components/home/closing.tsx
git commit -m "feat(web): the closing's mark is Kai's done moment, not the app icon again"
```

### Task A6: Verify, screenshot, hand off

**Files:** none new. Evidence goes in the PR.

- [ ] **Step 1: Full verification**

```bash
bun run verify
```

Expected: workflows check, lint, `oxfmt --check`, package builds, type checks and tests all pass. If `oxfmt --check` fails, run `bun run format` and amend.

- [ ] **Step 2: Screenshots for the owner (Review Focus 1–3)**

With `bun run dev:web-hono` running, capture and attach to the PR:

| Viewport | Locale                                             | What to look at                                                                                             |
| -------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1440×900 | en                                                 | Hero, band, Kai section, chapter 01 bubble, closing `done`                                                  |
| 1280×800 | en                                                 | The hero identity row: the category eyebrow stays on one line beside the mark; the mockup is above the fold |
| 1440×900 | es (`document.cookie = "KAIPU_LOCALE=es"`, reload) | "Conoce a Kai.", "Sigue con lo tuyo.", no raw key names                                                     |
| 390×844  | es                                                 | The band, the Kai section stacked (fox 160px, text below), the 72px bubble round                            |

If the 1280×800 eyebrow wraps, shorten nothing: reduce `.eyebrow` to `font-size: 12px` in `hero.module.css` and re-shoot, and note it under Deviation.

- [ ] **Step 3: The `Copy contract verified` comment** (Coordination protocol §3)

```bash
gh pr comment <A> --body "## Copy contract verified

The rendered home consumes the EN/ES values that were applied to main before this branch. This PR did not edit the catalogs.

| Key | EN | ES |
| --- | --- | --- |
| homeHeroEyebrow | Screen recording & screenshots for Mac | Grabación de pantalla y capturas para Mac |
| homeHeroSerif | Get back to work. | Sigue con lo tuyo. |
| homeHeroBody | Record a bug. Explain a change. Annotate a screenshot. Turn what’s on your screen into something clear to share and easy to find again. | Graba un error. Explica un cambio. Anota una captura. Convierte lo que ves en algo claro para compartir y fácil de encontrar después. |
| homeHeroCtaPrimary | Download Kaipu for Mac | Descargar Kaipu para Mac |
| homeMomentsSub | Some things take three paragraphs to explain and ten seconds to show. Kaipu is for those moments. | Hay cosas que toman tres párrafos explicar y diez segundos mostrar. Kaipu es para esos momentos. |
| homeKaiHeading (new) | Meet Kai. | Conoce a Kai. |
| homeKaiBody | Kai is the fox behind Kaipu, the companion for moments worth capturing. You’ll see him in the menu bar when you choose recording or screenshot mode. | Kai es el zorro de Kaipu, el compañero de los momentos que vale la pena capturar. Lo verás en la barra de menús cuando elijas el modo de grabación o de captura de pantalla. |

Reused unchanged: originHeading, originFormula, originKayTerm, originKayBody, originKhipuTerm, originKhipuBody, originBody, originSignature, originNote.
Removed: the hardcoded \"Your face / or browse files\".
Deviations: none."
```

If anything differs from the contract, stop and report a Deviation instead of changing the catalogs on this branch.

- [ ] **Step 4: Mark the PR ready with a handoff body** (use the `cs-write-handoff` skill: what changed, where to start reviewing, how to check, safe to merge?). Link this plan and name Agent B's PR once it exists.

```bash
gh pr ready <A>
```

---

# Agent B — docs

Working directory: the monorepo root. Start:

```bash
git checkout main && git pull --ff-only
git config user.email            # must print cristiansotomayor.dev@gmail.com
gh auth status                   # must show csdev19 active
git checkout -b docs/home-kai-reconcile
bun install
A=$(gh pr list --head feat/home-kai-web --json number --jq '.[0].number'); echo "Agent A's PR: #$A"
```

If `$A` is empty, Agent A has not opened its draft yet: start with Task B1 (which needs no PR number) and re-run the lookup before Task B2.

Read first, in this order: this plan's Decisions and Copy contract; `marketing/brand-identity.md`; `marketing/brand-and-kai.md`; the home audit's H11–H13 and "Kai recommendation"; `plans/2026-09-30-home-conversion-review.md` slice 4; `backlog/marketing-landing.md`. The fact that settles every edit: `packages/brand/src/index.ts` on `main` ships a **fox** with seven purposes (`app`, `product`, `micro`, `record`, `screenshot`, `permissions`, `done`) backed by six PNGs and two monochrome SVGs; the knot was never drawn.

Docs build check used by every task:

```bash
cd apps/documentation && bun run build
```

Expected: Astro builds with no broken-link or frontmatter error. (The Starlight sidebar autogenerates `marketing/`, `plans/`; `backlog/` pages are listed by hand in `astro.config.mjs` — no new page is added by this plan, so no sidebar edit.)

### Task B1: `brand-identity.md` records that Kai is the fox

**Files:**

- Modify: `apps/documentation/src/content/docs/marketing/brand-identity.md` — the top banner (line 8), "Where this identity is published" (lines 41–56), "Visual identity and Kai" (lines 73–83)

- [ ] **Step 1: The banner**

Replace line 8's sentence `The meaning is settled; the final visual design remains to be selected and integrated.` with:

```markdown
The meaning is settled. The visual identity is settled too, since 2026-10-01: Kai is the fox shipped in `packages/brand` (see [Visual identity and Kai](#visual-identity-and-kai)).
```

- [ ] **Step 2: "Where this identity is published"**

Replace the "Current home status (2026-09-30)" paragraph (line 43) with:

```markdown
**Home status (2026-10-01):** the four-moments home carries the identity in its third section, "Meet Kai" (`apps/web-hono/src/components/home/kai.tsx`), which reuses the `landing.origin*` messages and shows the signature "This. Captured." in place. The unmounted `BrandOrigin` component is retired from the home. The home-specific footer does not render `footerSignature`, but `components/landing/footer.tsx` still uses that key on routes mounted through `PublicShell`. Nothing else changed in the adopted meaning. Shipped in [PR #A](https://github.com/niway-dev/kaipu-record/pull/A).
```

Replace `A` with Agent A's PR number here and in every later task; Task B6 greps for leftovers.

Replace the table's third row (`Landing #origin section and footer signature (EN/ES)`) with:

```markdown
| Home "Meet Kai" section (EN/ES) | The public origin story and coined-name qualification beside the character | `apps/web-hono/src/components/home/kai.tsx` |
| Public-shell footer signature (EN/ES) | The compact brand signature on other public routes | `apps/web-hono/src/components/landing/footer.tsx` |
```

Keep the wording-location sentence as: `Landing wording lives in packages/i18n/messages/{en,es}.json under landing.origin*, landing.homeKai*, and landing.footerSignature`.

- [ ] **Step 3: "Visual identity and Kai"**

Replace the section body (everything from `Keep **Kaipu**...` to `...a reason to regenerate artwork from scratch.`) with:

```markdown
Keep **Kaipu**, **kaipu.app**, the pink recognition cue, and both light/dark themes. Existing design tokens remain the implementation authority for color and contrast; this document does not redefine them.

**Kai is a fox.** Adopted by the creator on 2026-10-01, when the artwork already shipped in `packages/brand` became the identity the product and the website use everywhere. The small-knot direction explored on 2026-09-27, and the vizcacha before it, are closed: the knot lives on in the name's meaning — the khipu — not in the character. The [exploration page](/marketing/brand-and-kai/) keeps that history as history.

The artwork is a black fox bust on Kaipu pink, a flat silhouette with two cream eyes. `@kaipu/brand` resolves it by **purpose**, never by file name (`packages/brand/src/index.ts`):

| Purpose                 | Artwork                                   | Where                                                 |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------- |
| `app`                   | the fox with frame corners and record dot | Dock, ⌘-Tab, DMG, the hero's identity row             |
| `product` · `micro`     | the plain fox                             | navbars, the desktop sidebar, favicons, Kai on camera |
| `record` · `screenshot` | capture-mode marks                        | the menu bar when recording or screenshot mode is selected |
| `permissions` · `done`  | moment marks                              | onboarding; `done` once in the home's closing         |

Where Kai appears, and what he does not do:

- **Website:** a dedicated "Meet Kai" introduction after the hero's transition; Kai as an intentionally nonliteral subject in the recording illustration's camera bubble; `done` in the closing invitation. No floating mascot, no constant animation.
- **App:** the menu-bar mark follows the capture mode; `permissions` and `done` open and close onboarding.
- **Never** as an assistant, a chatbot, automatic editing, or a promise that a recording cannot be lost.

Approved one-line introduction — EN: "Kai is the fox behind Kaipu, the companion for moments worth capturing." ES: «Kai es el zorro de Kaipu, el compañero de los momentos que vale la pena capturar.» It replaces the earlier knot caption ("Kai ties a knot so that moment isn't lost"), which described a character that was never drawn. The full landing copy is `landing.homeKaiBody`.

Still missing, tracked in [Marketing landing — Open](/backlog/marketing-landing/#open): the pink lockup as SVG, a cropped fox head for a true favicon, and a monochrome plain fox for the idle menu-bar state. An asset refresh alone does not reopen this decision.
```

- [ ] **Step 4: Build the docs and commit**

```bash
cd apps/documentation && bun run build && cd ../..
git add apps/documentation/src/content/docs/marketing/brand-identity.md
git commit -m "docs(marketing): Kai is the fox — brand-identity records the shipped artwork instead of the knot exploration"
```

### Task B2: `brand-and-kai.md` becomes history

**Files:**

- Modify: `apps/documentation/src/content/docs/marketing/brand-and-kai.md` — banner (line 8), the Website row of "Where Kai could help" (line 22), the "Peruvian-inspired directions" intro (line 56), the "Ready-to-use image prompt" intro (line 69)

- [ ] **Step 1: The banner**

Replace line 8 with:

```markdown
**Exploration · 2026-09-27 · closed 2026-10-01.** The name and origin are settled in the [canonical brand identity](/marketing/brand-identity/), and so is the character: **Kai is the fox** shipped in `packages/brand`. The knot and vizcacha directions below, and the image prompts, are kept as the record of how the choice was made; they are not open work. What still applies from this page is the restraint: a companion beside the product story, never a second product name, a new domain, or an assumed AI assistant.
```

- [ ] **Step 2: The Website row**

Replace the table row that starts `| Website |` with:

```markdown
| Website                       | "Meet Kai" after the hero; the fox on camera in the recording illustration; `done` at the close | The product demo remains the primary proof; no floating mascot |
```

- [ ] **Step 3: Mark the directions and prompts as history**

Replace line 56 (`**Owner follow-up · 2026-09-27:** explore pixel art and a Peruvian connection. These are concept candidates, not a selected logo.`) with:

```markdown
**Owner follow-up · 2026-09-27, resolved 2026-10-01 by the fox.** These were concept candidates while the character was open; none is a selected logo.
```

Replace line 69 (`Use this only if the supplied artwork needs further exploration. ...`) with:

```markdown
Historical. The supplied artwork settled the character on 2026-10-01; regenerate nothing from these prompts. They stay so a later reader can see what was tried and why the fox was not a knot.
```

- [ ] **Step 4: Build and commit**

```bash
cd apps/documentation && bun run build && cd ../..
git add apps/documentation/src/content/docs/marketing/brand-and-kai.md
git commit -m "docs(marketing): the Kai exploration is closed — the page keeps the knot and vizcacha as history"
```

### Task B3: The rollout plan says where things stand

**Files:**

- Modify: `apps/documentation/src/content/docs/plans/2026-09-27-brand-and-website-rollout.md` — status banner (line 8) and section B
- Read only: `apps/documentation/src/content/docs/plans/2026-09-30-home-conversion-review.md` — its banner and slice 4 already route work to the two current plans

- [ ] **Step 1: Read section B of the rollout plan in full and verify each item against `main`**

```bash
sed -n '/^## B/,/^## C/p' apps/documentation/src/content/docs/plans/2026-09-27-brand-and-website-rollout.md
ls packages/brand/assets
git log --oneline -5 -- packages/brand apps/kaipu-record/src/main | cat
```

Tick (`[x]`) only items the repo proves: the asset inventory (six PNGs and two monochrome SVGs; the seven purposes share those assets because `product` and `micro` both resolve to `logo-plain.png`), the selection of the fox (`packages/brand/src/index.ts`), and the menu-bar capture-mode marks. Leave unticked anything about the desktop bundle icon, SVG lockup, or favicon crop — `backlog/marketing-landing.md` lists them as still missing.

- [ ] **Step 2: The rollout plan's banner**

Replace line 8's status sentence with:

```markdown
**Status: 🟡 In progress · updated 2026-10-01.** Identity documentation, README correction, EN/ES landing copy, the four-moments home, `@kaipu/brand` with the fox, and the menu-bar capture-mode marks are on `main`. The home's Kai section and hero copy ship in [PR #A](https://github.com/niway-dev/kaipu-record/pull/A). Still pending: the desktop bundle icon export, the SVG lockup and favicon crop, and media production. Parent: [Product growth](/backlog/product-growth/).
```

Also replace the sentence `The preferred mascot exploration is a small living knot; final artwork is not selected by this plan.` in "Goal and settled inputs" with `The character is the fox shipped in `packages/brand` (adopted 2026-10-01).`

- [ ] **Step 3: Verify the historical home plan already delegates ownership**

Read its status banner and slice 4. They must point the focused slice to this plan and the remaining conversion work to v2. Do not edit that historical plan from Agent B's branch.

- [ ] **Step 4: Build and commit**

```bash
cd apps/documentation && bun run build && cd ../..
git add apps/documentation/src/content/docs/plans/2026-09-27-brand-and-website-rollout.md
git commit -m "docs(plans): the brand rollout records the selected fox and the focused Kai delivery"
```

### Task B4: The copy review and the audit mark what shipped

**Files:**

- Modify: `apps/documentation/src/content/docs/marketing/home-copy-review.md` — banner (line 8), the "Proposed changes" table, the "New copy slots" table rows for `homeKaiHeading`/`homeKaiBody`, the camera bullet (line 99)
- Modify: `apps/documentation/src/content/docs/marketing/home-conversion-audit.md` — rows H11, H12, H13

- [ ] **Step 1: Copy-review banner**

Replace line 8 with:

```markdown
**Proposed copy · 2026-09-30 · partially applied 2026-10-01.** The rows marked **applied** below landed in the catalogs with the [Kai plan](/plans/2026-10-01-home-kai-and-hero-copy/) before the web implementation branch. Compare the plan's Copy contract with `packages/i18n/messages/{en,es}.json` when in doubt. Everything else remains a proposal. Pair with the [audit](/marketing/home-conversion-audit/) and the [conversion umbrella](/plans/2026-10-01-home-conversion-v2/). Keep the current visual design; select wording by meaning, not by identical character counts.
```

- [ ] **Step 2: The "Proposed changes" table**

Change these rows so the Key cell reads `homeHeroSerif` → `homeHeroSerif **(applied, ES only)**` and `homeHeroBody` → `homeHeroBody **(applied)**`. In the `homeHeroBody` row, replace the EN text with the shipped one: `Record a bug. Explain a change. Annotate a screenshot. Turn what’s on your screen into something clear to share and easy to find again.` and the ES with `Graba un error. Explica un cambio. Anota una captura. Convierte lo que ves en algo claro para compartir y fácil de encontrar después.` (the proposal said "send"; the owner chose "share").

Add two rows at the end of that table:

```markdown
| `homeHeroEyebrow` **(applied)** | Screen recording & screenshots for Mac | Grabación de pantalla y capturas para Mac |
| `homeHeroCtaPrimary` **(applied)** | Download Kaipu for Mac | Descargar Kaipu para Mac |
| `homeMomentsSub` **(applied)** | Some things take three paragraphs to explain and ten seconds to show. Kaipu is for those moments. | Hay cosas que toman tres párrafos explicar y diez segundos mostrar. Kaipu es para esos momentos. |
```

- [ ] **Step 3: The "New copy slots" table**

Replace the `homeHeroCategory` row's Condition with `Applied as the value of the existing `homeHeroEyebrow` — no new key` and the two Kai rows with:

```markdown
| `homeKaiHeading` **(applied)** | Meet Kai.                                                                                                                                     | Conoce a Kai.                                                                                                                                       | Third section of the home, after the moments band             |
| `homeKaiBody` **(applied)** | Kai is the fox behind Kaipu, the companion for moments worth capturing. You’ll see him in the menu bar when you choose recording or screenshot mode. | Kai es el zorro de Kaipu, el compañero de los momentos que vale la pena capturar. Lo verás en la barra de menús cuando elijas el modo de grabación o de captura de pantalla. | Names only what the app does today; no AI or reliability claim |
```

- [ ] **Step 4: The camera bullet**

Replace line 99 (`- Replace the camera's unfinished "Your face / or browse files" ...`) with:

```markdown
- **Applied:** the camera bubble shows Kai (`KaipuLogo use="product"`), decorative, with no text to localize.
```

- [ ] **Step 5: Audit rows H11–H13**

Append to the end of the "Finding and recommended response" cell of each row, without rewriting the finding:

- H11: ` **Camera illustration resolved in PR #A (Kai on camera); the capture-to-output proof remains open.**`
- H12: ` **Resolved in PR #A: the "Meet Kai" section reuses the origin keys.**`
- H13: ` **Resolved in PR #A: a band with an h2.**`

- [ ] **Step 6: Build and commit**

```bash
cd apps/documentation && bun run build && cd ../..
git add apps/documentation/src/content/docs/marketing/home-copy-review.md apps/documentation/src/content/docs/marketing/home-conversion-audit.md
git commit -m "docs(marketing): the copy review and audit mark the hero copy, Kai section and camera bubble as shipped"
```

### Task B5: Backlog status and the index row

**Files:**

- Modify: `apps/documentation/src/content/docs/backlog/marketing-landing.md` — the two banners (lines 8–16), the "Open" list
- Modify: `apps/documentation/src/content/docs/backlog/index.mdx` — the "Landing de marketing" row (line ~116)

- [ ] **Step 1: One banner instead of two**

Replace lines 8–16 (both `>` blocks) with a single block:

```markdown
> **Status: 🟡 In progress** — the four-moments home merged in
> [PR #196](https://github.com/niway-dev/kaipu-record/pull/196). The focused Hero,
> Moments, Kai, camera, closing, and documentation slice follows in
> [PR #A](https://github.com/niway-dev/kaipu-record/pull/A). Remaining conversion work is
> owned by [Home conversion and Kai implementation v2](/plans/2026-10-01-home-conversion-v2/).
> Current unresolved items remain in [Open](#open).
>
> Supersedes [Landing redesign — feature showcase with looping demos](./landing-redesign):
> that page's components were deleted on this branch.
```

- [ ] **Step 2: The Open list**

Remove the bullet `**Two desktop E2E failures block git push**` (PR #196 merged; it is not a current blocker) and the bullet `**The rail's active-chapter label collides with the mockup**` only if `git log --oneline -3 -- apps/web-hono/src/components/home/rail.tsx` shows `fb43e4d` or `9ed5a6c` (the hover label fix) — it does on `main` at the time of writing. Keep the bundle icon, missing assets, Caveat and mobile-CTA bullets. Add:

```markdown
- **The five mockups still speak English in Spanish** (audit H06). Deliberately left out of
  the Kai PR; it is the next landing PR.
```

- [ ] **Step 3: The index row**

Replace the `**Landing de marketing**` row's status cell with `🟡 In progress · #196 merged · focused Kai slice in #A · conversion v2 remains`. (The index is legacy Spanish; do not translate the rest of the table in this PR.)

- [ ] **Step 4: Build and commit**

```bash
cd apps/documentation && bun run build && cd ../..
git add apps/documentation/src/content/docs/backlog/marketing-landing.md apps/documentation/src/content/docs/backlog/index.mdx
git commit -m "docs(backlog): keep the marketing landing in progress while the focused Kai slice and conversion v2 remain"
```

### Task B6: Verify against Agent A, hand off

- [ ] **Step 1: Compare the catalogs with the Copy contract** (Coordination protocol §3)

```bash
git show main:packages/i18n/messages/en.json | rg 'homeHeroEyebrow|homeHeroBody|homeHeroCtaPrimary|homeMomentsSub|homeKai'
git show main:packages/i18n/messages/es.json | rg 'homeHeroEyebrow|homeHeroSerif|homeHeroBody|homeHeroCtaPrimary|homeMomentsSub|homeKai'
```

Every EN/ES value documented in B1 and B4 must match the catalogs character for character. Also read Agent A's `Copy contract verified` or `Deviation` comment before finalizing.

- [ ] **Step 2: Confirm no placeholder `#A` is left**

```bash
rg -n "PR #A\b|pull/A\b|#A\b" apps/documentation/src/content/docs
```

Expected: no matches.

- [ ] **Step 3: Full verification and push**

```bash
bun run verify
git push -u origin docs/home-kai-reconcile
gh pr create --draft --title "docs(marketing): the fox is Kai — reconcile brand docs with the shipped home" --body "Depends on #$A.

Implements the docs half of apps/documentation/src/content/docs/plans/2026-10-01-home-kai-and-hero-copy.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Ready only after #A merges** (Coordination protocol §4). Then write the handoff body with the `cs-write-handoff` skill and:

```bash
gh pr ready <B>
```

---

## Out of scope (do not drift into these)

- Translating the five mockups (audit H06) — next PR.
- The light theme for the landing, the mobile copy-link action (H02), architecture selection (H03), the FAQ, the price strip, the capture-to-output proof.
- New artwork: the SVG lockup, a cropped fox head, a monochrome idle fox, the desktop bundle icon.
- Any change to the adopted meaning of the name, or to `landing.origin*` values.
- Translating `backlog/index.mdx`.

## Self-review record (plan author, 2026-10-01)

- Spec coverage: decisions 1–9 map to A2 (1, 2), A4 (3), A1 (4, 5, 6), A3 (6), A5 (7), B1–B2 (8), Out of scope (9).
- Review Focus 1–5 each name the task and the check that pins them; no automated test exists in `apps/web-hono`, and the plan says so instead of inventing one.
- Names used across tasks: `Kai` / `kai.tsx` / `#kai` (A3, index.tsx, B1); `styles.bubbleFox` (A4 tsx and css); `homeKaiHeading` / `homeKaiBody` (A1, A3, A6 comment, B1, B4).
