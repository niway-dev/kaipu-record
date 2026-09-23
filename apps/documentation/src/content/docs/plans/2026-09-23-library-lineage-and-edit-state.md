---
title: "Plan — Library lineage + edit-state indicators"
description: "Implementation plan: expose the edit session's savedAt on library items, derive lineage (source ↔ exports) and the edited/not-exported badge in the renderer, render Source and Exports on the detail page and the badge on cards and rows, and add a save-state chip to the video editor header."
---

# Library lineage + edit-state indicators — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Library, an export links to the recording it came from and a recording lists its exports; a recording with an edit session that has no newer export shows "Edited · not exported"; the video editor header shows the autosave state.

**Architecture:** One main-process addition (`editSavedAt` on `LibraryItem`, read from the existing `edit.meta.json` by the probe that already runs per item). Everything else is renderer: a pure `lineage.ts` module derives `byAssetId`, `exportsOf` and the badge state from the list `useLocalLibrary` already holds; the detail page, card and row render from it. The editor chip is a small extension of `useSessionAutosave` (a React state next to the existing `pendingRef`).

**Tech Stack:** Electron main (Node fs), React 19 + react-router, vitest + Testing Library, `@kaipu/i18n` (`use-intl`), CSS Modules. Commands run from `apps/kaipu-record/`: `bunx vitest run <path>`, `bun run check-types`, `bunx oxlint <path>`, `bunx oxfmt <path>`.

**Spec:** [`backlog/library-lineage`](/backlog/library-lineage/) and [`backlog/edit-state-indicators`](/backlog/edit-state-indicators/). The brainstorm decision (2026-09-23): one PR for both, because the badge needs the `exportsOf` map lineage builds.

## Global Constraints

- All code, comments, tests, commit messages in **English**. UI copy in **both** `packages/i18n/messages/en.json` and `es.json` (neutral Spanish, no regional slang); `packages/i18n` has a parity test that fails when the two files diverge — run `bunx vitest run --root ../../packages/i18n` after touching them.
- No new IPC channels. `listLibraryItems` already returns everything the renderer needs once `editSavedAt` is on `LibraryItem`.
- The probe stays `stat`/read-only — never hash (see the header comment in `src/main/library/edit-project-probe.ts`).
- Commit after every task with a conventional-commit message; end every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` on its own line after a blank line.
- Follow existing component patterns: `Row`, `Badge`, `KindBadge`, CSS Modules with `styles.x`, `useTranslations("library")`.
- lefthook runs format + lint on commit in the main checkout; in a worktree without `node_modules`, run `../../node_modules/.bin/oxfmt` from `apps/kaipu-record` and commit with `--no-verify` (say so in the commit body).

## Review Focus

Inputs the spec implies that no task's tests would otherwise exercise; each line's test is added to the owning task below.

1. **A source that exists only in the cloud on this device** (`id === null`, `availability: "cloud"`) — the Source row must still link (the detail route is by `assetId`, not local id). → Task 4.
2. **An export whose `derivedFromAssetId` points at nothing in the list** (source deleted) — "Source recording was deleted", no link, no crash. → Task 4.
3. **A session saved, then an export made, then the session edited again** (`editSavedAt` newer than every export) — badge must be "not exported" again. → Task 2.
4. **A screenshot item** — never gets the edited badge and never lists exports even if data were present (screenshots have no edit sessions in this sense). → Task 2, Task 5.
5. **Autosave write rejects** — chip shows "Couldn't save", click retries and, on success, shows "Saved". → Task 6.

---

### Task 1: `editSavedAt` on `LibraryItem` (main process)

**Files:**

- Modify: `src/shared/types/library-item.ts` (the `LibraryItem` interface, around line 70)
- Modify: `src/main/library/edit-project-probe.ts`
- Modify: `src/main/library/compose-library.ts`
- Modify: `src/main/library/library-service.ts:45-48`
- Test: `src/main/library/edit-project-probe.test.ts`, `src/main/library/compose-library.test.ts`
- Fix fixtures wherever `bun run check-types` complains about a missing `editSavedAt` (at least `src/shared/types/library-item.test.ts`, `src/renderer/src/features/library/map-item.test.ts`, `src/renderer/src/pages/library-detail/library-detail-page.test.tsx`): add `editSavedAt: null`.

**Interfaces:**

- Produces: `LibraryItem.editSavedAt: number | null` — epoch ms of the last session save, `null` when the item has no edit session (or no local copy). `probeEditSavedAt(vaultDir: string, id: string): Promise<number | null>`. `ComposeInput.editSavedAt: Record<string, number | null>`.

- [ ] **Step 1: Write the failing probe test**

Append to `describe("probeEditing", …)` in `src/main/library/edit-project-probe.test.ts` (inside the describe, after the last `it`):

```ts
  it("probeEditSavedAt returns the session's savedAt, or null without a session", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    expect(await probeEditSavedAt(dir, "r")).toBeNull();
    await saveSession("r", { sessionJson: "{}", assets: [] });
    const savedAt = await probeEditSavedAt(dir, "r");
    expect(typeof savedAt).toBe("number");
    expect(savedAt).toBeGreaterThan(0);
  });

  it("probeEditSavedAt returns null for a session without meta or with corrupt meta", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    await writeFile(join(dir, ".kaipu", "r.edit.json"), "{}");
    expect(await probeEditSavedAt(dir, "r")).toBeNull();
    await writeFile(sessionMetaPath(dir, "r"), "not json");
    expect(await probeEditSavedAt(dir, "r")).toBeNull();
  });
