---
title: Screenshot editor toolbar — responsive / scalable layout
description: The editor's top toolbar packs tools, a 7-swatch color palette, a stroke/size picker, and undo/redo/zoom/copy/save into one fixed horizontal row. At the app's default narrow window width (~900px) the controls don't fit — labels overlap the pickers (TRAZO collides with the stroke picker) and the row gets cramped. Make the toolbar responsive.
---

# Screenshot editor toolbar — responsive / scalable layout

> **Status: 🟢 Ready to validate (prod review pending).**

## Decision

Two of the options below shipped, in two steps:

1. **Color + stroke left the row** (option 2, an earlier change): the palette and the
   stroke/size picker live in the floating `AnnotationOptions` panel over the canvas, so the
   `COLOR` / `TRAZO` / `TAMAÑO` labels that collided with the pickers are no longer in the
   toolbar at all. What remains in the row is the tool group and undo / redo / Copy / Save
   (/ Discard).
2. **Labels drop when the row cannot hold them** (option 1). The Copy / Save / Discard
   buttons become icon-only — tooltip and accessible name unchanged — once the row's
   content would overflow it. The breakpoint is not a fixed pixel width: `useCompactRow`
   (`apps/kaipu-record/src/renderer/src/ui/use-compact-row.ts`) measures the row's two
   groups with the labels shown and sets `data-compact` on the row when they do not fit,
   re-measuring on resize and when a label changes wording or Discard appears. A fixed
   breakpoint would have to be retuned per translation (Spanish labels are ~30% wider) and
   per button added, and at the app's 900px floor it would either never fire or strip the
   labels from a row that still has ~190px to spare.

Checked by `apps/kaipu-record/e2e/screenshot-editor.e2e.ts`: at 1040px (the preset's
starting width) and 900px (the floor, and the width the window actually opens at) the row
holds every control on one line with nothing overlapping and the labels on; forced below
the floor (680px) it collapses to icons rather than overlapping.

Not done, and not needed for now: a second row (option 4) or an overflow menu (option 3).
Reopen if a control is added that does not fit even icon-only at 900px.

## Problem

The screenshot editor's top toolbar lays everything out in a single fixed horizontal row:

- the annotation tool group — select / box / arrow / text
- a 7-swatch **COLOR** palette
- a **TRAZO / TAMAÑO** stroke-and-size picker
- undo / redo / zoom controls
- the **Copiar** / **Guardar** actions

At the app's default (narrow) window width — roughly **~900px** — those controls don't fit on one
line. The row gets cramped and the mono section labels start **overlapping the pickers**: the
`TRAZO` label collides with the stroke picker beside it, and the whole cluster looks broken.

Why it happens: the toolbar is a single non-wrapping flex row with no width-aware behavior. There's
no breakpoint, no wrapping, no collapse — every control claims its full intrinsic width regardless of
the window, so once the sum exceeds the viewport the labels and pickers run into each other instead
of reflowing.

Relevant files (reference, not part of this doc):

- `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-toolbar.tsx` + `.module.css`
- `apps/kaipu-record/src/renderer/src/pages/screenshot-editor/screenshot-editor-page.{tsx,module.css}`

## Options (with tradeoffs)

1. **Drop the mono labels below a width.** Hide `COLOR` / `TRAZO` / `TAMAÑO` under some breakpoint
   and rely on the swatches/picker alone. Cheapest fix and removes the literal overlap, but the row
   can still be tight on very narrow windows.
2. **Color + stroke into a popover.** Replace the inline palette and stroke picker with a single
   swatch button that opens a popover/dropdown. Frees the most horizontal space; costs one extra
   click to reach colors and a small popover component.
3. **Overflow "⋯" menu.** Collapse the tool group and/or the actions into an overflow menu when the
   row is short on space. Scales to arbitrary widths, but hides primary tools behind a menu — worse
   discoverability for the core annotation actions.
4. **Wrap to a second row.** Let the toolbar wrap onto a second line under a breakpoint. Trivial to
   implement, keeps everything visible, but eats vertical space from the canvas and the two-row look
   is less polished.
5. **Compact mode below a breakpoint.** A dedicated narrow layout: smaller icon buttons, tighter
   gaps, labels off. Cleanest result, most work, and needs a second layout to maintain.

For a **desktop window that can legitimately be fairly narrow**, the width-aware approaches scale
best (2, 1, 5). A second row (4) or an overflow menu (3) handle extreme cases but trade vertical
space or discoverability and shouldn't be the primary mechanism.

## Recommendation

Likely a **mix: move color + stroke into a popover (option 2) and drop the mono labels at narrow
widths (option 1).** Together they keep the toolbar to a single line at ~900px with the least
friction — the popover reclaims the bulk of the space the palette and stroke picker were eating, and
dropping labels removes the literal `TRAZO`/picker overlap. Reserve a second row or "⋯" overflow as
a fallback only if it still doesn't fit on the smallest supported window.

## Effort

**Low–Medium.** Not blocking, but should land **before the editor ships** so it isn't broken at the
default window size.
