---
title: Brand identity and website rollout
description: Execution sequence for preserving Kaipu's meaning, selecting Kai and logo assets, and delivering the four-chapter website.
---

# Brand identity and website rollout

**Status: 🟡 In progress · updated 2026-10-07.** Identity documentation, README correction, EN/ES landing copy, the four-moments home, `@kaipu/brand` with the fox, and the menu-bar capture-mode marks are on `main`. The home's Kai section and hero copy ship in [PR #202](https://github.com/niway-dev/kaipu-record/pull/202). The desktop bundle icon export is scripted from `@kaipu/brand` ([NIW2-181](https://linear.app/niway/issue/NIW2-181), [plan](/plans/2026-10-07-app-icon-derivation/)); its Dock/⌘-Tab/DMG check is pending under F. Still pending: the SVG lockup and favicon crop, and media production. Parent: [Product growth](/backlog/product-growth/).

## Goal and settled inputs

Preserve **Kaipu = KAY + khiPU → «Esto, registrado»**, make the identity usable in everyday design work, and deliver a product-led website showing capture, explanation, and retrieval. [Brand identity](/marketing/brand-identity/) is canonical. The character is the fox shipped in `packages/brand` (adopted 2026-10-01).

The existing growth sequence remains GIF → Windows beta → landing sections → keystrokes/CLI. This plan orders the brand/website work internally; it does not silently reorder the product roadmap. No inference runtime, renderer architecture, or styling-framework migration is included.

## A — Preserve identity and establish entry points

- [x] Create `marketing/brand-identity.md` with the adopted meaning, origin story, sources, voice, and change rule.
- [x] Replace the root README's template framing and obsolete stack/license claims with Kaipu's actual product and repository structure.
- [x] Link the identity from `CLAUDE.md`, Marketing, and the design/AI briefings.
- [x] Align mascot and website guidance with the knot direction; preserve the distinction between brand signature and landing headline.

**Acceptance:** a new contributor can find the meaning from the README without access to a previous chat or an external local file. The documentation does not present the coined name as a literal translation.

## B — Receive artwork and select a usable identity system

The creator already has new logos and notch-state artwork. First obtain their paths/files and identify which variants are approved. Inspect those assets before commissioning or generating more.

- [x] Inventory the supplied assets: source file, variant, intended surface, theme, static/animated, and approval status. Done: six PNGs (`logo-app`, `logo-plain`, `logo-record`, `logo-screenshot`, `logo-permissions`, `logo-done`) and two monochrome SVGs (`mono-record`, `mono-screenshot`) in `packages/brand/assets/`, resolved by purpose in `packages/brand/src/index.ts`; `product` and `micro` both resolve to `logo-plain.png`.
- [ ] Compare compact knot, knot-character, and knot-with-capture-frame only if the supplied artwork does not already settle the direction.
- [ ] Test the small symbol at 16/24/32 px, one color, and light/dark; test the full character independently.
- [x] Select wordmark, small symbol, app icon, monochrome tray mark, and full Kai. Record which source generates each output. Done: `packages/brand/src/index.ts` selects by purpose (`app`, `product`/`micro`, `record`/`screenshot`, `permissions`/`done`); the menu-bar capture-mode marks follow the selected recording or screenshot mode.
- [ ] If pixel art is selected, normalize its grid and palette; preserve a simpler small-size mark.
- [x] Export the desktop bundle icon from the selected app mark. Done (NIW2-181): `apps/kaipu-record/scripts/generate-app-icons.sh` (`bun run icons`) derives `build/icon.icns`, `build/icon.png` and `resources/icon.png` from `packages/brand/assets/logo-app.svg` with `sips` + `iconutil`; the dev run sets the Dock icon from `resources/icon.png`; `src/main/app-icon.test.ts` fails when the logo changes without re-running the script. `build/icon.ico` (Windows) is still the old art. See [App icon derivation](/plans/2026-10-07-app-icon-derivation/).

**Existing consumers to inspect:** `apps/web-hono/src/components/kaipu-mark.tsx`, `apps/web-hono/public/favicon*`, `apps/kaipu-record/src/renderer/src/assets/brand/`, `apps/kaipu-record/src/renderer/src/shell/kaipu-mark.tsx`, `apps/kaipu-record/resources/`, desktop packaging icons, and `apps/documentation/public/favicon.svg`.

