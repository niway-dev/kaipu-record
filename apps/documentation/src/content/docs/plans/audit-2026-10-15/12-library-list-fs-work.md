---
title: "12 · Library list fs work"
description: "Closes LIB-A5: every list probes up to four extensions per item sequentially, runs two edit-session probes per item serially (reading the meta file twice), and compares catalogs with a double JSON.stringify."
---

# Library list fs work — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A library list does the minimum filesystem work per item: no extension probing (readdir already knows it), one combined edit-state probe with a single meta read, probes running 16 at a time instead of serially, and a cheap `lastSeenLocalId` comparison instead of stringifying two catalogs.

**Architecture:** `LibraryVault.list()` passes each file's extension into `describe(id, knownExt)` so `filePath()` is skipped; an id present under two extensions is listed once (today: twice). `edit-project-probe.ts` gains `probeEditState()` — one `.edit.json` existence check plus at most one meta read — and the two single-axis probes become thin wrappers over it. `LibraryService.list()` runs the probes through a new `mapLimit(items, 16, fn)` and compares `lastSeenLocalId` per entry. No IPC, preload or shared-type change.

**Tech Stack:** Node fs, vitest with real temp vaults (existing fixtures in `edit-project-probe.test.ts`, `library-vault.test.ts`, `library-service.test.ts`).

**Spec:** [Audit report](/audits/2026-10-15/report/) → LIB-A5 in [library lens A](/audits/2026-10-15/findings/library-a/). Closes: **LIB-A5**.

Ops per item, counted from the code (steady state, one fs call ≈ one round trip):

| Item                            | Before | After |
| ------------------------------- | ------ | ----- |
| mp4, no session                 | 6      | 4     |
| png, no session                 | 7      | 3     |
| gif, no session                 | 9      | 4     |
| mp4 with a session and N assets | 10+N   | 6+N   |

The probe phase also goes from n serial iterations to 16 in flight: at n=500 and 3 ms per round trip (network drive), ≈3 s → ≈0.1 s. Arithmetic, not a measurement.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- `filePath(id)` stays unchanged: `recording-writer.ts:120` relies on its `.mp4` default for a file that does not exist yet. `describe(id)` with one argument keeps working (five callers).
- `probeEditing` and `probeEditSession` keep their exports and exact behaviour (`edit-project-probe.test.ts` uses them).
- Behaviour changes to state in the PR: (1) an id present as both `x.mp4` and `x.webm` lists once (`ALL_EXTS` order wins) instead of twice; (2) a meta file failing to read with something other than ENOENT/ENOTDIR (EACCES, EIO) now counts as corrupt → `missing-dependencies`, where before `probeEditing`'s `access` check read it as absent.
- This does not close LIB-A1 (plan 10); it halves the cost of each list.
- Commit messages in English, conventional-commit style.

## Review Focus

1. `list()` on a vault with `a.mp4`, `b.png`, `c.gif` must issue no `access` call on any `<id>.<media ext>` path — Task 2 ops test (proves "filePath never probes").
2. `probeEditState` must read `.edit.meta.json` exactly once — Task 3 reads test.
3. `dup.mp4` + `dup.webm` → one record whose `filePath` ends `.mp4` — Task 2 test.
4. `mapLimit` never exceeds its limit and keeps input order; the first rejection stops new work — Task 1 tests.
5. A cached entry whose linked file disappeared must still trigger one cache rewrite (`lastSeenLocalId → null`) — Task 4 test.

---

### Task 1: `mapLimit` helper

**Files:**

