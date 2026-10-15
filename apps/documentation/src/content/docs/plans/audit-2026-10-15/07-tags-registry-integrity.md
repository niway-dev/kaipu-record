---
title: "07 · Tags registry integrity"
description: "Closes LIB-A4, LIB-B7, LIB-B6: with no tags.json every tags:list re-runs the legacy import (an extra full vault scan), and an unreadable or newer tags.json is treated as 'no registry', so the next tag write erases every tag."
---

# Tags registry integrity — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The legacy tag import runs exactly once per vault; a registry that cannot be trusted (corrupt JSON, newer version, I/O error) is never overwritten; `tags:list` costs zero vault scans for users with no tags.

**Architecture:** In `VaultTagRepository.read()`, only ENOENT means "no registry" (→ import once, which now **always** persists the registry, even empty, before stripping sidecars). A parse error or wrong version throws `TagRegistryError("corrupt")` after copying the file to `tags.json.corrupt-<ts>` once per session; any other read error throws `TagRegistryError("unreadable")`. Every write path calls `read()` first, so writes are refused. `list()` returns `[]` without scanning when there are no live tags. No IPC, preload, shared-type or renderer change: `tags:list` rejects and `useTags.refresh` already shows the `errorTags` toast.

**Tech Stack:** Node fs, vitest with a real temp vault + real `LibraryVault` (the existing `tag-repository.test.ts` fixtures).

**Spec:** [Audit report](/audits/2026-10-15/report/) → LIB-A4 in [library lens A](/audits/2026-10-15/findings/library-a/), LIB-B6/B7 in [library lens B](/audits/2026-10-15/findings/library-b/). Closes: **LIB-A4, LIB-B7, LIB-B6**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- `TagSummary.count` is used by the UI (`tag-panel.tsx`, `use-library-filters.ts`), so counts stay; only the no-tags case skips the scan.
- The existing test "writes the registry atomically, leaving no temp file" asserts `readdir(.kaipu) === ["tags.json"]` after `create` — the `.corrupt-*` copy must appear only on corruption.
- `assign` checks `hasMedia` **before** `read()`; keep that order so a refused assign still leaves the vault empty (existing test).
- Behaviour change to state in the PR: a corrupt `tags.json` now makes `tags:list` reject on every mount/broadcast (the `errorTags` toast), instead of silently showing no tags and then wiping the file on the next write. Also `use-tags.ts` `create` calls `listTags()` unguarded in its catch block; with a corrupt registry `create` rejects instead of returning `null` — renderer follow-up, outside this plan.
- Plan 04 switches `write()` to `atomicWriteFile`; plan 10 drops the `summary()` scan per create/rename/recolor. Independent of this plan.
- Commit messages in English, conventional-commit style.

## Review Focus

1. First `list()` on a vault with no tags persists `{"version":1,"tags":[]}`; a legacy sidecar written afterwards is never imported — Task 1 test 1.
2. Second `list()` with no live tags must not call `vault.list()` — Task 1 test 2.
3. Corrupt `tags.json` → `create` rejects with `TagRegistryError`, bytes unchanged, exactly one `tags.json.corrupt-*` copy — Task 2 test 3.
4. `tags.json` that is a directory (EISDIR) → `unreadable`, no quarantine copy, legacy sidecars untouched — Task 2 test 5.
5. A crash between the registry write and a sidecar rewrite drops that item's Phase-1 tags (never released); accepted and documented in a code comment — Task 1 test 6 pins the order (registry first).

---

### Task 1: Import once, persist always, skip the scan when empty (LIB-A4, LIB-B7)

**Files:**

- Modify: `main/library/tag-repository.ts:82-113` (`importLegacy`), `:148-157` (`list`)
- Test: `main/library/tag-repository.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `vi` to the vitest import and a helper `const kaipu = (): string => join(directory, ".kaipu");`.

```ts
it("persists an empty registry on first list so the import never re-runs", async () => {
  await writeItem("clip");
  expect(await repo.list()).toEqual([]);
  expect((await registry()).tags).toEqual([]);
  await writeFile(join(kaipu(), "clip.json"), JSON.stringify({ tags: ["late"] }));
  expect(await repo.list()).toEqual([]);
  expect((await sidecar("clip")).tags).toEqual(["late"]);
});

