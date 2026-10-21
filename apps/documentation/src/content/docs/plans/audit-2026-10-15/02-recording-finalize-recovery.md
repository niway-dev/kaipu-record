---
title: "02 · Recording finalize recovery"
description: "Closes REC-B6 and REC-A8: a finalize that fails after the session closes strands the finished take as an invisible .part in tmpdir, and a vault on another volume pays a full-file copy at Stop."
---

# Recording finalize recovery — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A finished recording is never lost: the `.part` is staged inside the vault (same-volume rename at Stop), finalize resolves the destination before it closes the session, a move failure keeps the file and offers "save elsewhere", and a launch sweep recovers anything left behind.

**Architecture:** `RecordingWriter.create` stages under `<vault>/.kaipu/tmp/` (falls back to `os.tmpdir()`); `finalize` resolves and creates the destination first, then closes, then moves with a `moveFile` helper that cleans a half-copied destination; a move failure throws `FinalizeMoveError`, marks the session `stranded`, and `abort` leaves a stranded `.part` on disk. The hub catches `FinalizeMoveError`, opens a native save dialog from main (the renderer toast only has one "retry" action, and retry means "start a new recording"), and tags the thrown message with a marker the renderer maps to a specific toast. A new `stranded-recordings.ts` sweep runs at launch and moves old `kaipu-rec-*.mp4.part` files into the vault as "Recovered recording".

**Tech Stack:** Node `fs/promises`, Electron `dialog.showSaveDialog` from main, `@kaipu/i18n/main` translator (precedent: `main/library/index.ts:187`), vitest with real temp dirs.

**Spec:** [Audit report](/audits/2026-10-15/report/) → REC-B6 in [record lens B](/audits/2026-10-15/findings/record-b/), REC-A8 in [record lens A](/audits/2026-10-15/findings/record-a/). Closes: **REC-B6, REC-A8**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Run tests from `apps/kaipu-record` with `node_modules/.bin/vitest run <file>` — never `bunx`. No local Playwright.
- `shared/**` takes no value imports from workspace packages (preload bundle rule). The two marker strings below live in `shared/types/ipc.ts` as plain literals.
- Explicit `tempDir` in `RecordingWriterDeps` must keep winning (every existing writer test passes one). Production never sets it.
- `list()` reads only the vault's top level filtered by media extension, so files under `.kaipu/tmp/` never appear in the Library. Keep staging under `.kaipu/`.
- New i18n keys go in both `packages/i18n/messages/en.json` and `es.json`, neutral Spanish. Rebuild `packages/i18n` if its `dist` types are generated (check its `package.json` scripts).
- Ordering with plan 08 (vault ids): if plan 08 has landed, `newId` is awaited (`await this.deps.newId()`) and `timestampId` is gone — the sweep then uses `mintVaultId("recording", vault)` instead of the `timestampId(...)-recovered` loop. Either order works; adapt the two lines.
- Commit messages in English, conventional-commit style.

## Review Focus

1. **Abort after a failed finalize must not delete the stranded `.part`** — the renderer always calls `recordingAbort` after a finalize failure (`recorder-store.ts:367`). Pinned by Task 2 test 3.
2. A vault that cannot be created at Stop must leave the session alive and the bytes intact — Task 2 test 3.
3. A cross-volume copy that fails halfway must remove the partial destination but never the `.part` — Task 2 test 5.
4. The sweep must not touch a `.part` younger than 2 minutes (another instance may still be writing) and must not promise playability for a crash-left file — Task 4 tests.
5. The parentless save dialog appears while the main window is hidden on macOS — unreviewable by test; manual step in Task 6.

---

### Task 1: Stage the `.part` inside the vault (REC-A8)

**Files:**

- Modify: `main/recording/recording-writer.ts:1-59` (imports, deps, `Session`, constructor, `create`)
- Test: `main/recording/recording-writer.test.ts`

**Interfaces:**

- Produces: `export const STAGING_DIR = join(".kaipu", "tmp")`; `RecordingWriterDeps.fallbackTempDir?: string`; `create()` unchanged signature.

- [ ] **Step 1: Write the failing tests**

Add a second setup helper and two tests to `recording-writer.test.ts`:

```ts
async function setupInVault() {
  const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
  const fallbackTempDir = await mkdtemp(join(tmpdir(), "rw-fallback-"));
  const writer = new RecordingWriter({
    vaultDir: () => vaultDir,
    newId: () => "rec-fixed",
    now: () => 5000,
    fallbackTempDir,
  });
  return { writer, vaultDir, fallbackTempDir };
}

it("stages the .part inside <vault>/.kaipu/tmp when the vault is writable", async () => {
  const { writer, vaultDir } = await setupInVault();
  const { tempPath } = await writer.create("s1");
  expect(tempPath.startsWith(join(vaultDir, ".kaipu", "tmp"))).toBe(true);
  await writer.write("s1", new TextEncoder().encode("abc").buffer, 0);
  await writer.finalize("s1", { title: "t", durationSeconds: 1 });
  expect(await readdir(join(vaultDir, ".kaipu", "tmp"))).toHaveLength(0);
  expect(await readdir(vaultDir)).toContain("rec-fixed.mp4");
});

it("falls back to the fallback temp dir when the staging folder cannot be created", async () => {
  const { fallbackTempDir } = await setupInVault();
  const blocker = join(await mkdtemp(join(tmpdir(), "rw-block-")), "file");
  await writeFile(blocker, "x");
  const writer = new RecordingWriter({
    vaultDir: () => join(blocker, "sub"), // a path under a regular file cannot be mkdir'd
    newId: () => "rec-fixed",
    fallbackTempDir,
  });
  const { tempPath } = await writer.create("s1");
  expect(tempPath.startsWith(fallbackTempDir)).toBe(true);
});
```

Add `writeFile` to the test's `node:fs/promises` import if missing.

- [ ] **Step 2: Run to verify they fail**

Run: `node_modules/.bin/vitest run src/main/recording/recording-writer.test.ts`
Expected: FAIL — `tempPath` starts with `os.tmpdir()`, and `fallbackTempDir` is not a known dep.

- [ ] **Step 3: Implement**

```ts
import { constants } from "node:fs";
import { copyFile, open, mkdir, rename, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
// ...existing type imports and LibraryVault import unchanged

/** Staging folder inside the vault, so the final move is a same-volume rename. Exported for the sweep. */
export const STAGING_DIR = join(".kaipu", "tmp");

export interface RecordingWriterDeps {
  /** Current vault directory (can change at runtime). */
  vaultDir: () => string;
  /** Generates a filesystem-safe, sortable recording id. */
  newId: () => string;
  /** Wall clock (ms) — injectable for tests. */
  now?: () => number;
  /** Forces every in-progress file into this directory (tests). Unset: stage inside the vault. */
  tempDir?: string;
  /** Used when the vault staging folder cannot be created. Default: os.tmpdir(). */
  fallbackTempDir?: string;
}

interface Session {
  handle: FileHandle;
  tempPath: string;
  queue: Promise<void>;
  failed?: Error;
  /** Handle already closed (a retried finalize must not close it twice). */
  closed?: boolean;
  /** Finalize could not place the file; the .part is kept for recovery. */
  stranded?: boolean;
}
```

In the class, replace the `tempDir` field and constructor line:

```ts
  private readonly fallbackTempDir: string;

  constructor(private readonly deps: RecordingWriterDeps) {
    this.fallbackTempDir = deps.fallbackTempDir ?? tmpdir();
    this.now = deps.now ?? (() => Date.now());
  }

  private async stagingDir(): Promise<string> {
    if (this.deps.tempDir) return this.deps.tempDir;
    try {
      const dir = join(this.deps.vaultDir(), STAGING_DIR);
      await mkdir(dir, { recursive: true });
      return dir;
    } catch {
      return this.fallbackTempDir; // vault missing/unwritable: record to tmp, finalize reports it
    }
  }

  async create(sessionId: string): Promise<{ tempPath: string }> {
    const tempPath = join(await this.stagingDir(), `kaipu-rec-${sessionId}.mp4.part`);
    const handle = await open(tempPath, "w+");
    this.sessions.set(sessionId, { handle, tempPath, queue: Promise.resolve() });
    return { tempPath };
  }
```

- [ ] **Step 4: Run the writer suites**

Run: `node_modules/.bin/vitest run src/main/recording/recording-writer.test.ts src/main/recording/recording-writer.write-failure.test.ts`
Expected: PASS (the write-failure suite passes `tempDir: "/tmp"` and keeps expecting `/tmp/kaipu-rec-s1.mp4.part`).

