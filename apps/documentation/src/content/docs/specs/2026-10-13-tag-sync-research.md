---
title: Tags and sync — research
description: How established apps model and sync user tags, which sync strategies fit a small single-user dataset, how conflicts and the local-to-account upgrade are handled, and an audit of PR #245 against the result. Input to the tags-as-entities design.
---

# Tags and sync — research

**Date:** 2026-10-13. **Feeds:** [Tags as entities — design](/specs/2026-10-13-tags-as-entities-design/).
Items marked _(unverified)_ come from background knowledge and were not confirmed by a source.

## 1. How established apps model tags

| App               | Where tags live                                                                                                                                | Identity       | Rename                                                                                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS Finder      | Per file, in the `com.apple.metadata:_kMDItemUserTags` extended attribute (name + color index 0–7); travels through iCloud Drive with the file | Name           | Rewrites every file ([eclecticlight 2017](https://eclecticlight.co/2017/12/27/xattr-com-apple-metadata_kmditemusertags-finder-tags/), [2024](https://eclecticlight.co/2024/12/24/solving-finder-tag-problems/))                                   |
| Obsidian          | Text in each note (frontmatter or inline); no registry; sync copies files                                                                      | Name           | Bulk rewrite by plugins, with snapshot/undo because it is risky ([Bulk Tag Manager](https://community.obsidian.md/plugins/bulk-tag-manager), [forum](https://forum.obsidian.md/t/rename-and-delete-tags/567?page=2))                              |
| Bear              | In notes, synced over CloudKit                                                                                                                 | Name           | Rewrites all notes; a recent report of renames corrupting locked notes ([FAQ](https://bear.app/faq/rename-and-delete-tags/), [bug](https://community.bear.app/t/data-loss-renaming-tags-via-mcp-corrupts-locked-notes-attachments-deleted/19619)) |
| Eagle             | `tags: string[]` in each item's `<id>.info/metadata.json`, plus a library-level metadata file — the closest to Kaipu's sidecars                | Name           | — ([importer](https://community.obsidian.md/plugins/eaglepack-importer), [API types](https://pkg.go.dev/github.com/eissar/nest@v0.0.5/api))                                                                                                       |
| Lightroom Classic | The catalog keyword list is the truth; XMP sidecars get names only when written out                                                            | Catalog record | In the catalog ([Adobe](https://helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/keywords.html))                                                                                                                    |
| Linear            | Labels are entities: `issueLabelUpdate(id, {name, color})`, retire/restore as soft delete; issues hold `labelIds`                              | Id             | One write ([API docs](https://www.withone.ai/knowledge/linear/conn_mod_def%3A%3AGJ4vKITEZV4%3A%3AGv0WKftXQU-2r3Xw5ZxYtw/md))                                                                                                                      |
| Notion, Raindrop  | Central registry _(unverified)_                                                                                                                | Id             | One write                                                                                                                                                                                                                                         |

**Pattern.** File-centric apps key tags by name and pay for it on every rename. Apps that
sync through a server keep a registry with stable ids. Kaipu wants standalone tags, colors
and cheap renames, so it needs the registry. Keeping the name in the sidecar as a cached
copy keeps the files readable without making the name the identity.

## 2. Sync strategies

- **Change feed with a cursor.** Linear's client sends the last `syncId` it applied and gets
  the ordered changes since ([Linear blog](https://linear.app/blog/rebuilding-delta-sync-read-path),
  [reverse-engineering study](https://docsearch.algolia.com/mcp/docs/repo/wzhudev/reverse-linear-sync-engine)).
- **Replicache "global version"** — its recommended starting strategy: one counter
  incremented on every push, a `lastModifiedVersion` on each row, the counter returned as the
  pull cookie, and per-client mutation ids so a retried push is applied once. Limit around 50
  pushes per second app-wide, irrelevant for one user. The docs warn against wall-clock time
  as the version ([global version](https://doc.replicache.dev/strategies/global-version)).
  "Reset" (send everything) is an accepted fallback for tiny datasets
  ([strategies](https://doc.replicache.dev/strategies/overview)).
- **Things Cloud** pushes a change to its server, which sends an APNs wake-up; devices then
  fetch the changes ([Nimbus](https://culturedcode.com/things/blog/2015/08/things-cloud-nimbus-released/)).
  The notification is separate from the data, so realtime can be added later.
- **Fixed-interval polling** is either stale or wasteful. Pull on start/focus plus push on
  change covers one user with a few devices.
- **CRDTs (Automerge, Yjs)** target documents edited concurrently. Whole tag records are
  better served by per-field last-writer-wins.

## 3. Conflicts

- **Ordering.** Use a hybrid logical clock or let the server order writes. A raw wall clock
  set in the future "wins" until real time catches up
  ([oneuptime](https://oneuptime.com/blog/post/2026-01-30-last-write-wins/markdown),
  [CRDTs for Mortals notes](https://www.dev.to/dimfeld/reading-the-crdts-for-mortals-example-code-2pb),
  [Shapiro et al.](https://www.lip6.fr/Marc.Shapiro/papers/CRDTs-Springer2018-authorversion.pdf)).
- **Rename or recolor.** Last-writer-wins per field. With id identity a rename never touches
  items.
- **Delete.** A tombstone (`deletedAt`); otherwise a stale device re-uploads the tag.
- **An item's tag set.** Membership rows `(itemId, tagId, deletedAt)` — effectively an
  add-wins set — so two devices adding different tags both survive. A whole-array
  last-writer-wins drops one.
- **Same name created on two devices.** Merge by normalized name on first sync and remap ids.

## 4. Upgrading a local user to an account

Firebase's anonymous-to-account flow: read local data, sign in, merge, handle the account
already existing ([docs](https://firebase.google.com/docs/auth/web/account-linking)). A
FirebaseUI discussion argues for migrating data before switching identity so a failure midway
cannot strand the user ([#851](https://github.com/firebase/FirebaseUI-iOS/issues/851)). With
client-generated UUIDs and local writes already flowing through an outbox, the upgrade is the
first push of the whole state; the only merge rule is the same-name dedupe.

## 5. Sync engines and libraries

| Option                                                                                     | Shape                                                                                                                                     | Fit for Kaipu tags                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PowerSync](https://powersync.com/blog/electricsql-electric-next-vs-powersync)             | Postgres → SQLite on the client, offline-first, upload queue                                                                              | Most mature for offline (vendor comparison). Adds a service to run, and its SQLite would compete with the vault as source of truth                                                                              |
| Electric ("Electric Next")                                                                 | Postgres read-path sync via shapes; used as a reactivity/sync engine under TanStack DB                                                    | Read sync is the core; writes go through your own API. Interesting to learn with TanStack DB. Rebranding toward agent state ([DevToolLab](https://devtoollab.com/blog/local-first-apps-crdt-sync-engine-guide)) |
| Zero (Rocicorp)                                                                            | Successor to Replicache                                                                                                                   | Had stated offline writes out of scope (2025, may be outdated)                                                                                                                                                  |
| [TinyBase](https://tinybase.org/api/the-essentials/synchronizing-stores/) `MergeableStore` | HLC-based store, syncs through a Cloudflare Durable Object ([guide](https://tinybase.org/guides/integrations/cloudflare-durable-objects)) | Fits the Workers stack, but would replace Postgres as the tags' source of truth                                                                                                                                 |
| Automerge / Yjs                                                                            | CRDT documents                                                                                                                            | Overkill for records                                                                                                                                                                                            |

For tens to hundreds of tags, each adds more lock-in and operational surface than a
hand-written version-cursor sync (estimated around 300 lines). **Strongest argument against
hand-rolling:** idempotent retries, tombstone garbage collection, id remaps and
sidecar/registry drift are exactly what these engines already solve. The design keeps them as
evaluated alternatives with a reopen condition, and a separate learning spike
(Electric + TanStack DB on tags, outside production).

## Audit of PR #245

Checked on `night/niw2-154-recording-tags` at `0ca78f1`.

| #   | Finding                                                                                                                                                                                  | Severity                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | A tag is a plain string on each item: no id, no color, cannot exist without items.                                                                                                       | Blocks colors and "create tag"     |
| 2   | Rename/delete rewrite every sidecar one by one; a failure midway leaves mixed names, and a rename cannot be reconciled across devices because the name is the identity.                  | High once sync exists              |
| 3   | The provider has only the local adapter: no cloud adapter, outbox or sync.                                                                                                               | Phase 2 gap                        |
| 4   | `setTags` refuses items without local media, so cloud-only items cannot be tagged (the earlier spec's open question 2 said they should).                                                 | Medium; fixed by the cloud adapter |
| 5   | Conflicts would be ordered by `Date.now()`; a skewed clock wins.                                                                                                                         | Medium once sync exists            |
| 6   | An item's tags are one array, last writer wins: concurrent additions on two devices lose one.                                                                                            | Medium once sync exists            |
| —   | `localStorage` is **not** used by any tag code: the path is renderer → IPC → `TagStore` port → sidecar adapter. It exists elsewhere in the app (onboarding flag, dev storage simulator). | Note                               |
