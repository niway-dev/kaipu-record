---
title: "Library — Lens B (error handling, bugs, logic, races, data integrity)"
description: "Detailed findings from the 2026-10-15 pre-deploy audit: Library — Lens B (error handling, bugs, logic, races, data integrity)."
---

> Part of the [2026-10-15 audit report](/audits/2026-10-15/report/). Paths are relative to `apps/kaipu-record/src/`.

## Summary

The Library's read path is defensive (errors surface as `vaultError`, the cache is per account and written atomically, Range parsing is correct), but its write path is not serialized. Every sidecar write is an unlocked read-modify-write through one shared `<id>.json.tmp` name. Two concurrent writes to the same item lose one update, reject the other, and in about 5% of runs leave invalid JSON. An invalid sidecar reads back as `{}`, so the item loses its title, tags, hash and `assetId`, and the cloud link with them. A real UI path triggers this: pasting a comma-separated list of existing tags. The most important fix is to serialize `writeMeta` per item and give each write a unique temp name (LIB-B1). Three other integrity issues are in the same family: delete removes the sidecar before the media (LIB-B3), `list()` can overwrite a fresher catalog with a stale one (LIB-B4), and a `tags.json` that cannot be read is treated as "no registry", so the next tag write wipes it (LIB-B6).

## Findings

### LIB-B1. Concurrent `writeMeta` on one item loses updates, rejects writes and can corrupt the sidecar (identity, title, tags lost)

- Severity: high
- Category: race
- Confidence: confirmed
- Where: `main/library/library-vault.ts:232-241`
- What happens: two sidecar writes for the same id run at once. Triggers include a paste of `"design, demo, "` into the tag editor (two `setItemTags` calls in back-to-back microtasks, see LIB-B2), tag delete plus a manual tag edit, or rename plus backfill. Both writes read the old sidecar, and both write `.kaipu/<id>.json.tmp`, so each `writeFile` truncates and writes the same inode. The first `rename` moves the tmp file, and the second fails with ENOENT, so its IPC rejects and the renderer shows the "errorTags" toast. When the writes interleave and the later one is shorter, the file holds the short JSON followed by the long one's tail. That invalid JSON is then renamed over the real sidecar. `sidecar()` swallows the parse error and returns `{}`. On the next `list()`, `ensureIdentity` mints a new `assetId`. The item loses its title (it falls back to the humanized id), `createdAt`, tags, cached hash and its cloud link: the cloud entry now appears as a separate cloud-only row next to a "local" duplicate.
- Evidence: I ran a verbatim copy of `sidecar()` and `writeMeta()` under Node, firing two `writeMeta` calls with different payloads 500 times. Result: `{ corrupt: 25, rejected: 497, lostUpdate: 475 }`. So 5% of runs produced unparseable sidecars, about one call in two rejected, and 95% of runs lost one update. The only guard, `identityInFlight`, covers `ensureIdentity` only and is per instance. `currentVault()` creates a new `LibraryVault` for every IPC call (`main/library/index.ts:43-45`), so no lock exists across calls. `VaultTagRepository.serial` covers `tags.json` only, not `assign → writeMeta` (`tag-repository.ts:226`).
- Fix sketch: keep a module-level per-sidecar-path promise chain (keyed by absolute path) that serializes `writeMeta` and `ensureIdentity`'s write. Write to a unique temp name (`.<pid>.<uuid>.tmp`, as `catalog-cache.ts:65` already does).
- Effort: S

### LIB-B2. Pasting several tags at once assigns only the last one; tag chip edits use a stale id list

- Severity: medium
- Category: bug
- Confidence: confirmed
- Where: `renderer/src/features/library/components/tag-editor.tsx:49-60, 90-98`
- What happens: the user pastes `"design, demo, "` into an item's tag field. `onChange` chains `add(piece)` for each piece. Every `add` calls `assign`, which builds `onAssign([...ids, tag.id])` from the `ids` captured at paste time. The second call therefore sends `[...old, demo]` without `design`. Only the last tag stays on the item; the earlier ones are created in the registry but never assigned. The same stale closure affects quick successive chip removals made before the first `setItemTags` resolves, because `setTags` is fire-and-forget (`library-page.tsx:375`) and `ids` only refreshes after the IPC returns. When the tags already exist, no `await` separates the calls, so the two IPCs also hit the LIB-B1 race.
- Evidence: `add` (`:53-60`) closes over `ids` from the render. The reduce chain (`:95`) reuses the same `add` closure for every piece. `onAssign` is `void setTags(...)` with no await or queue.
- Fix sketch: accumulate the ids inside the paste handler and call `onAssign` once with the final list, or keep a ref of the pending id list that each `assign` updates.
- Effort: S