- [ ] **Step 5: Commit**

```bash
git add src/main/recording/recording-writer.ts src/main/recording/recording-writer.test.ts
git commit -m "feat(desktop): stage in-progress recordings inside the vault for a same-volume finalize"
```

### Task 2: Finalize resolves the destination first and keeps a stranded take (REC-B6)

**Files:**

- Modify: `main/recording/recording-writer.ts:99-153` (`finalize`, `abort`) + new `moveFile`, `FinalizeMoveError`, `closeHandle`, `salvage`
- Test: `main/recording/recording-writer.test.ts`, `main/recording/recording-writer.write-failure.test.ts`

**Interfaces:**

- Produces: `export class FinalizeMoveError extends Error { tempPath: string; cause: unknown }`; `export async function moveFile(from: string, to: string): Promise<void>`; `RecordingWriter.salvage(sessionId: string, destPath: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

In `recording-writer.test.ts`:

```ts
it("finalize keeps the session and the .part when the destination cannot be created", async () => {
  const fallbackTempDir = await mkdtemp(join(tmpdir(), "rw-fallback-"));
  const blocker = join(await mkdtemp(join(tmpdir(), "rw-block-")), "file");
  await writeFile(blocker, "x");
  const writer = new RecordingWriter({
    vaultDir: () => join(blocker, "sub"),
    newId: () => "rec-fixed",
    fallbackTempDir,
  });
  const { tempPath } = await writer.create("s1");
  await writer.write("s1", new TextEncoder().encode("hello").buffer, 0);
  await expect(writer.finalize("s1", { title: "t", durationSeconds: 1 })).rejects.toBeInstanceOf(
    FinalizeMoveError,
  );
  expect((await readFile(tempPath)).toString()).toBe("hello");
  await writer.abort("s1"); // the renderer always aborts after a failed finalize
  expect((await readFile(tempPath)).toString()).toBe("hello");
});

it("salvage moves a stranded take to the chosen path", async () => {
  const fallbackTempDir = await mkdtemp(join(tmpdir(), "rw-fallback-"));
  const blocker = join(await mkdtemp(join(tmpdir(), "rw-block-")), "file");
  await writeFile(blocker, "x");
  const writer = new RecordingWriter({
    vaultDir: () => join(blocker, "sub"),
    newId: () => "rec-fixed",
    fallbackTempDir,
  });
  const { tempPath } = await writer.create("s1");
  await writer.write("s1", new TextEncoder().encode("hello").buffer, 0);
  await writer.finalize("s1", { title: "t", durationSeconds: 1 }).catch(() => {});
  const dest = join(await mkdtemp(join(tmpdir(), "rw-else-")), "x.mp4");
  await writer.salvage("s1", dest);
  expect((await readFile(dest)).toString()).toBe("hello");
  await expect(stat(tempPath)).rejects.toThrow();
  await expect(writer.salvage("s1", dest)).rejects.toThrow(/No stranded/);
});
```

Import `FinalizeMoveError` from `./recording-writer`; add `readFile`, `stat` to the fs import if missing.

In `recording-writer.write-failure.test.ts`, add a second mocked scenario (same `vi.hoisted` + `importActual` pattern as the file's top) in a new `describe("finalize move failure")` block:

```ts
const { renameMock, copyFileMock, unlinkMock2 } = vi.hoisted(() => ({
  renameMock: vi.fn(async () => {
    throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
  }),
  copyFileMock: vi.fn(async () => {
    throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
  }),
  unlinkMock2: vi.fn(async () => {}),
}));
```

Because the file already mocks `node:fs/promises` once, put this scenario in its own file `recording-writer.move-failure.test.ts` to keep the mocks independent:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { renameMock, copyFileMock, unlinkMock } = vi.hoisted(() => ({
  renameMock: vi.fn(async () => {
    throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
  }),
  copyFileMock: vi.fn(async () => {
    throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
  }),
  unlinkMock: vi.fn(async () => {}),
}));

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return { ...actual, rename: renameMock, copyFile: copyFileMock, unlink: unlinkMock };
});

import { FinalizeMoveError, RecordingWriter } from "./recording-writer";

describe("finalize move failure", () => {
  it("removes the partial destination and keeps the .part", async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
    const tempDir = await mkdtemp(join(tmpdir(), "rw-temp-"));
    const writer = new RecordingWriter({ vaultDir: () => vaultDir, newId: () => "rec-fixed", tempDir });
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("hello").buffer, 0);
    await expect(writer.finalize("s1", { title: "t", durationSeconds: 1 })).rejects.toBeInstanceOf(
      FinalizeMoveError,
    );
    expect(unlinkMock).toHaveBeenCalledWith(join(vaultDir, "rec-fixed.mp4"));
    expect(unlinkMock).not.toHaveBeenCalledWith(tempPath);
    expect((await readFile(tempPath)).toString()).toBe("hello");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node_modules/.bin/vitest run src/main/recording/recording-writer.test.ts src/main/recording/recording-writer.move-failure.test.ts`
