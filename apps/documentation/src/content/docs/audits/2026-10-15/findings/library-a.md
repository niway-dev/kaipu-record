---
title: "Library — Lens A (performance, resource leaks, observability)"
description: "Detailed findings from the 2026-10-15 pre-deploy audit: Library — Lens A (performance, resource leaks, observability)."
---

> Part of the [2026-10-15 audit report](/audits/2026-10-15/report/). Paths are relative to `apps/kaipu-record/src/`.

## Summary

The Library is correct but does much more work than it needs, and the cost grows with the number of
vault items (n) on every trigger. Opening one Library-backed page while signed in runs about 4 full
vault scans plus a full paged HTTP catalog fetch. The cloud refresh always broadcasts
`library:changed`, which makes the page list again. On the detail page and Editor home, that second
list swaps the whole page for the "Loading" state, which unmounts the video player. **That swap is
the most visible cause of the "feels slower" complaint, and the scan fan-out behind it is the most
important thing to fix**: one shared library store, a refresh rate limit, and a broadcast only when
the catalog changes. Next come the main-thread `readFileSync` of `preferences.json`, which runs 2n
times per list (measured at about 50 µs per read on this machine, so about 50 ms blocked at n=500),
and full-resolution PNGs used as screenshot thumbnails. None of this work is timed or logged, so
there is currently no way to see list latency or vault size in production.

### Work per trigger

Per-item fs operation costs, read from the code. A "libuv op" is one async request to the
threadpool, and `readFile` counts as about 4 (open, fstat, read, close):

- `describe()` (`main/library/library-vault.ts:130-175`), run in parallel through `Promise.all`:
  - `.mp4`: about 7 ops (1 `access`, 1 `stat`, a sidecar `readFile` of about 4, 1 thumbnail `access`).
  - `.png`: about 8 ops (2 failed extension probes, plus 1 `access`, 1 `stat` and the sidecar read).
  - `.gif`: about 10 ops.
- Edit probes (`main/library/library-service.ts:52-55`) run **serially**:
  - With no session: 2 `access` calls.
  - With a session holding k assets: about 12+k ops, because the meta file is read twice.
- `vaultDirectory()`: 2 **sync** `readFileSync` + `JSON.parse` calls per item inside the serial loop.
- `list-items` therefore costs about 9n libuv ops plus 2n sync reads, plus a read and parse of
  `catalog.json` and two `JSON.stringify` calls over the c catalog entries.
- `tags:list` costs about 7n ops when `tags.json` exists, and about 18n ops plus n sync reads when it
  does not (see LIB-A4).

Only the main window mounts library hooks. Every window receives the broadcast, but only the main
window has listeners, so the window count w is effectively 1. In the table, S = full vault scans and
"HTTP" = sequential catalog pages (ceil(c/100)).

| Trigger                                           | Scans (S)                                                                | ≈ async fs ops, n=100 / n=500 | ≈ sync prefs reads (main thread blocked) | HTTP                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------- | ------------------------------------ |
| Library page mount, signed in, `tags.json` exists | 4 (list + tags, then again after the refresh broadcast)                  | 3,200 / 16,000                | 400 / 2,000 (≈20 / ≈100 ms)              | 1 full catalog                       |
| Same, user never created a tag (no `tags.json`)   | 6, plus 2n serial sidecar reads                                          | 5,400 / 27,000                | 600 / 3,000 (≈30 / ≈150 ms)              | 1                                    |
| Library page mount, signed out                    | 2                                                                        | 1,600 / 8,000                 | 200 / 1,000                              | 0                                    |
| Detail page mount (`useLocalLibrary` + `useTags`) | same as Library mount                                                    | 3,200 / 16,000                | 400 / 2,000                              | 1                                    |
| Editor home or `/editor/video\|image/:id` mount   | 2 list-items (mount + broadcast)                                         | 1,800 / 9,000                 | 400 / 2,000                              | 1                                    |
| Library → detail → back                           | 3 mounts × the row above                                                 | ≈9,600 / 48,000               | ≈1,200 / 6,000                           | 3                                    |
| `setItemTags` (tag an item)                       | list + tags after the broadcast                                          | 1,600 / 8,000                 | 200 / 1,000                              | 0                                    |
| Create, rename or recolor a tag                   | `summary()` scan + broadcast (list + tags) + `use-tags` explicit refresh | 3,000 / 15,000                | 200 / 1,000                              | 0                                    |
| GIF save, remove local copy, vault folder change  | 1 broadcast → list + tags                                                | 1,600 / 8,000                 | 200 / 1,000                              | 0 (+1 refresh for remove-local-copy) |
| Screenshots page: every window `focus`            | 1 (`listLocalRecordings`)                                                | 700 / 3,500                   | 0                                        | 0                                    |
| Poster grid load (all items, no lazy loading)     | 0                                                                        | n `stat` + n streams          | n (thumbnail requests)                   | 0                                    |