### LIB-B3. Delete removes the sidecar, poster and cursor track before the media; if the media delete fails, the item survives stripped of identity

- Severity: medium
- Category: error-handling
- Confidence: confirmed
- Where: `main/library/library-vault.ts:385-394`
- What happens: the user deletes an item whose media file cannot be removed. Examples: a Finder-locked file (`uchg`, EPERM on macOS), or on Windows a file open in another process or still streamed by `kaipu-media://` (EBUSY). Inside `allSettled`, `remove()` first deletes `.kaipu/<id>.json`, the `.jpg` poster and the cursor track. It then fails on the media file and throws. The renderer shows "errorDelete", but the item is now an orphan. The next list mints a new `assetId` (cloud link lost, so the duplicate row of LIB-B1 appears), the title becomes the humanized id, tags are gone, and orphan heal starts decoding it. The edit session is kept because `deleteVideoEditSession` is skipped after the throw (`index.ts:136-138`), so the state is inconsistent.
- Evidence: the order is metadata first, then `await rm(await this.filePath(id), { force: true })`. No rollback exists. `force: true` only suppresses ENOENT.
- Fix sketch: delete the media first and remove the metadata only after it succeeds (or rename the media into a trash location first). Run `deleteVideoEditSession` only after media removal.
- Effort: S

### LIB-B4. `list()` can overwrite a fresher catalog written by a concurrent refresh with a stale one (ghost and missing cloud items)

- Severity: medium
- Category: race
- Confidence: plausible
- Where: `main/library/library-service.ts:47-63` vs `:82-93`
- What happens: on Library mount, the renderer fires `library:list-items` and `library:refresh-cloud-catalog` at once (`use-local-library.ts:125-130`). `list()` reads the cached catalog C0 at `:48`, then runs serial per-item edit probes (2 to 5 fs calls × n items). Meanwhile `doRefresh` fetches and writes the fresh catalog C1. If C0 needed a `lastSeenLocalId` normalization (for example a freshly uploaded item, a locally deleted item, or a drive reconnected), `list()` then writes `catalogUpdates` derived from C0 over C1 at `:62`. Refresh broadcasts, and every window re-lists from the stale C0′: assets deleted in the cloud reappear as ghosts, new ones are missing, and `catalogVerifiedAt` goes back to the old time. This lasts until the next refresh, which only happens on the next mount.
- Evidence: `CatalogCache.write` chains writes but does not compare versions, so the last writer wins regardless of how old its data is. `list()` holds C0 across many awaits.
- Fix sketch: make the `list()` update a merge inside the cache's write chain. Re-read the current file and patch only `lastSeenLocalId` by `assetId`, or skip the write when the file's `lastVerifiedAt` is newer than the snapshot.
- Effort: S

### LIB-B5. An account switch during a catalog refresh reuses the previous account's in-flight refresh; the new account gets no catalog

- Severity: medium
- Category: logic
- Confidence: confirmed
- Where: `main/library/library-service.ts:70-76`, `main/library/index.ts:83-86`
- What happens: the Library is open and its mount refresh for account A is in flight (up to 100 pages × 15 s timeout). The user signs into account B. `onAccountChanged` calls `service.refreshCatalog()`, which returns A's `inflightRefresh`. A's result writes A's cache (correctly scoped), resolves `ok`, and broadcasts. B's catalog is never fetched. B's Library shows no cloud items, or B's stale cache, until something calls refresh again. Nothing does until the next page mount, because `refreshCloud` is not wired to any UI (LIB-B13).
- Evidence: the dedupe key is "any refresh in flight", not "refresh for this userId". `doRefresh` captures the account at start (`:79`).
- Fix sketch: store `{ userId, promise }` and only reuse it when `userId` matches the current account; otherwise start a new refresh.
- Effort: S

### LIB-B6. An unreadable, corrupt or newer-version `tags.json` is treated as "no registry"; the next tag write erases every tag

