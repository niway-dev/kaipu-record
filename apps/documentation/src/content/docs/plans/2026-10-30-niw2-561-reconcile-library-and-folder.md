---
title: Reconcile the library with its folder — plan
description: NIW2-561 — one "Check and fix files" action that lists every disagreement between the library and the vault folder (names, missing files, orphaned records, leftovers) and fixes them in a single idempotent pass.
---

# Reconcile the library with its folder — plan

**Status: 🔵 Proposed · 2026-10-30.** Owner decisions taken in the NIW2-560 thread.
Stacked on [PR #435](https://github.com/niway-dev/kaipu-record/pull/435) (NIW2-560),
which provides `renameItem`. Ticket:
[NIW2-561](https://linear.app/niway/issue/NIW2-561/reconcile-the-library-with-files-changed-outside-the-app-on-reload).
The shipping PR deletes this plan.

## In one minute

After PR #435 a rename moves the file, but nothing aligns the items that already
exist. A read-only scan of the owner's vault on 2026-10-30 (561 media files) found
**zero** items whose file name matches their title:

- 527 carry an old automatic title, `Recording — 10/29/2026, 7:57:30 PM` or
  `Screenshot — …`, over a file named `recording-2026-10-30-00-57-30.mp4`;
- about 32 carry another title. Most are user-written (`UPDATED NAME`, `hero laqi`),
  and some are automatic `Pasted image — …` titles;
- 1 has no title, and 1 media file has no sidecar.

Watching the folder was rejected in NIW2-561. A one-time migration at startup was
rejected too, because the app is local-only and cannot push a fix later. The owner
chose **a button: Settings → Files → "Check and fix files"**:

- it scans and lists every disagreement between the library and the folder;
- "Fix all" repairs them through one pipeline;
- a second press finds nothing;
- the same action serves any future drift, whether from Finder, a crash or a copied
  vault.

| Decision                                                                                                                                                         | Why                                                                                                                                           | ADR          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| The library is the source of truth for names: the file follows the title.                                                                                        | Users only see the library.                                                                                                                   | reuses 0032  |
| Old automatic titles (`Recording —`, `Screenshot —`, `Pasted image —`, `Imagen pegada —` + a locale date) are replaced by the new default name from `createdAt`. | Kept as titles, they become files like `Recording — 10 29 2026, 7 57 30 PM.mp4`.                                                              | reuses 0032  |
| Pasted images are screenshots: `Kaipu Screenshot <date>`.                                                                                                        | They are screenshots; "pasted" was only how they got in. Already pushed to #435 (`00abd0f5`).                                                 | none         |
| Reconciliation runs on demand, from a button; there is no watcher and no startup migration.                                                                      | Local app, no way to re-run a broken automatic migration later; the user sees and triggers the fix. Idempotent, so it is safe to press again. | **new 0033** |
| One scanner both reports and fixes: `scan()` returns findings, and `fix(findings)` applies each one through a handler per kind.                                  | Reporting and fixing cannot disagree, and a new kind of drift is one new handler.                                                             | 0033         |
| A media file without a sidecar is adopted under its file name. A sidecar without media is removed, unless the item is cloud-only.                                | Only the folder knows a file the library has never seen. A record whose file is gone is no longer an item.                                    | 0033         |

**Out of scope:**

- watching the folder live;
- importing media from outside the vault folder;
- undoing a fix (the run log records every action for support);
- reconciling cloud-only items with the cloud.

**Open questions:**

1. A file renamed in Finder (`moved-file`): does the title take the new file name, or
   does the library's title win and the file go back to it? Default: the title takes
   the file name, because the user did that rename on purpose.
2. The button label and copy get reviewed in QA.

## What the scanner finds

`scanVault(vault, catalog)` reads the folder without writing anything. It must not
call `list()` or `describe()`, because `ensureIdentity` writes a new `assetId` into
legacy sidecars. It returns `Finding[]`, one per item, each with a `kind`, the
current paths and the planned result.

| Kind                 | Detected when                                                                                                                                            | Fix                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `stale-auto-title`   | The title matches the old automatic pattern (regex below).                                                                                               | Title = `defaultCaptureName(kind, createdAt)`, then rename.                                                                               |
| `untitled-legacy`    | No title, and the stem matches `LEGACY_STEM`.                                                                                                            | Same as above (title from `humanizeId`).                                                                                                  |
| `name-mismatch`      | The stem is neither `fileStemFromTitle(title)` nor that stem plus ` (n)`.                                                                                | `renameItem` with the current title.                                                                                                      |
| `moved-file`         | A `missing-media` sidecar and a `missing-sidecar` file are the same content: the cached `contentSha256` and size match. This is a rename made in Finder. | Move the companions to the file's stem, which keeps the `assetId`, tags and edits. The title becomes the new file name (open question 1). |
| `missing-sidecar`    | A media file with no `.kaipu/<stem>.json`, not paired by `moved-file`.                                                                                   | Write a sidecar: new `assetId`, `title` = stem, `createdAt` = birthtime.                                                                  |
| `missing-media`      | A sidecar with no media and no `localRemovedAt`.                                                                                                         | If the cloud catalog has its `assetId`, set `localRemovedAt` (cloud-only). Otherwise remove the sidecar and its companions.               |
| `orphan-companion`   | A `.jpg`, `.cursor.json`, `.edit.json`, `.edit.meta.json` or `.assets/` with neither a sidecar nor media of that stem.                                   | Remove it.                                                                                                                                |
| `duplicate-identity` | Two media stems claim the same `assetId`.                                                                                                                | The oldest (`createdAt`, then birthtime) keeps it; the others get a new `assetId`.                                                        |

The automatic-title pattern is a known prefix followed by a locale date, and nothing
else:

```
^(Recording|Screenshot|Pasted image|Imagen pegada) — [\d\s/.,:\-]+(\s?[ap]\.?\s?m\.?)?$   (case-insensitive)
```

A title with extra words, such as `prev first change Recording — 9/23/2026, …`, is
user-written and only gets a `name-mismatch`.

## The fix pipeline

`fixVault(vault, findings, options)` runs in main while the app is open, so the
vault's in-process locks (`NAMES_LOCK`, the sidecar locks) serialize it against
captures, saves and renames. It runs in this order, so each step frees names for the
next:

1. `moved-file` (before anything is removed), then `orphan-companion` and `missing-media` (removals and cloud-only marks);
2. `duplicate-identity`;
3. `missing-sidecar`;
4. title rewrites (`stale-auto-title`, `untitled-legacy`);
5. renames, oldest first, so the oldest item keeps the name without ` (2)`;
6. a second rename pass for items that took ` (n)` while their own name was still
   taken by an item renamed later.

Every rename goes through `renameItem`, with the app's `isBusy` and `isEditing`. An
item under an export or open in the editor comes back `kept-old-name`, stays in the
report, and the next press picks it up. No new code moves files.

The result is a `ReconcileReport`, with counts per kind, `fixed`, `kept` (with a
reason) and `failed`. Each run is logged to `.kaipu/reconcile/<timestamp>.json`,
with old and new ids, titles and actions.

**Idempotence is the contract:** `scan()` right after a full `fix()` returns `[]`.
The test suite asserts it on a fixture vault that holds one finding of every kind.

## Where it lives

- `src/main/library/vault-reconcile.ts`: `scanVault`, `fixVault` and the handler per
  kind, in pure Node with no Electron dependency. Tests run on temp vaults.
- `library-service.ts`: `reconcile.scan()` and `reconcile.fix()`. They inject the
  cloud catalog, `isBusy` and `isEditing`, then refresh the library.
- IPC `library:reconcile-scan` and `library:reconcile-fix`, plus their types in
  `shared/types/library-storage.ts`, the preload bridge and `desktop/ipc-contract.mdx`.
- Renderer, Settings → Files (`FilesSettingsPage`):
  - a "Check and fix files" button opens a dialog with the findings, grouped by kind
    with plain-language labels (current name → new name);
  - "Fix all" runs the fix, then shows the result: "Fixed 527. Kept 2: one is open in
    the editor."
  - With no findings, the dialog says "Everything matches."
  - The copy is in en and es.

## Docs

- ADR 0033, "The library reconciles with its folder on demand": context, decision,
  rejected alternatives (watcher, startup migration, report-only), consequences,
  non-goals, and the reopen condition: auto-update ships, or drift reports keep
  coming.
- `desktop/library-vault.mdx`: the finding kinds, and that the scanner never writes.
- Close the gotcha that #435 deferred to NIW2-561: crash stubs and leftover
  companions are now swept by `missing-media` and `orphan-companion`.

## Verification

- Unit tests per finding kind, in red-green order; the idempotence test; a test that
  the scan writes nothing (mtime and content of the sidecars before and after); a
  test that a busy or editing item comes back as `kept`.
- `bun run verify`.
- Owner QA on the real vault: back up `~/Movies/Kaipu Record`, press the button, read
  the list, Fix all, press again and expect "Everything matches", then spot-check in
  Finder.
- No local E2E (ADR 0006).

## Order of work

1. ADR 0033, then the scanner with its tests per kind.
2. The fix pipeline, the idempotence test and the run log.
3. Service, IPC and preload.
4. Settings button, dialog and i18n.
5. Docs, verify, PR stacked on #435, then babysit.
