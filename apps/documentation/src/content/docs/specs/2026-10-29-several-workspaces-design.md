---
title: Several workspaces — separate libraries for work and personal captures
description: Design for letting the desktop app keep several workspaces (folders with Kaipu files), one active at a time and switched from tiles in the navigation rail, with captures landing in the active one, per-workspace setting overrides, synced folders, cloud entries tagged by workspace, per-workspace tags, a crash-safe move of an item between workspaces, and an additive, downgrade-safe migration.
---

# Several workspaces — design

**Status: 🔵 Proposed · 2026-10-30.** Decisions approved by the owner
([NIW2-370](https://linear.app/niway/issue/NIW2-370)), in three rounds: round 1, 2026-10-29
(decisions 1–10), round 2, 2026-10-29 (decisions 11–18, owner decisions A–I), and round 3,
2026-10-30 (decisions 19–25, which also settle every open question). Nothing implemented. The app
is at 0.x, so this document says "the first release of workspaces" and "a later release", never
"v1". Creates
[ADR 0032](/architecture/decisions/0032-workspaces-identity-in-the-folder-one-active/),
[ADR 0033](/architecture/decisions/0033-moving-an-item-between-workspaces/) and
[ADR 0034](/architecture/decisions/0034-per-workspace-setting-overrides/); reuses
[ADR 0020](/architecture/decisions/0020-tags-are-entities-with-stable-ids/). Rounds 2 and 3
amended 0032, 0033 and 0034 in place (all Proposed). Backlog: [Several workspaces](/backlog/several-workspaces/).

## Summary (one minute)

Kaipu gets **workspaces**: separate libraries, for example "Work" and "Personal", so that a
leak of one never includes the other. A workspace is a **folder the user already has**. Kaipu
writes `.kaipu/workspace.json` into it (an id, a name, a color and optional initials), and
adopts a folder that already has Kaipu files. The folder may sit inside Google Drive, OneDrive
or iCloud Drive: the provider then syncs that workspace with no integration code. The list of
workspaces and the active one live in the app's preferences.

**One workspace is active at a time.** It is switched with one click on its tile in the
navigation rail, and named in the status bar, the window title and the tray. The Library, the
editors, tags and **every new capture** use the active workspace, and every surface where a
capture lands says where ("Saving to Work"). There is no combined Library view and no
destination picker. Switching is locked while anything is being written, and a switch is a transaction:
editors flush and close, pending toasts are dropped, and main refuses any call stamped with the
old workspace. A workspace on a disconnected drive shows as unavailable, and Kaipu never falls
back to another one.

**Settings inherit.** "All workspaces" is today's settings file, unchanged. A workspace can
override five keys (badge, upload mode, recording quality, export quality, screenshot copy),
and shortcuts are always global. **Tags stay per workspace.** The **cloud catalog stays per
account**, and each cloud asset records its `workspaceId` on the server.

A finished recording or screenshot can be **moved** with "Move to" from the Library, the item
page or an editor, and several at once with a new select mode in the Library. The move keeps the
item's `assetId`, verifies every copy, and heals itself after a crash without ever leaving zero
copies. When the recording has exports in the same workspace, the dialog offers to move them too.
A group move is N single moves, not a transaction. With a synced side it always copies, verifies
and deletes. Removing a workspace never touches the user's media.

**Kaipu has paying customers, so the migration is small and additive.** It writes
`workspace.json` and a registry key and touches nothing else. It is idempotent and
crash-safe, and it keeps an older app version working after a downgrade. The existing library
becomes a workspace named **"Default workspace"**.

**The feature is visible from the first launch, even with one workspace**, otherwise nobody
would learn that workspaces exist. The rail always shows the active tile and a "+" tile, the
status bar always shows the chip, a one-time dismissible hint ("New: workspaces — keep work and
personal captures apart") points at the rail, and the "Move to" menus offer "New workspace…"
when no other workspace exists. Per-workspace settings ship in the same release.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                | ADR                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 1   | One **active** workspace, switched from the rail (decision 11). No combined Library view (decision 24). New captures always save to the active workspace.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Separation is the goal. A combined view turns it into a filter that one bug or a shared screen defeats. A per-capture picker makes a wrong click the leak.                                                         | 0032 (new)                     |
| 2   | A workspace is an existing folder. Kaipu writes `.kaipu/workspace.json` (UUID, name, color, initials). A folder with `.kaipu/` is adopted: reuse `workspace.json`, mint it if absent. The list + `activeId` live in userData preferences. The migrated vault is named **"Default workspace"** (decision 22); a new one defaults to its folder's name.                                                                                                                                                                                                                                                                                                                                                       | Identity must travel with the folder (copy, rename, another Mac). The app must know which folders exist without scanning disks.                                                                                    | 0032                           |
| 3   | First launch: the current vault becomes the first workspace, named "Default workspace" (decision 22). Cloud entries without a `workspaceId` belong to it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Nobody loses anything and nothing has to be chosen on upgrade.                                                                                                                                                     | 0032                           |
| 4   | Cloud catalog stays per account. Every cloud asset stores `workspaceId` **on the server** (nullable column). A Library hides cloud entries of other workspaces.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | The local catalog is a cache rebuilt from the server on every refresh, so a client-only field would be lost (see [Things the code contradicted](#things-the-code-contradicted)).                                   | 0032                           |
| 5   | Tags stay per workspace. ADR 0020's reopen condition ("several vaults must share one tag vocabulary") is **not met**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Shared tags would leak a work vocabulary ("Client X") into the personal workspace — the opposite of the goal.                                                                                                      | reuses 0020                    |
| 6   | Move a finished item: media, sidecar, thumbnail, cursor track, edit project. Same volume = rename; other volume, or any synced side = copy, verify sha256, delete. `assetId` kept; tags remapped by name; collision → suffix. Source drag copies removed; one per-item lock shared with saves; crash recovery verifies both media files and rolls forward. Moving a recording that has exports in the same workspace suggests moving them too (decision 21); several items move through a multi-select (decision 20).                                                                                                                                                                                       | The first launch puts everything in one workspace; moving is how the user separates it. Keeping `assetId` keeps the cloud link and lineage.                                                                        | 0033 (new, amended)            |
| 7   | Switching is locked while recording (and while exporting, saving or moving). A recording finishes in the workspace it started in. The switch itself is a transaction: flush and close editors, drop pending toasts and caches, bump a generation; main rejects stale calls. Captures bind their workspace, and their settings, at start.                                                                                                                                                                                                                                                                                                                                                                    | The writer resolves the folder three times today (start, finalize, cursor track). An open editor, a retained quiet capture or a paused tag write would otherwise still reach the other workspace after the switch. | 0032                           |
| 8   | An unreachable workspace is unavailable: cannot be switched to or moved into. An unreachable **active** workspace refuses captures; it never falls back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Falling back to "whatever is reachable" sends work captures into the personal folder.                                                                                                                              | 0032                           |
| 9   | Two actions, **confirmed**: **Remove from list** (unregister, nothing on disk changes) and **Delete workspace** (`.kaipu/` to the OS Trash via `shell.trashItem`). Media is never touched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Owner: deleting a workspace removes Kaipu's files only. Two verbs keep the reversible action reversible.                                                                                                           | —                              |
| 10  | Implementation waits for NIW2-394 and NIW2-398. **Both are already merged** (#410, #412), so the dependency is met.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | They touch `vault-location.ts` and `drag-copies.ts`, which this design rewrites.                                                                                                                                   | —                              |
| 11  | **Switcher = workspace tiles in the 72 px rail**, under the logo: a 36 px tile with initials on the workspace color and a 9 px mono name. One click switches. Right-click: Rename, Show in Finder, Manage. A "+" tile adds. More than 4 → the last tile is "+N" and opens a list. Also: a "● Work" chip in the status bar, the window title "Work — Kaipu Record", and a "Workspace: Work ▸" submenu in the tray. ⌘1…⌘n switch only while the window is focused, never globally. Only Settings → Workspaces besides that. **With one workspace the rail still shows the active tile and the "+" tile, and the chip still shows (decision 19).**                                                             | A switch must cost one click and be visible everywhere a capture can start, including the tray when the main window is hidden. A tile that only opens a dropdown doubles the cost of the common action.            | 0032 (amended)                 |
| 12  | Workspace **color** (a tag-palette key) and optional **initials** live in `.kaipu/workspace.json`. Confirmed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | The tile and the chip need them on every Mac that opens the folder.                                                                                                                                                | 0032 (amended)                 |
| 13  | **"Move to" surfaces and "Saving to" labels** (the verb is "Move to", never "Send to": the item leaves the source). Library header: name + count. Card and row: a new "⋯" menu with "Move to ▸". Item page: "Workspace: Work" + "Move to…". Editors: a "Work ▾" chip. Export sheet: "Saves to Work". **Record page: "Recording to Work · Switch" replaces the "Ready to record" heading.** Control bar: "● Work". Capture panel and overlay: "Saving to Work". **Capture toast: "Saved to Work", a label only, with no move control (confirmed).** Disabled states are defined (target not connected, write in progress, cloud-only, dragged under 10 s, synced file not downloaded).                       | The cheapest guard against a capture in the wrong workspace is naming the workspace where the capture lands. "Send" suggests a copy.                                                                               | —                              |
| 14  | **Per-workspace setting overrides**, inherited from an "All workspaces" level (VS Code's user vs workspace model). Five overridable keys: `showBrandBadge`, `uploadMode`, `recordingQuality`, `exportQuality`, `screenshotCopy`. Everything else, and **every shortcut**, is app-wide. All level = `userData/settings.json`, unchanged. Overrides = `<workspace>/.kaipu/settings.json`, validated, unknown keys ignored. `uploadMode` override stays in userData, keyed by workspace. Read at capture start. This **reverses** round 1's "Out of scope: different settings per workspace" and ADR 0032's settings non-goal. **Ships in the first release of workspaces**, with these five keys (confirmed). | The owner wants different capture defaults for work and personal. Inheritance avoids the drift of a one-time copy. Upload consent must not arrive inside someone else's folder.                                    | 0034 (new)                     |
| 15  | **Synced folders are allowed in the first release of workspaces** (Google Drive, OneDrive, iCloud Drive through macOS File Provider). Detected by path, labelled "Synced by <provider>". Scratch files (staging, drag copies) move to userData for synced workspaces only. A move with a synced side always copies, verifies and deletes. Evicted files show "In the cloud — download to open" and never hang a probe or mark the workspace unreadable. Conflict copies are detected and warned about; no cross-machine locking.                                                                                                                                                                            | Per-workspace provider sync with zero integration code. Staying in the folder would upload partial takes and duplicate dragged items.                                                                              | 0033 (amended), 0032 (amended) |
| 16  | **Not in the first release of workspaces**: a Kaipu Cloud account per workspace, and any direct Google Drive or OneDrive API integration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | See Out of scope.                                                                                                                                                                                                  | —                              |
| 17  | **Migration is additive, idempotent, crash-safe and downgrade-safe.** It adds the registry to `preferences.json` and writes `.kaipu/workspace.json`, and nothing else. `vaultDirectory` keeps mirroring the active path on every switch. Server column nullable. No flag. The feature is visible from the first launch (decision 19).                                                                                                                                                                                                                                                                                                                                                                       | Kaipu has paying customers. An upgrade must not change anything they see or risk anything they have, and a downgrade must still open a library.                                                                    | 0032 (amended)                 |
| 18  | The Library keeps **every existing filter** per workspace: search, sort (Newest, Oldest, Largest), grid/list, kind chips with counts, storage chips with counts, tag chips with counts, the tag drawer and the "filtered by" summary line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | A workspace is a smaller Library, not a different one.                                                                                                                                                             | —                              |
| 19  | **The feature is visible with one workspace.** The rail always shows the active workspace tile plus a "+" tile, and the status-bar chip always shows. A **one-time, dismissible hint** ("New: workspaces — keep work and personal captures apart"), anchored to the rail tile, shows after the upgrade and is remembered in userData. The item "⋯" menu, the item page and the editors show "Move to ▸ New workspace…" when no other workspace exists: it opens Add workspace, then moves the item.                                                                                                                                                                                                         | Owner: "otherwise nobody will ever know workspaces exist". An invisible feature is never adopted.                                                                                                                  | 0032 (amended)                 |
| 20  | **Multi-select "Move to…" is in the first release.** The Library gets a select mode (it has no selection model today): checkboxes, shift-click range, and a bottom bar "N selected · Move to ▸". Moves run one after another with an aggregate progress and a per-item failure list; a failure does not stop the rest.                                                                                                                                                                                                                                                                                                                                                                                      | The first launch leaves everything in one workspace, so separating it item by item would be the first thing every user does.                                                                                       | 0033 (amended)                 |
| 21  | **Moving a recording suggests moving its exports.** When the recording has exports in the source workspace, the dialog says "This recording has 2 exports in Work. Move them too?" with **Move all 3** (primary) and **Move only the recording**. There is no reverse hint when moving an export. A group move is N single moves under the same rules, each crash-safe on its own, not a transaction.                                                                                                                                                                                                                                                                                                       | Leaving exports behind makes the item page say its source is missing. Offering the whole family in one click avoids that without a lineage check.                                                                  | 0033 (amended)                 |
| 22  | The migrated workspace is named **"Default workspace"**, not its folder's name. A workspace the user adds still defaults to its folder's name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The migrated folder's name ("Kaipu Record") says nothing; "Personal" would presume what it holds.                                                                                                                  | 0032 (amended)                 |
| 23  | Cloud entries of a deleted workspace stay on the server, are **hidden everywhere**, and Settings → Workspaces offers **Assign to workspace…**. They are never assigned automatically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | An automatic assignment is the leak this design prevents.                                                                                                                                                          | 0032                           |
| 24  | **No combined "All workspaces" Library view.** "All workspaces" exists only as the Settings scope for defaults.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | A combined view turns separation into a filter (decision 1).                                                                                                                                                       | 0032                           |
| 25  | **Sidecar read hardening is a prerequisite**, tracked separately as [NIW2-568](https://linear.app/niway/issue/NIW2-568). It is hardened, not guaranteed: a read can still fail, and a failed read must never be mistaken for a missing sidecar.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Without it, an evicted or unreadable sidecar is rewritten with a new `assetId` (Things the code contradicted, 11).                                                                                                 | —                              |

## Open questions

None. Round 3 (2026-10-30) closed the six that were open, and each answer is now a decision:

| Was                                   | Answer                                                                          | Decision |
| ------------------------------------- | ------------------------------------------------------------------------------- | -------- |
| 1. Delete vs Remove                   | Two actions, Remove from list and Delete workspace.                             | 9        |
| 2. Cloud entries of a deleted one     | Hidden everywhere, with "Assign to workspace…" in Settings → Workspaces.        | 23       |
| 3. Moving several items at once       | Multi-select "Move to…" is in the first release.                                | 20       |
| 4. Exports follow their source?       | The move dialog suggests moving them too; the user chooses.                     | 21       |
| 5. Default name of a new workspace    | The migrated one is "Default workspace"; new ones default to their folder name. | 22       |
| 6. "All workspaces" as a Library view | No. It exists only as the Settings scope.                                       | 24       |

The only unverified items left are the File Provider behaviours listed at the end of
[Synced folders](#synced-folders). A separate spike fills them in before implementation.

## Out of scope

Out of scope for the first release of workspaces; a later release may revisit them.

- Renaming code identifiers from vault to workspace (only user-facing copy and docs change).
- Search, tags or any view across workspaces, including an "All workspaces" Library
  (decision 24).
- Tags shared between workspaces.
- A destination per capture, or automatic routing by app/window.
- Syncing the workspace list between machines; workspaces on the web dashboard.
- **A Kaipu Cloud account per workspace.** One sign-in per app; the server already separates
  by `workspaceId`, and two accounts would need two sessions, two quotas and a switch of
  identity on every workspace switch.
- **A direct Google Drive or OneDrive API integration.** The provider's own File Provider
  client already syncs a folder; an API client would add OAuth, quotas and conflict handling to
  get what a folder path gives for free.
- Per-workspace shortcuts, devices (mic, camera) or any key outside ADR 0034's five.
- Locking a synced workspace against another Mac that has the same folder open.
- A move control in the capture toast (it shows "Saved to Work" only, decision 13).
- A separate workspace screen besides Settings → Workspaces.
- A lineage check that flags an export whose source moved to another workspace. The move dialog
  offers to move the exports with the recording (decision 21); when the user moves only the
  recording, its exports stay as they are, with no warning beyond the corrected item-page line.
- A reverse hint (moving an export does not offer to move its source), and moving several items
  as one transaction: a group move is N single moves, and an interrupted group does not resume.
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
- **Switcher (decision 11):** a click on a tile that only opens a menu, so switching takes two
  clicks; a ⌘digit registered as a global shortcut that switches workspace from another app;
  the tray capturing into a workspace the user cannot see because the main window is hidden.
- **Labels (decision 13):** the control bar shown in the recording (`showBarInRecording` on)
  burning the workspace name ("● Client X") into the video; the capture toast still saying
  "Saved to Library" after the upgrade; the old "Ready to record" heading left on the Record
  page next to the new "Recording to Work · Switch" line, or the page keeping two headings; a
  toast that offers to move, which the owner ruled out.
- **Visibility (decision 19):** a user with one workspace who never learns workspaces exist; the
  hint showing again after it was dismissed, or on every launch; the hint blocking a rail tile or a click; a one-workspace user who
  needs more than one click on the rail to reach Add workspace; "Move to ▸" on a menu with a
  single workspace and no way forward; "New workspace…" moving the item before the workspace is
  registered, or leaving a half-registered workspace when the folder picker is cancelled or the
  move fails.
- **Select mode and group move (decisions 20–21):** a selection that survives a filter change
  and moves items the user can no longer see; a shift-click range taken over a different order
  than the one on screen; a switch landing between two moves of a group; one failed move stopping
  the rest, or failing silently with no list of what stayed; a progress that reports the batch
  as done while a move is still running; a crash leaving the in-flight item neither healed nor
  listed; the exports suggestion counting items of another workspace or the same export twice
  when both it and its source are selected; "Move only the recording" still moving the exports.
- **Settings (decision 14):** a folder received from someone else injecting behaviour through
  `.kaipu/settings.json` (unknown keys, invalid values, an `uploadMode`); a received folder
  starting automatic uploads on this Mac; a setting edited mid-take changing that take; an older
  app version erasing the overrides on its first settings write; a shortcut that does something
  else after a switch; an override silently applying everywhere because the UI does not show
  its source.
- **Synced folders (decision 15):** a recording's `.part` being uploaded while it is written;
  a drag copy syncing a duplicate of the item under its title; a same-device rename into or out
  of a File Provider folder that loses or trashes the cloud copy; hashing, probing or
  thumbnailing an evicted file hanging the Library or marking the workspace unreadable; an
  evicted `workspace.json` making the workspace "unreadable"; an evicted sidecar read as `{}`
  and rewritten with a new `assetId`, which loses the title, tags and cloud link (NIW2-568
  hardens this read, but a read can still fail, and a failed read must never be mistaken for a
  missing sidecar); a conflict
  copy (`tags (1).json`) silently winning or being ignored with no warning.
- **Cloud entries of a deleted workspace (decision 23):** entries assigned to another workspace
  without an explicit choice, or shown in a Library that is not theirs.
- **Migration (decision 17):** an upgrade that renames, moves or rewrites a customer's media,
  sidecars, tags or settings; a crash mid-migration leaving no usable library; a second run
  minting a second id; an unparseable `preferences.json` being overwritten and losing the
  custom folder; the migrated workspace named after its folder instead of "Default workspace"; a
  downgrade opening an empty default folder instead of the active workspace; a
  re-upgrade ignoring a folder change the user made in the older version; a new server breaking
  an older desktop.
- **Reserved names:** a media file named `workspace.*`, `settings.*` or `tags.*` in the folder
  root, whose sidecar path is `.kaipu/workspace.json`, `.kaipu/settings.json` or
  `.kaipu/tags.json`, so an identity write or a Delete of that item overwrites or removes the
  workspace's own files.

## Acceptance criteria

- [ ] With two workspaces registered, the Library, the Editor home, tag lists and counts show
      only the active workspace's items and tags; no IPC returns another workspace's items.
- [ ] A recording, export, GIF and screenshot made while workspace A is active land in A's
      folder, including the cursor track; the switcher is disabled for the whole write.
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
- [ ] Adding a folder without `.kaipu/` writes `.kaipu/workspace.json` with a UUID, a name, a
      palette color and initials; adding a pre-workspaces vault keeps its sidecars, tags and
      edit projects and only adds `workspace.json`.
- [ ] Adding a folder whose `workspace.json` id is already registered to an **unavailable**
      path updates that entry's path (relocate); to an **available** path, gives the copy a new id.
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
- [ ] "Move only the recording" leaves the exports listed as they were, in their workspace,
      without an error; the left-behind export's item page says "Source recording is not in this
      workspace", never "was deleted".
- [ ] A target with an item already named `<id>` receives the moved item as `<id>-2`; nothing
      is overwritten.
- [ ] Tags on a moved item map to target tags with the same slug; missing ones are created with
      the same name and color.
- [ ] A moved item's fresh edit project stays fresh (no "missing dependencies" badge).
- [ ] "Remove from list" changes no file on disk; re-adding restores the workspace with the same
      id, cloud entries and setting overrides.
- [ ] "Delete workspace" moves `.kaipu/` to the Trash, leaves every media file in place, and
      refuses with a message on a volume where `shell.trashItem` fails.

**Switcher and labels (decisions 11–13)**

- [ ] With one workspace: the rail shows the active workspace tile and a "+" tile, the status
      bar shows the chip, the Library header shows the workspace's name and count, the capture
      surfaces say "Saving to <name>" and "Saved to <name>", and Settings → Workspaces offers
      "Add workspace". The Settings scope selector, the tray Workspace submenu, the ⌘digit
      switch and the window-title prefix need a second workspace to mean anything and stay
      absent; the window title is "Kaipu Record".
- [ ] A user with one workspace reaches the Add workspace flow in one click on the rail's "+"
      tile.
- [ ] With two workspaces: one click on the inactive tile switches (no menu opens); right-click
      offers Rename, Show in Finder and Manage; the "+" tile opens the add flow.
- [ ] With five or more workspaces, the rail shows four tiles and a "+N" tile whose list holds
      the rest, and the active workspace is always one of the visible tiles or marked in the list.
- [ ] The status bar chip, the window title ("Work — Kaipu Record") and the tray submenu name
      the active workspace and update on every switch; choosing a workspace in the tray
      switches it while the main window is hidden.
- [ ] ⌘1…⌘n switch only while a Kaipu window is focused; with another app in front they do
      nothing; a user global shortcut bound to ⌘<digit> wins and that digit does not switch.
- [ ] A workspace tile, the chip and the tray show the color and initials read from
      `.kaipu/workspace.json`; a missing or unknown color falls back to a palette color, and
      missing initials are derived from the name.
- [ ] The Library header shows the workspace name and the item count; cards carry no
      workspace chip.
- [ ] Every Library card and list row has a "⋯" menu with "Move to ▸" listing the other
      workspaces, or "New workspace…" alone when there is none; a not-connected target is disabled with "Not connected"; during a write the
      entry is disabled with the reason; within 10 s of a drag the move is refused with a
      message; an evicted synced item shows "Download it first".
- [ ] The item page shows "Workspace: Work" and a "Move to…" action; both editors show a
      "Work ▾" chip with the move targets; the export sheet says "Saves to Work".
- [ ] The idle Record page heading reads "Recording to Work" with a Switch action beside it,
      in place of "Ready to record" (`record.readyToRecord`, `record-page.tsx:254`): that text
      appears nowhere on the page, the page keeps one `h1`, and Switch opens the workspace list
      (with one workspace the list holds it and "Add workspace"). `record-page.test.tsx` asserts
      the new heading.
- [ ] The control bar shows "● Work" while recording, and hides it whenever the bar is part of
      the recording (`showBarInRecording` on).
- [ ] The capture panel and overlay say "Saving to Work"; the capture toast says "Saved to
      Work" (and "Save to Work") and has no move control, with one workspace or several.
- [ ] Moving a cloud-only item calls `PUT /assets/{assetId}/workspace` and moves its small
      files; offline, it is refused with a message and nothing changes.
- [ ] The Library of each workspace keeps search, sort (Newest, Oldest, Largest), grid/list,
      kind, storage and tag chips with counts, the tag drawer and the "filtered by" summary,
      all computed over that workspace's items only.

**Visibility with one workspace (decision 19)**

- [ ] The first launch after the upgrade shows the hint "New: workspaces — keep work and
      personal captures apart" once, anchored to the rail's active tile, with a dismiss control
      and Escape. After it is dismissed, restarting the app and switching workspace never show
      it again; its dismissed state is in userData (`preferences.json`), not in the workspace
      folder.
- [ ] The hint does not cover the "+" tile or any nav item, and does not block clicks outside
      itself. Adding a workspace dismisses it too.
- [ ] In a one-workspace app, "Move to ▸ New workspace…" is present on the card and row "⋯"
      menu, the item page and both editors. It opens the folder picker and the Add workspace
      flow; on completion it moves the item to the new workspace, which stays inactive, and the
      toast offers "Switch".
- [ ] Cancelling the folder picker, or a failed Add workspace, moves nothing and registers
      nothing. A move that fails after the workspace was added leaves the workspace registered
      and the item in its source, and says so.

**Select mode and group move (decisions 20–21, ADR 0033)**

- [ ] The Library has a Select action. In select mode, every card and row shows a checkbox;
      clicking toggles it; shift-click selects the range between the last clicked item and the
      clicked one, in the order on screen (any sort, search or filter in effect).
- [ ] A bottom bar shows "N selected · Move to ▸" with the other workspaces (or "New
      workspace…"), and a way out of select mode. Changing the search, a chip or the sort
      clears the selection; a switch leaves select mode.
- [ ] A disabled item (evicted, dragged under 10 s ago, target not connected) cannot be
      checked and says why.
- [ ] Moving 12 selected items runs 12 single moves one after another, shows one aggregate
      progress ("Moving 3 of 12"), keeps the switch lock for the whole group, and ends with a
      result. If 2 fail, the other 10 are moved, and the result lists the 2 with a reason each;
      they stay in the source, selected, so a retry is one click.
- [ ] Stopping a group lets the move in flight finish and starts no further one.
- [ ] Killing the app during a group move and relaunching heals the in-flight item (one copy
      listed, ADR 0033); items not yet started are untouched in the source; the group does not
      resume.
- [ ] Moving a recording that has 2 exports in the source workspace shows "This recording has 2
      exports in Work. Move them too?" with **Move all 3** (primary) and **Move only the
      recording**. "Move all 3" moves the recording and both exports, each under the same rules
      and each crash-safe on its own; "Move only the recording" moves the recording alone.
- [ ] A recording without exports, and an export moved on its own, show no such suggestion.
      When a selection holds a recording and its export, the export is counted once.
- [ ] If one export of a "Move all" fails, the result says "Moved 2 of 3 to Personal. 1 stayed
      in Work: <title> — <reason>", and that export shows the corrected lineage line.

**Default workspace name, orphan cloud entries, and the "All workspaces" scope (decisions 22–24)**

- [ ] The migrated workspace is named "Default workspace" with initials "DW" and the first
      palette color; a workspace added from a folder named "Client X" is named "Client X" in the
      add dialog and can be renamed there.
- [ ] After "Delete workspace", its cloud entries appear in no Library; Settings → Workspaces
      shows "N cloud items are not in any workspace on this Mac" with "Assign to workspace…",
      and choosing a workspace calls `PUT /assets/{assetId}/workspace` for each; nothing is
      assigned before that choice.
- [ ] No Library view combines workspaces, and "All workspaces" appears only in the Settings
      scope selector.

**Settings (decision 14, ADR 0034)**

- [ ] With no override, every effective setting equals the All workspaces value; changing an
      All workspaces value changes it in every workspace that does not override it.
- [ ] An override of each of the five keys applies only in its workspace; Reset returns the
      row to "Inherited from All workspaces"; non-overridable rows show "App-wide" and edit the
      All level from any scope.
- [ ] In the All workspaces scope, a key that a workspace overrides says "Overridden in <name>".
- [ ] A `.kaipu/settings.json` with an unknown key, an invalid value, or an `uploadMode` is
      read as if those entries were absent, and the file is not rewritten by reading it.
- [ ] Adding a received folder whose `.kaipu/settings.json` says `uploadMode: "automatic"`
      starts no upload, and that workspace's upload mode reads "Inherited from All workspaces".
- [ ] Changing `recordingQuality` or `showBrandBadge` during a take, or switching in another
      window during it, does not change that take; the next take uses the new value.
- [ ] Shortcuts are identical in every workspace, and no shortcut row has a workspace scope.
- [ ] An unavailable workspace's scope is listed, disabled, as "Not connected".
- [ ] After the upgrade, `userData/settings.json` is byte-identical to before until the user
      changes a setting.

**Synced folders (decision 15)**

- [ ] A workspace under `~/Library/CloudStorage/GoogleDrive-…`, `~/Library/CloudStorage/OneDrive-…`
      or `~/Library/Mobile Documents/com~apple~CloudDocs` (after resolving symlinks) shows
      "Synced by Google Drive / OneDrive / iCloud Drive" on its Settings row, and adding it shows
      a one-time note.
- [ ] Recording into a synced workspace writes no `.part` file inside the workspace folder, and
      dragging an item out writes no file inside it.
- [ ] A move whose source or target is synced copies, verifies sha256 at the final path and
      then deletes, even when both paths report the same `stat.dev`.
- [ ] An evicted media file lists as "In the cloud — download to open", with no thumbnail
      generation, probe or hash started for it, and the Library finishes loading while offline.
- [ ] An evicted `workspace.json` leaves the workspace available under its registered id;
      moves into it wait until the file is read and its id matches.
- [ ] A sidecar that exists but cannot be read (evicted and offline, or any error other than
      "not found") lists the item read-only and never writes a new sidecar or `assetId`. This
      depends on [NIW2-568](https://linear.app/niway/issue/NIW2-568), which must land first.
- [ ] A conflict copy of `tags.json`, `workspace.json`, `settings.json` or a sidecar inside
      `.kaipu/` raises a warning on the workspace's Settings row naming the files; Kaipu
      neither merges nor deletes them.

**Migration (decision 17)**

- [ ] First launch after the upgrade registers the current vault (custom or default path) as
      the only workspace, active, named "Default workspace", and writes only
      `.kaipu/workspace.json` and the `workspaces` key of `preferences.json`; every other file in the folder and in userData is unchanged
      (compared by hash before and after).
- [ ] Running the migration twice, and killing the app after `workspace.json` is written but
      before `preferences.json` is, both end with one workspace with one id; after the kill,
      the app still opens the library before and after the relaunch.
- [ ] An unparseable `preferences.json` is not overwritten; the app opens the library as today
      and retries the migration on the next launch.
- [ ] A folder that is not writable is registered with `pendingInit: true`, still opens as
      today, and gets `workspace.json` once it is writable.
- [ ] After every switch, `vaultDirectory` in `preferences.json` equals the active workspace's
      path (the key is absent when that path is the default folder); an older app version
      launched on that file opens the active workspace's items.
- [ ] An older app version that changes the folder keeps the `workspaces` key; the next launch
      of this version registers that folder (or matches it by its `workspace.json` id) and makes
      it active.
- [ ] A fixture test loads the `preferences.json` and `settings.json` shapes of the current
      release: a custom folder, the default folder, no file, and an unreachable custom folder.
      Each ends with the expected registry, and effective settings equal to `mergeSettings` of
      the stored file for every key.
- [ ] The server migration adds `cloud_asset.workspace_id` as a nullable column with no
      default rewrite of existing rows; `GET /assets` from the current desktop release still
      parses; an upload intent without `workspaceId` is accepted.
- [ ] A media file named `workspace.png`, `settings.mp4` or `tags.png` in a workspace root is
      listed, its identity write and its Delete never touch `.kaipu/workspace.json`,
      `.kaipu/settings.json` or `.kaipu/tags.json`.

---

## Current state (verified on `main` at `16cd8d80`, 2026-10-29)

All paths are relative to `apps/kaipu-record/src/` unless they start with `packages/`. Round 1
was verified at `be178352`. The only `src` change since is #428, which shifted `main/index.ts`
by 14 lines; the line numbers below are the current ones.

**One folder.** `main/library/vault-location.ts:9-11` stores one optional `vaultDirectory`
string in `userData/preferences.json` (`:14-16`). `vaultDirectory()` returns it, or the default
`Videos/Kaipu Record` (`:54-69`). The parsed preferences are cached in memory (`:25`); this is
NIW2-394, merged in #410. `readFromDisk` returns `{}` when the file does not parse (`:27-33`),
so a corrupt file today silently means "default folder". `setVaultDirectory` and
`resetVaultDirectory` re-read the file and spread it (`:70-80`), so **an older version keeps
any key it does not know**. Settings → Files (`renderer/src/pages/settings/settings-pages.tsx:210`)
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
  (`:32-60`), and at startup and quit (`main/index.ts:727`, `:1158`). Startup also deletes
  `<os temp>/kaipu-drag`, the folder of older builds (`main/index.ts:728`,
  `drag-copies.ts:23-26`), so that name cannot be reused for new drag copies.
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
finish in B, which may also be a copy across volumes. Staging is `<vault>/.kaipu/tmp/`
(`STAGING_DIR`, `recording-writer.ts:10-11`) so that the finalize is a same-volume rename, and
stranded-take recovery scans that folder and the OS temp fallback
(`main/recording/stranded-recordings.ts:35-39`).

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

**Nothing lists `.kaipu/`.** `LibraryVault.list()` reads only the folder root and keeps files
with a media extension (`library-vault.ts:105-115`). Every `.kaipu/` path is derived from an
item id, a fixed name (`tags.json`) or a known subfolder (`drag/`, `tmp/`, `<id>.assets/`). So
an older version ignores new files in `.kaipu/`, with one exception: a root media file whose
stem equals a fixed name. Its sidecar path is that file, see Things the code contradicted.

**Settings.** `AppSettings` has 23 keys (`shared/types/ipc.ts:237-351`), stored whole in
`userData/settings.json` (`main/infrastructure/settings-store.ts:17-19`, atomic write at
`:41-49`). `mergeSettings` rebuilds the object field by field and drops unknown keys
(`main/services/settings.service.ts:112-160`). Renderers read it through `settings:get` /
`settings:changed` (`shared/types/ipc.ts:412-418`). The five keys of ADR 0034 are read by:
`useWatermark` live (`renderer/src/features/watermark/use-watermark.ts:22`); the Record page's
hook on mount, not at start (`renderer/src/features/recording/hooks/use-recording-setup.ts:89-98`);
the export sheet when it opens (`renderer/src/features/library/components/share-recording.tsx:171`,
`renderer/src/pages/video-editor/video-editor-page.tsx:1535`); the screenshot editor and main's
capture path (`renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:143`,
`main/screenshots/screenshot-ipc.ts:163`); and the Cloud page for `uploadMode`
(`renderer/src/pages/cloud/cloud-page.tsx:12-13`), whose comment says "per device, never per
account" (`shared/types/ipc.ts:203-209`).

**Shell and surfaces.** The rail is the shared `Rail` (`packages/ui/src/molecules/rail.tsx`):
72 px wide (`:25`), a brand slot (`:189-191`), then the nav sections (`:193`), mono 9 px labels
(`:86-88`), and no slot between the brand and the sections. `Sidebar` feeds it
(`renderer/src/shell/sidebar.tsx:36-68`). The status bar holds the env badge, the shortcut hints
and the version (`renderer/src/shell/app-shell.tsx:54-66`). The main window title is fixed at
"Kaipu Record" (`main/index.ts:264`, `renderer/index.html:5`). The tray menu is a plain template
(`main/tray-menu.ts:60-114`). The capture toast's copy is in
`packages/i18n/messages/en.json:755-764` (`screenshots.toast.savedTitle` = "Saved to Library",
`saveToLibrary`, `footerAlsoSaved`). Library cards and rows have **inline icon buttons** for
Tags, Edit and Delete and **no action menu** (`renderer/src/features/library/components/video-card.tsx:95-115`,
`video-row.tsx:98-115`). The item page has a metadata line (`library-detail-page.tsx:271`) and an
action row (`:345-400`). The Record page's idle heading is `t("readyToRecord")` (`renderer/src/pages/record/record-page.tsx:254`,
`en.json:283`, `es.json:283`), asserted by `record-page.test.tsx:191`. The Library has **no
selection model**: the `selected` prop of cards and rows is only the tag-panel highlight
(`library-page.tsx:341`, `:362`). The Library page has a title and subtitle (`renderer/src/pages/library/library-page.tsx:120-124`),
the search, `SortMenu` and grid/list toggle (`:141-170`), kind and storage chips with counts
(`:178-218`), the tag row and drawer (`:101-110`, `:232`), and the "filtered by" summary
(`:73-86`, `:275`). The filters themselves are in `renderer/src/features/library/library-filters.ts:6-22`, `:43-55`.

**Keyboard.** Every default global shortcut is `Command+Control+<letter>` on macOS
(`shared/types/ipc.ts:92-176`). Main sets no application menu (no `setApplicationMenu` call),
so the window has Electron's default menu, which binds no ⌘<digit>. No in-window key handler
uses digits: the editors use letters, Space, Escape and Delete
(`renderer/src/pages/video-editor/video-editor-page.tsx:1076-1120`). **⌘1–⌘9 are free.**

**Cloud catalog.** `main/cloud/catalog-cache.ts:11-31` keeps `userData/cloud/<userId>/catalog.json`
per account. It is a **cache of server data**: `LibraryService.doRefresh`
(`main/library/library-service.ts:78-93`) rebuilds every entry from `GET /api/v1/assets`
(`main/cloud/catalog-client.ts:36-92`) and carries forward only `lastSeenLocalId`. The client
casts the response and maps named fields (`:56-75`), so an extra server field is ignored by the
current release. `composeLibrary` joins local and cloud by `assetId` alone
(`main/library/compose-library.ts:32-58`). The server row is `cloud_asset`
(`packages/infra-db/src/schema/cloud.ts:21-45`), keyed by `(user_id, asset_id)`. The desktop
does **not upload yet**: no client calls `/assets/upload-intents` (only
`apps/server-hono/src/contract/cloud.contract.ts:29` defines it).

**Moves to reuse.** `atomicWriteFile` and `withLock` (`main/library/atomic-write.ts:11-50`);
`sha256FileBase64` (`main/library/content-hash.ts`); the EXDEV handling in `createDragCopy`
(`main/library/drag-copies.ts:70-94`, NIW2-398, merged in #412). `moveFile`
(`main/recording/recording-writer.ts:66-91`) renames, or else copies and unlinks **without
verifying**, so it is not safe for a user's only copy (ADR 0033).

**Startup and quit.** Stranded-take recovery (`main/index.ts:1020`) and drag-copy cleanup
(`main/index.ts:727`, `:1158`) run for the active vault only.

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
   has not shipped, rows without it will not exist in practice.
3. **"Switching is locked while recording" is not enough.** Exports, GIF saves, screenshot
   saves and the editor's autosave all resolve the folder at write time (see
   [Current state](#current-state-verified-on-main-at-16cd8d80-2026-10-29)). The design widens
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
9. **There is no item menu in the Library** (round 2). Round 1 said "the item menu gets Move to
   workspace". Cards and rows only have inline Tags, Edit and Delete buttons
   (`video-card.tsx:95-115`, `video-row.tsx:98-115`). Decision 13 adds a "⋯" menu.
10. **A left-behind export says its source "was deleted"** (round 2). The item page resolves
    `derivedFromAssetId` against the loaded list only (`library-detail-page.tsx:163-166`) and
    shows "Source recording was deleted" (`:331-340`, `en.json:720`) when it is absent. After a
    move that is false. Decision 13 changes the copy.
11. **A sidecar read error is read as "no sidecar"** (round 2). `LibraryVault.sidecar()` returns
    `{}` for any error (`library-vault.ts:169-175`), and `ensureIdentity` then writes a sidecar
    with a new `assetId` (`:185-214`). On a synced folder, an evicted sidecar that cannot be
    downloaded at that moment would lose its title, tags and cloud link. Only `ENOENT` may mean
    "no sidecar"; any other error lists the item read-only (the `readOnlyIdentityMemo` path)
    and writes nothing. This also protects flaky network drives today. The fix is tracked as
    [NIW2-568](https://linear.app/niway/issue/NIW2-568) and is a prerequisite of this design.
    It is hardened, not guaranteed: a read can still fail, and it must never be mistaken for a
    missing sidecar.
12. **Fixed names in `.kaipu/` collide with media stems** (round 2). A sidecar path is
    `.kaipu/<stem>.json`, so a root file `tags.png` already addresses `.kaipu/tags.json` as its
    sidecar, and `remove()` deletes it by that path (`library-vault.ts:378-389`). Adding
    `workspace.json` and `settings.json` adds two more such names. An adopted folder can hold
    any file name. Guard: `workspace`, `settings` and `tags` are reserved stems. Such a media
    file lists with an in-memory identity (the read-only path), and its writes and Delete never
    touch the reserved file. An older version has no guard. That risk is pre-existing (for
    `tags.json`) and needs a file named exactly that.
13. **`recordingQuality` is read when the Record page mounts**, not when a take starts
    (`use-recording-setup.ts:89-98`), and `showBrandBadge` is read live (`use-watermark.ts:22`).
    Decision 14's "bound at capture start" needs both changed (ADR 0034, Consequences).
14. **Overrides cannot live in `settings.json`.** `mergeSettings` drops unknown keys
    (`settings.service.ts:112-160`), so an older version would erase them on its first write.
    That is why ADR 0034 keeps the All level unchanged and puts overrides in separate files.
15. **The control bar can be in the video.** With `showBarInRecording` on, the bar is
    captured (`shared/types/ipc.ts:249-253`). A "● Work" chip on it would put the workspace's
    name into the recording, so the chip hides in that case (decision 13).
16. **The Library has no selection model** (round 3). Multi-select Move (decision 20) needs one:
    the `selected` prop of `VideoCard` and `VideoRow` is the tag-panel highlight
    (`library-page.tsx:341`, `:362`). The design specifies a minimal one (UI, Select mode).
17. **The Record page has no "where" line to extend** (round 3). Its idle page is an eyebrow,
    the heading "Ready to record", a subtitle and the mode buttons (`record-page.tsx:252-257`).
    The heading is replaced by "Recording to Work · Switch" rather than adding a line below it.

---

## Detail

### Data shapes

`.kaipu/workspace.json` (written atomically, in the folder):

```json
{
  "version": 1,
  "id": "0192f0c4-7a1e-7c3b-9f2a-4d5e6f708192",
  "name": "Work",
  "color": "amber",
  "initials": "W",
  "createdAt": 1761734400000
}
```

`id` is a UUID v7 (`uuidv7()` from `tag-repository.ts`, as tags). `name` is authoritative here,
so a folder carried to another Mac keeps its name. The migrated vault is named "Default
workspace" (decision 22); a workspace the user adds is named after its folder until renamed. `color` is a key of the tag palette
(`TAG_COLORS`, `packages/domain/src/constants/tags.ts:17`), so the tile and the chip reuse the
tag tokens. A new workspace takes the next color not yet used, like `nextTagColor`. `initials`
is optional (1–2 characters). When absent, it is the first letter of the first two words of
`name`. An unknown `color` or invalid `initials` falls back to these defaults on read, and the
file is not rewritten. Renaming or recoloring a workspace writes this file. An older version
never reads it.

`<workspace>/.kaipu/settings.json`, the folder-bound overrides (ADR 0034), absent until the
first override:

```json
{ "version": 1, "overrides": { "recordingQuality": "1080p60", "showBrandBadge": false } }
```

`userData/workspace-settings.json`, the machine-bound override (ADR 0034):

```json
{ "version": 1, "workspaces": { "0192f0c4-7a1e-7c3b-9f2a-4d5e6f708192": { "uploadMode": "manual" } } }
```

`userData/preferences.json`, the new `workspaces` key next to the existing keys:

```json
{
  "vaultDirectory": "/Volumes/Work/Kaipu",
  "workspaces": {
    "version": 1,
    "activeId": "0192f0c4-7a1e-7c3b-9f2a-4d5e6f708192",
    "legacyCloudOwnerId": "0192f0c3-0000-7000-8000-000000000001",
    "hintDismissedAt": 1761820800000,
    "entries": [
      { "id": "0192f0c3-0000-7000-8000-000000000001", "path": "/Users/me/Movies/Kaipu Record", "name": "Default workspace", "color": "rose", "initials": "DW", "addedAt": 1761734300000 },
      { "id": "0192f0c4-7a1e-7c3b-9f2a-4d5e6f708192", "path": "/Volumes/Work/Kaipu", "name": "Work", "color": "amber", "initials": "W", "addedAt": 1761734400000 }
    ]
  }
}
```

- `name`, `color` and `initials` in an entry are a cache, so an unavailable workspace can
  still be drawn in the rail and named in the UI. The folder's file wins when it is readable.
- `legacyCloudOwnerId` names the workspace that owns cloud entries without a `workspaceId`
  (decision 3). It is explicit, not "the first entry", so removing or reordering entries never
  moves those entries elsewhere silently.
- `hintDismissedAt` is absent until the user dismisses the one-time workspaces hint (decision
  19), then holds the time. It lives here, in userData, because the hint is about this install,
  not about a folder. An older version keeps it with the rest of the `workspaces` key.
- `vaultDirectory` mirrors the active path **on every switch, with no end date** (decision
  17). It is removed when the active path is the default folder, so an older version shows
  "default" rather than a custom folder.

**The "master settings"** the owner asked about are two files in userData, both outside any
workspace: `userData/preferences.json` holds the workspace registry (the list and `activeId`),
and `userData/settings.json` holds the All workspaces level of every setting. Each workspace
adds at most its own `.kaipu/settings.json`, and this Mac adds at most one `uploadMode` per
workspace in `userData/workspace-settings.json`.

`CloudCatalogEntry` (`shared/types/library-item.ts:50-68`) gains `workspaceId: string | null`.
The local `userData/workspace-moves/<moveId>.json` journal is specified in ADR 0033.

### Availability

A workspace is **available** when its path exists, `.kaipu/workspace.json` is readable and its
`id` matches the entry. Otherwise it is **unavailable**, with a reason: `missing` (the path is
gone: an unplugged drive or a deleted folder), `unreadable`, or `different` (another
workspace's file is there). The check runs when the list is read and before a switch or a move.
It never creates the root. `LibraryVault.list()`'s `mkdir` (`library-vault.ts:106`) must only
create `.kaipu/` inside an existing root.

One exception: in a synced workspace, a `workspace.json` that exists but is evicted is **not**
`unreadable` (see Synced folders). Reading it may download it. Until that read succeeds, the
workspace is available with `identity: "unverified"`. It can be listed, switched to and
captured into under the registered id, and it cannot receive a move.

### Migration (first launch after the upgrade)

Kaipu has paying customers. The migration is therefore **additive only**: it adds two things,
and no customer file is moved, renamed or rewritten.

1. **Trigger.** `preferences.json` has no `workspaces` key. If the file exists but does not
   parse, stop: write nothing, open the library exactly as today, log it, and try again on the
   next launch. Today's `readFromDisk` would treat it as empty (`vault-location.ts:27-33`), and a
   migration that then wrote the file would erase a custom folder for good.
2. **Pick the folder.** `vaultDirectory().path`, custom or default.
3. **Adopt it.** If it is reachable: create it if it is the default and missing (today's
   behaviour), then read `.kaipu/workspace.json`. If it is valid, reuse its id and name.
   Otherwise mint an id, name the workspace "Default workspace" (decision 22), and write the
   file atomically (`atomicWriteFile`: temp, fsync, rename). If the folder is
   unreachable (a custom folder on an unplugged drive) or not writable, mint the id anyway and
   mark the entry `pendingInit: true`. On the first reach, write `workspace.json`. If a
   `workspace.json` is already there by then, adopt that id, and update `activeId` and
   `legacyCloudOwnerId` to match.
4. **Register it.** Write `preferences.json` atomically with the `workspaces` key: one entry,
   active, `legacyCloudOwnerId`. Keep `vaultDirectory` exactly as it was (present or absent).
5. **Touch nothing else.** No sidecar, tag registry, thumbnail, edit project or media changes.
   `settings.json` is neither read for the migration nor written: it becomes the All workspaces
   level as it is. No override exists, so every effective setting equals today's value. That
   means zero behaviour change.

**Idempotent.** With the key present, the migration does nothing. A rerun after step 3
finds the `workspace.json` it wrote and reuses its id, so there is never a second id.

**Crash-safe.** Each step leaves a usable state. A crash before step 4 leaves no `workspaces`
key, so both this version and an older one open the folder through `vaultDirectory` as today.
The file written in step 3 is ignored by an older version and reused by this one. Step 4 is
one atomic rename.

**Downgrade-safe.** An older version reads only `vaultDirectory` (`vault-location.ts:9-11`).
Because every switch keeps it equal to the active path, an older version opens the workspace
that was active. What an older version does with the new pieces:

- `.kaipu/workspace.json` and `.kaipu/settings.json`: ignored, since nothing lists `.kaipu/`
  (Current state). The exception is the reserved-stem collision (Things the code contradicted,
  12), which needs a media file named `workspace.*` or `settings.*`.
- The `workspaces` key: kept, because its writes spread the file they read
  (`vault-location.ts:70-80`).
- `userData/workspace-settings.json` and the scratch folders in userData: never opened. A take
  stranded in a synced workspace's scratch folder is recovered when this version runs again,
  not by the older one.
- Other workspaces are invisible, and the cloud filter is gone: an older version shows every
  cloud entry of the account. No cloud entry carries a `workspaceId` until desktop upload
  ships, so today this shows nothing new.

**Round trip.** On every launch, if the folder `vaultDirectory()` resolves to is not the active
entry's path, an older version changed it. This version then adopts that folder, matching an
existing entry by its `workspace.json` id or path or registering a new one, and makes it
active. A folder change made while downgraded is therefore not ignored after the re-upgrade.

**Server.** `cloud_asset.workspace_id` is added as a nullable column in an additive migration,
with no rewrite of existing rows. `GET /assets` adds the field, which the current desktop
ignores (`catalog-client.ts:56-75`). `POST /assets/upload-intents` accepts `workspaceId` as
optional, and this desktop always sends it. A row without one belongs to `legacyCloudOwnerId`
on each Mac.

**Fixture test.** `main/library/__fixtures__/workspaces-migration/` holds the shapes the current
release writes: `preferences.json` with a custom `vaultDirectory`, no `vaultDirectory` (the
default folder), no file at all, a custom folder that is unreachable, and an unparseable file.
Next to them sits a `settings.json` with all 23 keys as `settings-store.ts` writes it. Each case
asserts the resulting registry, the files written (only the two named in steps 3–4), and that
effective settings equal `mergeSettings(stored)` for every key.

**Rollout.** No flag. The release ships the registry, the migration and the new code paths, and
the feature is **visible from the first launch** (decision 19): the rail's active tile and "+"
tile, the status-bar chip, the one-time hint, "Saving to …" labels, and Settings → Files becoming
Settings → Workspaces with an "Add workspace" action. What stays behind a second workspace is
what only makes sense with a choice: the Settings scope selector, the tray submenu, the ⌘digit
switch and the window-title prefix. The data is unchanged: the migration still touches only the
two things above.

### Cloud: server and client

The server changes; it does not exist on any client yet:

- `cloud_asset.workspace_id text NULL`, an opaque client UUID with no foreign key; the server
  does not know workspace names. Additive migration (see Migration).
- `POST /assets/upload-intents` takes an optional `workspaceId`; this desktop always sends it.
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
  (decision 23) from the **full** catalog and shown nowhere else.
- An upload reads `uploadMode` for the item's workspace (ADR 0034, decision 4).

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

### Settings per workspace

Specified in [ADR 0034](/architecture/decisions/0034-per-workspace-setting-overrides/), which
also holds the inventory of every `AppSettings` key with its class and reason. In short:

- Effective value = workspace override ?? All workspaces value. Main resolves it, and
  `settings:get` / `settings:changed` keep their shape and now return the effective settings of
  the active workspace. A switch broadcasts `settings:changed`.
- New channels: `settings:get-scoped(scope)` → `{ all, overrides, effective }`, and
  `settings:set-override(workspaceId, key, value | null)` (null = Reset). `settings:update`
  keeps writing the All level.
- Overridable: `showBrandBadge`, `recordingQuality`, `exportQuality`, `screenshotCopy` (folder
  file) and `uploadMode` (userData file). Shortcuts never.
- Bound at capture start with the capture's `workspaceId`, together with its folder.
- Unknown or invalid entries in a folder file are ignored and never written back. An
  unreachable workspace's scope cannot be edited.

### Synced folders

**What the sources say.** On macOS, Google Drive, OneDrive and other providers use Apple's
File Provider. Their folders live in `~/Library/CloudStorage` and cannot be moved
([Google](https://support.google.com/drive/answer/12178485)), always on the internal drive
([TidBITS](https://tidbits.com/2023/03/10/apples-file-provider-forces-mac-cloud-storage-changes/)).
iCloud Drive lives in `~/Library/Mobile Documents/com~apple~CloudDocs`. A file can be
**evicted**: it stays as a placeholder with its attributes and no data, and the provider
downloads it when it is needed
([Eclectic Light](https://eclecticlight.co/2026/05/09/explainer-file-provider-and-cloud-services/)).
Opening an online-only file downloads it, and some apps fail on files not yet downloaded
(TidBITS). Moving an item out of the Drive folder sends its cloud copy to the trash (Google).

**Detection.** After resolving symlinks (`realpath`), a workspace path under
`~/Library/CloudStorage/GoogleDrive-…` is "Synced by Google Drive", under
`~/Library/CloudStorage/OneDrive-…` "Synced by OneDrive", under
`~/Library/Mobile Documents/com~apple~CloudDocs` "Synced by iCloud Drive", and anything else
under `~/Library/CloudStorage/` "Synced by a cloud provider". The Settings → Workspaces row
shows the label. Adding such a folder shows a one-time note: Kaipu keeps its working files
outside the folder, items the provider has offloaded show as "In the cloud", and opening the
same folder on two Macs at once can create conflict copies. The kind is stored on the entry
and re-detected on every launch.

**Scratch outside the folder, for synced workspaces only.** Recording staging and move staging
go to `userData/workspace-scratch/<workspaceId>/tmp/`, and drag copies to
`userData/workspace-scratch/<workspaceId>/drag/` (not `<os temp>/kaipu-drag`, which startup
deletes, `drag-copies.ts:23-26`). Local and external-drive workspaces keep `.kaipu/tmp/` and
`.kaipu/drag/`.

Why not for every workspace, which would be one rule: for an external drive, staging in
userData would turn every finalize into a multi-GB copy across volumes and put the take on the
internal disk, which is often the one without room. A synced folder is always on the internal
drive, so its scratch in userData is on the same device and the finalize stays cheap. Startup
and quit sweeps (stranded takes, drag copies) also scan each synced workspace's scratch folder.

**Moves.** Any move with a synced side copies, verifies sha256 **at the final path** and then
deletes (ADR 0033, decisions 4 and 13). This holds even when `stat.dev` matches, which it always
does on the internal drive.

**Evicted files.** Main checks before reading. A media file is treated as evicted when
`stat.blocks === 0 && stat.size > 0`. That is a heuristic, because Node's `fs.Stats` does not
expose the `SF_DATALESS` flag (unverified: whether every provider's placeholder reports zero
blocks). An evicted media file:

- lists from its sidecar (title, duration and size come from the sidecar and `stat`);
- shows "In the cloud — download to open" in the Library and on the item page;
- gets no thumbnail generation, no probe and no hash;
- cannot be dragged, edited, shared or moved until it is downloaded. **Download** reads the
  file once in main with a progress row, which makes the provider download it, and can be
  cancelled.

**Prerequisite: NIW2-568.** Sidecar read hardening is tracked separately as
[NIW2-568](https://linear.app/niway/issue/NIW2-568) and lands before this work. It is
**hardened, not guaranteed**: a read can still fail, and it must never be mistaken for a missing
sidecar. This design relies on that rule, not on reads never failing.

Small `.kaipu/` files (`workspace.json`, sidecars, `tags.json`) may be read even when
evicted, which downloads a few KB, but every read has a timeout. A sidecar read that fails or
times out lists the item read-only and writes nothing (Things the code contradicted, 11). A
`tags.json` read that fails shows the tags as unavailable, and nothing writes the registry.
None of this marks the workspace unreadable.

**Two Macs.** The same synced folder registered on two Macs is one workspace (same id), and the
cloud entries agree. Both may write `tags.json`, a sidecar or `settings.json` at the same time,
and the provider then keeps both versions as a conflict copy (for example `tags (1).json`;
the exact naming differs by provider and is unverified). The guard in the first release of workspaces is detect and warn: the
availability check lists `.kaipu/` for names matching a reserved file or a sidecar plus a
conflict suffix, and the Settings → Workspaces row warns "Conflicting copies of Kaipu files:
tags (1).json". Kaipu neither merges nor deletes them. Media conflict copies in the root
(`<id> (1).mp4`) list as separate items with their own identity. There is no cross-machine
locking in the first release.

**Unverified, to check in a spike before implementation:**

- whether `link()` from userData into, or inside, a File Provider folder fails, and with what
  error (the copy fallback covers both cases, but an evicted file's copy downloads it);
- whether a `rename()` from userData into a File Provider folder is atomic and keeps the
  provider's sync state (the design does not rely on it: it verifies at the final path);
- how reading an evicted file behaves offline: an error, a hang, or a wait (the timeout covers
  all three);
- whether the zero-blocks heuristic holds for Google Drive, OneDrive and iCloud Drive
  placeholders;
- whether iCloud's "Desktop & Documents" sync puts `~/Documents` under the iCloud path after
  `realpath`. If it does not, a workspace in `~/Documents` is synced but not detected;
- each provider's conflict-copy naming.

### IPC changes

New channels (main ↔ renderer):

| Channel                      | Payload → result                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaces:list`            | → `{ activeId, generation, hintDismissed, workspaces: { id, name, color, initials, path, sync, state: "available" \| "unavailable", reason?, warnings? }[], orphanCloudCount }` |
| `workspaces:add`             | opens the folder picker; adopts or initializes → the entry, or null when cancelled                                                                                              |
| `workspaces:switch`          | `id` → ok, or `{ reason: "busy" \| "unavailable" \| "cancelled" }`                                                                                                              |
| `workspaces:rename`          | `id, { name?, color?, initials? }` → entry                                                                                                                                      |
| `workspaces:remove`          | `id` → ok (refused for the active one and for the last one)                                                                                                                     |
| `workspaces:delete`          | `id` → ok or `{ reason: "active" \| "no-trash" \| "busy" }` after main shows the confirmation                                                                                   |
| `workspaces:open-folder`     | `id` → reveals the folder                                                                                                                                                       |
| `workspaces:move-item`       | `{ workspaceId, id }, targetId` → `{ ok, newId }` or a reason                                                                                                                   |
| `workspaces:move-items`      | `{ workspaceId, ids, withExports }, targetId` → progress events (`n of N`), then `{ moved: { id, newId }[], failed: { id, reason }[] }`; a group of single moves                |
| `workspaces:cancel-move`     | → ok; the move in flight finishes, no further one starts                                                                                                                        |
| `workspaces:dismiss-hint`    | → ok; stores `hintDismissedAt` in `preferences.json`                                                                                                                            |
| `workspaces:assign-cloud`    | `ids, targetId` → ok per id; calls `PUT /assets/{assetId}/workspace` (Settings → Workspaces, "Assign to workspace…")                                                            |
| `workspaces:download-item`   | `{ workspaceId, id }` → progress events, then ok or a reason (synced, evicted media)                                                                                            |
| `workspaces:changed` (event) | broadcast after any registry change or switch, with the generation; windows re-list                                                                                             |
| `settings:get-scoped`        | `scope` (`"all"` or a workspace id) → `{ all, overrides, effective }`                                                                                                           |
| `settings:set-override`      | `workspaceId, key, value \| null` → effective settings; refused for a non-overridable key or an unavailable workspace                                                           |

Changed: every item-scoped channel (`listLocalRecordings`, `loadCursorTrack`,
`renameLocalRecording`, `markOpenedInEditor`, `setItemTags`, `backfillLocalRecordingMeta`,
`deleteLocalRecording`, `revealLocalRecording`, `startFileDrag`, `videoEditSaveSession`,
`videoEditLoadSession`, screenshot load, copy-by-id and overwrite, and the tag registry
channels) takes `workspaceId` first, plus the workspace generation. Main rejects an unknown or
unavailable id, and **any id or generation that is not the active one** with `stale-workspace`.
The renderer also discards responses whose generation is no longer current. Main holds a
counter, `workspaces:changed` carries it, and it is bumped in the last step of a switch. `kaipu-media://thumb/<id>` becomes
`kaipu-media://thumb/<workspaceId>/<id>`, and the same for `recording/` and `screenshot/`.
`settings:get` and `settings:changed` keep their payload and return effective settings.

Retired: `getVaultDirectory`, `chooseVaultDirectory`, `resetVaultDirectory` and
`openVaultDirectory` are replaced by the `workspaces:*` channels. "Reset to default folder"
becomes "Add workspace" pointed at the default folder.

### The switch lock and the switch transaction

**The lock.** Main refuses `workspaces:switch` while any of these is true: the `RecordingWriter`
has an open session (this covers recordings and editor exports), a GIF or screenshot save is
running (this includes a toast's Save), a move is running (a group move holds the lock from
its first item to its last, including between two items), or a download is running. In
addition, `RecordingWriter.create()` stores the resolved folder (or scratch folder) in its
`Session`, and `finalize()` and the cursor-track write use that folder instead of calling
`vaultDirectory()` again. Even a bug in the lock cannot then split a take. Startup sweeps
(stranded takes, drag copies) iterate over every available workspace and every synced
workspace's scratch folder.

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
4. Main bumps the generation, writes `activeId` and the mirrored `vaultDirectory`, sets the
   window title, rebuilds the tray menu, and broadcasts `workspaces:changed` and
   `settings:changed`.

A failure before step 4 leaves the old workspace active and unchanged. Every switch entry point
uses this transaction: a tile, ⌘<digit>, the tray submenu, the Record page's Switch, the
"Moved to Personal · Switch" toast and Settings.

**Captures bind at start.** The capture request reads the active workspace once and carries
`workspaceId` in `QuietCapture`, the toast payload, the toast's Save and Annotate, and the
editor source, together with the effective settings it needs (ADR 0034). `saveScreenshotToVault`
takes the workspace from its metadata instead of `currentVault()`. A toast action whose
`workspaceId` is not the active one writes nothing. Switching drops the retained bytes. For a
copy-only capture the pixels are already on the clipboard, so nothing the user can still paste
is lost.

**One lock per item** (ADR 0033, decision 12) makes session saves, screenshot overwrites,
deletes and moves mutually exclusive per item. The sidecar lock stays inside it.

### UI

**One rule first: the feature does not depend on how many workspaces exist** (decision 19).
With one workspace the user still sees the active tile and a "+" tile in the rail, the chip in
the status bar, the labels where a capture lands ("Saving to Default workspace"), the Library
header with the workspace's name, and Settings → Workspaces with "Add workspace". A one-time
hint announces it. Four things need a choice to mean anything and stay hidden until a second
workspace exists: the Settings scope selector, the tray's Workspace submenu, the ⌘digit
switch, and the "Work — " prefix of the window title.

**The one-time hint (decision 19).** After the upgrade, a small popover anchored to the active
rail tile reads "New: workspaces — keep work and personal captures apart", with a dismiss
control and Escape. It shows once: dismissing it, or adding a workspace, calls
`workspaces:dismiss-hint`, which stores `hintDismissedAt` in `preferences.json` (userData).
It never covers the "+" tile or the nav, and it does not block clicks outside itself.

**"Move to ▸ New workspace…" with one workspace (decision 19).** Where "Move to ▸" would list
other workspaces, a user with only one sees "New workspace…" instead (card and row "⋯" menu,
item page, both editors, and the select-mode bar). It opens the same folder picker and Add
workspace flow as the "+" tile. When the workspace is registered, the move runs into it. The new
workspace is not made active, and the toast offers "Switch". If the picker is cancelled, or the
add fails, nothing is registered or moved. If the move fails after the add, the workspace stays
registered, the item stays in its source, and the message says so.

**The switcher (decision 11).**

- **Rail tiles.** A stack under the logo (`Sidebar`, `renderer/src/shell/sidebar.tsx:60-67`).
  The shared `Rail` has no slot between the brand and the sections (`rail.tsx:189-193`), so it
  gains one (a `header` prop). Following ADR 0009, the rail receives the tiles as elements and
  labels as props. Each tile is 36 px, with the initials on the workspace color and the name
  under it in 9 px mono, like the nav labels. The active tile carries the rail's active pill.
  - One click switches. No tile only opens a dropdown.
  - With one workspace the stack is the active tile and the "+" tile. The hint is anchored to
    the active tile.
  - Right-click opens Rename, Show in Finder and Manage (Settings → Workspaces).
  - An unavailable workspace's tile is dimmed, "Not connected", and does not switch.
  - The "+" tile opens the add flow.
  - With more than four workspaces, the fourth position is "+N" and opens a list of the rest.
    The active one is always visible, swapped into the stack if needed.
  - While the lock holds, the tiles are disabled with "Finish the recording to switch" (or the
    matching reason).
  - This follows the left-hand workspace rail of Slack and the server list of Discord.
- **Status bar chip** "● Work" in the workspace color, in `app-shell.tsx`'s status bar (`:54-66`).
  Clicking it opens the same list as "+N".
- **Window title** "Work — Kaipu Record", set by main on every switch.
- **Tray** (`main/tray-menu.ts`): a "Workspace: Work ▸" submenu listing the workspaces as radio
  items (disabled while busy or not connected). Captures often start from the tray or a
  shortcut with the main window hidden, so this is the only place the user can see and change
  the target there. `TrayMenuInput` gains the workspace list and a `switchWorkspace(id)`
  action.
- **⌘1…⌘n** (Ctrl on Windows) switch to the n-th workspace, only while a Kaipu window has focus.
  They are handled in the renderer, never registered with `globalShortcut`. ⌘1–⌘9 are free
  today (Current state). If the user binds a global shortcut to ⌘<digit>, the global one wins,
  and Settings → Shortcuts says that digit no longer switches.
- No other workspace screen exists besides **Settings → Workspaces**.

**Settings → Files becomes Settings → Workspaces** (`settings-pages.tsx:210`). There is one row
per workspace, with:

- its tile, name, path, state and sync label ("Synced by Google Drive"), and any conflict
  warning;
- the actions Rename (name, color, initials), Show in Finder, Remove from list and Delete
  workspace…;
- below the rows, **Add workspace** and, when non-zero, the orphan cloud count with **Assign to
  workspace…**.

**Where things land and "Move to" (decision 13).** The verb is always "Move to", never
"Send to", because the item leaves the source. The table applies with one workspace too, except
that "Move to ▸" then offers "New workspace…" only.

| Surface                         | With two or more workspaces                                                                                                                                                                                                                                                                                       | File                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Library header                  | The workspace name as the page title, with the item count; no chip per card. A "Select" action starts select mode (below).                                                                                                                                                                                        | `renderer/src/pages/library/library-page.tsx:120-124`                                                                    |
| Library card and list row       | A new "⋯" button next to Tags, Edit and Delete, opening a menu with "Move to ▸" and the other workspaces.                                                                                                                                                                                                         | `video-card.tsx:95-115`, `video-row.tsx:98-115`                                                                          |
| Item page                       | "Workspace: Work" in the metadata line; "Move to…" in the action row.                                                                                                                                                                                                                                             | `library-detail-page.tsx:271`, `:345-400`                                                                                |
| Video editor, screenshot editor | A "Work ▾" chip whose menu lists the move targets. After a move: the editor flushes, the move runs, the editor returns to the Library, and a toast reads "Moved to Personal · Switch". During a move the editor is read-only.                                                                                     | `pages/video-editor/`, `pages/screenshot-editor/`                                                                        |
| Export sheet                    | "Saves to Work".                                                                                                                                                                                                                                                                                                  | `renderer/src/features/video-editor/components/export-sheet.tsx`                                                         |
| Record page                     | The idle heading "Ready to record" is **replaced** by "Recording to Work" with a "Switch" action beside it (the eyebrow and subtitle stay). Switch opens the workspace list (with one workspace: that workspace and "Add workspace") and **changes the active workspace**; it is not a destination for this take. | `record-page.tsx:254`, `record.readyToRecord` in `en.json:283` and `es.json:283`, `record-page.test.tsx:191`             |
| Recording control bar           | "● Work", hidden while `showBarInRecording` is on, so the name never appears in the video.                                                                                                                                                                                                                        | `renderer/src/features/control-bar/control-bar.tsx`                                                                      |
| Capture panel, capture overlay  | "Saving to Work".                                                                                                                                                                                                                                                                                                 | `renderer/src/features/capture-panel/capture-panel.tsx`, `renderer/src/features/screenshots/overlay/capture-overlay.tsx` |
| Capture toast                   | "Saved to Work", "Save to Work", "Also saved to Work" instead of "…Library". **A label only, no move control.**                                                                                                                                                                                                   | `main/screenshots/capture-toast-window.ts`, `packages/i18n/messages/en.json:755-764`                                     |
| Item page lineage line          | "Source recording is not in this workspace" instead of "Source recording was deleted" (decision 21).                                                                                                                                                                                                              | `library-detail-page.tsx:331-340`, `en.json:720`                                                                         |

**States of "Move to".**

- **Target not connected**: the entry is disabled with "Not connected".
- **Blocked during a write** (recording, export, save, move, download): every entry is disabled
  with the reason ("Finish the recording to move").
- **Cloud-only item**: the move only reassigns the workspace on the server
  (`PUT /assets/{assetId}/workspace`) and moves the small files (ADR 0033, decision 10).
  Offline it is disabled with "Connect to move a cloud-only item".
- **Dragged less than 10 s ago**: refused with "Finish dropping the file, then try again".
- **Exports of the recording** (decision 21): the move dialog says "This recording has 2
  exports in Work. Move them too?" with **Move all 3** (primary) and **Move only the
  recording**. The count comes from the already loaded local list by `derivedFromAssetId`, in the
  source workspace; no new lookup. Moving an export on its own offers nothing. "Move all" moves
  the recording first and then each export, each as a single move (ADR 0033, decision 14).
- **Synced and evicted**: disabled with "Download it first".

The **move dialog** appears when copying across volumes or with a synced side (it shows the
size to copy), or when the recording has exports (decision 21). A progress row shows during a
copy.

**Select mode and group move (decisions 20–21).** The Library has no selection model today, so
this is the minimal one:

- A "Select" action in the header starts **select mode**. Cards and rows show a checkbox;
  clicking an item toggles it. **Shift-click** selects the range from the last clicked item to
  the clicked one, in the order on screen. Items that cannot move (evicted, dragged under 10 s
  ago) have a disabled checkbox with the reason.
- A **bottom bar** shows "N selected · Move to ▸" with the other workspaces (or "New
  workspace…"), and a Done action. Changing the search, a chip or the sort clears the selection,
  so the user never moves items they cannot see. A workspace switch leaves select mode.
- Choosing a target opens one dialog: the size to copy when it applies, and the exports
  suggestion for the selected recordings ("3 of these recordings have 5 exports in Work. Move
  them too?" with "Move all 17" and "Move only the 12 selected"). An export that is also selected
  counts once.
- The moves run **one after another** through `workspaces:move-items`, each a single move under
  ADR 0033's rules, with an aggregate progress ("Moving 3 of 12") and a Stop action. Stop lets
  the move in flight finish and starts no further one. The switch lock holds for the whole
  group.
- **A failure does not stop the rest.** At the end the bar becomes a result: "Moved 10 of 12 to
  Personal. 2 stayed in Work" with the list "<title> — <reason>" (target not connected, not
  enough room, evicted, dragged just now, checksum mismatch, a collision with the same
  `assetId`). The failed items stay in the source and stay selected, so a retry is one click.
- A crash mid-group: the item in flight is healed by the journal (exactly one listed copy), the
  items not yet started were never touched, and the group does not resume. The user selects the
  rest again.

The **delete confirmation** names what is lost: titles, tags, edit projects, cursor tracks
(auto-zoom), setting overrides and the cloud link. It also says what stays: every recording
and screenshot file.

**Library filters (decision 18).** Every existing filter stays, computed over the active
workspace's items only, with nothing added or removed: search (title and tags), sort (Newest,
Oldest, Largest), grid/list, kind chips with counts, storage chips with counts, tag chips
with counts, the tag drawer, and the "filtered by" summary line (`library-filters.ts`,
`library-page.tsx`). The switch clears the list queries (transaction step 2). The filter state
itself (selected tags, search, select mode and its selection) resets on switch, because tag ids
are per workspace.

### Delete and remove, in detail

- **Remove from list**: refused for the active and the last workspace. It drops the entry and
  touches no file. The workspace's cloud entries become orphan (hidden) until the folder is
  added again, which restores them under the same id. The machine-bound `uploadMode` entry is
  kept for that case.
- **Delete workspace**: refused for the active workspace and while busy. It first runs the
  stranded-take recovery for that folder, so a half-saved take becomes a media file and stays.
  Then it calls `shell.trashItem(<root>/.kaipu)`. If that rejects (a network volume with no
  Trash), nothing is removed and the message says so. On success, it removes the entry, its
  machine-bound settings and its scratch folder. Its cloud entries are orphaned for good: hidden in every Library
  and listed in Settings → Workspaces with "Assign to workspace…" (decision 23). Adding the folder again later creates a new workspace whose items get new
  `assetId`s. In a synced workspace the provider decides what happens to the trashed
  `.kaipu/` in the cloud (TidBITS: Dropbox deletes online-only files without the Mac Trash,
  Google Drive uses it), so the confirmation says the provider's trash applies.

## State of the art

- **Obsidian vaults**: each vault is a folder with its own `.obsidian/` config, and the app
  keeps the list of known vaults outside them. The vault switcher opens one vault per window,
  and there is no cross-vault view. Moving notes between vaults is a manual file move that
  loses links, a common complaint
  ([forum](https://forum.obsidian.md/t/how-can-i-move-folders-between-vaults/41151)).
  Moving a vault across drives fails with `EXDEV` when the app only tries `rename`
  ([forum](https://forum.obsidian.md/t/fail-to-move-vault-across-devices-drives-fix-exdev-error/115346)),
  which is why ADR 0033 copies, verifies and then deletes. Its settings are fully per vault, and
  sharing them across vaults is a long-running request
  ([forum](https://forum.obsidian.md/t/option-to-sync-settings-themes-and-plugins-across-multiple-vaults/41789)),
  which is why ADR 0034 inherits instead.
- **VS Code** User and Workspace settings: a workspace value overrides the user value, and the
  editor shows where each value comes from
  ([VS Code](https://code.visualstudio.com/docs/configure/settings)). ADR 0034 takes this
  model.
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
- **macOS File Provider** (Google Drive, OneDrive, iCloud Drive): see
  [Synced folders](#synced-folders) for the sources and what they do not say.
- Hub: [library vault](https://github.com/csdev19/general-knowledge/blob/main/desktop/library-vault.md)
  describes the single-vault layout. It needs a short note about workspaces once they are
  implemented, not before.
