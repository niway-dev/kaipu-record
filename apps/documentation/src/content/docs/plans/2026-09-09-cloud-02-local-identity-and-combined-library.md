---
title: Cloud 02 — local identity and the combined library
description: Task-by-task TDD plan for the desktop side of optional cloud — stable asset identity in sidecars, export provenance, a remove-local-copy operation that preserves projects, a per-account cloud catalog cache, and one library entry per logical video.
---

# Cloud 02 — Local Identity and Combined Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** give every local recording and screenshot a stable `assetId`, relate exports to their
source, make the library show one entry per logical item whether its bytes are local, in cloud or
both, and add the safe "remove local copy" operation — all without moving, renaming or deleting
anything a user already has.

**Architecture:** the sidecar `.kaipu/<id>.json` becomes version 2 additively: `assetId`
(UUID, minted lazily on first read), `derivedFromAssetId`, a cached `contentSha256` with the
size/mtime it was computed for, and `localRemovedAt`. The filename stays the local id; the
`assetId` is the join key with the cloud catalog. Main owns a per-account catalog cache
(`userData/cloud/<userId>/catalog.json`) fetched from plan 01's `GET /api/v1/assets` and a pure
composer that merges local items + catalog into `LibraryItem[]` with five independent axes
(availability, transfer, comparison, editing, sharing). The renderer only renders those axes.
Thumbnails for cloud-only items, transfers and the upload-mode setting are plan 03.

**Tech Stack:** Electron main (Node `fs`, `crypto`), shared pure types, React + Vitest (jsdom)
for the renderer, Vitest node project for main. No new dependencies.

**Spec:** `/specs/2026-09-09-cloud-data-model` (identity, axes, download/edit rules),
`/specs/2026-09-09-cloud-product` (library, delete matrix), `/specs/2026-09-09-cloud-design-handoff`
§2–3 (labels), umbrella `/plans/2026-09-09-cloud-delivery` Phase 2. Sibling: plan 01 (server) —
Tasks 1–7 and 9 here run without it; Tasks 8 and 10 consume its wire contract (copied below).

## Global Constraints

- Repo content is **English**; user-facing copy goes through `@kaipu/i18n` (`en.json` + `es.json`).
- No TS enums — `as const` + derived types. Pure `src/shared/**` files import nothing from
  `electron` or `node:*`.
- **Additive migration only.** No file is renamed, moved or rewritten in bulk. Existing sidecar
  fields keep their meaning; missing `assetId` is minted on read and persisted best-effort.
  A read-only vault must still list.
- **The filename is still the local id** (`LocalRecording.id`); `assetId` is the identity
  clients and the server use. Never dedupe by title or by filename.
- **One entry per logical item.** A local file and its cloud revision with the same `assetId`
  are one `LibraryItem`. An export is a distinct item related through `derivedFromAssetId`.
- **Never present a disconnected disk as "cloud only"**: an unreadable vault yields
  `availability: "local-unavailable"` for items the cache last saw locally, and keeps the
  cached cloud catalog visible. A 401/timeout never deletes cached cloud data.
- **Account isolation:** the catalog cache is keyed by `userId`; signing out or switching
  accounts hides the previous account's cloud items; local files are never re-associated
  with a different account automatically.
- **Remove local copy** deletes only the media file; it keeps `.json`, `.jpg`, `.edit.json` and
  `.assets/`. It is refused unless the cloud revision has the same `contentSha256` and size as the
  local file **and** no edit session exists for that id. The existing generic delete is never
  reused for this.
- **Hashing is lazy** (never during `list()`): computed when a session is saved, when an upload
  intent is created (plan 03), or when the remove-local-copy guard needs it, and cached in the
  sidecar with the size/mtime it was computed for.
- Renderer tests that touch `window.electronAPI` need every new bridge method stubbed in
  `src/renderer/src/test/setup.ts`.
- All paths below are relative to `apps/kaipu-record/` unless stated otherwise. Tests:
  `bun run test` (from `apps/kaipu-record`); types: `bun run typecheck`; lint: `bun run lint`.

---

## Wire contract consumed (from plan 01)

`GET /api/v1/assets?cursor=<opaque>&limit=100` with `Authorization: Bearer <token>` →
`{ data: { items: CloudAssetSummary[], nextCursor: string | null }, error }` where

```ts
type CloudAssetSummary = {
  assetId: string; kind: "recording" | "screenshot"; title: string;
  currentRevisionId: string | null; contentType: string | null; sizeBytes: number | null;
  contentSha256: string | null; durationSeconds: number; hasThumbnail: boolean;
  derivedFromAssetId: string | null; autoUploadExcluded: boolean;
  createdAt: string; updatedAt: string;   // ISO
};
```

`contentSha256` is the **base64** sha256 of the object bytes (44 chars). The local cache uses the
same encoding so equality is a string compare.

---

## File Structure

**Shared (`src/shared/`)**

- Modify `types/library-storage.ts` — `LocalRecording.assetId`, `derivedFromAssetId`, `contentSha256`.
- Create `types/library-item.ts` — `LibraryItem`, the five axes, `CloudCatalogEntry`.
- Modify `types/ipc.ts` — `RecordingFinalizeMeta.derivedFromAssetId`, 3 new channels.
- Modify `types/electron-api.ts` — `listLibraryItems`, `refreshCloudCatalog`, `removeLocalCopy`.
- Modify `types/index.ts` — export `library-item`.
- Modify `types/auth.ts`, `entitlements.ts` — `userId` on signed-in status; cloud feature fields.

**Main (`src/main/`)**

- Modify `library/library-vault.ts` (+ test) — sidecar v2, `ensureIdentity`, `ensureContentHash`, `removeLocalCopy`, `hasEditSession`.
- Create `library/content-hash.ts` (+ test) — streaming sha256 → base64.
- Create `library/remove-local-copy-policy.ts` (+ test) — pure guard.
- Modify `library/video-edit-session.ts` (+ test) — writes `<id>.edit.meta.json` with source size/mtime.
- Create `library/edit-project-probe.ts` (+ test) — editing axis.
- Create `library/compose-library.ts` (+ test) — pure merge into `LibraryItem[]`.
- Modify `library/index.ts` — new handlers, catalog refresh wiring.
- Create `cloud/catalog-client.ts` (+ test) — pages `GET /assets`.
- Create `cloud/catalog-cache.ts` (+ test) — per-account JSON cache.
- Modify `recording/recording-writer.ts` (+ test) — persists `derivedFromAssetId`.
- Modify `services/auth-client.ts`, `infrastructure/auth-store.ts` (+ test) — `userId`, `getCurrentAccount()`.
- Modify `index.ts` — pass the account accessor to the library module.

**Preload** — `src/preload/index.ts`: three new bridge methods.

**Renderer (`src/renderer/src/`)**

- Modify `features/library/types.ts` — `LibraryVideo` carries the axes.
- Replace `features/library/map-recording.ts` with `features/library/map-item.ts` (+ test).
- Modify `features/library/library-filters.ts` (+ test) — overlap-aware storage filter and counts.
- Modify `features/library/hooks/use-local-library.ts` (+ test) — lists `LibraryItem`s.
- Modify `features/library/components/storage-meta.tsx`, `video-card.tsx`, `video-row.tsx` (+ tests) — availability label; "Reveal" only when local.
- Modify `pages/library/library-page.tsx`, `pages/library-detail/library-detail-page.tsx`, `pages/video-editor/video-editor-page.tsx`, `features/video-editor/export/use-video-export.ts`.
- Modify `test/setup.ts`.
- Modify `packages/i18n/messages/en.json`, `es.json` (repo root) — new `library.*` keys.

**Docs** — `apps/documentation/src/content/docs/desktop/library-vault.mdx`, `backlog/desktop-cloud-sync-gap.md`.

---

### Task 1: Shared types — identity on `LocalRecording`, the `LibraryItem` axes

**Files:**

- Modify: `src/shared/types/library-storage.ts`
- Create: `src/shared/types/library-item.ts`
- Modify: `src/shared/types/ipc.ts` (only `RecordingFinalizeMeta` here; channels come in Task 10)
- Modify: `src/shared/types/index.ts`
- Test: `src/shared/types/library-item.test.ts`

**Interfaces:**

- Produces: `LocalRecording.assetId: string`, `LocalRecording.derivedFromAssetId: string | null`,
  `LocalRecording.contentSha256: string | null`; `RecordingFinalizeMeta.derivedFromAssetId?: string | null`;
  `LibraryItem`, `Availability`, `TransferState`, `Comparison`, `EditingState`, `SharingState`,
  `CloudCatalogEntry`, `AVAILABILITIES` … `SHARING_STATES` const arrays, `hasLocalCopy(item)`, `hasCloudCopy(item)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/types/library-item.test.ts
import { describe, expect, it } from "vitest";
import { AVAILABILITIES, hasCloudCopy, hasLocalCopy, type LibraryItem } from "./library-item";

const base: LibraryItem = {
  assetId: "a1",
  kind: "recording",
  title: "Demo",
  createdAt: 1,
  durationSeconds: 10,
  derivedFromAssetId: null,
  local: null,
  cloud: null,
  availability: "unverified",
  transfer: { state: "idle" },
  comparison: "pending",
  editing: "exported-only",
  sharing: "private",
};

describe("library item helpers", () => {
  it("derives copy presence from the axes, not from nullable payloads alone", () => {
    expect(hasLocalCopy({ ...base, availability: "local" })).toBe(true);
    expect(hasLocalCopy({ ...base, availability: "local-and-cloud" })).toBe(true);
    expect(hasLocalCopy({ ...base, availability: "local-unavailable" })).toBe(false);
    expect(hasCloudCopy({ ...base, availability: "cloud" })).toBe(true);
    expect(hasCloudCopy({ ...base, availability: "local-unavailable" })).toBe(true);
    expect(hasCloudCopy({ ...base, availability: "local" })).toBe(false);
  });

  it("lists every availability so exhaustive switches stay honest", () => {
    expect(AVAILABILITIES).toEqual(["local", "cloud", "local-and-cloud", "local-unavailable", "unverified"]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun run test -- src/shared/types/library-item.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Write the types**

Replace `src/shared/types/library-storage.ts`:

```ts
/**
 * A recording stored in the local vault, as returned by the main process.
 * Pure type — safe to import from both main and renderer.
 */
export interface LocalRecording {
  /** The filename without extension. Local-only handle; stable while the file is not renamed. */
  id: string;
  /**
   * Stable identity minted on first read and persisted in the sidecar. This is
   * what the cloud catalog and every cross-device relation use — never `id`.
   */
  assetId: string;
  /** Discriminates a video recording from a screenshot in the unified vault. */
  kind: "recording" | "screenshot";
  title: string;
  /** Absolute path to the media file on disk. */
  filePath: string;
  /** Epoch milliseconds. */
  createdAt: number;
  sizeBytes: number;
  /** 0 when unknown (no sidecar metadata yet). */
  durationSeconds: number;
  thumbnailUrl?: string | null;
  /** The asset this file was exported from, when it is an editor export. */
  derivedFromAssetId: string | null;
  /**
   * base64 sha256 of the file, only when the cached hash still matches the file's
   * current size + mtime. null = not computed yet or stale (never "unknown bytes").
   */
  contentSha256: string | null;
}

/** Where recordings are stored, and whether the user picked a custom folder. */
export interface VaultDirectory {
  path: string;
  isCustom: boolean;
}
```

Create `src/shared/types/library-item.ts`:

```ts
/**
 * The library's unified item: one entry per logical video/screenshot, whether its
 * bytes live here, in cloud, or both. Five independent axes replace the old
 * `storage: "local" | "cloud" | "uploading" | "failed"` enum, which could not say
 * "local and cloud, uploading a new revision, with local changes" at once.
 * Pure — imported by main and renderer.
 */
import type { LocalRecording } from "./library-storage";

