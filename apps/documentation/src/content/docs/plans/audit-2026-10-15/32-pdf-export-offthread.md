---
title: "32 · PDF export off the main thread"
description: "Closes SHOT-A2: PDF export rasters at 3× and then runs pdf-lib's pure-JS PNG decode, alpha split and deflate on the renderer main thread — 0.6 to 2.1 s frozen on a 5K shot."
---

# PDF export off the main thread — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exporting a PDF never freezes the editor: pdf-lib's work runs in a worker; the main thread keeps only the SVG draw and the async `toBlob`.

**Architecture:** Only the pdf-lib step moves: `build-pdf.ts` (pure, no DOM), `pdf-messages.ts`, `pdf-worker.ts` (module worker, same `new Worker(new URL(…), { type: "module" })` pattern as the GIF/export workers), and `pdf-exporter.ts` gains `buildPdfOffThread(png, w, h)` that transfers the PNG buffer in and the PDF buffer out, terminates the one-shot worker, and falls back to running `buildPdf` inline when `Worker` is undefined (jsdom — existing tests pass unchanged). The raster cannot move: it needs `new Image()` + a DOM canvas, and `createImageBitmap(svgBlob)` does not support SVG in Chromium. JPEG was evaluated and rejected for this unit: the "None" background and rounded corners are transparent and would turn black, and 4:2:0 subsampling fringes thin strokes. Measured in node (pdf-lib 1.17.1, synthetic 5400×3600): 0.6 s (clean) to 2.1 s (noisy) of synchronous JS today; after, ~0 ms on the main thread (total latency unchanged — the work moves, it does not shrink).

**Tech Stack:** Web Worker + transferable `ArrayBuffer`s, pdf-lib, vitest (`FakeWorker` as in `use-gif-export.test.ts`).

**Spec:** [Audit report](/audits/2026-10-15/report/) → SHOT-A2 in [screenshot lens A](/audits/2026-10-15/findings/screenshot-a/). Closes: **SHOT-A2**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/renderer/src/features/screenshots/export/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- `export.test.ts:16` imports `buildPdf` from `./pdf-exporter`; it must move to `./build-pdf`. Nothing else in that file changes (the pdf tests go through the inline fallback).
- The PNG buffer is **detached** after the transfer; callers must not reuse `frame.png` (they do not today — state it in the JSDoc).
- No CSP change: the renderer CSP has no `worker-src`, so workers fall back to `default-src 'self'`, exactly like the two existing workers.
- Verify in the packaged build that a `pdf-worker-*.js` chunk exists and pdf-lib left the main renderer chunk.
- No progress UI (still none; the save dialog appears when the worker replies). Out of scope.
- Commit messages in English, conventional-commit style.

## Review Focus

1. `buildPdfOffThread` posts `{ png, width, height }` with `[png]` as the transfer list and resolves with the worker's `pdf` — Task 2 test.
2. The worker is terminated exactly once after it answers — Task 2 test.
3. An `error` reply and a worker `onerror` both reject and terminate — Task 2 tests.
4. The inline fallback produces the same single-page PDF (existing `export.test.ts` pdf tests, now via `./build-pdf`) — Task 1.
5. A "None" background is still transparent in the saved PDF — manual step (the JPEG shortcut is rejected for this reason).

---

### Task 1: Pure `build-pdf` module and message types

**Files:**

- Create: `build-pdf.ts`, `pdf-messages.ts`
- Modify: `export.test.ts:16`

- [ ] **Step 1: Create the files**

```ts
// build-pdf.ts
import { PDFDocument } from "pdf-lib";

/**
 * One page, no margins, sized to the composed frame. The PNG is embedded as-is
 * (pdf-lib keeps its alpha, so a "None" background stays transparent) and drawn
 * to fill the page, which puts the extra resolution to work as zoom headroom.
 * WORKER-BUNDLE INVARIANT: no DOM, no React — this runs inside pdf-worker.ts.
 */
export async function buildPdf(png: ArrayBuffer, width: number, height: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png);
  const page = doc.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });
  const out = await doc.save();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}
```

```ts
// pdf-messages.ts
/** Main -> worker. `png` is transferred. */
export interface PdfRequest {
  png: ArrayBuffer;
  width: number;
  height: number;
}

/** Worker -> main. `pdf` is transferred. */
export type PdfResponse = { type: "done"; pdf: ArrayBuffer } | { type: "error"; message: string };
```

`export.test.ts:16` → `const { buildPdf } = await import("./build-pdf");`.

