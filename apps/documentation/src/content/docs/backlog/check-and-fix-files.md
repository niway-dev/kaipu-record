---
title: "Library — file names follow titles, and Check and fix files"
description: "NIW2-560 and NIW2-561: renaming an item renames its file, and a Check and fix files action realigns existing items with their folder. What shipped, the owner's decisions, the failure modes the adversarial review found, what is still unverified, and the lessons."
---

# Library — file names follow titles, and Check and fix files

> **Status: 🟢 Ready to validate. Merged to `main` on 2026-10-31.**
> [#435](https://github.com/niway-dev/kaipu-record/pull/435) (NIW2-560) and
> [#460](https://github.com/niway-dev/kaipu-record/pull/460) (NIW2-561).
> Owner QA runs on a **copy** of the vault. The decisions are
> [ADR 0035](/architecture/decisions/0035-the-file-name-follows-the-title/) and
> [ADR 0036](/architecture/decisions/0036-the-library-reconciles-with-its-folder-on-demand/);
> the operational reference is [Library vault](/desktop/library-vault/).

## What shipped

- **The file follows the title.** Renaming an item in the app renames its media file and its
  `.kaipu/` sidecars. New items get readable default names such as
  `Kaipu Recording 2026-10-29 at 19.57.30` (ISO date; dots in the time, because Finder forbids
  `:`). Pasted images are screenshots: `Kaipu Screenshot <date>`.
- **Check and fix files.** It runs from a banner in the Library and on Home ("N files in your
  folder don't match Kaipu") and from a button in Settings → Files. The dialog shows a
  **Now → After Fix all** table, and a second **File / Why it stays** table for what it will not
  touch. **Fix all** runs one pass, and checking again finds nothing.
- **Old automatic titles are replaced.** `Recording — 10/29/2026, 7:57:30 PM` becomes the
  default name from the capture date. An export of one, `… (edited)`, takes its source's new
  name plus the suffix, so the pair still reads as a pair.

## The owner's decisions

| Decision                                                                              | Why                                                                                                              |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| The library rules: when an item Kaipu manages disagrees with its file, the title wins | Users only see the library; the folder follows it                                                                |
| Follow names only; never infer identity                                               | Each review round found a new false pairing (same duration, size or date). "The user rules; we keep our orphans" |
| Never delete. Dead records go to `.kaipu/orphans/<run>/` with a manifest              | A missed pairing is recoverable, but a deleted record is not                                                     |
| Ambiguous cases are listed, never fixed                                               | Duplicates, two media on one name, shared companions, unreadable records                                         |
| On demand, through a banner, not a silent fix on launch                               | A known problem gets explained; nobody's files move under their feet                                             |
| A rename cycle gets a ` (2)` suffix                                                   | No temporary name that a crash could strand                                                                      |
| No journal                                                                            | The orphans manifest plus an idempotent re-scan cover recovery                                                   |
| Manual reassignment of orphans is later                                               | [NIW2-589](https://linear.app/niway/issue/NIW2-589)                                                              |

## What the adversarial review found

GPT-6.1 Sol ran 4 design rounds on the plan and 7 code rounds. Every finding came with a
reproducing fixture, and every fix with a test that failed first. These are the failure modes a
later change must not reintroduce:

- an `lstat` error read as "free" overwrote a file in orphans;
- a media file named `tags.mp4` claimed the tags registry as its sidecar (vault-owned stems are now
  reserved);
- companions shared between two items escaped through one of them;
- `remove()` bypassed the strict sidecar read and rewrote a corrupt record;
- a window reload during a recording leaked the vault lease, and in one path deleted the
  recording;
- the finalize race let one recording overwrite another's file;
- a truncated session id collided;
- check-then-rename on exFAT replaced an arriving file;
- short writes in the copy fallback produced truncated files;
- a failed overwrite cleanup deleted the destination;
- an in-app rename overwrote a file that arrived mid-rename (it now reports `kept-old-name`,
  reason `taken`);
- a placement marker's size check authorized deleting a staging part;
- callers ran `vault.remove` after a failed placement;
- a staging-file close error let the renderer's abort delete the only copy of a take.

The fixes converge on one placement module, `safe-place.ts`, and its threat model in
ADR 0036, "Placing a file". It is guaranteed against our own concurrency, crashes, I/O errors and
a file that arrives before placement. It is not guaranteed against an external process swapping a
path between two of our syscalls, because Node has no rename-without-replace.

## Still unverified

- Nothing ran in Electron during development. The banner, the dialog, refusals, editor retries
  and the reload paths have unit tests only.
- Windows, exFAT, SMB and HFS+ are simulated with mocks: locked files, NTFS links, directory
  sync, volumes without hard links, NFD names.
- Power-loss durability is best effort (file and directory fsync), not proven.
- The last two fixes (`ac7c7b1b`, the close error, and the agent-review fixes) were not
  re-reviewed by Sol.

## Follow-ups

- [NIW2-589](https://linear.app/niway/issue/NIW2-589): list orphaned records and reassign one to a
  file manually.
- [NIW2-590](https://linear.app/niway/issue/NIW2-590): placement follow-ups. Recover a case-only
  rename's hidden temporary file, avoid a whole-file copy per retry on volumes without hard links,
  route the screenshot export's `writeFile` to a user path through placement, and handle
  case-only companion renames.

## Lessons

The reusable parts live in the knowledge hub:
[vault reconciliation](https://github.com/csdev19/general-knowledge/blob/main/desktop/vault-reconciliation.md)
and
[no-replace file placement](https://github.com/csdev19/general-knowledge/blob/main/desktop/no-replace-file-placement.md).
For this project:

- **Read the dry run's output, not only its counts.** A read-only scan of the real vault
  reported 527 old titles, and every unit test passed. The owner's first look at the proposed
  names found `Recording — 9 14 2026, 10 57 31 AM (edited).mp4`: the detector missed the
  ` (edited)` suffix of exports. For the next migration, read a sample of proposed names from a
  copy of the real vault before the handoff.
- **Answer "do we need a migration?" with yes or no first.** "No migration needed" plus "but
  existing items need fixing" read as two answers. The answer was yes, for items created before
  the change.
- **Cut complexity at the rule, not in the code.** Identity inference kept producing review
  findings until the owner removed it. "Never delete, list what is ambiguous" closed whole
  classes of bugs at once.
- **A stacked PR's base can move under it.** Merging `main` into #435 left #460 with 27
  conflicting files. Check `mergeStateStatus` after every push to a stacked PR.