- Create: `main/library/map-limit.ts`
- Test: `main/library/map-limit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { mapLimit } from "./map-limit";

describe("mapLimit", () => {
  it("keeps input order", async () => {
    const out = await mapLimit([3, 1, 2], 2, async (n) => {
      await sleep(n);
      return n * 10;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it("never exceeds the limit in flight", async () => {
    let inFlight = 0;
    let max = 0;
    await mapLimit(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await sleep(1);
      inFlight -= 1;
    });
    expect(max).toBe(3);
  });

  it("returns [] for empty input", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });

  it("rejects with the first error and starts no later items", async () => {
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(started).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module missing.

- [ ] **Step 3: Implement**

```ts
// main/library/map-limit.ts
/**
 * `Promise.all(items.map(fn))` with at most `limit` calls in flight. Results keep the
 * input order; the first rejection rejects the whole call and stops workers from
 * picking up new items. Used to probe every library item without opening hundreds of
 * files at once on a network drive.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: Run and commit** — PASS, 4 tests.

```bash
git add src/main/library/map-limit.ts src/main/library/map-limit.test.ts
git commit -m "feat(desktop): mapLimit helper for bounded-concurrency probes"
```

### Task 2: `list()` passes the extension to `describe`

**Files:**

- Modify: `main/library/library-vault.ts:114-132`
- Test: `main/library/library-vault.test.ts`, create `main/library/library-vault.list-ops.test.ts`

**Interfaces:**

- Produces: `describe(id: string, knownExt?: (typeof ALL_EXTS)[number])`.

- [ ] **Step 1: Write the failing tests**

In `library-vault.test.ts`:

```ts
it("describe(id, ext) skips probing and returns the right kind", async () => {
  await vault.writeImage("shot", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  expect((await vault.describe("shot", ".png"))?.kind).toBe("screenshot");
  expect(await vault.describe("ghost", ".png")).toBeNull();
});

it("lists an id present under two extensions once, preferring ALL_EXTS order", async () => {
  await writeFile(join(directory, "dup.mp4"), "a");
  await writeFile(join(directory, "dup.webm"), "b");
  const items = await vault.list();
  expect(items.filter((i) => i.id === "dup")).toHaveLength(1);
  expect(items.find((i) => i.id === "dup")!.filePath.endsWith("dup.mp4")).toBe(true);
});
```

`library-vault.list-ops.test.ts` (own file so the fs mock cannot disturb the main suite):

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { accessMock } = vi.hoisted(() => ({ accessMock: vi.fn() }));
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  accessMock.mockImplementation(actual.access);
  return { ...actual, access: accessMock };
});

import { LibraryVault } from "./library-vault";

describe("list() fs ops", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-ops-"));
    await writeFile(join(directory, "a.mp4"), "a");
    await writeFile(join(directory, "b.png"), "b");
    await writeFile(join(directory, "c.gif"), "c");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("never probes media extensions", async () => {
    accessMock.mockClear();
    await new LibraryVault(directory).list();
    const probed = accessMock.mock.calls
      .map(([p]) => String(p))
      .filter((p) => /\.(mp4|webm|png|gif)$/.test(p) && !p.includes(".kaipu"));
    expect(probed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — the ops test lists several probed paths; the dup test returns two items.

- [ ] **Step 3: Implement**

```ts
  async list(): Promise<LocalRecording[]> {
    await mkdir(this.directory, { recursive: true });
    // Let a readdir failure propagate (unreadable folder, unreachable network
    // drive) instead of returning [] — an empty array is indistinguishable from
    // "vault is empty" and gets rendered as the first-run empty state, which
    // reads as data loss. The caller surfaces the real error.
    const entries = await readdir(this.directory);
    // readdir already tells us each file's extension, so `describe` never probes for
    // it. An id present under two extensions (`a.mp4` + `a.webm`) is listed once, with
    // the extension `filePath` would have picked (ALL_EXTS order).
    const extById = new Map<string, (typeof ALL_EXTS)[number]>();
    for (const f of entries) {
      const ext = ALL_EXTS.find((e) => f.endsWith(e));
      if (!ext) continue;
      const id = basename(f, ext);
      const known = extById.get(id);
      if (!known || ALL_EXTS.indexOf(ext) < ALL_EXTS.indexOf(known)) extById.set(id, ext);
    }
    const described = await Promise.all([...extById].map(([id, ext]) => this.describe(id, ext)));
    return described
      .filter((r): r is LocalRecording => r !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * `knownExt` is the extension the caller already saw (`list()` via readdir); it skips
   * the sequential existence probing in `filePath`. Omit it when you only have an id.
   */
  async describe(id: string, knownExt?: (typeof ALL_EXTS)[number]): Promise<LocalRecording | null> {
    const filePath = knownExt ? join(this.directory, `${id}${knownExt}`) : await this.filePath(id);
```

The rest of `describe` is unchanged.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/library/library-vault.test.ts src/main/library/library-vault.list-ops.test.ts src/main/library/tag-repository.test.ts` → PASS (`tag-repository` iterates `list()` keyed by id; the dedupe is safe).

```bash
git add src/main/library/library-vault.ts src/main/library/library-vault.test.ts src/main/library/library-vault.list-ops.test.ts
git commit -m "perf(desktop): list() hands describe() the extension readdir already knows"
```

### Task 3: One combined edit-state probe with a single meta read

**Files:**

- Modify: `main/library/edit-project-probe.ts:31-103`
- Test: `main/library/edit-project-probe.test.ts`, create `main/library/edit-project-probe.reads.test.ts`

**Interfaces:**

- Produces: `probeEditState(vaultDir, local): Promise<{ editing: EditingState; session: EditSessionState }>`.

- [ ] **Step 1: Write the failing tests**

In `edit-project-probe.test.ts`, a new `describe("probeEditState")` reusing `local()`, `saveSession` and the temp `dir`:

```ts
it("no session → project-available with null stamps", async () => {
  await writeFile(join(dir, "r.mp4"), "v");
  expect(await probeEditState(dir, local("r", null))).toEqual({
    editing: "project-available",
    session: { savedAt: null, exportedSavedAt: null },
  });
});
it("derived item without a session → exported-only", async () => {
  await writeFile(join(dir, "r.mp4"), "v");
  expect((await probeEditState(dir, local("r", "src-asset"))).editing).toBe("exported-only");
});
it("exported session → project-available and exportedSavedAt equals savedAt", async () => {
  await writeFile(join(dir, "r.mp4"), "v");
  await saveSession("r", { sessionJson: "{}", assets: [], exported: true });
  const out = await probeEditState(dir, local("r", null));
  expect(out.editing).toBe("project-available");
  expect(out.session.exportedSavedAt).toBe(out.session.savedAt);
});
it(".edit.json without meta → project-available with nulls", async () => {
  await writeFile(join(dir, "r.mp4"), "v");
  await writeFile(join(dir, ".kaipu", "r.edit.json"), "{}");
  expect(await probeEditState(dir, local("r", null))).toEqual({ editing: "project-available", session: { savedAt: null, exportedSavedAt: null } });
});
it("corrupt meta → missing-dependencies with nulls", async () => {
  await writeFile(join(dir, "r.mp4"), "v");
  await writeFile(join(dir, ".kaipu", "r.edit.json"), "{}");
  await writeFile(sessionMetaPath(dir, "r"), "not json");
  expect(await probeEditState(dir, local("r", null))).toEqual({ editing: "missing-dependencies", session: { savedAt: null, exportedSavedAt: null } });
});
it("source changed → missing-dependencies but the stamps survive", async () => {
  await writeFile(join(dir, "r.mp4"), "v");
  await saveSession("r", { sessionJson: "{}", assets: [] });
  await writeFile(join(dir, "r.mp4"), "changed bytes");
  const out = await probeEditState(dir, local("r", null));
  expect(out.editing).toBe("missing-dependencies");
  expect(typeof out.session.savedAt).toBe("number");
});
it("source deleted → needs-source", async () => {
  await writeFile(join(dir, "r.mp4"), "v");
  await saveSession("r", { sessionJson: "{}", assets: [] });
  await rm(join(dir, "r.mp4"));
  expect((await probeEditState(dir, local("r", null))).editing).toBe("needs-source");
});
```

`edit-project-probe.reads.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("./vault-location", () => ({ vaultDirectory: () => ({ path: state.dir, isCustom: false }) }));
const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }));
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  readFileMock.mockImplementation(actual.readFile);
  return { ...actual, readFile: readFileMock };
});

import { probeEditState } from "./edit-project-probe";
import { saveSession } from "./video-edit-session";

describe("probeEditState reads", () => {
  beforeEach(async () => {
    state.dir = await mkdtemp(join(tmpdir(), "kaipu-probe-"));
    await writeFile(join(state.dir, "r.mp4"), "v");
    await saveSession("r", { sessionJson: "{}", assets: [] });
  });
  afterEach(async () => {
    await rm(state.dir, { recursive: true, force: true });
  });

  it("reads the meta sidecar exactly once", async () => {
    readFileMock.mockClear();
    await probeEditState(state.dir, { id: "r", filePath: join(state.dir, "r.mp4"), derivedFromAssetId: null });
    const metaReads = readFileMock.mock.calls.filter(([p]) => String(p).endsWith(".edit.meta.json"));
    expect(metaReads).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `probeEditState` is not exported.

- [ ] **Step 3: Implement**

Keep `exists`, `hasEditSession`, `EditSessionState`, `NO_SESSION`. Add:

```ts
export interface EditProbe {
  editing: EditingState;
  session: EditSessionState;
}

type MetaRead = { kind: "absent" } | { kind: "corrupt" } | { kind: "ok"; meta: SessionMeta };

/** One read of `.edit.meta.json`. Absent (ENOENT/ENOTDIR) is not the same as corrupt. */
async function readSessionMeta(path: string): Promise<MetaRead> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? { kind: "absent" } : { kind: "corrupt" };
  }
  try {
    return { kind: "ok", meta: JSON.parse(raw) as SessionMeta };
  } catch {
    return { kind: "corrupt" };
  }
}

