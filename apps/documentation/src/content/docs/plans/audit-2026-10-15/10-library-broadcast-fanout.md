---
title: "10 · Library broadcast fan-out"
description: "Closes LIB-A1, LIB-A2, LIB-A8, SHOT-A7, SHOT-A9, VID-B9: every Library-backed page mount runs a cloud fetch that always broadcasts, each broadcast re-lists the vault, and the re-list swaps the detail page and Editor home to 'Loading' — the audit's #1 perceived-slowness cause."
---

# Library broadcast fan-out — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening Library, a detail page or Editor home shows the cached list instantly, triggers at most one cloud fetch per 30 s, re-lists only when something actually changed, and never unmounts the video player or blanks the page during a background re-list.

**Architecture:** Main: `LibraryService.refreshCatalog({ force })` gains a 30 s per-user throttle and returns `{ ok, verifiedAt, changed }`; the handler broadcasts `library:changed` only when `changed` (the cache is still always written). Tag create/rename/recolor stop running a full counting scan just to echo a summary. `screenshot:save` broadcasts. Renderer: a module-level singleton store (`library-store.ts`, `useSyncExternalStore`) owns one list, one `library:changed` subscription and one cloud refresh for all consumers; `isLoading` is true only until the first list lands, `isRefreshing` drives the Sync spinner; `useLocalLibrary` becomes a thin adapter. `use-tags` drops its redundant refreshes, `use-recent-screenshots` subscribes to `library:changed` instead of window focus, the detail page's missing-recording recovery ignores vault errors, and `editor-routes` keys its stable source by the URL `:assetId` so a transient miss never kicks the user out.

**Tech Stack:** React `useSyncExternalStore`, vitest `renderHook`, the existing `library-service.test.ts` temp-dir fixtures.

**Spec:** [Audit report](/audits/2026-10-15/report/) → LIB-A1, A2, A8 in [library lens A](/audits/2026-10-15/findings/library-a/); SHOT-A7, A9 in [screenshot lens A](/audits/2026-10-15/findings/screenshot-a/); VID-B9 in [video lens B](/audits/2026-10-15/findings/video-b/). Closes: **LIB-A1, LIB-A2, LIB-A8, SHOT-A7 (in part — see constraints), SHOT-A9, VID-B9**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`. No local Playwright.
- The Library "Sync" button today calls local `refresh()` only; `refreshCloud` is unused in the renderer. After this plan the button calls `sync()` = forced cloud refresh + local re-list.
- `catalogVerifiedAt` is not read by any page; keep writing the cache on every refresh so `lastVerifiedAt` stays fresh — only the **broadcast** is gated by `changed`.
- A module-level store leaks between vitest tests: `resetLibraryStore()` must run in `renderer/src/test/setup.ts`'s `afterEach` (Task 3) or the renderer suite breaks.
- Existing tests that break and must be updated: `library-service.test.ts:81` (`{ ok: true, verifiedAt: 777 }` → add `changed: true`) and "an unauthorized refresh keeps the cached catalog" (second call must pass `{ force: true }` — the constant `now: () => 777` clock would throttle it).
- `renameTag`/`recolorTag` change to `Promise<void>`; grep `renameTag|recolorTag` in `*.test.*` before changing.
- SHOT-A7 is closed only in part: the cold deep-link still waits one full list; the serial per-item probe loop is plan 12; a "pass the item in navigation state" fast path is not included.
- Commit messages in English, conventional-commit style.

## Review Focus

1. A background re-list must keep `isLoading === false`, `isRefreshing === true` and the current list visible — Task 3 test "keeps the list visible…".
2. Two mounted consumers must share one `listLibraryItems` call and one `onLibraryChanged` subscription — Task 3 test.
3. `refreshCatalog` twice inside 30 s with the same user → one fetch; `{ force: true }` and a different `userId` bypass — Task 1 test.
4. An identical server catalog → `changed: false` and **no** broadcast — Task 1 test + handler.
5. `/editor/image/:id` keeps the editor open when a re-list returns a vault error and loses the item — Task 4 test.

---

### Task 1: Main — throttle, change detection, lean tag replies, screenshot save broadcast

**Files:**

- Modify: `shared/types/library-item.ts:131-133`
- Modify: `main/library/library-service.ts:20-37`, `:70-106`
- Modify: `main/library/index.ts:22-27`, `:70-86`, `:104-121`
- Modify: `shared/types/electron-api.ts:140-144`, `:192`; `preload/index.ts:86`
- Modify: `main/screenshots/screenshot-ipc.ts:1-10`, the `screenshotSave` handler's `return saved;`
- Test: `main/library/library-service.test.ts`

**Interfaces:**

- Produces: `CatalogRefreshResult = { ok: true; verifiedAt: number; changed: boolean } | {...}`; `refreshCatalog(opts?: { force?: boolean })`; `refreshCloudCatalog(force?: boolean)` on `electronAPI`; `export function broadcastLibraryChanged()`; `createTag → TagSummary` (count 0), `renameTag/recolorTag → void`; `CLOUD_REFRESH_MIN_INTERVAL_MS = 30_000`.

- [ ] **Step 1: Write the failing tests**

Switch the suite's `now` to a mutable `clock` (`let clock = 777; … now: () => clock`). Update line 81 to expect `{ ok: true, verifiedAt: 777, changed: true }` and pass `{ force: true }` on the second call in the "unauthorized" test. Add:

```ts
it("reports changed:false when the server catalog is identical, but still refreshes lastVerifiedAt", async () => {
  catalog = [cloudEntry("x")];
  await service.refreshCatalog({ force: true });
  clock += 1000;
  expect(await service.refreshCatalog({ force: true })).toEqual({ ok: true, verifiedAt: 1777, changed: false });
  const cached = await cache.read(account.userId);
  expect(cached![0]!.lastVerifiedAt).toBe(1777);
});

