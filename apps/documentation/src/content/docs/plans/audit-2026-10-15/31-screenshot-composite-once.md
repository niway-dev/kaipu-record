---
title: "31 · Screenshot composite once"
description: "Closes SHOT-A1: auto copy and auto save composite the identical scene twice on every fresh capture (both on by default), and Copy then Save on an untouched scene do the same."
---

# Screenshot composite once — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two exports of the same scene, shot and display width share one composite (data URL, decodes, SVG, canvas, PNG encode).

**Architecture:** A single-entry promise memo inside `exportScene` (`features/screenshots/export/index.ts`), keyed on `(format, bytes identity, displayedW, sameScene)`. The scene is compared by its inner refs with the existing `sameScene`, **not** by wrapper identity: plan 05's `latest.current.scene` wrapper is rebuilt every render, while `use-editor-scene.ts` always spreads on edit so the inner refs are stable per edit and new per live drag. Storing the promise lets a concurrent second call join the in-flight composite; a rejected promise evicts itself. Copy and Save PNG bytes are identical and IPC `invoke` clones (never transfers), so sharing one buffer is safe. Compositor, exporters, `ExportInput` and the page call shape stay as they are.

**Tech Stack:** vitest (`export.test.ts` already mocks the compositor at the boundary).

**Spec:** [Audit report](/audits/2026-10-15/report/) → SHOT-A1 in [screenshot lens A](/audits/2026-10-15/findings/screenshot-a/). Closes: **SHOT-A1**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/renderer/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- The invariant the memo relies on: a Scene part is never mutated in place (`use-editor-scene.ts` spreads everywhere). Keep it.
- The shared buffer must never be transferred or mutated by a consumer (state in the JSDoc).
- The entry pins one composite PNG at module level until the next export; add `clearExportCache()` on editor unmount to release it.
- Independent of plan 05 (which only changes how the page calls `exportScene`) and of plan 01's `timed()` wrapper around it.
- Commit messages in English, conventional-commit style.

## Review Focus

1. Same scene through a rebuilt wrapper (`{ ...scene }`) → one compositor call — Task 1 test.
2. Any changed part (annotations / beautify / crop), a different `displayedW` or new `bytes` → recomposite — Task 1 tests.
3. PNG and PDF never share a result — Task 1 test.
4. A failed composite is not cached (Retry recomputes) — Task 1 test.
5. Two concurrent identical calls → one compositor call — Task 1 test.

---

### Task 1: Memo in `exportScene`

**Files:**

- Modify: `features/screenshots/export/index.ts:18-21`
- Test: `features/screenshots/export/export.test.ts`

**Interfaces:**

- Produces: `clearExportCache(): void`.

- [ ] **Step 1: Write the failing tests** (the suite mocks `compositeSceneAt`, imports `./index` dynamically — add `clearExportCache` to that import — and has `tinyPng()`; `afterEach(() => { compositeSceneAt.mockReset(); clearExportCache(); })`)

```ts
describe("export memo", () => {
  it("composites once for the same scene, shot and width, even through a rebuilt scene wrapper", async () => {
    const png = await tinyPng();
    compositeSceneAt.mockResolvedValue({ png, width: 2, height: 2, scale: 1 });
    const a = await exportScene("png", { scene, bytes: png, displayedW: 2 });
    const b = await exportScene("png", { scene: { ...scene }, bytes: png, displayedW: 2 });
    expect(compositeSceneAt).toHaveBeenCalledTimes(1);
    expect(a).toBe(png);
    expect(b).toBe(png);
  });

  it.each([
    ["annotations", (s: Scene) => ({ ...s, annotations: [...s.annotations] })],
    ["beautify", (s: Scene) => ({ ...s, beautify: { ...s.beautify } })],
    ["crop", (s: Scene) => ({ ...s, crop: { x: 0, y: 0, w: 1, h: 1 } })],
  ])("recomposites when %s changes", async (_name, change) => {
    const png = await tinyPng();
    compositeSceneAt.mockResolvedValue({ png, width: 2, height: 2, scale: 1 });
    await exportScene("png", { scene, bytes: png, displayedW: 2 });
    await exportScene("png", { scene: change(scene), bytes: png, displayedW: 2 });
    expect(compositeSceneAt).toHaveBeenCalledTimes(2);
  });

  it("recomposites when displayedW or the shot bytes change", async () => {
    const png = await tinyPng();
    compositeSceneAt.mockResolvedValue({ png, width: 2, height: 2, scale: 1 });
    await exportScene("png", { scene, bytes: png, displayedW: 2 });
    await exportScene("png", { scene, bytes: png, displayedW: 3 });
    await exportScene("png", { scene, bytes: await tinyPng(), displayedW: 3 });
    expect(compositeSceneAt).toHaveBeenCalledTimes(3);
  });

  it("does not share a result across formats", async () => {
    const png = await tinyPng();
    compositeSceneAt.mockResolvedValue({ png, width: 2, height: 2, scale: 1 });
    await exportScene("png", { scene, bytes: png, displayedW: 2 });
    await exportScene("pdf", { scene, bytes: png, displayedW: 2 });
    expect(compositeSceneAt).toHaveBeenCalledTimes(2);
    expect(compositeSceneAt).toHaveBeenLastCalledWith(scene, png, 2, { rasterScale: PDF_RASTER_SCALE });
  });

  it("a failed composite is not cached", async () => {
    const png = await tinyPng();
    compositeSceneAt.mockRejectedValueOnce(new Error("boom"));
    await expect(exportScene("png", { scene, bytes: png, displayedW: 2 })).rejects.toThrow("boom");
    await Promise.resolve();
    compositeSceneAt.mockResolvedValue({ png, width: 2, height: 2, scale: 1 });
    await expect(exportScene("png", { scene, bytes: png, displayedW: 2 })).resolves.toBe(png);
    expect(compositeSceneAt).toHaveBeenCalledTimes(2);
  });

  it("concurrent calls share the in-flight composite", async () => {
    const png = await tinyPng();
    compositeSceneAt.mockResolvedValue({ png, width: 2, height: 2, scale: 1 });
    await Promise.all([
      exportScene("png", { scene, bytes: png, displayedW: 2 }),
      exportScene("png", { scene, bytes: png, displayedW: 2 }),
    ]);
    expect(compositeSceneAt).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/renderer/src/features/screenshots/export/export.test.ts` → the first and last FAIL (two compositor calls); `clearExportCache` missing.