export const AVAILABILITIES = ["local", "cloud", "local-and-cloud", "local-unavailable", "unverified"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export const TRANSFER_STATES = [
  "idle", "queued", "preparing", "uploading", "verifying", "downloading",
  "paused-offline", "cancelling", "failed", "deleting",
] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

/** Local revision vs cloud revision of the same asset. */
export const COMPARISONS = ["same", "local-changes", "pending", "different"] as const;
export type Comparison = (typeof COMPARISONS)[number];

export const EDITING_STATES = ["project-available", "needs-source", "exported-only", "missing-dependencies"] as const;
export type EditingState = (typeof EDITING_STATES)[number];

export const SHARING_STATES = ["private", "link-active", "revoking", "link-revoked"] as const;
export type SharingState = (typeof SHARING_STATES)[number];

/** What main caches from the server catalog for one asset (plan 01 `CloudAssetSummary`). */
export interface CloudCatalogEntry {
  assetId: string;
  kind: "recording" | "screenshot";
  title: string;
  revisionId: string;
  contentType: string;
  sizeBytes: number;
  contentSha256: string;
  durationSeconds: number;
  hasThumbnail: boolean;
  derivedFromAssetId: string | null;
  autoUploadExcluded: boolean;
  /** Epoch milliseconds. */
  createdAt: number;
  /** When this entry was last confirmed against the server (epoch ms). */
  lastVerifiedAt: number;
  /** The local filename id this asset was last merged with, if any — lets an unreadable vault say "local unavailable" rather than "cloud". */
  lastSeenLocalId: string | null;
}

export interface LibraryItem {
  assetId: string;
  kind: "recording" | "screenshot";
  title: string;
  createdAt: number;
  durationSeconds: number;
  derivedFromAssetId: string | null;
  /** The local copy, when the file is present and readable. */
  local: LocalRecording | null;
  /** The cloud copy as last seen in the catalog cache. */
  cloud: CloudCatalogEntry | null;
  availability: Availability;
  /** Plan 03 fills this from the transfer queue; here it is always `{ state: "idle" }`. */
  transfer: { state: TransferState; progress?: { sentBytes: number; totalBytes: number } };
  comparison: Comparison;
  editing: EditingState;
  /** Plan 04 fills this; here it is always `"private"`. */
  sharing: SharingState;
}

export function hasLocalCopy(item: Pick<LibraryItem, "availability">): boolean {
  return item.availability === "local" || item.availability === "local-and-cloud";
}

export function hasCloudCopy(item: Pick<LibraryItem, "availability">): boolean {
  return (
    item.availability === "cloud" ||
    item.availability === "local-and-cloud" ||
    item.availability === "local-unavailable"
  );
}
```

In `src/shared/types/ipc.ts` extend `RecordingFinalizeMeta`:

```ts
export interface RecordingFinalizeMeta {
  title: string;
  durationSeconds: number;
  thumbnail?: ArrayBuffer | null;
  /** Set by the video editor's export: the asset the render was produced from. */
  derivedFromAssetId?: string | null;
}
```

Add `export * from "./library-item";` to `src/shared/types/index.ts`.

- [ ] **Step 4: Run the test** — `bun run test -- src/shared/types/library-item.test.ts`. Expected: PASS.
      `bun run typecheck` now fails wherever a `LocalRecording` literal is built without the new fields
      (`library-vault.ts`, tests, `setup.ts` stubs, `use-local-library.test.tsx`, e2e helpers). Fix the
      test literals now by adding `assetId: "<any uuid>", derivedFromAssetId: null, contentSha256: null`;
      production code is fixed in Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/shared
git commit -m "feat(desktop): stable asset identity on local recordings and the library item axes"
```

---

### Task 2: LibraryVault — sidecar v2 with lazy identity

**Files:**

- Modify: `src/main/library/library-vault.ts`
- Modify: `src/main/library/library-vault.test.ts`

**Interfaces:**

- Consumes: Task 1 types.
- Produces: `Sidecar` gains `sidecarVersion`, `assetId`, `derivedFromAssetId`, `contentSha256`,
  `hashedSizeBytes`, `hashedMtimeMs`, `localRemovedAt`; `describe()` always returns an `assetId`;
  `writeMeta` accepts the new fields; `readSidecar` becomes public (`sidecar(id)`); `sidecarPath`,
  `thumbnailPath` become public (needed by the probe in Task 5).

- [ ] **Step 1: Write the failing tests** (append inside the first `describe("LibraryVault")`)

```ts
  it("mints a stable assetId for a legacy item and persists it without touching other fields", async () => {
    await writeRecording("legacy");
    await writeSidecar("legacy", { title: "Old", durationSeconds: 7, createdAt: 123 });

    const first = await vault.describe("legacy");
    expect(first?.assetId).toMatch(/^[0-9a-f-]{36}$/);
    const second = await vault.describe("legacy");
    expect(second?.assetId).toBe(first?.assetId);

    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "legacy.json"), "utf-8"));
    expect(sidecar).toMatchObject({ title: "Old", durationSeconds: 7, createdAt: 123, sidecarVersion: 2 });
    expect(sidecar.assetId).toBe(first?.assetId);
  });

  it("gives two files different assetIds and never derives the id from the filename", async () => {
    await writeRecording("one");
    await writeRecording("two");
    const [a, b] = await Promise.all([vault.describe("one"), vault.describe("two")]);
    expect(a?.assetId).not.toBe(b?.assetId);
    expect(a?.assetId).not.toBe("one");
  });

  it("still lists when the sidecar directory is read-only (identity is in memory only)", async () => {
    await writeRecording("ro");
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    await chmod(join(directory, ".kaipu"), 0o500);
    try {
      const [rec] = await vault.list();
      expect(rec.id).toBe("ro");
      expect(rec.assetId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await chmod(join(directory, ".kaipu"), 0o700);
    }
  });

  it("exposes provenance and the cached hash only while it matches the file", async () => {
    await writeRecording("exp", 10);
    const info = await stat(join(directory, "exp.webm"));
    await writeSidecar("exp", {
      assetId: "11111111-1111-4111-8111-111111111111",
      derivedFromAssetId: "22222222-2222-4222-8222-222222222222",
      contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
      hashedSizeBytes: 10,
      hashedMtimeMs: info.mtimeMs,
    });
    expect(await vault.describe("exp")).toMatchObject({
      assetId: "11111111-1111-4111-8111-111111111111",
      derivedFromAssetId: "22222222-2222-4222-8222-222222222222",
      contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    });
    await writeRecording("exp", 11); // bytes changed → cached hash is stale
    expect((await vault.describe("exp"))?.contentSha256).toBeNull();
  });
```

Add `chmod`, `stat` to the `node:fs/promises` import of the test file. (Skip the read-only case on
Windows with `it.skipIf(process.platform === "win32")`.)

- [ ] **Step 2: Run to verify failure** — `bun run test -- src/main/library/library-vault.test.ts`. Expected: FAIL (`assetId` undefined).

- [ ] **Step 3: Implement**

In `library-vault.ts`:

```ts
import { randomUUID } from "node:crypto";

/** Version 2 adds identity + provenance + hash cache. Every field stays optional so a v1 file reads fine. */
export interface Sidecar {
  sidecarVersion?: 1 | 2;
  title?: string;
  durationSeconds?: number;
  createdAt?: number;
  assetId?: string;
  derivedFromAssetId?: string | null;
  /** base64 sha256 + the file stats it was computed for; stale when they differ. */
  contentSha256?: string;
  hashedSizeBytes?: number;
  hashedMtimeMs?: number;
  /** Set by `removeLocalCopy`; cleared when a file reappears under this id. */
  localRemovedAt?: number;
}
```

Make `sidecarPath` and `thumbnailPath` public, rename `readSidecar` to public `sidecar(id)`, and
change `describe`:

```ts
  async describe(id: string): Promise<LocalRecording | null> {
    const filePath = await this.filePath(id);
    let info;
    try {
      info = await stat(filePath);
    } catch {
      return null;
    }
    const isImage = IMAGE_EXTS.some((ext) => filePath.endsWith(ext));
    const meta = await this.ensureIdentity(id);
    const hashIsFresh =
      meta.contentSha256 !== undefined &&
      meta.hashedSizeBytes === info.size &&
      meta.hashedMtimeMs === info.mtimeMs;
    return {
      id,
      assetId: meta.assetId,
      kind: isImage ? "screenshot" : "recording",
      title: meta.title ?? humanizeId(id),
      filePath,
      createdAt: meta.createdAt ?? info.birthtimeMs,
      sizeBytes: info.size,
      durationSeconds: meta.durationSeconds ?? 0,
      derivedFromAssetId: meta.derivedFromAssetId ?? null,
      contentSha256: hashIsFresh ? (meta.contentSha256 ?? null) : null,
      thumbnailUrl: isImage
        ? `kaipu-media://screenshot/${id}?v=${Math.round(info.mtimeMs)}`
        : (await exists(this.thumbnailPath(id)))
          ? `kaipu-media://thumb/${id}`
          : null,
    };
  }

  /**
   * Read the sidecar and make sure it carries an assetId. A legacy (v1) item gets
   * one minted here, on first read, and persisted best-effort: if the vault is
   * read-only the id lives for this process only — the alternative (failing to
   * list) reads as data loss. Also clears `localRemovedAt`, since the file is back.
   */
  private async ensureIdentity(id: string): Promise<Sidecar & { assetId: string }> {
    const current = await this.sidecar(id);
    if (current.assetId && current.localRemovedAt === undefined) {
      return current as Sidecar & { assetId: string };
    }
    const next: Sidecar = {
      ...current,
      sidecarVersion: 2,
      assetId: current.assetId ?? randomUUID(),
    };
    delete next.localRemovedAt;
    try {
      await this.writeMeta(id, next);
    } catch {
      // Read-only vault: keep the in-memory identity; nothing else could persist either.
    }
    return next as Sidecar & { assetId: string };
  }
```

`writeMeta` stays a merge; make it stamp `sidecarVersion: 2` on every write:

```ts
  async writeMeta(id: string, meta: Sidecar): Promise<void> {
    const current = await this.sidecar(id);
    await mkdir(this.metaDirectory(), { recursive: true });
    await writeFile(
      this.sidecarPath(id),
      JSON.stringify({ ...current, ...meta, sidecarVersion: 2 }, null, 2),
    );
  }
```

Note the concurrency: `list()` calls `describe()` for every id in parallel; each id has its own
sidecar file, so there is no write race between items. Two `describe(id)` calls for the same id in
parallel could mint two ids; guard with a per-vault `Map<string, Promise<...>>` inflight cache in
`ensureIdentity` (store the promise before awaiting, delete in `finally`).

- [ ] **Step 4: Run the tests** — `bun run test -- src/main/library` and `bun run typecheck`. Expected: PASS; every `LocalRecording` producer (`describe`, `backfill`) now returns the new fields.

- [ ] **Step 5: Commit**

```bash
git add src/main/library/library-vault.ts src/main/library/library-vault.test.ts
git commit -m "feat(desktop): sidecar v2 with lazily minted asset identity"
```

---

### Task 3: Content hash — streaming sha256 cached in the sidecar

**Files:**

- Create: `src/main/library/content-hash.ts`
- Test: `src/main/library/content-hash.test.ts`
- Modify: `src/main/library/library-vault.ts` (+ test) — `ensureContentHash(id)`

**Interfaces:**

- Produces: `sha256FileBase64(path): Promise<string>`; `LibraryVault.ensureContentHash(id): Promise<{ contentSha256: string; sizeBytes: number } | null>`
  (recomputes only when the cached size/mtime differ; persists the cache; null when the file is gone).

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/library/content-hash.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256FileBase64 } from "./content-hash";

describe("sha256FileBase64", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-hash-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("matches the known digest of an empty file and of 'abc'", async () => {
    await writeFile(join(dir, "empty"), "");
    await writeFile(join(dir, "abc"), "abc");
    expect(await sha256FileBase64(join(dir, "empty"))).toBe("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
    expect(await sha256FileBase64(join(dir, "abc"))).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
  });

  it("streams: hashes a multi-megabyte file without loading it whole (same digest as one-shot)", async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 1);
    await writeFile(join(dir, "big"), big);
    const { createHash } = await import("node:crypto");
    expect(await sha256FileBase64(join(dir, "big"))).toBe(createHash("sha256").update(big).digest("base64"));
  });
});
```

Append to `library-vault.test.ts` (first `describe`):

```ts
  it("ensureContentHash computes once, caches by size+mtime, and recomputes after a change", async () => {
    await writeRecording("h", 100);
    const first = await vault.ensureContentHash("h");
    expect(first?.contentSha256).toHaveLength(44);
    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "h.json"), "utf-8"));
    expect(sidecar).toMatchObject({ contentSha256: first?.contentSha256, hashedSizeBytes: 100 });
    expect((await vault.describe("h"))?.contentSha256).toBe(first?.contentSha256);

    await writeFile(join(directory, "h.webm"), Buffer.alloc(100, 9));
    const second = await vault.ensureContentHash("h");
    expect(second?.contentSha256).not.toBe(first?.contentSha256);
    expect(await vault.ensureContentHash("missing")).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure** — `bun run test -- src/main/library`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/main/library/content-hash.ts
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * base64 sha256 of a file, streamed (a recording can be a gigabyte). base64 is the
 * encoding R2 stores in `x-amz-checksum-sha256`, so local and cloud compare as
 * plain strings.
 */
export function sha256FileBase64(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("base64")));
  });
}
```