function sessionStateOf(meta: SessionMeta): EditSessionState {
  return {
    savedAt: typeof meta.savedAt === "number" ? meta.savedAt : null,
    // Sessions written before the stamp existed have no field here. Reading that as
    // null means a pre-existing edited recording shows "not exported" until its next
    // export — the honest answer, since nothing recorded that it ever was.
    exportedSavedAt: typeof meta.exportedSavedAt === "number" ? meta.exportedSavedAt : null,
  };
}

/**
 * Both session axes for one local item in a single pass: one `.edit.json` existence
 * check and at most one read of the meta sidecar, shared by the editing state and the
 * save/export stamps. Never hashes. `list()` uses this; the two single-axis probes
 * below remain for callers that need only one.
 */
export async function probeEditState(
  vaultDir: string,
  local: { id: string; filePath: string; derivedFromAssetId: string | null },
): Promise<EditProbe> {
  if (!(await hasEditSession(vaultDir, local.id))) {
    return {
      editing: local.derivedFromAssetId ? "exported-only" : "project-available",
      session: NO_SESSION,
    };
  }
  const read = await readSessionMeta(sessionMetaPath(vaultDir, local.id));
  if (read.kind === "absent") {
    // A session saved before this branch has `.edit.json` but no `.edit.meta.json` —
    // there is nothing to compare the source against, so trust the session rather
    // than reporting a false "missing-dependencies" for every pre-existing project.
    return { editing: "project-available", session: NO_SESSION };
  }
  if (read.kind === "corrupt") {
    // Present but unreadable/corrupt: unlike the absent case above, this is a real
    // problem with a file that should exist and be trustworthy.
    return { editing: "missing-dependencies", session: NO_SESSION };
  }
  const { meta } = read;
  const session = sessionStateOf(meta);
  let info;
  try {
    info = await stat(local.filePath);
  } catch {
    return { editing: "needs-source", session };
  }
  if (info.size !== meta.sourceSizeBytes || info.mtimeMs !== meta.sourceMtimeMs) {
    return { editing: "missing-dependencies", session };
  }
  for (const assetId of meta.assetIds) {
    if (!(await exists(join(vaultDir, ".kaipu", `${local.id}.assets`, `${assetId}.png`)))) {
      return { editing: "missing-dependencies", session };
    }
  }
  return { editing: "project-available", session };
}