it("reports changed:true when an entry changes, appears or disappears", async () => {
  catalog = [cloudEntry("x")];
  await service.refreshCatalog({ force: true });
  catalog = [cloudEntry("x", { title: "renamed" })];
  expect((await service.refreshCatalog({ force: true })) as { changed: boolean }).toMatchObject({ changed: true });
  catalog = [cloudEntry("x", { title: "renamed" }), cloudEntry("y")];
  expect(await service.refreshCatalog({ force: true })).toMatchObject({ changed: true });
  catalog = [];
  expect(await service.refreshCatalog({ force: true })).toMatchObject({ changed: true });
});

it("throttles a second refresh inside 30 s unless forced or the account changed", async () => {
  catalog = [cloudEntry("x")];
  await service.refreshCatalog();
  await service.refreshCatalog();
  expect(fetchCatalog).toHaveBeenCalledTimes(1);
  await service.refreshCatalog({ force: true });
  expect(fetchCatalog).toHaveBeenCalledTimes(2);
  clock += 30_001;
  await service.refreshCatalog();
  expect(fetchCatalog).toHaveBeenCalledTimes(3);
  account = { userId: "other", token: "t2" };
  await service.refreshCatalog();
  expect(fetchCatalog).toHaveBeenCalledTimes(4);
});
```

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/main/library/library-service.test.ts` → FAIL (`changed` missing; every call fetches).

- [ ] **Step 3: Implement**

`shared/types/library-item.ts`:

```ts
export type CatalogRefreshResult =
  | {
      ok: true;
      verifiedAt: number;
      /** False when the server catalog equals the cached one (ignoring lastVerifiedAt). */
      changed: boolean;
    }
  | { ok: false; reason: "signed-out" | "unauthorized" | "network" };
```

`library-service.ts`:

```ts
/** A cloud refresh that succeeded less than this long ago is skipped unless forced. */
export const CLOUD_REFRESH_MIN_INTERVAL_MS = 30_000;

/** True when the two catalogs differ in anything but when they were verified. */
function catalogDiffers(a: CloudCatalogEntry[], b: CloudCatalogEntry[]): boolean {
  if (a.length !== b.length) return true;
  const key = (e: CloudCatalogEntry): string => {
    const { lastVerifiedAt: _ignored, ...rest } = e;
    return JSON.stringify(Object.entries(rest).sort(([x], [y]) => (x < y ? -1 : 1)));
  };
  const before = new Map(a.map((e) => [e.assetId, key(e)] as const));
  return b.some((e) => before.get(e.assetId) !== key(e));
}
```

