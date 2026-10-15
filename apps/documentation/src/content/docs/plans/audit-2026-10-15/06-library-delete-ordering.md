---
title: "06 · Library delete ordering"
description: "Closes LIB-B3 and LIB-B14: delete removes the sidecar before the media (a failed media delete leaves a stripped item), delete never broadcasts, and remove-local-copy failures are unhandled."
---

# Library delete ordering — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A delete that fails leaves the item complete (title, tags, identity intact); a delete that succeeds is seen by every open page; remove-local-copy failures surface as a toast with Retry instead of an unhandled rejection.

**Architecture:** `LibraryVault.remove` deletes the media **first** and only then the sidecar, poster and cursor track (best effort). `RemoveLocalCopyResult` gains an `"io"` reason; `LibraryService.removeLocalCopy` catches vault errors and returns it instead of rejecting the IPC. `library:delete-local` broadcasts `library:changed`; `remove-local-copy` also broadcasts on `io` (the bytes may be gone). In the renderer, the hook's `remove` gains a Retry, `removeLocalCopy` re-lists on `io`, and the detail page's `doRemoveLocalCopy` gets try/catch + `reportError` with Retry. `vault.removeLocalCopy`'s own order (rm, then `localRemovedAt`) is deliberately unchanged: the marker must never be written while the file exists.

**Tech Stack:** Node fs, vitest (real temp vault), `@testing-library/react`.

**Spec:** [Audit report](/audits/2026-10-15/report/) → LIB-B3, LIB-B14 in [library lens B](/audits/2026-10-15/findings/library-b/). Closes: **LIB-B3, LIB-B14**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`. No local Playwright.
- Plan 04 wraps `remove()`'s sidecar deletions in `withLock(sidecarPath)`. If plan 04 has landed, keep that lock around the second step below; if not, plan 04 adds it later. Either order works.
- `main/library/index.ts` has no test (imports electron); its two handler edits are covered by the manual steps.
- Reuse the existing i18n key `errorDelete`; no new strings.
- Commit messages in English, conventional-commit style.

## Review Focus

1. Media delete fails (vault dir `0o500`) → sidecar and poster still exist and `describe()` still returns the title — Task 1 test (discriminating: the old order deletes the sidecar first because `.kaipu/` stays writable).
2. `removeLocalCopy` whose vault step throws after the `rm` → `{ ok: false, reason: "io" }`, never a rejection — Task 2 test.
3. The detail page's remove-local-copy rejection → toast with a Retry action, no unhandled rejection — Task 3 test.
4. A delete from the detail page must not leave a ghost row on the Library page behind `back()` — manual step (the broadcast).
5. `"io"` must fall into `removeLocalCopyBlockedKey`'s `default` (it does; the type check confirms exhaustiveness).

---

### Task 1: Media first in `LibraryVault.remove`

**Files:**

- Modify: `main/library/library-vault.ts:380-392` (`remove`)
- Test: `main/library/library-vault.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "remove keeps the sidecar and thumbnail when the media file cannot be deleted",
  async () => {
    await writeRecording("locked");
    await vault.writeMeta("locked", { title: "T" });
    await vault.writeThumbnail("locked", Buffer.from([1]));
    await chmod(directory, 0o500); // the vault root is read-only; .kaipu/ stays writable
    try {
      await expect(vault.remove("locked")).rejects.toThrow();
    } finally {
      await chmod(directory, 0o700);
    }
    expect(await readdir(join(directory, ".kaipu"))).toEqual(expect.arrayContaining(["locked.json", "locked.jpg"]));
    expect((await vault.describe("locked"))?.title).toBe("T");
  },
);
```

- [ ] **Step 2: Run to verify it fails** — `node_modules/.bin/vitest run src/main/library/library-vault.test.ts -t "cannot be deleted"` → FAIL (`locked.json` is gone).

- [ ] **Step 3: Implement**

```ts
  /**
   * Removes the video plus its sidecar and thumbnail. The media goes FIRST: if it
   * cannot be deleted (Finder-locked file, EBUSY on Windows) the error propagates
   * and the item is left complete — identity, title, tags and cloud link intact —
   * instead of stripped of its sidecar. Only once the media is gone are the
   * sidecar, thumbnail and cursor track removed, best-effort (they may not exist).
   */
  async remove(id: string): Promise<void> {
    await rm(await this.filePath(id), { force: true });
    await Promise.allSettled([
      rm(this.sidecarPath(id), { force: true }),
      rm(this.thumbnailPath(id), { force: true }),
      rm(this.cursorTrackPath(id), { force: true }),
      // An interrupted writeCursorTrack can leave the temp file behind.
      rm(`${this.cursorTrackPath(id)}.tmp`, { force: true }),
    ]);
  }