Measured on this machine (plain Node, warm page cache, APFS, M5 Pro), using a throwaway script
outside the repo:

- 1,000 `readFileSync` + `JSON.parse` calls of a tiny `preferences.json`: **48-50 ms**.
- 1,000 serial failed `access` calls: 12-14 ms.
- 500 parallel `describe`-like chains: about 19 ms.

So on a local SSD, the sync reads cost more than the async scans. On an external or network vault
(which the product supports), each serial probe costs a network round trip instead of about 12 µs.

How to measure in the app: wrap `LibraryService.list()` and `VaultTagRepository.list()` in
`performance.now()` and log n and the elapsed ms (see LIB-A9). Then open Library, open the detail
page and go back while watching the log.

## Findings

### LIB-A1. Every library page mount runs a full cloud catalog fetch that always broadcasts, so each mount costs about 4 vault scans, and they repeat on every navigation

- Severity: high
- Category: performance
- Confidence: confirmed
- Where: `renderer/src/features/library/hooks/use-local-library.ts:124-134`, `main/library/index.ts:71-75`, `main/library/library-service.ts:70-94`, `renderer/src/features/library/hooks/use-tags.ts:35-38`
- What happens:
  1. A user who is signed in opens Library, a detail page, Editor home, or a video or image in the editor.
  2. Each of those pages mounts its own `useLocalLibrary`. That hook runs `library:list-items` and also `library:refresh-cloud-catalog`.
  3. The refresh fetches every page of `/api/v1/assets` sequentially, rewrites `catalog.json` unconditionally, and on `ok` broadcasts `library:changed`. It does this even when the catalog did not change.
  4. The broadcast re-runs `list-items` in the same hook, and `tags:list` in `useTags`, which is another full scan.
  5. Nothing is cached between pages, so Library → detail → back repeats this 3 times (see the table: about 48k fs ops and about 6k sync reads at n=500, plus 3 HTTP catalog walks).
- Evidence:
  - `refreshCatalog` deduplicates only an in-flight call (`library-service.ts:71`). There is no TTL.
  - `doRefresh` always writes the cache and returns `ok: true` (`:86-94`).
  - The handler broadcasts on any `ok` (`index.ts:73`).
  - There are four separate hook instances: `library-page.tsx:45`, `library-detail-page.tsx:88`, `editor-home-page.tsx:45`, and `editor-routes.tsx:23` and `:96`.
  - In dev, StrictMode doubles the mount effects. The in-flight deduplication absorbs the second refresh but not the second list.
- Fix sketch:
  - Make the library one app-level store or context with a single listener.
  - Rate-limit the cloud refresh (for example, on app start, window focus older than 60 s, sign-in, and manual Sync).
  - Compare the fresh catalog with the cached one, and write and broadcast only on a real change.
- Effort: M

### LIB-A2. Any background re-list replaces the detail page with "Loading", which unmounts and restarts the video player (Editor home blanks the same way)

