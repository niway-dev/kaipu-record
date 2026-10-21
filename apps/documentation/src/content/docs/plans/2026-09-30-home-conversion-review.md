---
title: Home audit execution and cross-machine review
description: Ordered implementation slices and acceptance checks for the documented home audit, localization, truthful copy, and Kai integration.
---

# Home audit execution and cross-machine review

**Status: Superseded as an execution contract · 2026-10-01.** Keep this page as the historical audit sequence. For the current Hero copy, compact Moments band, third-section Kai introduction, camera-bubble illustration, closing `done` mark, and related documentation, use [Home: Kai, the hero copy, and the fox on camera](/plans/2026-10-01-home-kai-and-hero-copy/). For the remaining conversion work, use [Home conversion and Kai implementation v2](/plans/2026-10-01-home-conversion-v2/). Do not execute unchecked items from this page directly.

## Start here on the other machine

1. Fetch `origin` and check out `feat/marketing-landing`; inspect local status before pulling with `--ff-only`.
2. Read [audit findings](/marketing/home-conversion-audit/), then [EN/ES copy proposals](/marketing/home-copy-review/), then this sequence.
3. Read `.session/HANDOFF.md` for the existing editor-audio/shortcut decisions. `design/editor-audio` is separate work, not proof that a capability is implemented here.
4. Coordinate the theme/locale switches with the owner. The previous session assigns that work to them; do not implement an overlapping replacement unasked.
5. Start with H04: remove unavailable mute/boost promises from both text and the illustrative audio lane, unless the branch now contains validated export-mute implementation. Follow with H05 using the approved shortcut source.

## Scope boundaries

- Keep the new visual direction and existing fox assets. No whole-site redesign, new mascot generation, pricing change, editor audio implementation, or email-delivery backend is required to resolve this audit.
- The current request is to document recommendations and make them reviewable across machines. The unchecked implementation steps below remain pending.
- Distinguish a decision, code on a design branch, code merged here, a tested build, and a released download. Each supports different marketing claims.
- Source-visible mockups are useful illustrations, but their language and depicted behavior need maintenance. They can drift from the app precisely because they are separate code.

## Slice 1 — Truthful claims and coherent actions

- [ ] **H04:** apply truthful editor copy from the inventory and replace the simulated mute/boost lane. Do not just remove “boost” while retaining unsupported mute output.
- [ ] **H05:** use the approved platform-keyed shortcut definitions and formatting; validate every visible shortcut against the desktop implementation. Confirm the approved library shortcut is implemented before displaying it.
- [ ] **H07–H09:** correct setup, local-file/privacy, path, notification, and compatibility wording. Hide or replace source links while the repo is private.
- [ ] **H02–H03:** settle one mobile flow. Recommended: copy a download-page link with feedback and selectable fallback; preserve visible architecture choices on Mac. Do not use width alone to identify a phone.
- [ ] Verify the no-watermark downloaded release before enabling that trust claim. Integration of the setting is already complete.

**Acceptance:** every enabled CTA performs its label's action; Intel visitors can find their artifact; no screen promotes audio editing or a notification service that is absent. The original recording and opt-in badge policy are accurately described.

## Slice 2 — Complete language behavior and coverage

- [ ] **H01:** integrate the owner's functional locale/theme/menu work. Active language comes from locale state; controls have localized accessible names.
- [ ] **H06:** translate the five illustrations using the inventory; reuse existing `origin*` keys and settings keys where appropriate.
- [ ] Apply selected EN/ES wording together, preserving ICU arguments and deterministic rendering. Audit raw JSON for duplicate keys, not only the parsed objects.
- [ ] Add focused verification for locale changes and hardcoded visible strings where the current tests cannot catch failures. Do not add tests that only restate each sentence.

**Acceptance:** switching EN → ES updates all meaningful home text, including illustrated Kaipu UI and assistive descriptions, and persists on reload. The page cannot stay labeled EN while showing Spanish. All keys match, values are nonempty, and the selected language remains consistent on related public pages.

## Slice 3 — Product proof, pacing, and installation doubts

- [ ] **H10–H11:** use one consistent fictional story across capture, edits, title search, and Finder; finish the camera illustration.
- [ ] Add one complete delivered-output demonstration. Prefer actual output as evidence; keep existing HTML mockups as illustrations. If a real clip is used, add a poster, suitable controls, reduced-motion behavior, and narration captions where applicable.
- [ ] Add the four-question FAQ and factual price/account/release strip from the copy inventory.
- [ ] **H13:** shorten the moments introduction and change its H1 to H2. Preserve the main hero and section identities.

**Acceptance:** someone can explain what Kaipu does, what file they receive, whether an account is needed, and which download to choose without playing an animation. No invented testimonials or conversion statistics.

## Slice 4 — Kai and the brand-origin connection

**Ownership transferred 2026-10-01.** This historical slice is not an execution checklist.

- [Home: Kai, the hero copy, and the fox on camera](/plans/2026-10-01-home-kai-and-hero-copy/) owns H12, H13, the camera-illustration half of H11, the closing `done` mark, and reconciliation of the fox and brand-origin documentation.
- [Home conversion and Kai implementation v2](/plans/2026-10-01-home-conversion-v2/) owns the capture-to-output half of H11 and the remaining conversion, localization, controls, trust, FAQ, and accessibility work.

The original acceptance intent remains useful historical context: Kai must have a supporting role, the origin must be reachable, and neither the character nor its motion may imply AI behavior or a lossless-recording guarantee. Completion status belongs in the owning plans, not here.

## Slice 5 — Accessibility and visual verification

- [ ] **H14:** meet contrast requirements for body metadata and button text in real states; review light mode only once it is actually wired.
- [ ] **H15:** add a skip link and localized illustration summaries; hide decorative internals, not meaningful descriptions. Keep fake mock controls out of keyboard navigation.
- [ ] **H16:** use real section links in the rail, honor reduced motion, and provide stop/pause/hide for sustained motion or make decorative motion finite.
- [ ] **H17:** verify readable/visible baseline content with JavaScript disabled; progressively enhance reveals.
- [ ] Reproduce the known rail-label overlap on laptop viewports before choosing the removed-label or hover/focus design from the related branch.

**Acceptance:** keyboard access to every real action, no sticky element obscuring focus, no horizontal overflow at small widths or zoom, clear EN/ES wrapping, and useful static content. Verify at 390×844, 768×1024, 1280×800, 1440×900, and 1920×1080, plus a narrow desktop window to exercise the mobile-action assumption.

## Checks and review procedure

From the root, run `bun run verify`; this covers repository checks and unit tests, not browser visual judgment. In `packages/i18n`, `bun run test` checks catalog parity and related behavior. In `apps/documentation`, `bun run build` checks documentation generation. Let the configured push hooks run; never bypass a failed gate.

For browser review, run `bun run dev:web-hono` using the existing Infisical setup and inspect the home at the local web origin. Perform EN/ES switching, reload, CTA actions, architecture choice, keyboard traversal, reduced motion, and JS-disabled checks. Record observed outcomes, not just screenshots of the initial state. Actual installs, no-watermark validation, and minimum macOS support require a released/packaged build.

Before promoting PR #196 out of draft, record which H-items are fixed, which are explicitly deferred, current test results, and the owner's visual review. Document unresolved behavior honestly; documentation alone does not close the findings.