```

and extend the import: `import { hasEditSession, probeEditing, probeEditSavedAt } from "./edit-project-probe";`

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/main/library/edit-project-probe.test.ts`
Expected: FAIL — `probeEditSavedAt` is not exported.

- [ ] **Step 3: Implement `probeEditSavedAt`**

Append to `src/main/library/edit-project-probe.ts`:

```ts
/**
 * When the edit session was last written (epoch ms), or null when the item has no
 * session, no meta sidecar, or an unreadable one. Read-only, like `probeEditing`:
 * the library badge compares this against the item's exports' `createdAt`.
 */
export async function probeEditSavedAt(vaultDir: string, id: string): Promise<number | null> {
  if (!(await hasEditSession(vaultDir, id))) return null;
  try {
    const meta = JSON.parse(await readFile(sessionMetaPath(vaultDir, id), "utf-8")) as SessionMeta;
    return typeof meta.savedAt === "number" ? meta.savedAt : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the probe tests**

Run: `bunx vitest run src/main/library/edit-project-probe.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing compose test**

Append inside `describe("composeLibrary", …)` in `src/main/library/compose-library.test.ts` (look at the existing `it`s to see how `local`/`catalog` fixtures are built, and reuse the same helpers):

```ts
  it("carries editSavedAt from the probe for local items and null for cloud-only ones", () => {
    const local = [localRec("a", { assetId: "asset-a" })];
    const catalog = [cloudEntry("asset-b")];
    const { items } = composeLibrary({
      local,
      catalog,
      editing: { a: "project-available" },
      editSavedAt: { a: 1_700_000_000_000 },
    });
    expect(items.find((i) => i.assetId === "asset-a")?.editSavedAt).toBe(1_700_000_000_000);
    expect(items.find((i) => i.assetId === "asset-b")?.editSavedAt).toBeNull();
  });
```