**Acceptance:** readable silhouette without text, no clipping, distinct recording tray state, clean transparency, and no accidental change to opt-in branding behavior. Artwork integration gets its own bounded implementation change after selection.

## C — Define notch artwork versus runtime behavior

- [ ] List the states the supplied notch artwork represents and map them to actual app states with the creator.
- [ ] Distinguish a static preview, an animated asset, and implemented UI behavior. Do not infer recording/paused/saved/error semantics from filenames alone.
- [ ] Specify trigger, duration, interruption behavior, reduced-motion fallback, and accessible text for each approved state.
- [ ] Document any new notch behavior in a backlog feature doc before code, with an index row and sidebar entry.

**Acceptance:** a reviewer can tell which state reflects a real recording, which merely decorates the UI, and how the state behaves when an operation fails. New notch functionality is not claimed as shipped by this branch.

## D — Approve one visual slice, then implement the page

- [x] Publish the name's meaning on the landing: an `#origin` section between the Why cards and
      Download, plus the signature in the footer, wired through `landing.origin*` /
      `landing.footerSignature` in both catalogs. Text-only, no artwork dependency.
- [ ] Compose the hero and one chapter using actual screenshots in desktop/mobile, light/dark.
- [ ] Validate the composition with the creator before propagating it to all sections.
- [ ] Update `apps/web-hono/src/components/landing/hero.tsx` and `showcase.tsx`; reuse `feature-demo.tsx` and `demo-video.tsx` where appropriate.
- [ ] Add Record/Capture/Edit/Find anchor sections and a floating chapter navigator on wide screens, with a compact mobile equivalent.
- [ ] Add the library/Finder proof section and factual FAQ; keep `routes/index.tsx` orchestration clear.
- [ ] Wire approved text through `packages/i18n/messages/{en,es}.json`; retain current download URLs until actual release artifacts change.

The [website concept](/marketing/website-concept/) owns the composition and copy details. Use normal scrolling, real anchors, visible keyboard focus, current-section labels, and reduced-motion behavior. Do not add a generic animation framework merely for chapter highlighting.

**Acceptance:** no horizontal overflow at narrow widths, all chapters accessible without animation or autoplay, download easy to find, both languages readable, and no mascot obscuring the actual product.

## E — Produce and integrate media

- [ ] Record the hero, capture, edit, find, and Finder stories from the concept's shot list with fictional data.
- [ ] Produce optimized MP4/WebM plus matching posters; retain aspect ratio and readable UI text.
- [ ] Add user pause controls for sustained loops, offscreen playback handling, and static reduced-motion fallbacks.
- [ ] Add Kai only in selected supporting placements. The website must work before mascot animation is ready.

**Acceptance:** screenshots never imply unavailable functionality; export wait times are not misleadingly presented; a paused page still explains the product. GIF derivatives for external posts do not imply GIF export is already implemented in Kaipu.

## F — Validate and release

- [ ] Run the repository checks appropriate to the implementation (`bun run verify`; desktop E2E if desktop consumers change).
- [ ] Run `bun run build` in `apps/documentation`; check internal links and status banners.
- [ ] Review EN/ES headings on mobile, keyboard navigation, contrast, light/dark, reduced motion, and video controls.
- [ ] Verify the actual download artifact before publishing “no watermark”; enable Windows/source CTAs only when available.
- [ ] Validate desktop icons/tray/notch in a packaged build if those surfaces change. The app icon changed in NIW2-181: check Dock, ⌘-Tab and Finder on a fresh DMG install (`killall Dock` if the cache still holds the old icon).
- [ ] Update backlog status to 🟢 after implementation, and to ✅ only after production validation.

## Restart here

Documentation, copy, and the landing's origin section are ready for review; the meaning is now
published on the site and no longer depends on a chat transcript. Next obtain the creator's
logo/notch asset paths, inventory them under phase B, and record the selected variants. The earlier vizcacha prompt is superseded as the primary direction. Do not regenerate the mascot or rewrite the name's meaning before inspecting the supplied work.