```

(With plan 04 landed: wrap the `Promise.allSettled` in `withLock(this.sidecarPath(id), () => …)`.)

- [ ] **Step 4: Run and commit** — the whole file → PASS, including the existing cursor-track removal tests.

```bash
git add src/main/library/library-vault.ts src/main/library/library-vault.test.ts
git commit -m "fix(desktop): delete the media before the sidecar so a failed delete leaves the item whole"
```

### Task 2: `io` result and broadcasts

**Files:**

- Modify: `shared/types/library-item.ts:135-140`
- Modify: `main/library/library-service.ts:108-129` (last two lines of `removeLocalCopy`)
- Modify: `main/library/index.ts:76-80`, `:135-139`
- Test: `main/library/library-service.test.ts`

**Interfaces:**

- Produces: `RemoveLocalCopyResult` reason union gains `"io"`.

- [ ] **Step 1: Write the failing test**

Using the suite's `flakyVault` pattern (`Object.assign(new LibraryVault(vaultDir), {...})` then rebuilding `service`):

```ts
it("removeLocalCopy returns io instead of rejecting when the vault write fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await writeFile(join(vaultDir, "a.mp4"), "bytes");
  const rec = (await new LibraryVault(vaultDir).describe("a"))!;
  catalog = [cloudEntry(rec.assetId, { sizeBytes: 5 })];
  await service.refreshCatalog();
  const flakyVault = Object.assign(new LibraryVault(vaultDir), {
    removeLocalCopy: async () => {
      await rm(join(vaultDir, "a.mp4"));
      throw new Error("EACCES");
    },
  });
  service = new LibraryService({
    vault: () => flakyVault,
    vaultDir: () => vaultDir,
    cache: new CatalogCache(userData),
    account: () => account,
    fetchCatalog,
    now: () => 777,
  });
  expect(await service.removeLocalCopy("a")).toEqual({ ok: false, reason: "io" });
});
```

(Match the hash/size setup of the neighbouring "hash-unknown" test so the policy allows the removal.)

- [ ] **Step 2: Run to verify it fails** — rejects with `EACCES`.

- [ ] **Step 3: Implement**

`shared/types/library-item.ts`:

```ts
export type RemoveLocalCopyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "no-cloud-copy"
        | "different-bytes"
        | "hash-unknown"
        | "edit-project"
        | "not-found"
        /** The filesystem refused (locked file, read-only sidecar). The media may or may not be gone. */
        | "io";
    };
```

`library-service.ts` — replace the last two lines of `removeLocalCopy`:

```ts
    try {
      await vault.removeLocalCopy(id);
    } catch (error) {
      // rm can fail (EBUSY/EPERM) or the sidecar write after it can. Either way
      // return a result instead of rejecting the IPC; the caller re-lists, which
      // shows the truth whether or not the bytes are gone.
      console.error("remove local copy failed", id, error);
      return { ok: false, reason: "io" };
    }
    return { ok: true };
```

`main/library/index.ts`:

```ts
  ipcMain.handle(IPC_CHANNELS.removeLocalCopy, async (_event, id: string) => {
    const result = await service.removeLocalCopy(id);
    // `io` may mean the bytes are already gone (the sidecar write failed after the rm),
    // so every window must re-list to stop offering a copy that no longer exists.
    if (result.ok || result.reason === "io") broadcastLibraryChanged();
    return result;
  });
  // ...
  ipcMain.handle(IPC_CHANNELS.deleteLocalRecording, async (_event, id: string) => {
    await currentVault().remove(id);
    // Best-effort: a missing session must never block the delete.
    await deleteVideoEditSession(id).catch(() => {});
    // Other mounted pages (the Library behind a detail page's `back()`) must drop the item.
    broadcastLibraryChanged();
  });
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/library/library-service.test.ts && bun run check-types` → PASS.

```bash
git add src/shared/types/library-item.ts src/main/library/library-service.ts src/main/library/library-service.test.ts src/main/library/index.ts
git commit -m "fix(desktop): remove-local-copy reports io failures; delete broadcasts library:changed"
```

### Task 3: Renderer handling with Retry

**Files:**

- Modify: `renderer/src/features/library/hooks/use-local-library.ts:88-95`, `:103-110`
- Modify: `renderer/src/pages/library-detail/library-detail-page.tsx:184-190` (`doRemoveLocalCopy`)
- Test: `renderer/src/features/library/hooks/use-local-library.test.tsx`, `renderer/src/pages/library-detail/library-detail-page.test.tsx`

- [ ] **Step 1: Write the failing tests**

Hook (the suite mocks `reportError` and replaces `window.electronAPI.*` with `vi.fn`):

```ts
it("removeLocalCopy re-lists on io", async () => {
  window.electronAPI.removeLocalCopy = vi.fn(async () => ({ ok: false, reason: "io" as const }));
  const { result } = renderHook(() => useLocalLibrary());
  await waitFor(() => expect(result.current.videos).toHaveLength(2));
  window.electronAPI.listLibraryItems = vi.fn(async () => ({ items: [items[1]], vaultError: null, catalogVerifiedAt: null }));
  let out: RemoveLocalCopyResult | undefined;
  await act(async () => {
    out = await result.current.removeLocalCopy("a");
  });
  expect(out).toEqual({ ok: false, reason: "io" });
  expect(result.current.videos).toHaveLength(1);
});