- Severity: medium
- Category: bug
- Confidence: plausible
- Where: `main/library/tag-repository.ts:65-72`, `:159-171`
- What happens: `read()` maps every failure to `importLegacy()`: a parse error, an unexpected `version` (for example a vault synced through iCloud or Dropbox from a newer build), or EIO/EACCES on a flaky drive. The legacy `tags` arrays were already stripped on the first import (`:105-109`), so `importLegacy` returns `[]` without writing. The tag drawer shows no tags. The next `create()` calls `write([...[], tag])` and atomically replaces the registry with a single tag. All other tag definitions are lost, and items keep orphan `tagIds` that `assign` silently drops on their next edit. `importLegacy` is not crash-safe either: it rewrites sidecars (removing `tags`) before it writes `tags.json` (`:105-111`), so a crash between the two leaves items pointing at tags that never get stored.
- Evidence: the single `catch` at `:69` does not distinguish ENOENT from other failures, and `version !== 1` returns `[]` at `:68`.
- Fix sketch: only ENOENT means "no registry". For a parse or version failure, refuse writes (throw) and keep the file; write `tags.json` before stripping legacy fields.
- Effort: S

### LIB-B7. "Import once" runs on every `tags:list` for anyone without a registry, adding a full extra vault scan per broadcast

- Severity: medium
- Category: logic
- Confidence: confirmed
- Where: `main/library/tag-repository.ts:65-72, 86-113, 148-151`
- What happens: a user who has never created a tag has no `tags.json`. Every `tags:list` runs `read()`, which hits ENOENT and calls `importLegacy()`. That runs `vault().list()` (a full scan: `describe` and `ensureIdentity` per item) plus another sidecar read per item, finds nothing, and returns `[]` without writing. `list()` then runs a second full `vault.list()` to count usage. Each `library:changed` broadcast therefore triggers three full scans per window (list-items plus 2 in tags:list) instead of two. With 300 items, that adds roughly 300 × (4 access + stat + 2 readFile) ≈ 2,100 extra syscalls per broadcast. This is the common case, since most users have no tags.
- Evidence: `tags.length > 0` gates the write at `:111`, so the empty result is never persisted and the import repeats on every call.
- Fix sketch: always write the registry after an import, even `{version:1,tags:[]}`, and let `importLegacy` reuse the list result that `list()` needs anyway.
- Effort: S

### LIB-B8. The `assetId` minting guard is per instance; concurrent lists mint different ids for a new or hand-imported item

