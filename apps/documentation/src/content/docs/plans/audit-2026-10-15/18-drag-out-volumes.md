---
title: "18 · Drag-out across volumes"
description: "Closes LIB-B12: drag-out from a vault on another volume (or exFAT) copies the whole file into the OS temp dir before startDrag, and every drag wipes the previous drag's copy."
---

# Drag-out across volumes — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A titled drag-out costs a hard link (no bytes copied) whatever volume the vault is on, and a second drag never deletes a first drag's file while a drop target may still be reading it.

**Architecture:** The per-drag folder moves to `<vault>/.kaipu/drag/<uuid>/` — the vault's own volume, so `link()` works on APFS/NTFS/ext4. `drag-copies.ts` takes the vault dir as an argument and stops importing electron (testable with real temp dirs). On `EXDEV` (a mount point inside the vault) the vault file itself is returned, no copy; on any other link failure (exFAT/FAT) it falls back to `copyFile`; a failed `mkdir` (read-only vault) also returns the vault file. Pruning is by age (60 min, exported constant) at the start of each drag instead of "wipe everything"; quit and startup wipe the current vault's `.kaipu/drag` plus the legacy `<temp>/kaipu-drag`.

**Tech Stack:** Node fs (`link`, `copyFile`, `stat`, `utimes`), vitest with real temp dirs (the `gif-save.test.ts` pattern).

**Spec:** [Audit report](/audits/2026-10-15/report/) → LIB-B12 in [library lens B](/audits/2026-10-15/findings/library-b/). Closes: **LIB-B12**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- `LibraryVault.list()` does a non-recursive `readdir` filtered by media extension, so `.kaipu/drag/...` is never listed; nothing else scans `.kaipu`.
- The finding's sketch says "on link failure drag the original"; the brief chose "copy on non-EXDEV failures". This plan follows the brief: exFAT users get the title at the cost of a copy; `ENOSPC` still fails the drag with a logged error. The one-line alternative (return `vaultFile` for every link error) is noted in the PR.
- Limitation: if the user changes the vault folder, the old vault's `.kaipu/drag` is never pruned again. Links cost no space; accepted.
- Plan 16 replaces the id regex in the drag handler with `assertItemId`; independent of this plan.
- Commit messages in English, conventional-commit style.

## Review Focus

1. The drag file is a hard link (`ino` equal, `nlink === 2`) under `<vault>/.kaipu/drag/` — Task 1 test.
2. `EXDEV` → the vault file itself, `copyFile` never called, no folder left — Task 1 test.
3. A second drag keeps the first drag's file — Task 1 test.
4. `pruneDragCopies` removes only folders older than `DRAG_COPY_MAX_AGE_MS` — Task 1 test.
5. `cleanupDragCopies` removes the drag root but leaves sidecars — Task 1 test.

---

### Task 1: Rewrite `drag-copies.ts` with tests

**Files:**

- Modify: `main/library/drag-copies.ts` (full replacement)
- Create: `main/library/drag-copies.test.ts`

**Interfaces:**

