---
title: "Tags on images — keep a long library findable"
description: "Design for tagging screenshots (and, for free, recordings) in the local vault: a tags field in the metadata sidecar, one IPC call that mirrors rename, a tag row on the detail page, and tag chips in the library filter bar that the chip design already reserves."
---

# Tags on images

> **Status: 🔵 Proposed** (2026-10-07). Design doc for the `imageTags` row on the
> [public roadmap](./public-roadmap-page). Nothing is built; this page exists so the row
> is backed by a decision rather than a sentence. Parents:
> [screenshots](./screenshots) · [library filter chips](/features/library-filter-chips/) ·
> [library vault](/desktop/library-vault/).

## Problem

A saved screenshot is titled `Screenshot — <date>` and nothing else. After a few weeks the
library is a wall of near-identical thumbnails that can only be told apart by when they
were taken. Search matches titles, so the only way to find "that bug from the billing page"
is to rename every capture by hand at save time, which nobody does.

The [filter chip design](/features/library-filter-chips/) already planned for this: it
describes **tag chips** (multi-select OR, greyed when no item carries the tag, a divider
before them that only renders when tags exist) and filters on `item.tags`. The chips shipped
without the data behind them. This doc supplies the data and the two places a tag is edited.

## Decision

Tags, not folders. The vault is a flat folder of files by design
([filesystem-first](/desktop/filesystem-first-monetization/)): moving files into subfolders
would break the `kaipu-media://` ids, the sidecar lookup and the cloud relation, and a file
can only live in one folder but can carry several tags. Tags are metadata, and the vault
already has a place for metadata.

## What exists today

| Piece                                                                     | State                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `.kaipu/<id>.json` sidecar (`Sidecar` in `main/library/library-vault.ts`) | v2 schema with `title`, `createdAt`, `assetId`, lineage and hash fields. `writeMeta()` merges, never clobbers |
| `LocalRecording` (`shared/types/library-storage.ts`)                      | The shape the renderer sees; `kind: "recording" \| "screenshot"`                                              |
| `rename(id, title)`                                                       | The model for a one-field metadata write: IPC → `writeMeta({ title })` → library refetch                      |
| Filter bar (`features/library`)                                           | Storage chips and sort are live; tag chips are specified but have no data source                              |
| Library detail (`pages/library-detail`)                                   | Branches on `kind`; the screenshot branch shows `ScreenshotViewer` + Copy / Reveal / Delete                   |

## Design

### Data model

One optional field on the sidecar, kind-agnostic so recordings get it for free:

```ts
// Sidecar (main) and LocalRecording (shared)
tags?: string[]; // normalized, deduplicated, insertion order kept
```

Normalization happens in main, once, on write:

- trim, collapse inner whitespace, strip a leading `#`;
- case-insensitive dedupe, first spelling wins (`Bug` and `bug` are one tag);
- drop empty strings; cap at **20 tags per item** and **32 characters per tag**. Over the
  cap the write is rejected with a typed error, not silently truncated.

The sidecar is the only store. Tags therefore survive a vault move and a machine swap for
the same reason `assetId` does (the file is the source of truth). Writing `tags` bumps the
sidecar to v2 like any other new field; v1 sidecars read as "no tags".

### IPC

One call that mirrors `rename`:

```ts
library.setTags(id: string, tags: string[]): Promise<LocalRecording>
```

It returns the described item so the renderer can update its cache without a full list
refetch. No `addTag` / `removeTag` pair: the renderer owns the edited list and sends it
whole, which keeps the main-side logic to "normalize and merge".

### Where a tag is edited

1. **Library detail page**, both kinds. A tag row under the title: existing tags as chips
   with a remove affordance, plus an "Add tag" input. The input suggests tags already used
   anywhere in the library (`availableTags`, the same set the filter bar computes), so the
   vocabulary converges instead of drifting (`bug`, `bugs`, `Bug`).
2. **Screenshot editor, at save time** (second slice). The same input next to the title,
   once [the title input](./editor-title-input) exists, so a capture can be filed in the
   same gesture that names it. Not in the first slice: the detail page alone makes the
   feature usable.

### Where a tag is shown

- **Filter bar**: the tag chips exactly as the chip design specifies. Nothing new to design.
- **Library cards**: up to two tags as small chips, then `+n`. Cards stay scannable; the
  detail page shows all of them.
- **Search**: the text search also matches tags, so typing `billing` finds items tagged
  `billing` even when their titles are dates.

## Non-goals

- **Automatic tagging** (OCR, vision models). A different feature with a different cost.
- **Tag colours, hierarchies or renaming a tag across the library.** Rename-across-library
  is the first follow-up if people ask; it is a loop over sidecars, not a new model.
- **Cloud sync of tags.** The cloud catalogue does not carry `tags` yet. The sidecar field
  is designed so it can be mirrored later; adding it to the catalogue is a server-side
  change that gets its own doc.
- **Tags on cloud-only items.** An item whose local copy was removed has no sidecar to
  write to on another machine until the catalogue carries tags.

## Open questions

- Should recordings get the editing UI in the first slice, or only the data model? Default
  if nobody answers: **the model is kind-agnostic, the UI ships for both**, because the
  detail page is shared and hiding the row by kind costs more than showing it.
- Tag suggestions come from the whole library or from the same kind? Default: whole
  library; the vocabulary is the user's, not the file type's.

## Validation

- [ ] Add, remove and re-add a tag on a screenshot; the sidecar carries `tags` and the
      chip appears in the filter bar after a refetch.
- [ ] Case variants collapse to one tag; the 21st tag and a 33-character tag are rejected
      with a visible message.
- [ ] A v1 sidecar with no `tags` still reads and renders.
- [ ] Filtering by two tags shows the union; a tag chip with no items is greyed.
- [ ] Move the vault folder; tags are still there.

## Reopens when

The cloud catalogue grows a `tags` column, or the owner asks for automatic tagging. Either
changes where the source of truth lives, which is the one decision above.
