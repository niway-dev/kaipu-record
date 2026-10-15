---
title: "08 · Vault id collisions"
description: "Closes VID-B5: vault ids have one-second resolution and finalize never checks for an existing file, so two finalizes in the same second overwrite each other."
---

# Vault id collisions — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every vault item (recording, GIF, screenshot) gets an id that cannot name an existing file, even when two items are finalized in the same millisecond.

**Architecture:** One helper, `mintVaultId(prefix, vault)`, mints `<prefix>-YYYY-MM-DD-HH-MM-SS-mmm-xxxx` (millisecond time + 4 random hex chars) and retries while `LibraryVault.hasMedia(id)` finds a file with any extension. It replaces `timestampId` (recordings, GIFs) and `screenshotId` (screenshots). `newId` deps become async-capable; screenshot overwrites keep their id and never mint.

**Tech Stack:** Node `crypto.randomBytes`, existing `LibraryVault.hasMedia`, vitest with a temp vault directory.

**Spec:** [Audit report](/audits/2026-10-15/report/) → VID-B5 in [video lens B](/audits/2026-10-15/findings/video-b/). Closes: **VID-B5**.

## Global Constraints

- Paths below are relative to `apps/kaipu-record/src/`. Run tests from `apps/kaipu-record` with `node_modules/.bin/vitest run <file>` — never `bunx`.
- Ids must stay plain stems (`isPlainItemId`): no separators, no leading dot. Nothing parses the id format (only `humanizeId` uses it as a title fallback), so the format may change; existing items are not migrated.
- No IPC, preload or shared-type changes: ids remain `string` on the wire.
- Commit messages in English, conventional-commit style (lefthook enforces it).

## Review Focus

1. Two finalizes in the same millisecond (export finishing while a take stops) must yield different ids — pinned by test 4 in Task 1.
2. A leftover `<id>.png` must block a new `<id>.mp4` with the same stem — pinned by test 2 in Task 1 (any-extension check).
3. A screenshot **overwrite** (`meta.overwriteId` set) must keep its id — pinned by the branch kept in Task 4; a reviewer should confirm no mint happens on that path.
4. Existing tests that pass a synchronous `newId` must keep passing after the dep becomes `string | Promise<string>` — Tasks 2 and 3 run the old suites unchanged.
5. The check-then-write is not atomic across processes; the 16-bit suffix makes a residual same-ms clash ≈1/65536. Accepted; closing it fully would need `COPYFILE_EXCL` in `finalize` and `writeGif` (out of scope, noted for the next audit).

---

### Task 1: `mintVaultId` helper

**Files:**

- Create: `main/library/vault-id.ts`
- Test: `main/library/vault-id.test.ts`

**Interfaces:**

- Consumes: `LibraryVault.hasMedia(id): Promise<boolean>` (`main/library/library-vault.ts:243-250`).
- Produces: `mintVaultId(prefix: "recording" | "screenshot" | "gif", vault: Pick<LibraryVault, "hasMedia">, options?: { now?: () => number; random?: () => string }): Promise<string>`.

- [ ] **Step 1: Write the failing tests**

```ts
// main/library/vault-id.test.ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryVault } from "./library-vault";
import { mintVaultId } from "./vault-id";

describe("mintVaultId", () => {
  let directory: string;
  let vault: LibraryVault;
  const at = Date.UTC(2026, 9, 15, 12, 0, 0, 123);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-vault-id-"));
    vault = new LibraryVault(directory);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("formats the id as prefix, millisecond timestamp and suffix", async () => {
    const id = await mintVaultId("recording", vault, { now: () => at, random: () => "abcd" });
    expect(id).toBe("recording-2026-10-15-12-00-00-123-abcd");
  });

  it("retries when a file with that stem exists under any extension", async () => {
    await writeFile(join(directory, "recording-2026-10-15-12-00-00-123-aaaa.png"), "x");
    const suffixes = ["aaaa", "bbbb"];
    const id = await mintVaultId("recording", vault, { now: () => at, random: () => suffixes.shift()! });
    expect(id).toBe("recording-2026-10-15-12-00-00-123-bbbb");
  });

  it("throws after repeated collisions", async () => {
    await writeFile(join(directory, "recording-2026-10-15-12-00-00-123-aaaa.mp4"), "x");
    await expect(
      mintVaultId("recording", vault, { now: () => at, random: () => "aaaa" }),
    ).rejects.toThrow(/no free recording id/);
  });

  it("two mints in the same millisecond differ", async () => {
    const a = await mintVaultId("gif", vault, { now: () => at });
    const b = await mintVaultId("gif", vault, { now: () => at });
    expect(a).not.toBe(b);
  });

  it("sorts by time", async () => {
    const a = await mintVaultId("screenshot", vault, { now: () => at, random: () => "0000" });
    const b = await mintVaultId("screenshot", vault, { now: () => at + 1, random: () => "0000" });
    expect(a < b).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run src/main/library/vault-id.test.ts`