export async function probeEditing(
  vaultDir: string,
  local: { id: string; filePath: string; derivedFromAssetId: string | null } | null,
): Promise<EditingState> {
  if (!local) return "needs-source";
  return (await probeEditState(vaultDir, local)).editing;
}

export async function probeEditSession(vaultDir: string, id: string): Promise<EditSessionState> {
  if (!(await hasEditSession(vaultDir, id))) return NO_SESSION;
  const read = await readSessionMeta(sessionMetaPath(vaultDir, id));
  return read.kind === "ok" ? sessionStateOf(read.meta) : NO_SESSION;
}
```

Delete the old bodies of `probeEditing`/`probeEditSession` and fix `probeEditSession`'s doc comment ("`list()` uses `probeEditState`").

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/library/edit-project-probe.test.ts src/main/library/edit-project-probe.reads.test.ts` → PASS, existing tests unchanged.

```bash
git add src/main/library/edit-project-probe.ts src/main/library/edit-project-probe.test.ts src/main/library/edit-project-probe.reads.test.ts
git commit -m "perf(desktop): one edit-state probe per item with a single meta read"
```

### Task 4: `LibraryService.list()` — bounded parallel probes, cheap catalog diff

**Files:**

- Modify: `main/library/library-service.ts:11-16`, `:50-63`
- Test: `main/library/library-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("list() carries per-item edit state into the items", async () => {
  await writeFile(join(vaultDir, "a.mp4"), "a");
  await writeFile(join(vaultDir, "b.mp4"), "b");
  await saveSession("b", { sessionJson: "{}", assets: [] }); // needs the vault-location mock the probe suite uses
  const { items } = await service.list();
  const a = items.find((i) => i.local?.id === "a")!;
  const b = items.find((i) => i.local?.id === "b")!;
  expect(a.editing).toBe("project-available");
  expect(typeof b.editSavedAt).toBe("number");
});

it("list() rewrites the cache when a linked file disappears", async () => {
  catalog = [cloudEntry("asset-a")];
  await service.refreshCatalog();
  await cache.write(account.userId, [{ ...(await cache.read(account.userId))![0]!, lastSeenLocalId: "a" }]);
  const writeSpy = vi.spyOn(cache, "write");
  await service.list(); // no local file "a" → lastSeenLocalId must become null
  expect(writeSpy).toHaveBeenCalledTimes(1);
  expect(writeSpy.mock.calls[0][1][0]!.lastSeenLocalId).toBeNull();
});
```