In the class: `private lastRefresh: { userId: string; at: number; verifiedAt: number } | null = null;` and

```ts
  refreshCatalog(opts: { force?: boolean } = {}): Promise<CatalogRefreshResult> {
    const account = this.deps.account();
    const last = this.lastRefresh;
    if (
      !opts.force &&
      account &&
      last &&
      last.userId === account.userId &&
      this.now() - last.at < CLOUD_REFRESH_MIN_INTERVAL_MS
    ) {
      return Promise.resolve({ ok: true, verifiedAt: last.verifiedAt, changed: false });
    }
    if (this.inflightRefresh) return this.inflightRefresh;
    this.inflightRefresh = this.doRefresh().finally(() => {
      this.inflightRefresh = null;
    });
    return this.inflightRefresh;
  }
```

In `doRefresh`, replace the write/return block:

```ts
      const next = fresh.map((e) => ({
        ...e,
        lastVerifiedAt: verifiedAt,
        lastSeenLocalId: seen.get(e.assetId) ?? null,
      }));
      const changed = catalogDiffers(previous, next);
      await this.deps.cache.write(account.userId, next); // always: keeps lastVerifiedAt fresh
      this.lastRefresh = { userId: account.userId, at: verifiedAt, verifiedAt };
      return { ok: true, verifiedAt, changed };
```

`main/library/index.ts`: `export function broadcastLibraryChanged()` (add `export`); handlers:

```ts
  ipcMain.handle(IPC_CHANNELS.refreshCloudCatalog, async (_event, force?: unknown) => {
    const result = await service.refreshCatalog({ force: force === true });
    if (result.ok && result.changed) broadcastLibraryChanged();
    return result;
  });
  // ...
  deps.auth.onAccountChanged((userId) => {
    broadcastLibraryChanged();
    if (userId) {
      void service
        .refreshCatalog({ force: true })
        .then((r) => r.ok && r.changed && broadcastLibraryChanged());
    }
  });
```

Tag handlers (LIB-A8) — remove `summary` and the full scan per write (import `TagColor` from `@kaipu/domain/constants`, already the source of `isTagColor`):

```ts
  const fresh = (tag: { id: string; name: string; slug: string; color: TagColor }): TagSummary => ({
    id: tag.id, name: tag.name, slug: tag.slug, color: tag.color, count: 0,
  });
  ipcMain.handle(IPC_CHANNELS.createTag, async (_e, name: unknown, color: unknown) =>
    fresh(await changed(tags.create(String(name), isTagColor(color) ? color : undefined))),
  );
  ipcMain.handle(IPC_CHANNELS.renameTag, async (_e, id: unknown, name: unknown) => {
    await changed(tags.rename(String(id), String(name)));
  });
  ipcMain.handle(IPC_CHANNELS.recolorTag, async (_e, id: unknown, color: unknown) => {
    if (!isTagColor(color)) throw new Error("tags: not a palette color");
    await changed(tags.recolor(String(id), color));
  });
```

`shared/types/electron-api.ts`: `renameTag(...): Promise<void>; recolorTag(...): Promise<void>;` and `refreshCloudCatalog(force?: boolean): Promise<CatalogRefreshResult>;` (doc: "force skips the 30 s throttle; the Sync button passes it"). `preload/index.ts:86`: `refreshCloudCatalog: (force) => ipcRenderer.invoke(IPC_CHANNELS.refreshCloudCatalog, force === true),`.

