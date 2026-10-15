---
title: "09 · Video autosave assets"
description: "Closes VID-A2 and VID-B6: every autosave re-sends and rewrites all slide PNGs (deleted slides' assets are never pruned), and overlapping saves share one .tmp path."
---

# Video autosave assets — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An autosave sends over IPC only the slide PNGs that are referenced by the scene and not yet on disk, main prunes everything the scene no longer references, and two overlapping saves for one recording never corrupt each other.

**Architecture:** No content-addressing (asset ids are already immutable UUIDs; hashing would force a migration of every `.edit.json`). The save payload gains an optional 5th argument `keepAssetIds: string[]` — every id the scene references; `assets` becomes "bytes to write if missing" and may be a subset. A new renderer helper `session-assets.ts` computes both from the scene and a per-store `WeakMap` of ids the last successful save left on disk. Main serializes saves per recording id, uses unique temp names, writes assets **before** the session JSON, skips a PNG that already exists with the same byte length, prunes PNGs not in `keepAssetIds`, and records `keepAssetIds` in the meta (the edit-project probe relies on it). A payload without `keepAssetIds` behaves exactly as today, so nothing is migrated.

**Tech Stack:** Node fs, vitest (real temp vault with the mocked `vault-location`), `renderHook` with fake timers.

**Spec:** [Audit report](/audits/2026-10-15/report/) → VID-A2 in [video lens A](/audits/2026-10-15/findings/video-a/), VID-B6 in [video lens B](/audits/2026-10-15/findings/video-b/). Closes: **VID-A2, VID-B6**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- `SlideAssetStore`'s interface does not change (tests stub it as `{ entries: () => [] }`); the saved-ids cache lives in a module-level `WeakMap` keyed by store.
- **Every** successful save — autosave, MP4 `onSaved`, GIF `onSaved` — must call `markSessionAssetsSaved(store, keepAssetIds)`, because export saves can prune; otherwise an undo/redo of a deleted slide loses its PNG.
- `meta.assetIds` must be the keep set (all referenced ids), not only the ids sent, or `edit-project-probe.ts:62-66` would stop detecting missing PNGs.
- Plan 03 makes the asset write temp-and-rename and plan 04 adds `atomicWriteFile`; this plan's `writeFileAtomic` supersedes both — if they landed first, replace their write with this one and delete the duplicate helper.
- Commit messages in English, conventional-commit style.

## Review Focus

1. Second autosave after an unrelated edit sends `assets: []` with the same `keepAssetIds` — Task 2 hook test.
2. A deleted slide's PNG is pruned on the next save; undo (reference it again) re-sends it — Task 1 test 4 + Task 2 helper test.
3. `Promise.all` of two saves for one id both resolve, final JSON is the second, no `.tmp` left — Task 1 test 5.
4. A rejected save does not mark its ids saved (the next write resends) — Task 2 hook test.
5. A PNG deleted externally while the cache says "saved" is not re-sent until relaunch; the loader drops that slide and the probe reports "missing-dependencies". Accepted; noted in the PR.

---

### Task 1: Main — serialized, atomic, incremental `saveSession`

**Files:**

- Modify: `main/library/video-edit-session.ts:68-78` (`SavePayload`), `:100-167` (`saveSession`), `:223-233` (handler)
- Modify: `shared/types/electron-api.ts:346-359`, `preload/index.ts:150-151`
- Test: `main/library/video-edit-session.test.ts`

**Interfaces:**

- Produces: `SavePayload.keepAssetIds?: string[]`; `saveVideoEditSession(id, sessionJson, assets, exported?, keepAssetIds?)`.

- [ ] **Step 1: Write the failing tests**