- Produces: `DRAG_COPY_MAX_AGE_MS`, `dragRoot(vaultDir)`, `cleanupDragCopies(vaultDir)`, `cleanupLegacyDragCopies(tempDir)`, `pruneDragCopies(vaultDir, maxAgeMs?, now?)`, `createDragCopy(vaultDir, vaultFile, fileName, fs?)`, `interface DragCopyFs { link; copyFile }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAG_COPY_MAX_AGE_MS, cleanupDragCopies, cleanupLegacyDragCopies, createDragCopy, dragRoot, pruneDragCopies,
} from "./drag-copies";

describe("drag copies", () => {
  let vault: string;
  let file: string;
  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), "kaipu-drag-vault-"));
    file = join(vault, "rec.mp4");
    await writeFile(file, "video");
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });
  const errno = (code: string) => Object.assign(new Error(code), { code });

  it("hard-links the vault file under the friendly name inside the vault's drag folder", async () => {
    const result = await createDragCopy(vault, file, "My demo.mp4");
    expect(result.startsWith(dragRoot(vault))).toBe(true);
    expect(result.endsWith("My demo.mp4")).toBe(true);
    expect(await readFile(result, "utf-8")).toBe("video");
    expect((await stat(result)).ino).toBe((await stat(file)).ino);
    expect((await stat(file)).nlink).toBe(2);
  });

  it("falls back to copying when the link fails for a reason other than EXDEV", async () => {
    const result = await createDragCopy(vault, file, "x.mp4", { link: async () => { throw errno("EPERM"); }, copyFile });
    expect(await readFile(result, "utf-8")).toBe("video");
    expect((await stat(result)).ino).not.toBe((await stat(file)).ino);
  });

  it("returns the vault file itself and copies nothing on EXDEV", async () => {
    const copy = vi.fn();
    const result = await createDragCopy(vault, file, "x.mp4", { link: async () => { throw errno("EXDEV"); }, copyFile: copy });
    expect(result).toBe(file);
    expect(copy).not.toHaveBeenCalled();
    expect(await readdir(dragRoot(vault)).catch(() => [])).toEqual([]);
  });

  it("returns the vault file when the drag folder cannot be created", async () => {
    await writeFile(join(vault, ".kaipu"), "not a dir");
    expect(await createDragCopy(vault, file, "x.mp4")).toBe(file);
  });

  it("a second drag keeps the first drag's file", async () => {
    const first = await createDragCopy(vault, file, "One.mp4");
    const second = await createDragCopy(vault, file, "Two.mp4");
    expect(await readFile(first, "utf-8")).toBe("video");
    expect(await readFile(second, "utf-8")).toBe("video");
  });

  it("pruneDragCopies removes only folders older than the max age", async () => {
    await mkdir(join(dragRoot(vault), "old"), { recursive: true });
    await mkdir(join(dragRoot(vault), "fresh"), { recursive: true });
    const t = (Date.now() - DRAG_COPY_MAX_AGE_MS - 60_000) / 1000;
    await utimes(join(dragRoot(vault), "old"), t, t);
    await pruneDragCopies(vault);
    expect(await readdir(dragRoot(vault))).toEqual(["fresh"]);
  });

  it("pruneDragCopies does nothing when there is no drag folder", async () => {
    await expect(pruneDragCopies(vault)).resolves.toBeUndefined();
  });

  it("cleanupDragCopies removes every drag folder and leaves sidecars", async () => {
    await mkdir(join(vault, ".kaipu"), { recursive: true });
    await writeFile(join(vault, ".kaipu", "rec.json"), "{}");
    await createDragCopy(vault, file, "a.mp4");
    await createDragCopy(vault, file, "b.mp4");
    await cleanupDragCopies(vault);
    expect(await readFile(join(vault, ".kaipu", "rec.json"), "utf-8")).toBe("{}");
    await expect(stat(dragRoot(vault))).rejects.toThrow();
  });

  it("cleanupLegacyDragCopies removes <temp>/kaipu-drag", async () => {
    const temp = await mkdtemp(join(tmpdir(), "kaipu-legacy-"));
    await mkdir(join(temp, "kaipu-drag", "x"), { recursive: true });
    await cleanupLegacyDragCopies(temp);
    await expect(stat(join(temp, "kaipu-drag"))).rejects.toThrow();
    await rm(temp, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify they fail** — signature mismatch / electron import.

- [ ] **Step 3: Implement** (full file)

```ts
// main/library/drag-copies.ts
import { randomUUID } from "node:crypto";
import { copyFile, link, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/** Hidden vault folder that already holds sidecars and thumbnails; drag copies live inside it. */
const META_DIR = ".kaipu";
/** A drag folder older than this is stale: the drop target has long finished reading it. */
export const DRAG_COPY_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Parent of every per-drag directory. It lives inside the vault, so it is always on the vault's
 * volume: a hard link costs no space and no copy is needed (LIB-B12).
 */
export function dragRoot(vaultDir: string): string {
  return join(vaultDir, META_DIR, "drag");
}

/** Remove every drag copy of this vault (quit / startup). Best-effort: callers ignore failures. */
export async function cleanupDragCopies(vaultDir: string): Promise<void> {
  await rm(dragRoot(vaultDir), { recursive: true, force: true });
}

/** Remove the pre-LIB-B12 folder in the OS temp dir left by older builds. */
export async function cleanupLegacyDragCopies(tempDir: string): Promise<void> {
  await rm(join(tempDir, "kaipu-drag"), { recursive: true, force: true });
}

/**
 * Remove only the per-drag folders older than `maxAgeMs`, so a second drag never deletes the file
 * of a first drag whose drop target may still be reading it. Best-effort per folder.
 */
export async function pruneDragCopies(
  vaultDir: string,
  maxAgeMs: number = DRAG_COPY_MAX_AGE_MS,
  now: number = Date.now(),
): Promise<void> {
  const root = dragRoot(vaultDir);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return; // no drag folder yet
  }
  await Promise.all(
    entries.map(async (entry) => {
      const dir = join(root, entry);
      try {
        const info = await stat(dir);
        if (now - info.mtimeMs > maxAgeMs) await rm(dir, { recursive: true, force: true });
      } catch {
        // Gone already, or locked by a drop target: leave it for the next prune.
      }
    }),
  );
}

