---
title: "15 · Orphan heal"
description: "Closes LIB-A7 and LIB-B9: the orphan heal reads whole recordings into a Blob, retries undecodable or sub-second recordings on every list change, and also runs inside the editor."
---

# Orphan heal — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Healing a recording's missing duration/poster reads only the container metadata and one keyframe over Range requests, is attempted at most once per app launch per id, and runs only on the Library page.

**Architecture:** `healOrphanMetadata` and `generateThumbnail` read through mediabunny's Range-aware `UrlSource` over `kaipu-media://recording/<id>` (the pattern `probe-source.ts` already uses) instead of `fetch().blob()`; inputs are disposed in `finally`. The `attempted` set becomes module-level and is never cleared on failure, so each id is tried once per launch (no sidecar stamp: the renderer cannot see sidecar fields today and the module set already gives the semantics we need). `useLocalLibrary({ heal })` gates the hook; only `library-page.tsx` passes `heal: true`.

**Tech Stack:** mediabunny `UrlSource`/`Input`/`CanvasSink`, vitest `renderHook` (existing mocks in `use-orphan-heal.test.ts`, `heal-orphan-metadata.test.ts`, `generate-thumbnail.test.ts`).

**Spec:** [Audit report](/audits/2026-10-15/report/) → LIB-A7 in [library lens A](/audits/2026-10-15/findings/library-a/), LIB-B9 in [library lens B](/audits/2026-10-15/findings/library-b/). Closes: **LIB-A7, LIB-B9**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- Range support on `kaipu-media://recording/<id>` is assumed from `probe-source.ts` using the same URL; plan 28 adds the CORS `access-control-expose-headers` for `content-range`/`content-length` so mediabunny learns the file size — land plan 28 first or include that one-line header here.
- Sub-second clips: the renderer only knows `durationSeconds === 0`; do not persist `Math.max(1, …)` (changes the recorder's flooring convention). With Range reads and once-per-launch, the endless retry is closed without a special case.
- Behaviour changes to state in the PR: orphans heal only when the user visits the Library; a transient failure waits for the next launch (before: the next list change).
- If plan 10 (singleton store) has landed, `useOrphanHeal` is called from the `useLocalLibrary` adapter; the `heal` option still gates it there.
- Commit messages in English, conventional-commit style.

## Review Focus

1. A heal that returns `null` or throws is not retried on a re-render with a new array identity — Task 2 tests.
2. A heal is not retried across unmount/remount within the same launch — Task 2 test.
3. `healOrphanMetadata` never calls `fetch`; it constructs `UrlSource` with the recording URL — Task 1 test.
4. `useLocalLibrary()` without `heal` never calls the healer; with `heal: true` it does once — Task 3 test.
5. `generateThumbnail` disposes its `Input` on every path — Task 1 (stub needs `dispose`).

---

### Task 1: Range-aware reads

**Files:**

- Modify: `renderer/src/lib/generate-thumbnail.ts`
- Modify: `renderer/src/features/library/media/heal-orphan-metadata.ts`
- Test: `renderer/src/lib/generate-thumbnail.test.ts`, `renderer/src/features/library/media/heal-orphan-metadata.test.ts`

**Interfaces:**

- Produces: `generateThumbnail(source: Blob | Source, atSeconds?)`.

- [ ] **Step 1: Write the failing tests**

`heal-orphan-metadata.test.ts`: add `UrlSource: vi.fn()` to the mediabunny mock and `dispose: () => {}` to the `Input` stub returned by `stubDuration`; replace the `fetch` assertion:

```ts
it("reads through a Range-aware UrlSource, never fetch", async () => {
  stubDuration(12);
  await healOrphanMetadata("orphan-1");
  expect(UrlSource).toHaveBeenCalledWith("kaipu-media://recording/orphan-1");
  expect(fetch).not.toHaveBeenCalled();
});
```

`generate-thumbnail.test.ts`: add `dispose: () => {}` to `stubInput`'s return; add:

```ts
it("accepts a mediabunny Source without wrapping it in a BlobSource", async () => {
  stubInput(null);
  const source = {} as Source;
  await generateThumbnail(source, 0);
  expect(BlobSource).not.toHaveBeenCalled();
  expect(InputMock).toHaveBeenCalledWith(expect.objectContaining({ source }));
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

`generate-thumbnail.ts` (verify `Source` is exported as a type by the installed mediabunny: `grep -n "Source" node_modules/mediabunny/dist/modules/src/index.d.ts`):

```ts
import { ALL_FORMATS, BlobSource, CanvasSink, Input, type Source } from "mediabunny";

/**
 * JPEG poster (POSTER_WIDTH wide) at `atSeconds`.
 * @param source a Blob, or a mediabunny Source (e.g. a Range-backed UrlSource) so a large
 *   file is never fully read.
 */
export async function generateThumbnail(source: Blob | Source, atSeconds = 0): Promise<ArrayBuffer | null> {
  let input: Input | undefined;
  try {
    input = new Input({
      source: source instanceof Blob ? new BlobSource(source) : source,
      formats: ALL_FORMATS,
    });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const sink = new CanvasSink(track, { width: POSTER_WIDTH });
    for await (const wrapped of sink.canvasesAtTimestamps([Math.max(0, atSeconds)])) {
      if (!wrapped) continue;
      const canvas = wrapped.canvas as HTMLCanvasElement;
      const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
      return jpeg ? await jpeg.arrayBuffer() : null;
    }
    return null;
  } catch {
    return null;
  } finally {
    input?.dispose();
  }
}
```

`heal-orphan-metadata.ts`:

```ts
import { ALL_FORMATS, Input, UrlSource } from "mediabunny";
import type { RecordingBackfillMeta } from "@shared/types";
import { generateThumbnail } from "@renderer/lib/generate-thumbnail";

/**
 * Duration + poster for a recording whose sidecar never got them. Zero duration means
 * "unreadable" (sub-second clips share this fate); leaving it an orphan lets the next
 * app launch retry (the hook attempts each id once per launch).
 */
export async function healOrphanMetadata(id: string): Promise<RecordingBackfillMeta | null> {
  const url = `kaipu-media://recording/${id}`;
  let input: Input | undefined;
  try {
    // Range-aware reads: only the container metadata and one keyframe cross the
    // protocol, never the whole recording (same pattern as probe-source.ts). A 404
    // makes UrlSource throw, which lands in the catch below.
    input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
    const durationSeconds = Math.floor(await input.computeDuration());
    if (durationSeconds <= 0) return null;
    const thumbnail = await generateThumbnail(new UrlSource(url), Math.min(1, durationSeconds / 2));
    return { durationSeconds, thumbnail };
  } catch {
    return null;
  } finally {
    input?.dispose();
  }
}
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/lib/generate-thumbnail.test.ts src/renderer/src/features/library/media` → PASS.

```bash
git add src/renderer/src/lib/generate-thumbnail.ts src/renderer/src/lib/generate-thumbnail.test.ts src/renderer/src/features/library/media
git commit -m "perf(desktop): orphan heal reads metadata and one frame over Range, not the whole file"
```

### Task 2: Attempt once per launch

**Files:**

- Modify: `renderer/src/features/library/hooks/use-orphan-heal.ts:34-94`
- Test: `renderer/src/features/library/hooks/use-orphan-heal.test.ts`

**Interfaces:**

- Produces: `resetOrphanHealAttempts()` (tests only).

- [ ] **Step 1: Write the failing tests** (call `resetOrphanHealAttempts()` in `beforeEach`)

```ts
it("does not retry an orphan whose heal returned null", async () => {
  healMock.mockResolvedValue(null);
  const orphans = [video({ id: "bad" })];
  const { rerender } = renderHook(({ v }) => useOrphanHeal(v, vi.fn()), { initialProps: { v: orphans } });
  await waitFor(() => expect(healMock).toHaveBeenCalledOnce());
  rerender({ v: [...orphans] });
  await Promise.resolve();
  expect(healMock).toHaveBeenCalledOnce();
  expect(window.electronAPI.backfillLocalRecordingMeta).not.toHaveBeenCalled();
});

it("does not retry after a thrown heal", async () => {
  healMock.mockRejectedValue(new Error("x"));
  const orphans = [video({ id: "boom" })];
  const { rerender } = renderHook(({ v }) => useOrphanHeal(v, vi.fn()), { initialProps: { v: orphans } });
  await waitFor(() => expect(healMock).toHaveBeenCalledOnce());
  rerender({ v: [...orphans] });
  await Promise.resolve();
  expect(healMock).toHaveBeenCalledOnce();
});

it("does not retry across a remount", async () => {
  healMock.mockResolvedValue(null);
  const orphans = [video({ id: "again" })];
  const first = renderHook(() => useOrphanHeal(orphans, vi.fn()));
  await waitFor(() => expect(healMock).toHaveBeenCalledOnce());
  first.unmount();
  renderHook(() => useOrphanHeal(orphans, vi.fn()));
  await Promise.resolve();
  expect(healMock).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run to verify they fail** — the first two FAIL (retry after `null`/throw).

- [ ] **Step 3: Implement**

Module scope after `MAX_CONCURRENT_HEALS`:

```ts
/**
 * Ids already tried this app launch. Module-level on purpose: a failed heal (corrupt
 * file, sub-second clip, poster that won't decode) must not re-read the file on every
 * re-list or page remount. A new launch retries once.
 */
const attempted = new Set<string>();

/** Test-only: forget every attempt. */
export function resetOrphanHealAttempts(): void {
  attempted.clear();
}
```

Delete the `const attempted = useRef<Set<string>>(new Set());` line; replace every `attempted.current.` with `attempted.`; the `!meta` branch becomes `if (!meta) return;` and the `catch` body becomes `// stays in "attempted": retried on the next launch, not on every list change`. Rewrite the hook's doc paragraph accordingly (an id is added before its heal starts and never removed; mounted by the Library page only).

- [ ] **Step 4: Run and commit** — PASS.

```bash
git add src/renderer/src/features/library/hooks/use-orphan-heal.ts src/renderer/src/features/library/hooks/use-orphan-heal.test.ts
git commit -m "fix(desktop): orphan heal attempts each recording once per launch"
```

### Task 3: Heal only on the Library page

**Files:**

- Modify: `renderer/src/features/library/hooks/use-local-library.ts:34`, `:114-122`
- Modify: `renderer/src/pages/library/library-page.tsx:45`
- Test: `renderer/src/features/library/hooks/use-local-library.test.tsx`

**Interfaces:**

- Produces: `useLocalLibrary(options?: { heal?: boolean })`.

- [ ] **Step 1: Write the failing test** (mock `@renderer/features/library/media/heal-orphan-metadata`; make the listing return an orphan — `durationSeconds: 0`, no thumbnail)

```ts
it("heals orphans only when asked", async () => {
  const a = renderHook(() => useLocalLibrary());
  await waitFor(() => expect(a.result.current.isLoading).toBe(false));
  expect(healMock).not.toHaveBeenCalled();
  a.unmount();
  const b = renderHook(() => useLocalLibrary({ heal: true }));
  await waitFor(() => expect(healMock).toHaveBeenCalledOnce());
  b.unmount();
});
```

- [ ] **Step 2: Run to verify it fails** — the first hook heals.

- [ ] **Step 3: Implement**

```ts
const NO_HEAL: Array<LibraryVideo & { id: string }> = []; // module scope, stable identity

export interface LocalLibraryOptions {
  /**
   * Heal orphaned recordings in the background. Only the Library page asks for it: the
   * editor and detail pages share this hook but must not start decodes that compete
   * with their own preview.
   */
  heal?: boolean;
}

export function useLocalLibrary({ heal = false }: LocalLibraryOptions = {}): LocalLibrary {
  // ...
  useOrphanHeal(heal ? localVideos : NO_HEAL, patchHealed);
```

`library-page.tsx:45`: `useLocalLibrary({ heal: true })`. The other four call sites keep the default.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/library src/renderer/src/pages && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/library/hooks/use-local-library.ts src/renderer/src/features/library/hooks/use-local-library.test.tsx src/renderer/src/pages/library/library-page.tsx
git commit -m "perf(desktop): orphan heal runs only on the Library page"
```

### Task 4: Ship

- [ ] Open a PR titled `perf(desktop): orphan heal reads by Range and runs once per launch (audit LIB-A7, LIB-B9)` linking this plan and both findings; state the two behaviour changes. End with **How to test it yourself**:
  1. `head -c 100000 any.mp4 > "<vault>/broken.mp4"`, open the Library → DevTools Network shows Range requests on `kaipu-media://recording/broken` (not a full download), at most one attempt.
  2. Press Sync and edit a tag → no new attempt. Open another recording in the video editor → no heal activity.
  3. Relaunch → exactly one attempt again.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
