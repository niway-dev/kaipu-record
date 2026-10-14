---
title: "Editor home — brief for a second opinion"
description: "Self-contained brief on the Editor home page (/editor) of Kaipu Record: what the Editor is, how the old five-item Recent list worked, what PR #299 changed and why, and why the owner rejected it. Written so a reviewer with no context can propose a better design."
---

# Editor home — brief for a second opinion

**Branch** `feat/editor-recent-pagination` · **Head** `30aa93d7` · **Generated** 2026-10-14
**PR** [#299](https://github.com/niway-dev/kaipu-record/pull/299) (draft, stacked on [#297](https://github.com/niway-dev/kaipu-record/pull/297))
**Check** `vitest run` (desktop) → exit 0, 1690 tests, which covers the list logic (`recent-editable.test.ts`) and the page (`editor-routes.test.tsx`). **No check covers whether the design is any good**, which is the question this brief asks.

> **Status: open design question.** The owner tried PR #299 in the running app and
> rejected it: "it's all the videos… it didn't turn out as a usability improvement;
> it really became a Library… it's confusing." This brief exists so someone with no
> context can propose a better design. Nothing here is settled except what the
> _Decisions_ table marks as settled.

## Intent

The owner's words, translated from Spanish (chat, 2026-10-14):

> 1. "The _Recent_ list worries me a bit, because it's only 5. If I have more, each
>    one pushes the next one out. What if we also include videos that are not
>    edited, and a paginator? That makes more sense."
> 2. When the agent proposed a paginated list with filters and warned that it
>    could start to look like the Library: "Exactly! I don't want another Library,
>    that's a drag. **I just want to know which one I edited last**, etc."
> 3. After trying the result: "There's a pretty ugly scroll. Instead of 10, what
>    about 5 per page? Wow, it's all the videos, hmm… it doesn't seem like a
>    usability improvement; it really became a Library, because it appends
>    everything. Why do we do that? I want to look for another solution."

**Underlying goal (as best understood):** the Editor home should answer _"what was I
working on, and how do I get back to it?"_ quickly. The literal asks (more than 5,
pagination, include unedited videos) were the owner's first guesses at how to get
there. Ask 2 is the clearest statement of the goal, and the implementation did
not follow it closely enough: it kept "every editable file" as the list's
population and only changed the order.

**Delivered beyond the ask:**

- the Videos / Images filters;
- the relative "Edited … / Created …" line on each row.

The agent added both on its own initiative.

## What the Editor is (context a reviewer needs)

Kaipu Record is a macOS screen recorder and screenshot tool (Electron). Its sidebar
has Record, Screenshot, **Editor**, Library, Shortcuts, Settings and Cloud.

- **Library** (`/library`) is the full catalogue of everything in the user's vault:
  - recordings, exports (an MP4 or GIF made from an edited recording) and screenshots;
  - search, sort, gallery and list views;
  - filters by kind, storage (local or cloud) and tag;
  - rename, delete, share and cloud upload.
