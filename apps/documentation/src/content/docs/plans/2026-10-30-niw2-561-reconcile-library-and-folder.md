---
title: Reconcile the library with its folder — plan
description: NIW2-561 — one "Check and fix files" action, offered by a banner in the Library and Home and by a button in Settings → Files, that lists every disagreement between the library and the vault folder and fixes it in one resumable, idempotent pass that never deletes.
---

# Reconcile the library with its folder — plan

**Status: 🔵 Proposed, revision 2 · 2026-10-30.** Revision 2 answers the adversarial
review of revision 1 (GPT-6.1 Sol, 13 findings, 4 blockers; mapped in the last
section). Owner decisions come from the NIW2-560 thread. The work is stacked on
[PR #435](https://github.com/niway-dev/kaipu-record/pull/435) (NIW2-560), which
provides `renameItem`. Ticket:
[NIW2-561](https://linear.app/niway/issue/NIW2-561/reconcile-the-library-with-its-folder-from-a-check-and-fix-files).
The shipping PR deletes this plan.

## In one minute

After PR #435, a rename moves the file, but nothing aligns the items that already
exist. A read-only scan of the owner's vault on 2026-10-30 (561 media files) found
**zero** items whose file name matches their title:

- 527 carry an old automatic title, such as `Recording — 10/29/2026, 7:57:30 PM` over
  `recording-2026-10-30-00-57-30.mp4`;
- about 32 carry user-written titles or `Pasted image — …`;
- 1 has no title, and 1 media file has no sidecar.

Nothing changes on its own. When the library and the folder disagree, a **banner in
the Library and on Home** offers **"Check and fix files"**; the same action is a
button in Settings → Files. It lists every disagreement. **"Fix all"** repairs them
in one resumable pass, and pressing it again finds nothing.

| Decision                                                                                                                                                                                                              | Why                                                                                                                                                                                                                                     | ADR          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| On demand: a banner and a button. No watcher and no automatic migration.                                                                                                                                              | The app is local-only and cannot push a fix for a broken automatic migration. The user sees the problem before anything moves.                                                                                                          | **new 0033** |
| **Nothing is deleted.** Whatever leaves the library goes to `.kaipu/quarantine/<run>/` with a manifest, and can be restored.                                                                                          | "No owner" never proves "dead". An edit session, slide images or the newer tags of a restored backup can sit in a record without media. Quarantine removes the item from the registry, as the owner asked, without destroying anything. | 0033         |
| **Who wins:** Kaipu for pre-existing items and for in-app renames that never reached the disk; the disk for an intentional rename made after the item's migration.                                                    | Owner rule.                                                                                                                                                                                                                             | 0033         |
| Two markers in the sidecar. `fileSync` records the last alignment that reached the disk. `pendingName` records an in-app rename that kept the old file name.                                                          | Without them, "intentional on disk" cannot be told apart from "a Kaipu change that never got there".                                                                                                                                    | 0033         |
| A renamed file re-attaches to its record **only on strong evidence**: the same file on the same volume, or a fresh content hash that matches a cache still valid for that file. Weak signals (size, date) never pair. | A false pairing attaches someone else's tags and edits to a file, which is worse than adopting it as new and quarantining the old record.                                                                                               | 0033         |
| Every multi-step fix writes its intent to a journal before acting; the next run resumes it before scanning.                                                                                                           | A crash between "move companions" and "set title" must not flip the winner.                                                                                                                                                             | 0033         |
| A name with a valid collision suffix for its title (` (2)`, ` (a3f9)`) is aligned. Renames are planned as a dependency graph, so chains and cycles converge in one run.                                               | Re-running the resolver can produce a new random suffix on every press, and fixed-round passes do not converge.                                                                                                                         | 0033         |
| Old automatic titles are replaced by the new default name from the capture date.                                                                                                                                      | Kept as titles, they would become files like `Recording — 10 29 2026, 7 57 30 PM.mp4`.                                                                                                                                                  | reuses 0032  |
| Pasted images are screenshots: `Kaipu Screenshot <date>`.                                                                                                                                                             | Already on #435 (`00abd0f5`).                                                                                                                                                                                                           | none         |

**Out of scope:**

- watching the folder live;
- adopting media from subfolders, symlinks or uppercase extensions;
- emptying the quarantine (a later "Empty quarantine" action);
- restoring from the quarantine in the UI (the manifest makes it a manual or
  support step);
- reconciling cloud-only items with the cloud;
- a cross-process vault lock (C6).

**Open questions:**

1. **An in-app rename that never reached the disk (`pendingName`), then a rename of
   that file in Finder: who wins?** Proposed default: **Kaipu**, because its intent
   is recorded and the disk change has no reliable timestamp. Recorded in the run log
   either way.
2. **Labels:** "Check and fix files" and "Fix all". After the first run the action
   repairs drift, so "migrate" would stop describing it.
3. **Duplicate identities that the cloud cannot settle:** the dialog asks the user to
   pick, and Fix all skips them (I1). Is a manual pick acceptable, or should Fix all
   keep the newest?

## Markers

```ts
// In the sidecar (all optional; absence = "pre-existing").
fileSync?: {
  stem: string;          // exact directory-entry spelling Kaipu last aligned
  volume: string;        // dev, from stat(…, { bigint: true })
  ino: string;           // file id as a string; Windows ids exceed 2^53
  size: number;
  mtimeMs: number;
  at: number;
};
pendingName?: { title: string; at: number };   // an in-app rename that kept the old name
allocation?: "pending";                        // set by allocateId, cleared when the writer commits
```

- `allocateId` writes `allocation: "pending"` and no `fileSync`, because the media
  does not exist yet. The writer clears it, and stamps `fileSync` from the real file,
  once all post-save work is done: thumbnail, cursor track, metadata. This applies to
  recording, screenshot, GIF, export and stranded-recording recovery.
- `renameItem` stamps `fileSync` on `renamed` and `unchanged`. On `kept-old-name` it
  writes `pendingName` and leaves `fileSync` as it was. A later success clears
  `pendingName`.
- `overwriteImage` refreshes `fileSync` (new size and mtime).
- Fix all stamps a baseline `fileSync` on every aligned item that has none. This is
  the "migration" for items that needed nothing else. It is not a visible finding,
  so the banner does not count it.

## Who wins

| Item state                   | Disk state                                                                                               | Winner                                     | Result                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| No `fileSync` (pre-existing) | Title ≠ file name                                                                                        | **Kaipu**                                  | The file takes the title.                                                                   |
| No `fileSync`                | Renamed outside the app (strong pairing)                                                                 | **Kaipu**                                  | The record re-attaches, and the file goes back to the title.                                |
| `fileSync`, no `pendingName` | Renamed outside the app: pairing, or the same file with a different spelling (case or normalization, C8) | **Disk**                                   | The title takes the file name. The record moves along: tags, edits and `assetId` stay.      |
| `pendingName`                | Same file, old name                                                                                      | **Kaipu**                                  | The file takes `pendingName.title`.                                                         |
| `pendingName`                | Renamed outside the app                                                                                  | **Kaipu** (open question 1)                | As above. The disk name goes to the run log.                                                |
| `fileSync`                   | Name sanitizes differently (`Demo.` or `CON` from Finder)                                                | Disk for the title, sanitizer for the file | Title = the file name verbatim; the file gets the sanitized stem in the same journal entry. |

## Strong pairing

A record without media (R) and media without a record (M) are the same item only
when one of these holds:

1. **Same file:** R's `fileSync.volume` and `ino` equal M's `dev` and `ino`, **and**
   the size and mtime are equal. A rename keeps both. Inode reuse on another volume
   fails the `volume` check, and reuse on the same volume fails the size and mtime
   check. Volumes without stable ids report `ino` 0, or ids that change between
   mounts (some exFAT, FAT and SMB): an `ino` of 0 is "unknown" and never matches.
2. **Same content:** R's hash cache was valid for its file (`hashedSizeBytes` and
   `hashedMtimeMs` recorded). M has exactly that size and mtime, and **a fresh hash
   of M** equals `contentSha256`. A cache older than the last content change cannot
   match, because the mtime differs.

If two Ms match one R, or two Rs match one M, nothing pairs. M is adopted as new and
R goes to quarantine, both reported as "couldn't match". Nothing is lost: R is
restorable from the quarantine manifest.

## What the scanner finds

`scanVault(input)` is pure reading. It never calls `list()`, `describe()`,
`sidecar()` or `ensureIdentity()`: those write identities or turn read errors into
`{}`. Each sidecar read reports one of `ok`, `missing` (ENOENT), `unreadable`
(EACCES, EIO), `corrupt-json` or `invalid-schema`. Only `ok` and `missing` take part
in fixes; the other three are reported and never touched (F9).

| Kind                   | Detected when                                                    | Fix                                                             |
| ---------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `disk-renamed`         | Strong pairing, or a spelling change of the same file (C8).      | Apply "Who wins" through one journal entry.                     |
| `stale-auto-title`     | The title matches the old automatic pattern (N1).                | Title = `defaultCaptureName(kind, captureDate)`, then align.    |
| `untitled-legacy`      | No title, and the stem matches `LEGACY_STEM`.                    | Title = `humanizeId(stem)`, then align.                         |
| `name-mismatch`        | The stem is not aligned with the title (N2).                     | Rename through the planner (N10).                               |
| `pending-name`         | `pendingName` is set.                                            | Rename to `pendingName.title`.                                  |
| `stem-conflict`        | Two media files share a stem (`Demo.mp4` + `Demo.png`).          | The hidden one is adopted under a suffix.                       |
| `missing-sidecar`      | Media with no record, unpaired.                                  | Adopt: new `assetId`, `title` = stem, capture date, `fileSync`. |
| `missing-media`        | A record with no media, unpaired, not cloud-only, not in flight. | M1–M5.                                                          |
| `orphan-companion`     | A companion-shaped file with no record and no media of its stem. | Quarantine, unless protected (M6).                              |
| `duplicate-identity`   | Two media items claim one `assetId`.                             | I1.                                                             |
| `baseline` (not shown) | Aligned, with no `fileSync`.                                     | Stamp `fileSync`.                                               |

## The fix pipeline

`fixVault(vault, options)` runs in main while the app is open. It is refused while a
recording or export is running, and it is bound to the vault folder it started with
(C7).

0. **Resume** any journal entry left by an interrupted run.
1. Scan, then build the action list. Items in flight (C2) are excluded from every
   action, not only from removals.
2. `disk-renamed`, then `missing-media` and `orphan-companion` (to quarantine), then
   `duplicate-identity` and `stem-conflict`, then `missing-sidecar`, then the title
   rewrites, then the renames (step 3), then `baseline`.
3. **Rename planner.** Each item wants the base stem of its title.
   - If a pending item's base is free, or is its own, it moves there.
   - Moving it frees its old name. Repeat until nothing moves; the bound is the item
     count.
   - Whatever still waits is a cycle (A wants B, B wants A) or blocked by an aligned
     item. A cycle breaks by moving one item to a temporary stem
     `.kaipu-tmp-<uuid>`, which is ignored by `list()` and by the scan. A blocked
     item takes the first free suffix.
   - Every rename goes through `renameItem`, with `isBusy` and `isEditing`.
4. Scan again. Anything fixable that is left is a bug: it goes to the report and the
   error log, and is not retried in a loop.

**The journal:** `.kaipu/reconcile/journal.json`. Before each multi-step action,
the run writes the action and its decided outcome (such as "disk wins, title =
`Presentation`, companions `Demo`→`Presentation`"). It marks the steps done as it
goes and clears the entry at the end. Step 0 of the next run finishes the entry with
the outcome already decided. It does not recompute the outcome: by then the evidence
may be gone (review finding 6).

**Every action re-validates under its lock (TOCTOU):** the media is still missing,
the identity still lives at that stem, the file is still the same file. A finding
that no longer holds is dropped.

**The report:** `ReconcileReport`, with counts per kind, `fixed`, `quarantined`,
`kept` (with a reason), `needs-choice` and `failed`. The run log goes to
`.kaipu/reconcile/<timestamp>.json`. The quarantine manifest lists the original path,
the quarantine path, the reason and the `assetId`.

**Idempotence is the contract:** a scan after a complete fix returns only findings
that cannot be fixed now: busy, editing, locked, `needs-choice`, unreadable or
corrupt. A fixture vault containing every edge case asserts it, including 101 items
with the same title and a 6-item rename chain.

## Banner

- **When:** when the Library or Home opens, at most once per session; again after
  the vault folder changes and after a fix. The scan runs in main, never during a
  recording or export.
- **Text:** "N files in your folder don't match Kaipu. Check and fix." "Not now"
  hides it for the session.
- **What counts:** only fixable findings. If only unfixable ones remain, the banner
  says it once ("2 files need your attention") and stays hidden until that set
  changes.
- **No findings:** no banner. `baseline` never counts.

## Edge cases

Each row becomes a test, written red first.

**Names**

| #   | Case                                                                                                                                           | Handling                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Automatic titles in other locales: `29/10/2026, 19:57:30`, `29.10.2026`, `2026/10/29 19:57:30`, `2026. 10. 29. 오후 7:57:30`, `a. m.`, `午後`. | Pattern: a known prefix (`Recording`, `Screenshot`, `Pasted image`, `Imagen pegada`) + `—` + only digits, separators and an allowlist of AM/PM tokens. Any other word makes it user-written.                                                                         |
| N2  | When a stem counts as aligned.                                                                                                                 | `isAligned(stem, title, kind, date)`: the NFC-normalized stem equals `base`, `base (n)` with 2 ≤ n ≤ 99, or `base (xxxx)` with 4 hex digits, where `base` = `fileStemFromTitle(title)` or its default-name fallback. It is never "what the resolver would pick now". |
| N3  | A title that sanitizes to nothing (`???`).                                                                                                     | The base is the default name, from the same capture-date function `renameItem` uses (N4).                                                                                                                                                                            |
| N4  | Capture date.                                                                                                                                  | `createdAt`, then the date of a legacy stem (UTC), then birthtime, then mtime. One shared function, also used by `renameItem`'s fallback.                                                                                                                            |
| N5  | A `Recording — …` title on a `.png`.                                                                                                           | The kind comes from the extension.                                                                                                                                                                                                                                   |
| N6  | Two captures in the same second.                                                                                                               | Suffixes are assigned in a deterministic order: capture date, then the current stem.                                                                                                                                                                                 |
| N7  | NFD names from HFS+, exFAT or SMB.                                                                                                             | Compare after NFC; the original spelling is kept for C8.                                                                                                                                                                                                             |
| N8  | Case-only difference from an in-app rename (`demo.mp4`, title `Demo`).                                                                         | `name-mismatch`; `renameItem`'s in-place branch.                                                                                                                                                                                                                     |
| N9  | Reserved or companion-shaped titles (`tags`, `Demo.edit`).                                                                                     | `isReservedStem` decides the base, through `fileStemFromTitle`.                                                                                                                                                                                                      |
| N10 | Chains (titles B, C, D, E, F on files A–E) and cycles (A↔B).                                                                                   | The rename planner. 6-item chain and 2-cycle fixtures.                                                                                                                                                                                                               |
| N11 | More than 99 items titled `Demo`.                                                                                                              | Random-tail suffixes are aligned (N2) and never re-rolled. Fixture with 101 items.                                                                                                                                                                                   |
| N12 | A user title that looks automatic.                                                                                                             | Replaced. Accepted risk, written in the ADR.                                                                                                                                                                                                                         |
| N13 | The current time zone differs from the capture's.                                                                                              | The default name uses the current zone. Documented.                                                                                                                                                                                                                  |

**Missing and orphaned files**

| #   | Case                                                                                                     | Handling                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | A cloud-only item (`localRemovedAt`).                                                                    | Never touched.                                                                                                                                                                                              |
| M2  | A record without media whose `assetId` is in the cached cloud catalog.                                   | Becomes cloud-only (`localRemovedAt`).                                                                                                                                                                      |
| M3  | A record without media, while the cloud is unknown (signed out, no cache).                               | Kept and reported as "waiting for sign-in"; never quarantined while the cloud could still own it.                                                                                                           |
| M4  | Pairing ambiguous or weak.                                                                               | M is adopted as new, R is quarantined, both reported.                                                                                                                                                       |
| M5  | `allocation: "pending"` with no media, not in flight.                                                    | A crashed capture: quarantined. Unmarked records without media follow M2–M4, **never** a shape or age heuristic.                                                                                            |
| M6  | A companion with no owner.                                                                               | Quarantined, except when it is protected: owned both ways (`Demo.edit.json` is either the sidecar of `Demo.edit` or the edit session of `Demo`), or its stem has a present-but-ignored media file (F3, F4). |
| M7  | Unknown files in `.kaipu/` (`tags.json`, `reconcile/`, `quarantine/`, `drag/`, cursor-track temp files). | Allowlist only; never touched.                                                                                                                                                                              |
| M8  | Leftovers whose `assetId` lives elsewhere with media.                                                    | Quarantined, never deleted; the manifest notes "same identity as `<stem>`".                                                                                                                                 |

**What the folder may contain**

| #   | Case                                                                                   | Handling                                                                                                                      |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| F1  | Dotfiles: `.DS_Store`, `._Demo.mp4` (AppleDouble), `.Demo.mp4.icloud`, `.kaipu-tmp-*`. | Skipped.                                                                                                                      |
| F2  | `Thumbs.db`, `desktop.ini`, non-media files.                                           | Ignored.                                                                                                                      |
| F3  | Subfolders and symlinks.                                                               | Ignored (`lstat`). A symlinked media file **protects** its companions (M6).                                                   |
| F4  | An uppercase extension (`Demo.MP4`).                                                   | Not adopted; protects its companions; reported as "not recognized".                                                           |
| F5  | Partial files (`.tmp`, `.part`, `.crdownload`, size 0) and writers mid-save.           | Skipped; writers are covered by the in-flight registry (C2). Each writer's temp naming is verified during implementation.     |
| F6  | Read-only vault, or permission denied.                                                 | Every action fails cleanly; journal plus atomic writes.                                                                       |
| F7  | Unreachable folder.                                                                    | The scan errors, nothing is "missing", and the banner stays hidden. **An unreadable folder is never read as an empty one.**   |
| F8  | 10k items, or a slow network drive.                                                    | Progress in the dialog, concurrency-limited reads, a 10k-item timing test. Fresh hashing happens only for pairing candidates. |
| F9  | A sidecar that is unreadable, has corrupt JSON or an invalid schema.                   | Reported and left untouched. The permissive `sidecar()` helper is never used, because it would merge `{}` over it.            |

**Concurrency**

| #   | Case                                                                                                                                                              | Handling                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | The user renames, captures or deletes during a fix.                                                                                                               | Locks plus re-validation.                                                                                                                                                                                                   |
| C2  | Writers mid-save: recording finalize, cursor track after finalize, GIF and screenshot save, export, stranded recovery.                                            | The in-flight registry. A writer registers atomically with `allocateId` and releases after its last post-save write or rollback. In-flight ids are excluded from **every** action.                                          |
| C3  | Editor open, export running, upload in flight, file locked by another app.                                                                                        | `kept-old-name` with a reason, plus `pendingName`. Check whether uploads read by path and need `isBusy`.                                                                                                                    |
| C4  | A crash mid-fix.                                                                                                                                                  | The journal resumes with the outcome already decided.                                                                                                                                                                       |
| C5  | Library views open during a fix.                                                                                                                                  | Refresh after the fix; routes use `assetId`.                                                                                                                                                                                |
| C6  | A second Kaipu process (dev and prod) on the same vault.                                                                                                          | Not protected; documented with the dev/prod isolation follow-up.                                                                                                                                                            |
| C7  | The vault folder changes mid-run.                                                                                                                                 | The run is bound to its folder; its result is dropped.                                                                                                                                                                      |
| C8  | A spelling-only rename in Finder on a case-insensitive or normalizing volume (`Demo.mp4` → `demo.mp4`). The sidecar lookup still succeeds, so there is no orphan. | Compare the directory entry's exact spelling with `fileSync.stem`. If it differs and the file is the same, the rename was on disk: the disk wins. Separate tests for a disk case change and an unapplied Kaipu case change. |

**Identity**

| #   | Case                                                                         | Handling                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Two media items claim one `assetId` (a backup restored beside the original). | If exactly one matches the cloud revision's `contentSha256`, that one keeps the identity and the other gets a new `assetId`, keeping its tags. Otherwise `needs-choice`: the dialog asks, and Fix all skips it. Age never decides. |
| I2  | A v1 sidecar without `assetId`.                                              | Minted during the fix, never during the scan.                                                                                                                                                                                      |
| I3  | The vault copied to another disk.                                            | `volume` differs, so pairing falls back to the content rule. No pairing means no `disk-renamed`.                                                                                                                                   |

## Where it lives

- `src/main/library/vault-reconcile.ts`: the scanner, the planner, the journal, the
  quarantine and the handlers. Pure Node, tested on temp vaults.
- `library-vault.ts`:
  - the markers;
  - `isAligned` and the capture-date function, shared with `renameItem`;
  - a strict sidecar reader for the scanner;
  - the in-flight registry, which writers hold through `allocateId`.
- The writers (`recording-writer.ts`, `recording-hub.ts`, `screenshot-save.ts`,
  `gif-save.ts`, export, stranded recovery): register and release, clear
  `allocation`, stamp `fileSync`.
- `library-service.ts`: `reconcile.scan()` and `reconcile.fix()`. They inject the
  cloud catalog (or "unknown"), `isBusy`, `isEditing` and the registry, then refresh
  the library.
- IPC `library:reconcile-scan`, `library:reconcile-fix` and
  `library:reconcile-choose` (I1), plus types, preload and `desktop/ipc-contract.mdx`.
- Renderer: the banner on the Library and Home, the dialog (findings in plain
  language, Fix all, results, `needs-choice` pickers), the Settings → Files button,
  and copy in en and es.

## Docs

- ADR 0033, "The library reconciles with its folder on demand":
  - the who-wins rule, quarantine instead of delete, and strong-only pairing;
  - alternatives rejected: a watcher, a startup migration, report-only, Kaipu-always-wins,
    heuristic pairing, and deleting ownerless files;
  - consequences and non-goals;
  - reopen condition: auto-update ships, or drift reports keep coming.
- `desktop/library-vault.mdx`: the markers, the finding kinds, the quarantine, and
  that the scan never writes. Close the gotcha #435 deferred here.

## Verification

- One unit test per edge-case row, plus:
  - idempotence;
  - "the scan writes nothing" (bytes and mtimes before and after);
  - journal resume at every step;
  - "nothing is ever unlinked" (spy on `rm` and `unlink` outside the quarantine move);
  - a 10k-item timing.
- Adversarial review: this revision by GPT-6.1 Sol before coding, then the code
  before the PR.
- `bun run verify`. No local E2E (ADR 0006).
- Owner QA on a **copy** of the real vault (point Settings → Files at it):
  1. the banner appears;
  2. read the list;
  3. Fix all;
  4. press again and expect "Everything matches";
  5. spot-check in Finder;
  6. rename one file in Finder and check that its title follows and its tags
     survive;
  7. check `.kaipu/quarantine/`.

## Order of work

1. ADR 0033. Extract `isAligned` and the capture date from `renameItem`, with no
   behaviour change.
2. The markers and the in-flight registry in the vault and every writer.
3. The strict reader and the scanner, with every edge-case test.
4. Quarantine, journal, planner and fix pipeline; idempotence and resume tests.
5. Service, IPC and preload.
6. Banner, dialog, Settings button and i18n.
7. Docs, verify, code review with Sol, PR stacked on #435, babysit.

## Review of revision 1 (GPT-6.1 Sol) → revision 2

| #   | Finding                                                                       | Resolution                                                                                               |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | Ownerless companions deleted (edit sessions, slide images).                   | Nothing is deleted; quarantine, plus protected companions (M6).                                          |
| 2   | An allocation stub cannot be told apart from a real record.                   | Persisted `allocation: "pending"`; no shape or age heuristic (M5).                                       |
| 3   | Weak pairing attaches unrelated media.                                        | Strong pairing only: volume + inode + size + mtime, or a fresh hash against a cache valid for that file. |
| 4   | Duplicate `assetId` deletes a newer orphan.                                   | Quarantine, never delete (M8).                                                                           |
| 5   | `fileSync` loses an unapplied Kaipu rename.                                   | `pendingName`, plus open question 1.                                                                     |
| 6   | A crash between companions and title flips the winner.                        | Journal with the decided outcome, resumed first.                                                         |
| 7   | Case-only renames on disk escape pairing.                                     | C8: exact spelling against `fileSync.stem`.                                                              |
| 8   | The marker cannot be set at allocation; aligned legacy items get no baseline. | Stamped after the writer commits; `baseline` action.                                                     |
| 9   | The in-flight registry only guards removals.                                  | Excluded from every action; released after the last post-save write.                                     |
| 10  | Random suffixes re-roll after 99 collisions.                                  | `isAligned` accepts valid suffixes; 101-item fixture.                                                    |
| 11  | Three rounds do not converge.                                                 | Dependency-graph planner with cycle breaking.                                                            |
| 12  | The oldest duplicate takes the cloud link.                                    | Cloud hash decides, otherwise `needs-choice`.                                                            |
| 13  | Ignored owners and corrupt sidecars are unprotected.                          | Protected companions (M6, F3, F4); strict reader (F9).                                                   |