Expected: FAIL — `FinalizeMoveError` is not exported; `abort` deletes the `.part`.

- [ ] **Step 3: Implement**

Add after the `Session` interface:

```ts
/** Finalize could not move the finished file into the vault. The .part still exists at `tempPath`. */
export class FinalizeMoveError extends Error {
  constructor(
    readonly tempPath: string,
    readonly cause: unknown,
  ) {
    super(
      `Could not move the recording into the vault: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "FinalizeMoveError";
  }
}

/** Rename, else copy (cross-volume). A failed copy removes the half-written destination, never an existing file. */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
    return;
  } catch {
    // EXDEV or any rename failure: fall through to copy.
  }
  try {
    await copyFile(from, to, constants.COPYFILE_EXCL); // never overwrite an existing take
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") await unlink(to).catch(() => {});
    throw error;
  }
  await unlink(from).catch(() => {});
}
```

Replace the middle of `finalize` (from `await session.handle.close();` through the rename/copy block) with:

```ts
    // Resolve the destination BEFORE touching the session: a vault that vanished
    // (unplugged drive, revoked folder) must leave the take recoverable.
    const vaultDir = this.deps.vaultDir();
    const vault = new LibraryVault(vaultDir);
    const id = this.deps.newId();
    let dest: string;
    try {
      await mkdir(vaultDir, { recursive: true });
      dest = await vault.filePath(id); // <id>.mp4 (does not exist yet)
    } catch (cause) {
      session.stranded = true;
      await this.closeHandle(session).catch(() => {});
      throw new FinalizeMoveError(session.tempPath, cause);
    }
    await this.closeHandle(session);

    try {
      await moveFile(session.tempPath, dest);
    } catch (cause) {
      session.stranded = true;
      throw new FinalizeMoveError(session.tempPath, cause);
    }
    this.sessions.delete(sessionId);
```

Keep everything from `await vault.writeMeta(id, {` onward unchanged. Add the methods:

```ts
  private async closeHandle(session: Session): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    await session.handle.close();
  }

  /** Move a stranded take to a path the user picked, then forget the session. */
  async salvage(sessionId: string, destPath: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.stranded) throw new Error(`No stranded recording session "${sessionId}"`);
    await moveFile(session.tempPath, destPath);
    this.sessions.delete(sessionId);
  }
```

In `abort`, right after `if (!session) return;`:

```ts
    // A stranded take is kept on disk for recovery. The renderer aborts after every failed finalize.
    if (session.stranded) {
      this.sessions.delete(sessionId);
      return;
    }