- [ ] **Step 3: Implement** — in `index.ts` add `import { sameScene } from "../annotations/scene";` and replace the `exportScene` block:

```ts
interface CachedExport {
  format: ExportFormat;
  input: ExportInput;
  result: Promise<ArrayBuffer>;
}

/**
 * The last export. Auto copy then auto save (and Copy then Save on an untouched
 * scene) ask for byte-identical output, and compositing is the expensive part (data
 * URL, two decodes, SVG, canvas, PNG encode). One entry bounds memory, and any edit
 * makes the old entry unreachable anyway. The scene is compared by its inner refs
 * (`sameScene`), not by wrapper identity, because callers rebuild the wrapper on
 * every render. `bytes` is compared by identity: `useImageSource` hands out the same
 * buffer for the whole session.
 */
let lastExport: CachedExport | null = null;

/** Forget the memoized export (tests, and editor unmount). */
export function clearExportCache(): void {
  lastExport = null;
}

function sameInput(a: ExportInput, b: ExportInput): boolean {
  return a.bytes === b.bytes && a.displayedW === b.displayedW && sameScene(a.scene, b.scene);
}

/**
 * Composite the scene and encode it as `format`. Repeat calls with an unchanged
 * scene, shot and display width share one result (see `lastExport`). The buffer is
 * shared: callers must not mutate or transfer it (IPC `invoke` clones).
 */
export function exportScene(format: ExportFormat, input: ExportInput): Promise<ArrayBuffer> {
  if (lastExport && lastExport.format === format && sameInput(lastExport.input, input)) {
    return lastExport.result;
  }
  const entry: CachedExport = { format, input, result: exporterFor(format).export(input) };
  lastExport = entry;
  // A failed composite must not poison the next attempt (toast Retry).
  entry.result.catch(() => {
    if (lastExport === entry) lastExport = null;
  });
  return entry.result;
}
```

- [ ] **Step 4: Run and commit** — PASS, existing tests unchanged.

```bash
git add src/renderer/src/features/screenshots/export/index.ts src/renderer/src/features/screenshots/export/export.test.ts
git commit -m "perf(desktop): export the same screenshot scene once for copy and save"
```

### Task 2: Release the cache when the editor closes

**Files:**

- Modify: `pages/screenshot-editor/screenshot-editor-page.tsx` (inside `ScreenshotEditor`)

- [ ] **Step 1: Implement** — `useEffect(() => clearExportCache, []);` (import `clearExportCache` from `@renderer/features/screenshots/export`). Optionally reword the `runAutoActions` comment: the second export is served by `exportScene`'s memo.

- [ ] **Step 2: Run and commit** — `node_modules/.bin/vitest run src/renderer/src/pages/screenshot-editor src/renderer/src/features/screenshots && bun run check-types` → PASS.

```bash
git add src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx
git commit -m "chore(desktop): drop the memoized export when the screenshot editor unmounts"
```

### Task 3: Ship

- [ ] Open a PR titled `perf(desktop): composite a screenshot once per scene state (audit SHOT-A1)` linking this plan and the finding. End with **How to test it yourself**:
  1. With `screenshotSave` and `screenshotCopy` both "auto", temporarily `console.count("composite")` in `compositeSceneAt`; take a hotkey capture → the count is 1 before "Saved & copied" (was 2).
  2. Annotate, click Copy then Save → 1 composite total. Edit between them → 2.
  3. Export PDF after a Save → a new composite (3× raster), as expected.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
