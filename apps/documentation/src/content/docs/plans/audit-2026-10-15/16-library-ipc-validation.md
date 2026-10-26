---
title: "16 · Library IPC validation"
description: "Closes LIB-B11: library IPC handlers join renderer-supplied ids into vault paths unvalidated, so delete, rename, reveal, session save and screenshot overwrite can reach outside the vault."
---

# Library IPC validation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every id that crosses the IPC boundary and ends up in a vault path is a plain file stem; anything else rejects the call before any filesystem access.

**Architecture:** One pure module `main/library/item-id.ts` (`isValidItemId`, `assertItemId`, `InvalidItemIdError`, and a `withItemId` wrapper for `ipcMain.handle` listeners) applied at the IPC boundary: the 9 id-taking handlers in `main/library/index.ts`, the two in `video-edit-session.ts` (plus the renderer-supplied `assetId`, an extra hole: `../` writes an arbitrary `.png`), the three in `screenshot-ipc.ts`, and the media protocol (replacing its private `isUnsafeId`). The guard is **not** added to `LibraryVault` path builders or `sessionMetaPath`: `list()` feeds them stems from `readdir`, and an odd imported filename would blank the Library. `isPlainItemId` stays (tags use it); the new rule is a strict superset.

**Tech Stack:** vitest (pure table tests; `video-edit-session.test.ts` with an `ipcMain` mock for the handler wiring).

**Spec:** [Audit report](/audits/2026-10-15/report/) → LIB-B11 in [library lens B](/audits/2026-10-15/findings/library-b/). Closes: **LIB-B11**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- Never put the strict guard inside `LibraryVault` or `sessionMetaPath` (internal listing callers).
- `ipcMain.handle` turns a synchronous throw into a rejected `invoke`; the renderer already handles rejections on every affected call (e.g. `use-local-library.ts:90`).
- Behaviour change: legitimate hand-imported ids containing `..` (e.g. `a..b.mp4`) become undeletable/unrenameable through the UI; they already fail to play (the protocol returns 400). Accepted to keep one rule.
- `startFileDrag` changes from a silent return to a logged error on a bad id.
- Related, out of scope: `recording-hub.ts` passes renderer `sessionId` to `recording-writer` (plan 22 switches ids to UUIDs and adds a regex there).
- Commit messages in English, conventional-commit style.

## Review Focus

1. `saveSession("../outside", …)`, `loadSession("../outside")`, `deleteVideoEditSession("../outside")` reject with `InvalidItemIdError` and a canary file outside `.kaipu` is untouched — Task 2 test.
2. `saveSession("rec-1", { assets: [{ assetId: "../../pwn" }] })` rejects **before** the session JSON is written — Task 2 test.
3. Every string `isPlainItemId` rejects, `isValidItemId` also rejects (superset) — Task 1 test.
4. `withItemId` never calls the listener for an invalid id — Task 1 test.
5. Rename, delete, reveal, drag-out, session save/load, screenshot copy/overwrite still work for real ids — manual steps (no Electron tests for `index.ts`/`screenshot-ipc.ts`).

---

### Task 1: `item-id` module

**Files:**

- Create: `main/library/item-id.ts`
- Test: `main/library/item-id.test.ts`

**Interfaces:**

- Produces: `MAX_ITEM_ID_LENGTH = 200`, `class InvalidItemIdError extends Error { code: "invalid-item-id" }`, `isValidItemId(id: unknown): id is string`, `assertItemId(id: unknown): asserts id is string`, `withItemId(listener)`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { InvalidItemIdError, assertItemId, isValidItemId, withItemId } from "./item-id";
import { isPlainItemId } from "./library-vault";

const VALID = ["rec-1", "screenshot-2026-10-15T10-00-00-000Z", "3f2b1c9e-1d2a-4b5c-8e7f-0a1b2c3d4e5f", "My video", "a.b", "é", "x".repeat(200)];
const INVALID: unknown[] = ["", ".", "..", ".hidden", "../x", "a/b", "a\\b", "a..b", "x\u0000y", "x\ny", "x".repeat(201), "/abs", undefined, null, 42, {}, ["a"]];

describe("isValidItemId", () => {
  it.each(VALID)("accepts %j", (id) => {
    expect(isValidItemId(id)).toBe(true);
    expect(() => assertItemId(id)).not.toThrow();
  });
  it.each(INVALID)("rejects %j", (id) => {
    expect(isValidItemId(id)).toBe(false);
    expect(() => assertItemId(id)).toThrow(InvalidItemIdError);
    try {
      assertItemId(id);
    } catch (e) {
      expect((e as InvalidItemIdError).code).toBe("invalid-item-id");
    }
  });
  it("is a superset of isPlainItemId's rejections", () => {
    for (const s of ["", ".x", "a/b", "a\\b", "/a"]) {
      if (!isPlainItemId(s)) expect(isValidItemId(s)).toBe(false);
    }
  });
});