```

- [ ] **Step 4: Run the writer suites**

Run: `node_modules/.bin/vitest run src/main/recording/recording-writer.test.ts src/main/recording/recording-writer.write-failure.test.ts src/main/recording/recording-writer.move-failure.test.ts`
Expected: PASS, including the pre-existing "abort deletes the temp file and leaves the vault empty" (a non-stranded abort still deletes).

- [ ] **Step 5: Commit**

```bash
git add src/main/recording/recording-writer.ts src/main/recording/recording-writer.test.ts src/main/recording/recording-writer.move-failure.test.ts
git commit -m "fix(desktop): keep a finished take recoverable when finalize cannot reach the vault"
```

### Task 3: "Save elsewhere" from main and a specific toast

**Files:**

- Modify: `shared/types/ipc.ts` (two marker constants)
- Modify: `main/recording/recording-hub.ts:198-229` (`recordingFinalize` catch) + `offerSaveElsewhere`
- Modify: `renderer/src/features/recording/recorder-store.ts:343-368`
- Modify: `packages/i18n/messages/en.json`, `packages/i18n/messages/es.json`
- Test: `main/recording/recording-hub.test.ts`, `renderer/src/features/recording/recorder-store.test.ts`

**Interfaces:**

- Produces: `FINALIZE_KEPT_MARKER = "[finalize:kept]"`, `FINALIZE_ELSEWHERE_MARKER = "[finalize:elsewhere]"` in `shared/types/ipc.ts`; i18n keys `record.errorSaveKept`, `record.errorSaveElsewhere`, `dialogs.saveRecordingElsewhere`.

- [ ] **Step 1: Add the markers and i18n keys**

`shared/types/ipc.ts` (plain literals — no value imports):

```ts
/** Prefixes on the `recording:finalize` rejection message; the renderer picks the toast from them. */
export const FINALIZE_KEPT_MARKER = "[finalize:kept]";
export const FINALIZE_ELSEWHERE_MARKER = "[finalize:elsewhere]";
```

`en.json` — next to `record.errorSave`:

- `record.errorSaveKept`: "We couldn't reach your recordings folder. Your recording was kept and Kaipu will recover it the next time it opens."
- `record.errorSaveElsewhere`: "Your recordings folder wasn't reachable, so the recording was saved where you chose."
- `dialogs.saveRecordingElsewhere`: "Your recordings folder isn't available. Choose where to save this recording."

`es.json`:

- `record.errorSaveKept`: "No pudimos acceder a tu carpeta de grabaciones. La grabación se conservó y Kaipu la recuperará la próxima vez que se abra."
- `record.errorSaveElsewhere`: "Tu carpeta de grabaciones no estaba disponible, así que la grabación se guardó donde elegiste."
- `dialogs.saveRecordingElsewhere`: "Tu carpeta de grabaciones no está disponible. Elige dónde guardar esta grabación."

Run the i18n package's build/typegen script if `packages/i18n/package.json` has one.

- [ ] **Step 2: Write the failing hub test**

In `recording-hub.test.ts`, add `dialog: { showSaveDialog: vi.fn(async () => ({ canceled: true })) }` to the `electron` mock object, then:

```ts
it("tags a stranded finalize with the kept marker when the user cancels the dialog", async () => {
  // Point the vault at a path under a regular file so mkdir fails at finalize.
  const blocker = join(await mkdtemp(join(tmpdir(), "hub-block-")), "file");
  await writeFile(blocker, "x");
  mockState.preferences = { vaultDir: join(blocker, "sub") }; // adapt to how this suite sets the vault
  registerRecordingHub(() => null);
  const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
  const finalize = mockState.ipcHandle.get(IPC_CHANNELS.recordingFinalize)!;
  await create({}, "s1");
  await expect(finalize({}, "s1", { title: "t", durationSeconds: 1 })).rejects.toThrow(
    FINALIZE_KEPT_MARKER,
  );
});
```

Read how the suite currently resolves `vaultDirectory()` (it mocks `app.getPath("userData")`) and set the custom vault through the same mechanism; if that is impractical, skip this test and rely on Step 4's pure-function test.

- [ ] **Step 3: Implement the hub side**

Imports in `recording-hub.ts`: add `dialog`, `app` from `electron`; `homedir` from `node:os`; `join` from `node:path`; `FinalizeMoveError` from `./recording-writer`; `FINALIZE_KEPT_MARKER`, `FINALIZE_ELSEWHERE_MARKER` from `@shared/types/ipc`; the translator the same way `main/library/index.ts:6` imports it (`createMainTranslator` from `@kaipu/i18n/main`, plus `getAppSettings`).

```ts
  function videosDir(): string {
    try {
      return app.getPath("videos");
    } catch {
      return homedir();
    }
  }

  /** The vault is unreachable: let the user pick where the finished take goes. Resolves the chosen path, or null. */
  async function offerSaveElsewhere(sessionId: string): Promise<string | null> {
    const t = createMainTranslator(getAppSettings().locale);
    const result = await dialog.showSaveDialog({
      title: t("dialogs.saveRecordingElsewhere"),
      defaultPath: join(videosDir(), `${timestampId(Date.now())}.mp4`),
      filters: [{ name: "MP4", extensions: ["mp4"] }],
    });
    if (result.canceled || !result.filePath) return null;
    try {
      await writer.salvage(sessionId, result.filePath);
      return result.filePath;
    } catch (error) {
      console.error("salvage failed", error);
      return null;
    }
  }