- [ ] **Step 2: Run the existing suite** — `node_modules/.bin/vitest run src/renderer/src/features/screenshots/export/export.test.ts` → PASS (after Task 2 removes `buildPdf` from `pdf-exporter.ts`; until then both exports exist).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/features/screenshots/export/build-pdf.ts src/renderer/src/features/screenshots/export/pdf-messages.ts src/renderer/src/features/screenshots/export/export.test.ts
git commit -m "refactor(desktop): pdf-lib page build in a DOM-free module"
```

### Task 2: Worker and `buildPdfOffThread`

**Files:**

- Create: `pdf-worker.ts`, `pdf-offthread.test.ts`
- Modify: `pdf-exporter.ts` (whole file)

**Interfaces:**

- Produces: `buildPdfOffThread(png: ArrayBuffer, width: number, height: number): Promise<ArrayBuffer>`; `PDF_RASTER_SCALE` unchanged.

- [ ] **Step 1: Write the failing tests** (`FakeWorker` with `onmessage`, `onerror`, `postMessage = vi.fn()`, `terminate = vi.fn()`, `emit(data)`, pushed into a module `createdWorkers`; `vi.stubGlobal("Worker", FakeWorker)` in `beforeEach`, `vi.unstubAllGlobals()` in `afterEach`)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPdfOffThread } from "./pdf-exporter";

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { createdWorkers.push(this); }
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
let createdWorkers: FakeWorker[] = [];
beforeEach(() => { createdWorkers = []; vi.stubGlobal("Worker", FakeWorker); });
afterEach(() => vi.unstubAllGlobals());

describe("buildPdfOffThread", () => {
  it("posts the png to the worker as a transferable and resolves with the transferred pdf", async () => {
    const png = new ArrayBuffer(8);
    const pending = buildPdfOffThread(png, 300, 150);
    const [worker] = createdWorkers;
    expect(worker!.postMessage).toHaveBeenCalledWith({ png, width: 300, height: 150 }, [png]);
    const pdf = new ArrayBuffer(4);
    worker!.emit({ type: "done", pdf });
    expect(await pending).toBe(pdf);
  });
  it("terminates the worker once it has answered", async () => {
    const pending = buildPdfOffThread(new ArrayBuffer(8), 1, 1);
    createdWorkers[0]!.emit({ type: "done", pdf: new ArrayBuffer(1) });
    await pending;
    expect(createdWorkers[0]!.terminate).toHaveBeenCalledTimes(1);
  });
  it("rejects with the worker's message and terminates on an error reply", async () => {
    const pending = buildPdfOffThread(new ArrayBuffer(8), 1, 1);
    createdWorkers[0]!.emit({ type: "error", message: "boom" });
    await expect(pending).rejects.toThrow("boom");
    expect(createdWorkers[0]!.terminate).toHaveBeenCalledTimes(1);
  });
  it("rejects and terminates when the worker itself errors", async () => {
    const pending = buildPdfOffThread(new ArrayBuffer(8), 1, 1);
    createdWorkers[0]!.onerror?.({ message: "load failed" } as ErrorEvent);
    await expect(pending).rejects.toThrow("load failed");
    expect(createdWorkers[0]!.terminate).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `buildPdfOffThread` is not exported.

- [ ] **Step 3: Implement**

```ts
// pdf-worker.ts
/**
 * PDF worker — pdf-lib's PNG decode, alpha split and deflate are synchronous JS
 * that froze the renderer for seconds on a 5K shot (SHOT-A2). No DOM here.
 */
import { buildPdf } from "./build-pdf";
import type { PdfRequest, PdfResponse } from "./pdf-messages";

type WorkerSelf = typeof self & {
  onmessage: ((event: MessageEvent<PdfRequest>) => void) | null;
  postMessage(message: PdfResponse, transfer?: Transferable[]): void;
};

const workerSelf = self as unknown as WorkerSelf;

workerSelf.onmessage = (event) => {
  const { png, width, height } = event.data;
  buildPdf(png, width, height).then(
    (pdf) => workerSelf.postMessage({ type: "done", pdf }, [pdf]),
    (error: unknown) =>
      workerSelf.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }),
  );
};
```

`pdf-exporter.ts` (keep the `PDF_RASTER_SCALE` doc comment verbatim; no pdf-lib import):

```ts
import { compositeSceneAt } from "../annotations/compositor";
import type { PdfRequest, PdfResponse } from "./pdf-messages";
import type { Exporter } from "./types";

/** (PDF_RASTER_SCALE doc comment unchanged) */
export const PDF_RASTER_SCALE = 3;

function newPdfWorker(): Worker {
  return new Worker(new URL("./pdf-worker.ts", import.meta.url), { type: "module" });
}

/**
 * Build the PDF off the main thread. `png` is transferred, so it is unusable by
 * the caller afterwards. Without `Worker` (jsdom) it runs inline: same output.
 */
export async function buildPdfOffThread(png: ArrayBuffer, width: number, height: number): Promise<ArrayBuffer> {
  if (typeof Worker === "undefined") {
    const { buildPdf } = await import("./build-pdf");
    return buildPdf(png, width, height);
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const worker = newPdfWorker();
    worker.onmessage = (event: MessageEvent<PdfResponse>) => {
      worker.terminate();
      if (event.data.type === "done") resolve(event.data.pdf);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "pdf worker failed"));
    };
    const request: PdfRequest = { png, width, height };
    worker.postMessage(request, [png]);
  });
}

export const pdfExporter: Exporter = {
  format: "pdf",
  mimeType: "application/pdf",
  extension: "pdf",
  async export({ scene, bytes, displayedW }) {
    const frame = await compositeSceneAt(scene, bytes, displayedW, { rasterScale: PDF_RASTER_SCALE });
    return buildPdfOffThread(frame.png, frame.width, frame.height);
  },
};
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/screenshots && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/screenshots/export/pdf-worker.ts src/renderer/src/features/screenshots/export/pdf-exporter.ts src/renderer/src/features/screenshots/export/pdf-offthread.test.ts
git commit -m "perf(desktop): build screenshot PDFs in a worker so the editor stays responsive"
```

### Task 3: Ship

- [ ] Build the renderer and confirm a separate `pdf-worker-*.js` chunk exists and pdf-lib is no longer in the main renderer chunk.
- [ ] Open a PR titled `perf(desktop): PDF export off the main thread (audit SHOT-A2)` linking this plan and the finding; include the node measurements and the rejected JPEG alternative (follow-up: JPEG only when `bg !== "none"` with a white fill, if ever wanted). End with **How to test it yourself**:
  1. Open a large capture (1600×1000+ region or a Retina full screen), pick a background with padding, click Export PDF → while it works, zoom/scroll/hover keep responding (before: a 0.6–2 s freeze). The PDF has one page, is sharp at 300 %, and a "None" background is still transparent.
  2. DevTools Performance: no long `UPNG`/`pako` task on the main thread during the export.
  3. Temporarily throw inside `pdf-worker.ts` → the existing PDF export error toast appears and Export is usable again.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
