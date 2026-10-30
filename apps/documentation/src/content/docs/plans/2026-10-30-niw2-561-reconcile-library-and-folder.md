---
title: Reconcile the library with its folder — plan
description: NIW2-561 — one "Check and fix files" action, offered by a banner in the Library and Home and by a button in Settings → Files, that aligns file names with titles, adopts unknown files and moves dead records to an orphans folder, in one exclusive pass that never deletes and never guesses identities.
---

# Reconcile the library with its folder — plan

**Status: 🔵 Approved for implementation, revision 5 · 2026-10-30.** GPT-6.1 Sol, round 4: "safe to implement after the fixes"; the fixes are applied below. Revision 3 adopted the owner's
simplification after two adversarial review rounds (GPT-6.1 Sol): **follow the
names, never infer identities, never delete.** Revisions 1 and 2, with their
findings, are in git history and summarized in the last section. The work is
stacked on [PR #435](https://github.com/niway-dev/kaipu-record/pull/435)
(NIW2-560), which provides `renameItem`. Ticket:
[NIW2-561](https://linear.app/niway/issue/NIW2-561/reconcile-the-library-with-its-folder-from-a-check-and-fix-files).
Follow-up:
[NIW2-589](https://linear.app/niway/issue/NIW2-589/orphaned-records-list-them-and-reassign-one-to-a-file-manually)
(an orphans list with manual reassignment). The shipping PR deletes this plan.

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
button in Settings → Files. The dialog lists what it will do. **"Fix all"** runs
one exclusive pass, and pressing it again finds nothing.

| Decision                                                                                                                                                                                  | Why                                                                                                                                                                                                                          | ADR          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| On demand: a banner and a button. No watcher and no automatic migration.                                                                                                                  | The app is local-only and cannot push a fix for a broken automatic migration. The user sees the problem before anything moves.                                                                                               | **new 0033** |
| **The file name is the only link between a file and its record.** No pairing by inode, hash or date.                                                                                      | Two review rounds broke every pairing rule: inode reuse, file ids that are unstable on exFAT and SMB, swaps made in Finder, restored backups. A false pairing puts one item's tags and edits on another file.                | 0033         |
| **Same item, title ≠ file name → Kaipu wins:** the file takes the title.                                                                                                                  | Covers pre-existing items and in-app renames that never reached the disk (a locked file). No marker is needed: the record and the file share the stem.                                                                       | reuses 0032  |
| **A file with no record → a new item under its disk name.**                                                                                                                               | A rename in Finder is intentional, so its name wins. The old record does not follow (see the next row).                                                                                                                      | 0033         |
| **Nothing is deleted.** A record or companion with no media moves to `.kaipu/orphans/<run>/` with a manifest.                                                                             | The user is in charge; we keep our orphans. The old record of a file renamed in Finder keeps its tags, edits and identity there, for NIW2-589 or the user.                                                                   | 0033         |
| **Fix all runs in maintenance mode:** it does not start while a recording or export is active, and while it runs, every vault operation entering from outside is **refused**, not queued. | Per-item locks do not cover `remove`, `removeLocalCopy`, backfill or companion writers. A queued operation would wake up holding a name the planner gave to another item. Refusing avoids both, with no nested locking (C1). | 0033         |
| **Anything ambiguous is listed and left alone:** duplicate identities, two media files on one stem, items whose companion paths overlap another live item's, unreadable records.          | Fixing these needs choices or primitives we deliberately do not build. The user decides.                                                                                                                                     | 0033         |
| Old automatic titles are replaced by the new default name from the capture date.                                                                                                          | Kept as titles, they would become files like `Recording — 10 29 2026, 7 57 30 PM.mp4`.                                                                                                                                       | reuses 0032  |
| Pasted images are screenshots: `Kaipu Screenshot <date>`.                                                                                                                                 | Already on #435 (`00abd0f5`).                                                                                                                                                                                                | none         |

**Accepted limitations** (written in the ADR):

- **A rename in Finder** turns the file into a new item; its old tags and edits stay
  in the orphans folder (NIW2-589 adds manual reassignment).
- **A swap of two names in Finder** swaps their tags and edits. No record is
  orphaned, so nothing can tell. This is what happens today; reconcile does not make
  it worse.
- **A pre-existing item renamed in Finder** keeps the Finder name instead of going
  back to its old title.

**Out of scope:**

- watching the folder live;
- automatic or suggested re-association (NIW2-589, manual);
- emptying or restoring orphans in the UI (NIW2-589);
- adopting media from subfolders, symlinks or uppercase extensions;
- reconciling cloud-only items with the cloud;
- a cross-process vault lock (C6).

**Open questions:**

1. **Labels:** "Check and fix files" and "Fix all". After the first run the action
   repairs drift, so "migrate" would no longer describe it.

## What the scanner finds

`scanVault(input)` only reads. It never calls `list()`, `describe()`, `sidecar()` or
`ensureIdentity()`, because those write identities or turn read errors into `{}`.
Each sidecar read reports one of five outcomes: `ok`, `missing` (ENOENT), `unreadable`
(EACCES, EIO), `corrupt-json` or `invalid-schema`. Only `ok` and `missing` take part in
fixes; the other three are reported and never written (F9).

| Kind                 | Detected when                                                                                                                            | Fix                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `stale-auto-title`   | The title matches the old automatic pattern (N1).                                                                                        | Title = `defaultCaptureName(kind, captureDate)`, then align.      |
| `untitled-legacy`    | No title, and the stem matches `LEGACY_STEM`.                                                                                            | Title = `humanizeId(stem)`, then align.                           |
| `name-mismatch`      | The stem is not aligned with the title (N2).                                                                                             | `renameItem` with the current title, in planner order (N10).      |
| `stem-conflict`      | Two media files share a stem (`Demo.mp4` + `Demo.png`), ignored media included (`Demo.PNG`, empty, symlink).                             | Listed, not touched; the user renames one in Finder.              |
| `shared-companion`   | An item's companion paths overlap any present stem's (legacy `Demo` + `Demo.edit`), or its record path is the tag registry (`tags.mp4`). | Listed, not touched (M7).                                         |
| `missing-sidecar`    | Media with no record.                                                                                                                    | Adopt: new `assetId`, `title` = stem, `createdAt` = capture date. |
| `missing-media`      | A record with no media, not cloud-only.                                                                                                  | M1–M3.                                                            |
| `orphan-companion`   | A companion-shaped file with no record and no media of its stem.                                                                         | Move to orphans, unless protected (M4).                           |
| `duplicate-identity` | Two media items claim one `assetId`.                                                                                                     | Listed, not touched (I1).                                         |
| `unreadable-record`  | A sidecar read is `unreadable`, `corrupt-json` or `invalid-schema`.                                                                      | Listed, not touched (F9).                                         |

## The fix pipeline

`fixVault(vault, options)` runs in main.

1. **Enter maintenance mode** (C1):
   - a recording or export is active → Fix all does not start; the dialog says which
     one and stays open and dismissible;
   - other operations in flight (a screenshot save, a backfill, a delete) → wait for
     them to finish, with a cancellable and dismissible "Waiting for…" state;
   - once idle, set the maintenance flag. From then on, every operation entering the
     vault from outside is refused with "Kaipu is fixing your files". That covers
     IPC handlers, capture starts, hotkey screenshots, backfill and the editor.
   - only now does the dialog become non-dismissible (progress);
   - one run per vault at a time.
2. Scan, then the first actions:
   1. `missing-media` and `orphan-companion` (to orphans). Remnants of a committed
      rename are checked **first**: a record without media whose `assetId` lives at
      another stem with media goes to orphans. Only then are M2 (cloud-only) and M3
      classified, so a crash mid-rename never turns its remnant into a cloud-only
      record that keeps the name taken (review 3, finding 7);
   2. `missing-sidecar` (adoption);
   3. the title rewrites.
3. **Scan again and plan the renames from that inventory**, not from the first scan.
   An adopted `Ａ.mp4` gets the title `Ａ`, which `fileStemFromTitle` turns into `A`
   (NFKC); the same happens to overlong or companion-shaped names. Run the planner
   (N10).
4. Scan again. Anything fixable left is a bug: it goes to the report and the error
   log, and is not retried in a loop.
5. Clear the flag and refresh the library.

**Reconcile renames never reuse a "leftover" destination.** `renameItem` today
accepts a stem that has a sidecar with the same `assetId` and no recognized media,
and deletes its companions first (`library-vault.ts:341`, `:455`). That stem may be a
cloud-only record with its own edits, or sit beside an uppercase-extension media
file. Reconcile calls it with `allowLeftover: false`: only vacant destinations, and
any leftover goes through the orphans move.

**No journal is needed.** Each action is safe on its own:

- `renameItem` is crash-safe: it copies, commits, then cleans up. Its remnants are
  recognized first (step 2.1).
- Adoption is one atomic sidecar write.
- A move to orphans writes its bundle's manifest entry (original paths, title,
  `assetId`) **before** moving the first file, and marks it complete after the last
  one. A crash in between leaves a manifest entry that the next run completes into
  the same run folder. Pending manifests are resumed **before** classification. For each file, if the destination already exists, that move happened: it is kept, and a source now present at the old path (a new capture that reused the free stem) is **not** taken. If both exist, or the outcome is uncertain, both are kept and reported. An orphan destination is never overwritten. A file an entry still pending after the replay holds is kept out of the fresh classification, so it is retried only through that entry and the bundle never splits.

After a crash, the next "Fix all" sees what is left and finishes it. The only
decisions are "the title wins" and "the disk name wins", and both can be read again
from the vault.

**The report:** `ReconcileReport`, with counts per kind, `fixed`, `moved-to-orphans`,
`kept` (with a reason: locked by another app) and `failed`. The run log goes to
`.kaipu/reconcile/<timestamp>.json`. The orphans manifest
(`.kaipu/orphans/<run>/manifest.json`) records each original path, its orphans path,
the reason, the title and the `assetId`.

**Idempotence is the contract:** a scan after a complete fix returns only findings
that are not fixable now: a locked file, `duplicate-identity`, `stem-conflict`,
`shared-companion` or `unreadable-record`. A fixture vault containing every edge case below asserts it,
including 101 items with one title, a 6-item rename chain and a 2-item cycle.

## Admission contract (maintenance mode)

`vault-activity.ts` owns one flag and one counter per process.

- **`admit(kind)`** checks the flag and increments the counter in one synchronous
  step. It returns a lease or throws `MaintenanceError`, a typed refusal the renderer
  recognizes. `lease.release()` is idempotent and always called in `finally`. Nested
  work runs under the outer lease and never admits again.
- **`enterMaintenance(signal)`** waits until the counter is 0, sets the flag in the
  same synchronous step as the final zero check, and is cancellable. It returns an
  exit function called in `finally`: errors, cancellation and a thrown scan all
  clear the flag. One run at a time.
- **Inventory of admission points.** Each is wrapped before any work starts, and
  holds its lease until every piece of work it spawned is finished:
  - the library IPC handlers in `library/index.ts`, including `list` (it can mint
    identities), rename, remove, `removeLocalCopy` (one lease around
    describe → hash → delete), backfill, `overwriteImage` and tags (`listTags` can
    import legacy tags into sidecars);
  - video edit-session saves (`video-edit-session.ts` handlers);
  - the screenshot-toast `describe` in `main/index.ts`;
  - capture: the **whole** screenshot operation (hotkey and IPC share one admission
    point), taken before hiding windows or grabbing pixels; a refusal shows the
    maintenance message;
  - the recording session, from start through `finalize`, the cursor write and
    abort cleanup, pinned to its vault folder (C9). Finalize is part of the take's one
    lifecycle: a page that goes away mid-finalize waits for it before the lease is freed.
    An abandoned export's partial is discarded; a recording's is kept;
  - export: `setExportActive` becomes an acknowledged `export:begin` invoke, made
    before the source is read, and released on completion, cancellation or the
    renderer going away;
  - GIF save, stranded recovery, the vault-folder change.
  - **Exempt:** drag copies and their cleanup at startup and quit, because
    `.kaipu/drag/` is outside reconciliation.
- **Editors:** a save refused with `MaintenanceError` keeps its pending state. A
  `library:maintenance-ended` event makes the video and screenshot editors retry
  their latest pending state. Dirty and navigation protection stay on throughout.
  This is a retry from the renderer, not a queue in main, so no stale vault
  operation wakes up.

## Banner

- **When:** on opening the Library or Home, at most once per session; again after the
  vault folder changes and after a fix. The scan runs in main, never during a
  recording or export.
- **Text:** "N files in your folder don't match Kaipu. Check and fix." "Not now"
  hides it for the session.
- **What counts:** only fixable findings. If only unfixable ones remain, the banner
  says it once ("2 files need your attention") and stays hidden until that set
  changes.
- **No findings:** no banner.

## Edge cases

Rows are tested as grouped scenarios plus failure-point tests (a crash or an injected error at every step), written red first. The 10k timing is a smoke measurement, without a threshold.

**Names**

| #   | Case                                                                                                                                           | Handling                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Automatic titles in other locales: `29/10/2026, 19:57:30`, `29.10.2026`, `2026/10/29 19:57:30`, `2026. 10. 29. 오후 7:57:30`, `a. m.`, `午後`. | Pattern: a known prefix (`Recording`, `Screenshot`, `Pasted image`, `Imagen pegada`) + `—` + only digits, separators and an allowlist of AM/PM tokens. Any other word makes it user-written.                                                                                                               |
| N2  | When a stem counts as aligned.                                                                                                                 | `isAligned(stem, title, kind, date)` is true when the NFC-normalized stem equals `base`, `base (n)` with 2 ≤ n ≤ 99, or `base (xxxx)` with 4 hex digits. `base` = `fileStemFromTitle(title)` or its default-name fallback. It is never "what the resolver would pick now", which re-rolls random suffixes. |
| N3  | A title that sanitizes to nothing (`???`).                                                                                                     | The base is the default name, from the capture-date function `renameItem` also uses (N4).                                                                                                                                                                                                                  |
| N4  | Capture date.                                                                                                                                  | `createdAt`, then the date in a legacy stem (UTC), then birthtime, then mtime. One function, shared with `renameItem`'s fallback.                                                                                                                                                                          |
| N5  | A `Recording — …` title on a `.png`.                                                                                                           | The kind comes from the extension.                                                                                                                                                                                                                                                                         |
| N6  | Two captures in the same second.                                                                                                               | Suffixes are assigned in a deterministic order: capture date, then the current stem.                                                                                                                                                                                                                       |
| N7  | NFD names from HFS+, exFAT or SMB.                                                                                                             | Compare after NFC.                                                                                                                                                                                                                                                                                         |
| N8  | Case-only difference (`demo.mp4`, title `Demo`).                                                                                               | `name-mismatch`; handled by `renameItem`'s in-place branch. A case change made in Finder is the same thing: Kaipu wins, since the record follows the stem case-insensitively.                                                                                                                              |
| N9  | Reserved or companion-shaped titles (`tags`, `Demo.edit`).                                                                                     | `fileStemFromTitle` and `isReservedStem` decide the base.                                                                                                                                                                                                                                                  |
| N10 | Chains (titles B, C, D, E, F over files A–E) and cycles (A↔B).                                                                                 | The planner moves an item when its base is free; each move frees a name; it repeats until nothing moves (bounded by the item count). Whatever still waits takes the first free suffix, which is aligned under N2. A cycle therefore ends with one ` (2)`. No temporary names, only `renameItem`.           |
| N11 | More than 99 items titled `Demo`.                                                                                                              | Random-tail suffixes are aligned and never re-rolled. Fixture with 101 items.                                                                                                                                                                                                                              |
| N12 | A user title that looks automatic.                                                                                                             | Replaced. Accepted risk.                                                                                                                                                                                                                                                                                   |
| N13 | Different time zone than at capture.                                                                                                           | The default name uses the current zone. Documented.                                                                                                                                                                                                                                                        |

**Records without media, and orphans**

| #   | Case                                                                                                                                                                                                   | Handling                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | A cloud-only item (`localRemovedAt`).                                                                                                                                                                  | Never touched.                                                                                                                                                                                                                                                                                               |
| M2  | A record without media whose `assetId` is in the cached cloud catalog.                                                                                                                                 | Becomes cloud-only (`localRemovedAt`), so the cloud item keeps its tags.                                                                                                                                                                                                                                     |
| M3  | Any other record without media: a file renamed or deleted in Finder, a crashed capture's stub, the cloud unknown (signed out). Committed-rename remnants are classified before M2 (pipeline step 2.1). | Moved to orphans with all its companions. The library no longer lists it. Recoverable from the manifest; NIW2-589 reads it.                                                                                                                                                                                  |
| M4  | A companion (`.jpg`, `.cursor.json`, `.edit.json`, `.edit.meta.json`, `<id>.assets/`) with no owner.                                                                                                   | Moved to orphans, except when protected: owned both ways (`Demo.edit.json` is the sidecar of `Demo.edit` or the edit session of `Demo`), or its stem has a present-but-ignored media file (F3, F4).                                                                                                          |
| M5  | Unknown files in `.kaipu/`: `tags.json`, `reconcile/`, `orphans/`, `drag/`, cursor-track temp files.                                                                                                   | Allowlist only; never touched.                                                                                                                                                                                                                                                                               |
| M7  | Shared companion paths: legacy `Demo.edit.mp4` beside `Demo.mp4`, where `.kaipu/Demo.edit.json` is both Demo's edit session and the other item's sidecar.                                              | Ownership is computed per physical path, from every present stem (live, in conflict, symlink, empty, uppercase extension, vault-owned). Both items are `shared-companion`: never renamed, never moved to orphans. `renameItem` called by reconcile refuses a source whose companions another live item owns. |
| M6  | Run folders.                                                                                                                                                                                           | `.kaipu/orphans/<timestamp>-<uuid>/`, created exclusively (`mkdir` without `recursive` on the leaf); paths keep their relative layout inside.                                                                                                                                                                |

**What the folder may contain**

| #   | Case                                                                   | Handling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Dotfiles: `.DS_Store`, `._Demo.mp4` (AppleDouble), `.Demo.mp4.icloud`. | Skipped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F2  | `Thumbs.db`, `desktop.ini`, non-media files.                           | Ignored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F3  | Subfolders and symlinks.                                               | Ignored (`lstat`). A symlinked media file protects its companions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| F4  | An uppercase extension (`Demo.MP4`).                                   | Not adopted; protects its companions; reported as "not recognized".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F5  | Partial files: `.tmp`, `.part`, `.crdownload`, size 0.                 | Skipped. Writers are idle during a fix (C1); each writer's temp naming is checked during implementation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F6  | A read-only vault, or permission denied.                               | Each action fails cleanly and goes to the report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F7  | An unreachable folder.                                                 | The scan errors, nothing counts as missing, and the banner stays hidden. **An unreadable folder is never read as an empty one.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F8  | 10k items, or a slow network drive.                                    | Progress in the dialog and concurrency-limited reads. A 10k-item timing test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F9  | A sidecar that is unreadable, has corrupt JSON or an invalid schema.   | Listed and never written, by anyone. **Today `sidecar()` turns it into `{}`, and `ensureIdentity`, `writeMetaLocked` (backfill, editor open) and `renameItem` merge over it.** This PR adds the strict read to every sidecar mutation boundary, checked **before** touching media or companions (`overwriteImage` writes the PNG first today; edit-session saves must preflight too). `list()` handles it per item: the item appears read-only (`readable: false`), never failing the whole list: they throw `UnreadableRecordError`, the item lists read-only, and automatic healing skips it. Test: scan → fix another item → refresh → backfill leaves it byte-identical. |

**Concurrency**

| #   | Case                                                                                                                         | Handling                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Captures, exports, editor saves, deletes, local-copy removal, backfill, renames, folder change.                              | **Maintenance mode, checked only at entry points**: IPC handlers, capture starts, hotkey screenshots, the backfill loop, stranded recovery. While the flag is set they refuse with "Kaipu is fixing your files". Vault methods themselves take no gate, so there is no nesting and no deadlock. An `activity` counter, raised once per top-level operation and released when it ends, tells Fix all when the vault is idle. |
| C2  | Editor open on an item (`isEditing`).                                                                                        | Fix all can run; that item's rename is `kept`, and the next press picks it up. Editor saves during the run are refused and retried by the editor's autosave.                                                                                                                                                                                                                                                                |
| C3  | A file locked by another app (Windows).                                                                                      | `renameItem` retries, then `kept-old-name`.                                                                                                                                                                                                                                                                                                                                                                                 |
| C4  | A crash or quit mid-fix.                                                                                                     | The next run finishes the job (see "No journal"). The flag is in memory, so a crash clears it.                                                                                                                                                                                                                                                                                                                              |
| C5  | Library views open during a fix.                                                                                             | Refresh after the fix; routes use `assetId`.                                                                                                                                                                                                                                                                                                                                                                                |
| C6  | A second Kaipu process (dev and prod) on the same vault.                                                                     | Not protected; maintenance mode is per process. Documented with the dev/prod isolation follow-up.                                                                                                                                                                                                                                                                                                                           |
| C7  | The vault folder changes mid-run.                                                                                            | Changing the folder is an entry point: refused during maintenance.                                                                                                                                                                                                                                                                                                                                                          |
| C8  | An operation requested before the fix, executed after it, holding a stale id (`remove("B")` while B was renamed).            | Nothing queues across a run: requests arriving during maintenance are refused, so none wakes up afterwards. Requests already in flight finish **before** maintenance starts (the idle wait).                                                                                                                                                                                                                                |
| C9  | A recording: `writer.finalize` returns, then the hub writes the cursor track by stem, using the vault folder it reads again. | The recording's activity lease spans the whole hub operation, cursor write and abort cleanup included, and pins the vault folder it started with. Fix all cannot start in that window.                                                                                                                                                                                                                                      |
| C10 | A long recording, or a slow drive while waiting.                                                                             | Fix all does not start during a recording; the dialog says so and stays dismissible. The idle wait for short operations is cancellable.                                                                                                                                                                                                                                                                                     |

**Identity**

| #   | Case                                                                         | Handling                                                                                          |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| I1  | Two media items claim one `assetId` (a backup restored beside the original). | Listed and untouched. Renames of those items already refuse (`AmbiguousIdentityError`).           |
| I2  | A v1 sidecar without `assetId`.                                              | Not a finding. `list()` mints it as today; reconcile mints it only on items it is already fixing. |

## Where it lives

- `src/main/library/vault-reconcile.ts`: the scanner, the planner, the orphans move
  and the handlers. Pure Node, tested on temp vaults.
- `library-vault.ts`:
  - `allowLeftover: false` and the shared-companion refusal in `renameItem` (reconcile only);
  - `isAligned` and the capture-date function, shared with `renameItem`;
  - a strict sidecar reader;
  - every sidecar mutation (`ensureIdentity`, `writeMetaLocked`, `renameItem`) refuses an unreadable record.
- `src/main/library/vault-activity.ts`: the maintenance flag and the activity counter.
- Entry points (IPC handlers in `library/index.ts`, `recording-hub.ts` through the
  cursor write, `screenshot-save.ts`, `gif-save.ts`, export, stranded recovery, the
  backfill loop, the vault-folder change): check the flag and hold one activity lease
  per top-level operation.
- `library-service.ts`: `reconcile.scan()` and `reconcile.fix()`. They inject the
  cloud catalog (or "unknown"), `isBusy` and `isEditing`, then refresh.
- IPC `library:reconcile-scan` and `library:reconcile-fix`, plus progress events,
  types, preload and `desktop/ipc-contract.mdx`.
- Renderer:
  - the banner on the Library and Home;
  - the dialog: findings in plain language (current name → new name), Fix all,
    progress, result;
  - the Settings → Files button;
  - copy in en and es.

## Docs

- ADR 0033, "The library reconciles with its folder on demand":
  - the decisions above;
  - the accepted limitations;
  - alternatives rejected: a watcher, a startup migration, automatic re-association
    (with the review findings that killed it), deleting orphans, and choosing among
    duplicate identities;
  - reopen condition: auto-update ships, or users report lost tags after Finder
    renames often enough to justify NIW2-589's suggestions.
- `desktop/library-vault.mdx`: the finding kinds, the orphans folder, maintenance mode, and
  that the scan never writes. Close the gotcha #435 deferred here.

## Verification

- One unit test per edge-case row, plus:
  - idempotence;
  - "the scan writes nothing" (bytes and mtimes before and after);
  - "every original payload survives", at its live destination or in orphans,
    including with injected failures mid-run;
  - "scan → fix another item → refresh leaves a corrupt sidecar byte-identical";
  - maintenance tests: every entry point refuses during a fix; a fix waits for
    in-flight short operations and refuses during a recording; the recording lease
    spans the cursor write;
  - `renameItem` from reconcile never reuses a leftover and never splits a shared
    companion;
  - a 10k-item timing.
- Adversarial review: this revision by GPT-6.1 Sol before coding, then the code before
  the PR.
- `bun run verify`. No local E2E (ADR 0006).
- Owner QA on a **copy** of the real vault (point Settings → Files at it):
  1. the banner appears;
  2. read the list;
  3. Fix all;
  4. press again and expect "Everything matches";
  5. spot-check in Finder;
  6. rename a file in Finder, press again, and expect the file as a new item and the
     old record in `.kaipu/orphans/`.

## Order of work

1. ADR 0033. Extract `isAligned` and the capture date from `renameItem`, with no
   behaviour change.
2. The strict reader and the `ensureIdentity` fix for corrupt records.
3. Maintenance mode and activity leases at every entry point.
4. The scanner, with every edge-case test.
5. The orphans move, the planner and the fix pipeline, with the idempotence and
   payload-survival tests.
6. Service, IPC and preload.
7. Banner, dialog, Settings button and i18n.
8. Docs, verify, code review with Sol, PR stacked on #435, babysit.

## Review history

- **Revision 1 → 2** (Sol, 13 findings, 4 blockers): deletion of ownerless
  companions, stubs and duplicates; weak pairing; lost unapplied renames;
  non-convergence. Revision 2 answered with quarantine, markers, strong pairing, a
  journal and a planner.
- **Revision 2 → 3** (Sol, 8 more findings, 2 blockers):
  - temporary moves incompatible with `renameItem`;
  - writers outside the locks (`remove`, backfill);
  - swaps made in Finder escaping pairing;
  - corrupt sidecars overwritten by the refresh;
  - allocation and `pendingName` crash windows;
  - inode reuse;
  - two runs sharing one journal.

  The owner chose to drop identity inference entirely (revision 3). That removes the markers, the
  pairing, the journal and the temporary names. It keeps the planner with suffix
  cycle-breaking and moves dead records to orphans (the quarantine, renamed). The
  exclusive gate and the corrupt-record fix answer the rest.

- **Revision 3 → 4** (Sol, 12 findings, 3 blockers):
  - `renameItem` reusing leftovers → `allowLeftover: false`;
  - gate deadlocks and queued stale ids → maintenance mode at entry points, refused
    not queued, with no gate inside vault methods;
  - the recording cursor write → a lease spanning the hub;
  - corrupt records still merged by `writeMeta` → strict read at every mutation;
  - shared companion paths → `shared-companion`, listed only;
  - crash remnants turning cloud-only → remnants classified first;
  - `stem-conflict` needing a new primitive → listed only;
  - plan built from a stale scan → re-scan before planning;
  - a non-dismissible wait → dismissible until mutation starts;
  - orphan manifest before moves, and unique run folders;
  - I2 narrowed.
- **Revision 4 → 5** (Sol, 6 findings, no blockers; verdict "safe to implement after
  the fixes"): admission contract and full inventory; atomic admit and enter;
  acknowledged export start; strict reads before any write, with read-only items per
  item; editor retry on `maintenance-ended`; captures admitted before pixels;
  orphan-manifest replay never takes a reused source.