In `library-vault.ts`:

```ts
import { sha256FileBase64 } from "./content-hash";

  /**
   * The file's sha256, from the sidecar cache when it still matches the file's
   * size + mtime, otherwise recomputed and cached. Never called by `list()`.
   */
  async ensureContentHash(id: string): Promise<{ contentSha256: string; sizeBytes: number } | null> {
    const filePath = await this.filePath(id);
    let info;
    try {
      info = await stat(filePath);
    } catch {
      return null;
    }
    const meta = await this.sidecar(id);
    if (meta.contentSha256 && meta.hashedSizeBytes === info.size && meta.hashedMtimeMs === info.mtimeMs) {
      return { contentSha256: meta.contentSha256, sizeBytes: info.size };
    }
    const contentSha256 = await sha256FileBase64(filePath);
    // Re-stat after hashing: if the file changed underneath, don't cache a lie.
    const after = await stat(filePath);
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) return this.ensureContentHash(id);
    await this.writeMeta(id, { contentSha256, hashedSizeBytes: info.size, hashedMtimeMs: info.mtimeMs });
    return { contentSha256, sizeBytes: info.size };
  }
```

- [ ] **Step 4: Run the tests** — `bun run test -- src/main/library`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/library/content-hash.ts src/main/library/content-hash.test.ts src/main/library/library-vault.ts src/main/library/library-vault.test.ts
git commit -m "feat(desktop): streaming content hash cached in the sidecar"
```

---

### Task 4: Export provenance — `derivedFromAssetId` from editor to sidecar

**Files:**

- Modify: `src/main/recording/recording-writer.ts`, `src/main/recording/recording-writer.test.ts`
- Modify: `src/renderer/src/pages/video-editor/video-editor-page.tsx` (`VideoEditorSource`, export args)
- Modify: `src/renderer/src/features/video-editor/export/use-video-export.ts` (`StartExportArgs.derivedFromAssetId`)
- Modify: `src/renderer/src/pages/library-detail/library-detail-page.tsx` (navigation state carries `assetId`)
- Modify: `src/renderer/src/pages/video-editor/video-editor-page.test.tsx` (`SOURCE` fixture gains `assetId`)

**Interfaces:**

- Consumes: Task 1 `RecordingFinalizeMeta.derivedFromAssetId`.
- Produces: `VideoEditorSource.assetId: string`; `StartExportArgs.derivedFromAssetId: string | null`;
  finalized exports carry `derivedFromAssetId` in their sidecar and `LocalRecording`.

- [ ] **Step 1: Write the failing writer test** (append to `recording-writer.test.ts`)

```ts
  it("persists export provenance in the sidecar and surfaces it on the recording", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("AAAA").buffer, 0);
    const rec = await writer.finalize("s1", {
      title: "Export",
      durationSeconds: 1,
      derivedFromAssetId: "22222222-2222-4222-8222-222222222222",
    });
    expect(rec.derivedFromAssetId).toBe("22222222-2222-4222-8222-222222222222");
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", "rec-fixed.json"), "utf-8"));
    expect(sidecar.derivedFromAssetId).toBe("22222222-2222-4222-8222-222222222222");
    expect(sidecar.assetId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a plain recording has no provenance", async () => {
    const { writer } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("A").buffer, 0);
    const rec = await writer.finalize("s1", { title: "Rec", durationSeconds: 1 });
    expect(rec.derivedFromAssetId).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure** — `bun run test -- src/main/recording/recording-writer.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

In `recording-writer.ts` `finalize`, replace the `writeMeta` call:

```ts
    await vault.writeMeta(id, {
      title: meta.title,
      durationSeconds: meta.durationSeconds,
      createdAt: this.now(),
      derivedFromAssetId: meta.derivedFromAssetId ?? null,
    });
```

In `use-video-export.ts`: add `derivedFromAssetId: string | null;` to `StartExportArgs` (with the
doc comment "the source asset's identity; persisted on the exported file") and pass it in the
`recordingFinalize` call:

```ts
                const recording = await window.electronAPI.recordingFinalize(sessionId, {
                  title: t("editedTitle", { title: args.title }),
                  durationSeconds: plan.totalDuration,
                  thumbnail,
                  derivedFromAssetId: args.derivedFromAssetId,
                });
```

In `video-editor-page.tsx`:

```ts
export interface VideoEditorSource {
  id: string;
  /** The source recording's stable identity — recorded on the export as provenance. */
  assetId: string;
  title: string;
  durationSeconds: number;
}

function isVideoEditorSource(value: unknown): value is VideoEditorSource {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.assetId === "string" &&
    typeof v.title === "string" &&
    typeof v.durationSeconds === "number"
  );
}
```

and in the `videoExport.start({ … })` call add `derivedFromAssetId: source.assetId,`.

In `library-detail-page.tsx` `editVideo`:

```ts
    navigate("/video-editor", {
      state: { id: video.id, assetId: video.assetId, title: video.title, durationSeconds: video.durationSeconds },
    });
```

(`video.assetId` exists on `LibraryVideo` after Task 11; until then use
`videos.find(...)`'s underlying item — to keep this task green on its own, add `assetId: string`
to `LibraryVideo` and to `toLibraryVideo` **now**, mapping `recording.assetId`.)

Update the `SOURCE` fixture in `video-editor-page.test.tsx` with `assetId: "asset-1"`.

- [ ] **Step 4: Verify** — `bun run test && bun run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/recording src/renderer/src/pages/video-editor src/renderer/src/pages/library-detail src/renderer/src/features/video-editor/export src/renderer/src/features/library
git commit -m "feat(desktop): record export provenance as derivedFromAssetId"
```

---

### Task 5: Edit-project probe — the editing axis without hashing

**Files:**

- Modify: `src/main/library/video-edit-session.ts`, `src/main/library/video-edit-session.test.ts`
- Create: `src/main/library/edit-project-probe.ts`
- Test: `src/main/library/edit-project-probe.test.ts`

**Interfaces:**

- Produces: `saveSession` also writes `.kaipu/<id>.edit.meta.json` = `{ sourceSizeBytes, sourceMtimeMs, assetIds: string[], savedAt }`;
  `hasEditSession(vaultDir, id): Promise<boolean>`;
  `probeEditing(vaultDir, local: { id, filePath, derivedFromAssetId } | null): Promise<EditingState>`.

Rules (from the data-model spec):

| Situation                                                                                         | `EditingState`                               |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| No local file                                                                                     | `needs-source`                               |
| Local file, `.edit.json` exists, meta size/mtime match the file, every asset in `assetIds` exists | `project-available`                          |
| Local file, `.edit.json` exists, but source changed or an asset file is missing                   | `missing-dependencies`                       |
| Local file, no session, `derivedFromAssetId !== null`                                             | `exported-only`                              |
| Local file, no session, not an export                                                             | `project-available` (a fresh edit can start) |

- [ ] **Step 1: Write the failing tests**

Append to `video-edit-session.test.ts`:

```ts
  it("writes edit.meta.json with the source file's size and mtime and the asset ids", async () => {
    const { writeFile: wf, stat } = await import("node:fs/promises");
    await wf(join(vaultDir, "rec-1.mp4"), "source-bytes");
    const info = await stat(join(vaultDir, "rec-1.mp4"));
    await saveSession("rec-1", {
      sessionJson: "{}",
      assets: [{ assetId: "a1", bytes: bytesOf("x") }],
    });
    const meta = JSON.parse(await readFile(join(vaultDir, ".kaipu", "rec-1.edit.meta.json"), "utf-8"));
    expect(meta).toMatchObject({ sourceSizeBytes: info.size, sourceMtimeMs: info.mtimeMs, assetIds: ["a1"] });
    expect(typeof meta.savedAt).toBe("number");
  });

  it("deleteVideoEditSession also removes edit.meta.json", async () => {
    await saveSession("rec-1", { sessionJson: "{}", assets: [] });
    await deleteVideoEditSession("rec-1");
    await expect(readFile(join(vaultDir, ".kaipu", "rec-1.edit.meta.json"))).rejects.toThrow();
  });
```

```ts
// src/main/library/edit-project-probe.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("./vault-location", () => ({ vaultDirectory: () => ({ path: state.dir, isCustom: false }) }));

import { saveSession } from "./video-edit-session";
import { hasEditSession, probeEditing } from "./edit-project-probe";

describe("probeEditing", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-probe-"));
    state.dir = dir;
    await mkdir(join(dir, ".kaipu"), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const local = (id: string, derivedFromAssetId: string | null = null) => ({
    id,
    filePath: join(dir, `${id}.mp4`),
    derivedFromAssetId,
  });

  it("needs-source when there is no local file", async () => {
    expect(await probeEditing(dir, null)).toBe("needs-source");
  });

  it("project-available for a plain recording without a session", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    expect(await probeEditing(dir, local("r"))).toBe("project-available");
    expect(await hasEditSession(dir, "r")).toBe(false);
  });

  it("exported-only for an export without a session", async () => {
    await writeFile(join(dir, "e.mp4"), "v");
    expect(await probeEditing(dir, local("e", "src-asset"))).toBe("exported-only");
  });

  it("project-available when the session matches the source and all assets exist", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    await saveSession("r", { sessionJson: "{}", assets: [{ assetId: "a1", bytes: new Uint8Array([1]).buffer }] });
    expect(await probeEditing(dir, local("r"))).toBe("project-available");
    expect(await hasEditSession(dir, "r")).toBe(true);
  });

  it("missing-dependencies when the source changed or an asset is gone", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    await saveSession("r", { sessionJson: "{}", assets: [{ assetId: "a1", bytes: new Uint8Array([1]).buffer }] });
    await rm(join(dir, ".kaipu", "r.assets", "a1.png"));
    expect(await probeEditing(dir, local("r"))).toBe("missing-dependencies");

    await writeFile(join(dir, "s.mp4"), "v");
    await saveSession("s", { sessionJson: "{}", assets: [] });
    await writeFile(join(dir, "s.mp4"), "changed-bytes");
    const info = await stat(join(dir, "s.mp4"));
    expect(info.size).not.toBe(1);
    expect(await probeEditing(dir, local("s"))).toBe("missing-dependencies");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun run test -- src/main/library`. Expected: FAIL.

- [ ] **Step 3: Implement**

In `video-edit-session.ts` add the meta path helper and write it in `saveSession` (after the
assets are written), and delete it in `deleteVideoEditSession`:

```ts
import { stat } from "node:fs/promises";
import { LibraryVault } from "./library-vault";

export function sessionMetaPath(vaultDir: string, id: string): string {
  return join(vaultDir, ".kaipu", `${id}.edit.meta.json`);
}

export interface SessionMeta {
  sourceSizeBytes: number;
  sourceMtimeMs: number;
  assetIds: string[];
  savedAt: number;
}

// inside saveSession, after the prune loop:
  const sourcePath = await new LibraryVault(vaultDirectory().path).filePath(id);
  let source: { size: number; mtimeMs: number } | null = null;
  try {
    source = await stat(sourcePath);
  } catch {
    // Source missing at save time (should not happen from the editor) — record nothing;
    // the probe treats a missing meta as "dependencies unknown" = missing-dependencies.
  }
  if (source) {
    const meta: SessionMeta = {
      sourceSizeBytes: source.size,
      sourceMtimeMs: source.mtimeMs,
      assetIds: [...keptIds],
      savedAt: Date.now(),
    };
    const mp = sessionMetaPath(vaultDirectory().path, id);
    await writeFile(`${mp}.tmp`, JSON.stringify(meta), "utf-8");
    await rename(`${mp}.tmp`, mp);
  }

// inside deleteVideoEditSession's allSettled list:
    rm(sessionMetaPath(vaultDirectory().path, id), { force: true }),
```

```ts
// src/main/library/edit-project-probe.ts
import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EditingState } from "@shared/types/library-item";
import { sessionMetaPath, type SessionMeta } from "./video-edit-session";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function hasEditSession(vaultDir: string, id: string): Promise<boolean> {
  return exists(join(vaultDir, ".kaipu", `${id}.edit.json`));
}

/**
 * The editing axis for one local item. Deliberately cheap: stats and existence
 * checks only, no hashing — `list()` calls this for every item.
 */
