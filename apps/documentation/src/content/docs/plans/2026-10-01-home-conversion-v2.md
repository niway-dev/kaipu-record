---
title: Home conversion and Kai implementation v2
description: Umbrella plan for the conversion work that follows the focused Hero, Moments, Kai, camera, closing, and documentation delivery.
---

# Home conversion and Kai implementation v2

**Status: Umbrella for later conversion work · 2026-10-01.** The focused [Home: Kai, the hero copy, and the fox on camera](/plans/2026-10-01-home-kai-and-hero-copy/) plan is the execution contract for the Hero copy, compact Moments band, third-section Kai introduction, camera-bubble illustration, closing `done` mark, and their documentation reconciliation. This plan begins from that delivered state and owns the remaining conversion work: release evidence, mockup localization and continuity, controls and downloads, completed-output proof, trust and FAQ content, accessibility, and final status reconciliation. The [2026-09-30 home review](/plans/2026-09-30-home-conversion-review/) is historical context only.

Delete this working plan in the shipping PR after lasting product and brand knowledge has been folded into the relevant reference pages. Git history will preserve the execution record.

## One-minute summary

Keep the current four-moments visual system. Make the home easier to understand and trust by tightening the opening, introducing the existing fox Kai as a compact third section, completing EN/ES coverage, fixing download actions, showing one genuine output, and answering the four questions that block installation. Do not redesign the site or generate new mascot art.

The required page order is:

1. Hero
2. Shortened Moments transition
3. Compact Kai and brand-origin section
4. Record, Capture, Edit, and Find chapters
5. Local files
6. Completed-output proof, factual trust strip, and FAQ
7. Download close and footer

Items 1–3, Kai in the Record illustration's camera bubble, and the closing `done` mark are inputs from the focused plan, not implementation tasks in this umbrella.

## Scope lock

### Core problem

A new visitor can see polished product scenes but cannot yet determine quickly and reliably what Kaipu is, whether it fits their Mac, what happens to their files, or why Kai belongs to the product.

### Definition of done

A visitor can understand what Kaipu does, see a real result, choose the correct Mac download, understand account and local-file behavior, switch the whole page between English and Spanish, and recognize Kai's supporting role without playing an animation.

### Explicitly out of scope

- A whole-site redesign or replacement of the four-moments structure.
- New mascot artwork, a return to the knot concept, or a roaming Kai overlay.
- AI-assistant behavior or copy that makes Kai sound like a product capability.
- Audio boost or unrelated editor features.
- Automatic CPU-architecture detection.
- An email-delivery or Windows-notification backend.
- Pricing changes, testimonials, counters, comparison tables, or uplift claims.
- Windows release work, repository publication, or a StyleX migration.
- Refactoring the flat `landing` message namespace.

If implementation reveals another improvement, record it separately. Do not add it to this plan unless it blocks the definition of done.

## Current-state audit

The September documents described a mixture of proposed and completed work. Use this table instead of assuming every old checkbox remains valid.

| Area                                         | Current state                                                                                                  | V2 action                                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Four-moments layout and `--kl-*` style layer | Implemented                                                                                                    | Preserve                                                                                                                                               |
| Shared keyboard shortcuts                    | Implemented and tested                                                                                         | Preserve; do not invent a Library shortcut                                                                                                             |
| Editor mute                                  | Implemented in preview and export                                                                              | Keep truthful mute copy; packaged validation remains a release gate                                                                                    |
| Reviewed Hero and Moments copy               | Applied to the catalogs; web consumption is owned by the focused plan                                          | Preserve the committed catalog values                                                                                                                  |
| Text inside the five HTML mockups            | Hardcoded in English, except that the focused plan replaces the camera placeholder with decorative Kai artwork | Localize the remaining meaningful text and summaries                                                                                                   |
| Locale, theme, and mobile-menu controls      | Visually present but inert                                                                                     | Reuse existing persisted locale/theme mechanisms; implement or remove menu                                                                             |
| Download architecture choice                 | Only explicit in the closing section                                                                           | Route generic CTAs to the chooser; never force ARM64 silently                                                                                          |
| Mobile copy-link action                      | Not implemented                                                                                                | Implement with success, error, and selectable fallback                                                                                                 |
| Local-file and privacy wording               | Contains overclaims and a wrong fixed path                                                                     | Use factual configurable-library wording                                                                                                               |
| Example continuity and completed output      | Inconsistent; no genuine output proof                                                                          | Use one scenario and one actual output                                                                                                                 |
| Moments pacing and chapter chips             | Owned by the focused plan                                                                                      | Preserve the compact `h2` band without its duplicate chapter chips                                                                                     |
| Kai assets                                   | Implemented in `@kaipu/brand`                                                                                  | Preserve `product` in the Kai section and camera illustration, and `done` in the closing; `record` and `screenshot` remain desktop menu-bar mode marks |
| Kai section and visible brand origin         | Owned by the focused plan                                                                                      | Preserve the third-section `home/kai.tsx` implementation and its reused `landing.origin*` messages                                                     |
| Trust strip and FAQ                          | Missing                                                                                                        | Add only factual, verified claims and four questions                                                                                                   |
| Accessibility baseline                       | Partial                                                                                                        | Fix landmarks, illustration semantics, initial visibility, motion, and contrast                                                                        |