```ts
it("does not rewrite an asset whose file already exists with the same size", async () => {
  const dir = join(vaultDir, ".kaipu", "rec-1.assets");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "a.png"), "AAA");
  await saveSession("rec-1", { sessionJson: "{}", assets: [{ assetId: "a", bytes: bytesOf("BBB") }] });
  expect(await readFile(join(dir, "a.png"), "utf8")).toBe("AAA");
});

it("rewrites an asset whose file has a different size", async () => {
  const dir = join(vaultDir, ".kaipu", "rec-1.assets");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "a.png"), "A");
  await saveSession("rec-1", { sessionJson: "{}", assets: [{ assetId: "a", bytes: bytesOf("BBB") }] });
  expect(await readFile(join(dir, "a.png"), "utf8")).toBe("BBB");
});

it("keepAssetIds keeps files that are not re-sent and records them in the meta", async () => {
  await writeFile(join(vaultDir, "rec-1.mp4"), "video");
  await saveSession("rec-1", { sessionJson: "{}", assets: [{ assetId: "a", bytes: bytesOf("a") }, { assetId: "b", bytes: bytesOf("b") }] });
  await saveSession("rec-1", { sessionJson: "{}", assets: [], keepAssetIds: ["a", "b"] });
  expect((await readdir(join(vaultDir, ".kaipu", "rec-1.assets"))).sort()).toEqual(["a.png", "b.png"]);
  const meta = JSON.parse(await readFile(join(vaultDir, ".kaipu", "rec-1.edit.meta.json"), "utf8"));
  expect(meta.assetIds.sort()).toEqual(["a", "b"]);
});

it("keepAssetIds prunes assets the scene no longer references", async () => {
  await saveSession("rec-1", { sessionJson: "{}", assets: [{ assetId: "a", bytes: bytesOf("a") }, { assetId: "b", bytes: bytesOf("b") }] });
  await saveSession("rec-1", { sessionJson: "{}", assets: [], keepAssetIds: ["a"] });
  expect(await readdir(join(vaultDir, ".kaipu", "rec-1.assets"))).toEqual(["a.png"]);
});

it("concurrent saves for one id both succeed and leave no temp file", async () => {
  await Promise.all([
    saveSession("rec-1", { sessionJson: '{"n":1}', assets: [] }),
    saveSession("rec-1", { sessionJson: '{"n":2}', assets: [] }),
  ]);
  expect(JSON.parse(await readFile(join(vaultDir, ".kaipu", "rec-1.edit.json"), "utf8"))).toEqual({ n: 2 });
  expect((await readdir(join(vaultDir, ".kaipu"))).filter((n) => n.includes(".tmp"))).toEqual([]);
});

it("a failed save does not block the next one", async () => {
  await expect(
    saveSession("rec-1", { sessionJson: "{}", assets: [{ assetId: "x", bytes: null as unknown as ArrayBuffer }] }),
  ).rejects.toThrow();
  await expect(saveSession("rec-1", { sessionJson: "{}", assets: [] })).resolves.toBeUndefined();
});
```

(Check the meta file name via `sessionMetaPath` in the module; adjust the literal.)

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/main/library/video-edit-session.test.ts` → the same-size, keep and concurrent tests FAIL (ENOENT on the shared `.tmp`, or "a.png" rewritten/pruned wrongly).

- [ ] **Step 3: Implement**

`SavePayload`:

```ts
export interface SavePayload {
  sessionJson: string;
  /** Bytes to write if missing. With `keepAssetIds`, this may be a subset of the referenced ids. */
  assets: { assetId: string; bytes: ArrayBuffer }[];
  exported?: boolean;
  /**
   * Every asset id the saved scene references. Main keeps these and prunes all other
   * PNGs. Omit for the legacy behaviour (keep exactly the ids in `assets`).
   */
  keepAssetIds?: string[];
}
```

Module-level helpers above `saveSession`:

```ts
// Saves for one recording run one at a time, in arrival order. Two overlapping saves
// (autosave + window-close flush, autosave + export stamp) used to share one `.tmp`
// path: the first rename moved the other's half-written file and the second rename threw
// ENOENT. A chain per id also makes the exportedSavedAt read-modify-write atomic.
const saveQueues = new Map<string, Promise<void>>();
let tmpCounter = 0;

function uniqueTmp(path: string): string {
  tmpCounter += 1;
  return `${path}.${process.pid}.${tmpCounter}.tmp`;
}

export function saveSession(id: string, payload: SavePayload): Promise<void> {
  const previous = saveQueues.get(id) ?? Promise.resolve();
  const run = previous.then(() => saveSessionNow(id, payload));
  const tail = run.catch(() => undefined); // a failed save must not poison the queue
  saveQueues.set(id, tail);
  void tail.then(() => {
    if (saveQueues.get(id) === tail) saveQueues.delete(id);
  });
  return run;
}