it("does not scan the vault for counts when there are no live tags", async () => {
  await writeItem("clip");
  const spy = vi.spyOn(vault, "list");
  await repo.list(); // the one-time import scans
  spy.mockClear();
  await repo.list();
  expect(spy).not.toHaveBeenCalled();
});

it("writes the registry before stripping legacy tags", async () => {
  await writeItem("one");
  await mkdir(kaipu(), { recursive: true });
  await writeFile(join(kaipu(), "one.json"), JSON.stringify({ tags: ["cricut", "demo"] }));
  vi.spyOn(vault, "writeMeta").mockRejectedValueOnce(new Error("crash"));
  await expect(repo.list()).rejects.toThrow("crash");
  expect((await registry()).tags).toHaveLength(2);
});
```

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/main/library/tag-repository.test.ts` → the first FAILS (no `tags.json`, "late" gets imported), the second FAILS (scan happens), the third FAILS (registry not written).

- [ ] **Step 3: Implement**

Replace `importLegacy`:

```ts
  /**
   * No registry yet: turn the Phase 1 plain-string tags (`tags: string[]` in
   * sidecars, never released) into entities once, and point the items at them.
   */
  private async importLegacy(): Promise<Tag[]> {
    const items = await this.vault().list();
    const tags: Tag[] = [];
    const bySlug = new Map<string, Tag>();
    const assignments: Array<{ id: string; ids: string[] }> = [];
    for (const item of items) {
      const legacy = (await this.vault().sidecar(item.id)).tags;
      if (!Array.isArray(legacy) || legacy.length === 0) continue;
      const ids: string[] = [];
      for (const raw of legacy) {
        const name = typeof raw === "string" ? normalizeTagName(raw) : null;
        if (name === null) continue;
        let tag = bySlug.get(tagSlug(name));
        if (!tag) {
          tag = this.mint(name, nextTagColor(tags.map((t) => t.color)));
          tags.push(tag);
          bySlug.set(tag.slug, tag);
        }
        if (!ids.includes(tag.id)) ids.push(tag.id);
      }
      assignments.push({ id: item.id, ids });
    }
    // Registry first, even when empty: that is what makes the import run once, and
    // a crash can then never leave items pointing at tags that were not stored.
    // (A crash between here and a sidecar rewrite drops that item's Phase 1 tags,
    // which were never released — accepted.)
    await this.write(tags);
    for (const { id, ids } of assignments) {
      await this.vault().writeMeta(id, {
        tags: undefined,
        tagIds: ids,
        tagNames: ids.map((tagId) => tags.find((t) => t.id === tagId)!.name),
      });
    }
    return tags;
  }
```

In `list()`, after `const tags = (await this.serial(() => this.read())).filter((t) => t.deletedAt === null);` add:

```ts
    // No live tags (the common case): nothing to count, so skip the full vault scan.
    if (tags.length === 0) return [];
```

- [ ] **Step 4: Run and commit** — the whole file → PASS, including "imports Phase 1 string tags once, merging spellings" unchanged.

```bash
git add src/main/library/tag-repository.ts src/main/library/tag-repository.test.ts
git commit -m "fix(desktop): persist the tag registry on first list and skip the scan when there are no tags"
```

### Task 2: Untrusted registries are quarantined, never overwritten (LIB-B6)

**Files:**

- Modify: `main/library/tag-repository.ts:1-3` (imports), after `RegistryFile` (`:35-38`), the `chain` field, `read()` (`:65-72`)
- Test: `main/library/tag-repository.test.ts`

**Interfaces:**

- Produces: `export class TagRegistryError extends Error { code: "corrupt" | "unreadable" }`.

- [ ] **Step 1: Write the failing tests**

Import `TagRegistryError` from `./tag-repository`.