- Severity: high
- Category: bug
- Confidence: confirmed
- Where: `renderer/src/features/library/hooks/use-local-library.ts:41-43`, `renderer/src/pages/library-detail/library-detail-page.tsx:140-142`, `renderer/src/pages/editor/editor-home-page.tsx:99`
- What happens:
  - `refresh()` sets `isLoading = true` on every call, including calls triggered by `library:changed`. The detail page returns `<div>{t("loading")}</div>` while `isLoading` is true, so the `RecordingPlayer` at `:235` unmounts and later remounts.
  - Cases where this happens to a user who is signed in:
    - The detail page shows. Shortly after, the cloud refresh from LIB-A1 resolves (local list in about 10-100 ms, HTTP in several hundred ms). The broadcast re-lists, the page flashes "Loading", and the video reloads from 0.
    - The same happens when the user tags the item on the detail page (`setItemTags` broadcasts), when Share calls `onSaved → refresh`, or when Remove local copy runs (`refresh` plus the broadcast, so two flashes).
  - Editor home hides its content during every refresh (`{!isLoading && (...)}`).
- Evidence:
  - `setLoading(true)` runs unconditionally at line 42.
  - The early return is at `library-detail-page.tsx:140`.
  - Nothing distinguishes a first load from a re-list.
  - The flash does not happen only if the cloud refresh happens to resolve before the first list. That ordering is unlikely, because the local list is faster than the HTTP call.
- Fix sketch: Keep `isLoading` for the first load only (`videos.length === 0 && !loadedOnce`). Expose a separate `isRefreshing` for the Sync spinner.
- Effort: S

### LIB-A3. `vaultDirectory()` does a sync `readFileSync` + `JSON.parse` 2n times per list, plus once per media request, all on the main thread

- Severity: medium
- Category: performance
- Confidence: confirmed
- Where: `main/library/vault-location.ts:18-24,47-52`, `main/library/library-service.ts:53-54`, `main/library/index.ts:43-45,57-59,64`, `main/media-protocol.ts:95-100`, `main/library/tag-repository.ts:55,87-105`
- What happens:
  - `service.list()` calls `this.deps.vaultDir()` twice per item inside the serial loop. Each call does `readFileSync(preferences.json)` plus `JSON.parse`, blocking the main process.
  - Every `kaipu-media://` request (one per poster, and one per Range chunk while a video plays) calls `currentVault()` or `thumbnailFilePath()`, and both re-read the file.
  - `importLegacy` calls `this.vault()` per item (LIB-A4).
  - Measured cost here: about 50 µs per read, so at n=500 one `list-items` blocks main for about 50 ms, and a Library mount for 100-150 ms.
  - While main is blocked, IPC from every window waits, including the control bar and capture panel.
- Evidence:
  - The only writers of `preferences.json` are `setVaultDirectory` and `resetVaultDirectory` in the same module, so an in-memory cache can be invalidated exactly.
  - There is no memoization anywhere.
- Fix sketch:
  - Cache the parsed preferences in a module variable, set it in `write()`, and read it lazily once.
  - Resolve `vaultDir` once at the top of `list()`.
- Effort: S

### LIB-A4. Without `tags.json` (every user who never created a tag), each `tags:list` re-runs the legacy import, which adds another full scan and n serial sidecar reads

- Severity: medium
- Category: performance
- Confidence: confirmed
- Where: `main/library/tag-repository.ts:65-72,86-113,148-152`
- What happens:
  1. `read()` falls back to `importLegacy()` when `tags.json` is missing.
  2. `importLegacy` runs `vault().list()` (a full scan), then reads every sidecar again **serially**, calling `this.vault()` (a sync prefs read) for each one.
  3. When no legacy tags exist, `tags` is empty and nothing is written (`:111`), so the next `tags:list` runs the whole import again.
  4. `list()` then runs its own `vault().list()` for the counts.
  - Result: each `tags:list` costs about 2 scans plus n serial `readFile` calls plus n sync reads. That is about 18n ops instead of 7n, on every mount and on every broadcast.
