---
title: Tags as entities — colored tags with stable ids, local-first with optional cloud sync
description: Design for turning recording tags from plain strings into entities (UUID, name, slug, color) kept in a registry inside the vault, behind one tag repository, with an opt-in "sync tags" switch that replicates them to Kaipu Cloud on events, never on a timer.
---

# Tags as entities — design

**Status: 🔵 Proposed · 2026-10-13.** Supersedes the data model of the
[recording tags design](/specs/2026-10-06-recording-tags-design/) (PR #241) where they differ.
Phase 1b reworks PR #245 before it merges; Phase 2 adds cloud sync.

## Summary (one minute)

Tags become **entities**. Each tag has a stable **UUID**, a display **name** (`Archivos
varios`), a lowercase **slug** derived from the name (`#archivos_varios`) and a **color** from
a small, curated palette. A tag can exist with no items, so it can be created on its own.
Items point at tags by id, so renaming or recoloring a tag is one write, never a rewrite of
every recording. Locally the tags live in a **registry file inside the vault**
(`.kaipu/tags.json`), next to the sidecars, so they travel with the folder like an Obsidian
vault. The app talks to one **`TagRepository`** port and never knows where tags live. A
signed-in user can turn on **"Sync tags with Kaipu Cloud"**, a switch of its own (videos get
a separate one). When on, every change is written locally first, queued in an outbox, pushed
at once, and pulled back **on events** — app start, window focus, opening the Library,
sign-in, and the Sync button — using a server-assigned version cursor. There is no timer.
Turning sync on for the first time _is_ the local-to-cloud upgrade: the first push sends
everything. For the user it is just "tags": colorful, fast, and the same with or without an
account.

| #   | Decision                                                                                                                                            | Why                                                                                                                                                         | ADR                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | A tag is an entity: `id` (UUID v7), `name`, `slug`, `color`, timestamps, tombstone. Items store tag **ids**.                                        | Colors, standalone tags and cheap renames all need an identity that is not the name. UUIDs can be minted on any device, offline, without colliding.         | 0020 (new, supersedes 0012) |
| 2   | `name` is unique case-insensitively; `slug` is the lowercase, `_`-joined form of the name and changes with it. Identity is only the `id`.           | Owner: "no repeated names; the name can have capitals, the slug can't". The slug is for typing and search (`#archivos_varios`); it is not a key.            | 0020                        |
| 3   | The local registry is `.kaipu/tags.json` inside the vault. Sidecars keep `tagIds` plus a denormalized `tagNames` copy for humans and other tools.   | Filesystem-first: the vault is the product and must be self-describing when copied or moved. The name copy keeps the sidecar readable; the id is the truth. | 0020                        |
| 4   | One `TagRepository` port (list, create, rename, recolor, delete, assign). Adapters: local registry; cloud. A provider composes them from settings.  | The app must not care where tags come from. Reuses the existing `TagStore` / `TagStoreProvider` seam from Phase 1.                                          | 0020                        |
| 5   | Cloud sync is an opt-in, per-domain switch: **Sync tags**. Off until the user turns it on. Videos get their own switch.                             | Local first; nothing leaves the machine unasked. Owner: "the option must be atomic: only tags; there will be another one for videos".                       | 0021 (new)                  |
| 6   | Sync is event-driven: pull on start, focus, Library open, sign-in and the Sync button; push on every change through an outbox. No polling.          | Owner: "no phantom call every 5 minutes". Same pattern the cloud catalog already uses (`refreshCloudCatalog`).                                              | 0021                        |
| 7   | Ordering comes from a server-side global version (cursor). Tag fields merge last-writer-wins by server order; deletes are tombstones.               | Wall clocks lie (a skewed device wins forever). A server counter is the documented starting point for small single-user data (Replicache "global version"). | 0021                        |
| 8   | Item ↔ tag membership is rows `(itemId, tagId, deletedAt)`, merged add-wins — not a whole-array last-writer-wins.                                   | Adding `demo` on one Mac and `bug` on another must keep both. The Phase 1 rule (LWW per item) silently drops one.                                           | 0021                        |
| 9   | Upgrade = first push of the whole registry. If the account already has a tag with the same slug, the two merge and ids are remapped.                | "Going from local to cloud should just be an update." UUIDs never collide; same-name tags from two devices are the only real merge.                         | 0021                        |
| 10  | Traceability: each tag and membership records `createdOn` / `updatedOn` (device id) and a sync state (`pending` / `synced`). No change history yet. | Owner: clarity "as a system" about where each tag came from, invisible to the user. A history log (option b) waits until it is needed.                      | —                           |
| 11  | Fun by default: a 10-color palette tuned for the dark UI; a new tag gets the next unused color; a mini color menu changes it.                       | Owner: "tags must be fun". A fixed palette keeps every pair readable on cards, chips and the drawer.                                                        | —                           |
| 12  | Hand-rolled sync now; PowerSync / Electric (TanStack DB) are evaluated alternatives with a reopen condition, plus a learning spike ticket.          | Tens of tags do not justify a sync service. The owner wants to learn sync engines; a spike does that without putting one in production.                     | 0021                        |

### Open questions

None blocking. Decided on 2026-10-13 with the owner; see Sources.

### Out of scope

Tag hierarchies, sharing tags between users or teams, automatic tagging, emoji per tag, a
change-history log (decision 10, option b), tagging cloud-only items (Phase 2), syncing
videos (its own switch and design), several vaults at once (separate ticket).

### Failures this must protect against

- Two tags whose names differ only in case (`Demo`, `demo`) — must be refused, locally and on
  first sync (merge).
- A rename that leaves some items showing the old name (rename must touch only the registry).
- A sidecar pointing at a tag id the registry no longer has (deleted on another device, or
  the vault copied without `tags.json`) — the item must still render, with the cached name
  greyed, and heal on the next pull.
- `tags.json` truncated by a crash mid-write (atomic temp + rename, as sidecars).
- An edit made offline lost on reconnect, or applied twice after a retry (outbox entries are
  idempotent: client mutation id).
- A device with a wrong clock overriding newer edits (order comes from the server version).
- A deleted tag coming back from a device that was offline (tombstones).
- Two devices adding different tags to the same item; one addition disappearing (add-wins rows).
- Turning sync on when the account already has tags from another Mac: duplicates by slug.
- Sync switched off: no network call for tags at all, ever.

---

## Current state (verified on `night/niw2-154-recording-tags`, 2026-10-13)

PR #245 implements Phase 1 of the earlier design:

- `TagStore` port, `SidecarTagStore` adapter and `TagStoreProvider` in
  `apps/kaipu-record/src/main/library/tag-store.ts`. The renderer reaches it only through IPC
  (`setTags`, `getTagVocabulary`, `renameTag`, `deleteTag`). No tag code uses `localStorage`.
- Tags are `tags: string[]` in each sidecar. The vocabulary is folded from every sidecar.
- Rename and delete rewrite every sidecar that carries the tag, one by one.
- `setTags` refuses ids that are not a vault item with media (added 2026-10-13), which also
  refuses cloud-only items.
- The Library has a tag drawer (this item / all tags), tag chips on cards and rows.

Gaps against this design: no identity or color (1), renames are N writes and not reconcilable
across devices (2), no cloud adapter or outbox (3), conflicts use `Date.now()` (5) and
whole-array last-writer-wins (6). The audit is in the
[research page](/specs/2026-10-13-tag-sync-research/#audit-of-pr-245).

## Data model

### Local registry — `<vault>/.kaipu/tags.json`

```json
{
  "version": 1,
  "deviceId": "d-3b1e…",
  "cursor": 0,
  "tags": [
    {
      "id": "01925c9e-…",
      "name": "Archivos varios",
      "slug": "archivos_varios",
      "color": "lagoon",
      "createdAt": 1760360000000,
      "updatedAt": 1760360000000,
      "createdOn": "d-3b1e…",
      "updatedOn": "d-3b1e…",
      "deletedAt": null,
      "sync": "pending"
    }
  ]
}
```

- Written atomically (temp + rename). One writer: the main process.
- `cursor` is the last server version applied (0 = never synced).
- `deviceId` is minted once per machine and stored in `userData`, copied here for traceability.

### Sidecar — `<vault>/.kaipu/<itemId>.json`

```json
{ "tagIds": ["01925c9e-…"], "tagNames": ["Archivos varios"], "tagsUpdatedAt": 1760360000000 }
```

`tagNames` is a cache rewritten lazily (on the next write of that sidecar, or by a
background "refresh names" pass after a rename). Readers resolve names from the registry and
fall back to `tagNames` only when an id is unknown.

### Slug

`slug = lowercase(name)`, Unicode-normalized (NFKC), whitespace and separators collapsed to
`_`, characters outside letters, digits, `_`, `-`, `#` dropped, max 32. Uniqueness is
enforced on the slug (which makes names unique case-insensitively). Typing `#arch` in any tag
field matches by slug.

### Palette

Ten named colors (`rose`, `coral`, `amber`, `lime`, `mint`, `lagoon`, `sky`, `iris`,
`orchid`, `slate`), each with a fill, a border and a text token that pass WCAG AA on
`--bg-card` in dark and light themes. Stored by name, never hex, so the palette can be retuned
without migrating data. New tags take the least used color.

### Cloud (Phase 2)

- `tag (user_id, id uuid, name, slug, color, created_on, updated_on, deleted_at, version bigint)`
  with `unique (user_id, slug) where deleted_at is null`.
- `asset_tag (user_id, asset_id, tag_id, deleted_at, version bigint)`, primary key
  `(asset_id, tag_id)`.
- `sync_version (user_id, version bigint)` — the per-user global counter, incremented in the
  same transaction as each push.
- `client_mutation (user_id, client_id, last_mutation_id)` — idempotent retries.

## The port

```ts
// illustrative — the shape, not the final code
interface TagRepository {
  list(): Promise<Tag[]>;                       // live tags, with counts
  create(name: string, color?: TagColor): Promise<Tag>;
  rename(id: TagId, name: string): Promise<Tag>;
  recolor(id: TagId, color: TagColor): Promise<Tag>;
  remove(id: TagId): Promise<void>;             // tombstone + unassign everywhere
  assign(itemId: string, tagIds: TagId[]): Promise<TagId[]>;
}
```

| Adapter                 | Where              | Does                                                                                                 |
| ----------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `VaultTagRepository`    | main, local        | Reads/writes `tags.json` and sidecar `tagIds`. Always present.                                       |
| `CloudTagSync`          | main, cloud client | Outbox push, cursor pull, apply remote changes into the vault adapter. Present only when sync is on. |
| `TagRepositoryProvider` | main wiring        | Returns the vault adapter, wrapped so every write also enqueues an outbox entry when sync is on.     |

The renderer keeps using IPC only. A **parity test suite** runs the same scenarios against
the vault adapter and against vault + a fake cloud, as the hub's
[data-by-access-pattern](https://github.com/csdev19/general-knowledge/blob/main/architecture/data-by-access-pattern.md)
page recommends.

## Sync (Phase 2)

- **Outbox:** `userData/cloud/<userId>/tag-outbox.json`, entries
  `{ mutationId, op, payload }`, appended on every local write while sync is on, removed when
  the server acknowledges. Pushed immediately; on failure retried with backoff on the next
  event.
- **Pull:** `GET /tags/changes?since=<cursor>` returns tags and memberships with
  `version > cursor`, plus the new cursor. Applied into the vault; the server's order wins.
- **Triggers:** app start, window focus (debounced 30 s), Library open, sign-in, Sync button,
  and right after a successful push. Nothing on a timer.
- **First sync (upgrade):** push every local tag and membership; the server merges same-slug
  tags (keeps the older id, returns a remap), the client rewrites `tagIds` with the remap.
- **Switch off:** stops pushing and pulling; local data stays as is.

## Phases

1. **1b — local entities (reworks PR #245 before merge):** `tags.json` registry, `tagIds` in
   sidecars, slug + uniqueness, palette + color menu, "Create tag" in the drawer, colored
   chips everywhere. The Phase 1 string format never ships, so there is no data migration.
2. **2 — cloud:** tables, routes, outbox, cursor pull, the Settings switch, first-sync merge,
   tagging cloud-only items.
3. **Later:** change history (traceability option b), realtime wake-up (WebSocket or Durable
   Object) on top of the same cursor.

## Sources

- Owner decisions, 2026-10-13 (chat): entities with UUID; separate name and slug, unique
  name, lowercase slug; fun colors with a mini menu; registry in the vault ("Obsidian-based");
  traceability option a now, b later; sync as an opt-in switch for tags only; event-driven
  sync plus a Sync button, no polling; keep PowerSync / Electric on the radar and learn sync
  engines.
- Research: [Tags and sync — research](/specs/2026-10-13-tag-sync-research/).
- Supersedes: [ADR 0012](/architecture/decisions/0012-recording-tags-local-first-with-cloud-replica/)
  (PR #241), whose reopen condition — "tags need their own attributes (color, rename)" — is met.