```

(The dialog is deliberately parentless: the main window is hidden while the control bar is up.) Finalize handler catch:

```ts
      } catch (error) {
        cursorTracks.discard(sessionId);
        clickSessions.delete(sessionId);
        stopHookIfIdle();
        if (error instanceof FinalizeMoveError) {
          const saved = await offerSaveElsewhere(sessionId);
          throw new Error(
            `${saved ? FINALIZE_ELSEWHERE_MARKER : FINALIZE_KEPT_MARKER} ${error.message}`,
          );
        }
        throw error;
      }
```

- [ ] **Step 4: Renderer toast mapping, test first**

Add a pure helper next to the store, `renderer/src/features/recording/finalize-error-message.ts`:

```ts
import { FINALIZE_ELSEWHERE_MARKER, FINALIZE_KEPT_MARKER } from "@shared/types/ipc";

export type FinalizeErrorKey = "record.errorSave" | "record.errorSaveKept" | "record.errorSaveElsewhere";

/** Picks the toast key from the marker main put on the finalize rejection. */
export function finalizeErrorKey(error: unknown): FinalizeErrorKey {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes(FINALIZE_ELSEWHERE_MARKER)) return "record.errorSaveElsewhere";
  if (text.includes(FINALIZE_KEPT_MARKER)) return "record.errorSaveKept";
  return "record.errorSave";
}
```

Test `finalize-error-message.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FINALIZE_ELSEWHERE_MARKER, FINALIZE_KEPT_MARKER } from "@shared/types/ipc";
import { finalizeErrorKey } from "./finalize-error-message";

describe("finalizeErrorKey", () => {
  it("maps the kept marker", () => {
    expect(finalizeErrorKey(new Error(`Error invoking remote method: ${FINALIZE_KEPT_MARKER} x`))).toBe(
      "record.errorSaveKept",
    );
  });
  it("maps the elsewhere marker", () => {
    expect(finalizeErrorKey(new Error(`${FINALIZE_ELSEWHERE_MARKER} x`))).toBe("record.errorSaveElsewhere");
  });
  it("falls back for any other error", () => {
    expect(finalizeErrorKey(new Error("ENOSPC"))).toBe("record.errorSave");
    expect(finalizeErrorKey("string")).toBe("record.errorSave");
  });
});
```

Run it (fails: module missing), create the helper, run again (passes). Then in `recorder-store.ts` replace the `reportError(runtimeT()("record.errorSave"), error, {...})` call with:

```ts
    reportError(runtimeT()(finalizeErrorKey(error)), error, {
      context: { sessionId: activeSessionId, phase: "finalize" },
      retry: () => {
        if (lastResolveInput) requestStartRecording(lastResolveInput);
      },
    });
    await window.electronAPI.recordingAbort(activeSessionId); // no-op for a stranded take
```

- [ ] **Step 5: Run and commit**

Run: `node_modules/.bin/vitest run src/main/recording/recording-hub.test.ts src/renderer/src/features/recording/recorder-store.test.ts src/renderer/src/features/recording/finalize-error-message.test.ts && bun run check-types`
Expected: PASS, types green.

```bash
git add src/shared/types/ipc.ts src/main/recording/recording-hub.ts src/main/recording/recording-hub.test.ts src/renderer/src/features/recording/recorder-store.ts src/renderer/src/features/recording/finalize-error-message.ts src/renderer/src/features/recording/finalize-error-message.test.ts ../../packages/i18n/messages/en.json ../../packages/i18n/messages/es.json
git commit -m "feat(desktop): offer to save a stranded recording elsewhere and say what happened"
```

### Task 4: Launch sweep for stranded `.part` files

**Files:**

- Create: `main/recording/stranded-recordings.ts`
- Test: `main/recording/stranded-recordings.test.ts`

**Interfaces:**

- Consumes: `STAGING_DIR`, `moveFile`, `timestampId` from `recording-writer.ts`; `LibraryVault.hasMedia`, `filePath`, `writeMeta`.
- Produces: `recoverStrandedRecordings(deps: { vaultDir: string; fallbackTempDir: string; now?: () => number }): Promise<{ recovered: string[]; discarded: number; failed: string[] }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// main/recording/stranded-recordings.test.ts
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STAGING_DIR } from "./recording-writer";
import { recoverStrandedRecordings } from "./stranded-recordings";