- Evidence:
  - Nothing else creates `tags.json`; it is only written by `write()`, from `create`, `rename`, `recolor`, `remove` and `importLegacy`, and `importLegacy` writes only when it finds tags.
  - No test covers the "no registry, no legacy tags" path (`tag-repository.test.ts:140` covers only an import that finds tags).
- Fix sketch:
  - After an import, persist `{version:1, tags:[]}` even when empty, or remember in memory that the import ran for this vault directory.
  - Separately, have `list-items` return tag counts so `tags:list` does not need its own scan.
- Effort: S

### LIB-A5. Per-item fs work is redundant and the edit probes are serialized: extension re-probing, two session probes per item, and the session meta read twice

- Severity: medium
- Category: optimization
- Confidence: confirmed (code); the magnitude on network or external drives is plausible
- Where: `main/library/library-vault.ts:114-131,89-95`, `main/library/library-service.ts:50-55`, `main/library/edit-project-probe.ts:31-68,89-103`
- What happens:
  - `list()` already knows each file's extension from `readdir`, but `describe(id)` probes `.mp4`, `.webm`, `.png` and `.gif` in order with `access`. That is 2 wasted syscalls per screenshot and 3 per GIF.
  - The edit loop then `await`s, for each item in sequence, `probeEditing` and `probeEditSession`. Both start with the same `hasEditSession` `access`, and for sessions both `readFile` and parse the same `.edit.meta.json`. The comment at `:80-83` claims there is a single read, but there are two.
  - On a local SSD this costs about 12 ms at n=500. On an SMB or external vault, 2n serial round trips at 1-5 ms each come to **1-5 s** per list, and the list runs about twice per mount (LIB-A1).
- Evidence:
  - The `for (const rec of local ?? [])` loop has an `await` inside (`library-service.ts:52-55`).
  - `describe` calls `filePath(id)` (`:131`) rather than receiving the name `readdir` returned.
- Fix sketch:
  - Pass the readdir filename into `describe`.
  - Merge the two probes into one function that reads the meta once.
  - Run the probes with `Promise.all`, bounded or plain.
- Effort: S

### LIB-A6. Screenshot cards load the full-resolution PNG as their thumbnail, with no lazy loading and no virtualization

- Severity: medium
- Category: performance
- Confidence: confirmed (code path); the memory and decode magnitude is plausible
- Where: `main/library/library-vault.ts:166-170`, `renderer/src/features/library/components/video-card.tsx:62`, `video-row.tsx:62`, `renderer/src/pages/library/library-page.tsx:329,349`, `renderer/src/features/screenshots/recent-screenshots.tsx:45`, `renderer/src/pages/editor/editor-home-page.tsx:246`
- What happens:
  - For `kind === "screenshot"`, `thumbnailUrl` is `kaipu-media://screenshot/<id>`, which is the original PNG. No downsized poster is ever written for screenshots: `writeThumbnail` is called only for recordings, GIFs and backfill.
  - The grid renders every item and every `<img>` loads eagerly, so opening Library streams every poster and every full PNG through the main-process protocol handler (n × `stat` + stream + prefs read).
  - Chromium cannot decode PNGs at reduced scale, so each visible screenshot card decodes at full size. A Retina capture of about 3456×2234 is about 30 MB as RGBA.
  - Example: 100 Retina screenshots means several hundred MB read from disk at mount, and tens of MB of decoded bitmap for each screenful of cards.
- Evidence:
  - There is no `loading="lazy"` or `decoding="async"` attribute on any library `<img>`.
  - There is no windowing.
  - Video posters are only 640 px (`generate-thumbnail.ts:42`). Screenshots are the outlier.