- **Editor** (`/editor`) is the workspace every "Edit" action in the app lands on:
  - **Video editor** (`/editor/video/:assetId`) edits one recording: a timeline, zooms, cursor, mute and export (MP4 and GIF presets, background exports). Its edits are saved as a _session_ next to the recording, and exporting produces a new Library item linked to its source.
  - **Image editor** (`/editor/image/:assetId` or `/editor/capture`) annotates one image: pen, box, arrow, text, blur, crop and a background "beautify" frame. Saving writes a _flat_ PNG. There is no re-editable session, so an image has no "last edited" time of its own.
  - **New image** (`/editor/new`, PR #297, approved by the owner) takes an image pasted from the clipboard into the image editor. A **New video** is wanted later.
- **Editor home** (`/editor` with nothing open) is the page in question.

### The edit-state signal that already exists

Each **recording** in the Library can carry an `EditBadge`
(`features/library/lineage.ts`, `editBadge()`):

- _none_: never edited;
- **"Edited · not exported"**: has an edit session but no export;
- **stale**: edited again after the last export;
- **edited**: every edit is in an export.

The data behind it is `editSavedAt` (last session save) and `editExportedSavedAt`. Screenshots and exports never get a badge.

## State: before and after

### Before: `main`, the five-item list

`pages/editor/editor-home-page.tsx` on `main` did the following:

- took every **editable** item, meaning it has a local copy and, for a recording, a duration;
- sorted it by **creation date**, newest first, and kept the first **5**;
- showed each row as a thumbnail, title, kind badge, edit badge and an Edit button;
- had no filters and no pager.

The problem the owner hit: every new recording, screenshot or saved paste pushes something out of the five. A recording you edited yesterday can vanish behind four screenshots taken this morning. The list also orders by when a file was **made**, not by when it was **worked on**.

### After: PR #299

`pages/editor/recent-editable.ts` (pure logic) and `editor-home-page.tsx`:

| Change     | What it does now                                                          |
| ---------- | ------------------------------------------------------------------------- |
| Population | Still **every editable item**, the same as before, but no longer cut at 5 |
| Order      | By "last activity": `max(createdAt, editSavedAt)`                         |
| Row line   | "Edited 1 hour ago" or "Created 3 minutes ago"                            |
| Filters    | All · Videos · Images · Not edited (recordings with no edit session)      |
| Pager      | 8 per page, "1–8 of N", previous and next                                 |

What the owner saw (screenshot, 2026-10-14):

- The first page was mostly **pasted images saved during testing**, several of them "(copy) (copy)", plus one fresh recording, all reading "Created N minutes ago".
- The 8 rows overflow the default window height, so the page **scrolls inside the window** before the pager is even visible.
- Nothing on the page said what had been **edited**. Screenshots cannot carry that signal, and none of the recordings on page 1 had been edited.

## Decisions

| Decision                                                                        | Alternative rejected                                               | Why                                                                                       | Owner                       | Status                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------- |
| Editor home is **not** a second Library (no search, tags or management actions) | Turning it into a filtered Library                                 | Owner: "I don't want another Library"                                                     | user                        | **settled**                              |
| Population = every editable item                                                | Only items with an edit session, or a short "Continue editing" set | Agent read "include videos that are not edited" + "paginator" as "list everything, paged" | agent                       | **open: the owner rejected the outcome** |
| Order by last activity (edit, else creation)                                    | Creation order (old behaviour)                                     | Owner: "I just want to know which one I edited last"                                      | agent, from the user's goal | open                                     |
| Filters All / Videos / Images / Not edited                                      | No filters                                                         | Agent's choice. The kind filters **duplicate the Library's kind filter**                  | agent                       | open, likely wrong                       |
| 8 per page                                                                      | 5 (owner's suggestion after seeing it), 10                         | Agent's choice. 8 rows do not fit the default window                                      | agent                       | open                                     |
| New image lives in the Editor home header, not in the image editor toolbar      | In the toolbar                                                     | One more toolbar button broke the toolbar-width E2E tests                                 | agent                       | settled for PR #297                      |
| New video                                                                       | —                                                                  | Wanted, not now                                                                           | user                        | settled (deferred)                       |

## Evidence and gaps

**Verified this session:**

- Old behaviour (5 newest by `createdAt`): `git show origin/main:apps/kaipu-record/src/renderer/src/pages/editor/editor-home-page.tsx`, constant `RECENT_EDITABLE_COUNT = 5`.
- New behaviour: `recent-editable.ts` (`recentItems`, `paginate`, `lastActivity`) and its tests.
- Library capabilities: `pages/library/library-page.tsx` and `features/library/components/` (`filter-chip`, `sort-menu`, `tag-panel`, search placeholder "Search recordings…").
- Edit signal exists only for recordings: `editBadge()` in `features/library/lineage.ts` returns `null` for screenshots and exports.
- Pasted images that are saved become ordinary screenshots in the vault, which is why the owner's list fills with them.

**Carried over, unchecked:**

- The video editor's feature list above comes from the backlog docs, not from reading the code this session.
- "8 rows overflow the default window" comes from the owner's screenshot only. The `main` window preset's height was not measured.

## Where to attack

These are the weakest points, worst first. They are starting points, not the boundary.

1. **What the list contains**, not how it is paged. Paging a list of every file is a Library by definition. The question is which items deserve a place on the Editor home at all.
2. **Images have no "worked on" signal.** Flat PNGs have no session. Any "last edited" design either ignores images or needs a new signal, such as stamping the save time or the time the item was last opened in the editor.
3. **"Not edited" may be the wrong axis.** The owner asked to see unedited videos _and_ the last edited one. Those are two different jobs:
   - _continue_ something in progress;
   - _start_ editing a fresh recording.
     One list ordered one way serves neither well.
4. **Pagination at all.** If the list is short by construction (in progress plus a few fresh recordings), it needs no pager. If it is long, it is the Library.
5. **Window height.** Whatever goes on this page should fit the default window without inner scroll.

## Ideas on the table (not decided, for the reviewer to weigh)

- **"Continue editing"**: only items with an edit session (recordings today, images if a signal is added), ordered by `editSavedAt`, a handful of rows. Below it, **"New recordings to edit"**: the last few recordings never opened in the editor. No pager; a "See all in Library" link for everything else.
- **One hero card** for "the last thing you edited", with a short list under it.
- Keep five rows, change only the order to last activity, and add a **"See all in Library"** link (smallest change).
- Track **last opened in the editor** for every item, video or image, and order by that. This needs a new field in the vault sidecar.

## Reference material

- [Editor home — Recent (backlog entry for PR #299)](./editor-home-recent)
- [Editor — New image from the clipboard (PR #297)](./editor-new-from-clipboard)
- [Standalone editor idea](./standalone-editor)
- [Edit-state indicators](./edit-state-indicators) and [library lineage](./library-lineage), where `EditBadge` comes from
- Code: `apps/kaipu-record/src/renderer/src/pages/editor/` and `features/library/lineage.ts`

---

## Dispatch prompt

```
You are reviewing a UX design, not hunting code bugs. Read the brief at
apps/documentation/src/content/docs/backlog/editor-home-second-opinion.md in the
kaipu-record repository (branch feat/editor-recent-pagination).

Your job: propose what the Editor home page (/editor) should show so the owner can
answer "what was I working on, and how do I get back to it?" at a glance. Explain
why your design fits that goal better than both the old five-item list and the
paginated list in PR #299, and where it would fail.

Constraints: it must not become a second Library (owner's settled decision); it
should fit the default window without inner scrolling; images currently have no
"last edited" signal (say whether your design needs one, and what it would cost).
"Where to attack" and "Ideas on the table" are starting points, not the boundary.

Give one recommended design with a sketch of the page (ASCII is fine), the data it
needs (existing fields vs new ones), and the strongest argument against it. Do not
restate the brief.
```
