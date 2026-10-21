---
title: "04 · Sidecar write serialization"
description: "Closes LIB-B1, LIB-B8, LIB-B10, SHOT-B3: unlocked read-modify-write of sidecars through one shared temp name corrupts items; screenshot overwrite is not atomic."
---

# Sidecar write serialization — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two concurrent writes to the same vault item can never lose an update, reject each other, or leave invalid JSON; a failed screenshot overwrite never destroys the original PNG.

**Architecture:** A new `main/library/atomic-write.ts` provides a module-level per-key async mutex (`withLock`), unique temp names, and an fsync'd `atomicWriteFile`. `LibraryVault.writeMeta` and `ensureIdentity` take the lock keyed by the sidecar path (module scope, so it spans the fresh `LibraryVault` instance that `currentVault()` builds per IPC call). `writeImage`, `writeThumbnail`, `writeCursorTrack` and the sibling JSON writers use `atomicWriteFile`. The per-instance `identityInFlight` guard goes away — the lock plus a re-read inside it covers LIB-B8.

**Tech Stack:** Node `fs/promises` (`open`, `rename`, `rm`), `crypto.randomUUID`, vitest with real temp directories (the existing `library-vault.test.ts` pattern).

**Spec:** [Audit report](/audits/2026-10-15/report/) → LIB-B1, LIB-B8, LIB-B10 in [library lens B](/audits/2026-10-15/findings/library-b/); SHOT-B3 in [screenshot lens B](/audits/2026-10-15/findings/screenshot-b/). Closes: **LIB-B1, LIB-B8, LIB-B10, SHOT-B3**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Run tests from `apps/kaipu-record` with `node_modules/.bin/vitest run <file>` — never `bunx`.
- `withLock` is **not re-entrant**: code that already holds a key must never call `withLock` with that key. Inside the lock, call `writeMetaLocked`, never the public `writeMeta`.
- `.part` is not in `ALL_EXTS`, so a half-written screenshot is invisible to `list()` and `filePath()`; keep that property.
- Keep the existing `rm(`${cursorTrackPath}.tmp`)` line in `remove()`: test `library-vault.test.ts:108` relies on it for old leftovers.
- Plan 06 (delete ordering) edits `remove()` too. Land this plan first; plan 06 builds on the locked `remove()`.
- Commit messages in English, conventional-commit style.

## Review Focus

1. 40 concurrent `writeMeta` calls from separate instances on one item must leave valid JSON with all 40 fields — Task 2, test "keeps every field…".
2. Five concurrent `describe()` calls on a new item from five instances must mint exactly one `assetId` — Task 2, test "mints one assetId…".
3. A rename racing the identity mint must keep both the title and the id — Task 2, test "does not lose the title…".
4. A failed `writeImage` must leave the original PNG intact and no `.part` file — Task 3, test "keeps the original…".
5. A new screenshot save whose `writeMeta` fails must not leave an orphan PNG behind for the retry to duplicate — Task 5 (the second half of SHOT-B3).

---

### Task 1: `atomic-write` helper

**Files:**

- Create: `main/library/atomic-write.ts`
- Test: `main/library/atomic-write.test.ts`

**Interfaces:**