- Fix sketch:
  - Write a 640 px `.kaipu/<id>.jpg` for screenshots at save and overwrite time, and serve that through `thumb/`, generating it lazily for existing screenshots.
  - Add `loading="lazy" decoding="async"` to the card and row images.
  - Virtualize the grid once n can exceed a few hundred.
- Effort: M

### LIB-A7. Orphan heal reads entire recordings into a Blob, retries failed heals on every re-list, and also runs inside the editor

- Severity: medium
- Category: resource-leak
- Confidence: confirmed
- Where: `renderer/src/features/library/media/heal-orphan-metadata.ts:20`, `renderer/src/features/library/hooks/use-orphan-heal.ts:17-19,52,64-93`, `renderer/src/features/library/hooks/use-local-library.ts:118-122`
- What happens:
  - `healOrphanMetadata` runs `fetch(kaipu-media://recording/<id>).blob()`. That reads the **whole** file through main's JS stream into the renderer, up to 3 at a time, even though mediabunny only needs the moov atom and one keyframe.
  - It does this repeatedly in three cases:
    - **Undecodable recording** (an interrupted finalize, a corrupt file, or a sub-second clip whose duration floors to 0, which the code itself documents at `heal-orphan-metadata.ts:14-16`). `meta === null` leads to `attempted.delete(id)`, so every new `videos` array refetches and re-decodes the full file. A new array comes from every `library:changed`, every Sync and every mount.
    - **Duration decodes but the poster fails.** The item stays an orphan (`!thumbnailUrl`). The `attempted` set lives in a `useRef`, so every remount of any `useLocalLibrary` page heals it again.
    - **The heal runs in every instance**, including `EditorVideoPage` (`editor-routes.tsx:23`). Opening the video editor therefore starts up to 3 background WebCodecs decodes of _other_ recordings, and those compete with the editor's own preview decode.
  - A 2 GB interrupted recording means about 2 GB streamed through main and buffered in a Blob on each re-list.
- Evidence: The retry and re-run behaviour comes straight from the effect's dependencies (`[videos]`) and the per-instance `attempted` ref. `probe-source.ts:30` already uses `UrlSource` (Range requests) against the same protocol, so the pattern exists in the codebase.
- Fix sketch:
  - Use `new UrlSource(kaipu-media://recording/<id>)` for both the duration and the poster.
  - Persist a "heal failed at size+mtime" stamp in the sidecar and skip the item until the file changes.
  - Run the heal only from the Library page, or from a single app-level store.
- Effort: S-M

### LIB-A8. Tag edits trigger 3-4 vault scans each: `summary()` re-scans, the broadcast re-lists, and `use-tags` refreshes again

- Severity: low
- Category: optimization
- Confidence: confirmed
- Where: `main/library/index.ts:104-121`, `renderer/src/features/library/hooks/use-tags.ts:42-58`
- What happens:
  - `createTag`, `renameTag` and `recolorTag` return `summary(id)`, which calls `tags.list()`. That is a full scan just to return a count.
  - `changed()` broadcasts, which triggers `list-items` plus `tags:list`.
  - `use-tags` `run()` and `create()` then also call `refresh()`, which is another `tags:list`, duplicating the one the broadcast already triggered.
  - Result: about 30n ops per tag rename (15k at n=500). Renaming tags in the drawer one after another queues these behind each other.
- Evidence: Read directly. The explicit `refresh()` in `use-tags.ts:49,58` is redundant with the listener at `:37`.
- Fix sketch:
  - Compute the summary from the registry plus the counts the caller already has, or return the `Tag` without a count.
  - Drop the explicit `refresh()` that the broadcast already covers.
- Effort: S

### LIB-A9. No timing, size or failure signal for the library: list latency, vault size and cloud refresh failures are all invisible

