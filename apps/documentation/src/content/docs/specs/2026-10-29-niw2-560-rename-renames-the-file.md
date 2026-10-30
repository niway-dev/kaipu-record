---
title: "NIW2-560: Renaming a library item renames its file on disk"
description: "The vault file follows the title: rename moves the media and every companion under a sanitized, collision-free stem, new captures get readable default names, and a file the OS will not let go keeps its name while the title is still saved."
---

# NIW2-560: Renaming a library item renames its file on disk

> Design spec, written **before** implementation. Linear: https://linear.app/niway/issue/NIW2-560. Creates [ADR 0032](/architecture/decisions/0032-the-file-name-follows-the-title/). Status: implemented on branch `feature/niw2-560-renaming-a-library-item-renames-its-file-on-disk-with`, owner QA pending; `desktop/library-vault.mdx` and `desktop/ipc-contract.mdx` describe the implemented behaviour.
> Path: `apps/documentation/src/content/docs/specs/2026-10-29-niw2-560-rename-renames-the-file.md` · Written: 2026-10-29 · Owner decisions 1–3 below were taken before this spec and are not reopened here.

## In one minute

**Summary.** Today `LibraryVault.rename()` writes `title` into `.kaipu/<id>.json` and leaves the file as `recording-2026-10-29-13-51-00.mp4`. Users rename an item, open the folder and cannot find it. Since every durable relation (routes, cloud catalog, tags, export provenance) keys on the sidecar's `assetId`, the filename is free to move. This change makes **the file name follow the title**: a rename derives a filesystem-safe stem from the new title, moves the media file and all of its companions (`.kaipu/<id>.*`) to that stem under one lock, and returns the new `LocalRecording`. New captures get readable default names (`Kaipu Recording 2026-10-29 at 13.51.00`) so the folder reads well even before anyone renames anything. When the OS refuses to move the file (Windows lock, running export), the title is still saved, the file keeps its name, and a non-blocking toast says so with a Retry.

**Decisions.**

| #   | Decision                                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                               | ADR                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | The local id stays "the filename without extension", and a rename changes it. `assetId` remains the only durable identity.                                                                                                                                                | Keeps `list()` a plain `readdir` and the vault readable without the app; every cross-item relation already uses `assetId`, so the id is free to move.                                             | Creates [0032](/architecture/decisions/0032-the-file-name-follows-the-title/) |
| 2   | The title stays in the sidecar; the filename is a sanitized **projection** of it (`fileStemFromTitle`), never the other way round.                                                                                                                                        | A title may contain `: / ? "` or be 500 characters; a filename cannot. The sidecar keeps what the user typed.                                                                                     | 0032                                                                          |
| 3   | Default names for every new item: `Kaipu <Kind> YYYY-MM-DD at HH.mm.ss` in local time (`Kaipu Recording …`, `Kaipu Screenshot …`, `Kaipu GIF …`); exports keep their derived title (`<source title> (YouTube)`). Replaces `recording-<iso>` and `screenshot-…Z`.          | Valid on Windows (no colons), sorts within a day, mirrors macOS's own "Screen Recording … at …" convention, and is what the user sees in Slack after a drag.                                      | 0032                                                                          |
| 4   | A stem is **taken the moment its sidecar exists**: `LibraryVault.allocateId()` derives, resolves collisions and writes a stub sidecar under one module-level names lock; every writer (finalize, screenshot, GIF, stranded recovery) and the rename itself go through it. | Closes the check-then-write gap: two captures in the same second, or a rename racing a save, can no longer overwrite each other's file (`fs.rename` replaces silently on both POSIX and Windows). | 0032                                                                          |
| 5   | Rename order under the lock: save title in the old sidecar → copy companions to the new stem → `fs.rename` the media (commit point) → delete old companions.                                                                                                              | Every crash point leaves either the old item whole or the new item whole; the title is never lost; leftovers are invisible to `list()`.                                                           | none (this spec)                                                              |
| 6   | Collisions get ` (2)`, ` (3)` … checked against media **and** orphan companions, by existence on disk (case-insensitive where the filesystem is). A case-only rename of the same item is a move, not a collision. Same derived stem → the file is not touched.            | Cloud-only items (`localRemovedAt`) are sidecars without media; renaming onto their stem would merge two identities.                                                                              | none                                                                          |
| 7   | If the media cannot be moved (Windows `EPERM`/`EBUSY`/`EACCES` after 3 retries, or an export is running), the result is `file: "kept-old-name"`: title saved, file unchanged, toast with Retry. Never a modal, never a failed rename.                                     | The user asked for a title; the filename is a courtesy we cannot always deliver.                                                                                                                  | none                                                                          |
| 8   | `writeMeta()` never **creates** a sidecar for an id that has neither a sidecar nor a media file.                                                                                                                                                                          | A hash or tag write that was queued behind a rename would otherwise resurrect `.kaipu/<oldId>.json` as an orphan.                                                                                 | none                                                                          |
| 9   | Reconciling files changed outside the app and sweeping leftovers is **NIW2-561**; this change only makes leftovers identifiable (same `assetId` as a live item, no media).                                                                                                | Separate ticket by owner decision.                                                                                                                                                                | none                                                                          |

**Open questions** (none blocks the start of implementation; defaults are stated).

1. Keep the `Kaipu ` prefix in default names? In-app titles then read "Kaipu Recording 2026-10-29 at 13.51.00". Default: **yes** — the name is what leaves the app (drag, Finder, Slack), and the folder is not always the dedicated one.
2. Preserve playback position when the detail page's `<video>` remounts under the new id? Default: **yes**, one effect in `RecordingPlayer` (Unit 5).
3. Does the main-process `exportActive` flag cover the GIF export? Verify in Unit 4; if not, set it from `use-gif-export` too, otherwise a rename during a GIF export fails the export with a 404 on `kaipu-media://`.
4. Windows: libuv opens files with `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`, so the app's own `createReadStream` (media protocol) should not block the rename. **Hypothesis**, to confirm on the Windows CI run or a manual test; the retry + `kept-old-name` path covers the case where it is wrong.
5. Should this PR reuse its own leftovers (a blocked stem whose companions carry our `assetId` and have no media) instead of taking ` (2)`? Default: **yes** (two existence checks, Unit 2); the general sweep stays in NIW2-561.