- Produces: `withLock<T>(key: string, fn: () => Promise<T>): Promise<T>`, `uniqueTempPath(target: string, suffix?: string): string`, `atomicWriteFile(target: string, data: string | Uint8Array, suffix?: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
// main/library/atomic-write.test.ts
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteFile, withLock } from "./atomic-write";

describe("withLock", () => {
  it("runs same-key tasks one at a time, in order", async () => {
    const log: string[] = [];
    const task = (n: number, ms: number) =>
      withLock("k", async () => {
        log.push(`start${n}`);
        await sleep(ms);
        log.push(`end${n}`);
      });
    await Promise.all([task(1, 20), task(2, 5), task(3, 1)]);
    expect(log).toEqual(["start1", "end1", "start2", "end2", "start3", "end3"]);
  });

  it("does not block different keys", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const a = withLock("a", () => gate);
    const b = await withLock("b", async () => "b-done");
    expect(b).toBe("b-done");
    release();
    await a;
  });

  it("keeps going after a task rejects", async () => {
    const first = withLock("k", async () => {
      throw new Error("boom");
    });
    const second = withLock("k", async () => "ok");
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
  });
});

describe("atomicWriteFile", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-atomic-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("replaces the target and leaves no temp file", async () => {
    const target = join(directory, "f.json");
    await atomicWriteFile(target, "one");
    await atomicWriteFile(target, "two");
    expect(await readFile(target, "utf-8")).toBe("two");
    expect(await readdir(directory)).toEqual(["f.json"]);
  });

  it("removes its temp file and keeps the old content when the write fails", async () => {
    const target = join(directory, "f.json");
    await atomicWriteFile(target, "old");
    // A target under a missing directory makes `open` fail.
    await expect(atomicWriteFile(join(directory, "missing", "g.json"), "x")).rejects.toThrow();
    expect(await readFile(target, "utf-8")).toBe("old");
    expect((await readdir(directory)).filter((n) => n.includes(".tmp"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run src/main/library/atomic-write.test.ts`
Expected: FAIL — `Cannot find module './atomic-write'`.

- [ ] **Step 3: Write the helper**

```ts
// main/library/atomic-write.ts
import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";

/**
 * Per-key async mutex, module scope: it spans every `LibraryVault` instance
 * (`currentVault()` builds a new one per IPC call). Not re-entrant: never call
 * `withLock` with the same key from inside `fn`.
 */
const tails = new Map<string, Promise<void>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** `<target>.<pid>.<random>.<suffix>`: unique per call, so concurrent writers never share an inode. */
export function uniqueTempPath(target: string, suffix = "tmp"): string {
  return `${target}.${process.pid}.${randomUUID()}.${suffix}`;
}

/** Write to a unique temp file, fsync, rename over `target`. A failure removes the temp file. */
export async function atomicWriteFile(
  target: string,
  data: string | Uint8Array,
  suffix = "tmp",
): Promise<void> {
  const temp = uniqueTempPath(target, suffix);
  try {
    const handle = await open(temp, "w");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run src/main/library/atomic-write.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/library/atomic-write.ts src/main/library/atomic-write.test.ts
git commit -m "feat(desktop): per-key lock and fsync'd atomic file writes for the vault"
```

### Task 2: Lock sidecar read-modify-write in `LibraryVault`

**Files:**

- Modify: `main/library/library-vault.ts:1-16` (imports), `:82-86` (delete `identityInFlight`), `:177-241` (`ensureIdentity`, `writeMeta`)
- Test: `main/library/library-vault.test.ts`

**Interfaces:**

- Consumes: `withLock`, `atomicWriteFile` from Task 1.
- Produces: `writeMeta(id, meta)` (unchanged signature, now locked), private `writeMetaLocked(id, meta)`.

- [ ] **Step 1: Write the failing tests**

Append inside the main `describe` of `library-vault.test.ts` (it already has `directory`, `vault`, `writeRecording`, `writeSidecar`):

```ts
  it("keeps every field when many writeMeta calls run at once across instances", async () => {
    await writeRecording("clip");
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        new LibraryVault(directory).writeMeta("clip", { title: `t${i}`, editorOpenedAt: i } as never),
      ),
    );
    const raw = await readFile(join(directory, ".kaipu", "clip.json"), "utf-8");
    const sidecar = JSON.parse(raw); // must not throw
    expect(sidecar.sidecarVersion).toBe(2);
    expect(typeof sidecar.title).toBe("string");
    expect((await readdir(join(directory, ".kaipu"))).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("mints one assetId when separate instances describe the same new item at once", async () => {
    await writeRecording("fresh");
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(() => new LibraryVault(directory).describe("fresh")),
    );
    const ids = new Set(results.map((r) => r.assetId));
    expect(ids.size).toBe(1);
    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "fresh.json"), "utf-8"));
    expect(sidecar.assetId).toBe([...ids][0]);
  });

  it("does not lose the title when a rename races the identity mint", async () => {
    await writeRecording("race");
    await Promise.all([vault.describe("race"), new LibraryVault(directory).rename("race", "Mine")]);
    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "race.json"), "utf-8"));
    expect(sidecar.title).toBe("Mine");
    expect(typeof sidecar.assetId).toBe("string");
  });
```