`screenshot-ipc.ts`: `import { broadcastLibraryChanged, currentVault, screenshotFilePath } from "../library";` and `broadcastLibraryChanged();` right before `return saved;` in the save handler.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/library && bun run check-types` → PASS.

```bash
git add src/shared/types/library-item.ts src/shared/types/electron-api.ts src/preload/index.ts src/main/library/library-service.ts src/main/library/library-service.test.ts src/main/library/index.ts src/main/screenshots/screenshot-ipc.ts
git commit -m "perf(desktop): throttle cloud refresh, broadcast library:changed only on real change"
```

### Task 2: Renderer singleton library store

**Files:**

- Create: `renderer/src/features/library/library-store.ts`
- Modify: `renderer/src/test/setup.ts` (`afterEach`: call `resetLibraryStore()` after `cleanup()`)

**Interfaces:**

- Produces: `useLibrarySnapshot(): { videos; isLoading; isRefreshing; hasError; catalogVerifiedAt }`, `refreshLibrary(onError?)`, `patchLibraryVideos(fn)`, `resetLibraryStore()`.

- [ ] **Step 1: Write the store** (its behaviour is pinned through the hook tests in Task 3)

```ts
// renderer/src/features/library/library-store.ts
import { useSyncExternalStore } from "react";
import type { LibraryVideo } from "./types";
import { toLibraryVideo } from "./map-item";

export interface LibrarySnapshot {
  videos: LibraryVideo[];
  /** True only until the first list lands; never true again afterwards. */
  isLoading: boolean;
  /** True while any re-list is in flight (drives the Sync spinner only). */
  isRefreshing: boolean;
  hasError: boolean;
  catalogVerifiedAt: number | null;
}

type ListErrorReporter = (error: unknown, retry: () => void) => void;

const INITIAL: LibrarySnapshot = {
  videos: [],
  isLoading: true,
  isRefreshing: false,
  hasError: false,
  catalogVerifiedAt: null,
};

let snapshot = INITIAL;
const listeners = new Set<() => void>();
let detach: (() => void) | null = null;
let inflight: Promise<void> | null = null;
let rerun = false;
let reportListError: ListErrorReporter = () => {};

function set(patch: Partial<LibrarySnapshot> | ((s: LibrarySnapshot) => Partial<LibrarySnapshot>)): void {
  snapshot = { ...snapshot, ...(typeof patch === "function" ? patch(snapshot) : patch) };
  for (const listener of listeners) listener();
}

async function listOnce(): Promise<void> {
  try {
    const result = await window.electronAPI.listLibraryItems();
    // Do NOT blank the list on a vault error — cloud items from the cached catalog
    // are still real data, and blanking would render as the empty state.
    set({
      videos: result.items.map(toLibraryVideo),
      catalogVerifiedAt: result.catalogVerifiedAt,
      hasError: result.vaultError !== null,
    });
    if (result.vaultError !== null) {
      reportListError(new Error(result.vaultError), () => void refreshLibrary());
    }
  } catch (error) {
    set({ hasError: true });
    reportListError(error, () => void refreshLibrary());
  }
}

/** Re-list while keeping the current list on screen (stale-while-revalidate). */
export function refreshLibrary(onError?: ListErrorReporter): Promise<void> {
  if (onError) reportListError = onError;
  if (inflight) {
    rerun = true; // coalesce: at most one extra list after the current one
    return inflight;
  }
  set({ isRefreshing: true });
  inflight = (async () => {
    try {
      do {
        rerun = false;
        await listOnce();
      } while (rerun);
    } finally {
      inflight = null;
      set({ isLoading: false, isRefreshing: false });
    }
  })();
  return inflight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshLibrary(); // the cached list shows now; the fresh one replaces it
    void window.electronAPI.refreshCloudCatalog(); // main throttles and broadcasts only on change
    detach = window.electronAPI.onLibraryChanged(() => void refreshLibrary());
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detach?.();
      detach = null;
    }
  };
}

export function useLibrarySnapshot(): LibrarySnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Optimistic local patch after a mutation (rename, tags, delete). */
export function patchLibraryVideos(fn: (videos: LibraryVideo[]) => LibraryVideo[]): void {
  set((s) => ({ videos: fn(s.videos) }));
}

/** Tests only: a module-level store would otherwise leak between cases. */
export function resetLibraryStore(): void {
  detach?.();
  detach = null;
  listeners.clear();
  inflight = null;
  rerun = false;
  reportListError = () => {};
  snapshot = INITIAL;
}
```

In `renderer/src/test/setup.ts` import `resetLibraryStore` and call it inside the existing `afterEach` after `cleanup()`.

- [ ] **Step 2: Type check** — `bun run check-types` → green.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/features/library/library-store.ts src/renderer/src/test/setup.ts
git commit -m "feat(desktop): singleton library store with stale-while-revalidate"
```

