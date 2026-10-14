---
title: "Editor home — Recent: last worked on first, filters, pages"
description: "The Editor home lists every editable item ordered by when it was last edited (or created), with All / Videos / Images / Not edited filters and pages of eight, instead of the five newest files."
---

# Editor home — Recent: last worked on first, filters, pages

> **Status: 🟡 Rethinking** (2026-10-14). The owner tried this version and rejected it:
> it lists every file, so it became a second Library. A
> [brief for a second opinion](./editor-home-second-opinion) describes the problem;
> the design below is what was tried, not what will ship.
>
> Original ask (branch `feat/editor-recent-pagination`, stacked on
> `feat/paste-image-editor`). Owner: "Recent worries me a bit because it is
> only five, and each new one pushes the next out. I don't want another Library — I
> just want to know which one I edited last."

## What changed

- **Order: last activity, not creation.** An item's activity is its last edit-session
  save, or its creation when it was never edited. A recording made last week and
  edited an hour ago comes before one recorded this morning.
- **Each row says why it is where it is:** "Edited 1 hour ago" or "Created 2 days ago",
  in the app's locale (`Intl.RelativeTimeFormat`).
- **Filters:** All · Videos (exports included) · Images · **Not edited**, which means
  recordings that never had an edit session. Exports are the result of an edit, and
  screenshots have no session, so neither is listed under Not edited.
- **Pages of eight** with a "1–8 of 23" range and previous/next. Changing the filter
  goes back to the first page. A page that stops existing clamps to the last one.

## Deliberately not here

The Library already does these, so the Editor home stays a "pick up where you left
off" list rather than a second Library:

- search;
- tags;
- delete, share and upload actions;
- sorting options.

The logic lives in `pages/editor/recent-editable.ts` (pure, unit-tested).

## How to validate

1. `bun run dev`, open **Editor**. With more than eight editable items, the pager shows
   "1–8 of N".
2. Open an old recording in the video editor, change anything, go back to **Editor**:
   it is now first, with "Edited just now / this minute".
3. Press **Not edited**: only recordings you have never opened in the editor remain.
