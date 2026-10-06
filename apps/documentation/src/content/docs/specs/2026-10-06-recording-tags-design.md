---
title: Recording tags — label recordings and filter the library by them
description: Design for free-form tags on recordings (e.g. kaipu, cricut, issue-#1232), stored in the recording's local sidecar and replicated to the cloud catalog when cloud is on, behind one tag store the app reads without knowing where data lives.
---

# Recording tags — design

**Status: 🔵 Proposed · 2026-10-06.** Phase 1 (local) can go to the night shift as
`plan-first`; Phase 2 (cloud) waits for the optional-cloud catalog endpoints.

## Summary (one minute)

A recording can carry any number of short **tags** — `kaipu`, `cricut`, `issue-#1232`,
`video` — and the library filters by them. Tags are plain normalized strings, not a
managed taxonomy: no tag table to administer, no rename screen. Locally they live in the
recording's existing sidecar `.kaipu/<id>.json`, the same file that already holds its title,
so they travel with the vault folder. When cloud is on, the same tags are replicated to the
cloud catalog (a `tags` column on `cloud_asset`), so a cloud-only item can be filtered too.
The app talks to one `TagStore`; a provider picks the local adapter, or a replicating store
(local first, then cloud), from the user's cloud setting. Builders normalize every tag
before any adapter sees it.

| #   | Decision                                                                                                 | Why                                                                                                                          | ADR        |
| --- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Tags are normalized strings on the recording (`tags: string[]`), not a separate tag entity.              | Owner: "doesn't have to be a perfect many-to-many, just easy to filter". The vocabulary is the union of tags in the library. | —          |
| 2   | Local storage = the existing sidecar `.kaipu/<id>.json`, additive field.                                 | "Everything in the same file"; the sidecar already merges partial writes and v1 files keep reading.                          | 0012 (new) |
| 3   | Local is always the source of truth; cloud is a replica when cloud is on. No "cloud-only mode" for tags. | Filesystem-first ADR; works offline; cloud stays the paid network layer.                                                     | 0012 (new) |
| 4   | One `TagStore` port with a local adapter and a cloud adapter; a provider composes them from settings.    | The app must not care where tags come from (owner's builders + adapter request).                                             | 0012 (new) |
| 5   | Cloud: `tags text[]` on `cloud_asset` with a GIN index; filtering by `tags @> ARRAY[...]`.               | Simplest Postgres shape for "has all these tags"; no join table for a feature that has no tag-level data.                    | —          |
| 6   | Filter semantics: selected tags combine with **AND**; the search box also matches tags.                  | Narrowing ("cricut" + "issue-#1232") is the common case; OR can come later.                                                  | —          |
| 7   | Conflicts: last writer wins per recording, using `tagsUpdatedAt`.                                        | Tags are low-stakes and edited by one person; merging sets would resurrect deleted tags.                                     | —          |

### Open questions

1. Should tags also apply to **screenshots** (`.png` items)? Default: yes, same sidecar,
   same code path.
2. Should the cloud catalog accept tags for assets whose local copy is gone (cloud-only edit)?
   Default: yes in Phase 2, since the replica must reconstruct cloud-only items.

### Out of scope

Tag colors, renaming a tag across the library, tag hierarchies, sharing tag vocabularies
between users or teams, smart/automatic tags, OR filters, a tag manager screen.

### Failures this must protect against

- A tag write that rewrites the sidecar and drops `title`, `assetId` or hash fields (must
  merge, never replace).
- Two spellings of one tag (`Cricut`, `cricut`) showing as two chips.
- A tag edit lost when cloud is on but offline (local must succeed and the replica retry).
- The cloud replica overwriting a newer local edit (or the reverse) on reconnect.
- A tag containing a path separator or control character reaching the file system or a query.
- Filtering that hides items with no sidecar (they have no tags; they must still show when no
  tag is selected).

---

## Current state (verified on `main`, 2026-10-06)

- `main/library/library-vault.ts`: media files are discovered in the vault; per-item metadata
  lives in `.kaipu/<id>.json` (`Sidecar`, `sidecarVersion` 1 | 2, every field optional).
  `writeMeta(id, patch)` merges a patch; `rename()` uses it for `title`.
- `renderer/src/features/library/library-filters.ts`: a client-side filter layer
  (`FilterCriteria`, `selectVisibleVideos`) over the merged local + cloud list, as designed in
  [Library filter chips](/features/library-filter-chips/).
- `packages/infra-db/src/schema/cloud.ts`: `cloudAssetTable` is the cloud catalog row per
  asset. Its HTTP routes are not served yet ([optional cloud](/backlog/optional-cloud/)).

## Model

```ts
// @kaipu/domain — pure, shared by desktop and server
export const TAG_MAX_LENGTH = 32;
export const TAGS_PER_ITEM_MAX = 20;
/** Lowercase letters, digits and - _ # . — nothing else after normalization. */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9\-_#.]*$/;

export function normalizeTag(raw: string): string | null; // trim, lowercase, spaces → "-", collapse "-", validate
export class TagSetBuilder {
  add(raw: string): this; // ignores invalid, dedupes, keeps insertion order
  remove(tag: string): this;
  build(): readonly string[]; // throws past TAGS_PER_ITEM_MAX
}
```

`TagSetBuilder` is the only way a tag list reaches a store. Examples: `" Cricut "` →
`cricut`; `"Issue #1232"` → `issue-#1232`; `"../x"` → rejected.

## Ports and adapters

```ts
// desktop, shared between main and renderer through IPC types
interface TagStore {
  get(itemId: string): Promise<readonly string[]>;
  set(itemId: string, tags: readonly string[], updatedAt: number): Promise<void>;
  vocabulary(): Promise<readonly { tag: string; count: number }[]>; // for autocomplete and chips
}
```

| Adapter              | Where                      | Behaviour                                                                                                                                                                                                                                                  |
| -------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SidecarTagStore`    | main process, `library/`   | Reads/writes `tags` and `tagsUpdatedAt` in `.kaipu/<id>.json` through `writeMeta` (merge). `vocabulary()` folds the sidecars the vault already scans.                                                                                                      |
| `CloudTagStore`      | main process, cloud client | `PUT /assets/:assetId/tags` and tags in the catalog listing. Phase 2.                                                                                                                                                                                      |
| `ReplicatedTagStore` | main process               | `set` writes the sidecar first, then queues the cloud write and retries it while offline (Phase 2 decides whether the upload transfer queue can carry it or a small outbox file is needed). `get` reads local, falling back to cloud for cloud-only items. |
| `TagStoreProvider`   | main process wiring        | Returns `SidecarTagStore` when cloud is off, `ReplicatedTagStore` when it is on. Re-evaluated when the cloud setting changes.                                                                                                                              |

The renderer never sees which adapter runs: it calls `library:setTags` / `library:getTagVocabulary`
over IPC and receives tags on each `LibraryVideo` like any other field.

## Cloud (Phase 2)

- Migration: `cloud_asset.tags text[] not null default '{}'`, `tags_updated_at timestamptz`,
  GIN index on `tags`.
- Use cases in `packages/application`: `setAssetTags` (validates with the domain builder,
  last-writer-wins on `tagsUpdatedAt`) and a `tags` filter on the catalog listing.
- oRPC routes in `apps/server-hono`, auth-gated like the other cloud routes.

## UI

- **Library filter bar**: tag chips after the storage and kind chips, ordered by count; a
  "+N" overflow opens the full list. Selecting several tags narrows (AND).
- **Search box**: matches title or any tag.
- **Item**: a tag field in the item's detail / rename dialog — type and press Enter or
  comma, autocomplete from `vocabulary()`, backspace removes the last chip.
- **Card**: up to two tags shown on hover, with the rest as "+N".

## Phases

1. **Local** (`plan-first` night shift): domain builder + tests, `SidecarTagStore`, IPC,
   `FilterCriteria.tags`, filter chips, tag editor, search match.
2. **Cloud**: migration, use cases, routes, `CloudTagStore`, `ReplicatedTagStore`, provider
   switch. Starts after the optional-cloud catalog routes are served.

## Acceptance (Phase 1)

- [ ] Add `Cricut`, `issue #1232`, `video` to a recording: sidecar holds
      `["cricut","issue-#1232","video"]`; `title` and hash fields unchanged.
- [ ] Library chip "cricut" + "video" shows only recordings with both.
- [ ] Search "1232" finds the recording.
- [ ] A recording without a sidecar still lists with no tag selected.
- [ ] Unit tests for `normalizeTag`, `TagSetBuilder`, `SidecarTagStore` merge, and filter
      selection with tags.

## References

- [unstorage drivers](https://unstorage.unjs.io/drivers) — one API, swappable storage
  drivers; the pattern this design applies to tags.
- [PostgreSQL array operators and GIN indexes](https://www.postgresql.org/docs/current/gin-builtin-opclasses.html)
- [Filesystem-first architecture and monetization](/desktop/filesystem-first-monetization/)
- [Cloud — identity, revisions and the relationship with .kaipu](/specs/2026-09-09-cloud-data-model/)