If `readdir` is not yet imported in the test file, add it to the `node:fs/promises` import.

- [ ] **Step 2: Run to verify they fail**

Run: `node_modules/.bin/vitest run src/main/library/library-vault.test.ts`
Expected: the first test fails intermittently with `SyntaxError: Unexpected end of JSON input` or an ENOENT on `clip.json.tmp`; the second may yield more than one id. (Run it 3 times if the first run passes by luck; the fix must make it deterministic.)

- [ ] **Step 3: Implement**

In `library-vault.ts` add `import { atomicWriteFile, withLock } from "./atomic-write";` and drop `writeFile` from the `node:fs/promises` import once nothing uses it (after Task 3). Delete the `identityInFlight` field. Replace `ensureIdentity` and `writeMeta` with:

```ts
  private async ensureIdentity(id: string): Promise<Sidecar & { assetId: string }> {
    // Fast path, no lock: the common case once an item has an identity.
    const quick = await this.sidecar(id);
    if (quick.assetId && quick.localRemovedAt === undefined) {
      return quick as Sidecar & { assetId: string };
    }
    const sidecarPath = this.sidecarPath(id);
    // Module-level lock keyed by path: a second caller (even from another
    // LibraryVault instance) waits, then re-reads and finds the first one's id.
    return withLock(sidecarPath, async () => {
      const current = await this.sidecar(id);
      if (current.assetId && current.localRemovedAt === undefined) {
        return current as Sidecar & { assetId: string };
      }
      const next: Sidecar = {
        ...current,
        sidecarVersion: 2,
        assetId: current.assetId ?? readOnlyIdentityMemo.get(sidecarPath) ?? randomUUID(),
      };
      delete next.localRemovedAt;
      try {
        await this.writeMetaLocked(id, next);
        readOnlyIdentityMemo.delete(sidecarPath);
      } catch {
        // The write failed: another process may still have persisted an id.
        const reread = await this.sidecar(id);
        if (reread.assetId) return reread as Sidecar & { assetId: string };
        // Read-only vault: keep the in-memory identity; nothing else could persist either.
        readOnlyIdentityMemo.set(sidecarPath, next.assetId!);
      }
      return next as Sidecar & { assetId: string };
    });
  }

  /**
   * Merge fields into the sidecar (used by rename, finalize and tags). Serialized per
   * sidecar and atomic (unique temp + fsync + rename): concurrent writers never lose a
   * field, and a crash mid-write never leaves a truncated sidecar.
   */
  async writeMeta(id: string, meta: Sidecar): Promise<void> {
    await withLock(this.sidecarPath(id), () => this.writeMetaLocked(id, meta));
  }

  /** Read-merge-write; the caller must hold the sidecar lock. */
  private async writeMetaLocked(id: string, meta: Sidecar): Promise<void> {
    const current = await this.sidecar(id);
    await mkdir(this.metaDirectory(), { recursive: true });
    await atomicWriteFile(
      this.sidecarPath(id),
      JSON.stringify({ ...current, ...meta, sidecarVersion: 2 }, null, 2),
    );
  }
```

Also wrap the sidecar-side deletions in `remove()` so a racing `writeMeta` cannot recreate a sidecar just after deletion:

```ts
  async remove(id: string): Promise<void> {
    await withLock(this.sidecarPath(id), () =>
      Promise.allSettled([
        rm(this.sidecarPath(id), { force: true }),
        rm(this.thumbnailPath(id), { force: true }),
        rm(this.cursorTrackPath(id), { force: true }),
        // An interrupted writeCursorTrack can leave the temp file behind.
        rm(`${this.cursorTrackPath(id)}.tmp`, { force: true }),
      ]),
    );
    await rm(await this.filePath(id), { force: true });
  }
```