**Out of scope.**

- Files renamed, moved or deleted outside the app, and sweeping rename leftovers on reload: [NIW2-561](https://linear.app/niway/issue/NIW2-561/reconcile-the-library-with-files-changed-outside-the-app-on-reload) (file without record → add; record without file → remove, where a rename leftover is "record without file whose `assetId` another record with a file already holds").
- Renaming from the video editor (no such UI today) and renaming cloud-only items (no file to move; the title write for them is unchanged).
- Changing `assetId`, the sidecar schema version, or the cloud catalog contract.
- Migrating existing `recording-…`/`screenshot-…` files to the new default names. They keep their stems until the user renames them; `humanizeId` makes their untitled fallback readable (Unit 1).
- Long-path support on Windows (`\\?\`); the length budget below keeps every path under `MAX_PATH` for a vault at the default location.

---

## 1. Why now, and what makes it safe

`apps/kaipu-record/src/main/library/library-vault.ts` says "The filename _is_ the id". That was the first recorder commit's shortcut and has no ADR. Since then:

- Routes address items by `assetId` (`shared/routes.ts`: `/library/:assetId`, `/editor/video/:assetId`, `/editor/image/:assetId`); the renderer resolves `assetId → LibraryVideo` and reads `video.id` only for IPC calls and `kaipu-media://` URLs.
- The cloud catalog (`main/cloud/catalog-client.ts`, `compose-library.ts`) matches on `assetId`; `lastSeenLocalId` is a hint for "local unavailable" that `list()` refreshes on every call.
- Tags live in `.kaipu/tags.json` by UUID and on the item as `tagIds` **inside the sidecar** (ADR 0020) — they move with the sidecar.
- Export provenance (`derivedFromAssetId`) and the editor's "exports of this source" (`useSourceExports(source.assetId)`) use `assetId`.

Nothing durable points at the local id. What does hold it is transient (IPC payloads, URLs in mounted components, in-memory maps), and section 3 lists each one.

Hub background: [Filesystem-first monetization](https://github.com/csdev19/general-knowledge/blob/main/desktop/filesystem-first-monetization.md) (sidecars inside the vault, atomic writes) and the hub's [library vault page](https://github.com/csdev19/general-knowledge/blob/main/desktop/library-vault.md), which still documents the old "rename never touches the file" rule and gets a follow-up once this ships.

## 2. Naming rules

### 2.1 Default names (`shared/default-capture-name.ts`, new)

```ts
export type CaptureKind = "recording" | "screenshot" | "gif";
/** "Kaipu Recording 2026-10-29 at 13.51.00" — local time, second resolution. */
export function defaultCaptureName(kind: CaptureKind, date: Date = new Date()): string;
```

- Format: `Kaipu <Kind> <YYYY>-<MM>-<DD> at <HH>.<mm>.<ss>`, Kind ∈ `Recording | Screenshot | GIF`. Local time (what the user's clock showed), zero-padded, 24-hour. Dots between time fields because `:` is forbidden on Windows and `.` is what macOS uses in its own capture names.
- Lives in `src/shared/` because the **renderer** sets a recording's title (`recorder-store.ts:877`, today `` `Recording — ${new Date().toLocaleString()}` ``) and the quiet-capture path in main sets a screenshot's (`shared/screenshot-title.ts`). Both switch to this helper, so the title and the stem main derives from it are the same string. The module has no value imports from workspace packages (preload rule in CLAUDE.md).
- Exports keep the title `exportTitle()` already builds (`export-runner.ts:92`: "Sprint demo (YouTube)", "Sprint demo (edited)"); the filename follows it. GIF exports keep `t("gifTitle", { title })`. Stranded recoveries get `defaultCaptureName("recording", mtime) + " (recovered)"` as stem and the existing i18n title.
- `timestampId()` in `recording-writer.ts` and `screenshotId()` in `screenshot-save.ts` are deleted; the save-dialog `defaultPath` in `recording-hub.ts:336` uses `defaultCaptureName` + `.mp4`.

### 2.2 From title to stem (`main/library/file-stem.ts`, new)

```ts
/** Longest companion suffix: `.assets/<uuid>.png` (49) or `.json.<pid>.<uuid>.tmp` (~53). */
export const STEM_MAX_CODE_POINTS = 100;
export const STEM_MAX_UTF8_BYTES = 180;
/** null when nothing printable survives — the caller falls back to the default name. */
export function fileStemFromTitle(title: string): string | null;
export function isReservedWindowsName(stem: string): boolean;
```

Rules, applied in this order:

1. `title.normalize("NFC")`. macOS may hand back NFD from the filesystem; we always _write_ NFC, and compare in NFC.
2. Replace every forbidden character with a space: `< > : " / \ | ? *`, U+0000–U+001F, U+007F. Then collapse whitespace runs to one space.
3. Collapse runs of dots to a single dot (`isUnsafeId()` in `media-protocol.ts` rejects any id containing `..`; this keeps the guard valid without changing it).
4. Trim leading dots and spaces (a leading dot is hidden on macOS and fails `isPlainItemId`) and trailing dots and spaces (Windows strips them silently, so the file on disk would differ from the id we believe we wrote).
5. Reserved Windows names: if the segment before the first dot, case-insensitively, is `CON PRN AUX NUL COM1–COM9 LPT1–LPT9` (so `nul`, `Con.v2`, `com1` all count), prefix `Kaipu ` (`Kaipu CON`). Applied on every platform: a vault can be synced to a Windows machine.
6. Cap at `STEM_MAX_CODE_POINTS` (`Array.from` so a surrogate pair is never split), then drop code points from the end while the UTF-8 length exceeds `STEM_MAX_UTF8_BYTES`; re-trim trailing spaces/dots. Budget: a 255-byte component limit minus the longest companion suffix (~53) leaves 202; 180 keeps room for ` (99)`. Path length on Windows: `C:\Users\<name>\Videos\Kaipu Record\.kaipu\` (~50) + 180 + 53 < 260 for any ASCII user name.
7. Empty result → `null`; the caller uses `defaultCaptureName(kind, createdAt)`.

The output always satisfies `isPlainItemId()` (no separators, no leading dot) and `!isUnsafeId()` (no `/`, `\`, `..`). `friendlyDragName()` in `drag-name.ts` becomes a thin wrapper over the same function (same rules, its own 180-code-point cap goes; keep its fallback `Kaipu export`).

### 2.3 Collisions (`LibraryVault.isStemFree`, `LibraryVault.allocateId`)

A stem `s` is **taken** when any of these exists on disk: `<vault>/s.mp4|.webm|.png|.gif`, `<vault>/.kaipu/s.json|.jpg|.cursor.json|.edit.json|.edit.meta.json`, `<vault>/.kaipu/s.assets/`. Existence is asked of the filesystem (`access`), so on APFS/NTFS a differently-cased name is found too; on ext4 `demo` and `Demo` coexist, which a later sync to a Mac would merge — accepted, named in the ADR.

- Candidates: `s`, `s (2)`, `s (3)`, … up to 99; then a random 4-character suffix (`s (a1b2)`) to end the loop.
- Rename-specific: a candidate that equals the current id after `NFC` + case-fold is **self** — not a collision. If it is byte-identical the file is not moved (`file: "unchanged"`); if only case/normalization differs it is a real `fs.rename` (APFS and NTFS both accept a case-only rename in one step).
- Own leftover (open question 5, default yes): a candidate blocked only by companions whose sidecar has `assetId === ours` and no media file is a leftover of an earlier interrupted rename of this very item; it is reused (overwritten) instead of skipped.

### 2.4 `humanizeId` after this change

`describe()` keeps `title: meta.title ?? humanizeId(id)`. New stems are already readable, and the old transformation (`-`/`_` → space, title-case) would turn `Kaipu Recording 2026-10-29 at 13.51.00` into `Kaipu Recording 2026 10 29 At 13.51.00`. New behaviour: a legacy stem matching `^(recording|screenshot)-(\d{4})-(\d{2})-(\d{2})[-T](\d{2})-(\d{2})-(\d{2})` is rendered as the new default name for that kind and timestamp; any other stem is returned as is (trimmed), `"Recording"` when empty.

## 3. Inventory: everything keyed by the local id

Verified by reading the code on `main` @ `16cd8d80`. "Moves" = physically renamed by the vault; "updates" = refreshed by the rename result or the next `list()`; "holds the old id" = transient state that needs an explicit answer.

### 3.1 On disk (the vault moves all of these)

| Path                                                                                                                           | Written by                                                                                                       | Read by                                                                                                                                                                           | Rename action                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `<vault>/<id>.mp4` / `.webm` / `.png` / `.gif`                                                                                 | `recording-writer.ts` (`moveFile` into `vault.filePath(id)`), `writeImage`, `writeGif`, `stranded-recordings.ts` | `list()`, `filePath()`, media protocol, `copyScreenshotById` (`screenshot-ipc.ts:189,211`), drag (`index.ts:163`), reveal, `ensureContentHash`, `probeEditing` (`local.filePath`) | `fs.rename` — the commit point                                                     |
| `.kaipu/<id>.json` (sidecar: title, `assetId`, hash cache, `tagIds`, export/gif/capture meta, editor stamps, `localRemovedAt`) | `writeMeta` (finalize, tags, hash, backfill, `markOpenedInEditor`, `removeLocalCopy`, screenshot save, GIF save) | `sidecar()`, `ensureIdentity`                                                                                                                                                     | Written fresh at the new stem (current content + new title), old one deleted last  |
| `.kaipu/<id>.jpg` (poster)                                                                                                     | `writeThumbnail`                                                                                                 | `thumbnailFilePath` (media protocol `thumb/`), drag icon                                                                                                                          | Copy, then delete old                                                              |
| `.kaipu/<id>.cursor.json` (+ `.tmp` leftovers)                                                                                 | `writeCursorTrack`                                                                                               | `readCursorTrack` → editor                                                                                                                                                        | Copy, then delete old                                                              |
| `.kaipu/<id>.edit.json`                                                                                                        | `video-edit-session.ts: saveSession`                                                                             | `loadSession`, `hasEditSession` (probe, `removeLocalCopy` policy)                                                                                                                 | Copy, then delete old                                                              |
| `.kaipu/<id>.edit.meta.json`                                                                                                   | `saveSession`                                                                                                    | `probeEditing`, `probeEditSession`                                                                                                                                                | Copy, then delete old                                                              |
| `.kaipu/<id>.assets/<assetId>.png`                                                                                             | `saveSession`                                                                                                    | `loadSession`, `probeEditing`                                                                                                                                                     | `cp -r`, then delete old                                                           |
| `.kaipu/tmp/*.part` (staging)                                                                                                  | `RecordingWriter`                                                                                                | `recoverStrandedRecordings`                                                                                                                                                       | Not keyed by id — untouched                                                        |
| `.kaipu/drag/<uuid>/<friendly name>`                                                                                           | `drag-copies.ts`                                                                                                 | OS drop target                                                                                                                                                                    | Not keyed by id (uses the title) — untouched; a drag in flight keeps its hard link |
| `.kaipu/tags.json`                                                                                                             | `tag-repository.ts`                                                                                              | —                                                                                                                                                                                 | Keyed by tag id; per-item tags are in the sidecar — untouched                      |
| `userData/cloud/<userId>/catalog.json` (`lastSeenLocalId`)                                                                     | `LibraryService.list`                                                                                            | `composeLibrary`                                                                                                                                                                  | Refreshed on the next `list()`; nothing to do                                      |

Everything in the first seven rows is enumerated by one new helper, `LibraryVault.companionPaths(id)`, so `remove()`, `renameItem()` and future callers cannot drift. (`remove()` today forgets `.edit.*` and `.assets/`; the IPC handler patches that with `deleteVideoEditSession` — the helper lets `remove()` own it. The `removeLocalCopy` contract — sidecar, thumbnail, session and assets stay — is unchanged.)

### 3.2 In the main process (updated or guarded)

| Holder                                                                                                                   | What it holds                                                                     | Answer                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `readOnlyIdentityMemo` (`library-vault.ts:59`)                                                                           | `sidecarPath → assetId` for read-only vaults                                      | A read-only vault cannot complete a rename (the copy step fails → `kept-old-name`, and the title write itself throws, so the IPC rejects). After a successful rename, delete the old key defensively.                                                                                                                                            |
| `withLock` tails (`atomic-write.ts`)                                                                                     | per-sidecar-path mutex                                                            | Rename holds the **old** sidecar's lock for its whole duration, plus the module-level names lock `vault:names` (section 4).                                                                                                                                                                                                                      |
| `RecordingWriter.sessions`                                                                                               | staging sessions by **session id**, `newId()` only at finalize                    | Not an item id. `newId` dep is replaced by `vault.allocateId()`.                                                                                                                                                                                                                                                                                 |
| `CursorTrackRegistry` / `clickSessions` (`recording-hub.ts`)                                                             | keyed by writer session id                                                        | Untouched.                                                                                                                                                                                                                                                                                                                                       |
| `openSavedScreenshot(target, id)` (`main/index.ts:682`) and `CaptureToastPayload.saved.id` (`screenshot-capture.ts:234`) | the vault id of the last quiet capture, held by the toast window for its lifetime | Already resolves `describe(id)` and warns "no longer in the vault" when it is gone. A shot renamed while its toast is still up gives that warning instead of opening. Improve cheaply: the toast carries `{ id, assetId }`, and `openSavedScreenshot` falls back to finding the item by `assetId` in `vault.list()` when `describe(id)` is null. |
| `LibraryService.list()` maps `editing[rec.id]`, `editSession[rec.id]`                                                    | per-call                                                                          | Rebuilt every call.                                                                                                                                                                                                                                                                                                                              |
| `exportActive` (`main/index.ts`)                                                                                         | "an export is encoding"                                                           | Read by the rename handler as `isBusy()` → `kept-old-name`, reason `busy` (section 5).                                                                                                                                                                                                                                                           |
| `cleanupDragCopies`, `pruneDragCopies`                                                                                   | paths under `.kaipu/drag`                                                         | Not id-keyed.                                                                                                                                                                                                                                                                                                                                    |

### 3.3 In the renderer (updated by the rename result)

| Holder                                                                                                                                                                                                                     | How it gets the id                                                 | Answer                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useLocalLibrary.videos` (`LibraryVideo.id`)                                                                                                                                                                               | `listLibraryItems` → `toLibraryVideo`                              | `rename()` patches the item **by `assetId`** with `id`, `title`, `thumbnailUrl` from the result; main also broadcasts `library:changed`, which re-lists.                                                                                                                                          |
| `LibraryDetailPage` → `localId`, `<RecordingPlayer id>`, `<GifViewer id>`, `ScreenshotViewer src`                                                                                                                          | derived from `video.id` / `thumbnailUrl` each render               | Re-renders with the new id. `<video src>` changes → Chromium reloads the element; `RecordingPlayer` keeps `currentTime`/paused across the `id` change (open question 2). The screenshot `?v=` URL changes → one image re-fetch.                                                                   |
| `useRenameRecording` / `RecordingTitle`                                                                                                                                                                                    | title only                                                         | Unchanged.                                                                                                                                                                                                                                                                                        |
| `ScreenshotEditor` → `savedId`, `savedIdRef`, `autoSavedId`, `useCaptureTitle(onRename)` (`screenshot-editor-page.tsx:133-167, 295-314`)                                                                                   | from `saved.id` after a persist or `source.id`                     | `renameSaved` adopts `result.recording.id` into all three; `persist()` awaits an in-flight rename before using `savedIdRef.current` (section 6).                                                                                                                                                  |
| `VideoEditorPage` → `source.id` (`useStableSource` keyed by `assetId`), `useSessionAutosave(source.id)`, `loadCursorTrack(source.id)`, `probeSource(source.id)`, `kaipu-media://recording/${source.id}`, export `sourceId` | fixed for the editor's lifetime                                    | **No UI can rename a recording while its video editor is mounted** (the editor page owns the single main window; the detail page and the capture toast are the only rename surfaces). This spec records that as an invariant; a future rename surface in the editor must re-key `source` on `id`. |
| `export-runner.ts:318`, `probe-source.ts:29`, `use-gif-export.ts:149`                                                                                                                                                      | `kaipu-media://recording/<sourceId>` over minutes (Range requests) | Covered by the `busy` guard: main refuses to move a file while an export is active, so a running export never sees a 404 mid-stream.                                                                                                                                                              |
| `heal-orphan-metadata.ts:20` + `useOrphanHeal.attempted`                                                                                                                                                                   | ids of local videos                                                | A heal in flight on the old id fails its `backfill` (`writeMeta` guard, decision 8) and is retried on the new id on the next scan — the hook already removes failed ids from `attempted`.                                                                                                         |
| `local-reader.ts:5` (`kaipu-media://screenshot/<id>`)                                                                                                                                                                      | `ImageSource.local.id` for the initial bytes only                  | Reads once on open; later reads use `savedIdRef`.                                                                                                                                                                                                                                                 |
| `useMissingRecordingRecovery`, `editor-routes.tsx: useItemFromParams`, `useSourceExports`                                                                                                                                  | `assetId`                                                          | Unaffected.                                                                                                                                                                                                                                                                                       |
| `markOpenedInEditor(id)` (`useMarkOpened`)                                                                                                                                                                                 | once per visit                                                     | Unaffected; if it lands after a rename it hits the `writeMeta` guard and is swallowed (already `.catch(() => {})`).                                                                                                                                                                               |

### 3.4 Contracts that mention the rule

- `shared/types/library-storage.ts: LocalRecording.id` doc: "stable while the file is not renamed" → "changes when the item is renamed; never persist it".
- `shared/types/electron-api.ts:221`: "updates sidecar metadata; the file is untouched" → the new contract (section 5).
- `desktop/library-vault.mdx` ("filename is still the local id (gotcha)", Gotchas, ops table), `desktop/ipc-contract.mdx:77` — updated by the implementation PR.
- Specs that describe the vault's layout and are **not** contradicted: [NIW2-394 vault directory cache](/specs/2026-10-28-niw2-394-vault-directory-cache/) (caches the _directory_, not ids) and [NIW2-398 drag-out volumes](/specs/2026-10-28-niw2-398-drag-out-volumes/) (`.kaipu/drag/<uuid>/<title>.<ext>` already uses the title; after this change the friendly name and the vault name usually coincide, and the hard link is still taken because a title can differ from a stem).

## 4. The vault API

All in `main/library/library-vault.ts` unless stated. The class stays pure (no Electron), so every path below is unit-tested against a temp folder.

```ts
export const NAMES_LOCK = "vault:names"; // module-level key for withLock; spans every LibraryVault instance

export interface AllocateInput {
  kind: "recording" | "screenshot" | "gif";
  /** The title the item will carry; the stem is derived from it. */
  title: string;
  createdAt: number;
  /** Explicit stem (stranded recovery: "<default> (recovered)"); still collision-resolved. */
  stem?: string;
}

export type RenameFileOutcome = "renamed" | "unchanged" | "kept-old-name";
export type RenameKeptReason = "locked" | "busy" | "io";
export interface RenameResult {
  recording: LocalRecording;
  file: RenameFileOutcome;
  reason?: RenameKeptReason;
}

export class LibraryVault {
  /** Every file the id owns: media (resolved), sidecar, jpg, cursor track (+ .tmp), edit session, edit meta, assets dir. */
  companionPaths(id: string): { sidecar: string; thumbnail: string; cursorTrack: string; cursorTrackTemp: string; editSession: string; editMeta: string; assetsDir: string };

  /** True when no media file and no companion exists for `stem` (see §2.3). */
  isStemFree(stem: string): Promise<boolean>;

  /**
   * Reserve a stem: derive from `title` (or use `stem`), resolve collisions, write a stub
   * sidecar `{ sidecarVersion: 2, assetId: randomUUID(), createdAt, title }` — all under
   * NAMES_LOCK. From this moment the stem is taken; the caller writes the media next and
   * calls `remove(id)` if that fails.
   */
  allocateId(input: AllocateInput): Promise<string>;

  /**
   * Save the title and move the item to the stem it derives. Holds NAMES_LOCK and the
   * old sidecar's lock for the whole operation. Throws for an unknown id or when even
   * the title cannot be written; every other failure resolves with `kept-old-name`.
   */
  renameItem(id: string, title: string, options?: { isBusy?: () => boolean; retry?: RetryPolicy }): Promise<RenameResult>;
}
```

`rename(id, title)` is removed (one caller: the IPC handler). `remove()` deletes `companionPaths(id)` + media and the handler's extra `deleteVideoEditSession` call goes.

### 4.1 `renameItem` step by step

```
withLock(NAMES_LOCK, () => withLock(sidecarPath(oldId), async () => {
  0. assert isPlainItemId(oldId) && hasMedia(oldId)            → else throw ItemNotFoundError
  1. writeMetaLocked(oldId, { title })                          → title is safe whatever happens next
  2. meta = sidecar(oldId); kind from the media extension
     stem = fileStemFromTitle(title) ?? defaultCaptureName(kind, meta.createdAt ?? birthtime)
     newId = resolve(stem, { self: oldId })                     → §2.3
     if newId === oldId                                          → return { file: "unchanged", recording: describe(oldId) }
  3. if options.isBusy?.()                                       → return { file: "kept-old-name", reason: "busy", recording: describe(oldId) }
  4. copy companions old → new (sidecar written fresh with atomicWriteFile; jpg/cursor/edit/meta
     with copyFile(COPYFILE_EXCL); assets with cp(recursive)). Missing ones are skipped.
     On any error: rm every new companion, return { kept-old-name, reason: "io" }
  5. fs.rename(oldMedia, newMedia) with the retry policy (§5.2).
     On final failure: rm every new companion, return { kept-old-name, reason: "locked" | "io" }
  6. Promise.allSettled(rm old companions)                      → best effort, like remove()
  7. readOnlyIdentityMemo.delete(sidecarPath(oldId))
  8. return { file: "renamed", recording: describe(newId) }
}))
```

`withLock` is not re-entrant on the same key; the two keys differ, and `NAMES_LOCK` is always taken first by every caller (`allocateId` takes only `NAMES_LOCK`), so there is no lock-order cycle.

### 4.2 Crash points and what the user sees

| Crash after step        | Disk state                                                                      | Next launch                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                       | Old item whole, new title                                                       | Renamed title, old filename — identical to the `kept-old-name` outcome. A later rename retries the move.                                                                                                                  |
| 4 (partial or complete) | Old item whole; some `.kaipu/<new>.*` companions without media                  | Old item lists normally. The new stem is blocked by companions that carry our `assetId` and no media: the next rename of this item reuses them (§2.3); NIW2-561's sweep removes them otherwise. Invisible in the Library. |
| 5                       | New item whole (media + companions); old companions still present, no old media | New item lists; old sidecar is a "record without file" with a duplicate `assetId` → NIW2-561 deletes it. `composeLibrary` is unaffected (one local item per `assetId`).                                                   |
| 6 (partial)             | As above with fewer old companions                                              | Same.                                                                                                                                                                                                                     |

`fs.rename` within one volume is atomic on APFS, ext4 and NTFS; `.kaipu/` is inside the vault, so companions and media are always on the same volume. The one non-atomic move (`moveFile`'s copy fallback) is never used here: the destination is in the same directory.

### 4.3 `writeMeta` guard (decision 8)

`writeMetaLocked(id, meta)`: if the sidecar does not exist **and** `hasMedia(id)` is false, throw `ItemGoneError` instead of creating a file. Legacy items (media without sidecar) still get one; `allocateId` writes its stub directly, not through `writeMeta`. Callers that can hit it after a rename: `ensureContentHash` (queued hash write), `tags.assign` (queued tag write), `backfill` (orphan heal), `markOpenedInEditor`. All of them already surface or swallow an error; none creates data.

`saveScreenshotToVault` with `overwriteId` adds the same check before `writeImage`: an overwrite of an id that no longer has media throws `ItemGoneError` rather than resurrecting a PNG under the old name.

## 5. IPC contract

Channel name unchanged: `library:rename-local`. Shape:

```ts
// shared/types/electron-api.ts
/**
 * Rename a local item: saves the title and moves the file (and its sidecars) to a
 * name derived from it. `recording.id` is the id to use from now on. `file` says what
 * happened to the file; "kept-old-name" is not an error — the title was saved.
 */
renameLocalRecording(id: string, title: string): Promise<RenameResult>;
```

Handler (`main/library/index.ts`):

```ts
ipcMain.handle(IPC_CHANNELS.renameLocalRecording, async (_event, id: unknown, title: unknown) => {
  if (typeof id !== "string" || !isPlainItemId(id)) throw new Error("rename: invalid id");
  if (typeof title !== "string") throw new Error("rename: invalid title");
  const result = await currentVault().renameItem(id, title.trim(), { isBusy: deps.isExportActive });
  if (result.file === "renamed") broadcastLibraryChanged();
  return result;
});
```

`registerLibraryVaultHandlers` gains `isExportActive: () => boolean` in its deps (wired from the `exportActive` flag in `main/index.ts`). Rejections (unknown id, invalid input, title write failure) keep today's renderer path (`t("errorRename")` / `t("renameError")`).

### 5.1 Outcomes and copy

| `file`          | `reason` | Renderer                          | Copy (en; es mirrors it)                                                                               |
| --------------- | -------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `renamed`       | —        | patch item, no toast              | —                                                                                                      |
| `unchanged`     | —        | patch title, no toast             | —                                                                                                      |
| `kept-old-name` | `locked` | patch title, toast with **Retry** | `library.renameKeptLocked`: "Name saved. The file keeps its old name because another app is using it." |
| `kept-old-name` | `busy`   | patch title, toast with **Retry** | `library.renameKeptBusy`: "Name saved. The file keeps its old name while an export is running."        |
| `kept-old-name` | `io`     | patch title, toast with **Retry** | `library.renameKeptError`: "Name saved, but the file could not be renamed."                            |

Retry = `renameLocalRecording(currentId, sameTitle)` directly (bypassing the "title changed" check in `useRenameRecording`/`useCaptureTitle`); with the title already saved, step 2 derives the new stem and tries the move again. The toast uses the existing `showToast({ message, action: { label: t("common.retry"), onClick } })`.

### 5.2 Retry policy for a locked file

- Retry `fs.rename` on `EPERM`, `EBUSY`, `EACCES`, `ETXTBSY` only; any other code is `io` at once (`ENOENT` means the media vanished → `ItemNotFoundError`).
- 3 retries after the first attempt, delays 150 / 400 / 900 ms (≈1.5 s worst case; the user pressed Enter and is waiting). Injectable `RetryPolicy = { delaysMs: number[]; sleep?: (ms) => Promise<void> }` so tests run with fake timers.
- Expected sources of a lock on Windows: Explorer's preview pane or thumbnail extraction, a media player, antivirus scanning a fresh file. The app's own media-protocol streams should not count (open question 4).

## 6. Concurrency matrix

| In flight when the rename starts                                                            | Mechanism                                                                                                                           | Outcome                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recording finalize / GIF save / screenshot save (new item)                                  | `allocateId` under `NAMES_LOCK`; stub sidecar reserves the stem                                                                     | The capture's stem can never be taken by the rename and vice versa; the rename waits at most for an allocation (milliseconds), never for the media move. |
| Two captures in the same second                                                             | same                                                                                                                                | Second gets ` (2)`; previously both would have written the same `<id>.png` and the second overwrote the first.                                           |
| Export of **this** source (`export-runner` reading `kaipu-media://recording/<id>` by Range) | `isBusy()` guard                                                                                                                    | `kept-old-name` / `busy`; the export finishes; Retry renames afterwards.                                                                                 |
| Screenshot overwrite from the image editor (`persist({ overwriteId })`)                     | Editor serializes: `persist` awaits `renameInFlightRef`; main refuses an overwrite of an id without media                           | Save lands on the new id; a stale overwrite throws instead of creating a duplicate.                                                                      |
| Edit-session autosave (`saveSession(oldId)`)                                                | Invariant: no rename surface while the editor is mounted (§3.3)                                                                     | Not reachable today; stated in the ADR so a new surface must handle it.                                                                                  |
| `ensureContentHash(oldId)` (hashing takes seconds on a large file)                          | Final re-`stat` by old path → `ENOENT` → throws ("File changed while hashing" path or stat failure); its `writeMeta` hits the guard | `removeLocalCopy` answers `hash-unknown` this once; the next call hashes the new id. No orphan sidecar.                                                  |
| Tag write (`tags.assign(oldId)`) queued behind the rename                                   | `hasMedia` passed before; `writeMeta` guard after                                                                                   | Renderer shows `errorTags`, re-lists on the broadcast; the user retries on the new id. Tags already on the item moved with the sidecar.                  |
| A second rename of the same item (double commit)                                            | `NAMES_LOCK` serializes; step 0 fails `hasMedia(oldId)`                                                                             | `ItemNotFoundError`; the renderer treats "not found after a rename" as a silent `refresh()`, not an error toast.                                         |
| Orphan heal `backfill(oldId)`                                                               | `writeMeta` guard                                                                                                                   | Heal fails quietly; retried on the new id by the next scan.                                                                                              |
| Drag in progress (`.kaipu/drag/<uuid>/<title>.<ext>` hard link)                             | Not id-keyed                                                                                                                        | The link keeps the inode alive; the drop target reads fine.                                                                                              |
| Cloud catalog refresh                                                                       | `assetId`                                                                                                                           | Unaffected; `lastSeenLocalId` refreshes on the next `list()`.                                                                                            |

## 7. Renderer flow

- `use-local-library.ts: rename(id, title)` → `RenameResult`. Patch `videos` by `assetId`: `{ ...video, id: recording.id, title: recording.title, thumbnailUrl: recording.thumbnailUrl }`. On `kept-old-name` show the toast of §5.1 with Retry bound to `recording.id`. On a rejection whose message is the not-found marker, `refresh()` silently; otherwise `reportError(t("errorRename"))` as today. Also keep `toLibraryVideo` the single mapper — do not hand-build a `LibraryVideo`.
- `library-detail-page.tsx`: nothing structural; `localId` follows `video.id`. `RecordingPlayer`: hold `currentTime` and `paused` in refs updated from the element's `timeupdate`/`play`/`pause`; when `id` changes, restore them in `onLoadedMetadata` (open question 2). `GifViewer` and `ScreenshotViewer` just re-render.
- `screenshot-editor-page.tsx`: `renameSaved(id, next)` becomes `const result = await renameLocalRecording(id, next); savedIdRef.current = result.recording.id; setSavedId(result.recording.id); if (autoSavedId.current === id) autoSavedId.current = result.recording.id;` plus the toast on `kept-old-name`. Keep the promise in `renameInFlightRef` and `await` it at the top of `persist()`. `useCaptureTitle` is unchanged (it is title-level).
- `recorder-store.ts:877`: `title = defaultCaptureName("recording")`. `shared/screenshot-title.ts: screenshotTitle()` → delegates to `defaultCaptureName("screenshot", date)` (keep the export name; two call sites in main and renderer).
- i18n: add `renameKeptLocked`, `renameKeptBusy`, `renameKeptError` under `library` in `packages/i18n/messages/en.json` and `es.json` (es: "Nombre guardado. El archivo conserva su nombre anterior porque otra aplicación lo está usando." / "… mientras se ejecuta una exportación." / "Nombre guardado, pero no se pudo renombrar el archivo."). The screenshot editor reuses the `library` keys.

## 8. Testing plan

Tests run with the pinned binary: `apps/kaipu-record/node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`. **Never run the desktop Playwright E2E suite locally**; CI runs it on release candidates.

Unit, pure (temp folders, no Electron):

- `file-stem.test.ts`: every rule of §2.2 as a table test (forbidden chars, control chars, `..` collapse, leading dot, trailing dot/space, each reserved name with and without a `.v2` tail, NFD→NFC, 100-code-point cap not splitting an emoji, 180-byte cap on CJK, empty → `null`). Property: the output always passes `isPlainItemId` and never contains `/`, `\`, `..`.
- `default-capture-name.test.ts`: fixed `Date`, each kind, zero padding, local time (set `TZ` in the test or construct from local parts).
- `library-vault.rename.test.ts` (new file beside `library-vault.test.ts`): renamed media + every companion moved, old ones gone; title in the new sidecar; `assetId`, `tagIds`, hash cache preserved; `unchanged` when the stem is equal; case-only rename moves the file; collision with media → ` (2)`; collision with an orphan sidecar (simulate `removeLocalCopy`) → ` (2)`; own leftover reused; `kept-old-name`/`io` when a companion copy fails (make `.kaipu` read-only with `chmod`, as `library-vault.test.ts` already does for the read-only vault case), old item untouched, no new companions left; title still saved in every failure case; `ItemNotFoundError` for an unknown id.
- Locked-file path: inject `fs` operations? Simpler and already the house pattern — `vi.spyOn` on `node:fs/promises` `rename` to reject with `{ code: "EPERM" }` N times then resolve (retry succeeds) or always (→ `kept-old-name`, reason `locked`, N+1 calls, fake-timer delays 150/400/900). `isBusy: () => true` → `busy` without touching the disk.
- `allocateId`: derived stem equals the default name; two concurrent `allocateId` with the same title get distinct ids; stub sidecar has `assetId` and `createdAt`; explicit `stem`; the stub is removed by `remove(id)`.
- `writeMeta` guard: no sidecar + no media → throws; media without sidecar → writes (legacy).
- `humanizeId`: legacy `recording-2026-10-29-13-51-00` → `Kaipu Recording 2026-10-29 at 13.51.00`; arbitrary stem returned as is.
- Writers: `recording-writer.test.ts`, `gif-save.test.ts`, `stranded-recordings.test.ts`, `screenshot-save` tests — assert the new default names, the ` (2)` on a same-second collision, and that a failed media write leaves no stub sidecar. `screenshot-save`: overwrite of a vanished id throws.
- `drag-name.test.ts`: still green after delegating to `fileStemFromTitle`.
- `library-service.test.ts`: unchanged behaviour; add one case where a `list()` after a rename shows one item under the new id.

Renderer (vitest + testing-library, existing harnesses):

- `use-local-library` rename: patches by `assetId` (id, title, thumbnailUrl); toast with Retry on `kept-old-name`; silent refresh on the not-found rejection.
- `recording-player.test.tsx` (new): `currentTime` restored after `id` changes.
- `screenshot-editor-page` save/rename serialization: a persist started during a rename uses the new id.
- `use-capture-title.test.ts`, `use-rename-recording` behaviour: unchanged, still green.

Manual ("How to test it yourself", for the PR body):

1. Record 5 s. The Library shows "Kaipu Recording 2026-10-29 at 13.51.00"; the vault folder has that `.mp4` and `.kaipu/` has the same stem.
2. Rename it to `Sprint demo: part 1/2?` on the detail page. Folder: `Sprint demo part 1 2.mp4`; the detail page still plays, keeps the title with the punctuation, tags stay.
3. Rename to the same name as another item → ` (2)` appears in the folder, not in the title.
4. Take two screenshots within one second (hold the shortcut) → two files, the second ending in ` (2)`.
5. Windows: open the `.mp4` in Media Player, rename in Kaipu → toast "Name saved. The file keeps its old name because another app is using it."; close the player, press Retry → the file is renamed.
6. Start an export, rename the source while it runs → the "while an export is running" toast; the export completes; Retry renames.

## 9. Implementation plan — independent units

Paths relative to `apps/kaipu-record/src/`. Units 1 and 6 have no dependency; 2 needs 1; 3, 4 need 2; 5 needs 4's types (can start against the type file); 7 is last. Commits in English, conventional style; one PR, linking NIW2-560 and ending with the "How to test it yourself" list above.

**Unit 1 — Naming primitives (pure).**
Create `shared/default-capture-name.ts` and `main/library/file-stem.ts` per §2.1–2.2; `drag-name.ts` delegates to `fileStemFromTitle` (keep `friendlyDragName`'s signature and fallback); `humanizeId` per §2.4 (export it for the test). Tests: `file-stem.test.ts`, `default-capture-name.test.ts`, `drag-name.test.ts` unchanged, `humanizeId` cases in `library-vault.test.ts`.

**Unit 2 — Vault: allocate, rename, guard.**
`library-vault.ts`: `NAMES_LOCK`, `companionPaths`, `isStemFree`, `allocateId`, `renameItem` (+ `ItemNotFoundError`, `ItemGoneError`, `RetryPolicy`), `writeMetaLocked` guard, `remove()` over `companionPaths`; delete `rename()`. Types `RenameResult`, `RenameFileOutcome`, `RenameKeptReason` in `shared/types/library-storage.ts`; `LocalRecording.id` doc comment. Tests: `library-vault.rename.test.ts`, allocate/guard cases in `library-vault.test.ts`.

**Unit 3 — Writers adopt `allocateId` and the default names.**
`recording-writer.ts` (drop `newId` dep and `timestampId`; allocate inside the existing "resolve destination before touching the session" try; `takeBack` already calls `vault.remove`), `stranded-recordings.ts` (explicit stem `… (recovered)`), `gif-save.ts` (drop `newId`), `screenshot-save.ts` (drop `screenshotId`, allocate for new, `hasMedia` check for overwrite), `recording-hub.ts:189,336` and `library/index.ts:146` call sites. Tests: the four writer suites per §8.

**Unit 4 — IPC contract and handler.**
`shared/types/electron-api.ts` (`renameLocalRecording` returns `RenameResult`; doc comment), `preload/index.ts` (unchanged call, new type), `main/library/index.ts` (handler per §5, `isExportActive` dep, remove `deleteVideoEditSession` from the delete handler since `remove()` covers it), `main/index.ts` (pass the flag; verify `exportActive` is set by the GIF export too — open question 3 — and if not, send `exportActive` from `use-gif-export` around the encode). Tests: handler-level test with a fake vault if the house has one; otherwise covered by Unit 2 + a type check (`bun run check-types`).

**Unit 5 — Renderer.**
`use-local-library.ts`, `recording-player.tsx` (position across `id`), `screenshot-editor-page.tsx` (adopt new id, serialize persist), i18n keys en/es, toasts per §5.1. Tests per §8 (renderer).

**Unit 6 — Default titles at capture time.**
`recorder-store.ts:877` and `shared/screenshot-title.ts` use `defaultCaptureName`; update `export-sheet.test.tsx` fixtures and `recorder-store.test.ts` expectations that pin "Recording — …". Depends on Unit 1 only.

**Unit 7 — Docs (same PR, after the code matches).**
`desktop/library-vault.mdx`: layout example with the new names, ops table row for `renameItem` ("moves media + companions"), "The filename is still the local id (gotcha)" rewritten as "The filename is the local id and it follows the title", Gotchas bullet replaced, `title` row in the sidecar table. `desktop/ipc-contract.mdx:77` return type. ADR 0032 status → "Proposed — implemented in #<PR>, owner QA pending". Backlog row → 🟢. Open a follow-up on the hub's `desktop/library-vault.md` (it is a copy of the old page).

## 10. Risks and what would make us stop

- **Windows semantics are inferred, not observed.** `fs.rename` replacing an existing target, the error codes under a lock, and `FILE_SHARE_DELETE` on our own streams come from libuv's source and Microsoft's docs. The design does not depend on them being right (the names lock removes the replace risk; the retry + `kept-old-name` path absorbs any lock), but the manual Windows steps in §8 must run before the ADR is accepted.
- **Legacy vaults with thousands of items**: `isStemFree` is up to ~10 `access` calls per candidate; renames and captures are single events, so this is negligible. `list()` is untouched.
- **A title that changes only in characters the stem drops** (`Demo?` → `Demo!`) returns `unchanged` — correct, and the toast stays quiet.
- If the implementation finds a rename surface that _is_ reachable while the video editor is mounted on the same item, stop and report: the invariant in §3.3 is load-bearing for the edit-session case.

## Change log

- 2026-10-29: Spec written from the ticket and a code audit on `main` @ `16cd8d80`. No code changed yet.
- 2026-10-29: Implemented (Units 1–7). Deviations: legacy stems in `humanizeId` are read as UTC and rendered in local time (the default-name rule), so the §8 example holds only in UTC; `friendlyDragName` now uses the vault's projection, so its tests expect spaces instead of `-` and the 100-code-point cap; screenshot-editor renames run through the editor's save queue instead of a separate in-flight ref; the capture toast still carries only the vault id (§3.2 "improve cheaply" not done); open question 3 answered: the GIF export reads its source once, inside the mounted video editor, so `exportActive` does not need to cover it.
- 2026-10-29: Adversarial review fixes. (1) Reserved stems: `fileStemFromTitle` never yields a stem ending in `.edit`, `.cursor` or `.edit.meta` (its sidecar would be another stem's companion) nor `tags` (`.kaipu/tags.json`), and a rename skips candidates whose paths overlap the source's. (2) Screenshot overwrites run under the names lock through `LibraryVault.overwriteImage` and follow the expected `assetId`. (3) Every `kaipu-media://` URL is built by `shared/media-url.ts` with the id percent-encoded; the handler decodes once and answers 400 to malformed escapes. (4) The image editor reads its original bytes before a rename moves the file. (5) The §3.3 invariant is enforced in main: an item open in the video editor keeps its file name (new reason `editing`, new IPC `library:editor-session-open`/`-close`). (6) The detail page shows its loading state only on the first load, so a rename's re-list keeps the player mounted.
- 2026-10-29: Second review fixes. (A) Stems are NFKC-normalized and every reservation/overlap check compares through `fsFold` (NFKC, upper then lower case), so `Demo.curſor`, fullwidth letters and `tagſ` cannot alias a companion or `.kaipu/tags.json`. (B) The editor hold replaces `library:editor-session-open` with `library:editor-session-acquire`: it runs under the names lock (`LibraryVault.acquireForEditor`) and answers the item's current id, and the editor loads and writes only under that id. (C) `overwriteAssetId` is required for a screenshot overwrite; main refuses one without it.
- 2026-10-29: Third review fixes. The editor loads nothing when the hold is null or the acquisition fails (an "item no longer available" state, never the route's id); a hold whose window closed or reloaded while the request waited is refused (per-window generation in `EditorSessions`); `fsFold` folds lower → upper → lower so `ß` and `ẞ` meet.
- 2026-10-29: Fourth review fixes. The rename IPC carries the expected `assetId` (required): `renameItem({ id, assetId }, title)` resolves the item by identity under the names lock and follows it if it moved, so a toast's Retry never renames a new item that took the old name. A crashed editor renderer (`render-process-gone`) releases its holds like a destroyed or reloaded one.
- 2026-10-29: Fifth review fix. Rename, the editor hold and the screenshot overwrite share one resolver (`LibraryVault.resolveIdentity`): the caller's id when it still holds the identity, otherwise exactly one local item; two or more (a copy made with its sidecar) reject with `AmbiguousIdentityError` before any change, shown as a plain toast.
