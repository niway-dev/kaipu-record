---
title: Library item detail — media left, tabbed panel right
description: NIW2-669 redesign of the Library item page — Edit in the header, Where is it going?, Versions and Details as tabs, no repeated boilerplate.
---

> **Status:** 🟡 In progress — NIW2-669, branch `feature/niw2-669-library-detail-redesign`.

## Why

The item page (`/library/:assetId`) had grown one section at a time. On a 906 × 683 window the
primary action, **Edit video**, sat under the player and was cut off; "Where is it going?" was
below the fold; and every item repeated text that described the product, not the item: a
"MASTER · FULL QUALITY" tag twice, "This is your original. It never changes.", and "Editing
project available on this device". The workspace showed twice in the title bar.

The approved design is a Claude Design file ("Kaipu Library Detail") built from a mock the owner
picked between two candidates; the written spec it was checked against lives with the session's
evidence (`.evidence/library-mock/claude-design-prompt.md`, not committed).

## What the page is now

- **Header.** `← Library` and an `N of M` counter with previous / next, which walk the Library in
  the order it was showing (the Library passes its visible order in the navigation state; the
  page falls back to the Library's own order). Then the title with rename and an `i` whose
  tooltip carries the original's rule. On the same row, never wrapping: **Edit video** /
  **Edit image** (the only pink button), **Reveal in Finder**, **Open** (the file in its default
  macOS app) and a `•••` menu — Copy path, Move to workspace…, Remove local copy (when allowed)
  and Delete…. A GIF has no editor, so no primary button. A screenshot copies from a button over
  the image's top-right corner, which shows on hover or keyboard focus.
- **One metadata line**: type, duration, dimensions, size, absolute date. Cloud state only when
  the file is not on this Mac. The edit-state badges (not exported, stale) stay under it, then
  the tags.
- **Two columns.** The media on the left (player; or the image with `− Fit +` zoom and its pixel
  size), a panel on the right (354 px, 280 px under 1000 px) with tabs that scroll inside the
  panel — the page itself does not scroll:
  - **Where is it going?** — only for a local recording. The seven destinations as a vertical
    list, grouped as the Export screen groups them, each with the size of its copy (amber where
    the platform compresses again, teal where it plays as is), and **Open Export** at the end.
    It is the default tab while the recording has no copy.
  - **Versions** — the original, its edited project, every exported copy and the copy being made,
    with a `Viewing` pill on the item on screen. The default once a copy exists.
  - **Details** — source, resolution, frame rate, audio, size, created, location, workspace;
    rows that do not apply are left out.
- At narrow widths Reveal and Open become icon buttons with tooltips; Edit keeps its label.

## Removed, and where it went

| Before                                                   | Now                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| "MASTER · FULL QUALITY" by the title and over the player | Gone; the Versions tab says which file is the original          |
| "This is your original. It never changes."               | The `i` tooltip by the title                                    |
| "Editing project available on this device"               | Gone; edit-state badges stay when they say something            |
| "Local" and "SCREEN" in the metadata                     | Cloud state only when it differs; the capture source in Details |
| "IN Personal Workspace" chip on the page                 | Move to workspace… in the `•••` menu; workspace in Details      |
| "Not now" on Where is it going?                          | Switching tab                                                   |
| "Copies from this original" panel                        | The Versions tab                                                |

New IPC: `openLocalRecording` and `localRecordingPath` (main, vault-admitted, plain item ids
only).

## Open

- **Duplicate** is in the design's `•••` menu, but the app has no duplicate operation for a vault
  item; owner decision pending.