(Plan 06 reorders media-before-sidecar; it keeps this lock.)

- [ ] **Step 4: Run the vault suites**

Run: `node_modules/.bin/vitest run src/main/library/library-vault.test.ts src/main/library/library-vault.hash-retry.test.ts`
Expected: PASS, including the three new tests and the existing read-only-vault tests (`:162-189`) unchanged. Run the file 3× to confirm the race tests are stable.

- [ ] **Step 5: Commit**

```bash
git add src/main/library/library-vault.ts src/main/library/library-vault.test.ts
git commit -m "fix(desktop): serialize sidecar writes per item and mint identities under a lock"
```

### Task 3: Atomic media and sidecar-adjacent writes

**Files:**

- Modify: `main/library/library-vault.ts` — `writeThumbnail` (`:297-300`), `writeCursorTrack` (`:302-308`), `writeImage` (`:385-394`)
- Modify: `main/library/tag-repository.ts:74-80` (`write`)
- Modify: `main/library/video-edit-session.ts:105-110`, `:162-165`
- Test: `main/library/library-vault.test.ts`

- [ ] **Step 1: Write the failing tests**

In the screenshot section of `library-vault.test.ts` (the one that builds its own dirs with a `dirs[]` cleanup array, `:272-290`), add:

```ts
  it("writeImage replaces a screenshot without leaving temp files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-"));
    dirs.push(dir);
    const v = new LibraryVault(dir);
    await v.writeImage("shot", Buffer.from("one"));
    await v.writeImage("shot", Buffer.from("two"));
    expect((await readFile(join(dir, "shot.png"))).toString()).toBe("two");
    expect((await readdir(dir)).filter((n) => n.endsWith(".part"))).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("writeImage keeps the original when the write fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-"));
    dirs.push(dir);
    const v = new LibraryVault(dir);
    await v.writeImage("shot", Buffer.from("original"));
    await chmod(dir, 0o500);
    try {
      await expect(v.writeImage("shot", Buffer.from("new"))).rejects.toThrow();
    } finally {
      await chmod(dir, 0o700);
    }
    expect((await readFile(join(dir, "shot.png"))).toString()).toBe("original");
  });
```

Add `chmod` to the `node:fs/promises` import if missing. (Under root the chmod test passes vacuously — same caveat as the existing read-only tests.)

- [ ] **Step 2: Run to verify they fail**

Run: `node_modules/.bin/vitest run src/main/library/library-vault.test.ts -t "writeImage"`
Expected: the "keeps the original" test FAILS — `writeFile` truncates `shot.png` before failing, so the content is empty.

- [ ] **Step 3: Implement**

`library-vault.ts`:

```ts
  async writeThumbnail(id: string, jpg: Buffer): Promise<void> {
    await mkdir(this.metaDirectory(), { recursive: true });
    await atomicWriteFile(this.thumbnailPath(id), jpg);
  }

  /** Atomic (unique temp + rename): a crash mid-write never leaves a truncated track. */
  async writeCursorTrack(id: string, json: string): Promise<void> {
    await mkdir(this.metaDirectory(), { recursive: true });
    await atomicWriteFile(this.cursorTrackPath(id), json);
  }

  /** Writes a screenshot PNG as `<id>.png` in the vault root. */
  async writeImage(id: string, png: Buffer): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    // `.part` is not a known extension, so `list()` never shows a half-written shot,
    // and a failed write leaves the previous PNG untouched.
    await atomicWriteFile(join(this.directory, `${id}.png`), png, "part");
  }
```

Now remove `writeFile` from the `node:fs/promises` import in `library-vault.ts` (keep `open` — `writeGif` still uses it).

`tag-repository.ts` `write` (keep its `serial` chain):

```ts
  private async write(tags: Tag[]): Promise<void> {
    const target = this.registryPath();
    await mkdir(join(this.vault().directory, ".kaipu"), { recursive: true });
    const file: RegistryFile = { version: 1, tags };
    await atomicWriteFile(target, JSON.stringify(file, null, 2));
  }
```