async function writeFileAtomic(path: string, data: string | Buffer): Promise<void> {
  const tmp = uniqueTmp(path);
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

async function hasAssetOfSize(path: string, size: number): Promise<boolean> {
  try {
    return (await stat(path)).size === size;
  } catch {
    return false;
  }
}
```

Rename the old body to `async function saveSessionNow(id: string, payload: SavePayload)` with these changes (meta/source-stat/`exportedSavedAt` code stays):

```ts
  const { sessionJson, assets, exported = false } = payload;
  const keptIds = new Set(payload.keepAssetIds ?? assets.map((a) => a.assetId));

  await mkdir(metaDir(), { recursive: true });
  const ad = assetsDir(id);
  await mkdir(ad, { recursive: true });

  // Assets BEFORE the session JSON: a crash between the two must not leave a session
  // that references a PNG that was never written. Ids are immutable (UUID per image), so
  // a file of the same size is the same image and is not rewritten.
  for (const { assetId, bytes } of assets) {
    const target = assetPath(id, assetId);
    if (await hasAssetOfSize(target, bytes.byteLength)) continue;
    await writeFileAtomic(target, Buffer.from(bytes));
  }

  await writeFileAtomic(sessionPath(id), sessionJson);

  // Prune: stray temp files first (safe: saves are serialized per id), then every PNG
  // the scene no longer references.
  let existing: string[] = [];
  try {
    existing = await readdir(ad);
  } catch {
    // Dir might not exist for the very first save; skip pruning.
  }
  for (const filename of existing) {
    if (filename.endsWith(".tmp")) {
      await rm(join(ad, filename), { force: true });
      continue;
    }
    if (!filename.endsWith(".png")) continue;
    if (!keptIds.has(filename.slice(0, -4))) await rm(join(ad, filename), { force: true });
  }
  // ...meta block unchanged except the write:
  await writeFileAtomic(mp, JSON.stringify(meta));
```

Handler: add `keepAssetIds?: string[]` as the 5th parameter and pass it through. `shared/types/electron-api.ts`: add the 5th optional parameter with the doc above and fix the stale "Called once on export" comment ("Called by autosave and after each export"). `preload/index.ts`:

```ts
  saveVideoEditSession: (id, sessionJson, assets, exported, keepAssetIds) =>
    ipcRenderer.invoke(IPC_CHANNELS.videoEditSaveSession, id, sessionJson, assets, exported, keepAssetIds),
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/library/video-edit-session.test.ts src/main/library/edit-project-probe.test.ts && bun run check-types` → PASS (existing legacy-payload tests unchanged).

```bash
git add src/main/library/video-edit-session.ts src/main/library/video-edit-session.test.ts src/shared/types/electron-api.ts src/preload/index.ts
git commit -m "feat(desktop): serialized, incremental edit-session saves with keepAssetIds"
```

### Task 2: Renderer — send only what disk lacks

**Files:**

- Create: `renderer/src/features/video-editor/session-assets.ts`
- Create: `renderer/src/features/video-editor/session-assets.test.ts`
- Modify: `renderer/src/features/video-editor/use-session-autosave.ts:62-80`
- Modify: `renderer/src/pages/video-editor/video-editor-page.tsx:636-640`, `:677`, `:773-778`
- Test: `renderer/src/features/video-editor/use-session-autosave.test.ts`, run `src/renderer/src/pages/video-editor`

**Interfaces:**

- Produces: `usedSlideAssetIds(scene)`, `buildSessionAssets(scene, store, { onlyUnsaved }) → { assets, keepAssetIds }`, `markSessionAssetsSaved(store, keepAssetIds)`.

- [ ] **Step 1: Write the failing tests**

`session-assets.test.ts` (fake store `{ entries: () => [...] } as unknown as SlideAssetStore`; scene from `initialScene(10)` with slide items appended — copy the `SlideItem` shape from `scene.ts:21-30`):

```ts
import { describe, expect, it } from "vitest";
import { initialScene } from "./scene";
import type { SlideAssetStore } from "./slide-assets";
import { buildSessionAssets, markSessionAssetsSaved } from "./session-assets";

const slide = (assetId: string) =>
  ({ id: `s-${assetId}`, kind: "slide", assetId, duration: 2, naturalWidth: 4, naturalHeight: 3 }) as const;
const store = (...ids: string[]) =>
  ({ entries: () => ids.map((assetId) => ({ assetId, bytes: new ArrayBuffer(1) })) }) as unknown as SlideAssetStore;

describe("buildSessionAssets", () => {
  it("sends only referenced assets and lists all referenced ids", () => {
    const scene = { ...initialScene(10), items: [...initialScene(10).items, slide("a")] };
    const out = buildSessionAssets(scene, store("a", "deleted"), { onlyUnsaved: true });
    expect(out.assets.map((a) => a.assetId)).toEqual(["a"]);
    expect(out.keepAssetIds).toEqual(["a"]);
  });

  it("skips ids the last save left on disk, unless onlyUnsaved is false", () => {
    const s = store("a", "b");
    const scene = { ...initialScene(10), items: [...initialScene(10).items, slide("a"), slide("b")] };
    markSessionAssetsSaved(s, ["a"]);
    expect(buildSessionAssets(scene, s, { onlyUnsaved: true }).assets.map((a) => a.assetId)).toEqual(["b"]);
    expect(buildSessionAssets(scene, s, { onlyUnsaved: false }).assets.map((a) => a.assetId)).toEqual(["a", "b"]);
  });

  it("re-sends an id after a prune (undo/redo)", () => {
    const s = store("a");
    const scene = { ...initialScene(10), items: [...initialScene(10).items, slide("a")] };
    markSessionAssetsSaved(s, ["a"]);
    markSessionAssetsSaved(s, []); // a save without the slide pruned it
    expect(buildSessionAssets(scene, s, { onlyUnsaved: true }).assets.map((a) => a.assetId)).toEqual(["a"]);
  });

  it("keeps a referenced id missing from the store in keepAssetIds only", () => {
    const scene = { ...initialScene(10), items: [...initialScene(10).items, slide("gone")] };
    const out = buildSessionAssets(scene, store(), { onlyUnsaved: true });
    expect(out.assets).toEqual([]);
    expect(out.keepAssetIds).toEqual(["gone"]);
  });
});
```

`use-session-autosave.test.ts`: extend the stub to capture `(id, json, assets, exported, keepAssetIds)` and use a store mock with two entries plus a scene containing one slide:

```ts
it("sends a slide asset once, then only keepAssetIds", async () => {
  const { rerender } = render(WITH_SLIDE);
  rerender({ scene: { ...WITH_SLIDE, zoomSensitivity: 60 }, interacting: false });
  await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS); });
  expect(saved[0].assets.map((a) => a.assetId)).toEqual(["a"]);
  expect(saved[0].keepAssetIds).toEqual(["a"]);
  rerender({ scene: { ...WITH_SLIDE, zoomSensitivity: 70 }, interacting: false });
  await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS); });
  expect(saved[1].assets).toEqual([]);
  expect(saved[1].keepAssetIds).toEqual(["a"]);
});