### Task 3: `useLocalLibrary` as an adapter; pages use `isRefreshing`/`sync`

**Files:**

- Modify: `renderer/src/features/library/hooks/use-local-library.ts` (whole file)
- Modify: `renderer/src/pages/library/library-page.tsx:45`, `:123-138`
- Modify: `renderer/src/features/library/hooks/use-tags.ts:49`, `:58`
- Test: `renderer/src/features/library/hooks/use-local-library.test.tsx`

**Interfaces:**

- Produces: `LocalLibrary` gains `isRefreshing: boolean`, `sync(): Promise<void>`, `refreshCloud(force?: boolean)`.

- [ ] **Step 1: Write the failing tests** (the suite captures `onLibraryChanged` into `notify` and assigns `window.electronAPI.*` in `beforeEach`)

```ts
it("keeps the list visible and isLoading false during a re-list", async () => {
  let notify: (() => void) | null = null;
  window.electronAPI.onLibraryChanged = (cb: () => void) => { notify = cb; return () => {}; };
  const { result } = renderHook(() => useLocalLibrary());
  await waitFor(() => expect(result.current.videos).toHaveLength(2));
  let resolve!: (v: unknown) => void;
  window.electronAPI.listLibraryItems = vi.fn(() => new Promise((r) => (resolve = r))) as never;
  await act(async () => notify?.());
  expect(result.current.isLoading).toBe(false);
  expect(result.current.isRefreshing).toBe(true);
  expect(result.current.videos).toHaveLength(2);
  await act(async () => resolve({ items: [], vaultError: null, catalogVerifiedAt: null }));
  expect(result.current.isRefreshing).toBe(false);
});

it("two mounted hooks share one list and one listener", async () => {
  const subscribe = vi.fn((_cb: () => void) => () => {});
  window.electronAPI.onLibraryChanged = subscribe;
  const a = renderHook(() => useLocalLibrary());
  const b = renderHook(() => useLocalLibrary());
  await waitFor(() => expect(a.result.current.videos).toHaveLength(2));
  await waitFor(() => expect(b.result.current.videos).toHaveLength(2));
  expect(window.electronAPI.listLibraryItems).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledTimes(1);
});

it("shows the cached list immediately on a remount", async () => {
  const first = renderHook(() => useLocalLibrary());
  await waitFor(() => expect(first.result.current.videos).toHaveLength(2));
  first.unmount();
  const second = renderHook(() => useLocalLibrary());
  expect(second.result.current.videos).toHaveLength(2);
  expect(second.result.current.isLoading).toBe(false);
});

it("sync() forces the cloud refresh", async () => {
  const { result } = renderHook(() => useLocalLibrary());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => { await result.current.sync(); });
  expect(window.electronAPI.refreshCloudCatalog).toHaveBeenCalledWith(true);
});
```

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/renderer/src/features/library/hooks/use-local-library.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`use-local-library.ts` — delete the four `useState`s, the `refresh` body and the mount `useEffect`; keep `rename`/`setTags`/`remove`/`reveal`/`removeLocalCopy`/`patchHealed`/`useOrphanHeal` with `patchLibraryVideos(prev => …)` in place of `setVideos`:

```ts
export function useLocalLibrary(): LocalLibrary {
  const t = useTranslations("library");
  const { videos, isLoading, isRefreshing, hasError, catalogVerifiedAt } = useLibrarySnapshot();
  const refresh = useCallback(
    () =>
      refreshLibrary((error, retry) =>
        reportError(t("errorRead"), error, { context: { phase: "library-list" }, retry }),
      ),
    [],
  );
  const refreshCloud = useCallback((force = false) => window.electronAPI.refreshCloudCatalog(force), []);
  /** Sync button: force the cloud check, then re-list locally. */
  const sync = useCallback(async () => {
    await Promise.all([refreshCloud(true), refresh()]);
  }, [refreshCloud, refresh]);
  // rename / setTags / remove / reveal / removeLocalCopy unchanged except setVideos -> patchLibraryVideos
  // patchHealed -> patchLibraryVideos; useOrphanHeal(localVideos, patchHealed) unchanged
  return { videos, isLoading, isRefreshing, hasError, catalogVerifiedAt, refresh, refreshCloud, sync, rename, setTags, remove, reveal, removeLocalCopy };
}
```