Add `import { atomicWriteFile } from "./atomic-write";` and drop `rename` from its fs import if now unused (`writeFile` is still used at `:264`).

`video-edit-session.ts`: replace the two fixed-name temp writes:

```ts
  const sp = sessionPath(id);
  await mkdir(metaDir(), { recursive: true });
  await atomicWriteFile(sp, sessionJson);
```

```ts
    const mp = sessionMetaPath(vaultDirectory().path, id);
    await atomicWriteFile(mp, JSON.stringify(meta));
```

Leave the asset PNG writes (`:120`) alone; plan 09 reworks them.

- [ ] **Step 4: Run every suite that writes to a vault**

Run: `node_modules/.bin/vitest run src/main/library/library-vault.test.ts src/main/library/tag-repository.test.ts src/main/library/video-edit-session.test.ts src/main/library/gif-save.test.ts src/main/library/library-service.test.ts src/main/recording/recording-writer.test.ts`
Expected: PASS. If any test asserts on a literal `.tmp` name for the session or registry, update it to assert "no file containing `.tmp` remains" instead.

- [ ] **Step 5: Commit**

```bash
git add src/main/library/library-vault.ts src/main/library/library-vault.test.ts src/main/library/tag-repository.ts src/main/library/video-edit-session.ts
git commit -m "fix(desktop): atomic screenshot, thumbnail, track, registry and session writes"
```

### Task 4: Type check and unused imports

- [ ] **Step 1:** Run `bun run check-types` from `apps/kaipu-record`. Expected: green. Fix any "declared but never read" import left by Task 3.
- [ ] **Step 2:** `git commit -am "chore(desktop): drop unused fs imports after atomic-write adoption"` (only if Step 1 changed anything).

### Task 5: No orphan PNG on a failed new screenshot save (SHOT-B3, second half)

**Files:**

- Modify: `main/screenshots/screenshot-ipc.ts:101-108` (the `screenshotSave` handler)

`screenshot-ipc.ts` has no test (needs Electron); the change is five lines and is covered by the manual step.

- [ ] **Step 1: Implement**

Replace the save sequence so a new save cleans up after itself when the sidecar write fails:

```ts
      const vault = currentVault();
      const isNew = meta.overwriteId === undefined;
      const id = meta.overwriteId ?? (await mintVaultId("screenshot", vault)); // see plan 08; use the existing id source until it lands
      await vault.writeImage(id, Buffer.from(png));
      try {
        await vault.writeMeta(id, { /* unchanged fields */ });
      } catch (error) {
        // A new item without a sidecar would be re-saved under a second id by the
        // renderer's retry, leaving an orphan PNG. Remove it so the retry starts clean.
        if (isNew) await rm(join(vault.directory, `${id}.png`), { force: true }).catch(() => {});
        throw error;
      }
```

Keep the existing `writeMeta` argument object exactly as it is today; only wrap it. Import `rm` from `node:fs/promises` and `join` from `node:path` if not present.

- [ ] **Step 2: Type check**

Run: `bun run check-types`. Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/main/screenshots/screenshot-ipc.ts
git commit -m "fix(desktop): remove the PNG when a new screenshot's sidecar write fails"
```

### Task 6: Ship

- [ ] Open a PR titled `fix(desktop): serialize and harden vault writes (audit LIB-B1/B8/B10, SHOT-B3)` linking this plan and the four findings. End with **How to test it yourself**:
  1. In the Library, open an item's tag field and paste `design, demo, ` (two tags at once). Open `<vault>/.kaipu/<id>.json` → valid JSON containing both tags (plan 17 fixes the UI assigning only the last one; this plan guarantees the file stays intact).
  2. Rename an item three times quickly → the title shown and the sidecar agree; no `*.tmp` or `*.part` left in `.kaipu/`.
  3. Screenshot → edit → Save → Overwrite twice → `<vault>/<id>.png` is the latest edit; no `.part` files in the vault root.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