## Focused-slice copy contract

The Hero, Moments, and Kai wording is owned by [Home: Kai, the hero copy, and the fox on camera](/plans/2026-10-01-home-kai-and-hero-copy/#copy-contract). Its EN/ES values were applied to `packages/i18n/messages/{en,es}.json` before delegation. Do not restate, revise, or recreate those strings here; this umbrella consumes them as its baseline.

The Kai section reuses the existing `landing.origin*` messages, including `originFormula`, the signature, and the coined-name qualification. Do not add a second etymology or a parallel `homeKaiOrigin*` family.

### Existing copy replacements

Apply the still-relevant replacements from [Home copy review](/marketing/home-copy-review/), with these v2 rules:

- Keep `homeChapter3Pill3` as **Mute audio / Silenciar audio**. Mute now exists; never restore boost.
- Keep the real shared shortcut value. Do not replace it with translated prose or a new shortcut.
- Use **your local library folder / la carpeta de tu biblioteca local** instead of a fixed `~/Movies/Kaipu` path.
- Replace “nothing leaves your Mac” with a statement about recordings being saved locally. Optional Cloud and telemetry are separate behaviors.
- Replace the Windows notification promise with a link to the existing roadmap.
- Do not publish minimum-macOS, public-source, no-watermark, or signed/notarized claims until their individual evidence gates pass.
- In Spanish use “anota una captura,” “recuadros,” “clave de API,” and “recorta el inicio y el final” where those meanings apply.

### FAQ

Ship these four questions. Keep answers factual and short.

| Question                                                    | English answer                                                                                                       | Spanish answer                                                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| What can I do locally? / ¿Qué puedo hacer localmente?       | Record, annotate screenshots, edit, and export on your Mac.                                                          | Graba, anota capturas, edita y exporta en tu Mac.                                                                               |
| Do I need an account? / ¿Necesito una cuenta?               | Not to record, edit, or export locally. An account is used for optional cloud capabilities.                          | No para grabar, editar ni exportar en tu equipo. La cuenta se usa para las funciones opcionales de la nube.                     |
| Where are my files? / ¿Dónde están mis archivos?            | In your local library folder. Open it in Finder and use the files outside Kaipu.                                     | En la carpeta de tu biblioteca local. Ábrela en Finder y usa los archivos fuera de Kaipu.                                       |
| Does it work on my computer? / ¿Funciona en mi computadora? | Kaipu is available for Mac with separate Apple Silicon and Intel downloads. Follow the roadmap for Windows progress. | Kaipu está disponible para Mac con descargas separadas para Apple Silicon e Intel. Consulta el avance de Windows en el roadmap. |

Do not add “free” or “no watermark” to the first answer until the current public artifact passes the release gate.

## Implementation sequence

Complete the tasks in order unless a task explicitly says it can run in parallel. Keep commits aligned with these slices so a reviewer can verify one concern at a time.

### Task 1: Record release evidence

**Goal:** prevent implementation details from becoming unsupported marketing claims.

Files and references:

- `apps/web-hono/src/lib/download.ts`
- `apps/kaipu-record/e2e/mute-export.e2e.ts`
- `apps/documentation/src/content/docs/backlog/free-tier-no-watermark.md`
- `apps/documentation/src/content/docs/backlog/video-editor-mute.md`

Steps:

1. Verify that the ARM64 and Intel URLs resolve to the intended current artifacts.
2. Run the packaged mute-export validation and record whether exported audio is actually silent.
3. Validate the default watermark state in the same distributed build.
4. Determine minimum macOS support from a packaged artifact or release configuration, not from current marketing copy.
5. Record each result independently. A passing download check does not prove mute, watermark, or OS support.

This task may end with an unverified result. In that case, omit the related claim; do not block unrelated copy and Kai work.

**Acceptance:** every release-facing claim used later has named evidence, and every unverified claim remains absent.

### Task 2: Preserve the focused home slice

The focused plan delivers the compact Moments band without duplicate chapter chips, `home/kai.tsx` as the third section, reused `landing.origin*` messages, decorative Kai artwork in the Record camera bubble, and `done` in the closing.

This umbrella must not reimplement, rename, or revise that slice. Verify it as the starting state before proceeding to Task 3.

### Task 3: Apply bilingual copy and localize the illustrations

Files:

- `packages/i18n/messages/en.json`
- `packages/i18n/messages/es.json`
- `apps/web-hono/src/components/home/mock-record.tsx`
- `apps/web-hono/src/components/home/mock-capture.tsx`
- `apps/web-hono/src/components/home/mock-edit.tsx`
- `apps/web-hono/src/components/home/mock-find.tsx`
- `apps/web-hono/src/components/home/mock-finder.tsx`
- Other `apps/web-hono/src/components/home/*.tsx` consumers as required

Steps:

1. Preserve the Hero, Moments, and Kai catalog values shipped before delegation; apply only the still-relevant chapter, files, controls, and supporting-copy replacements from this plan.
2. Move meaningful mockup labels, statuses, explanatory prose, dates, and result counts into the `landing` catalog.
3. Keep stable fictional filenames unchanged only when they function as identifiers rather than prose.
4. Use one fictional scenario across Record, Capture, Edit, Find, and Finder.
5. Make Find's visible result count agree with title-only search behavior.
6. Preserve the focused plan's decorative Kai camera-bubble treatment. Localize the remaining meaningful Record-scene labels and its concise accessible summary; do not add replacement bubble text.
7. Add localized concise summaries for each illustration; decorative internals must not produce a long screen-reader transcript.
8. Audit the raw JSON for duplicate keys after editing.

**Acceptance:** switching locale changes all meaningful home content, including the product scenes and accessible summaries; no meaningful hardcoded English remains in home components.

### Task 4: Make controls and downloads truthful

Files:

- `apps/web-hono/src/components/home/top-nav.tsx`
- `apps/web-hono/src/components/home/hero.tsx`
- `apps/web-hono/src/components/home/sticky-cta.tsx`
- `apps/web-hono/src/components/home/closing.tsx`
- `apps/web-hono/src/components/locale-switcher.tsx`
- Existing theme control and locale persistence code
- `apps/web-hono/src/lib/download.ts`

Steps:

1. Connect home locale and theme controls to the existing persisted mechanisms. Do not introduce another store.
2. Make the active language reflect actual locale state.
3. Implement the mobile menu or remove its enabled-looking trigger.
4. Route generic desktop download actions to `#download`, where Apple Silicon and Intel are explicit.
5. Remove direct ARM64 downloads from generic hero, top-nav, and sticky actions.
6. Implement the mobile copy-link action with a live-region success message, an error state, and a selectable URL fallback when clipboard access fails.
7. Ensure the sticky action follows the same mobile flow.
8. If analytics already has an appropriate convention, track architecture selection and copy success/failure without filenames, recording content, or other user data. Do not introduce analytics infrastructure in this task.

**Acceptance:** every enabled control performs its label; viewport width never selects CPU architecture; locale and theme persist after reload.

### Task 5: Add proof, trust, and FAQ

Files:

- New focused components under `apps/web-hono/src/components/home/`
- `apps/web-hono/src/routes/index.tsx`
- `packages/i18n/messages/en.json`
- `packages/i18n/messages/es.json`

Steps:

1. Produce or select one genuine Kaipu-generated output using invented, non-sensitive sample data.
2. Present it static-first with a useful poster or still. If motion is added, provide controls and a reduced-motion fallback.
3. Show the relationship between the captured problem and delivered file. HTML mockups remain illustrations and must not be presented as evidence.
4. Add a compact trust strip using only evidence that passed Task 1. Local use without an account may be stated independently of release-only claims.
5. Add the approved four-question FAQ.
6. Preserve the single `KaipuLogo use="done"` placement in the closing delivered by the focused plan. Do not add another `done` mark beside the completed-output proof.
7. Do not add `record` or `screenshot` artwork to the web chapters. Those variants represent the desktop menu-bar modes; the chapter illustrations remain product demonstrations rather than menu-bar state reproductions.

**Acceptance:** a visitor can identify the input, the delivered result, local-file behavior, account requirement, and correct download without playing media.

### Task 6: Fix accessibility and resilient rendering

Files:

- `apps/web-hono/src/components/home/home-shell.tsx`
- `apps/web-hono/src/components/home/chapter.tsx`
- `apps/web-hono/src/components/home/rail.tsx`
- `apps/web-hono/src/components/home/use-reveal.ts`
- `apps/web-hono/src/styles/landing-effects.css`
- `apps/web-hono/src/styles/landing-tokens.css`
- Relevant component CSS modules

Steps:

1. Add a skip link to the existing main landmark.
2. Group each product illustration under its localized summary and hide decorative descendants.
3. Make useful content visible in the server-rendered baseline. JavaScript may enhance a reveal, but must not be required to reveal the content.
4. Use real section anchors for rail navigation and avoid forcing smooth JavaScript scrolling.
5. Make decorative motion finite or suppress it under reduced motion.
6. Fix normal-text contrast for faint text and text on pink buttons in rendered dark and light states.
7. Check that sticky controls do not obscure focused content and that fake UI controls remain outside keyboard navigation.

**Acceptance:** the page remains understandable with JavaScript disabled, is operable by keyboard, and meets WCAG AA contrast for normal text.

### Task 7: Reconcile documentation and tests

Files:

- `apps/documentation/src/content/docs/marketing/website-concept.md`
- `apps/documentation/src/content/docs/marketing/home-conversion-audit.md`
- `apps/documentation/src/content/docs/backlog/marketing-landing.md`
- Focused tests beside their existing owners

Steps:

1. Treat the focused plan's brand, copy-review, audit, rollout-plan, and September-plan reconciliation as the baseline; do not reopen the fox decision or restate the focused slice.
2. Record the later conversion work completed by Tasks 1 and 3–6 in `website-concept.md`, `home-conversion-audit.md`, and `backlog/marketing-landing.md`.
3. Add focused tests for locale/theme/menu behavior, clipboard success and failure, architecture routing, illustration semantics, initial visibility, catalog parity, and the shared shortcut invariant.
4. Do not create sentence-by-sentence snapshots that fail on harmless copy edits.
5. Once the umbrella work ships, fold its lasting behavior into reference docs and delete this plan.

**Acceptance:** documentation describes the product that exists, and tests fail for dead controls, silent ARM64 selection, missing localization, or server-rendered content hidden by default.

## Verification

Run from the repository root unless a working directory is shown:

```bash
bun run verify
bun --cwd packages/i18n run test
bun --cwd apps/web-hono run check-types
bun --cwd apps/web-hono run build
bun --cwd apps/documentation run build
bun test packages/domain/src/constants/shortcuts.test.ts
bun --cwd apps/kaipu-record run test:e2e -- e2e/mute-export.e2e.ts
```

The packaged mute test is evidence for a release claim, not a prerequisite for unrelated landing work. Record an inability to run it honestly.

Perform browser review at:

- 390×844
- 768×1024
- 1280×800
- 1440×900
- 1920×1080
- A narrow desktop window, specifically to prove that width does not select CPU architecture

For each relevant viewport, verify:

- English to Spanish switch and reload persistence
- Dark to light switch and reload persistence
- Keyboard-only traversal and visible focus
- 200% zoom without horizontal overflow
- Reduced-motion behavior
- JavaScript-disabled readable baseline
- Apple Silicon and Intel selection
- Clipboard success and denied/unavailable fallback
- Mobile sticky action does not cover focused content

## Review order

Review the implementation in this order:

1. Truthfulness of claims and actions
2. Page hierarchy and Kai's role
3. English and Spanish meaning
4. Genuine output proof and installation answers
5. Accessibility and responsive behavior
6. Tests and documentation status

Visual polish cannot approve a false claim, dead action, untranslated scene, or inaccessible baseline.