/** The two filesystem calls whose failure decides the fallback; injectable for tests. */
export interface DragCopyFs {
  link: (existing: string, target: string) => Promise<void>;
  copyFile: (source: string, target: string) => Promise<void>;
}

/**
 * Create `<vault>/.kaipu/drag/<uuid>/<fileName>` for the vault file and return the path to drag.
 * A hard link costs no disk space. If the link crosses devices (EXDEV) the vault file itself is
 * returned (no copy, the drag starts at once, under its id name); any other link failure (exFAT,
 * FAT) falls back to a copy. Earlier drag folders are only pruned when older than
 * `DRAG_COPY_MAX_AGE_MS`.
 */
export async function createDragCopy(
  vaultDir: string,
  vaultFile: string,
  fileName: string,
  fs: DragCopyFs = { link, copyFile },
): Promise<string> {
  await pruneDragCopies(vaultDir).catch(() => {});
  const dir = join(dragRoot(vaultDir), randomUUID());
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    return vaultFile; // read-only vault: drag the original rather than fail
  }
  const target = join(dir, fileName);
  try {
    await fs.link(vaultFile, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      return vaultFile;
    }
    await fs.copyFile(vaultFile, target);
  }
  return target;
}
```

- [ ] **Step 4: Run and commit** — `node_modules/.bin/vitest run src/main/library/drag-copies.test.ts src/main/library/drag-name.test.ts` → PASS, 9 tests.

```bash
git add src/main/library/drag-copies.ts src/main/library/drag-copies.test.ts
git commit -m "fix(desktop): drag copies live on the vault's volume and are pruned by age"
```

### Task 2: Wire the callers

**Files:**

- Modify: `main/library/index.ts:156-168`
- Modify: `main/index.ts:12`, `:354-355`, `:669`

- [ ] **Step 1: Implement**

`main/library/index.ts:168`: `? await createDragCopy(vault.directory, file, friendlyDragName(name, extname(file)))`. Update the comment: "…in `<vault>/.kaipu/drag/` (same volume), pruned when older than an hour and wiped on quit."

`main/index.ts`: import `cleanupLegacyDragCopies` next to `cleanupDragCopies`, and `vaultDirectory` from `./library/vault-location` if not already imported. Startup:

```ts
  // Drag copies left by a previous run (crash, force quit) are stale; best-effort.
  cleanupDragCopies(vaultDirectory().path).catch(() => {});
  cleanupLegacyDragCopies(app.getPath("temp")).catch(() => {});
```

Quit handler: `cleanupDragCopies(vaultDirectory().path).catch(() => {});`.

- [ ] **Step 2: Type check** — `bun run check-types && node_modules/.bin/vitest run src/main` → green.

- [ ] **Step 3: Commit**

```bash
git add src/main/library/index.ts src/main/index.ts
git commit -m "chore(desktop): drag handler and app lifecycle use the vault-local drag folder"
```

### Task 3: Ship

- [ ] Open a PR titled `fix(desktop): drag-out never copies the file and never deletes a drag in progress (audit LIB-B12)` linking this plan and the finding; mention the exFAT copy trade-off and the one-line alternative. End with **How to test it yourself**:
  1. Export an MP4 and drag the status-card thumbnail into Finder → the file carries the title; `ls -li "<vault>/.kaipu/drag/"*/` shows the same inode as `<id>.mp4`.
  2. Drag twice quickly → the first file is still there.
  3. Vault on an exFAT USB stick: the drag still works (a copy is made).
  4. Quit → `<vault>/.kaipu/drag` is gone; `$TMPDIR/kaipu-drag` from an older build is gone after the next launch.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