Expected: FAIL — `Cannot find module './vault-id'`.

- [ ] **Step 3: Write the helper**

```ts
// main/library/vault-id.ts
import { randomBytes } from "node:crypto";
import type { LibraryVault } from "./library-vault";

export type VaultIdPrefix = "recording" | "screenshot" | "gif";

export interface MintVaultIdOptions {
  now?: () => number;
  /** 4 hex chars; injectable for tests. */
  random?: () => string;
}

const MAX_ATTEMPTS = 8;

/**
 * A fresh, filesystem-safe vault id: `<prefix>-YYYY-MM-DD-HH-MM-SS-mmm-xxxx`.
 * Millisecond time keeps names sortable; the random suffix covers two mints in the
 * same millisecond; the `hasMedia` check (any extension) covers a leftover file and
 * keeps one id from ever naming both an mp4 and a gif. The check is not atomic, so
 * the suffix is what makes a concurrent mint safe in practice.
 */
export async function mintVaultId(
  prefix: VaultIdPrefix,
  vault: Pick<LibraryVault, "hasMedia">,
  options: MintVaultIdOptions = {},
): Promise<string> {
  const now = options.now ?? Date.now;
  const random = options.random ?? (() => randomBytes(2).toString("hex"));
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const stamp = new Date(now())
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "-")
      .replace("Z", "");
    const id = `${prefix}-${stamp}-${random()}`;
    if (!(await vault.hasMedia(id))) return id;
  }
  throw new Error(`mintVaultId: no free ${prefix} id after ${MAX_ATTEMPTS} attempts`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run src/main/library/vault-id.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/library/vault-id.ts src/main/library/vault-id.test.ts
git commit -m "feat(desktop): mint vault ids with ms resolution and an existence check"
```

### Task 2: Recordings use `mintVaultId`

**Files:**

- Modify: `main/recording/recording-writer.ts:10-13`, `:117-121`, delete `:161-165` (`timestampId`)
- Modify: `main/recording/recording-hub.ts:18`, `:74-78`
- Test: `main/recording/recording-writer.test.ts`

**Interfaces:**

- Consumes: `mintVaultId` from Task 1.
- Produces: `RecordingWriterDeps.newId: () => string | Promise<string>`.

- [ ] **Step 1: Add a failing test for an async `newId`**

In `main/recording/recording-writer.test.ts`, next to the existing `setup()` (which passes `newId: () => "rec-fixed"`), add:

```ts
it("accepts an async newId", async () => {
  const { writer, vaultDir } = setup({ newId: async () => "rec-async" });
  const id = writer.create();
  writer.write(id, new Uint8Array([1, 2, 3]), 0);
  const rec = await writer.finalize(id, { title: "t", durationSeconds: 1 });
  expect(rec.id).toBe("rec-async");
  expect(existsSync(join(vaultDir, "rec-async.mp4"))).toBe(true);
});
```

Adapt `setup()` to accept a partial deps override if it does not already (`setup(overrides: Partial<RecordingWriterDeps> = {})` spreading `...overrides` last). Keep every existing call site unchanged.

- [ ] **Step 2: Run to verify it fails**

Run: `node_modules/.bin/vitest run src/main/recording/recording-writer.test.ts`
Expected: FAIL — type error or `rec.id` is `"[object Promise]"`.

- [ ] **Step 3: Make `newId` async-capable and wire the hub**

`main/recording/recording-writer.ts`:

```ts
  /** Generates a filesystem-safe, sortable, unused recording id. */
  newId: () => string | Promise<string>;
```

```ts
    const vault = new LibraryVault(this.deps.vaultDir());
    const id = await this.deps.newId();
    await mkdir(this.deps.vaultDir(), { recursive: true });
    const dest = await vault.filePath(id); // <id>.mp4 (newId guarantees it is unused)
```

Delete the `timestampId` export (lines 161-165).

`main/recording/recording-hub.ts`:

```ts
import { RecordingWriter } from "./recording-writer";
import { LibraryVault } from "../library/library-vault";
import { mintVaultId } from "../library/vault-id";
// ...
  const writer = new RecordingWriter({
    vaultDir: () => vaultDirectory().path,
    newId: () => mintVaultId("recording", new LibraryVault(vaultDirectory().path)),
  });
```

- [ ] **Step 4: Run the writer suites**

Run: `node_modules/.bin/vitest run src/main/recording/recording-writer.test.ts src/main/recording/recording-writer.write-failure.test.ts src/main/recording/recording-hub.test.ts`
Expected: PASS, all existing tests plus the new one.

- [ ] **Step 5: Commit**

```bash
git add src/main/recording/recording-writer.ts src/main/recording/recording-writer.test.ts src/main/recording/recording-hub.ts
git commit -m "fix(desktop): recordings mint collision-free vault ids"
```

### Task 3: GIFs use `mintVaultId`

**Files:**

- Modify: `main/library/gif-save.ts:33-36`, `:45-47`
- Modify: `main/library/index.ts:18`, `:143-150`
- Test: `main/library/gif-save.test.ts`

- [ ] **Step 1: Add a failing test**

```ts
it("accepts an async newId", async () => {
  const recording = await saveGif({ ...deps(), newId: async () => "gif-async" }, gifBytes(), meta);
  expect(recording.id).toBe("gif-async");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node_modules/.bin/vitest run src/main/library/gif-save.test.ts`
Expected: FAIL (type error on `newId`).

- [ ] **Step 3: Implement**

`main/library/gif-save.ts`:

```ts
export interface GifSaveDeps {
  vaultDir: () => string;
  newId: () => string | Promise<string>;
  now?: () => number;
}
// ...
  const vault = new LibraryVault(deps.vaultDir());
  const id = await deps.newId();
  await vault.writeGif(id, bytes);
```

`main/library/index.ts`: remove `import { timestampId } from "../recording/recording-writer";`, add `import { mintVaultId } from "./vault-id";`, and in the `gifSave` handler:

```ts
    const recording = await saveGif(
      { vaultDir: () => vaultDirectory().path, newId: () => mintVaultId("gif", currentVault()) },
      bytes,
      meta,
    );
```

(`currentVault` is defined earlier in the same file.) The prefix changes from `recording-` to `gif-` for new GIFs; nothing parses it.

- [ ] **Step 4: Run tests and the type check**

Run: `node_modules/.bin/vitest run src/main/library/gif-save.test.ts && bun run check-types`
Expected: PASS; type check green (this is what catches any remaining `timestampId` import).

- [ ] **Step 5: Commit**

```bash
git add src/main/library/gif-save.ts src/main/library/gif-save.test.ts src/main/library/index.ts
git commit -m "fix(desktop): GIF saves mint collision-free vault ids"
```

### Task 4: Screenshots use `mintVaultId`

**Files:**

- Modify: `main/screenshots/screenshot-ipc.ts:14-18` (delete `screenshotId`), `:101-102`

`screenshot-ipc.ts` has no test (it needs Electron); the behaviour is covered by Task 1's tests plus the manual check below.

- [ ] **Step 1: Replace the id source**

Delete `screenshotId()` (lines 14-18). Add `import { mintVaultId } from "../library/vault-id";`. In the `screenshotSave` handler replace

```ts
      const id = meta.overwriteId ?? screenshotId();
      const vault = currentVault();
```

with

```ts
      const vault = currentVault();
      const id = meta.overwriteId ?? (await mintVaultId("screenshot", vault));
```

The overwrite branch keeps its id and never mints.

- [ ] **Step 2: Type check and the full desktop suite**

Run: `bun run check-types && node_modules/.bin/vitest run`
Expected: both green.

- [ ] **Step 3: Commit**

```bash
git add src/main/screenshots/screenshot-ipc.ts
git commit -m "fix(desktop): screenshots mint collision-free vault ids"
```

### Task 5: Ship

- [ ] Open a PR titled `fix(desktop): collision-free vault ids (audit VID-B5)` whose body links this plan and the finding, and ends with **How to test it yourself**:
  1. Record a few seconds and stop → the vault holds `recording-YYYY-MM-DD-HH-MM-SS-mmm-xxxx.mp4`.
  2. Start an MP4 export of a long clip, and while it finishes stop a new short recording → both items appear in the Library; neither replaces the other.
  3. Take a screenshot, save it, then edit and **Overwrite** → the same `screenshot-…` id is reused (no second item).
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
