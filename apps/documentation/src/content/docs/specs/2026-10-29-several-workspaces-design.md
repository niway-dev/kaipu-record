---
title: Several workspaces — separate libraries for work and personal captures
description: Design for letting the desktop app keep several workspaces (folders with Kaipu files), one active at a time, with captures landing in the active one, cloud entries tagged by workspace, per-workspace tags, and a crash-safe move of an item between workspaces.
---

# Several workspaces — design

**Status: 🔵 Proposed · 2026-10-29.** Decisions approved by the owner on 2026-10-29
([NIW2-370](https://linear.app/niway/issue/NIW2-370)). Nothing implemented. Creates
[ADR 0032](/architecture/decisions/0032-workspaces-identity-in-the-folder-one-active/) and
[ADR 0033](/architecture/decisions/0033-moving-an-item-between-workspaces/); reuses
[ADR 0020](/architecture/decisions/0020-tags-are-entities-with-stable-ids/).
Backlog: [Several workspaces](/backlog/several-workspaces/).

## Summary (one minute)

Kaipu gets **workspaces**: separate libraries, for example "Work" and "Personal", so that a
leak of one never includes the other. A workspace is a **folder the user already has**. Kaipu
writes `.kaipu/workspace.json` into it (an id and a name), and adopts a folder that already
has Kaipu files. The list of workspaces and the active one live in the app's preferences.
**One workspace is active at a time**, switched from a selector at the top of the sidebar.
The Library, the editors, tags and **every new capture** use the active workspace. There is no
combined view and no destination picker. Switching is locked while anything is being written,
so a recording ends in the workspace it started in, and a switch is a transaction: editors
flush and close, pending toasts are dropped, and main refuses any call stamped with the old
workspace. A workspace on a disconnected drive shows
as unavailable, and Kaipu never falls back to another one. **Tags stay per workspace.** The
**cloud catalog stays per account**, and each cloud asset records its `workspaceId` on the
server, so a workspace's Library hides the others' cloud items. A finished recording or
screenshot can be **moved** to another workspace from the Library or the editor. The move
renames on the same drive, and copies, verifies the sha256 and then deletes across drives.
It keeps the item's `assetId`, remaps tags by name, adds a suffix on a name collision, removes
the item's drag copies from the source, serializes against the editor's saves, and heals itself
after a crash by inspecting both media files and rolling forward, never by deleting a target
because a journal says `copying`. Removing a workspace never touches the user's media.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                | ADR         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 1   | One **active** workspace, switched from a selector. No combined view. New captures always save to the active workspace.                                                                                                                                                                                                                                                 | Separation is the goal. A combined view turns it into a filter that one bug or a shared screen defeats. A per-capture picker makes a wrong click the leak.                                                         | 0032 (new)  |
| 2   | A workspace is an existing folder. Kaipu writes `.kaipu/workspace.json` (UUID + name). A folder with `.kaipu/` is adopted: reuse `workspace.json`, mint it if absent. The list + `activeId` live in userData preferences.                                                                                                                                               | Identity must travel with the folder (copy, rename, another Mac). The app must know which folders exist without scanning disks.                                                                                    | 0032        |
| 3   | First launch: the current vault becomes the first workspace. Cloud entries without a `workspaceId` belong to it.                                                                                                                                                                                                                                                        | Nobody loses anything and nothing has to be chosen on upgrade.                                                                                                                                                     | 0032        |
| 4   | Cloud catalog stays per account. Every cloud asset stores `workspaceId` **on the server**. A Library hides cloud entries of other workspaces.                                                                                                                                                                                                                           | The local catalog is a cache rebuilt from the server on every refresh, so a client-only field would be lost (see [Things the code contradicted](#things-the-code-contradicted)).                                   | 0032        |
| 5   | Tags stay per workspace. ADR 0020's reopen condition ("several vaults must share one tag vocabulary") is **not met**.                                                                                                                                                                                                                                                   | Shared tags would leak a work vocabulary ("Client X") into the personal workspace — the opposite of the goal.                                                                                                      | reuses 0020 |
| 6   | Move a finished item: media, sidecar, thumbnail, cursor track, edit project. Same volume = rename; other volume = copy, verify sha256, delete. `assetId` kept; tags remapped by name; collision → suffix. Source drag copies removed; one per-item lock shared with saves; crash recovery verifies both media files and rolls forward. From the Library and the editor. | The first launch puts everything in one workspace; moving is how the user separates it. Keeping `assetId` keeps the cloud link and lineage.                                                                        | 0033 (new)  |
| 7   | Switching is locked while recording (and while exporting, saving or moving). A recording finishes in the workspace it started in. The switch itself is a transaction: flush and close editors, drop pending toasts and caches, bump a generation; main rejects stale calls. Captures bind their workspace at start.                                                     | The writer resolves the folder three times today (start, finalize, cursor track). An open editor, a retained quiet capture or a paused tag write would otherwise still reach the other workspace after the switch. | 0032        |
| 8   | An unreachable workspace is unavailable: cannot be switched to or moved into. An unreachable **active** workspace refuses captures; it never falls back.                                                                                                                                                                                                                | Falling back to "whatever is reachable" sends work captures into the personal folder.                                                                                                                              | 0032        |
| 9   | Two actions: **Remove from list** (unregister, nothing on disk changes) and **Delete workspace** (`.kaipu/` to the OS Trash via `shell.trashItem`). Media is never touched. _Default pending owner confirmation — see Open questions._                                                                                                                                  | Owner: deleting a workspace removes Kaipu's files only. Two verbs keep the reversible action reversible.                                                                                                           | —           |
| 10  | Implementation waits for NIW2-394 and NIW2-398. **Both are already merged** (#410, #412), so the dependency is met.                                                                                                                                                                                                                                                     | They touch `vault-location.ts` and `drag-copies.ts`, which this design rewrites.                                                                                                                                   | —           |

## Open questions

1. **Delete vs Remove (decision 9).** The recommended default is two actions:
   - **Remove from list**: unregisters the workspace. Nothing on disk changes, and adding the
     folder again restores it exactly, with the same id, tags, titles and cloud link.
   - **Delete workspace**: moves the folder's `.kaipu/` to the OS Trash (never `rm`). The
     confirmation states that titles, tags, edit projects, cursor tracks (auto-zoom) and the
     cloud link are lost and that the media stays.

   Trade-off: two verbs are one more thing to understand. One verb would have to be either
   always destructive, which is surprising for "I just don't want it in my list", or never
   destructive, which leaves `.kaipu/` behind forever. **Owner: confirm or pick one on the PR.**

2. **Cloud entries of a deleted workspace.** The proposed default: they stay on the server
   untouched and are hidden from every Library, because their `workspaceId` is known nowhere.
   Settings → Workspaces shows "N cloud items are not in any workspace on this Mac" with
   **Assign to workspace…**, which is one explicit choice. Assigning them automatically to
   another workspace is the leak this design prevents. A plain "Remove from list" keeps them
   attached to the id, and they come back when the folder is added again.
3. **Moving several items at once.** The move is defined per item (ADR 0033). The first launch
   leaves everything mixed in one workspace, so a multi-select **Move to…** in v1 (running
   single moves one after another) would matter. Does the Library's selection model allow it
   in v1, or is it a follow-up?
4. **Exports follow their source?** Moving an original leaves its exports where they are. Today
   nothing then warns about it: an export's editing state is `exported-only` whether or not its
   source exists (`main/library/edit-project-probe.ts:35-37` never resolves
   `derivedFromAssetId`), so there is no "source is missing" badge to rely on. Two follow-ups
   are possible: the move dialog offers "Also move N exports", or a workspace-local lineage
   check flags exports whose source is not in the workspace. The proposed default is neither
   in v1: one item, one move, and the dialog only states how many exports stay behind.
5. **Default name of a new workspace.** The proposal is the folder's name ("Kaipu Record" for
   the migrated one), renamable at once in the add dialog. Should the migrated one be called
   "Personal" instead? That presumes what it holds.

## Out of scope

- Renaming code identifiers from vault to workspace (only user-facing copy and docs change).
- Search, tags or any view across workspaces.
- Tags shared between workspaces.
- A destination per capture, or automatic routing by app/window.
- Syncing the workspace list between machines; workspaces on the web dashboard.
- A different cloud account, or different settings, per workspace.
- A lineage check that flags an export whose source moved to another workspace (Open question
  4). Moving an original leaves its exports as they are, with no warning.
- Two app flavors (dev and prod, PR #428) registering the same folder at once. The existing
  concurrent-sweep risk is unchanged and tracked with the userData isolation follow-ups.

## Failures this must protect against

- A work capture appearing in the personal workspace through a switch during a recording, an
  export, a GIF save or a screenshot save.
- An editor left open across a switch saving its session, title or tags into the other
  workspace's folder, or copying pixels of the old workspace's screenshot to the clipboard
  after the switch.
- A list or tag request that was in flight during a switch resolving afterwards and painting
  or writing the old workspace's data in the new one.
- A quiet capture taken in workspace A whose toast Save or Annotate is clicked after a switch
  to B, and lands in B.
- A tag registry read from Work, a switch, and the write persisting Work's tags into
  Personal's `tags.json`.
- A `kaipu-media://thumb/<id>` URL cached before a switch showing another workspace's item with
  the same id.
- The active workspace's drive is unplugged and the next capture silently lands somewhere else.
- `LibraryVault.list()` recreating a deleted or unmounted workspace folder (`mkdir` recursive,
  `library-vault.ts:106`), so that it reads as "empty", not "unavailable".
- A move across drives that deletes the source after a truncated copy.
- A move where the media lands before its sidecar, so `describe()` mints a new `assetId` and
  the cloud link is lost.
- The app dying mid-move and the item ending in neither workspace, or permanently in both.
- The app dying **between** the media rename and the journal update, and recovery deleting the
  target because the journal still says `copying`, which destroys the only copy.
- A moved item's bytes staying in the source folder under its title, as a drag copy or a hard
  link in `.kaipu/drag/`.
- A late or paused editor save recreating `.edit.json` or slide assets in the source, or
  leaving a half-written project in the target, because the save ran during the move.
- A name collision in the target overwriting an existing item.
- A copied workspace folder adopted on the same machine sharing an id with the original.
- A cloud catalog refresh dropping a client-side `workspaceId`, or a second Mac with an empty
  cache showing every cloud entry in its first workspace.
- Listing workspace A rewriting the account's catalog cache with only A's entries, so that
  switching to B offline shows none of B's cloud-only items and miscounts the orphans.
- Tag sync (ADR 0021, future) merging both workspaces' tags into one account vocabulary.
- "Delete workspace" removing media, removing anything with `rm`, or failing silently on a
  drive with no Trash.

## Acceptance criteria

- [ ] With two workspaces registered, the Library, the Editor home, tag lists and counts show
      only the active workspace's items and tags; no IPC returns another workspace's items.
- [ ] A recording, export, GIF and screenshot made while workspace A is active land in A's
      folder, including the cursor track; the selector is disabled for the whole write.
- [ ] Switching from the editor, after the session is saved, leaves the session in the item's
      own workspace; a save that names an item with no media is refused.
- [ ] Switching with a screenshot editor open, and again with a video editor open, flushes and
      awaits its pending save, asks Save or Discard when it is dirty (Cancel aborts the
      switch), closes the editor and the item detail page, and leaves nothing mounted that can
      copy to the clipboard or save to the old workspace.
- [ ] A list, tag or item request issued before a switch and resolving after it is discarded
      by the renderer, and a call that reaches main with the old workspace id or generation is
      rejected with `stale-workspace` and writes nothing.
- [ ] Capture in workspace A (quiet capture, so the toast keeps the bytes), switch to B, then
      click the toast's Save or Annotate: nothing is written to B and nothing appears in B's
      Library; the pending toast is dismissed by the switch.
- [ ] A tag registry read started in A, a switch to B, then the write: the write is rejected or
      lands in A's registry, and B's `tags.json` is unchanged. Tag IPC carries `workspaceId`.
- [ ] Adding a folder without `.kaipu/` writes `.kaipu/workspace.json` with a UUID and a name;
      adding a pre-workspaces vault keeps its sidecars, tags and edit projects and only adds
      `workspace.json`.
- [ ] Adding a folder whose `workspace.json` id is already registered to an **unavailable**
      path updates that entry's path (relocate); to an **available** path, gives the copy a new id.
- [ ] First launch after the upgrade registers the current vault (custom or default path) as
      the only workspace, active, with nothing moved or rewritten except `workspace.json` and
      `preferences.json`.
- [ ] An unmounted workspace is listed as unavailable, cannot be switched to or chosen as a
      move target, and its folder is not recreated.
- [ ] With the active workspace unmounted, starting a recording or screenshot shows an error
      naming the workspace and saves nothing anywhere else.
- [ ] Listing workspace A, then switching to B offline without a refresh, still shows B's
      cloud-only items; the cached catalog file still holds every workspace's entries after
      the list; the orphan count is unchanged by listing.
- [ ] A cloud asset uploaded from workspace A carries `workspaceId = A` on the server; workspace
      B's Library does not show it; after a catalog refresh it is still hidden in B.
- [ ] Moving an item on the same volume renames its media and moves every `.kaipu/<id>*` file;
      the target lists it with the same `assetId`, title and tags; the source no longer lists it.
- [ ] Moving across volumes copies the media, verifies sha256 and only then deletes the source;
      a forced mismatch aborts with the source intact.
- [ ] Killing the app at each step of a move and relaunching yields exactly one listed copy
      after healing, with the cloud `workspaceId` matching where it lives. The kill points
      include: after the journal write, after each small file, after the target sidecar, after
      the media copy and after its verification, **between the media rename and the journal
      update**, after `committed`, after each source delete, and after the cloud update. At no
      point is there zero copies, and a journal still saying `copying` never deletes a target
      that holds the verified media (recovery rolls forward).
- [ ] Healing never deletes one side unless the other is verified (size, mtime, `assetId`,
      sha256 where known): a truncated target next to an intact source is cleaned, and an
      absent source next to an unverifiable target deletes nothing and surfaces the entry.
- [ ] Dragging an item out with its title and then moving it leaves no file of the item
      anywhere in the source folder, in both the hard-link case and the copy-fallback case. A
      move requested within 10 seconds of a drag of that item is refused with a message.
- [ ] A video-editor session save paused mid-write (after the JSON, before the prune pass),
      interleaved with a move of the same item, ends with the source holding no `.edit.json`
      or assets and the target holding a complete project; a save queued behind the move is
      refused with `item-moved`. `flush()` awaits a write already in flight.
- [ ] Moving an original leaves its exports listed as they were, in their workspace, without
      an error; the move dialog states how many exports stay behind. (No "source missing"
      badge is promised: Open question 4.)
- [ ] A target with an item already named `<id>` receives the moved item as `<id>-2`; nothing
      is overwritten.
- [ ] Tags on a moved item map to target tags with the same slug; missing ones are created with
      the same name and color.
- [ ] A moved item's fresh edit project stays fresh (no "missing dependencies" badge).
- [ ] "Remove from list" changes no file on disk; re-adding restores the workspace with the same
      id and cloud entries.
- [ ] "Delete workspace" moves `.kaipu/` to the Trash, leaves every media file in place, and
      refuses with a message on a volume where `shell.trashItem` fails.

---

## Current state (verified on `main` at `be178352`, 2026-10-29)

All paths are relative to `apps/kaipu-record/src/`.

**One folder.** `main/library/vault-location.ts:9-11` stores one optional `vaultDirectory`
string in `userData/preferences.json` (`:14-16`). `vaultDirectory()` returns it, or the default
`Videos/Kaipu Record` (`:54-69`). The parsed preferences are cached in memory (`:25`); this is
NIW2-394, merged in #410. Settings → Files (`renderer/src/pages/settings/settings-pages.tsx:210`)
changes the folder through `chooseVaultDirectory`, `resetVaultDirectory`, `getVaultDirectory`
and `openVaultDirectory` (`shared/types/ipc.ts:455-459`, handlers at `main/library/index.ts:175-239`).

**The folder is resolved on every call.** `currentVault()` (`main/library/index.ts:43-45`)
builds a `LibraryVault` for `vaultDirectory().path` each time. Every item handler (list,
rename, tags, backfill, delete, reveal, drag: `:88-173`) addresses an item by its local id
only. The same holds for:

- the media protocol (`main/media-protocol.ts:101-104`, through `recordingFilePath`,
  `screenshotFilePath`, `thumbnailFilePath`);
- screenshot save and overwrite (`main/screenshots/screenshot-save.ts:28`);
- GIF save (`main/library/index.ts:144-152`);
- the video edit session, which calls `vaultDirectory()` in each helper
  (`main/library/video-edit-session.ts:21-31`, `:93`, `:143`, `:162`, `:215`).

None of these bind a folder for the duration of a task.

**Things that outlive the call.** These matter for the switch and the move:

- Drag with a title makes a hard link, or a copy where links fail, of the media in
  `<vault>/.kaipu/drag/<uuid>/<title>.<ext>` (`main/library/drag-copies.ts:70-92`, called at
  `main/library/index.ts:159-171`). It is removed by `pruneDragCopies` after an hour
  (`:32-60`), and at startup and quit (`main/index.ts:713`, `:1144`).
- A quiet capture keeps `{ png, width, height, mode }` in module state
  (`main/screenshots/last-quiet-capture.ts:4-9`) with no workspace. The toast's Save later calls
  `saveToVault` (`main/screenshots/capture-toast-window.ts:241-248`), which reaches
  `currentVault()` at that moment (`main/screenshots/screenshot-save.ts:26-29`).
- The screenshot editor stays mounted across anything the main process does, and its Copy
  sends pixels with `copyImageToClipboard` (`renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:238-254`,
  handled at `main/screenshots/screenshot-ipc.ts:184-185`).
- `VaultTagRepository` calls its `vault()` factory once to read the registry
  (`main/library/tag-repository.ts:78-82`) and again to write it (`:110-114`), with awaits in
  between. The tag handlers carry no workspace (`main/library/index.ts:111-122`).
- `saveSession` (`main/library/video-edit-session.ts:103-134`) writes the JSON, the assets and
  the prune pass with no lock. The renderer's `flush()` (`renderer/src/features/video-editor/use-session-autosave.ts:60-92`)
  starts a write but does not join one already running.
- `LibraryService.list()` writes `catalogUpdates` back as the whole account cache
  (`main/library/library-service.ts:57-62`, `main/cloud/catalog-cache.ts:61-67`), and
  `composeLibrary` returns updates only for the entries it was given (`compose-library.ts:45-59`).
- `probeEditing` returns `exported-only` for a local item with `derivedFromAssetId` and no edit
  project without resolving the source (`main/library/edit-project-probe.ts:35-37`).

**Recording binds the folder three times.** `RecordingWriter` resolves the vault when staging
(`main/recording/recording-writer.ts:104-112`, `create()`), again at `finalize()` (`:184-190`),
and the hub resolves it a third time to write the cursor track
(`main/recording/recording-hub.ts:424-427`). Editor exports go through the same writer
(ADR 0003: `recordingCreate` → `recordingFinalize`). A switch in between would stage in A and
finish in B, which may also be a copy across volumes.

**Item files.** All of them are in the vault root or in `.kaipu/`:

- media `<id>.mp4|.webm|.png|.gif` in the root (`main/library/library-vault.ts:10-16`, `:80-86`);
- sidecar `.kaipu/<id>.json` (`:92-94`), where `assetId` is minted on first read when missing
  (`:185-214`);
- thumbnail `.kaipu/<id>.jpg` (`:96-98`; a screenshot uses its own PNG as thumbnail, `:158-165`);
- cursor track `.kaipu/<id>.cursor.json` (`:100-103`);
- video edit project `.kaipu/<id>.edit.json`, `.kaipu/<id>.edit.meta.json` (source size/mtime
  stamp) and `.kaipu/<id>.assets/*.png` (`main/library/video-edit-session.ts:25-44`).

The edit project JSON does not embed the item id (`renderer/src/features/video-editor/session.ts`),
so a renamed id needs no rewrite. Screenshots have no edit project: they are saved flat (the
[scene doc](/backlog/screenshot-scene-doc/) is only proposed). The tag registry is
`.kaipu/tags.json` (`main/library/tag-repository.ts:67-69`). Drag copies live in `.kaipu/drag/`
(`main/library/drag-copies.ts:14-16`), and recording staging in `.kaipu/tmp/` (`STAGING_DIR`).

**Cloud catalog.** `main/cloud/catalog-cache.ts:11-31` keeps `userData/cloud/<userId>/catalog.json`
per account. It is a **cache of server data**: `LibraryService.doRefresh`
(`main/library/library-service.ts:78-93`) rebuilds every entry from `GET /api/v1/assets`
(`main/cloud/catalog-client.ts:36-92`) and carries forward only `lastSeenLocalId`.
`composeLibrary` joins local and cloud by `assetId` alone (`main/library/compose-library.ts:32-58`).
The server row is `cloud_asset` (`packages/infra-db/src/schema/cloud.ts:21-45`), keyed by
`(user_id, asset_id)`. The desktop does **not upload yet**: no client calls
`/assets/upload-intents` (only `apps/server-hono/src/contract/cloud.contract.ts:29` defines it).

**Moves to reuse.** `atomicWriteFile` and `withLock` (`main/library/atomic-write.ts:11-50`);
`sha256FileBase64` (`main/library/content-hash.ts`); the EXDEV handling in `createDragCopy`
(`main/library/drag-copies.ts:70-94`, NIW2-398, merged in #412). `moveFile`
(`main/recording/recording-writer.ts:66-91`) renames, or else copies and unlinks **without
verifying**, so it is not safe for a user's only copy (ADR 0033).

**Startup and quit.** Stranded-take recovery (`main/index.ts:1006`) and drag-copy cleanup
(`main/index.ts:713`, `:1144`) run for the active vault only.

**In flight.** [Plan 08 · vault id collisions](/plans/audit-2026-10-15/08-vault-id-collisions/)
is not implemented (`main/library/vault-id.ts` does not exist). It replaces `timestampId` /
`screenshotId` with `mintVaultId`, which checks `hasMedia` in the target vault. The move's
collision suffix (`<id>-2`) is independent of the id format and works with either. The mover
must check collisions in the **target** workspace, the same check `mintVaultId` makes.

## Things the code contradicted

1. **NIW2-394 and NIW2-398 are merged** (#410 `f90be82e`, #412 `c9eaaed8`). Decision 10's wait
   is over. Implementation can start once this design is approved.
2. **The cloud catalog is not client data.** Decision 4 reads as client-only, but the local
   file is rebuilt from the server on every refresh. A client-only `workspaceId` would have to
   be carried forward like `lastSeenLocalId`, and it would be lost on a cache `clear()`, a
   reinstall or a second Mac. The migration rule ("no `workspaceId` → first workspace") would
   then show a second Mac's every cloud item in its first workspace, which is the leak. So
   `workspaceId` is a **server column**. The owner's "this makes cloud simpler" still holds:
   the catalog stays per account, and it is one field and one endpoint. Because desktop upload
   has not shipped, the field can be required from the first upload, and rows without it will
   not exist in practice.
3. **"Switching is locked while recording" is not enough.** Exports, GIF saves, screenshot
   saves and the editor's autosave all resolve the folder at write time (see
   [Current state](#current-state-verified-on-main-at-be178352-2026-10-29)). The design widens
   the lock to every writer and makes every item address carry `workspaceId`.
4. **ADR 0003 says the editor never "moves" the original.** Decision 6 puts Move in the editor.
   ADR 0033 amends the word: the intent is the export path, and a user-issued move is a user
   action. 0003's reopen conditions are not met and its decision stands. 0003's own status row
   was **not** edited here; the owner decides whether it gets an "Amended by 0033" line.
5. **ADR 0021 (tag sync, Proposed) merges tags by slug "in the account".** With per-workspace
   tags, sync must be scoped per `workspaceId`. 0021 needs an amendment before NIW2-368 is
   built. Its reopen conditions are about a second synced domain and stale tags, not this, so
   the change is an amendment, not a reopen.
6. **An "edit project" exists only for videos.** Screenshots are flat PNGs; their move set is
   the PNG and the sidecar.
7. **Resolving the workspace per call is not enough.** The first draft only made each call name
   its workspace. An editor, a retained quiet capture, a paused tag write and a paused session
   save all hold state **across** the switch, so the design adds a switch transaction, a
   generation, a capture-time binding and a per-item lock (see the sections below).
8. **The move and the cloud filter each had a hole.** A journal `copying` phase cannot tell a
   copy in progress from a rename that finished before the journal write. Drag copies in
   `.kaipu/drag/` keep a moved item's bytes in the source. Filtering the catalog before
   `composeLibrary` would have rewritten the account cache without the other workspaces'
   entries. Exports of a moved original never showed `needs-source`. ADR 0033 and the Cloud
   section below close each.

---

## Detail

### Data shapes

`.kaipu/workspace.json` (written atomically, in the folder):

```json
{
  "version": 1,
  "id": "0192f0c4-7a1e-7c3b-9f2a-4d5e6f708192",
  "name": "Work",
  "createdAt": 1761734400000
}
```

`id` is a UUID v7 (`uuidv7()` from `tag-repository.ts`, as tags). `name` is authoritative here,
so a folder carried to another Mac keeps its name. Renaming a workspace writes this file.

`userData/preferences.json`, the new `workspaces` key next to the existing keys:

```json
{
  "vaultDirectory": "/Volumes/Work/Kaipu",
  "workspaces": {
    "version": 1,
    "activeId": "0192f0c4-7a1e-7c3b-9f2a-4d5e6f708192",
    "legacyCloudOwnerId": "0192f0c3-0000-7000-8000-000000000001",
    "entries": [
      { "id": "0192f0c3-0000-7000-8000-000000000001", "path": "/Users/me/Movies/Kaipu Record", "name": "Kaipu Record", "addedAt": 1761734300000 },
      { "id": "0192f0c4-7a1e-7c3b-9f2a-4d5e6f708192", "path": "/Volumes/Work/Kaipu", "name": "Work", "addedAt": 1761734400000 }
    ]
  }
}
```

- `name` in an entry is a cache, so an unavailable workspace can still be named in the UI.
- `legacyCloudOwnerId` names the workspace that owns cloud entries without a `workspaceId`
  (decision 3). It is explicit, not "the first entry", so removing or reordering entries never
  moves those entries elsewhere silently.
- `vaultDirectory` keeps being written, mirrored to the active path, for one release, so a
  downgrade opens the active workspace.

`CloudCatalogEntry` (`shared/types/library-item.ts:50-68`) gains `workspaceId: string | null`.
The local `userData/workspace-moves/<moveId>.json` journal is specified in ADR 0033.

### Availability

A workspace is **available** when its path exists, `.kaipu/workspace.json` is readable and its
`id` matches the entry. Otherwise it is **unavailable**, with a reason: `missing` (the path is
gone: an unplugged drive or a deleted folder), `unreadable`, or `different` (another
workspace's file is there). The check runs when the list is read and before a switch or a move.
It never creates the root. `LibraryVault.list()`'s `mkdir` (`library-vault.ts:106`) must only
create `.kaipu/` inside an existing root.

### Migration (first launch after the upgrade)

1. No `workspaces` key: take `vaultDirectory().path` (custom or default).
2. If the path is reachable: create it if it is the default and missing (today's behaviour),
   then adopt it (reuse or mint `workspace.json`) and register it as the only entry, active,
   and `legacyCloudOwnerId`.
3. If the path is not reachable (a custom folder on an unplugged drive): register it with a
   minted id and `pendingInit: true`, active and unavailable. On the first reach, write
   `workspace.json`. If a `workspace.json` is already there, adopt that id, and update
   `activeId` and `legacyCloudOwnerId` to match.
4. Nothing else is rewritten: no sidecar, tag registry or media changes.

### Cloud: server and client

The server changes; it does not exist on any client yet:

- `cloud_asset.workspace_id text NULL`, an opaque client UUID with no foreign key; the server
  does not know workspace names.
- `POST /assets/upload-intents` takes `workspaceId`, required for new assets.
- `GET /assets` returns `workspaceId`.
- A new `PUT /assets/{assetId}/workspace` with body `{ workspaceId }`: idempotent, used by
  moves and by "Assign to workspace…".

On the client:

- `catalog-client.ts` maps the field, and `doRefresh` keeps it from the server.
- `LibraryService.list()` composes with a **filtered view** of the catalog: only the entries
  whose effective workspace is the active one. The effective workspace is
  `workspaceId ?? legacyCloudOwnerId`, overlaid with any pending move from the journal, so an
  offline move never shows the item in its old workspace's cloud listing.
- The association updates `composeLibrary` returns (`lastSeenLocalId`) are **merged into the
  full account catalog** before writing: every entry the filtered view did not contain is kept
  exactly as it was. The merge is a read-modify-write inside the cache's own write chain
  (`CloudCatalogCache.update(userId, mutate)`), so it cannot interleave with `doRefresh`.
  Writing the composed updates directly would replace the file with only the active
  workspace's entries.
- Entries whose effective workspace is not registered on this Mac are counted for Settings
  (Open question 2) from the **full** catalog and shown nowhere else.

### Tags

Unchanged per workspace, but bound to one workspace for a whole operation. Today
`VaultTagRepository` takes a `() => LibraryVault` (`tag-repository.ts:61-65`) and calls it for
the read and again for the write. The repository becomes per workspace: one instance (and one
serialization chain) per `workspaceId`, built from the registered path, so a read and the write
that follows it always address the same registry, and the mover can use the **target**
workspace's registry. Inside an operation the vault is captured once. The tag channels
(`listTags`, `createTag`, `renameTag`, `recolorTag`, `deleteTag`) take `workspaceId` and
generation like the item channels, and every tag operation runs inside the workspace gate, so a
switch waits for it. `setItemTags` and the other item calls carry `workspaceId` like everything
else. Tag sync (ADR 0021) must scope its rows,
cursor and slug merge per `workspaceId`; this is an amendment to make before NIW2-368.

### IPC changes

New channels (main ↔ renderer):

| Channel                      | Payload → result                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `workspaces:list`            | → `{ activeId, workspaces: { id, name, path, state: "available" \| "unavailable", reason? }[], orphanCloudCount }` |
| `workspaces:add`             | opens the folder picker; adopts or initializes → the entry, or null when cancelled                                 |
| `workspaces:switch`          | `id` → ok, or `{ reason: "busy" \| "unavailable" }`                                                                |
| `workspaces:rename`          | `id, name` → entry                                                                                                 |
| `workspaces:remove`          | `id` → ok (refused for the active one and for the last one)                                                        |
| `workspaces:delete`          | `id` → ok or `{ reason: "active" \| "no-trash" \| "busy" }` after main shows the confirmation                      |
| `workspaces:open-folder`     | `id` → reveals the folder                                                                                          |
| `workspaces:move-item`       | `{ workspaceId, id }, targetId` → `{ ok, newId }` or a reason                                                      |
| `workspaces:changed` (event) | broadcast after any registry change or switch; windows re-list                                                     |

Changed: every item-scoped channel (`listLocalRecordings`, `loadCursorTrack`,
`renameLocalRecording`, `markOpenedInEditor`, `setItemTags`, `backfillLocalRecordingMeta`,
`deleteLocalRecording`, `revealLocalRecording`, `startFileDrag`, `videoEditSaveSession`,
`videoEditLoadSession`, screenshot load, copy-by-id and overwrite, and the tag registry
channels) takes `workspaceId` first, plus the workspace generation. Main rejects an unknown or
unavailable id, and **any id or generation that is not the active one** with `stale-workspace`.
The renderer also discards responses whose generation is no longer current. Main holds a
counter, `workspaces:changed` carries it, and it is bumped in the last step of a switch. `kaipu-media://thumb/<id>` becomes
`kaipu-media://thumb/<workspaceId>/<id>`, and the same for `recording/` and `screenshot/`.

Retired: `getVaultDirectory`, `chooseVaultDirectory`, `resetVaultDirectory` and
`openVaultDirectory` are replaced by the `workspaces:*` channels. "Reset to default folder"
becomes "Add workspace" pointed at the default folder.

### The switch lock and the switch transaction

**The lock.** Main refuses `workspaces:switch` while any of these is true: the `RecordingWriter`
has an open session (this covers recordings and editor exports), a GIF or screenshot save is
running (this includes a toast's Save), or a move is running. In addition,
`RecordingWriter.create()` stores the resolved folder in its `Session`, and `finalize()` and the
cursor-track write use that folder instead of calling `vaultDirectory()` again. Even a bug in
the lock cannot then split a take. Startup sweeps (stranded takes, drag copies) iterate over
every available workspace.

**The transaction** (ADR 0032, decisions 6, 7 and 9). A lock only stops writers that already
exist; it does not stop an editor that is merely open. When the lock allows the switch:

1. Main enters `switching` and drains the **workspace gate**. Every item-scoped and tag call
   runs inside `gate.run({ workspaceId, generation }, fn)`, which binds the resolved folder
   once; new calls are rejected until the switch ends, and running calls finish.
2. Main asks every renderer window to prepare, and waits for all acks (with a timeout that
   aborts the switch). Each editor flushes and awaits its pending saves. A dirty editor asks
   Save, Discard or Cancel. The screenshot editor, the video editor and the item detail page
   close. The media/thumbnail URL caches and the list queries are cleared.
3. Pending quiet-capture toasts are dismissed and `last-quiet-capture` is cleared.
4. Main bumps the generation, writes `activeId`, and broadcasts `workspaces:changed`.

A failure before step 4 leaves the old workspace active and unchanged.

**Captures bind at start.** The capture request reads the active workspace once and carries
`workspaceId` in `QuietCapture`, the toast payload, the toast's Save and Annotate, and the
editor source. `saveScreenshotToVault` takes the workspace from its metadata instead of
`currentVault()`. A toast action whose `workspaceId` is not the active one writes nothing.
Switching drops the retained bytes. For a copy-only capture the pixels are already on the
clipboard, so nothing the user can still paste is lost.

**One lock per item** (ADR 0033, decision 12) makes session saves, screenshot overwrites,
deletes and moves mutually exclusive per item. The sidecar lock stays inside it.

### UI

- **Selector**: at the top of the sidebar (`renderer/src/shell/sidebar.tsx:36`), the active
  workspace's name, then a menu: the workspaces (an unavailable one is disabled and labelled
  "Not connected"), **Add workspace…** and **Manage workspaces…**. While locked, it is disabled
  with "Finish the recording to switch".
- **Where captures go**: the capture toast and the Record page name the active workspace
  ("Saved to Work"). This is the cheapest guard against capturing into the wrong workspace.
- **Settings → Files becomes Settings → Workspaces** (`settings-pages.tsx:210`): one row per
  workspace with its name, path and state, and the actions Rename, Show in Finder, Remove from
  list and Delete workspace…; plus **Add workspace** and, when non-zero, the orphan cloud count
  with **Assign to workspace…**.
- **Library**: the item menu gets **Move to workspace ▸** (the other available workspaces). A
  progress row shows during a move across volumes.
- **Editor**: the item's info area shows **Workspace: Work** with **Move to…**. The editor
  flushes its autosave, the move runs, the editor returns to the Library, and a toast reads
  "Moved to Personal · Switch".
- **Move dialog** (only across volumes or when exports stay behind): the size to copy, and
  "N exports of this recording stay in Work" (counted from the already loaded local list by
  `derivedFromAssetId`; no new lookup). If the item was dragged in the last 10 seconds, the
  move is refused with "Finish dropping the file, then try again". During a move the editor is
  read-only.
- **Delete confirmation** names what is lost: titles, tags, edit projects, cursor tracks
  (auto-zoom) and the cloud link. It also says what stays: every recording and screenshot file.

### Delete and remove, in detail

- **Remove from list**: refused for the active and the last workspace. It drops the entry and
  touches no file. The workspace's cloud entries become orphan (hidden) until the folder is
  added again, which restores them under the same id.
- **Delete workspace**: refused for the active workspace and while busy. It first runs the
  stranded-take recovery for that folder, so a half-saved take becomes a media file and stays.
  Then it calls `shell.trashItem(<root>/.kaipu)`. If that rejects (a network volume with no
  Trash), nothing is removed and the message says so. On success, it removes the entry. Its
  cloud entries are orphaned for good (Open question 2). Adding the folder again later creates
  a new workspace whose items get new `assetId`s.

## State of the art

- **Obsidian vaults**: each vault is a folder with its own `.obsidian/` config, and the app
  keeps the list of known vaults outside them. The vault switcher opens one vault per window,
  and there is no cross-vault view. Moving notes between vaults is a manual file move that
  loses links, a common complaint
  ([forum](https://forum.obsidian.md/t/how-can-i-move-folders-between-vaults/41151)).
  Moving a vault across drives fails with `EXDEV` when the app only tries `rename`
  ([forum](https://forum.obsidian.md/t/fail-to-move-vault-across-devices-drives-fix-exdev-error/115346)),
  which is why ADR 0033 copies, verifies and then deletes.
- **Eagle libraries**: several libraries, one open at a time, switched from a menu. Each
  library is a self-contained folder, and the recommended practice is separate libraries for
  unrelated work rather than one huge one
  ([Eagle](https://eagle.cool/blog/post/best-practice-for-eagle-library)). This is the closest
  match to this design.
- **Lightroom catalogs**: one catalog with folders and collections is recommended for most
  users, and several catalogs are used for real separation (clients, privacy). The cost is no
  search across them
  ([Lightroom Queen](https://www.lightroomqueen.com/one-or-multiple-catalogs/)). Kaipu's goal
  is the separation case, so it takes the multiple-catalog side. ADR 0032 rejects the
  one-catalog-with-filter model.
- Hub: [library vault](https://github.com/csdev19/general-knowledge/blob/main/desktop/library-vault.md)
  describes the single-vault layout. It needs a short note about workspaces once they are
  implemented, not before.