describe("withItemId", () => {
  it("passes a valid id and the rest through", () => {
    const listener = vi.fn((id: string, title: string) => `${id}:${title}`);
    expect(withItemId(listener)({}, "rec-1", "T")).toBe("rec-1:T");
  });
  it("throws and never calls the listener for an invalid id", () => {
    const listener = vi.fn();
    expect(() => withItemId(listener)({}, "../x")).toThrow(InvalidItemIdError);
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module missing.

- [ ] **Step 3: Implement**

```ts
// main/library/item-id.ts
import { basename } from "node:path";

/** Longest id accepted over IPC. Real ids are timestamp or UUID stems. */
export const MAX_ITEM_ID_LENGTH = 200;

export class InvalidItemIdError extends Error {
  readonly code = "invalid-item-id";
  constructor() {
    super("library: invalid item id");
    this.name = "InvalidItemIdError";
  }
}

/**
 * True for a bare file stem. Same rule as the media protocol (no `/`, `\`, `..`) plus: a
 * string, no leading dot, no control characters or NUL, and a length cap.
 */
export function isValidItemId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= MAX_ITEM_ID_LENGTH &&
    !id.startsWith(".") &&
    !id.includes("..") &&
    !/[\\/]/.test(id) &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(id) &&
    basename(id) === id
  );
}

export function assertItemId(id: unknown): asserts id is string {
  if (!isValidItemId(id)) throw new InvalidItemIdError();
}

/** Wrap an `ipcMain.handle` listener whose first argument is an item id. */
export function withItemId<A extends unknown[], R>(
  listener: (id: string, ...rest: A) => R,
): (event: unknown, id: unknown, ...rest: A) => R {
  return (_event, id, ...rest) => {
    assertItemId(id);
    return listener(id, ...rest);
  };
}
```

- [ ] **Step 4: Run and commit** — PASS.

```bash
git add src/main/library/item-id.ts src/main/library/item-id.test.ts
git commit -m "feat(desktop): one item-id rule for every IPC boundary"
```

### Task 2: Guard the edit-session module (ids and asset ids)

**Files:**

- Modify: `main/library/video-edit-session.ts:24-34` (path helpers), `saveSession` (first statements), `loadSession` (first line)
- Test: `main/library/video-edit-session.test.ts`

- [ ] **Step 1: Write the failing tests** (add `vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));` above the module import)

```ts
it("rejects a traversal id on save, load and delete, leaving files outside .kaipu untouched", async () => {
  const canary = join(vaultDir, "outside.edit.json");
  await writeFile(canary, "canary");
  await expect(saveSession("../outside", { sessionJson: "{}", assets: [] })).rejects.toBeInstanceOf(InvalidItemIdError);
  await expect(loadSession("../outside")).rejects.toBeInstanceOf(InvalidItemIdError);
  await expect(deleteVideoEditSession("../outside")).rejects.toBeInstanceOf(InvalidItemIdError);
  expect(await readFile(canary, "utf8")).toBe("canary");
});

it("rejects a traversal asset id before writing the session", async () => {
  await expect(
    saveSession("rec-1", { sessionJson: "{}", assets: [{ assetId: "../../pwn", bytes: bytesOf("x") }] }),
  ).rejects.toBeInstanceOf(InvalidItemIdError);
  await expect(readFile(join(vaultDir, ".kaipu", "rec-1.edit.json"))).rejects.toThrow();
  expect(await readdir(vaultDir)).not.toContain("pwn.png");
});

it("the IPC handlers reject an invalid id", async () => {
  const { ipcMain } = await import("electron");
  registerVideoEditSessionHandlers();
  const load = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === IPC_CHANNELS.videoEditLoadSession)![1];
  await expect(load({} as never, "../x")).rejects.toBeInstanceOf(InvalidItemIdError);
  await expect(load({} as never, "never-saved")).resolves.toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail** — the traversal calls resolve (and the first writes outside the vault).

- [ ] **Step 3: Implement**

```ts
import { assertItemId } from "./item-id";

function sessionPath(id: string): string {
  assertItemId(id);
  return join(metaDir(), `${id}.edit.json`);
}
function assetsDir(id: string): string {
  assertItemId(id);
  return join(metaDir(), `${id}.assets`);
}
function assetPath(id: string, assetId: string): string {
  assertItemId(assetId);
  return join(assetsDir(id), `${assetId}.png`);
}
```

`saveSession`: first statements after destructuring the payload — `assertItemId(id); for (const { assetId } of assets) assertItemId(assetId);`. `loadSession`: first line `assertItemId(id);` (otherwise the `try { readFile }` would swallow the helper's throw and return `null`). Leave `sessionMetaPath` unchanged (called by the probe with listed ids). `deleteVideoEditSession` evaluates `sessionPath(id)` while building its array, so it rejects before any `rm`.

- [ ] **Step 4: Run and commit** — `node_modules/.bin/vitest run src/main/library/video-edit-session.test.ts src/main/library/edit-project-probe.test.ts` → PASS.

```bash
git add src/main/library/video-edit-session.ts src/main/library/video-edit-session.test.ts
git commit -m "fix(desktop): edit-session ids and asset ids are validated before any path is built"
```

### Task 3: Guard the library, screenshot and protocol handlers

**Files:**

- Modify: `main/library/index.ts` (import; handlers at `:76-80`, `:89-98`, `:131-142`, `:160`)
- Modify: `main/screenshots/screenshot-ipc.ts:67-70`, `:89-92`, before `:101`
- Modify: `main/media-protocol.ts:17-19`, `:90`

No Electron-free test reaches these; the shared `withItemId` is tested in Task 1 and the manual steps cover wiring.

- [ ] **Step 1: Implement**

`main/library/index.ts` — `import { assertItemId, withItemId } from "./item-id";` and rewrite the id handlers (bodies unchanged):

```ts
  ipcMain.handle(IPC_CHANNELS.removeLocalCopy, withItemId(async (id) => {
    const result = await service.removeLocalCopy(id);
    if (result.ok) broadcastLibraryChanged();
    return result;
  }));
  ipcMain.handle(IPC_CHANNELS.loadCursorTrack, withItemId((id) => currentVault().readCursorTrack(id)));
  ipcMain.handle(IPC_CHANNELS.renameLocalRecording, withItemId((id, title: string) => currentVault().rename(id, title)));
  ipcMain.handle(IPC_CHANNELS.markOpenedInEditor, withItemId((id) => currentVault().markOpenedInEditor(id)));
  ipcMain.handle(IPC_CHANNELS.backfillLocalRecordingMeta, withItemId((id, meta: RecordingBackfillMeta) => currentVault().backfill(id, meta)));
  ipcMain.handle(IPC_CHANNELS.deleteLocalRecording, withItemId(async (id) => {
    await currentVault().remove(id);
    // Best-effort: a missing session must never block the delete.
    await deleteVideoEditSession(id).catch(() => {});
  }));
  ipcMain.handle(IPC_CHANNELS.revealLocalRecording, withItemId(async (id) =>
    shell.showItemInFolder(await currentVault().filePath(id)),
  ));
```

(Keep any extra lines those handlers gained from plans 06/10 — e.g. the delete broadcast — inside the wrapped body.) In `startFileDrag` replace `if (typeof id !== "string" || /[\\/]|\.\./.test(id)) return;` with `assertItemId(id);` (inside the async IIFE, so the throw lands in the existing `"file drag failed"` catch). Optionally add `assertItemId(itemId)` to `setItemTags` for uniformity (already guarded via `hasMedia`).

`screenshot-ipc.ts` — `import { assertItemId, withItemId } from "../library/item-id";`; wrap `screenshotCopyById` and `screenshotReadBytes` with `withItemId(async (id) => { /* body unchanged */ })`; in `screenshotSave`, before the id line: `if (meta.overwriteId !== undefined) assertItemId(meta.overwriteId);`.

`media-protocol.ts` — delete `isUnsafeId`, `import { isValidItemId } from "./library/item-id";`, and `if (!isValidItemId(id)) return new Response("Invalid recording id", { status: 400 });`.

- [ ] **Step 2: Type check and the main suite**

Run: `bun run check-types && node_modules/.bin/vitest run src/main` → green (`withItemId` changes handler parameter types; the compiler flags any mismatch).

- [ ] **Step 3: Commit**

```bash
git add src/main/library/index.ts src/main/screenshots/screenshot-ipc.ts src/main/media-protocol.ts
git commit -m "fix(desktop): validate renderer-supplied ids in every library, screenshot and media handler"
```

### Task 4: Ship

- [ ] Open a PR titled `fix(desktop): validate item ids at every IPC boundary (audit LIB-B11)` linking this plan and the finding; mention the `..` behaviour change and the extra asset-id hole. End with **How to test it yourself**:
  1. In the Library: rename, delete, reveal in Finder and drag out an item → all work as before.
  2. Open a recording in the video editor, add a slide, wait for "Saved", reopen → the slide is restored.
  3. Copy a screenshot from its card, then edit it and Overwrite → works.
  4. Play a video and confirm thumbnails load (media protocol still serves).
  5. DevTools console in the main window: `window.electronAPI.deleteLocalRecording("../x")` → rejects with "invalid item id"; nothing outside the vault changed.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