export async function probeEditing(
  vaultDir: string,
  local: { id: string; filePath: string; derivedFromAssetId: string | null } | null,
): Promise<EditingState> {
  if (!local) return "needs-source";
  if (!(await hasEditSession(vaultDir, local.id))) {
    return local.derivedFromAssetId ? "exported-only" : "project-available";
  }
  let meta: SessionMeta;
  try {
    meta = JSON.parse(await readFile(sessionMetaPath(vaultDir, local.id), "utf-8")) as SessionMeta;
  } catch {
    return "missing-dependencies";
  }
  let info;
  try {
    info = await stat(local.filePath);
  } catch {
    return "needs-source";
  }
  if (info.size !== meta.sourceSizeBytes || info.mtimeMs !== meta.sourceMtimeMs) return "missing-dependencies";
  for (const assetId of meta.assetIds) {
    if (!(await exists(join(vaultDir, ".kaipu", `${local.id}.assets`, `${assetId}.png`)))) return "missing-dependencies";
  }
  return "project-available";
}
```

- [ ] **Step 4: Run the tests** — `bun run test -- src/main/library`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/library
git commit -m "feat(desktop): edit session source metadata and the editing-state probe"
```

---

### Task 6: Remove local copy — guard and operation

**Files:**

- Create: `src/main/library/remove-local-copy-policy.ts`
- Test: `src/main/library/remove-local-copy-policy.test.ts`
- Modify: `src/main/library/library-vault.ts` (+ test) — `removeLocalCopy(id)`

**Interfaces:**

- Produces: `canRemoveLocalCopy(input): RemoveLocalCopyDecision` (pure) and `LibraryVault.removeLocalCopy(id)`.

```ts
export type RemoveLocalCopyDecision =
  | { allowed: true }
  | { allowed: false; reason: "no-cloud-copy" | "different-bytes" | "hash-unknown" | "edit-project" };
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/library/remove-local-copy-policy.test.ts
import { describe, expect, it } from "vitest";
import { canRemoveLocalCopy } from "./remove-local-copy-policy";

const SHA = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";

describe("canRemoveLocalCopy", () => {
  const local = { contentSha256: SHA, sizeBytes: 10 };
  const cloud = { contentSha256: SHA, sizeBytes: 10 };

  it("allows only an identical, verified cloud replica with no edit project", () => {
    expect(canRemoveLocalCopy({ local, cloud, hasEditSession: false })).toEqual({ allowed: true });
  });

  it("refuses without a cloud copy", () => {
    expect(canRemoveLocalCopy({ local, cloud: null, hasEditSession: false })).toEqual({ allowed: false, reason: "no-cloud-copy" });
  });

  it("refuses when bytes differ or the local hash is unknown", () => {
    expect(canRemoveLocalCopy({ local: { ...local, sizeBytes: 11 }, cloud, hasEditSession: false })).toEqual({ allowed: false, reason: "different-bytes" });
    expect(canRemoveLocalCopy({ local: { contentSha256: null, sizeBytes: 10 }, cloud, hasEditSession: false })).toEqual({ allowed: false, reason: "hash-unknown" });
  });

  it("refuses when an edit project depends on the file, even if bytes match", () => {
    expect(canRemoveLocalCopy({ local, cloud, hasEditSession: true })).toEqual({ allowed: false, reason: "edit-project" });
  });
});
```

Append to `library-vault.test.ts`:

```ts
  it("removeLocalCopy deletes only the media file and keeps identity, thumbnail, session and assets", async () => {
    await writeRecording("keep");
    await vault.writeMeta("keep", { title: "Keep", assetId: "33333333-3333-4333-8333-333333333333" });
    await vault.writeThumbnail("keep", Buffer.from([1]));
    await mkdir(join(directory, ".kaipu", "keep.assets"), { recursive: true });
    await writeFile(join(directory, ".kaipu", "keep.edit.json"), "{}");
    await writeFile(join(directory, ".kaipu", "keep.assets", "a.png"), "png");

    await vault.removeLocalCopy("keep");

    expect(await readdir(directory)).not.toContain("keep.webm");
    const files = await readdir(join(directory, ".kaipu"));
    expect(files).toEqual(expect.arrayContaining(["keep.json", "keep.jpg", "keep.edit.json", "keep.assets"]));
    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "keep.json"), "utf-8"));
    expect(sidecar.assetId).toBe("33333333-3333-4333-8333-333333333333");
    expect(typeof sidecar.localRemovedAt).toBe("number");
    expect(await vault.describe("keep")).toBeNull();
    expect(await vault.list()).toHaveLength(0);
  });

  it("removeLocalCopy propagates a failure to delete the media file", async () => {
    await expect(vault.removeLocalCopy("nope")).rejects.toThrow();
  });
```

- [ ] **Step 2: Run to verify failure** — `bun run test -- src/main/library`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/main/library/remove-local-copy-policy.ts
/**
 * "Remove local download" is only safe when the cloud holds exactly these bytes
 * and nothing local depends on the file. Pure — the caller gathers the inputs.
 * Conservative on purpose: an unknown hash is a refusal, not a guess.
 */
export type RemoveLocalCopyDecision =
  | { allowed: true }
  | { allowed: false; reason: "no-cloud-copy" | "different-bytes" | "hash-unknown" | "edit-project" };

export function canRemoveLocalCopy(input: {
  local: { contentSha256: string | null; sizeBytes: number };
  cloud: { contentSha256: string; sizeBytes: number } | null;
  hasEditSession: boolean;
}): RemoveLocalCopyDecision {
  if (!input.cloud) return { allowed: false, reason: "no-cloud-copy" };
  if (input.hasEditSession) return { allowed: false, reason: "edit-project" };
  if (input.local.contentSha256 === null) return { allowed: false, reason: "hash-unknown" };
  if (input.local.sizeBytes !== input.cloud.sizeBytes || input.local.contentSha256 !== input.cloud.contentSha256) {
    return { allowed: false, reason: "different-bytes" };
  }
  return { allowed: true };
}
```

In `library-vault.ts`:

```ts
  /**
   * Free disk space while keeping the item: deletes ONLY the media file. The
   * sidecar (identity, provenance, hash), thumbnail, edit session and assets stay,
   * so the item survives as a cloud-only entry and can be downloaded back under
   * the same assetId. Not `remove()`: that one is the destructive delete.
   */
  async removeLocalCopy(id: string): Promise<void> {
    const target = await this.filePath(id);
    if (!(await exists(target))) throw new Error(`No local media file for "${id}"`);
    await rm(target);
    await this.writeMeta(id, { localRemovedAt: Date.now() });
  }
```

- [ ] **Step 4: Run the tests** — `bun run test -- src/main/library`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/library
git commit -m "feat(desktop): remove-local-copy operation and its safety policy"
```

---

### Task 7: Account identity — `userId` in the stored session and an accessor for main modules

**Files:**

- Modify: `src/main/services/auth-client.ts`
- Modify: `src/main/infrastructure/auth-store.ts`, `src/main/infrastructure/auth-store.test.ts`
- Modify: `src/shared/types/auth.ts`, `src/shared/entitlements.ts`
- Modify: `src/main/index.ts`

**Interfaces:**

- Produces: `getSession()` resolves `{ userId, email, name } | null`; `SignInResult.userId`;
  `AuthStatus` signed-in gains `userId: string`, `unknown` gains `lastKnownUserId?: string`;
  `registerAuth(...)` returns `AuthHandle { getCurrentAccount(): { userId: string; token: string } | null; onAccountChanged(cb: (userId: string | null) => void): () => void }`;
  `Entitlements.features` gains `cloudUploads: boolean; cloudStorageBytes: number` (mirror of plan 01).

- [ ] **Step 1: Write the failing tests** (append to `auth-store.test.ts`; update `storedBlob` to include `userId: "user-1"`)

```ts
  it("exposes the current account (userId + token) to main modules and notifies on change", async () => {
    vi.spyOn(authClient, "signInWithPassword").mockResolvedValue({
      token: "t1", userId: "user-1", email: "a@b.com", name: "A",
    });
    const handle = registerAuth(config, () => ({ webContents: MAIN_SENDER }) as never);
    const seen: Array<string | null> = [];
    handle.onAccountChanged((userId) => seen.push(userId));

    expect(handle.getCurrentAccount()).toBeNull();
    await mockState.handlers.get(IPC_CHANNELS.authSignIn)!({ sender: MAIN_SENDER }, { email: "a@b.com", password: "x" });
    expect(handle.getCurrentAccount()).toEqual({ userId: "user-1", token: "t1" });

    await mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: MAIN_SENDER });
    expect(handle.getCurrentAccount()).toBeNull();
    expect(seen).toEqual(["user-1", null]);
  });

  it("restores the account id from disk before any server round-trip", async () => {
    await writeFile(join(mockState.userDataDir, "auth.enc"), storedBlob("t-disk"));
    const handle = registerAuth(config, () => null);
    expect(handle.getCurrentAccount()).toEqual({ userId: "user-1", token: "t-disk" });
  });
```

(`MAIN_SENDER` is a sentinel object used as the main window's `webContents`; define it next to
`OTHER_SENDER` if the file does not already have one. `writeFile` comes from `node:fs/promises`.)

- [ ] **Step 2: Run to verify failure** — `bun run test -- src/main/infrastructure/auth-store.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

`auth-client.ts`: `SignInResult` gains `userId: string`; in `callCredentialEndpoint` read
`data.user.id` and return `{ token, userId: data.user.id, email, name }`; `getSession` returns
`{ userId: data.user.id, email, name }` (its `data` type becomes `{ user?: { id: string; email: string; name: string } }`).

`shared/types/auth.ts`:

```ts
export type AuthStatus =
  | { kind: "signed-out" }
  | { kind: "signed-in"; userId: string; email: string; name: string; entitlements: Entitlements }
  | { kind: "unknown"; lastKnownUserId?: string; lastKnownEmail?: string; entitlements?: Entitlements };
```

`shared/entitlements.ts`: add `cloudUploads: boolean; cloudStorageBytes: number;` to `features` and
`FREE_ENTITLEMENTS.features = { watermarkRemoval: false, cloudUploads: false, cloudStorageBytes: 1_000_000_000 }`.

`auth-store.ts`:

```ts
export interface AuthHandle {
  /** The signed-in (or restored-from-disk) account, or null. Never the renderer's business. */
  getCurrentAccount(): { userId: string; token: string } | null;
  /** Fires with the new userId on sign-in and null on sign-out / confirmed-invalid token. */
  onAccountChanged(listener: (userId: string | null) => void): () => void;
}
```

`StoredSession` gains `userId: string` (a stored file without it is treated as absent by
`readStoredSession`, forcing one re-login — acceptable, it predates cloud). `cachedIdentity`
becomes `{ userId, email, name } | null`. `registerAuth` keeps a `Set` of listeners, calls them in
`commitSignIn` (with `result.userId`), in `authSignOut` (null) and in the confirmed-gone branch of
`authGetStatus` (null), and returns:

```ts
  return {
    getCurrentAccount: () => (token && cachedIdentity ? { userId: cachedIdentity.userId, token } : null),
    onAccountChanged: (listener) => {
      accountListeners.add(listener);
      return () => accountListeners.delete(listener);
    },
  };
```

Signed-in statuses include `userId`; `unknown` includes `lastKnownUserId: cachedIdentity?.userId`.

`main/index.ts`: `const auth = registerAuth({ serverUrl: authServerUrl }, () => mainWindow);` and
pass `auth` to `registerLibraryVaultHandlers({ auth, serverUrl: authServerUrl })` (signature
changes in Task 10; until then keep the call unchanged and just hold the handle).

- [ ] **Step 4: Verify** — `bun run test && bun run typecheck`. Expected: PASS (update any test
      asserting the exact signed-in payload to include `userId`).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/auth-client.ts src/main/infrastructure src/shared/types/auth.ts src/shared/entitlements.ts src/main/index.ts
git commit -m "feat(desktop): carry the account id in the stored session and expose it to main modules"
```

---

### Task 8: Cloud catalog — client and per-account cache

**Files:**

- Create: `src/main/cloud/catalog-client.ts`, `src/main/cloud/catalog-client.test.ts`
- Create: `src/main/cloud/catalog-cache.ts`, `src/main/cloud/catalog-cache.test.ts`

**Interfaces:**