describe("recoverStrandedRecordings", () => {
  let vaultDir: string;
  let fallbackTempDir: string;
  const now = Date.UTC(2026, 9, 15, 12, 0, 0);
  const old = new Date(now - 10 * 60_000);

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "sweep-vault-"));
    fallbackTempDir = await mkdtemp(join(tmpdir(), "sweep-tmp-"));
    await mkdir(join(vaultDir, STAGING_DIR), { recursive: true });
  });
  afterEach(async () => {
    await rm(vaultDir, { recursive: true, force: true });
    await rm(fallbackTempDir, { recursive: true, force: true });
  });

  async function part(dir: string, name: string, content: string, at = old) {
    const path = join(dir, name);
    await writeFile(path, content);
    await utimes(path, at, at);
    return path;
  }

  it("recovers an old staged part into the vault as a recovered recording", async () => {
    await part(join(vaultDir, STAGING_DIR), "kaipu-rec-session-1.mp4.part", "bytes");
    const result = await recoverStrandedRecordings({ vaultDir, fallbackTempDir, now: () => now });
    expect(result.recovered).toHaveLength(1);
    const id = result.recovered[0];
    expect((await readFile(join(vaultDir, `${id}.mp4`))).toString()).toBe("bytes");
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", `${id}.json`), "utf-8"));
    expect(sidecar.title).toBe("Recovered recording");
    expect(await readdir(join(vaultDir, STAGING_DIR))).toHaveLength(0);
  });

  it("also sweeps the fallback temp dir", async () => {
    await part(fallbackTempDir, "kaipu-rec-session-2.mp4.part", "b");
    const result = await recoverStrandedRecordings({ vaultDir, fallbackTempDir, now: () => now });
    expect(result.recovered).toHaveLength(1);
  });

  it("leaves a part younger than two minutes alone", async () => {
    const path = await part(fallbackTempDir, "kaipu-rec-session-3.mp4.part", "b", new Date(now - 30_000));
    const result = await recoverStrandedRecordings({ vaultDir, fallbackTempDir, now: () => now });
    expect(result.recovered).toHaveLength(0);
    expect((await readFile(path)).toString()).toBe("b");
  });

  it("deletes an empty part and ignores other names", async () => {
    await part(fallbackTempDir, "kaipu-rec-session-4.mp4.part", "");
    await part(fallbackTempDir, "unrelated.txt", "x");
    const result = await recoverStrandedRecordings({ vaultDir, fallbackTempDir, now: () => now });
    expect(result.discarded).toBe(1);
    expect(await readdir(fallbackTempDir)).toEqual(["unrelated.txt"]);
  });

  it("gives two parts with the same mtime second distinct ids", async () => {
    await part(fallbackTempDir, "kaipu-rec-a.mp4.part", "a");
    await part(fallbackTempDir, "kaipu-rec-b.mp4.part", "b");
    const result = await recoverStrandedRecordings({ vaultDir, fallbackTempDir, now: () => now });
    expect(new Set(result.recovered).size).toBe(2);
  });

  it("returns an empty result when the staging folder is missing", async () => {
    await rm(join(vaultDir, STAGING_DIR), { recursive: true, force: true });
    const result = await recoverStrandedRecordings({ vaultDir, fallbackTempDir, now: () => now });
    expect(result).toEqual({ recovered: [], discarded: 0, failed: [] });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node_modules/.bin/vitest run src/main/recording/stranded-recordings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// main/recording/stranded-recordings.ts
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { LibraryVault } from "../library/library-vault";
import { STAGING_DIR, moveFile, timestampId } from "./recording-writer";

const PART_RE = /^kaipu-rec-.+\.mp4\.part$/;
const MIN_AGE_MS = 2 * 60_000; // another instance may still be writing a fresh file

export interface SweepDeps {
  vaultDir: string;
  /** os.tmpdir() in production: where takes land when the vault staging folder is unavailable. */
  fallbackTempDir: string;
  now?: () => number;
}

export interface SweepResult {
  /** Recording ids now in the vault. */
  recovered: string[];
  /** Empty files removed. */
  discarded: number;
  /** Paths left in place (unreadable, unmovable). */
  failed: string[];
}

/**
 * Moves finished-but-stranded takes (`kaipu-rec-*.mp4.part`) into the vault as
 * "Recovered recording". A part left by a renderer crash mid-take has no moov and
 * will not play; the title promises nothing, and the user can delete it.
 */
export async function recoverStrandedRecordings(deps: SweepDeps): Promise<SweepResult> {
  const now = (deps.now ?? Date.now)();
  const vault = new LibraryVault(deps.vaultDir);
  const result: SweepResult = { recovered: [], discarded: 0, failed: [] };
  for (const dir of [join(deps.vaultDir, STAGING_DIR), deps.fallbackTempDir]) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue; // vault unplugged or no staging folder yet: try again next launch
    }
    for (const name of names.filter((n) => PART_RE.test(n))) {
      const path = join(dir, name);
      try {
        const info = await stat(path);
        if (now - info.mtimeMs < MIN_AGE_MS) continue;
        if (info.size === 0) {
          await unlink(path);
          result.discarded += 1;
          continue;
        }
        const base = `${timestampId(info.mtimeMs)}-recovered`;
        let id = base;
        for (let n = 2; await vault.hasMedia(id); n += 1) id = `${base}-${n}`;
        await moveFile(path, await vault.filePath(id));
        await vault.writeMeta(id, {
          title: "Recovered recording",
          createdAt: info.mtimeMs,
          derivedFromAssetId: null,
        });
        result.recovered.push(id);
      } catch {
        result.failed.push(path);
      }
    }
  }
  return result;
}
```

(If plan 08 has landed: `const id = await mintVaultId("recording", vault, { now: () => info.mtimeMs });` replaces the `base`/loop lines.)

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/recording/stranded-recordings.test.ts`
Expected: PASS, 6 tests.