(If the file's fixture helpers are named differently from `localRec`/`cloudEntry`, use its names — the point is one local item with a probe value and one cloud-only entry.)

- [ ] **Step 6: Run it to verify it fails**

Run: `bunx vitest run src/main/library/compose-library.test.ts`
Expected: FAIL — type error / `editSavedAt` undefined.

- [ ] **Step 7: Add the field to the type, the compose input and both item constructors**

`src/shared/types/library-item.ts`, in `interface LibraryItem` directly after `derivedFromAssetId: string | null;`:

```ts
  /**
   * Epoch ms of the last video-edit-session save on this device, or null when there is
   * no session (or no local copy). Compared against the item's exports to say
   * "edited, not exported" (backlog/edit-state-indicators).
   */
  editSavedAt: number | null;
```

`src/main/library/compose-library.ts`:

```ts
export interface ComposeInput {
  local: LocalRecording[] | null;
  catalog: CloudCatalogEntry[] | null;
  editing: Record<string, EditingState>;
  /** Per local id, from `probeEditSavedAt`. */
  editSavedAt: Record<string, number | null>;
}
```

In the merged-entry constructor (the `items.push({ … editing: local ? … })` block around line 71) add after `editing`:

```ts
      editSavedAt: local ? (input.editSavedAt[local.id] ?? null) : null,
```

In the local-only constructor (around line 90) add after `editing`:

```ts
      editSavedAt: input.editSavedAt[rec.id] ?? null,
```

`src/main/library/library-service.ts` — replace the probe loop:

```ts
    const editing: Record<string, EditingState> = {};
    const editSavedAt: Record<string, number | null> = {};
    for (const rec of local ?? []) {
      editing[rec.id] = await probeEditing(this.deps.vaultDir(), rec);
      editSavedAt[rec.id] = await probeEditSavedAt(this.deps.vaultDir(), rec.id);
    }

    const { items, catalogUpdates } = composeLibrary({ local, catalog, editing, editSavedAt });
```

and extend the import: `import { hasEditSession, probeEditing, probeEditSavedAt } from "./edit-project-probe";`

- [ ] **Step 8: Typecheck and fix fixtures**

Run: `bun run check-types`
Expected: errors only about missing `editSavedAt` in test fixtures (and any other `composeLibrary({...})` call in tests missing `editSavedAt`). Add `editSavedAt: null` to each `LibraryItem` fixture and `editSavedAt: {}` to each `composeLibrary` input until it is clean.

- [ ] **Step 9: Run the main-process suite**

Run: `bunx vitest run src/main/library`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/shared/types/library-item.ts src/main/library src/shared/types/library-item.test.ts src/renderer
git commit -m "feat(library): expose the edit session's savedAt on library items

probeEditSavedAt reads the existing edit.meta.json sidecar (read-only, like
probeEditing); composeLibrary carries it as LibraryItem.editSavedAt so the
renderer can say 'edited, not exported' by comparing it with the exports.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Pure lineage + badge helpers (renderer)

**Files:**

- Modify: `src/renderer/src/features/library/types.ts` (add `editSavedAt` to `LibraryVideo`)
- Modify: `src/renderer/src/features/library/map-item.ts` (copy it through)
- Create: `src/renderer/src/features/library/lineage.ts`
- Test: `src/renderer/src/features/library/lineage.test.ts`, `src/renderer/src/features/library/map-item.test.ts`

**Interfaces:**

- Consumes: `LibraryVideo` (Task 1's field mapped through).
- Produces:

  ```ts
  export interface Lineage {
    byAssetId: Map<string, LibraryVideo>;
    /** Exports of a recording, newest first. Only recordings (never screenshots) appear as keys or values. */
    exportsOf: Map<string, LibraryVideo[]>;
  }
  export function buildLineage(videos: readonly LibraryVideo[]): Lineage;
  export type EditBadge = "not-exported" | "edited" | null;
  export function editBadge(video: LibraryVideo, lineage: Lineage): EditBadge;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/features/library/lineage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "./types";
import { buildLineage, editBadge } from "./lineage";

function video(partial: Partial<LibraryVideo> & { assetId: string }): LibraryVideo {
  return {
    id: partial.assetId,
    kind: "recording",
    title: partial.assetId,
    createdAt: 1_000,
    durationSeconds: 10,
    fileSizeBytes: 1,
    cloudSizeBytes: null,
    thumbnailUrl: null,
    availability: "local",
    comparison: "same",
    editing: "project-available",
    transfer: { state: "idle" },
    derivedFromAssetId: null,
    editSavedAt: null,
    ...partial,
  };
}

describe("buildLineage", () => {
  it("indexes by assetId and groups exports under their source, newest first", () => {
    const src = video({ assetId: "src", createdAt: 100 });
    const older = video({ assetId: "e1", derivedFromAssetId: "src", createdAt: 200 });
    const newer = video({ assetId: "e2", derivedFromAssetId: "src", createdAt: 300 });
    const { byAssetId, exportsOf } = buildLineage([older, src, newer]);
    expect(byAssetId.get("src")).toBe(src);
    expect(exportsOf.get("src")?.map((v) => v.assetId)).toEqual(["e2", "e1"]);
    expect(exportsOf.get("e1")).toBeUndefined();
  });

  it("keeps an export whose source is missing from the list (source deleted)", () => {
    const orphan = video({ assetId: "e", derivedFromAssetId: "gone" });
    const { byAssetId, exportsOf } = buildLineage([orphan]);
    expect(byAssetId.get("gone")).toBeUndefined();
    expect(exportsOf.get("gone")?.map((v) => v.assetId)).toEqual(["e"]);
  });

  it("ignores screenshots on both sides of the relation", () => {
    const shot = video({ assetId: "s", kind: "screenshot", derivedFromAssetId: "src" });
    const { exportsOf } = buildLineage([video({ assetId: "src" }), shot]);
    expect(exportsOf.get("src")).toBeUndefined();
  });
});

describe("editBadge", () => {
  it("is null without a session", () => {
    const v = video({ assetId: "a" });
    expect(editBadge(v, buildLineage([v]))).toBeNull();
  });

  it("is not-exported when the session is newer than every export (or there is none)", () => {
    const v = video({ assetId: "a", editSavedAt: 500 });
    expect(editBadge(v, buildLineage([v]))).toBe("not-exported");
    const olderExport = video({ assetId: "e", derivedFromAssetId: "a", createdAt: 400 });
    expect(editBadge(v, buildLineage([v, olderExport]))).toBe("not-exported");
  });

  it("is edited when an export is newer than the session", () => {
    const v = video({ assetId: "a", editSavedAt: 500 });
    const newerExport = video({ assetId: "e", derivedFromAssetId: "a", createdAt: 600 });
    expect(editBadge(v, buildLineage([v, newerExport]))).toBe("edited");
  });

  it("is null for screenshots and for exports themselves", () => {
    const shot = video({ assetId: "s", kind: "screenshot", editSavedAt: 500 });
    const exp = video({ assetId: "e", derivedFromAssetId: "a", editSavedAt: 500 });
    const lineage = buildLineage([shot, exp]);
    expect(editBadge(shot, lineage)).toBeNull();
    expect(editBadge(exp, lineage)).toBeNull();
  });
});
```

And in `src/renderer/src/features/library/map-item.test.ts`, add `editSavedAt: 123` to the `LibraryItem` fixture and `editSavedAt: 123` to the `toMatchObject` expectation.

- [ ] **Step 2: Run to verify they fail**

Run: `bunx vitest run src/renderer/src/features/library/lineage.test.ts src/renderer/src/features/library/map-item.test.ts`
Expected: FAIL — module `./lineage` not found; map-item expectation mismatch.

- [ ] **Step 3: Implement**

`src/renderer/src/features/library/types.ts` — add after `derivedFromAssetId: string | null;`:

```ts
  /** Epoch ms of the last edit-session save, null without a session (see LibraryItem). */
  editSavedAt: number | null;
```

`src/renderer/src/features/library/map-item.ts` — add `editSavedAt: item.editSavedAt,` after `derivedFromAssetId`.

Create `src/renderer/src/features/library/lineage.ts`:

```ts
/**
 * Source ↔ export relations and the "edited, not exported" badge, derived from the
 * list `useLocalLibrary` already holds (no IPC). `derivedFromAssetId` is written by the
 * editor on export (ADR 0003: an export never replaces its source), so an export's
 * parent is always by assetId — never by title, never by local id.
 */
import type { LibraryVideo } from "./types";

export interface Lineage {
  byAssetId: Map<string, LibraryVideo>;
  /** Exports of a recording, newest first. Screenshots are never keys or values. */
  exportsOf: Map<string, LibraryVideo[]>;
}

export function buildLineage(videos: readonly LibraryVideo[]): Lineage {
  const byAssetId = new Map<string, LibraryVideo>();
  const exportsOf = new Map<string, LibraryVideo[]>();
  for (const v of videos) byAssetId.set(v.assetId, v);
  for (const v of videos) {
    if (v.kind !== "recording" || !v.derivedFromAssetId) continue;
    const list = exportsOf.get(v.derivedFromAssetId) ?? [];
    list.push(v);
    exportsOf.set(v.derivedFromAssetId, list);
  }
  for (const list of exportsOf.values()) list.sort((a, b) => b.createdAt - a.createdAt);
  return { byAssetId, exportsOf };
}

export type EditBadge = "not-exported" | "edited" | null;

/**
 * "not-exported": a session exists and no export of this recording is newer than it —
 * the file on disk is the original and sharing it ships none of the edits.
 * "edited": a session exists and a newer export exists. Exports and screenshots never
 * carry a badge: an export IS the edited file, and screenshots have no session.
 */
export function editBadge(video: LibraryVideo, lineage: Lineage): EditBadge {
  if (video.kind !== "recording" || video.derivedFromAssetId || video.editSavedAt === null) {
    return null;
  }
  const newest = lineage.exportsOf.get(video.assetId)?.[0];
  return newest && newest.createdAt >= video.editSavedAt ? "edited" : "not-exported";
}
```

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/renderer/src/features/library`
Expected: PASS (fix any other fixture in this folder that `check-types` flags for the new field).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/library
git commit -m "feat(library): pure lineage helpers and the edited/not-exported badge state

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: i18n copy

**Files:**

- Modify: `packages/i18n/messages/en.json`, `packages/i18n/messages/es.json` (`library` and `videoEditor` namespaces)

**Interfaces:**

- Produces keys used by Tasks 4–6: `library.source`, `library.sourceDeleted`, `library.exports`, `library.editedNotExported`, `library.editedNotExportedHint`, `library.edited`, `videoEditor.saveStateSaving`, `videoEditor.saveStateSaved`, `videoEditor.saveStateFailed`.

- [ ] **Step 1: Add the keys**

In **both** files, inside `"library"` right after the existing `"exportedFrom"` entry:

en:

```json
    "source": "Source",
    "sourceDeleted": "Source recording was deleted",
    "exports": "Exports",
    "editedNotExported": "Edited · not exported",
    "editedNotExportedHint": "The file on disk is the original. Export to get a video with your edits.",
    "edited": "Edited",
```

es:

```json
    "source": "Origen",
    "sourceDeleted": "La grabación original fue eliminada",
    "exports": "Exportaciones",
    "editedNotExported": "Editado · sin exportar",
    "editedNotExportedHint": "El archivo en disco es el original. Exporta para obtener un video con tus ediciones.",
    "edited": "Editado",
```

Inside `"videoEditor"` right after `"originalUntouched"`:

en:

```json
    "saveStateSaving": "Saving…",
    "saveStateSaved": "Saved",
    "saveStateFailed": "Couldn't save. Click to retry.",
```

es:

```json
    "saveStateSaving": "Guardando…",
    "saveStateSaved": "Guardado",
    "saveStateFailed": "No se pudo guardar. Haz clic para reintentar.",
```

- [ ] **Step 2: Run the parity tests**

Run (from `apps/kaipu-record`): `bunx vitest run --root ../../packages/i18n`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ../../packages/i18n/messages
git commit -m "feat(i18n): lineage, edit badge and save-state copy (en + es)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Detail page — Source row, Exports list, badge

**Files:**

- Modify: `src/renderer/src/pages/library-detail/library-detail-page.tsx` (lines 97–99 and 213–217)
- Modify: `src/renderer/src/pages/library-detail/library-detail-page.module.css`
- Test: `src/renderer/src/pages/library-detail/library-detail-page.test.tsx`

**Interfaces:**

- Consumes: `buildLineage`, `editBadge` from `@renderer/features/library/lineage`; keys from Task 3.

- [ ] **Step 1: Write the failing tests**

Open the test file and read its `renderAt(assetId)` / `listLibraryItems` mock pattern (lines ~120–190) — reuse it exactly. Append a new `describe`:

```ts
describe("LibraryDetailPage — lineage and edit badge", () => {
  const base = {
    kind: "recording" as const,
    createdAt: 1_000,
    durationSeconds: 10,
    local: null,
    cloud: null,
    availability: "local" as const,
    transfer: { state: "idle" as const },
    comparison: "same" as const,
    editing: "project-available" as const,
    sharing: "private" as const,
    derivedFromAssetId: null,
    editSavedAt: null,
  };
  const local = (id: string) => ({
    id,
    assetId: id,
    kind: "recording" as const,
    title: id,
    filePath: `/vault/${id}.mp4`,
    createdAt: 1_000,
    sizeBytes: 1,
    durationSeconds: 10,
    derivedFromAssetId: null,
    contentSha256: null,
  });

  it("links an export to its source and lists exports on the source", async () => {
    const items = [
      { ...base, assetId: "src", title: "Original take", local: local("src") },
      {
        ...base,
        assetId: "exp",
        title: "Original take (export)",
        createdAt: 2_000,
        derivedFromAssetId: "src",
        local: { ...local("exp"), derivedFromAssetId: "src" },
      },
    ];
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items,
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderAt("exp");
    const link = await screen.findByRole("link", { name: /original take$/i });
    expect(link).toHaveAttribute("href", "/library/src");

    renderAt("src");
    expect(await screen.findByText(/^exports$/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /original take \(export\)/i })).toBeInTheDocument();
  });

  it("says the source was deleted when the parent is not in the list", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [{ ...base, assetId: "exp", title: "Orphan", derivedFromAssetId: "gone", local: local("exp") }],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderAt("exp");
    expect(await screen.findByText(/source recording was deleted/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /gone/ })).toBeNull();
  });

  it("links to a cloud-only source (no local id)", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [
        { ...base, assetId: "src", title: "In the cloud", availability: "cloud" as const, editing: "needs-source" as const },
        { ...base, assetId: "exp", title: "Export", derivedFromAssetId: "src", local: local("exp") },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderAt("exp");
    expect(await screen.findByRole("link", { name: /in the cloud/i })).toHaveAttribute("href", "/library/src");
  });

  it("shows 'Edited · not exported' instead of the editing line when a session has no newer export", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [{ ...base, assetId: "src", title: "Take", local: local("src"), editSavedAt: 5_000 }],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderAt("src");
    expect(await screen.findByText(/edited · not exported/i)).toBeInTheDocument();
    expect(screen.queryByText(/editing project available/i)).toBeNull();
  });
});
```

(Adjust the `local(...)` shape to whatever `LocalRecording` fields the file's existing fixtures use — copy from the existing tests rather than inventing. The last assertion's text must match the current English of `library.editingProjectAvailable`; read it in `en.json`.)

- [ ] **Step 2: Run to verify they fail**

Run: `bunx vitest run src/renderer/src/pages/library-detail`
Expected: FAIL — no link / no "Exports" / no badge yet.

- [ ] **Step 3: Implement**

In `library-detail-page.tsx`:

Add imports:

```ts
import { Link } from "react-router-dom";
import { buildLineage, editBadge } from "@renderer/features/library/lineage";
import { Badge } from "@renderer/ui/badge";
import { formatDuration, formatSize, relativeDate } from "@renderer/features/library/format"; // already imported — keep one import
```

(`Link` — extend the existing `react-router-dom` import.)

Replace lines 97–99 (`exportedFromTitle`) with:

```ts
  const lineage = useMemo(() => buildLineage(videos), [videos]);
  const source = video.derivedFromAssetId ? lineage.byAssetId.get(video.derivedFromAssetId) : undefined;
  const sourceDeleted = video.derivedFromAssetId !== null && source === undefined;
  const exports = lineage.exportsOf.get(video.assetId) ?? [];
  const badge = editBadge(video, lineage);
