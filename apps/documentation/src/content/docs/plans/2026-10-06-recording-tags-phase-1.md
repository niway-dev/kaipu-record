---
title: Recording tags Phase 1 — implementation plan
description: Night-shift plan for NIW2-154 — local tags in the recording sidecar, a TagStore behind IPC, and tag filtering, search and editing in the library.
---

# Recording tags Phase 1 — implementation plan

**Status: 🟡 In progress · 2026-10-06.** Implements Phase 1 (local) of
[Recording tags — design](/specs/2026-10-06-recording-tags-design/) (Linear NIW2-154).
The cloud replica is Phase 2 and out of scope.

## Steps

1. **Domain** (`packages/domain/src/constants/tags.ts`): `TAG_MAX_LENGTH` (32),
   `TAGS_PER_ITEM_MAX` (20), `TAG_PATTERN`, `normalizeTag`, `TagSetBuilder`. Tests for the
   spec's examples (`" Cricut "` → `cricut`, `"Issue #1232"` → `issue-#1232`, `"../x"`
   rejected) and the limits.
2. **Vault** (`main/library/library-vault.ts`): `Sidecar` gains `tags` and
   `tagsUpdatedAt`; `describe()` returns `tags` (`[]` without a sidecar). `LocalRecording`
   and `LibraryItem`/`LibraryVideo` carry them.
3. **Store** (`main/library/tag-store.ts`): `TagStore` port, `SidecarTagStore` (writes
   through `writeMeta`, so it merges and never replaces; re-normalizes with the builder;
   `vocabulary()` folds the listed items), and `TagStoreProvider` (sidecar only in Phase 1).
4. **IPC**: `library:setTags` (local id + tags → stored tags) and
   `library:getTagVocabulary`, through preload and `ElectronAPI`.
5. **Library UI**: `FilterCriteria.tags` (AND), search matches title or any tag, tag chips
   in the filter bar ordered by count, up to two tags on a card plus "+N", and a tag editor
   on the library detail page under the title (Enter or comma adds, Backspace removes the
   last, autocomplete from the vocabulary).
6. **Tests**: domain builder, sidecar merge (title and hash fields survive), filter
   selection with tags (including items without tags), the tag editor.
