---
title: "Ready copy in the Library, minimizable export widget"
description: "A copy that just finished leads the Library grid as a two-column \"Ready to upload\" card with Show in Finder and Drag to <destination>. Grid cards carry a destination tag. The export progress becomes a bottom-right widget that minimizes to a pill with a ring."
---

# Ready copy in the Library, minimizable export widget

> **Status: 🟡 In progress — on `feature/ready-copy-in-library`, stacked on
> [#459](https://github.com/niway-dev/kaipu-record/pull/459) (Prepare drop zone, NIW2-587).** No
> Linear ticket: the workspace hit its issue limit. Unit and component tests pass; nothing has run
> in Electron yet. Owner QA pending. Design: Claude Design project
> `71546ef1-baf5-42e9-8fcc-9b9b44f2c7ab` — `Kaipu Export v3.dc.html` section 4 "While it runs,
> and when it's done" (boards `editorBusy`, `editorMini`, `libGrid`), and the "Ready to upload"
> card in `Kaipu Prepare.dc.html` step 4.

## Why

Owner QA of [background copies](./background-copy-toasts): a GitHub copy finished, "Your GitHub
copy is ready" appeared, and the Library gave no sign of the new file beyond a small "1 copy
ready" pill and a pink border that is easy to miss.

## What the user sees

- **Ready to upload card.** A copy that just finished leads the Library grid, spanning two
  columns, in place of its regular card: the poster with a destination tag (FOR YOUTUBE in red,
  FOR GITHUB…), "✓ Ready to upload", the file name, a mono line "2560 × 1440 · 3:02 · 566 MB ·
  from the original", a pink **Show in Finder** and **Drag to YouTube Studio** (a native drag of
  the real file). Other destinations: Drag to TikTok or Reels, LinkedIn, GitHub, Slack, a folder;
  an editor export says Drag to upload. Several finished copies get one card each, newest first.
- **The card stays** until the user opens the copy (poster or file name), closes it (✕), or
  leaves the Library and comes back. Closing it brings back the regular card, still outlined as
  unseen.
- **Grid tags.** A copy made for a destination carries its tag on the poster — from the export
  job when it just finished, otherwise read back from the file's sidecar. Originals keep the
  "Master · full quality" tag; editor exports and GIFs keep their kind badge.
- **Progress widget**, bottom right on every screen: destination tile, "Exporting for YouTube",
  "38% · about 2 min left", the striped bar, "Keep working. The copy lands in your Library when
  it's done.", the size line and **Cancel**. **−** minimizes it to a pill with a progress ring and
  "YouTube copy · 38%"; clicking the pill opens it again. An error always shows in full.
- **Ready toast**, also bottom right: "YouTube copy ready", "2560 × 1440 · 566 MB · in your
  Library", Show in Finder and Drag to YouTube Studio.

## Decisions

- **The minimized state is per session**, in `sessionStorage` (`export-widget-state.ts`): every
  later export opens the same way, a reload keeps it, a relaunch starts expanded. It replaces the
  runner's per-export `progressHidden` / `hideExportProgress`, which are gone.
- **Leaving the Library retires the cards** (`retireReadyCards`), watched from the rail's route
  hook next to the badge logic, not from the page's unmount: React StrictMode unmounts every page
  once on mount in development, which would retire the cards before they were seen.
- **The runner hands the card what it knows** (`noteFinishedCopy(assetId, { destination, width,
height })`): `LibraryVideo` has no pixel size for MP4s.
- **Destination of an older copy**: `copyDestinationOf` reads the sidecar's preset when the
  fingerprint is a whole-recording copy. The sidecar stores the fingerprint with the preset's encode
  revision (`whole#2560x1440-v1`), so only the part before `#` is compared. The "Copies from this
  master" panel had compared the whole string and named every YouTube, GitHub and chat copy by its
  title; it now uses the same helper.
- **Only cards the filters show** lead the grid, and only in grid view; list view is unchanged.
- **Export cards moved bottom right**; a page's own card ("Recording saved") stays top right.
- **Out of scope** (sibling branches): the Library header and its drop strip, the Export/Prepare
  screen, the recording detail page, the post-recording card. The "1 copy ready" chip and the
  LIBRARY rail badge stay as they are.

## How to validate

1. Library → a recording → Prepare → YouTube → Prepare. Bottom right: "Exporting for YouTube" with
   the YouTube tile, the percent and time left, the striped bar and Cancel.
2. Click **−**: a pill "YouTube copy · N%" with a ring. Open the Editor or Settings: the pill stays.
   Click it: the widget opens again.
3. Minimize again and start a second export after the first: it opens as the pill.
4. When it ends: the toast "YouTube copy ready" with Show in Finder and Drag to YouTube Studio.
5. Open the Library: the first card spans two columns — FOR YOUTUBE, "✓ Ready to upload", the
   file name, "2560 × 1440 · 3:02 · 566 MB · from the original". Show in Finder reveals the file;
   drag "Drag to YouTube Studio" onto a browser upload page and the file drops.
6. Go to another screen and back: the card is gone; the copy's regular card has a red FOR YOUTUBE
   tag and the pink outline. The original keeps "Master · full quality".
7. Make a GitHub copy and a chat copy back to back, then open the Library: two cards, newest
   first, FOR GITHUB / FOR CHAT, Drag to GitHub / Drag to Slack. ✕ on one: its regular card returns.
8. Repeat at the default 900 × 670 window: the card's text wraps, nothing is cut off, and the
   widget does not cover the rail.
