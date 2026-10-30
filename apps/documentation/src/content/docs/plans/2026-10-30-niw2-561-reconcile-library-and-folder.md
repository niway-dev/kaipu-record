---
title: Reconcile the library with its folder — plan
description: NIW2-561 — one "Check and fix files" action, offered by a banner in the Library and Home and by a button in Settings → Files, that lists every disagreement between the library and the vault folder and fixes them in a single idempotent pass.
---

# Reconcile the library with its folder — plan

**Status: 🔵 Proposed · 2026-10-30.** Owner decisions taken in the NIW2-560 thread.
Stacked on [PR #435](https://github.com/niway-dev/kaipu-record/pull/435) (NIW2-560),
which provides `renameItem`. Ticket:
[NIW2-561](https://linear.app/niway/issue/NIW2-561/reconcile-the-library-with-its-folder-from-a-check-and-fix-files).
The shipping PR deletes this plan.

## In one minute

After PR #435 a rename moves the file, but nothing aligns the items that already
exist. A read-only scan of the owner's vault on 2026-10-30 (561 media files) found
**zero** items whose file name matches their title:

- 527 carry an old automatic title, such as `Recording — 10/29/2026, 7:57:30 PM`,
  over a file named `recording-2026-10-30-00-57-30.mp4`;
- about 32 carry another title: user-written ones (`UPDATED NAME`, `hero laqi`) and
  `Pasted image — …` automatic ones;
- 1 has no title, and 1 media file has no sidecar.

Nothing changes on its own. When the library and the folder disagree, a **banner in
the Library and on Home** says so and offers **"Check and fix files"**. The same
action is a button in Settings → Files. It opens a list of every disagreement, and
**"Fix all"** repairs them through one pipeline. Pressing it again finds nothing.
The same action serves future drift: a rename in Finder, a crash, a vault copied
between machines, or a user changing both sides.

| Decision                                                                                                                                                      | Why                                                                                                                                                                                      | ADR          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Reconciliation runs on demand. A banner and a button offer it; there is no watcher and no automatic migration.                                                | The app is local-only and cannot push a fix for a broken automatic migration. A banner announces a problem the user already has without touching anything until they agree.              | **new 0033** |
| **Who wins: Kaipu, unless the change on disk was intentional and came after the migration.** See "Who wins" below.                                            | Owner rule: pre-existing items follow Kaipu. After the migration, a name the user deliberately gave the file is worth more. A Kaipu change that never reached the disk is still Kaipu's. | 0033         |
| A sync marker in the sidecar (`fileSync`) records the stem and file identity Kaipu last aligned.                                                              | Without it, "intentional on disk" cannot be told apart from "a Kaipu rename that never reached the disk".                                                                                | 0033         |
| Old automatic titles are replaced by the new default name from the capture date.                                                                              | Kept as titles, they become files like `Recording — 10 29 2026, 7 57 30 PM.mp4`.                                                                                                         | reuses 0032  |
| Pasted images are screenshots: `Kaipu Screenshot <date>`.                                                                                                     | They are screenshots. Already on #435 (`00abd0f5`).                                                                                                                                      | none         |
| One scanner reports and fixes. `scan()` is read-only; `fix()` applies a phase, re-scans, and repeats until a scan is empty or only unfixable findings remain. | Reporting and fixing cannot disagree. Each phase sees the names the previous one freed. A single "Fix all" converges.                                                                    | 0033         |
| Nothing is deleted unless it is provably dead (see the `missing-media` and `orphan-companion` rules).                                                         | This feature touches every file of every user. A wrong delete loses user data; a skipped one only leaves a line in the report.                                                           | 0033         |

**Out of scope:**

- watching the folder live;
- importing media from outside the vault folder or from subfolders;
- undoing a fix (the run log records every action);
- reconciling cloud-only items with the cloud;
- a cross-process vault lock (see edge case C6).

**Open questions:**

1. Button labels and copy. Proposal: "Check and fix files" for the entry point and
   "Fix all" for the action. "Migrate all" was considered, but after the first run
   the action repairs drift, not a migration.

## Who wins

"The migration" for an item means its first alignment by this feature, `renameItem`,
`allocateId` or adoption. From then on its sidecar carries `fileSync`:

```ts
fileSync?: { stem: string; ino: string; size: number; at: number }
```

`ino` is a string from `stat(…, { bigint: true })`, because Windows file indexes
exceed 2^53.

| Situation                                                                              | Detected by                                  | Winner                                                                            | Result                                                                                     |
| -------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Pre-existing item (no `fileSync`), title ≠ file name                                   | no marker                                    | **Kaipu**                                                                         | The file takes the title.                                                                  |
| Pre-existing item renamed in Finder                                                    | pairing (below), no marker                   | **Kaipu**                                                                         | The record re-attaches, and the file goes back to the title.                               |
| Migrated item, file renamed outside the app                                            | pairing, `fileSync.stem` ≠ current stem      | **Disk** (intentional)                                                            | The title takes the new file name. The record moves along: tags, edits and `assetId` stay. |
| Migrated item, same stem, title ≠ file name                                            | `fileSync.stem` = current stem               | **Kaipu** (a Kaipu change that never reached the disk, such as a `kept-old-name`) | The file takes the title.                                                                  |
| Migrated item whose new file name sanitizes differently (`Demo.` or `CON` from Finder) | the title from the file derives another stem | Disk for the title, sanitizer for the file                                        | Title = the file name verbatim, and the file gets the sanitized stem in the same run.      |

**Pairing a renamed file to its orphaned record** (a sidecar without media, plus media
without a sidecar), strongest signal first:

1. same `fileSync.ino` and size, which a rename on the same volume keeps;
2. same cached `contentSha256` and `hashedSizeBytes`;
3. same extension, same size, and `createdAt` within 2 s of the file's birthtime, but
   only when exactly one candidate matches.

Two or more candidates on any rule means no pairing. Both sides then stay untouched
and are reported as "couldn't match" (edge case M4).

## What the scanner finds

`scanVault(input)` is pure reading. It never calls `list()`, `describe()` or
`ensureIdentity()`, because those write a new `assetId` into legacy sidecars. It
returns one `Finding` per item: `kind`, the current paths, the planned result, and
whether it is fixable now.

| Kind                 | Detected when                                                                      | Fix                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `moved-file`         | A pairing above succeeds.                                                          | Move the companions to the file's stem (`renameItem` machinery, reversed), then apply "Who wins". |
| `stale-auto-title`   | The title matches the old automatic pattern (N1).                                  | Title = `defaultCaptureName(kindFromExt, captureDate)` (N4), then rename.                         |
| `untitled-legacy`    | No title, and the stem matches `LEGACY_STEM`.                                      | Title = `humanizeId(stem)`, then rename.                                                          |
| `name-mismatch`      | `planStem(item)` ≠ the current stem (N2).                                          | `renameItem` with the current title.                                                              |
| `stem-conflict`      | Two media files share a stem (`Demo.mp4` + `Demo.png`); `filePath` shows only one. | The hidden one is adopted under ` (2)`.                                                           |
| `missing-sidecar`    | Media with no sidecar, and not paired.                                             | Adopt: new `assetId`, `title` = stem, `createdAt` from N4, `fileSync`.                            |
| `missing-media`      | A sidecar with no media, not paired, and no `localRemovedAt`.                      | Rules M1–M5.                                                                                      |
| `orphan-companion`   | A companion-shaped file with neither a sidecar nor media of its stem.              | Rules M6–M7.                                                                                      |
| `duplicate-identity` | Two media stems claim one `assetId`.                                               | The oldest keeps it; the rest get a new `assetId` (I1).                                           |

## The fix pipeline

`fixVault(vault, options)` runs in main while the app is open. The vault's
in-process locks (`NAMES_LOCK`, the sidecar locks) serialize it against captures,
saves and in-app renames. Phases, each preceded by a fresh scan:

1. `moved-file`, before anything can be deleted;
2. `orphan-companion` and `missing-media`;
3. `duplicate-identity` and `stem-conflict`;
4. `missing-sidecar`;
5. title rewrites (`stale-auto-title`, `untitled-legacy`, a moved file's title);
6. renames, oldest first by capture date, so the oldest keeps the name without ` (n)`.

After phase 6 the pipeline scans again and repeats phase 6 while something moved.
It stops after 3 rounds; anything left is a bug, so it goes to the report and the
error log.

Every action re-validates its finding under the relevant lock before acting
(TOCTOU): the media is still missing, the identity is still at that stem, the file
is still the same inode. A finding that no longer holds is dropped, not forced.

Every rename goes through `renameItem` with the app's `isBusy` and `isEditing`. An
item under an export, open in the editor, uploading, or locked by another app comes
back `kept-old-name`, stays in the report, and the next press picks it up.

The result is a `ReconcileReport`: counts per kind, `fixed`, `kept` (with a reason)
and `failed`. Each run is logged to `.kaipu/reconcile/<timestamp>.json` with every
action: old and new ids, titles, and deleted paths.

**Idempotence is the contract:** a `scan()` after a complete `fix()` returns only
findings marked unfixable-now (busy, editing, locked, couldn't match). A fixture
vault with one finding of every kind and every edge case below asserts it.

## Banner

- **When:** when the Library or Home opens, at most once per session, again after
  the vault folder changes, and after a fix. The scan runs in main, off the UI path,
  and never while a recording or export is running.
- **What:** "N files in your folder don't match Kaipu. Check and fix." A "Not now"
  link hides it for the session. Nothing is changed until the user presses Fix all.
- **Only fixable findings count.** If only unfixable ones remain (editing, locked,
  couldn't match), the banner says so once ("2 files couldn't be fixed. See why"),
  and stays hidden until that set changes. This avoids a banner that never goes away.
- **Zero findings:** no banner.

## Edge cases

Each row is a test, written red first.

**Names**

| #   | Case                                                                                                                                                | Handling                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Auto titles in other locales: `29/10/2026, 19:57:30`, `29.10.2026, 19:57:30`, `2026/10/29 19:57:30`, `2026. 10. 29. 오후 7:57:30`, `a. m.`, `午後`. | Pattern: a known prefix (`Recording`, `Screenshot`, `Pasted image`, `Imagen pegada`) + `—` + only digits, separators and an allowlist of AM/PM tokens. A title with any other word is user-written, e.g. `prev first change Recording — 9/23/2026, …`.                                          |
| N2  | The stem Kaipu expects.                                                                                                                             | `planStem(item)` reuses the vault's own `resolveRenameTarget`, read-only. It covers the title-to-stem rules, the default-name fallback, ` (n)` collisions, reserved names, the length budget and case folding. A second implementation would drift, and drift means a banner that never clears. |
| N3  | The title sanitizes to nothing (`???`, `...`).                                                                                                      | `renameItem` falls back to the default name from the date. `planStem` uses the same date source (N4), or the item would show as a mismatch on every press.                                                                                                                                      |
| N4  | Capture date.                                                                                                                                       | `createdAt`, then the date in a legacy stem (UTC), then birthtime, then mtime. One function shared by the scan, the fix and `renameItem`'s fallback. A copy resets birthtime, so it is never trusted ahead of the others.                                                                       |
| N5  | A `Recording — …` title on a `.png`.                                                                                                                | The kind comes from the extension, never from the title prefix.                                                                                                                                                                                                                                 |
| N6  | Two captures in the same second get the same default name.                                                                                          | ` (2)`, assigned in a deterministic order: capture date, then the current stem.                                                                                                                                                                                                                 |
| N7  | The vault is on HFS+, exFAT or SMB, which return NFD names from `readdir`.                                                                          | Compare stems after NFC normalization; otherwise every accented title mismatches forever.                                                                                                                                                                                                       |
| N8  | A case-only difference (`demo.mp4`, title `Demo`).                                                                                                  | `renameItem`'s in-place branch. On case-sensitive volumes it is a normal move.                                                                                                                                                                                                                  |
| N9  | A title that is a reserved or companion-shaped name (`tags`, `Demo.edit`).                                                                          | Already guarded by `isReservedStem`; covered by `planStem`.                                                                                                                                                                                                                                     |
| N10 | `Demo (2)` titled `Demo` while `Demo` is still taken.                                                                                               | Aligned: no finding. Once `Demo` is free, a later press moves it. Stable after one run.                                                                                                                                                                                                         |
| N11 | A title the user wrote that looks automatic (`Recording — 1/1/2026, 1:00:00 PM`).                                                                   | Replaced. An accepted risk, listed in the ADR.                                                                                                                                                                                                                                                  |
| N12 | Time zone: running in a different zone than the capture.                                                                                            | The default name uses the current zone, so it can shift by hours from the original title. Documented, not fixed.                                                                                                                                                                                |

**Missing and orphaned files**

| #   | Case                                                                                                                                        | Handling                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | A cloud-only item (`localRemovedAt`).                                                                                                       | Never touched.                                                                                                                                                                    |
| M2  | A sidecar without media whose `assetId` is in the cached cloud catalog.                                                                     | Becomes cloud-only: set `localRemovedAt`.                                                                                                                                         |
| M3  | A sidecar without media, while the cloud is unknown (signed out, no cache) and the sidecar has `contentSha256` (it may have been uploaded). | Kept; reported as "waiting for sign-in". Deleting it could orphan a cloud item's tags.                                                                                            |
| M4  | Pairing ambiguous (two equal files, or two orphaned records).                                                                               | Nothing is deleted or adopted from that group. Reported as "couldn't match".                                                                                                      |
| M5  | A stub from `allocateId` with no media, older than 10 min and not in flight.                                                                | Deleted. An allocation **in flight** (recording, screenshot save, GIF or export writer) is registered in memory and always skipped, whatever its age.                             |
| M6  | A companion file (`.jpg`, `.cursor.json`, `.edit.json`, `.edit.meta.json`, `<id>.assets/`) with no owner.                                   | Deleted only when no stem owns it **both ways**. `Demo.edit.json` is either the sidecar of a legacy item `Demo.edit` or the edit session of `Demo`; if either exists, it is kept. |
| M7  | Unknown files in `.kaipu/`: `tags.json`, `reconcile/`, `drag/`, the cursor-track temp file, anything not companion-shaped.                  | Never deleted; allowlist only.                                                                                                                                                    |
| M8  | A crashed-rename leftover: companions at the old stem whose `assetId` lives at another stem with media.                                     | Deleted, after re-checking under `NAMES_LOCK`.                                                                                                                                    |

**What the folder may contain**

| #   | Case                                                                                                    | Handling                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Dotfiles: `.DS_Store`, AppleDouble `._Demo.mp4` on exFAT, iCloud `.Demo.mp4.icloud`.                    | Skipped. `._Demo.mp4` would otherwise look like media.                                                                                                                |
| F2  | `Thumbs.db`, `desktop.ini`, PDFs and other non-media files.                                             | Ignored.                                                                                                                                                              |
| F3  | Subfolders and symlinks.                                                                                | Ignored (`lstat`).                                                                                                                                                    |
| F4  | An uppercase extension (`Demo.MP4`).                                                                    | Ignored and reported once as "not recognized". `list()` does not show these today; adopting them is a separate change.                                                |
| F5  | A partial file from an export or a cloud download in progress (`.tmp`, `.part`, `.crdownload`, size 0). | Skipped. Writers use temp names; verify each writer during implementation.                                                                                            |
| F6  | The vault is read-only or permission is denied.                                                         | Each action fails cleanly. The report lists it, and nothing is left half done (`renameItem` is crash-safe; sidecar writes are atomic).                                |
| F7  | The folder is unreachable (an unplugged drive, the network down).                                       | The scan errors, the banner stays hidden, and the dialog shows the error. Nothing is treated as missing. **An unreadable folder must never be read as an empty one.** |
| F8  | A large vault (10k items) or a slow network drive.                                                      | Progress in the dialog. The scan reads each sidecar once (concurrency-limited). Measure on the owner's 561-item vault and on a 10k fixture.                           |

**Concurrency**

| #   | Case                                                           | Handling                                                                                                                                                        |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | The user renames, captures or deletes in the app during a fix. | Locks serialize, and each action re-validates (TOCTOU).                                                                                                         |
| C2  | Editor open, export running, upload in flight.                 | `kept-old-name` with its reason. Verify whether uploads read by path and need an `isBusy` signal.                                                               |
| C3  | A file locked by another app (Windows).                        | `renameItem` retries, then `kept-old-name`.                                                                                                                     |
| C4  | The app quits or crashes mid-fix.                              | Every step is crash-safe; the next press resumes. The run log is written incrementally.                                                                         |
| C5  | Library views showing old ids while the fix runs.              | The library refreshes after the fix. Routes use `assetId`; thumbnails reload by new id.                                                                         |
| C6  | A second Kaipu process (dev and prod) on the same vault.       | Not protected; the locks are per process. Documented as a known risk alongside the dev/prod data-isolation follow-up. A cross-process lockfile is out of scope. |
| C7  | The vault folder changed in Settings while a scan or fix runs. | The run is bound to the folder it started with; its result is dropped if the folder changed.                                                                    |

**Identity**

| #   | Case                                                                                          | Handling                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Two items with the same `assetId` (a restored backup next to the original, a copied sidecar). | The oldest by capture date keeps it; the others get a new `assetId` but keep their tags. Cloud and exports keep pointing at the oldest.           |
| I2  | A legacy v1 sidecar without `assetId`.                                                        | One is minted during the fix, never during the scan.                                                                                              |
| I3  | `fileSync.ino` after the vault is copied to another disk.                                     | Inodes differ, so pairing falls back to hash, then size and date. No false "intentional" verdict: if no pairing exists, it is not a `moved-file`. |

## Where it lives

- `src/main/library/vault-reconcile.ts`: `scanVault`, `fixVault` and one handler per
  kind. Pure Node, tested on temp vaults.
- `library-vault.ts`:
  - a read-only `planStem`, the shared capture-date function, and writing
    `fileSync` in `renameItem`, `allocateId` and adoption;
  - an in-flight allocation registry that writers register with.
- `library-service.ts`: `reconcile.scan()` and `reconcile.fix()`. They inject the
  cloud catalog (or "unknown"), `isBusy`, `isEditing` and the in-flight registry,
  then refresh the library.
- IPC `library:reconcile-scan` and `library:reconcile-fix`, plus their types in
  `shared/types/library-storage.ts`, the preload bridge and `desktop/ipc-contract.mdx`.
- Renderer:
  - the banner component on the Library and Home;
  - the "Check and fix files" dialog: findings grouped by kind in plain language
    (current name → new name), then Fix all, then the result;
  - the Settings → Files button;
  - copy in en and es.

## Docs

- ADR 0033, "The library reconciles with its folder on demand": context, the
  who-wins rule, alternatives rejected (watcher, startup migration, report-only,
  Kaipu-always-wins), consequences, non-goals, and the reopen condition: auto-update
  ships, or drift reports keep coming.
- `desktop/library-vault.mdx`: the finding kinds, `fileSync`, and that the scan never
  writes. Close the gotcha that #435 deferred here (crash stubs, leftovers).

## Verification

- Every edge-case row is a unit test; plus the idempotence test, a test that the
  scan writes nothing (bytes and mtimes of the sidecars before and after), and a
  10k-item timing.
- Adversarial review of this plan (GPT-6.1 Sol) before coding, and of the code
  before the PR.
- `bun run verify`. No local E2E (ADR 0006).
- Owner QA on a **copy** of the real vault first, by pointing Settings → Files at the
  copy:
  1. the banner appears;
  2. read the list;
  3. Fix all;
  4. press again and expect "Everything matches";
  5. spot-check in Finder;
  6. rename one file in Finder and check that its title follows and its tags
     survive.

## Order of work

1. ADR 0033, then `planStem` and the capture-date function, extracted from
   `renameItem` with no behaviour change.
2. The scanner with every edge-case test.
3. The fix pipeline, re-scan loop, idempotence test and run log.
4. `fileSync` writes, the in-flight registry, the service, IPC and preload.
5. Banner, dialog, Settings button and i18n.
6. Docs, verify, code review with Sol, PR stacked on #435, babysit.
