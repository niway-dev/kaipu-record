---
title: "Editor home — start something, or continue what you worked on"
description: "The Editor home (v2, from the Claude Design file 'Kaipu Editor Home v2'): Images and Videos tabs, a way to start an image from the clipboard, and a Continue list of only what was opened or saved in an editor, with the last one as a large card and Show older instead of pages."
---

# Editor home — start something, or continue what you worked on

> **Status: 🟢 Ready to validate** (2026-10-14, branch `feat/editor-recent-pagination`,
> stacked on `feat/paste-image-editor`, PR [#299](https://github.com/niway-dev/kaipu-record/pull/299)).
> It implements the Claude Design file **Kaipu Editor Home v2** (project
> `71546ef1-baf5-42e9-8fcc-9b9b44f2c7ab`), which came out of the
> [second-opinion brief](./editor-home-second-opinion) after the owner rejected v1.

## Why v1 was replaced

v1 listed **every editable file** with filters and a pager, ordered by last activity.
The owner tried it and rejected it: "it's all the videos… it became a Library". The
problem was what the list contained, not how it was paged. A screenshot that was only
captured, or a recording never opened, is Library material; the Editor home is for
work in progress.

## What the page does now

- **Tabs: Images · Videos**, each with a count. The page opens on the tab that holds the
  most recent work (Images when there is none). The subtitle changes with the tab.
- **Start (Images tab):**
  - **"Start from an image you copied"**: a **New image** button, which opens the
    [paste page](./editor-new-from-clipboard), and **Choose from Library**.
  - When the clipboard holds an image, an **"Image on your clipboard · W × H"** strip
    has a **Paste ⌘V** button that opens it in the image editor directly.
  - ⌘V anywhere on the page does the same.
- **Continue**, per tab:
  - the **last one worked on** as a large card ("LAST WORKED ON"), with **Open**
    (images) or **Resume** (videos);
  - four compact rows under it;
  - **Show older · N**, which adds five more in place, and **Show less**. There are no
    pages.
- **Honest labels:**
  - videos say **Edited …** (the last edit-session save) or **Opened …**, beside the
    existing export badge;
  - images say **Saved …** (a manual Save from the image editor) or **Opened …**, and
    their button says **Open**, because a saved image is a flat PNG with nothing to
    resume.
- **Empty state:**
  - Images: "Nothing to continue yet", plus a hint with the capture shortcut.
  - Videos: the same title, with a link to the Library.

## What enters Continue, and the data behind it

Only items **opened or saved in an editor**. Two new optional sidecar fields
(`.kaipu/<id>.json`) carry this:

| Field            | Written when                                                                             | By                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `editorOpenedAt` | An item from the vault is opened at `/editor/image/:assetId` or `/editor/video/:assetId` | `markOpenedInEditor` IPC (`library:mark-opened-in-editor`), called once per visit from `editor-routes.tsx` |
| `editorSavedAt`  | The user saves from the image editor. The capture's auto-save does not count             | `screenshot:save` with `manual: true`                                                                      |

Videos also use the existing `editSavedAt` (from `.kaipu/<id>.edit.meta.json`).

- **History starts when this ships.** Items edited before then have no stamp:
  - recordings with an edit session still appear, through `editSavedAt`;
  - older screenshots appear only once they are opened again.
- **The cloud catalog ignores both fields.** It copies only explicit fields, and
  `ensureIdentity` keeps unknown sidecar fields.

The logic lives in `pages/editor/editor-continue.ts`: `activityOf`, `continueList`,
`defaultTab` and `formatAgo`. It is pure and unit-tested.

## What the design has that is not built

The design's main start actions are two new features, each its own project:

- **New blank canvas** (Images): a canvas of a chosen size and background where several
  pasted or dropped images are arranged. This is the collage that was deferred in
  [New image](./editor-new-from-clipboard). Until it exists, the Images start card uses
  the paste flow.
- **Combine videos** (Videos): pick clips in order and join them on one timeline. This
  is the multi-source timeline of the [standalone editor](./standalone-editor), its
  "real cost". The Videos tab has no start card until it exists, only Choose from
  Library.

Also not yet:

- the **fox** illustration in the empty state, because the mascot is not in the desktop
  app yet (see brand identity);
- the clipboard strip's "copied N min ago", because the clipboard has no timestamp.

## How to validate

1. `bun run dev`, open **Editor**. With nothing opened in an editor yet, both tabs show
   the empty state.
2. Open a screenshot from the Library in the editor, press **Save**, go back to
   **Editor**. It is the large card, "Saved this minute".
3. Open a recording in the video editor, change anything, go back. **Videos** is
   selected and the recording is the large card, "Edited this minute", with **Resume**.
4. Take a capture with ⌃⌘X and leave without saving by hand. It does not appear in
   Continue.
5. Copy an image elsewhere and come back: the clipboard strip shows its size. **Paste ⌘V**
   opens it in the image editor.
6. With more than five items in a tab, **Show older · N** adds five at a time.