(Adapt field names — `local`, `editing`, `editSavedAt` — to `@shared/types/library-item`; if `saveSession` needs the `vault-location` mock, add the same `vi.hoisted` mock the probe suite uses, pointing at `vaultDir`.)

- [ ] **Step 2: Run to verify they fail / pass** — the first may already pass (it pins behaviour across the refactor); the second passes today too. Keep both as regression guards; the refactor must keep them green.

- [ ] **Step 3: Implement**

Imports: replace `probeEditing, probeEditSession,` with `probeEditState,`; add `import { mapLimit } from "./map-limit";`. Above the class:

```ts
const PROBE_CONCURRENCY = 16;

/**
 * `composeLibrary` returns the catalog in the same order with only `lastSeenLocalId`
 * possibly changed, so comparing that one field is equivalent to comparing the JSON.
 */
function lastSeenChanged(before: CloudCatalogEntry[], after: CloudCatalogEntry[]): boolean {
  return (
    before.length !== after.length ||
    before.some((entry, i) => entry.lastSeenLocalId !== after[i]!.lastSeenLocalId)
  );
}
```

Replace lines 50-58:

```ts
    const editing: Record<string, EditingState> = {};
    const editSession: Record<string, EditSessionState> = {};
    const vaultDir = this.deps.vaultDir();
    const probes = await mapLimit(local ?? [], PROBE_CONCURRENCY, (rec) => probeEditState(vaultDir, rec));
    (local ?? []).forEach((rec, i) => {
      editing[rec.id] = probes[i]!.editing;
      editSession[rec.id] = probes[i]!.session;
    });

    const { items, catalogUpdates } = composeLibrary({ local, catalog, editing, editSession });
    if (account && catalog && local && lastSeenChanged(catalog, catalogUpdates)) {
```

(The existing comment and `cache.write(...)` below stay. A legacy entry with `lastSeenLocalId` undefined compares `!== null` and is rewritten once, as before.)

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/library && bun run check-types` → PASS, including "list() skips the cache write when the catalog is unchanged".

```bash
git add src/main/library/library-service.ts src/main/library/library-service.test.ts
git commit -m "perf(desktop): probe edit state 16 at a time and diff the catalog by lastSeenLocalId"
```

### Task 5: Ship

- [ ] Open a PR titled `perf(desktop): fewer fs ops per library list (audit LIB-A5)` linking this plan and the finding; include the ops table above and the two behaviour changes. End with **How to test it yourself**:
  1. With the vault on an external or SMB drive holding 100+ items, open the Library → it lists noticeably faster (with plan 01's `library_listed` event, compare `ms` before/after).
  2. An edited recording still shows its "not exported" badge; one whose source file changed still shows missing dependencies; one with no session shows nothing.
  3. Drop `x.mp4` and `x.webm` with the same stem into the vault → the Library shows one `x`.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