it("re-sends the asset when the previous save rejected", async () => {
  window.electronAPI.saveVideoEditSession = vi.fn().mockRejectedValueOnce(new Error("io")).mockImplementation(record);
  const { rerender } = render(WITH_SLIDE);
  rerender({ scene: { ...WITH_SLIDE, zoomSensitivity: 60 }, interacting: false });
  await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS); });
  rerender({ scene: { ...WITH_SLIDE, zoomSensitivity: 70 }, interacting: false });
  await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS); });
  expect(saved.at(-1)!.assets.map((a) => a.assetId)).toEqual(["a"]);
});
```

- [ ] **Step 2: Run to verify they fail** — module missing / full assets sent every time.

- [ ] **Step 3: Implement**

```ts
// renderer/src/features/video-editor/session-assets.ts
/**
 * Which slide assets a session save has to carry. Asset bytes never change for a given
 * id (put() mints a new UUID, restoreAsset() keeps the saved one), so an id that the last
 * successful save already left on disk does not need to cross IPC again.
 */
import type { VideoScene } from "./scene";
import type { SlideAssetStore } from "./slide-assets";

export interface SessionAssetPayload {
  /** Bytes to write if missing: referenced by the scene and not known to be on disk. */
  assets: { assetId: string; bytes: ArrayBuffer }[];
  /** Every asset id the scene references. Main keeps exactly these and prunes the rest. */
  keepAssetIds: string[];
}