- Consumes: the wire contract above; `CloudCatalogEntry` (Task 1).
- Produces: `fetchCloudCatalog(config: { serverUrl }, token, now = Date.now()): Promise<CloudCatalogEntry[]>`
  (follows `nextCursor`, skips assets without a ready revision, rejects on network/non-2xx, throws
  `{ kind: "unauthorized" }` on 401 so callers never treat it as "empty catalog");
  `CatalogCache` class: `constructor(userDataDir)`, `read(userId): Promise<CloudCatalogEntry[] | null>`,
  `write(userId, entries): Promise<void>` (atomic), `clear(userId)`, `path(userId)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/cloud/catalog-client.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCloudCatalog } from "./catalog-client";

const SHA = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const config = { serverUrl: "http://localhost:3000" };

function page(items: unknown[], nextCursor: string | null): Response {
  return new Response(JSON.stringify({ data: { items, nextCursor }, error: null }), { status: 200 });
}

const ready = (assetId: string, overrides: Record<string, unknown> = {}) => ({
  assetId, kind: "recording", title: "T", currentRevisionId: "r1", contentType: "video/mp4",
  sizeBytes: 10, contentSha256: SHA, durationSeconds: 3, hasThumbnail: false,
  derivedFromAssetId: null, autoUploadExcluded: false,
  createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z", ...overrides,
});

describe("fetchCloudCatalog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows cursors, sends the bearer token, and maps ISO dates to epoch ms", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page([ready("a")], "c1"))
      .mockResolvedValueOnce(page([ready("b")], null));
    vi.stubGlobal("fetch", fetchMock);

    const entries = await fetchCloudCatalog(config, "tok", 999);
    expect(entries.map((e) => e.assetId)).toEqual(["a", "b"]);
    expect(entries[0]).toMatchObject({ revisionId: "r1", createdAt: Date.parse("2026-09-10T00:00:00.000Z"), lastVerifiedAt: 999, lastSeenLocalId: null });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe("http://localhost:3000/api/v1/assets?limit=100&cursor=c1");
    expect(new Headers((init as RequestInit).headers).get("authorization")).toBe("Bearer tok");
  });

  it("skips assets whose only revision is not ready yet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page([ready("a", { currentRevisionId: null, sizeBytes: null, contentSha256: null })], null)));
    expect(await fetchCloudCatalog(config, "tok")).toEqual([]);
  });

  it("rejects on 401 with a typed error, and on any other failure — never resolves to []", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(fetchCloudCatalog(config, "tok")).rejects.toEqual({ kind: "unauthorized" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(fetchCloudCatalog(config, "tok")).rejects.toBeInstanceOf(TypeError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(fetchCloudCatalog(config, "tok")).rejects.toThrow(/500/);
  });
});
```

```ts
// src/main/cloud/catalog-cache.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CloudCatalogEntry } from "@shared/types/library-item";
import { CatalogCache } from "./catalog-cache";

const entry = (assetId: string): CloudCatalogEntry => ({
  assetId, kind: "recording", title: "T", revisionId: "r1", contentType: "video/mp4", sizeBytes: 1,
  contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=", durationSeconds: 1, hasThumbnail: false,
  derivedFromAssetId: null, autoUploadExcluded: false, createdAt: 1, lastVerifiedAt: 1, lastSeenLocalId: null,
});

describe("CatalogCache", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-catalog-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is null before the first write and round-trips per account", async () => {
    const cache = new CatalogCache(dir);
    expect(await cache.read("u1")).toBeNull();
    await cache.write("u1", [entry("a")]);
    await cache.write("u2", [entry("b")]);
    expect((await cache.read("u1"))?.map((e) => e.assetId)).toEqual(["a"]);
    expect((await cache.read("u2"))?.map((e) => e.assetId)).toEqual(["b"]);
  });

  it("writes atomically (no .tmp left) and tolerates a corrupt file as null", async () => {
    const cache = new CatalogCache(dir);
    await cache.write("u1", [entry("a")]);
    expect((await readdir(join(dir, "cloud", "u1"))).some((f) => f.endsWith(".tmp"))).toBe(false);
    await writeFile(cache.path("u1"), "{not json");
    expect(await cache.read("u1")).toBeNull();
  });

  it("clear removes only that account's cache", async () => {
    const cache = new CatalogCache(dir);
    await cache.write("u1", [entry("a")]);
    await cache.write("u2", [entry("b")]);
    await cache.clear("u1");
    expect(await cache.read("u1")).toBeNull();
    expect(await cache.read("u2")).not.toBeNull();
  });

  it("refuses a userId that is not a safe path segment", async () => {
    const cache = new CatalogCache(dir);
    await expect(cache.write("../x", [])).rejects.toThrow(/unsafe/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun run test -- src/main/cloud`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/main/cloud/catalog-client.ts
import type { CloudCatalogEntry } from "@shared/types/library-item";

export interface CloudClientConfig {
  serverUrl: string;
}

export type CatalogError = { kind: "unauthorized" };

interface WireAsset {
  assetId: string;
  kind: "recording" | "screenshot";
  title: string;
  currentRevisionId: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  contentSha256: string | null;
  durationSeconds: number;
  hasThumbnail: boolean;
  derivedFromAssetId: string | null;
  autoUploadExcluded: boolean;
  createdAt: string;
  updatedAt: string;
}

const PAGE = 100;

/**
 * The account's ready cloud assets, all pages. Metadata only — no bytes move, so
 * calling this in "Local only" mode is allowed by the product spec. Rejects on
 * every failure: an empty array means "the account has nothing in cloud", never
 * "we could not ask".
 */
export async function fetchCloudCatalog(
  config: CloudClientConfig,
  token: string,
  now: number = Date.now(),
): Promise<CloudCatalogEntry[]> {
  const entries: CloudCatalogEntry[] = [];
  let cursor: string | null = null;
  do {
    const url = new URL(`${config.serverUrl}/api/v1/assets`);
    url.searchParams.set("limit", String(PAGE));
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) throw { kind: "unauthorized" } satisfies CatalogError;
    if (!res.ok) throw new Error(`assets list failed: ${res.status}`);
    const body = (await res.json()) as { data: { items: WireAsset[]; nextCursor: string | null } | null; error: { message: string } | null };
    if (!body.data) throw new Error(body.error?.message ?? "assets list returned no data");
    for (const a of body.data.items) {
      if (!a.currentRevisionId || a.sizeBytes === null || a.contentSha256 === null || a.contentType === null) continue;
      entries.push({
        assetId: a.assetId,
        kind: a.kind,
        title: a.title,
        revisionId: a.currentRevisionId,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        contentSha256: a.contentSha256,
        durationSeconds: a.durationSeconds,
        hasThumbnail: a.hasThumbnail,
        derivedFromAssetId: a.derivedFromAssetId,
        autoUploadExcluded: a.autoUploadExcluded,
        createdAt: Date.parse(a.createdAt),
        lastVerifiedAt: now,
        lastSeenLocalId: null,
      });
    }
    cursor = body.data.nextCursor;
  } while (cursor);
  return entries;
}
```

```ts
// src/main/cloud/catalog-cache.ts
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CloudCatalogEntry } from "@shared/types/library-item";

interface CatalogFile {
  version: 1;
  entries: CloudCatalogEntry[];
}

/**
 * Per-account snapshot of the cloud catalog: `userData/cloud/<userId>/catalog.json`.
 * Lives outside the vault on purpose — it must survive a disconnected drive and a
 * changed vault folder, and it must never be visible to another account.
 */
export class CatalogCache {
  constructor(private readonly userDataDir: string) {}

  path(userId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error(`unsafe userId for a cache path: ${userId}`);
    return join(this.userDataDir, "cloud", userId, "catalog.json");
  }