- Severity: medium
- Category: observability
- Confidence: confirmed
- Where: `main/library/library-service.ts:39-68,95-105`, `renderer/src/features/library/hooks/use-local-library.ts:130`, `main/library/index.ts` (no logging apart from drag and open-folder errors)
- What happens:
  - Nobody can tell how long `list()` takes, how many items or bytes the vault holds, how many catalog pages a refresh walked, or that the refresh fails.
  - `doRefresh` discards `err` and returns `{ok:false, reason:"network"}`, and the mount call is `void`ed. A server returning 500 on every refresh is therefore completely silent, and the user just sees cloud state go stale.
  - The "app feels slower" complaint cannot be confirmed or bisected from the field.
- Evidence: `grep console.|performance.now|capture` over `main/library`, `main/cloud`, `main/media-protocol.ts` and `features/library` finds only two `console.error` calls, and none on these paths. Main has `captureMainException` (`services/analytics.service.ts:48`), but the refresh never calls it.
- Fix sketch (minimum):
  - Log `library.list` with `{items, screenshots, recordings, catalogEntries, ms}`.
  - Log `tags.list` with `{ms, importedLegacy}`.
  - Log `catalog.refresh` with `{pages, entries, ms, ok, reason}`, sending non-unauthorized failures to `captureMainException`.
  - Once per session, send a sampled analytics event with the vault item count and the p50/max list ms.
- Effort: S

## Checked and fine

- **Broadcast storm or loop:** none. `list()`'s best-effort catalog cache write, `backfill`, `markOpenedInEditor` and `rename` do not broadcast, so a broadcast never causes a write that broadcasts again. The fan-out is bounded (LIB-A1), not recursive.
- **The w (windows) factor:** `broadcastLibraryChanged` sends to all windows (main, control bar, capture panel, camera bubble), but only the main window renders the pages that call `useLocalLibrary` and `useTags`. The cost is about 1× per broadcast, not w×.
- **StrictMode double mount:** dev only (`renderer/src/main.tsx:59`). The duplicate cloud refresh is absorbed by the in-flight deduplication (`library-service.ts:71`); the duplicate list is not, but it does not exist in production builds.
- **Re-list cache busting:** the poster URLs are stable (`kaipu-media://thumb/<id>`, and the screenshot `?v=<mtime>` changes only on overwrite). Cards are keyed by `assetId`, so a re-list does not change `src` and does not refetch posters. Not verified: whether Blink's memory cache serves posters after a page remount. Custom-scheme responses carry no cache headers. Measure with DevTools Network across Library → detail → back.
- **Filter and search per keystroke:** `selectVisibleVideos` plus `facetCounts` make about 4 linear passes. At n=500 that is about 2k `matches()` calls, well under 1 ms. The real per-keystroke cost is re-rendering n non-memoized `VideoCard`s with inline callbacks. That is plausible but unmeasured at about 10-30 ms for n=500, and minor compared with LIB-A1, A2 and A6. Debounce the search or `memo` the cards only after the store refactor makes item identities stable.
- **`JSON.stringify` catalog compare** (`library-service.ts:58`): about 400 B per entry, so about 200 KB × 2 for 500 cloud entries, about 1-2 ms. Acceptable. It also prevents a cache rewrite on plain lists.
- **`describe()` concurrency:** `Promise.all` over all ids is unbounded, but libuv caps real concurrency at 4 threads. The measured 500-item parallel describe takes about 19 ms locally. It does briefly queue other threadpool users (for example, protocol streams) behind it, but that is not significant locally.
- **Media protocol:** Range support is correct, and each request costs 1 `stat` plus up to 4 `access` probes for `recording/` or `screenshot/` (1 for mp4). The only meaningful per-request cost is the sync prefs read (LIB-A3).
- **Cloud catalog fetch:** sequential pages of 100 with a 15 s timeout and a 100-page cap, so it cannot loop forever. The cost is in how often it runs (LIB-A1), not in the fetch itself.
- **Stale comment** (not a defect): `library-detail-page.tsx:193` says fetch on `kaipu-media://` returns no bytes. That stopped being true once `corsEnabled` was added, and export and heal now rely on fetch working.