// Per store, so the editor's store lifetime is the cache lifetime. Not on the store
// interface on purpose: callers that stub the store only need `entries()`.
const savedIdsByStore = new WeakMap<SlideAssetStore, Set<string>>();

export function usedSlideAssetIds(scene: VideoScene): string[] {
  const ids = new Set<string>();
  for (const item of scene.items) if (item.kind === "slide") ids.add(item.assetId);
  return [...ids];
}

/** `onlyUnsaved: false` sends every referenced asset (export saves; main still skips existing files). */
export function buildSessionAssets(
  scene: VideoScene,
  store: SlideAssetStore,
  { onlyUnsaved }: { onlyUnsaved: boolean },
): SessionAssetPayload {
  const keepAssetIds = usedSlideAssetIds(scene);
  const keep = new Set(keepAssetIds);
  const saved = onlyUnsaved ? (savedIdsByStore.get(store) ?? new Set<string>()) : new Set<string>();
  const assets = store
    .entries()
    .filter((a) => keep.has(a.assetId) && !saved.has(a.assetId))
    .map((a) => ({ assetId: a.assetId, bytes: a.bytes }));
  return { assets, keepAssetIds };
}

/** Call after a save resolved: disk now holds exactly `keepAssetIds` (anything else was pruned). */
export function markSessionAssetsSaved(store: SlideAssetStore, keepAssetIds: string[]): void {
  savedIdsByStore.set(store, new Set(keepAssetIds));
}
```

`use-session-autosave.ts` `write` (replace the `assets` build + call):

```ts
      const store = assetStoreRef.current;
      const { assets, keepAssetIds } = buildSessionAssets(snapshot, store, { onlyUnsaved: true });
      await window.electronAPI.saveVideoEditSession(
        sourceId,
        serializeSession(snapshot),
        assets,
        undefined,
        keepAssetIds,
      );
      markSessionAssetsSaved(store, keepAssetIds);
```

`video-editor-page.tsx` MP4 export start (replace lines 638-640):

```ts
      const { assets, keepAssetIds } = buildSessionAssets(scene, assetStoreRef.current, { onlyUnsaved: false });
      const assetStore = assetStoreRef.current;
```

and at the save (line 677):

```ts
            await window.electronAPI.saveVideoEditSession(source.id, sessionJson, assets, true, keepAssetIds);
            markSessionAssetsSaved(assetStore, keepAssetIds);
```

GIF `onSaved` (replace 775-778):

```ts
            const { assets, keepAssetIds } = buildSessionAssets(scene, assetStoreRef.current, { onlyUnsaved: false });
            await window.electronAPI.saveVideoEditSession(source.id, sessionJson, assets, true, keepAssetIds);
            markSessionAssetsSaved(assetStoreRef.current, keepAssetIds);
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/video-editor/session-assets.test.ts src/renderer/src/features/video-editor/use-session-autosave.test.ts src/renderer/src/pages/video-editor && bun run check-types` → PASS. If a page test pins the exact `saveVideoEditSession` argument list with `toHaveBeenCalledWith(..., true)`, extend it with the 5th argument.

```bash
git add src/renderer/src/features/video-editor/session-assets.ts src/renderer/src/features/video-editor/session-assets.test.ts src/renderer/src/features/video-editor/use-session-autosave.ts src/renderer/src/features/video-editor/use-session-autosave.test.ts src/renderer/src/pages/video-editor/video-editor-page.tsx
git commit -m "feat(desktop): autosave sends only slide assets the vault lacks and prunes the rest"
```

### Task 3: Ship

- [ ] Open a PR titled `perf(desktop): incremental and serialized edit-session saves (audit VID-A2, VID-B6)` linking this plan and both findings; note the accepted gap (externally deleted PNG not re-sent until relaunch). End with **How to test it yourself**:
  1. Open a recording in the editor, paste two images, wait for "Saved", delete one slide, wait for "Saved" → `<vault>/.kaipu/<id>.assets/` holds only the used PNG and its mtime does not change on further edits.
  2. Undo the delete → after the next "Saved" the PNG is back.
  3. Make an edit and close the window immediately; reopen → the slide survives, and `.kaipu/` has no `*.tmp`.
  4. (Optional measurement) temporarily log `assets.reduce((n, a) => n + a.bytes.byteLength, 0)` in the main handler: after the first save every autosave logs `0`.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