- Severity: medium
- Category: race
- Confidence: plausible
- Where: `main/library/library-vault.ts:83-84, 193-225`; `main/library/index.ts:43-45`
- What happens: a file without a sidecar is dropped into the vault folder (the supported "hand-imported" case), or a legacy v1 item gets listed. Library mount fires `library:list-items` (`use-local-library`) and `tags:list` (`use-tags`) together, and each runs `list()` on its own new `LibraryVault`. Each instance's `identityInFlight` is empty, so each mints its own `randomUUID()` and writes it. One write wins, and the other usually fails with ENOENT on the shared tmp (LIB-B1). That failure is caught as "read-only vault" and stored in `readOnlyIdentityMemo`. If the list-items call lost, the Library shows `assetId` X while the disk holds Y. Clicking the card navigates to `/library/X`, where the detail page's own list returns Y. The page reports the item missing and falls back to the Library (`library-detail-page.tsx:93-99`). Orphan heal also patches the row with `...v`, so it keeps X.
- Evidence: the guard comment ("two parallel describe(id) calls never mint two ids") holds only within one instance, and every IPC call builds a new instance.
- Fix sketch: move `identityInFlight` to module scope keyed by sidecar path (with LIB-B1's per-path lock), and re-read the sidecar after a failed write before falling back to the memo.
- Effort: S

### LIB-B9. Orphan heal retries permanently undecodable or sub-second recordings on every list change, each time fetching the whole file into renderer memory

- Severity: medium
- Category: logic
- Confidence: confirmed
- Where: `renderer/src/features/library/hooks/use-orphan-heal.ts:64-93`, `renderer/src/features/library/media/heal-orphan-metadata.ts:18-29`
- What happens: a recording is a permanent orphan when its duration floors to 0 (any clip under 1 s), when it is corrupt, or when the protocol returns 404 (`res.ok` is never checked). `healOrphanMetadata` returns `null`, and the hook deletes the id from `attempted`. The next change of `videos` relaunches the heal: every `library:changed` re-list, every tag edit, every successful heal of another item. Each attempt calls `fetch(kaipu-media://recording/<id>).blob()`, which reads the whole file (hundreds of MB for a long recording) into the renderer, then demuxes it. The work never succeeds, so it repeats for the life of the page.
- Evidence: `attempted.current.delete(v.id)` on both the null and the catch paths. `isOrphan` is true for `durationSeconds === 0`, and the doc comment admits sub-second clips "share this fate".
- Fix sketch: remember failures per id with a capped retry count and backoff, or retry only on an explicit Sync. Check `res.ok`; read only the first few MB, or use a Range-backed source, for duration.
- Effort: S

### LIB-B10. Overwriting a screenshot in place is not atomic; a crash or full disk mid-write destroys the only copy

- Severity: medium
- Category: bug
- Confidence: confirmed
- Where: `main/library/library-vault.ts:364-367`, called from `main/screenshots/screenshot-ipc.ts:101-103`
- What happens: Save → Overwrite in the image editor calls `writeImage(id, png)`, a plain `writeFile` on `<id>.png`. A crash, power loss, ENOSPC or an unplugged drive during that write leaves a truncated PNG: the user's original screenshot and its edit are both gone. While the write is in flight, a concurrent `kaipu-media://screenshot/<id>` request can `stat` the old size and stream a shorter file, so the response is shorter than its `content-length`. Sidecars, cursor tracks and GIFs (`writeGif`) all use temp + rename; the screenshot media, the one file that is overwritten in place, does not.
- Evidence: `writeImage` has no tmp or rename step, unlike `writeMeta` (`:236-240`) and `writeGif` (`:343-360`).
- Fix sketch: write `<id>.png.part`, fsync, then rename, the same as `writeGif`. `.part` is already ignored by `list()`.
- Effort: S

### LIB-B11. Library IPC handlers pass renderer-supplied ids straight into `join()`; delete and rename can reach outside the vault

- Severity: medium
- Category: bug
- Confidence: plausible
- Where: `main/library/index.ts:89-98, 131-142`; `main/library/video-edit-session.ts:24-30, 213-219`; `main/library/library-service.ts:108`
- What happens: `deleteLocalRecording`, `renameLocalRecording`, `markOpenedInEditor`, `backfillLocalRecordingMeta`, `loadCursorTrack`, `revealLocalRecording`, `removeLocalCopy` and the video-edit-session handlers take a renderer `id` with no validation. For example, a compromised renderer (XSS through an imported title, a malicious URL loaded in a window) could send `deleteLocalRecording("../../Documents/report")`. That calls `rm` on `<vault>/.kaipu/../../Documents/report.json`, `.jpg` and `.cursor.json`, and `rm({recursive})` on `<…>.assets`, and `filePath` resolves `../../Documents/report.{mp4,webm,png,gif}`. The result is deletion of files outside the vault. `rename` and `backfill` write arbitrary `*.json`/`*.jpg` files outside it. `isPlainItemId` exists but only `hasMedia` (tags) uses it, and `startFileDrag` has its own regex check. Untrusted-renderer exposure is low today, but this is the guard the media protocol treats as "do not bypass".
- Evidence: no `isPlainItemId` or `isUnsafeId` call on these paths (grep shows its only caller is `library-vault.ts:245`).
- Fix sketch: validate `isPlainItemId(id)` once at the top of every id-taking handler, or inside `LibraryVault.filePath`/`sidecarPath` and `sessionPath`, and reject otherwise.
- Effort: S

### LIB-B12. Dragging out from a vault on another volume or on exFAT copies the whole file before `startDrag`; the next drag deletes earlier copies

- Severity: low
- Category: bug
- Confidence: plausible
- Where: `main/library/drag-copies.ts:20-32`, `main/library/index.ts:158-172`
- What happens: when the custom vault is on an external drive, the temp folder is on another device (EXDEV); when the vault is on exFAT or FAT, hard links are unsupported. `link` fails and `copyFile` duplicates the whole export (possibly hundreds of MB) before `event.sender.startDrag` runs. The user has already started the gesture (`preventDefault` killed the browser drag), so the native drag starts seconds late or after mouse-up. On ENOSPC the drag fails with only a `console.error`. Separately, every drag first runs `rm -rf kaipu-drag/`, so a second drag deletes the first drag's file while a drop target that reads lazily, such as a browser upload, may still need the path.
- Evidence: `catch { await copyFile(...) }` with no size limit, and `cleanupDragCopies()` at the start of `createDragCopy`.
- Fix sketch: on link failure, fall back to dragging the vault file itself (original name) rather than copying; clean only drag directories older than N minutes.
- Effort: S

### LIB-B13. Cloud catalog refresh failures are invisible: the error is discarded, never logged, and no UI consumes the result

- Severity: low
- Category: observability
- Confidence: confirmed
- Where: `main/library/library-service.ts:95-105`; `renderer/src/features/library/hooks/use-local-library.ts:101, 130`
- What happens: an HTTP 500, a JSON shape change, the 15 s timeout, or an account with more than 10,000 assets (`MAX_PAGES` 100 × 100 always throws "too many pages") all become `{ok:false, reason:"network"}`. The underlying error is never logged or reported. The mount call ignores the result, and `refreshCloud` is returned by the hook but not used by any page. The Library keeps showing the old cached catalog with no indication. For an account over the page cap, the catalog never refreshes again, and neither the user nor production telemetry can tell why.
- Evidence: the `catch (err)` at `:95` keeps only the `unauthorized` kind. `grep refreshCloud` shows no consumer outside the hook.
- Fix sketch: `console.error` or report the error in `doRefresh`; surface a stale-catalog hint using `catalogVerifiedAt`.
- Effort: S

### LIB-B14. Remove-local-copy: the rejection is unhandled, and a failure after the media delete leaves stale UI

- Severity: low
- Category: error-handling
- Confidence: confirmed
- Where: `renderer/src/pages/library-detail/library-detail-page.tsx:183-189`; `main/library/library-vault.ts:402-407`; `main/library/index.ts:76-80`
- What happens: `rm(target)` can throw (EBUSY on Windows while the player streams the file, EPERM on a locked file), or `rm` succeeds and the following `writeMeta` throws (read-only `.kaipu`, LIB-B1 race). In either case the IPC rejects instead of returning `{ok:false}`. `doRemoveLocalCopy` has no try/catch, so the result is an unhandled rejection with no toast. In the second case the bytes are already gone but no broadcast or re-list happens, so the page keeps offering a local copy that no longer exists.
- Evidence: `service.removeLocalCopy` has no catch around `vault.removeLocalCopy`, and `doRemoveLocalCopy` awaits without catch.
- Fix sketch: catch in the service and return `{ok:false, reason:"io"}` (and broadcast if the media is gone); wrap the renderer call with `reportError`.
- Effort: S

## Checked and fine

- `media-protocol.ts` traversal: `%2F`, `%5C` and `%2e%2e` are decoded before `isUnsafeId`, so they are rejected. A null byte makes `access`/`stat` reject, which ends in a 404 inside the try. A malformed `%` throws a URIError, which only fails that request. The `thumb` host can only reach `.kaipu/<id>.jpg`.
- `parseByteRange`: suffix ranges (`bytes=-N`, including N > size), an end beyond EOF (clamped), a start ≥ size (416) and a 0-byte file are all handled. `end < start` returns 416 instead of being ignored, which is harmless for Chromium.
- Recordings do not change size mid-stream because finalize writes `.part` and then renames. Only screenshots are overwritten in place (LIB-B10).
- An unplugged external drive: `mkdir -p` under `/Volumes` fails (root-owned 755), so no phantom folder is created. `readdir` errors propagate as `vaultError`, and `composeLibrary` keeps `lastSeenLocalId` when the vault is unreadable ("local unavailable" works).
- `CatalogCache`: per-account directory with userId sanitizing, unique tmp names and per-user write chains. `doRefresh` writes into the account whose token it used, so there is no cross-account write.
- `fetchCloudCatalog` paging stops on a null cursor and has a 100-page cap, so it cannot loop forever (but see LIB-B13 for the cap's silent failure).
- `ensureContentHash` retries: re-stat after hashing, at most 3 attempts, then a throw that the service turns into `hash-unknown`. That logic is correct.
- `tags.json` writes are serialized by `serial()` with a single repository instance, so the shared tmp name is safe there (unlike sidecars).
- Delete without a broadcast: the Library page, detail page and Editor home are routes of the same window and update local state. No second mounted consumer was found, so this is not reported.
- A vault folder change in the middle of `list()` makes edit probes use the new folder (`vaultDir()` per item). This is a cosmetic edge case for one list cycle and is not reported.