it("a failed delete offers a retry that deletes again", async () => {
  window.electronAPI.deleteLocalRecording = vi.fn(async () => { throw new Error("EACCES"); });
  const { result } = renderHook(() => useLocalLibrary());
  await waitFor(() => expect(result.current.videos).toHaveLength(2));
  await act(async () => { await result.current.remove("a"); });
  const retry = vi.mocked(reportError).mock.calls[0][2]?.retry;
  window.electronAPI.deleteLocalRecording = vi.fn(async () => {});
  await act(async () => { retry?.(); });
  await waitFor(() => expect(result.current.videos.map((v) => v.id)).toEqual(["b"]));
});
```

Detail page (copy the existing "toasts the blocked-reason copy" test's setup):

```tsx
it("reports an io failure with a retry action", async () => {
  window.electronAPI.removeLocalCopy = vi.fn(async () => ({ ok: false, reason: "io" as const }));
  renderDetail("asset-b");
  await waitForLoaded();
  fireEvent.click(screen.getByRole("button", { name: /remove local download/i }));
  await waitFor(() =>
    expect(getToasts()).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/delete/i), action: expect.anything() })),
  );
});

it("reports a rejected removeLocalCopy instead of an unhandled rejection", async () => {
  window.electronAPI.removeLocalCopy = vi.fn(async () => { throw new Error("ipc"); });
  renderDetail("asset-b");
  await waitForLoaded();
  fireEvent.click(screen.getByRole("button", { name: /remove local download/i }));
  await waitFor(() => expect(getToasts()).toContainEqual(expect.objectContaining({ action: expect.anything() })));
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

`use-local-library.ts`:

```ts
  const remove = useCallback(async function removeItem(id: string): Promise<void> {
    try {
      await window.electronAPI.deleteLocalRecording(id);
      setVideos((prev) => prev.filter((video) => video.id !== id));
    } catch (error) {
      reportError(t("errorDelete"), error, {
        context: { id, phase: "delete" },
        retry: () => void removeItem(id),
      });
    }
  }, []);
  // ...
  const removeLocalCopy = useCallback(
    async (id: string): Promise<RemoveLocalCopyResult> => {
      const result = await window.electronAPI.removeLocalCopy(id);
      // `io` may have deleted the bytes before failing: re-list so the UI matches the disk.
      if (result.ok || result.reason === "io") await refresh();
      return result;
    },
    [refresh],
  );
```

Update the interface doc comment of `removeLocalCopy` to mention `io`.

`library-detail-page.tsx`:

```ts
  const doRemoveLocalCopy = async (): Promise<void> => {
    if (!localId) return;
    const fail = (error: unknown): void =>
      reportError(t("errorDelete"), error, {
        context: { id: localId, phase: "remove-local-copy" },
        retry: () => void doRemoveLocalCopy(),
      });
    try {
      const result = await removeLocalCopy(localId);
      if (result.ok) return;
      if (result.reason === "io") fail(new Error("remove-local-copy: io"));
      else showToast({ message: t(removeLocalCopyBlockedKey(result.reason)) });
    } catch (error) {
      fail(error);
    }
  };
```

`doDelete` stays as is (`void remove(localId); back()`): the hook reports failures with Retry and the broadcast fixes the stale Library page.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/library/hooks/use-local-library.test.tsx src/renderer/src/pages/library-detail/library-detail-page.test.tsx && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/library/hooks/use-local-library.ts src/renderer/src/features/library/hooks/use-local-library.test.tsx src/renderer/src/pages/library-detail/library-detail-page.tsx src/renderer/src/pages/library-detail/library-detail-page.test.tsx
git commit -m "fix(desktop): delete and remove-local-copy failures surface with a retry"
```

### Task 4: Ship

- [ ] Open a PR titled `fix(desktop): safe delete ordering and handled delete failures (audit LIB-B3, LIB-B14)` linking this plan and both findings. End with **How to test it yourself**:
  1. `chflags uchg "<vault>/<id>.mp4"`, delete that item in the Library → toast "We couldn't delete the file." with Retry; the item is still listed with its title and tags. `chflags nouchg`, press Retry → the item disappears.
  2. Open an item's detail page and delete it → back on the Library, no ghost row and no manual refresh needed.
  3. On a cloud-synced item, make the sidecar read-only (`chmod 444 .kaipu/<id>.json`) and click "Remove local download" → toast with Retry; after `chmod 644` Retry succeeds and the item shows as cloud-only.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
