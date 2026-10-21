---
title: "13 · Catalog refresh integrity"
description: "Closes LIB-B4 and LIB-B5: list() can overwrite a fresher cloud catalog with the stale snapshot it read before a concurrent refresh, and an account switch during a refresh reuses the previous account's in-flight promise."
---

# Catalog refresh integrity — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cloud catalog cache for an account is only ever patched or replaced with data that was computed against the file as it is at write time, and each account's refresh is its own.

**Architecture:** `CatalogCache` gains `update(userId, fn)` — a read-modify-write that runs inside its existing per-user write chain, so `fn` sees the file as the previous queued write left it. `LibraryService.list()` patches only the `lastSeenLocalId` values that changed, by `assetId`, through `update` instead of writing back its older snapshot. `doRefresh` merges `lastSeenLocalId` inside `update` too. `refreshCatalog` keeps one in-flight refresh **per `userId` + token** in a Map; a different account starts its own. The old account's result is not discarded — it writes into that account's own cache directory and is correct. No IPC or renderer change.

**Tech Stack:** Node fs, vitest (real temp dirs; `library-service.test.ts` and `catalog-cache.test.ts` fixtures).

**Spec:** [Audit report](/audits/2026-10-15/report/) → LIB-B4, LIB-B5 in [library lens B](/audits/2026-10-15/findings/library-b/). Closes: **LIB-B4, LIB-B5**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- `composeLibrary` returns `catalogUpdates` as the same entries in the same order as `catalog`, differing only in `lastSeenLocalId`; the patch relies on that.
- The existing test "list() skips the cache write when the catalog is unchanged" spies on `cache.write`; after this plan `list()` goes through `cache.update`, so the spy must move to `update` or the test passes vacuously.
- Plan 10 adds a 30 s throttle, `{ force }` and `changed` to `refreshCatalog`; plan 12 replaces the probe loop and the stringify compare in `list()`. All three touch `library-service.ts` — land in order 10 → 12 → 13 (or rebase: the `update`-based patch below replaces plan 12's `lastSeenChanged` guard, and the per-user Map coexists with plan 10's `lastRefresh` throttle).
- `update`'s `fn` must be synchronous and cheap (it runs inside the write chain); a throwing `fn` rejects that call only.
- Commit messages in English, conventional-commit style.

## Review Focus

1. A refresh that lands while `list()` holds an older snapshot: the new catalog survives and `lastSeenLocalId` is patched onto it — Task 2 test (LIB-B4).
2. Account A refresh in flight, switch to B, `refreshCatalog()` → a second fetch with B's token, each account's cache holds its own entries — Task 2 test (LIB-B5).
3. Two concurrent refreshes for the **same** account still share one fetch — Task 2 test.
4. `update` with `fn` returning `null` leaves the file byte-identical — Task 1 test.
5. `refreshCatalog()` while signed out returns `signed-out` without fetching — Task 2 test.

---

### Task 1: `CatalogCache.update`

**Files:**

- Modify: `main/cloud/catalog-cache.ts:42-59`
- Test: `main/cloud/catalog-cache.test.ts`

**Interfaces:**

- Produces: `update(userId: string, fn: (current: CloudCatalogEntry[] | null) => CloudCatalogEntry[] | null): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
it("update sees the previous queued write and can skip writing", async () => {
  await Promise.all([
    cache.write("u1", [entry("a")]),
    cache.update("u1", (cur) => [...(cur ?? []), entry("b")]),
  ]);
  expect((await cache.read("u1"))!.map((e) => e.assetId)).toEqual(["a", "b"]);
  const before = await readFile(join(userData, "cloud", "u1", "catalog.json"), "utf8");
  await cache.update("u1", () => null);
  expect(await readFile(join(userData, "cloud", "u1", "catalog.json"), "utf8")).toBe(before);
});

it("update receives null before the first write", async () => {
  const seen: unknown[] = [];
  await cache.update("fresh", (cur) => {
    seen.push(cur);
    return null;
  });
  expect(seen).toEqual([null]);
});
```

