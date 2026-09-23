---
title: "Library — lineage: see the recording an export came from, and its exports"
description: "Proposal: make the source ↔ export relationship navigable in the Library. The detail page of an exported video links to the recording it was made from; the recording's page lists its exports; the relationship survives out-of-order dates, deletion and the cloud catalog."
---

# Library — lineage

> **Status: 🟢 Ready to validate** — implemented in [#156](https://github.com/csdev19/kaipu-record-monorepo/pull/156) (2026-09-23). Originally proposed following an owner
> request: "on a video's detail page, see the
> previous video it references — an edited video comes from another one and they are not
> necessarily consecutive." Parent decision:
> [ADR 0003 — an export never replaces the original](/architecture/decisions/0003-export-never-replaces-the-original/)
> · sibling: [edit-state indicators](./edit-state-indicators).

## Problem

Because an export never replaces the original (ADR 0003), every edited video is a **new
Library item** next to its source. The Library sorts by date, so the export lands at the
top while the source may be days down the list, with three other recordings in between.
Standing on the export, there is no way to get to the source; standing on the source,
nothing says it has been exported at all — which is the situation the
[edit-state indicators](./edit-state-indicators) doc worries about from the other side.

## What exists already

More than it looks:

- **The link is recorded.** `derivedFromAssetId: string | null` is part of the local
  recording metadata, the `LibraryItem`, and the cloud catalog entry. The editor sets it
  on export (`video-editor-page.tsx` passes `source.assetId`); the vault writes it.
- **The detail page already reads it** — as a line of text: `exportedFrom` renders
  "Exported from {title}" when the source is found in the loaded list. It is not a link,
  and it is silent when the source is missing.
- **The probe already distinguishes** `"exported-only"` (this item _is_ an export) from
  `"project-available"` (this item has an edit session) in `edit-project-probe.ts`.

So the data model is done. What is missing is navigation, the reverse direction, and
the edge cases.

## Proposal

### Detail page of an export

Replace the text line with a **Source** row in the metadata block:

> **Source** · `Recording — 22 Sep 2026, 21:27` · 25 s · [Open]

- Title is a link to the source's detail page. Hovering shows its thumbnail (the
  library already has thumbnails for every item).
- If the source is **deleted**, keep the row with "Source recording was deleted" and no
  link — the fact that this is an export still matters (it explains why there is no
  edit project to reopen).
- If the source is **cloud-only** on this device (`availability`), the link still works;
  the detail page already handles that state.

### Detail page of a recording

A **Exports** section listing every item whose `derivedFromAssetId` is this one, newest
first: thumbnail, title, date, duration. Empty state: nothing rendered (not "No exports
yet" — most recordings have none, and the edit-state doc covers the "edited, not
exported" signal).

### Library cards

A small **link icon** on the card of an export (tooltip "Exported from {title}") and a
count badge on a recording with exports ("2 exports"). Both are optional polish; the
detail pages are the feature.

### Chains

An export of an export is legal — `derivedFromAssetId` points to the immediate parent.
The Source row shows the immediate parent only; the parent's page shows _its_ source. No
tree view; a breadcrumb is not worth it until someone actually chains three deep.

### Where the lookup lives

`useLibrary` already holds every item in memory (the detail page finds the source with a
`videos.find`). Two derived maps — `byAssetId` and `childrenOf` — computed once per list
change cover every lookup above in O(1); no IPC, no vault change.

## Non-goals

- Re-linking or editing `derivedFromAssetId` by hand.
- Diffing source vs export, or showing which edits were applied.
- A sort mode "group by source" in the Library grid — revisit if lineage becomes the
  main way people navigate.

## Acceptance

- [ ] Export a recording, open the export: the Source row links to the recording; the
      recording's page lists the export.
- [ ] Delete the source: the export's Source row says it was deleted; nothing throws.
- [ ] Export the export: each page shows its immediate parent only.
- [ ] Cloud-only source on a second device: the link opens the cloud-state detail page.
- [ ] Keyboard: the Source link and the Exports list entries are reachable and
      announced ("Source recording, link").