Add `isRefreshing: boolean;` and `sync(): Promise<void>;` to the `LocalLibrary` interface; `refreshCloud(force?: boolean)`.

`library-page.tsx`: destructure `isRefreshing, sync`; the Sync button becomes `onClick={() => void sync()}` with `className={isRefreshing ? styles.spinning : undefined}`; the empty-state `isLoading` text and the retry `refresh()` stay.

`use-tags.ts`: delete `await refresh();` at `:49` (in `run`) and `:58` (in `create`); the broadcast already refreshes. Keep the `listTags()` fallback in `create`'s catch.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/library src/renderer/src/pages/library src/renderer/src/pages/library-detail && bun run check-types` → PASS (the existing "kicks off a cloud catalog refresh on mount" test still sees exactly one call).

```bash
git add src/renderer/src/features/library/hooks/use-local-library.ts src/renderer/src/features/library/hooks/use-local-library.test.tsx src/renderer/src/features/library/hooks/use-tags.ts src/renderer/src/pages/library/library-page.tsx
git commit -m "perf(desktop): library pages share one store; re-lists never blank the page"
```

### Task 4: Detail page and editor routes survive a transient miss (VID-B9); recent screenshots follow broadcasts (SHOT-A9)

**Files:**

- Modify: `renderer/src/features/library/hooks/use-missing-recording-recovery.ts:19-22`, `:55`
- Modify: `renderer/src/pages/library-detail/library-detail-page.tsx:86-105`
- Modify: `renderer/src/pages/editor/editor-routes.tsx:20-25`, `:63-84`
- Modify: `renderer/src/features/screenshots/use-recent-screenshots.ts`
- Test: `renderer/src/features/library/hooks/use-missing-recording-recovery.test.ts`, `renderer/src/pages/editor/editor-routes.test.tsx`, create `renderer/src/features/screenshots/use-recent-screenshots.test.tsx`

- [ ] **Step 1: Write the failing tests**

`editor-routes.test.tsx` (uses `createMemoryRouter` + `setLibrary(items)`):

```tsx
it("keeps the editor open when a re-list loses the item", async () => {
  let notify: (() => void) | null = null;
  window.electronAPI.onLibraryChanged = (cb: () => void) => { notify = cb; return () => {}; };
  setLibrary([localScreenshot("s1")]);
  const router = renderAt("/editor/image/local-s1");
  expect(await screen.findByText("image-editor:local:local-s1")).toBeInTheDocument();
  window.electronAPI.listLibraryItems = vi.fn(async () => ({ items: [], vaultError: "EACCES", catalogVerifiedAt: null }));
  await act(async () => notify?.());
  expect(screen.getByText("image-editor:local:local-s1")).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/editor/image/local-s1");
});
```

`use-missing-recording-recovery.test.ts` (follow its fake-timer style): with `hasError: true`, `found: false`, advancing past `RETRY_DELAY_MS` must not call `navigate`.

`use-recent-screenshots.test.tsx`:

```tsx
it("re-lists on library:changed, not on window focus, and swallows a failed list", async () => {
  let notify: (() => void) | null = null;
  window.electronAPI.onLibraryChanged = (cb: () => void) => { notify = cb; return () => {}; };
  window.electronAPI.listLocalRecordings = vi.fn(async () => [shot("a")]);
  const { result } = renderHook(() => useRecentScreenshots());
  await waitFor(() => expect(result.current.shots).toHaveLength(1));
  window.electronAPI.listLocalRecordings = vi.fn(async () => { throw new Error("vault"); });
  await act(async () => notify?.());
  expect(result.current.shots).toHaveLength(1);
  window.dispatchEvent(new Event("focus"));
  expect(window.electronAPI.listLocalRecordings).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

`use-missing-recording-recovery.ts`: add optional `hasError?: boolean` to the params and `const missing = !isLoading && !hasError && !!id && !found;`. `library-detail-page.tsx`: destructure `hasError` from `useLocalLibrary()` and pass `hasError` to the recovery hook. (On a vault error with the item absent the page shows the existing "File not found" screen with "Back to library" instead of redirecting; the next successful list fixes it.)

`editor-routes.tsx`:

```tsx
function useItemFromParams(): { assetId: string | undefined; item: LibraryVideo | undefined; isLoading: boolean } {
  const { assetId } = useParams<{ assetId: string }>();
  const { videos, isLoading } = useLocalLibrary();
  return { assetId, item: videos.find((v) => v.assetId === assetId), isLoading };
}

export function EditorVideoPage() {
  const { assetId, item, isLoading } = useItemFromParams();
  const source = useStableSource(assetId, item ? videoSourceFor(item) : null);
  useMarkOpened(source?.id);
  if (isLoading && !source) return <Loading />;
  if (!source) return <Navigate to={ROUTES.editor} replace />;
  return <VideoEditorLoader key={assetId} source={source} />;
}

export function EditorImagePage() {
  const { assetId, item, isLoading } = useItemFromParams();
  const source = useStableSource(assetId, item ? imageSourceFor(item) : null);
  useMarkOpened(source?.kind === "local" ? source.id : null);
  if (isLoading && !source) return <Loading />;
  if (!source) return <Navigate to={ROUTES.editor} replace />;
  return <ScreenshotEditor key={assetId} source={source} />;
}
```

(The stable source is now keyed by the URL param: a transient miss keeps the resolved source for the same `:assetId`; a different id still resets.)

`use-recent-screenshots.ts`:

```ts
export function useRecentScreenshots(limit = 6): { shots: LocalRecording[] } {
  const [shots, setShots] = useState<LocalRecording[]>([]);
  const refresh = useCallback(() => {
    void window.electronAPI
      .listLocalRecordings()
      .then((items) => {
        setShots(items.filter((item) => item.kind === "screenshot").slice(0, limit));
      })
      .catch(() => {}); // a vault error leaves the previous shots on screen
  }, [limit]);
  useEffect(() => {
    refresh();
    // `screenshot:save` and every other vault change broadcast `library:changed`.
    return window.electronAPI.onLibraryChanged(refresh);
  }, [refresh]);
  return { shots };
}
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/library/hooks/use-missing-recording-recovery.ts src/renderer/src/features/library/hooks/use-missing-recording-recovery.test.ts src/renderer/src/pages/library-detail/library-detail-page.tsx src/renderer/src/pages/editor/editor-routes.tsx src/renderer/src/pages/editor/editor-routes.test.tsx src/renderer/src/features/screenshots/use-recent-screenshots.ts src/renderer/src/features/screenshots/use-recent-screenshots.test.tsx
git commit -m "fix(desktop): editors and detail page survive a transient re-list miss; recent shots follow broadcasts"
```

### Task 5: Ship

- [ ] Full suite + types green. Open a PR titled `perf(desktop): stop the library re-list churn (audit LIB-A1/A2/A8, SHOT-A7/A9, VID-B9)` linking this plan and the findings; state the behaviour changes (30 s throttle; Sync forces; tag rename/recolor return void; detail page shows "File not found" instead of redirecting on a vault error). End with **How to test it yourself**:
  1. Signed in, open Library → a recording's detail page → back → Editor home. With a temporary `console.info` in `fetchCloudCatalog` (or DevTools network on the main process), confirm **one** `/api/v1/assets` walk per 30 s, not one per page.
  2. On the detail page, press play, then add a tag → playback does not restart and no "Loading" flash appears.
  3. Take a screenshot, open `/screenshots` → the new thumbnail is there without re-focusing the window.
  4. Click Sync → the spinner runs and a fetch happens immediately even inside the 30 s window.
  5. Open a screenshot in the editor, then unplug/rename the vault folder → the editor stays open (a save would fail visibly); restore the folder.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