```bash
git add src/main/recording/stranded-recordings.ts src/main/recording/stranded-recordings.test.ts
git commit -m "feat(desktop): recover stranded recording parts into the vault at launch"
```

### Task 5: Run the sweep at launch

**Files:**

- Modify: `main/index.ts` (inside `app.whenReady`, before the first window is created — check the order around `:242` `createWindow()` and `:439` `registerRecordingHub`)

- [ ] **Step 1: Wire it**

Place this **before** `createWindow()` so the first Library list already sees recovered items; if the hub must be registered first, keep it right after `hub = registerRecordingHub(...)` and accept that recovered items appear on the next list.

```ts
  void recoverStrandedRecordings({
    vaultDir: vaultDirectory().path,
    fallbackTempDir: app.getPath("temp"),
  })
    .then((r) => {
      if (r.recovered.length) console.info(`recovered ${r.recovered.length} stranded recording(s)`);
      if (r.failed.length) console.warn("stranded recordings left in place", r.failed);
    })
    .catch((error) => console.error("stranded recording sweep failed", error));
```

Import `recoverStrandedRecordings` from `./recording/stranded-recordings`.

- [ ] **Step 2: Type check and full suite**

Run: `bun run check-types && node_modules/.bin/vitest run`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(desktop): sweep stranded recordings on launch"
```

### Task 6: Ship

- [ ] Open a PR titled `fix(desktop): never lose a finished recording when the vault is unreachable (audit REC-B6, REC-A8)` linking this plan and both findings. Mention the trade-off: a vault inside iCloud/Dropbox now syncs the growing `.part` (the finding proposed this). End with **How to test it yourself**:
  1. Settings → Files: set the vault to a USB volume or a mounted disk image. Record 5 s. While recording, `ls "<vault>/.kaipu/tmp"` shows `kaipu-rec-session-1.mp4.part`. Stop → the file lands in the vault instantly (no long "Saving…").
  2. Record again; eject the volume just before Stop. Expect the native "choose where to save" dialog. Pick a path → the toast says the recording was saved where you chose, and the file plays from there.
  3. Repeat 2 but cancel the dialog → toast says the recording was kept. Re-mount the volume, quit and relaunch → the Library shows "Recovered recording" with the take.
  4. Confirm the dialog appears in front even though the main window was hidden (macOS).
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
