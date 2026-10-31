---
title: "Background copies — toasts, Library badge and \"copy ready\""
description: "NIW2-586: a copy prepared in the background names its destination while it runs (\"Preparing your YouTube copy…\") and when it lands (\"Your YouTube copy is ready\"). The progress card hides without cancelling; a copy the user did not see puts a count on the Library rail item, a \"1 copy ready\" chip on the Library page and an outline on its card."
---

# Background copies — toasts, Library badge and "copy ready"

> **Status: 🟢 Ready to validate — NIW2-586, on `feature/niw2-586-background-toasts`, stacked on
> [#457](https://github.com/niway-dev/kaipu-record/pull/457) (Send to…, NIW2-585), which sits on
> the rest of the Prepare stack down to [#448](https://github.com/niway-dev/kaipu-record/pull/448)
> (Prepare, NIW2-578).** Unit and
> component tests pass; nothing has run in Electron yet. Owner QA pending. Design: Claude Design
> project `71546ef1-baf5-42e9-8fcc-9b9b44f2c7ab`, file `Kaipu Prepare.dc.html`, section 4
> "In the background".

> **Update:** the progress card's ✕ became a minimize to a pill, the cards moved bottom right, and a
> finished copy now leads the Library as a "Ready to upload" card — see
> [Ready copy in the Library](./ready-copy-in-library).

## Why

[Prepare](./prepare-screen) starts a copy that can take minutes (a 4K YouTube copy). The existing
cards from the [export redesign](./export-presets) said "Making a lighter copy…" for every
destination, could not be put away without cancelling, and if the user closed "Ready to share"
nothing told them the copy was waiting.

## What the user sees

- **Progress card**: the destination's tile, "Preparing your YouTube copy…", a mono line
  "38% · about 2 min left · you can keep working", a striped bar, and the size it is heading for.
  **✕ hides the card; the export keeps running.** A quiet **Cancel** under the bar stops it. A
  hidden export that fails shows its error card again (Retry / Close, unchanged).
- **Ready card**: the success fox, "Your YouTube copy is ready", "2560 × 1440 · 566 MB · in your
  Library" (the last words open the copy's page), **Show in Finder** (primary) and **Drag to
  upload** (the native drag of the real file). Light and Balanced copies still show where they fit
  on GitHub. ✕ closes it.
- **Editor exports** use the same cards with a generic name: "Preparing your export…", "Your export
  is ready".
- **Library rail badge**: a copy that finished while its ready card was not on screen (closed, or
  replaced by the next export) puts a pink count on LIBRARY. Opening the Library clears it.
- **Library page**: a teal "✓ 1 copy ready" chip next to the title and a pink outline on each copy
  not opened yet. Both clear per copy when it is opened (its page, Show in Finder, or a drag).

## Decisions

- **Unseen vs announced.** A finished copy is _unseen_ until the user opens it or acts on it; the
  rail badge counts only unseen copies not yet _announced_ by the Library page. Otherwise opening
  the Library would erase the chip it is meant to show. (`ready-copies.ts`)
- **In memory.** Like the export runner itself; a relaunch starts with nothing pending.
- **The destination is derived** in `usePrepareCopy` from the preset (`destinationOfPreset`), so
  every Prepare entry point names it without changing the page. It is optional on
  `ExportJobInfo` and `StartExportArgs`.
- **The success fox** is the existing `KaipuLogo use="done"` mark, not a new asset.
- **"View file", the "N% lighter" line and the size meter** left the ready card (the design has
  two actions). "in your Library" replaces View file.
- **List view** is not outlined; the chip still counts.

## How to validate

1. Library → a recording → Prepare → YouTube → Prepare. The card says "Preparing your YouTube
   copy…" with the YouTube tile and the striped bar.
2. Click ✕: the card goes away; the export keeps running (quitting still asks). When it ends, "Your
   YouTube copy is ready" appears with the fox.
3. Click ✕ on the ready card: LIBRARY in the rail shows **1**. Open the Library: the badge clears,
   the title reads "✓ 1 copy ready" and the copy's card is outlined. Open the copy: both go away.
4. Start another copy and click **Cancel**: it stops, and nothing reaches the Library.
5. Export from the editor: the cards say "Preparing your export…" / "Your export is ready".
6. On the ready card, drag **Drag to upload** into Finder or a browser upload field: the real file
   drops, named after the item.