```

(add `useMemo` to the React import at the top: `import { useMemo, useState } from "react";`).

Replace the block at lines 213–217 with:

```tsx
          {!isScreenshot && badge === null && (
            <p className={styles.editingLine}>{t(EDITING_LABEL_KEYS[video.editing])}</p>
          )}
          {badge === "not-exported" && (
            <button
              type="button"
              className={styles.badgeButton}
              title={t("editedNotExportedHint")}
              onClick={editVideo}
              disabled={!canEditVideo}
            >
              <Badge variant="warning">{t("editedNotExported")}</Badge>
            </button>
          )}
          {badge === "edited" && (
            <p className={styles.editingLine}>{t("edited")}</p>
          )}
          {(source || sourceDeleted) && (
            <p className={styles.editingLine}>
              <span className={styles.lineageLabel}>{t("source")}</span>
              {source ? (
                <Link to={`/library/${source.assetId}`} className={styles.lineageLink}>
                  {source.title}
                </Link>
              ) : (
                t("sourceDeleted")
              )}
            </p>
          )}
```

After the closing `</div>` of `styles.bar` (i.e. after the actions block, before the page's closing `</div>`), add the exports section:

```tsx
      {exports.length > 0 && (
        <section className={styles.exports} aria-labelledby="exports-heading">
          <h2 id="exports-heading" className={styles.exportsHeading}>
            {t("exports")}
          </h2>
          <ul className={styles.exportsList}>
            {exports.map((e) => (
              <li key={e.assetId} className={styles.exportItem}>
                {e.thumbnailUrl ? (
                  <img src={e.thumbnailUrl} alt="" className={styles.exportThumb} />
                ) : (
                  <span className={styles.exportThumb} aria-hidden />
                )}
                <Link to={`/library/${e.assetId}`} className={styles.lineageLink}>
                  {e.title}
                </Link>
                <span className={styles.metaItem}>
                  {relativeDate(e.createdAt)} · {formatDuration(e.durationSeconds)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
```

`editVideo` and `canEditVideo` already exist in this component (they drive the "Edit video" button) — reuse them, do not redefine.

Append to `library-detail-page.module.css`:

```css
.badgeButton {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.badgeButton:disabled {
  cursor: default;
}

.lineageLabel {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-right: 8px;
}

.lineageLink {
  color: var(--text-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.lineageLink:hover {
  color: var(--accent-primary);
}

.exports {
  margin-top: 24px;
}

.exportsHeading {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.exportsList {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.exportItem {
  display: flex;
  align-items: center;
  gap: 12px;
}

.exportThumb {
  width: 64px;
  height: 36px;
  border-radius: 6px;
  background: var(--bg-card);
  object-fit: cover;
  flex-shrink: 0;
}
```

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/renderer/src/pages/library-detail`
Expected: PASS (all, including the pre-existing ones — `exportedFrom` is no longer rendered; if an existing test asserted it, update that test to look for the `Source` row instead).

- [ ] **Step 5: Lint, format, commit**

```bash
bunx oxlint src/renderer/src/pages/library-detail && bunx oxfmt src/renderer/src/pages/library-detail
git add src/renderer/src/pages/library-detail
git commit -m "feat(library): Source link, Exports list and edit badge on the detail page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Badge on the library card and row

**Files:**

- Create: `src/renderer/src/features/library/components/edit-badge.tsx`, `edit-badge.module.css`
- Modify: `src/renderer/src/features/library/components/video-card.tsx`, `video-row.tsx`
- Modify: `src/renderer/src/pages/library/library-page.tsx` (pass `lineage` down — find where `VideoCard`/`VideoRow` are rendered)
- Test: `src/renderer/src/features/library/components/edit-badge.test.tsx`, plus one case each in `video-card.test.tsx` and `video-row.test.tsx`

**Interfaces:**

- Produces: `<EditBadge state={EditBadge} />` renders nothing for `null`.
- `VideoCard` and `VideoRow` gain an optional prop `badge?: EditBadge` (default `null`) so their existing tests keep passing unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/features/library/components/edit-badge.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditBadge } from "./edit-badge";

describe("EditBadge", () => {
  it("renders nothing for null", () => {
    const { container } = render(<EditBadge state={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the accent badge with the hint for not-exported", () => {
    render(<EditBadge state="not-exported" />);
    const el = screen.getByText(/edited · not exported/i);
    expect(el).toHaveAttribute("title", expect.stringMatching(/original/i));
  });

  it("renders the muted badge for edited", () => {
    render(<EditBadge state="edited" />);
    expect(screen.getByText(/^edited$/i)).toBeInTheDocument();
  });
});
```

In `video-card.test.tsx` and `video-row.test.tsx` add one case each:

```tsx
  it("shows the edit badge when given one", () => {
    render(<VideoCard video={video} badge="not-exported" onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/edited · not exported/i)).toBeInTheDocument();
  });
```

(same for `VideoRow`; add `editSavedAt: null` to both files' `video` fixtures — `check-types` will demand it).

- [ ] **Step 2: Run to verify they fail**

Run: `bunx vitest run src/renderer/src/features/library/components`
Expected: FAIL — module not found / badge not rendered.

- [ ] **Step 3: Implement**

`edit-badge.tsx`:

```tsx
import { useTranslations } from "@kaipu/i18n";
import type { EditBadge as EditBadgeState } from "../lineage";
import styles from "./edit-badge.module.css";

/**
 * "Edited · not exported" (accent) or "Edited" (muted) on cards, rows and the detail
 * page — the library-side signal that the file on disk is still the original.
 */
export function EditBadge({ state }: { state: EditBadgeState }): React.JSX.Element | null {
  const t = useTranslations("library");
  if (state === null) return null;
  return state === "not-exported" ? (
    <span className={styles.notExported} title={t("editedNotExportedHint")}>
      {t("editedNotExported")}
    </span>
  ) : (
    <span className={styles.edited}>{t("edited")}</span>
  );
}
```

`edit-badge.module.css`:

```css
.notExported,
.edited {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.notExported {
  color: var(--accent-primary);
  background: rgba(246, 5, 92, 0.12);
  border: 1px solid rgba(246, 5, 92, 0.35);
}

.edited {
  color: var(--text-muted);
  background: var(--bg-card-hover);
  border: 1px solid var(--border);
}
```

`video-card.tsx`: add `badge?: EditBadgeState;` to `VideoCardProps` (import `type EditBadge as EditBadgeState` from `../lineage` and `EditBadge` from `./edit-badge`), default `badge = null` in the destructuring, and render it inside `.metaLine` after `<StorageMeta video={video} />`:

```tsx
          <StorageMeta video={video} />
          <EditBadge state={badge} />
```

`video-row.tsx`: same prop; render after `<StorageMeta video={video} />` inside `.metaLine`.

`library-page.tsx`: where the list is rendered, build `const lineage = useMemo(() => buildLineage(videos), [videos]);` (the page already has `videos` from `useLocalLibrary`; if it only has a filtered subset, build the lineage from the **unfiltered** list so a filtered-out export still counts) and pass `badge={editBadge(video, lineage)}` to each `VideoCard` / `VideoRow`.

- [ ] **Step 4: Run tests + typecheck**

Run: `bunx vitest run src/renderer/src/features/library src/renderer/src/pages/library && bun run check-types`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
bunx oxlint src/renderer/src/features/library src/renderer/src/pages/library && bunx oxfmt src/renderer/src/features/library src/renderer/src/pages/library
git add src/renderer/src/features/library src/renderer/src/pages/library
git commit -m "feat(library): edited/not-exported badge on cards and rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Save-state chip in the video editor header

**Files:**

- Modify: `src/renderer/src/features/video-editor/use-session-autosave.ts`
- Modify: `src/renderer/src/pages/video-editor/video-editor-page.tsx:908-917` (header) and its CSS module (add `.saveState`)
- Test: `src/renderer/src/features/video-editor/use-session-autosave.test.ts`

**Interfaces:**

- Produces on `SessionAutosave`: `state: "idle" | "saving" | "saved" | "failed"` and `retry(): Promise<void>`. `pendingRef`, `flush`, `cancel` unchanged.

- [ ] **Step 1: Write the failing tests**

Read the existing test file first: it renders the hook with `renderHook`, fakes timers, and stubs `window.electronAPI.saveVideoEditSession`. Append inside its top-level `describe`:

```ts
  it("exposes saving → saved around a successful write", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.saveVideoEditSession = save;
    const { result, rerender } = renderHook(
      ({ scene }) => useSessionAutosave("id", scene, false, assetStoreRef),
      { initialProps: { scene: sceneA } },
    );
    expect(result.current.state).toBe("idle");
    rerender({ scene: sceneB });
    expect(result.current.state).toBe("saving");
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("saved");
  });

  it("exposes failed when the write rejects, and retry() writes again", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValue(undefined);
    window.electronAPI.saveVideoEditSession = save;
    const { result, rerender } = renderHook(
      ({ scene }) => useSessionAutosave("id", scene, false, assetStoreRef),
      { initialProps: { scene: sceneA } },
    );
    rerender({ scene: sceneB });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(result.current.state).toBe("failed");
    expect(result.current.pendingRef.current).toBe(true);
    await act(async () => {
      await result.current.retry();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("saved");
  });
```

(`sceneA`, `sceneB`, `assetStoreRef` — use the fixtures the file already defines; if it names them differently, use its names.)

- [ ] **Step 2: Run to verify they fail**

Run: `bunx vitest run src/renderer/src/features/video-editor/use-session-autosave.test.ts`
Expected: FAIL — `state` undefined.

- [ ] **Step 3: Implement**

In `use-session-autosave.ts`:

```ts
export type SaveState = "idle" | "saving" | "saved" | "failed";

export interface SessionAutosave {
  pendingRef: React.MutableRefObject<boolean>;
  flush(): Promise<void>;
  cancel(): void;
  /** For the header chip: "saving" from the first edit until the write settles. */
  state: SaveState;
  /** Write now after a failure (the chip's click). No-op unless something is pending. */
  retry(): Promise<void>;
}
```

Inside the hook add `const [state, setState] = useState<SaveState>("idle");` (import `useState`). In `write`: set `setState("saving")` first thing; on success (inside the `if (sceneRef.current === snapshot)` branch) `setState("saved")`, and in the `catch` `setState("failed")`. In the scene effect, right after `pendingRef.current = true;` add `setState("saving");`. In `cancel`, `setState("idle")`. Add:

```ts
  const retry = useCallback(async (): Promise<void> => {
    if (!pendingRef.current) return;
    await write();
  }, [write]);
```

and return `{ pendingRef, flush, cancel, state, retry }`.

In `video-editor-page.tsx` header, after the `originalPill` Badge:

```tsx
        {autosave.state !== "idle" && (
          <button
            type="button"
            className={styles.saveState}
            data-state={autosave.state}
            onClick={autosave.state === "failed" ? () => void autosave.retry() : undefined}
            disabled={autosave.state !== "failed"}
            aria-live="polite"
          >
            {autosave.state === "saving" && t("saveStateSaving")}
            {autosave.state === "saved" && t("saveStateSaved")}
            {autosave.state === "failed" && t("saveStateFailed")}
          </button>
        )}
```

In the page's CSS module:

```css
.saveState {
  margin-left: 10px;
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  letter-spacing: 0.08em;
  color: var(--text-muted);
  cursor: default;
}

.saveState[data-state="failed"] {
  color: var(--accent-primary);
  cursor: pointer;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bunx vitest run src/renderer/src/features/video-editor/use-session-autosave.test.ts src/renderer/src/pages/video-editor && bun run check-types`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
bunx oxlint src/renderer/src/features/video-editor src/renderer/src/pages/video-editor && bunx oxfmt src/renderer/src/features/video-editor src/renderer/src/pages/video-editor
git add src/renderer/src/features/video-editor src/renderer/src/pages/video-editor
git commit -m "feat(video-editor): save-state chip driven by the session autosave

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Docs + full verification

**Files:**

- Modify: `apps/documentation/src/content/docs/backlog/edit-state-indicators.md` (status banner → `🟢 Ready to validate`, PR link)
- Modify: `apps/documentation/src/content/docs/backlog/library-lineage.md` (same)
- Modify: `apps/documentation/src/content/docs/backlog/index.mdx` (both rows → `🟢 Ready to validate (#PR)`)

- [ ] **Step 1: Run everything**

From `apps/kaipu-record`: `bun run check-types && bunx vitest run && bunx oxlint src`
Expected: all green (record the totals in the PR body).

- [ ] **Step 2: Update the docs**

Change each doc's first blockquote line to `> **Status: 🟢 Ready to validate** — implemented in [#NNN](https://github.com/csdev19/kaipu-record-monorepo/pull/NNN) (2026-09-23). Originally proposed …` keeping the rest of the paragraph. Update the two index rows' status column. Run `../../node_modules/.bin/oxfmt` on the three files (or `bunx oxfmt` from the repo root).

- [ ] **Step 3: Commit and open the PR**

```bash
git add apps/documentation
git commit -m "docs(backlog): lineage and edit-state indicators ready to validate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

PR title: `feat(library): lineage (source ↔ exports) and edited/not-exported badge + editor save state`. Body: summary, a **What to review** section (route the reviewer to `lineage.ts` first, then the probe's new function, then the detail page), test plan with the manual checks from both spec docs' Acceptance sections, and end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