  async read(userId: string): Promise<CloudCatalogEntry[] | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path(userId), "utf-8")) as CatalogFile;
      return parsed.version === 1 && Array.isArray(parsed.entries) ? parsed.entries : null;
    } catch {
      return null;
    }
  }

  async write(userId: string, entries: CloudCatalogEntry[]): Promise<void> {
    const path = this.path(userId);
    await mkdir(join(this.userDataDir, "cloud", userId), { recursive: true });
    const file: CatalogFile = { version: 1, entries };
    await writeFile(`${path}.tmp`, JSON.stringify(file));
    await rename(`${path}.tmp`, path); // atomic: never a half-written catalog
  }

  async clear(userId: string): Promise<void> {
    await rm(join(this.userDataDir, "cloud", userId), { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run the tests** — `bun run test -- src/main/cloud`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/cloud
git commit -m "feat(desktop): cloud catalog client and per-account cache"
```

---

### Task 9: The composer — one `LibraryItem` per logical asset

**Files:**

- Create: `src/main/library/compose-library.ts`
- Test: `src/main/library/compose-library.test.ts`

**Interfaces:**

- Consumes: `LocalRecording`, `CloudCatalogEntry`, `LibraryItem` (Task 1), `EditingState` probe results (Task 5).
- Produces: pure `composeLibrary(input): { items: LibraryItem[]; catalogUpdates: CloudCatalogEntry[] }` where

```ts
interface ComposeInput {
  /** null = the vault could not be read (unplugged drive, permissions). */
  local: LocalRecording[] | null;
  /** null = no account, or nothing cached yet for this account. */
  catalog: CloudCatalogEntry[] | null;
  /** Editing state per local id, from `probeEditing`. Missing = "project-available". */
  editing: Record<string, EditingState>;
}
```

`catalogUpdates` is the catalog with `lastSeenLocalId` refreshed for entries merged with a local
file — the caller persists it (Task 10) so the next unreadable-vault listing knows which cloud
items used to be here too.

Rules:

| Case                                                             | availability        | comparison      |
| ---------------------------------------------------------------- | ------------------- | --------------- |
| local only                                                       | `local`             | `pending`       |
| cloud only, never seen locally                                   | `cloud`             | `pending`       |
| cloud only, `lastSeenLocalId` set and vault readable (file gone) | `cloud`             | `pending`       |
| cloud only, `lastSeenLocalId` set and vault **unreadable**       | `local-unavailable` | `pending`       |
| both, local hash known and equal (hash + size)                   | `local-and-cloud`   | `same`          |
| both, local hash known and different                             | `local-and-cloud`   | `local-changes` |
| both, local hash unknown                                         | `local-and-cloud`   | `pending`       |

Ordering: newest first by `createdAt` (local `createdAt` wins when both exist). Title: local
title wins when both exist. `transfer` is `{ state: "idle" }` and `sharing` is `"private"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/library/compose-library.test.ts
import { describe, expect, it } from "vitest";
import type { LocalRecording } from "@shared/types/library-storage";
import type { CloudCatalogEntry } from "@shared/types/library-item";
import { composeLibrary } from "./compose-library";

const SHA = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const OTHER = "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=";

const local = (id: string, assetId: string, overrides: Partial<LocalRecording> = {}): LocalRecording => ({
  id, assetId, kind: "recording", title: `Local ${id}`, filePath: `/v/${id}.mp4`, createdAt: 100,
  sizeBytes: 10, durationSeconds: 5, thumbnailUrl: null, derivedFromAssetId: null, contentSha256: SHA, ...overrides,
});
const cloud = (assetId: string, overrides: Partial<CloudCatalogEntry> = {}): CloudCatalogEntry => ({
  assetId, kind: "recording", title: `Cloud ${assetId}`, revisionId: "r1", contentType: "video/mp4", sizeBytes: 10,
  contentSha256: SHA, durationSeconds: 5, hasThumbnail: false, derivedFromAssetId: null, autoUploadExcluded: false,
  createdAt: 50, lastVerifiedAt: 1, lastSeenLocalId: null, ...overrides,
});

describe("composeLibrary", () => {
  it("merges a local file and its cloud revision into ONE entry, local title wins", () => {
    const { items, catalogUpdates } = composeLibrary({ local: [local("f1", "A")], catalog: [cloud("A")], editing: {} });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ assetId: "A", title: "Local f1", availability: "local-and-cloud", comparison: "same" });
    expect(catalogUpdates[0]?.lastSeenLocalId).toBe("f1");
  });

  it("keeps cloud-only items visible without a local file, and local-only items without cloud", () => {
    const { items } = composeLibrary({ local: [local("f1", "A")], catalog: [cloud("B")], editing: {} });
    expect(items.map((i) => [i.assetId, i.availability])).toEqual([
      ["A", "local"],
      ["B", "cloud"],
    ]);
  });

  it("flags local changes when hashes differ and pending when the local hash is unknown", () => {
    const changed = composeLibrary({ local: [local("f1", "A", { contentSha256: OTHER })], catalog: [cloud("A")], editing: {} });
    expect(changed.items[0]?.comparison).toBe("local-changes");
    const unknown = composeLibrary({ local: [local("f1", "A", { contentSha256: null })], catalog: [cloud("A")], editing: {} });
    expect(unknown.items[0]?.comparison).toBe("pending");
  });

  it("an unreadable vault shows items last seen locally as local-unavailable, never as cloud-only", () => {
    const { items } = composeLibrary({
      local: null,
      catalog: [cloud("A", { lastSeenLocalId: "f1" }), cloud("B")],
      editing: {},
    });
    expect(items.map((i) => [i.assetId, i.availability])).toEqual([
      ["A", "local-unavailable"],
      ["B", "cloud"],
    ]);
  });

  it("a readable vault where the file is gone shows the item as cloud (download to edit)", () => {
    const { items } = composeLibrary({ local: [], catalog: [cloud("A", { lastSeenLocalId: "f1" })], editing: {} });
    expect(items[0]?.availability).toBe("cloud");
    expect(items[0]?.editing).toBe("needs-source");
  });

  it("does not associate by filename: same local id, different assetId is a different item", () => {
    const { items } = composeLibrary({
      local: [local("f1", "NEW")],
      catalog: [cloud("OLD", { lastSeenLocalId: "f1" })],
      editing: {},
    });
    expect(items.map((i) => i.assetId).sort()).toEqual(["NEW", "OLD"]);
  });

  it("an export is a separate item related to its source; the editing axis comes from the probe", () => {
    const { items } = composeLibrary({
      local: [local("src", "S"), local("exp", "E", { derivedFromAssetId: "S", createdAt: 200 })],
      catalog: null,
      editing: { src: "project-available", exp: "exported-only" },
    });
    expect(items.map((i) => i.assetId)).toEqual(["E", "S"]); // newest first
    expect(items[0]).toMatchObject({ derivedFromAssetId: "S", editing: "exported-only" });
    expect(items[1]).toMatchObject({ editing: "project-available", transfer: { state: "idle" }, sharing: "private" });
  });

  it("with no account there are only local items", () => {
    const { items, catalogUpdates } = composeLibrary({ local: [local("f1", "A")], catalog: null, editing: {} });
    expect(items).toHaveLength(1);
    expect(items[0]?.cloud).toBeNull();
    expect(catalogUpdates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun run test -- src/main/library/compose-library.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/main/library/compose-library.ts
import type { LocalRecording } from "@shared/types/library-storage";
import type { Availability, CloudCatalogEntry, Comparison, EditingState, LibraryItem } from "@shared/types/library-item";

export interface ComposeInput {
  local: LocalRecording[] | null;
  catalog: CloudCatalogEntry[] | null;
  editing: Record<string, EditingState>;
}

export interface ComposeResult {
  items: LibraryItem[];
  /** The catalog with `lastSeenLocalId` refreshed; persist it. Empty when there is no catalog. */
  catalogUpdates: CloudCatalogEntry[];
}

function compare(local: LocalRecording, cloud: CloudCatalogEntry): Comparison {
  if (local.contentSha256 === null) return "pending";
  return local.contentSha256 === cloud.contentSha256 && local.sizeBytes === cloud.sizeBytes ? "same" : "local-changes";
}

/**
 * Pure merge of the local vault and the account's cloud catalog. The join key is
 * `assetId` and nothing else — never the filename, never the title.
 */
export function composeLibrary(input: ComposeInput): ComposeResult {
  const vaultReadable = input.local !== null;
  const localByAsset = new Map<string, LocalRecording>();
  for (const rec of input.local ?? []) localByAsset.set(rec.assetId, rec);

  const items: LibraryItem[] = [];
  const catalogUpdates: CloudCatalogEntry[] = [];
  const merged = new Set<string>();

  for (const entry of input.catalog ?? []) {
    const local = localByAsset.get(entry.assetId) ?? null;
    let availability: Availability;
    if (local) availability = "local-and-cloud";
    else if (!vaultReadable && entry.lastSeenLocalId) availability = "local-unavailable";
    else availability = "cloud";
    merged.add(entry.assetId);
    catalogUpdates.push({ ...entry, lastSeenLocalId: local ? local.id : entry.lastSeenLocalId });
    items.push({
      assetId: entry.assetId,
      kind: local?.kind ?? entry.kind,
      title: local?.title ?? entry.title,
      createdAt: local?.createdAt ?? entry.createdAt,
      durationSeconds: local?.durationSeconds || entry.durationSeconds,
      derivedFromAssetId: local?.derivedFromAssetId ?? entry.derivedFromAssetId,
      local,
      cloud: entry,
      availability,
      transfer: { state: "idle" },
      comparison: local ? compare(local, entry) : "pending",
      editing: local ? (input.editing[local.id] ?? "project-available") : "needs-source",
      sharing: "private",
    });
  }

  for (const rec of input.local ?? []) {
    if (merged.has(rec.assetId)) continue;
    items.push({
      assetId: rec.assetId,
      kind: rec.kind,
      title: rec.title,
      createdAt: rec.createdAt,
      durationSeconds: rec.durationSeconds,
      derivedFromAssetId: rec.derivedFromAssetId,
      local: rec,
      cloud: null,
      availability: "local",
      transfer: { state: "idle" },
      comparison: "pending",
      editing: input.editing[rec.id] ?? "project-available",
      sharing: "private",
    });
  }

  items.sort((a, b) => b.createdAt - a.createdAt || (a.assetId < b.assetId ? -1 : 1));
  return { items, catalogUpdates };
}
```

- [ ] **Step 4: Run the test** — `bun run test -- src/main/library/compose-library.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/library/compose-library.ts src/main/library/compose-library.test.ts
git commit -m "feat(desktop): compose local files and the cloud catalog into one library entry per asset"
```

---

### Task 10: Main wiring — `library:list-items`, catalog refresh, `library:remove-local-copy`

**Files:**

- Modify: `src/shared/types/ipc.ts` (channels), `src/shared/types/electron-api.ts`, `src/preload/index.ts`
- Create: `src/main/library/library-service.ts`, `src/main/library/library-service.test.ts`
- Modify: `src/main/library/index.ts`, `src/main/index.ts`
- Modify: `src/renderer/src/test/setup.ts` (stubs)

**Interfaces:**

- Produces channels `listLibraryItems: "library:list-items"`, `refreshCloudCatalog: "library:refresh-cloud-catalog"`,
  `removeLocalCopy: "library:remove-local-copy"`; bridge methods
  `listLibraryItems(): Promise<LibraryListResult>`, `refreshCloudCatalog(): Promise<CatalogRefreshResult>`,
  `removeLocalCopy(id: string): Promise<RemoveLocalCopyResult>`; and

```ts
// in src/shared/types/library-item.ts (append)
export interface LibraryListResult {
  items: LibraryItem[];
  /** The vault folder could not be read; `items` still carries cached cloud entries. */
  vaultError: string | null;
  /** null = signed out; otherwise when the cloud catalog was last confirmed (epoch ms) or 0 if never. */
  catalogVerifiedAt: number | null;
}
export type CatalogRefreshResult =
  | { ok: true; verifiedAt: number }
  | { ok: false; reason: "signed-out" | "unauthorized" | "network" };
export type RemoveLocalCopyResult =
  | { ok: true }
  | { ok: false; reason: "no-cloud-copy" | "different-bytes" | "hash-unknown" | "edit-project" | "not-found" };
```

`LibraryService` (constructor `{ vault: () => LibraryVault; vaultDir: () => string; cache: CatalogCache; account: () => { userId; token } | null; fetchCatalog: (token) => Promise<CloudCatalogEntry[]>; now?: () => number }`):

- `list()` — reads the vault (catching the readdir error into `vaultError`), reads the cached catalog
  for the current account, probes editing for each local item, composes, persists `catalogUpdates`, returns `LibraryListResult`.
- `refreshCatalog()` — signed out → `signed-out`; fetches; on success writes the cache and returns `verifiedAt`; on `{ kind: "unauthorized" }` returns `unauthorized` **without clearing the cache**; on anything else `network`.
  Throttled: at most one in-flight fetch; callers awaiting concurrently share it.
- `removeLocalCopy(id)` — describes the item, finds its cloud entry in the cache, calls `vault.ensureContentHash(id)` (this is one of the allowed hashing moments), `hasEditSession`, then `canRemoveLocalCopy`; on allow calls `vault.removeLocalCopy(id)`.

- [ ] **Step 1: Write the failing service tests**

```ts
// src/main/library/library-service.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CloudCatalogEntry } from "@shared/types/library-item";
import { CatalogCache } from "../cloud/catalog-cache";
import { LibraryService } from "./library-service";
import { LibraryVault } from "./library-vault";

const SHA_EMPTY = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";

describe("LibraryService", () => {
  let vaultDir: string;
  let userData: string;
  let account: { userId: string; token: string } | null;
  let catalog: CloudCatalogEntry[];
  let fetchCatalog: ReturnType<typeof vi.fn>;
  let service: LibraryService;

  const cloudEntry = (assetId: string, extra: Partial<CloudCatalogEntry> = {}): CloudCatalogEntry => ({
    assetId, kind: "recording", title: "C", revisionId: "r1", contentType: "video/mp4", sizeBytes: 0,
    contentSha256: SHA_EMPTY, durationSeconds: 1, hasThumbnail: false, derivedFromAssetId: null,
    autoUploadExcluded: false, createdAt: 1, lastVerifiedAt: 1, lastSeenLocalId: null, ...extra,
  });

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "kaipu-svc-vault-"));
    userData = await mkdtemp(join(tmpdir(), "kaipu-svc-data-"));
    account = { userId: "u1", token: "t" };
    catalog = [];
    fetchCatalog = vi.fn(async () => catalog);
    service = new LibraryService({
      vault: () => new LibraryVault(vaultDir),
      vaultDir: () => vaultDir,
      cache: new CatalogCache(userData),
      account: () => account,
      fetchCatalog,
      now: () => 777,
    });
  });
  afterEach(async () => {
    await chmod(vaultDir, 0o700).catch(() => {});
    await rm(vaultDir, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  });

  it("lists local items only when signed out, with catalogVerifiedAt null", async () => {
    account = null;
    await writeFile(join(vaultDir, "a.mp4"), "");
    const result = await service.list();
    expect(result.items.map((i) => i.availability)).toEqual(["local"]);
    expect(result.catalogVerifiedAt).toBeNull();
    expect(result.vaultError).toBeNull();
  });

  it("refreshCatalog caches per account and list merges by assetId", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "");
    const vault = new LibraryVault(vaultDir);
    const rec = (await vault.describe("a"))!;
    catalog = [cloudEntry(rec.assetId), cloudEntry("cloud-only")];
    expect(await service.refreshCatalog()).toEqual({ ok: true, verifiedAt: 777 });
    const result = await service.list();
    expect(result.items.map((i) => [i.assetId, i.availability])).toEqual(
      expect.arrayContaining([[rec.assetId, "local-and-cloud"], ["cloud-only", "cloud"]]),
    );
    expect(result.items).toHaveLength(2);
    expect(result.catalogVerifiedAt).toBe(777);
    // Switching accounts hides the other account's catalog.
    account = { userId: "u2", token: "t2" };
    expect((await service.list()).items.map((i) => i.availability)).toEqual(["local"]);
  });

  it("an unauthorized refresh keeps the cached catalog", async () => {
    catalog = [cloudEntry("x")];
    await service.refreshCatalog();
    fetchCatalog.mockRejectedValueOnce({ kind: "unauthorized" });
    expect(await service.refreshCatalog()).toEqual({ ok: false, reason: "unauthorized" });
    expect((await service.list()).items).toHaveLength(1);
  });

  it.skipIf(process.platform === "win32")("an unreadable vault reports vaultError and keeps cloud items", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "");
    const rec = (await new LibraryVault(vaultDir).describe("a"))!;
    catalog = [cloudEntry(rec.assetId)];
    await service.refreshCatalog();
    await service.list(); // records lastSeenLocalId
    await chmod(vaultDir, 0o000);
    const result = await service.list();
    expect(result.vaultError).toMatch(/EACCES|EPERM/);
    expect(result.items.map((i) => i.availability)).toEqual(["local-unavailable"]);
  });

  it("removeLocalCopy applies the policy and only deletes the media file", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "");
    const rec = (await new LibraryVault(vaultDir).describe("a"))!;
    expect(await service.removeLocalCopy("a")).toEqual({ ok: false, reason: "no-cloud-copy" });
    catalog = [cloudEntry(rec.assetId, { sizeBytes: 0 })];
    await service.refreshCatalog();
    await mkdir(join(vaultDir, ".kaipu"), { recursive: true });
    await writeFile(join(vaultDir, ".kaipu", "a.edit.json"), "{}");
    expect(await service.removeLocalCopy("a")).toEqual({ ok: false, reason: "edit-project" });
    await rm(join(vaultDir, ".kaipu", "a.edit.json"));
    expect(await service.removeLocalCopy("a")).toEqual({ ok: true });
    const after = await service.list();
    expect(after.items.map((i) => i.availability)).toEqual(["cloud"]);
    expect(await service.removeLocalCopy("a")).toEqual({ ok: false, reason: "not-found" });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun run test -- src/main/library/library-service.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the service**

```ts
// src/main/library/library-service.ts
import type { LocalRecording } from "@shared/types/library-storage";
import type {
  CatalogRefreshResult,
  CloudCatalogEntry,
  EditingState,
  LibraryListResult,
  RemoveLocalCopyResult,
} from "@shared/types/library-item";
import type { CatalogCache } from "../cloud/catalog-cache";
import { composeLibrary } from "./compose-library";
import { hasEditSession, probeEditing } from "./edit-project-probe";
import type { LibraryVault } from "./library-vault";
import { canRemoveLocalCopy } from "./remove-local-copy-policy";

export interface LibraryServiceDeps {
  vault: () => LibraryVault;
  vaultDir: () => string;
  cache: CatalogCache;
  account: () => { userId: string; token: string } | null;
  fetchCatalog: (token: string) => Promise<CloudCatalogEntry[]>;
  now?: () => number;
}

/** Everything the library IPC needs, with no Electron import — testable against temp dirs. */
export class LibraryService {
  private inflightRefresh: Promise<CatalogRefreshResult> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: LibraryServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async list(): Promise<LibraryListResult> {
    let local: LocalRecording[] | null = null;
    let vaultError: string | null = null;
    try {
      local = await this.deps.vault().list();
    } catch (err) {
      vaultError = err instanceof Error ? err.message : String(err);
    }
    const account = this.deps.account();
    const catalog = account ? await this.deps.cache.read(account.userId) : null;

    const editing: Record<string, EditingState> = {};
    for (const rec of local ?? []) {
      editing[rec.id] = await probeEditing(this.deps.vaultDir(), rec);
    }

    const { items, catalogUpdates } = composeLibrary({ local, catalog, editing });
    if (account && catalog && local) {
      // Best-effort: remembering which cloud items were also local is what lets an
      // unplugged drive read as "local unavailable" instead of "cloud only".
      await this.deps.cache.write(account.userId, catalogUpdates).catch(() => undefined);
    }
    const catalogVerifiedAt = account ? Math.max(0, ...(catalog ?? []).map((e) => e.lastVerifiedAt)) : null;
    return { items, vaultError, catalogVerifiedAt: account && catalog === null ? 0 : catalogVerifiedAt };
  }

  refreshCatalog(): Promise<CatalogRefreshResult> {
    if (this.inflightRefresh) return this.inflightRefresh;
    this.inflightRefresh = this.doRefresh().finally(() => {
      this.inflightRefresh = null;
    });
    return this.inflightRefresh;
  }

  private async doRefresh(): Promise<CatalogRefreshResult> {
    const account = this.deps.account();
    if (!account) return { ok: false, reason: "signed-out" };
    try {
      const fresh = await this.deps.fetchCatalog(account.token);
      const previous = (await this.deps.cache.read(account.userId)) ?? [];
      const seen = new Map(previous.map((e) => [e.assetId, e.lastSeenLocalId] as const));
      const verifiedAt = this.now();
      await this.deps.cache.write(
        account.userId,
        fresh.map((e) => ({ ...e, lastVerifiedAt: verifiedAt, lastSeenLocalId: seen.get(e.assetId) ?? null })),
      );
      return { ok: true, verifiedAt };
    } catch (err) {
      if (err && typeof err === "object" && "kind" in err && (err as { kind: string }).kind === "unauthorized") {
        return { ok: false, reason: "unauthorized" };
      }
      return { ok: false, reason: "network" };
    }
  }

  async removeLocalCopy(id: string): Promise<RemoveLocalCopyResult> {
    const vault = this.deps.vault();
    const rec = await vault.describe(id);
    if (!rec) return { ok: false, reason: "not-found" };
    const account = this.deps.account();
    const catalog = account ? await this.deps.cache.read(account.userId) : null;
    const cloud = catalog?.find((e) => e.assetId === rec.assetId) ?? null;
    const hashed = cloud ? await vault.ensureContentHash(id) : null;
    const decision = canRemoveLocalCopy({
      local: { contentSha256: hashed?.contentSha256 ?? null, sizeBytes: hashed?.sizeBytes ?? rec.sizeBytes },
      cloud: cloud ? { contentSha256: cloud.contentSha256, sizeBytes: cloud.sizeBytes } : null,
      hasEditSession: await hasEditSession(this.deps.vaultDir(), id),
    });
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    await vault.removeLocalCopy(id);
    return { ok: true };
  }
}
```

- [ ] **Step 4: Wire IPC**

`src/shared/types/ipc.ts` (inside `IPC_CHANNELS`, after `libraryChanged`):

```ts
  // Combined library: local vault + the signed-in account's cloud catalog cache.
  listLibraryItems: "library:list-items",
  refreshCloudCatalog: "library:refresh-cloud-catalog",
  // Frees disk space for an item whose identical bytes are in cloud; never the generic delete.
  removeLocalCopy: "library:remove-local-copy",
```

`src/shared/types/electron-api.ts` (after `onLibraryChanged`):

```ts
  /** One entry per logical item (local, cloud, or both) plus vault/catalog status. */
  listLibraryItems(): Promise<LibraryListResult>;
  /** Re-fetch the cloud catalog for the signed-in account; resolves with why it could not. */
  refreshCloudCatalog(): Promise<CatalogRefreshResult>;
  /** Remove the local media file of an item that has an identical cloud copy. */
  removeLocalCopy(id: string): Promise<RemoveLocalCopyResult>;
```

`src/preload/index.ts`:

```ts
  listLibraryItems: () => ipcRenderer.invoke(IPC_CHANNELS.listLibraryItems),
  refreshCloudCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.refreshCloudCatalog),
  removeLocalCopy: (id) => ipcRenderer.invoke(IPC_CHANNELS.removeLocalCopy, id),
```

`src/main/library/index.ts`: change the signature to
`registerLibraryVaultHandlers(deps: { auth: AuthHandle; serverUrl: string })`, build the service
once, and register the handlers:

```ts
import { app } from "electron";
import type { AuthHandle } from "../infrastructure/auth-store";
import { CatalogCache } from "../cloud/catalog-cache";
import { fetchCloudCatalog } from "../cloud/catalog-client";
import { LibraryService } from "./library-service";

export function registerLibraryVaultHandlers(deps: { auth: AuthHandle; serverUrl: string }): void {
  const service = new LibraryService({
    vault: currentVault,
    vaultDir: () => vaultDirectory().path,
    cache: new CatalogCache(app.getPath("userData")),
    account: deps.auth.getCurrentAccount,
    fetchCatalog: (token) => fetchCloudCatalog({ serverUrl: deps.serverUrl }, token),
  });

  ipcMain.handle(IPC_CHANNELS.listLibraryItems, () => service.list());
  ipcMain.handle(IPC_CHANNELS.refreshCloudCatalog, async () => {
    const result = await service.refreshCatalog();
    if (result.ok) broadcastLibraryChanged();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.removeLocalCopy, async (_event, id: string) => {
    const result = await service.removeLocalCopy(id);
    if (result.ok) broadcastLibraryChanged();
    return result;
  });
  // Account changes (sign-in, sign-out, switch) re-list so the previous account's cloud
  // items disappear at once, and kick a refresh for the new one.
  deps.auth.onAccountChanged((userId) => {
    broadcastLibraryChanged();
    if (userId) void service.refreshCatalog().then((r) => r.ok && broadcastLibraryChanged());
  });
  // …existing handlers unchanged…
}
```

`src/main/index.ts`: `registerLibraryVaultHandlers({ auth, serverUrl: authServerUrl });`.

`src/renderer/src/test/setup.ts` stubs:

```ts
  listLibraryItems: async () => ({ items: [], vaultError: null, catalogVerifiedAt: null }),
  refreshCloudCatalog: async () => ({ ok: false, reason: "signed-out" }),
  removeLocalCopy: async () => ({ ok: false, reason: "not-found" }),
```

- [ ] **Step 5: Verify** — `bun run test && bun run typecheck && bun run lint`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared src/preload src/main src/renderer/src/test/setup.ts
git commit -m "feat(desktop): library service with combined listing, catalog refresh and remove-local-copy IPC"
```

---

### Task 11: Renderer — one card per asset with location labels

**Files:**

- Modify: `src/renderer/src/features/library/types.ts`
- Create: `src/renderer/src/features/library/map-item.ts`, `map-item.test.ts`; delete `map-recording.ts`
- Modify: `src/renderer/src/features/library/library-filters.ts`, `library-filters.test.ts`
- Modify: `src/renderer/src/features/library/hooks/use-local-library.ts`, `use-local-library.test.tsx`
- Modify: `src/renderer/src/features/library/components/storage-meta.tsx`, `video-card.tsx`, `video-row.tsx`, their tests
- Modify: `src/renderer/src/pages/library/library-page.tsx`, `src/renderer/src/pages/library-detail/library-detail-page.tsx`
- Modify: `packages/i18n/messages/en.json`, `packages/i18n/messages/es.json`

**Interfaces:**

- Produces `LibraryVideo` = `{ id: string | null /* local id */, assetId, kind, title, createdAt, durationSeconds, fileSizeBytes, thumbnailUrl, availability, comparison, editing, transfer, derivedFromAssetId, cloudSizeBytes: number | null }`;
  `toLibraryVideo(item: LibraryItem)`; `StorageFilter = "all" | "local" | "cloud"` (overlapping);
  `useLocalLibrary()` additionally returns `vaultError`, `catalogVerifiedAt`, `refreshCloud()`, `removeLocalCopy(id)`.

i18n keys to add under `library` (English / Spanish):

| key                             | en                                                                                                 | es                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `availabilityLocal`             | Local                                                                                              | Local                                                                                                                         |
| `availabilityCloud`             | Cloud                                                                                              | Cloud                                                                                                                         |
| `availabilityBoth`              | Local and cloud                                                                                    | Local y cloud                                                                                                                 |
| `availabilityLocalUnavailable`  | Local location unavailable                                                                         | Ubicación local no disponible                                                                                                 |
| `availabilityUnverified`        | Location to verify                                                                                 | Ubicación por verificar                                                                                                       |
| `comparisonLocalChanges`        | Local changes · the cloud copy has not changed                                                     | Cambios locales · la copia en cloud no ha cambiado                                                                            |
| `editingExportedOnly`           | You can edit this video. The layers and assets of the original project are not stored in cloud.    | Puedes editar este video. Las capas y los recursos del proyecto original no están guardados en cloud.                         |
| `editingProjectAvailable`       | Editing project available on this device                                                           | Proyecto de edición disponible en este dispositivo                                                                            |
| `editingMissingDependencies`    | Project files are missing                                                                          | Faltan archivos del proyecto                                                                                                  |
| `editingNeedsSource`            | Download to edit                                                                                   | Descargar para editar                                                                                                         |
| `exportedFrom`                  | Export of {title}                                                                                  | Exportación de {title}                                                                                                        |
| `cloudOffline`                  | Cloud · offline                                                                                    | Cloud · sin conexión                                                                                                          |
| `vaultUnreadableBanner`         | Your recordings folder can't be read right now. Cloud items are shown from the last known catalog. | No se puede leer tu carpeta de grabaciones ahora mismo. Los elementos en cloud se muestran desde el último catálogo conocido. |
| `removeLocalCopy`               | Remove local download                                                                              | Quitar descarga local                                                                                                         |
| `removeLocalCopyBlockedEdit`    | This file is used by a local editing project. Keep its files to continue editing.                  | Este archivo se usa en un proyecto de edición local. Conserva sus archivos para poder continuar editando.                     |
| `removeLocalCopyBlockedBytes`   | The cloud copy is not identical to this file.                                                      | La copia en cloud no es idéntica a este archivo.                                                                              |
| `removeLocalCopyBlockedNoCloud` | There is no cloud copy of this file.                                                               | No hay copia en cloud de este archivo.                                                                                        |

Remove the now-dead keys `uploadFailed`, `uploading`, `filterFailed` only if no component still
references them after this task (transfer UI returns in plan 03 with its own keys).

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/src/features/library/map-item.test.ts
import { describe, expect, it } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import { toLibraryVideo } from "./map-item";

const item: LibraryItem = {
  assetId: "A", kind: "recording", title: "T", createdAt: 5, durationSeconds: 9, derivedFromAssetId: null,
  local: { id: "f", assetId: "A", kind: "recording", title: "T", filePath: "/v/f.mp4", createdAt: 5, sizeBytes: 10, durationSeconds: 9, thumbnailUrl: "kaipu-media://thumb/f", derivedFromAssetId: null, contentSha256: null },
  cloud: { assetId: "A", kind: "recording", title: "T", revisionId: "r", contentType: "video/mp4", sizeBytes: 12, contentSha256: "x", durationSeconds: 9, hasThumbnail: true, derivedFromAssetId: null, autoUploadExcluded: false, createdAt: 5, lastVerifiedAt: 1, lastSeenLocalId: "f" },
  availability: "local-and-cloud", transfer: { state: "idle" }, comparison: "local-changes", editing: "project-available", sharing: "private",
};

describe("toLibraryVideo", () => {
  it("keeps the local id, the asset id, both sizes and the axes", () => {
    expect(toLibraryVideo(item)).toMatchObject({
      id: "f", assetId: "A", fileSizeBytes: 10, cloudSizeBytes: 12, availability: "local-and-cloud",
      comparison: "local-changes", editing: "project-available", thumbnailUrl: "kaipu-media://thumb/f",
    });
  });

  it("a cloud-only item has no local id, no thumbnail yet, and the cloud size as its size", () => {
    const cloudOnly = { ...item, local: null, availability: "cloud" as const };
    expect(toLibraryVideo(cloudOnly)).toMatchObject({ id: null, fileSizeBytes: 12, thumbnailUrl: null, availability: "cloud" });
  });
});
```

Replace the storage cases in `library-filters.test.ts` with:

```ts
  it("the local and cloud chips overlap: an item with both copies matches both", () => {
    const both = video({ id: "b", availability: "local-and-cloud" });
    const onlyLocal = video({ id: "l", availability: "local" });
    const onlyCloud = video({ id: "c", availability: "cloud" });
    const all = [both, onlyLocal, onlyCloud];
    expect(selectVisibleVideos(all, { ...base, storageFilter: "local" }).map((v) => v.id)).toEqual(["b", "l"]);
    expect(selectVisibleVideos(all, { ...base, storageFilter: "cloud" }).map((v) => v.id)).toEqual(["b", "c"]);
    expect(selectVisibleVideos(all, { ...base, storageFilter: "all" })).toHaveLength(3);
    expect(countByStorage(all)).toEqual({ local: 2, cloud: 2 });
  });
```

(where `video(overrides)` is the file's existing fixture builder, extended with the new fields and
`storage` removed; `base` is the existing default criteria.)

In `use-local-library.test.tsx`, replace the `listLocalRecordings` stubs with
`window.electronAPI.listLibraryItems = vi.fn(async () => ({ items, vaultError: null, catalogVerifiedAt: null }))`
(build `items: LibraryItem[]` from the two recordings via the shape in `map-item.test.ts`), keep
the delete/rename/re-list cases, change the error case to a `vaultError` result:

```ts
  it("flags a vault error without blanking the list, keeping cloud items", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [cloudOnlyItem],
      vaultError: "EACCES",
      catalogVerifiedAt: 10,
    }));
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasError).toBe(true);
    expect(result.current.videos).toHaveLength(1);
  });

  it("removeLocalCopy re-lists on success and reports a blocked reason", async () => {
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({ ok: false, reason: "edit-project" as const }));
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      expect(await result.current.removeLocalCopy("a")).toEqual({ ok: false, reason: "edit-project" });
    });
    expect(reportError).not.toHaveBeenCalled();
  });
```

`storage-meta` / `video-card` / `video-row` tests: assert the label text per availability
(`Local`, `Cloud`, `Local and cloud`, `Local location unavailable`) using the fixtures above, that
`Reveal` (row/detail) is absent for a cloud-only item, and that the card renders the comparison
line for `local-changes`.

- [ ] **Step 2: Run to verify failure** — `bun run test -- src/renderer`. Expected: FAIL.

- [ ] **Step 3: Implement**

`types.ts`:

```ts
import type { Availability, Comparison, EditingState, TransferState } from "@shared/types/library-item";

export type LibraryKind = "recording" | "screenshot";

export interface LibraryVideo {
  /** Local filename id; null for a cloud-only item (nothing to reveal, play or edit locally). */
  id: string | null;
  assetId: string;
  kind: LibraryKind;
  title: string;
  createdAt: number;
  durationSeconds: number;
  /** Local size when present, otherwise the cloud size. */
  fileSizeBytes: number;
  cloudSizeBytes: number | null;
  thumbnailUrl?: string | null;
  availability: Availability;
  comparison: Comparison;
  editing: EditingState;
  transfer: { state: TransferState; progress?: { sentBytes: number; totalBytes: number } };
  derivedFromAssetId: string | null;
  tags?: string[];
}
```

`map-item.ts`:

```ts
import type { LibraryItem } from "@shared/types/library-item";
import type { LibraryVideo } from "./types";

export function toLibraryVideo(item: LibraryItem): LibraryVideo {
  return {
    id: item.local?.id ?? null,
    assetId: item.assetId,
    kind: item.kind,
    title: item.title,
    createdAt: item.createdAt,
    durationSeconds: item.durationSeconds,
    fileSizeBytes: item.local?.sizeBytes ?? item.cloud?.sizeBytes ?? 0,
    cloudSizeBytes: item.cloud?.sizeBytes ?? null,
    thumbnailUrl: item.local?.thumbnailUrl ?? null,
    availability: item.availability,
    comparison: item.comparison,
    editing: item.editing,
    transfer: item.transfer,
    derivedFromAssetId: item.derivedFromAssetId,
  };
}
```

`library-filters.ts`: `StorageFilter = "all" | "local" | "cloud"`, `StorageCounts = { local: number; cloud: number }`;
the filter uses `hasLocalCopy` / `hasCloudCopy` from `@shared/types/library-item`; `countByStorage`
counts with the same helpers.

`use-local-library.ts`: `refresh()` calls `listLibraryItems()`, maps with `toLibraryVideo`, sets
`hasError = result.vaultError !== null` (reporting through `reportError` as today, but **still
setting the videos**), stores `catalogVerifiedAt`; add
`refreshCloud: () => window.electronAPI.refreshCloudCatalog()` and
`removeLocalCopy: async (id) => { const r = await window.electronAPI.removeLocalCopy(id); if (r.ok) await refresh(); return r; }`.
`remove()` and `rename()` keep using the local id and are only offered when `id !== null`.
`useOrphanHeal` receives only videos with a local id.

`storage-meta.tsx`: render `<span className={styles.dot} data-availability={video.availability} />`
plus `t(labelKeyFor(video.availability))`; when `comparison === "local-changes"` add a second line
with `t("comparisonLocalChanges")`. Map: `local → availabilityLocal`, `cloud → availabilityCloud`,
`local-and-cloud → availabilityBoth`, `local-unavailable → availabilityLocalUnavailable`,
`unverified → availabilityUnverified`. Drop the `uploading`/`failed` branches (plan 03 brings the
transfer line back on the `transfer` axis).

`video-card.tsx` / `video-row.tsx`: remove the `storage === "local"` upload button logic (plan 03
re-adds it on the availability axis); the delete button is shown only when `video.id !== null`;
`onNavigate` navigates to `/library/${video.assetId}`.

`library-page.tsx`: the storage chips use `counts.local` / `counts.cloud`; drop the `failed` chip;
show a non-blocking banner `t("vaultUnreadableBanner")` when `hasError && videos.length > 0`
instead of the full-page error (keep the full-page error only when there is nothing to show);
route param becomes `assetId`.

`library-detail-page.tsx`: look up by `assetId` (`useParams<{ assetId }>`), show the availability
label, local/cloud sizes when they differ (`formatSize`), the editing line
(`editingProjectAvailable` / `editingExportedOnly` / `editingMissingDependencies` /
`editingNeedsSource`), `exportedFrom` when `derivedFromAssetId` resolves to a title in `videos`;
hide Reveal/Edit/Copy/Delete when `video.id === null` (cloud-only) — the "Download to edit" action
itself is plan 03. Add a "Remove local download" `Button variant="ghost"` shown when
`availability === "local-and-cloud" && comparison === "same" && editing !== "project-available" || editing === "exported-only"`;
on click call `removeLocalCopy(id)` and, if `ok === false`, toast the matching `removeLocalCopyBlocked*` copy
(the confirm dialog with the full spec copy is plan 04 — here the action is behind the ghost button only).

Update `App`/router: `/library/:assetId`; every `navigate(\`/library/${…}\`)` call site
(`library-page.tsx`, the recorder's post-finalize navigation in `features/recording`, the export
`onSaved`) passes `assetId`—`LocalRecording.assetId`is available everywhere a`LocalRecording`
is returned.

- [ ] **Step 4: Verify** — `bun run test && bun run typecheck && bun run lint`, then `bun run dev`:
      a legacy vault lists once per file with the `Local` label; a signed-in account with cloud assets
      (seed one through the plan 01 API with `curl`) shows `Cloud` for the cloud-only asset and
      `Local and cloud` after uploading a local file's bytes with the same `assetId`; unplugging the
      vault drive (or `chmod 000` on the folder) shows the banner and `Local location unavailable`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer packages/i18n
git commit -m "feat(desktop): combined library with location labels and the remove-local-download action"
```

---

### Task 12: Docs and backlog

**Files:**

- Modify: `apps/documentation/src/content/docs/desktop/library-vault.mdx`
- Modify: `apps/documentation/src/content/docs/backlog/desktop-cloud-sync-gap.md`
- Modify: `apps/documentation/src/content/docs/backlog/index.mdx`

- [ ] **Step 1:** In `library-vault.mdx` add a section **Identity and sidecar v2** with the field
      table (`assetId`, `derivedFromAssetId`, `contentSha256` + `hashedSizeBytes`/`hashedMtimeMs`,
      `localRemovedAt`, `sidecarVersion`), the lazy-mint rule, the "filename is still the local id"
      gotcha, the `.edit.meta.json` file, the `userData/cloud/<userId>/catalog.json` cache, and a
      short **Remove local download vs Delete** comparison table (what each removes).
- [ ] **Step 2:** In `desktop-cloud-sync-gap.md` flip the status to `🟢 Ready to validate` for the
      model decisions (link = `assetId`; thumbnail = per-revision auxiliary object) and state plainly
      that upload/download transfers are still plan 03.
- [ ] **Step 3:** In `index.mdx` update the sync-gap row and the cloud epic row (plans 01/02 written).
- [ ] **Step 4:** `bun run build --filter=documentation` from the root. Expected: builds.
- [ ] **Step 5: Commit**

```bash
git add apps/documentation
git commit -m "docs(desktop): sidecar v2 identity, catalog cache and remove-local-download reference"
```

---

## Self-review against the spec

| Spec requirement (data model / product / delivery Phase 2)                                                                          | Task         |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Stable `assetId` independent of the legacy filename; additive sidecar migration                                                     | 2            |
| `derivedFromAssetId` provenance; exports stay distinct, labelled "Export of …"                                                      | 4, 9, 11     |
| `contentHash`, `sizeBytes` identity; lazy hashing                                                                                   | 3            |
| Five separate axes, no lossy `storage` enum                                                                                         | 1, 9, 11     |
| One entry for local + cloud copies; cloud-only visible; account B does not see A                                                    | 9, 10        |
| Disconnected disk → "local unavailable", associations kept; no reassociation by name                                                | 9, 10        |
| Cached catalog offline ("Cloud · offline"), no empty-library replacement                                                            | 8, 10, 11    |
| Remove local download preserves identity, cloud relation, thumbnail, session, assets; blocked by edit project; identical bytes only | 5, 6, 10, 11 |
| Editing axis: project available / needs source / exported only / missing dependencies                                               | 5            |
| Per-account cache under userData, independent of the media existing                                                                 | 8            |
| Account id available to main without exposing the token to the renderer                                                             | 7            |

Deferred to later plans on purpose: cloud thumbnails, transfers and the transfer panel, upload mode
setting, download-to-edit (03); share links, the remove/delete dialogs with full copy (04);
automatic upload (05); link update (06).