```ts
it("refuses writes and keeps the file when tags.json is corrupt", async () => {
  await mkdir(kaipu(), { recursive: true });
  await writeFile(join(kaipu(), "tags.json"), "{ not json");
  await expect(repo.create("X")).rejects.toBeInstanceOf(TagRegistryError);
  await expect(repo.list()).rejects.toMatchObject({ code: "corrupt" });
  await expect(repo.list()).rejects.toMatchObject({ code: "corrupt" });
  expect(await readFile(join(kaipu(), "tags.json"), "utf8")).toBe("{ not json");
  const copies = (await readdir(kaipu())).filter((n) => n.startsWith("tags.json.corrupt-"));
  expect(copies).toHaveLength(1);
  expect(await readFile(join(kaipu(), copies[0]!), "utf8")).toBe("{ not json");
});

it("treats a newer registry version as untrusted", async () => {
  await mkdir(kaipu(), { recursive: true });
  const newer = JSON.stringify({ version: 2, tags: [] });
  await writeFile(join(kaipu(), "tags.json"), newer);
  await expect(repo.create("X")).rejects.toBeInstanceOf(TagRegistryError);
  expect(await readFile(join(kaipu(), "tags.json"), "utf8")).toBe(newer);
});

it("does not treat an unreadable registry as missing", async () => {
  await writeItem("one");
  await mkdir(join(kaipu(), "tags.json"), { recursive: true }); // EISDIR on read
  await writeFile(join(kaipu(), "one.json"), JSON.stringify({ tags: ["legacy"] }));
  await expect(repo.list()).rejects.toMatchObject({ code: "unreadable" });
  expect((await readdir(kaipu())).filter((n) => n.includes(".corrupt-"))).toEqual([]);
  expect((await sidecar("one")).tags).toEqual(["legacy"]);
});
```

- [ ] **Step 2: Run to verify they fail** — today `create` succeeds and overwrites the file.

- [ ] **Step 3: Implement**

Imports: `import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";`

After `RegistryFile`:

```ts
/** The registry exists but cannot be trusted. Writes are refused so it is never overwritten. */
export class TagRegistryError extends Error {
  constructor(
    readonly code: "corrupt" | "unreadable",
    message: string,
  ) {
    super(message);
    this.name = "TagRegistryError";
  }
}
```

Next to `chain`: `private readonly quarantined = new Set<string>();`

Replace `read()` and add `quarantine()`:

```ts
  private async read(): Promise<Tag[]> {
    const path = this.registryPath();
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch (error) {
      // Only a missing file means "no registry yet". EIO/EACCES on a flaky drive
      // must not look like an empty registry, or the next write would erase it.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.importLegacy();
      throw new TagRegistryError("unreadable", `tags: cannot read ${path}: ${String(error)}`);
    }
    let parsed: Partial<RegistryFile> | null;
    try {
      parsed = JSON.parse(raw) as Partial<RegistryFile> | null;
    } catch {
      parsed = null;
    }
    if (parsed && parsed.version === 1 && Array.isArray(parsed.tags)) return parsed.tags;
    await this.quarantine(path);
    throw new TagRegistryError(
      "corrupt",
      `tags: ${path} is corrupt or from a newer version; tag changes are disabled. A copy was kept next to it.`,
    );
  }

  /** Keep a copy of an untrusted registry, once per path per session. Never touches the original. */
  private async quarantine(path: string): Promise<void> {
    if (this.quarantined.has(path)) return;
    this.quarantined.add(path);
    await copyFile(path, `${path}.corrupt-${this.now()}`).catch(() => undefined);
  }
```

(`tags.json.corrupt-<ts>` is not a media extension, so `vault.list()` never lists it. `create/rename/recolor/remove/assign` all call `read()` before any write, so the rejection stops them.)

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/library src/renderer/src/features/library/hooks && bun run check-types` → PASS.

```bash
git add src/main/library/tag-repository.ts src/main/library/tag-repository.test.ts
git commit -m "fix(desktop): never overwrite a corrupt or unreadable tag registry"
```

### Task 3: Ship

- [ ] Open a PR titled `fix(desktop): tag registry imports once and is never overwritten when untrusted (audit LIB-A4, LIB-B6, LIB-B7)` linking this plan and the findings; state the behaviour change (visible toast on a corrupt registry) and the renderer follow-up (`use-tags.ts` `create` catch block). End with **How to test it yourself**:
  1. Open the Library on a vault that never had tags → `<vault>/.kaipu/tags.json` appears as `{"version":1,"tags":[]}`; reopen the Library twice — it stays, and the Library feels no slower (no re-import).
  2. Quit; edit `tags.json` to `{bad`; reopen → toast about tags; creating a tag fails; `tags.json` is unchanged and one `tags.json.corrupt-<ts>` sits beside it.
  3. Restore a valid file → tags work again.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