(Confirm the cache file path via the module's `path(userId)`.)

- [ ] **Step 2: Run to verify they fail** — `update` is not a function.

- [ ] **Step 3: Implement** — replace `write`:

```ts
  private enqueue(userId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.writeChains.get(userId) ?? Promise.resolve();
    const result = previous.then(task, task);
    // Store a link that never rejects, so a failed write doesn't stall the chain for
    // whatever writes this account queues next; the rejection itself still reaches
    // this call's own caller via `result`.
    this.writeChains.set(
      userId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  async write(userId: string, entries: CloudCatalogEntry[]): Promise<void> {
    return this.enqueue(userId, () => this.writeNow(userId, entries));
  }

  /**
   * Read-modify-write inside the write chain: `fn` sees the file as the previous queued
   * write left it, so a caller holding an older snapshot can patch rather than overwrite.
   * Return `null` to leave the file untouched.
   */
  async update(
    userId: string,
    fn: (current: CloudCatalogEntry[] | null) => CloudCatalogEntry[] | null,
  ): Promise<void> {
    return this.enqueue(userId, async () => {
      const next = fn(await this.read(userId));
      if (next) await this.writeNow(userId, next);
    });
  }
```

- [ ] **Step 4: Run and commit** — `node_modules/.bin/vitest run src/main/cloud/catalog-cache.test.ts` → PASS.

```bash
git add src/main/cloud/catalog-cache.ts src/main/cloud/catalog-cache.test.ts
git commit -m "feat(desktop): CatalogCache.update — read-modify-write inside the per-user chain"
```

### Task 2: `LibraryService` patches instead of overwriting; one refresh per account

**Files:**

- Modify: `main/library/library-service.ts:31-37` (field), `:58-63` (`list()` cache write), `:70-106` (`refreshCatalog`, `doRefresh`)
- Test: `main/library/library-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("list() does not overwrite a catalog a concurrent refresh wrote (LIB-B4)", async () => {
  await writeFile(join(vaultDir, "a.mp4"), "");
  const rec = (await new LibraryVault(vaultDir).describe("a"))!;
  catalog = [cloudEntry(rec.assetId), cloudEntry("old-cloud")];
  await service.refreshCatalog();
  const oldSnapshot = await cache.read(account.userId);
  // list() reads the cache, then probes; a refresh lands in between.
  vi.spyOn(cache, "read").mockImplementationOnce(async () => {
    catalog = [cloudEntry(rec.assetId), cloudEntry("new-cloud")];
    await service.refreshCatalog();
    return oldSnapshot;
  });
  await service.list();
  const final = (await cache.read(account.userId))!;
  expect(final.map((e) => e.assetId).sort()).toEqual([rec.assetId, "new-cloud"].sort());
  expect(final.find((e) => e.assetId === rec.assetId)!.lastSeenLocalId).toBe("a");
});

it("an account switch during a refresh starts its own refresh (LIB-B5)", async () => {
  let release!: (entries: CloudCatalogEntry[]) => void;
  vi.mocked(fetchCatalog)
    .mockImplementationOnce(() => new Promise((r) => (release = r)))
    .mockImplementationOnce(async () => [cloudEntry("b-only")]);
  const p1 = service.refreshCatalog();
  account = { userId: "u2", token: "t2" };
  const p2 = service.refreshCatalog();
  expect(p1).not.toBe(p2);
  expect(fetchCatalog).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetchCatalog).mock.calls[1][0]).toBe("t2");
  release([cloudEntry("a-only")]);
  await Promise.all([p1, p2]);
  expect((await cache.read("u1"))!.map((e) => e.assetId)).toEqual(["a-only"]);
  expect((await cache.read("u2"))!.map((e) => e.assetId)).toEqual(["b-only"]);
});

it("concurrent refreshes for the same account share one fetch", async () => {
  const [a, b] = [service.refreshCatalog(), service.refreshCatalog()];
  expect(a).toBe(b);
  await a;
  expect(fetchCatalog).toHaveBeenCalledTimes(1);
});

it("refreshCatalog returns signed-out without fetching when there is no account", async () => {
  account = null;
  expect(await service.refreshCatalog()).toEqual({ ok: false, reason: "signed-out" });
  expect(fetchCatalog).not.toHaveBeenCalled();
});
```

Edit the existing "skips the cache write" test: `vi.spyOn(cache, "update")` instead of `"write"`. (Default `account` in the suite is `u1`; adapt if named differently. If plan 10 has landed, pass `{ force: true }` where the throttle would short-circuit.)

- [ ] **Step 2: Run to verify they fail** — the B4 test ends with `old-cloud` resurrected; the B5 test gets `p1 === p2`.

- [ ] **Step 3: Implement**

Field:

```ts
  // One refresh per account: a different account (or the same user with a new token)
  // starts its own instead of inheriting the previous account's promise.
  private readonly inflightRefreshes = new Map<
    string,
    { token: string; promise: Promise<CatalogRefreshResult> }
  >();
```

`list()` — replace the stringify guard and `cache.write`:

```ts
    const { items, catalogUpdates } = composeLibrary({ local, catalog, editing, editSession });
    if (account && catalog && local) {
      // Best-effort: remembering which cloud items were also local is what lets an
      // unplugged drive read as "local unavailable" instead of "cloud only". Patch only
      // the entries whose association changed, onto the file as it is NOW — a refresh
      // may have rewritten the catalog while the probes above were running, and writing
      // our older snapshot back would resurrect deleted assets and drop new ones.
      const before = new Map(catalog.map((e) => [e.assetId, e.lastSeenLocalId] as const));
      const patch = new Map<string, string | null>();
      for (const e of catalogUpdates) {
        if (before.get(e.assetId) !== e.lastSeenLocalId) patch.set(e.assetId, e.lastSeenLocalId);
      }
      if (patch.size > 0) {
        await this.deps.cache
          .update(account.userId, (current) => {
            if (!current) return null;
            let changed = false;
            const next = current.map((e) => {
              if (!patch.has(e.assetId) || patch.get(e.assetId) === e.lastSeenLocalId) return e;
              changed = true;
              return { ...e, lastSeenLocalId: patch.get(e.assetId) ?? null };
            });
            return changed ? next : null;
          })
          .catch(() => undefined);
      }
    }
```

`refreshCatalog` / `doRefresh` (merge with plan 10's throttle if present — the throttle check goes first, then this Map):

```ts
  refreshCatalog(): Promise<CatalogRefreshResult> {
    const account = this.deps.account();
    if (!account) return Promise.resolve({ ok: false, reason: "signed-out" });
    const existing = this.inflightRefreshes.get(account.userId);
    if (existing && existing.token === account.token) return existing.promise;
    const promise: Promise<CatalogRefreshResult> = this.doRefresh(account).finally(() => {
      // Only clear our own slot: a newer refresh for this user may have replaced it.
      if (this.inflightRefreshes.get(account.userId)?.promise === promise) {
        this.inflightRefreshes.delete(account.userId);
      }
    });
    this.inflightRefreshes.set(account.userId, { token: account.token, promise });
    return promise;
  }

  private async doRefresh(account: { userId: string; token: string }): Promise<CatalogRefreshResult> {
    try {
      const fresh = await this.deps.fetchCatalog(account.token);
      const verifiedAt = this.now();
      // Merge inside the cache's write chain so a concurrent list() patch is never lost
      // and `lastSeenLocalId` is read from the file as it is at write time.
      await this.deps.cache.update(account.userId, (previous) => {
        const seen = new Map((previous ?? []).map((e) => [e.assetId, e.lastSeenLocalId] as const));
        return fresh.map((e) => ({
          ...e,
          lastVerifiedAt: verifiedAt,
          lastSeenLocalId: seen.get(e.assetId) ?? null,
        }));
      });
      return { ok: true, verifiedAt };
    } catch (err) {
      // unauthorized / network branches unchanged
    }
  }
```

(With plan 10 landed, `changed` is computed from `previous` inside the same `update` callback and `lastRefresh` is set after it.)

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/library src/main/cloud && bun run check-types` → PASS.

```bash
git add src/main/library/library-service.ts src/main/library/library-service.test.ts
git commit -m "fix(desktop): catalog cache is patched, never overwritten by a stale snapshot; one refresh per account"
```

### Task 3: Ship

- [ ] Open a PR titled `fix(desktop): catalog refresh integrity (audit LIB-B4, LIB-B5)` linking this plan and both findings. End with **How to test it yourself**:
  1. Throttle the network (macOS Network Link Conditioner), open the Library on account A, and while its refresh is slow sign in as account B → B's cloud items appear without reopening the Library.
  2. On account A with many cloud items, delete one asset on the web, then within the same second open the Library and remove a local download → the deleted asset does not reappear in the list after the next re-list.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
