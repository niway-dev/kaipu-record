---
title: "29 · Export canvas pool"
description: "Closes VID-A5: the export and GIF workers use CanvasSink without poolSize, so a new full-size canvas is allocated per decoded frame (~18,000 per 10 min of 30 fps 1080p), including frames the fps cap drops."
---

# Export canvas pool — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both export workers reuse two canvases instead of allocating one per decoded frame.

**Architecture:** A pure module `canvas-sink-options.ts` exports `EXPORT_CANVAS_POOL_SIZE = 2` and `exportCanvasSinkOptions(width, height)`; both workers build their `CanvasSink` from it. Verified in mediabunny 1.61.4: the pool is a per-sink ring buffer, canvases are created lazily, a reused canvas is cleared before drawing, and the canvas handed out by iteration N is only overwritten by iteration N+poolSize — safe because both consumers copy the pixels synchronously (`compose.clip` / `grab()`) before pulling the next frame. **Not** done: switching the MP4 worker to `canvasesAtTimestamps(cappedTimestamps)` — in 1.61.4 it still decodes every packet up to each target (it only skips the draw), changes frame selection vs the cap's nearest-slot rule, and bypasses `rebaseVideoTimestamp`'s straddle guard. A `VideoSampleSink`-based variant is noted as a measured follow-up.

**Tech Stack:** mediabunny 1.61.4 `CanvasSinkOptions.poolSize`, vitest (pure test; the workers themselves are untestable in jsdom).

**Spec:** [Audit report](/audits/2026-10-15/report/) → VID-A5 in [video lens A](/audits/2026-10-15/findings/video-a/). Closes: **VID-A5**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/renderer/src/features/video-editor/export/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- If a future change ever retains `wrapped.canvas` across iterations (lookahead, double buffering), raise the pool size first.
- On a mediabunny upgrade, re-check that canvas generation stays lazy (no prefetch).
- The wall-clock gain is unmeasured; the finding's numbers are allocation churn. Measure in the PR.
- `fit: "contain" as const` is required to satisfy `CanvasSinkOptions`.
- Commit messages in English, conventional-commit style.

## Review Focus

1. `exportCanvasSinkOptions(1920, 1080)` equals `{ width, height, fit: "contain", poolSize: 2 }` — Task 1 test.
2. `poolSize` is a positive integer (mediabunny throws on a negative/non-integer; 0 disables pooling) — Task 1 test.
3. Both worker sinks use the helper — Task 2 (reviewer greps `new CanvasSink(` in `export/`).
4. Output frames are identical before/after (first frame, a cut boundary, a slide boundary) — manual step.
5. The follow-up (skip dropped frames via `VideoSampleSink`) is recorded, not implemented — PR body.

---

### Task 1: `canvas-sink-options` module

**Files:**

- Create: `canvas-sink-options.ts`, `canvas-sink-options.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { EXPORT_CANVAS_POOL_SIZE, exportCanvasSinkOptions } from "./canvas-sink-options";

describe("exportCanvasSinkOptions", () => {
  it("pools the canvases", () => {
    const { poolSize } = exportCanvasSinkOptions(1920, 1080);
    expect(Number.isInteger(poolSize)).toBe(true);
    expect(poolSize).toBeGreaterThanOrEqual(1);
  });
  it("keeps the requested size and the letterbox fit", () => {
    expect(exportCanvasSinkOptions(1920, 1080)).toEqual({ width: 1920, height: 1080, fit: "contain", poolSize: EXPORT_CANVAS_POOL_SIZE });
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module missing.

- [ ] **Step 3: Implement**

```ts
/**
 * Canvases mediabunny's CanvasSink keeps in a ring buffer. Without a pool it allocates a new
 * full-size OffscreenCanvas for every decoded frame (~18,000 per 10 min of 30 fps 1080p).
 * Both workers consume each canvas synchronously (compose.clip / grab copy the pixels before
 * the next frame is pulled), so 2 is enough; the second slot is headroom.
 */
export const EXPORT_CANVAS_POOL_SIZE = 2;

export function exportCanvasSinkOptions(width: number, height: number) {
  return {
    width,
    height,
    // 'contain' letterboxes so the aspect ratio is never distorted.
    fit: "contain" as const,
    poolSize: EXPORT_CANVAS_POOL_SIZE,
  };
}
```

- [ ] **Step 4: Run and commit** — PASS.

```bash
git add src/renderer/src/features/video-editor/export/canvas-sink-options.ts src/renderer/src/features/video-editor/export/canvas-sink-options.test.ts
git commit -m "feat(desktop): shared pooled CanvasSink options for the export workers"
```

### Task 2: Both workers use the pool

**Files:**

- Modify: `export-worker.ts:292-297`, `gif-worker.ts:98-100`

- [ ] **Step 1: Implement**

`export-worker.ts` — `import { exportCanvasSinkOptions } from "./canvas-sink-options";` and

```ts
        const sink = new CanvasSink(videoTrack, exportCanvasSinkOptions(composeSize.width, composeSize.height));
```

`gif-worker.ts` — same import and

```ts
  const sink = track ? new CanvasSink(track, exportCanvasSinkOptions(source.width, source.height)) : null;
```

(Optional separate commit: hoist the MP4 sink above the `for (const segment …)` loop so one pool serves every clip segment; behaviour is identical since `canvases(start, end)` creates an independent decoder per call.)

- [ ] **Step 2: Type check and the export folder** — `bun run check-types && node_modules/.bin/vitest run src/renderer/src/features/video-editor/export` → green.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/features/video-editor/export/export-worker.ts src/renderer/src/features/video-editor/export/gif-worker.ts
git commit -m "perf(desktop): export and GIF workers reuse a 2-canvas pool per decoded frame"
```

### Task 3: Measure and ship

- [ ] **Measure**: export a 5-minute 60 fps recording with a 24 fps tier, before and after; compare wall time (realtime factor — plan 01's `export_completed` event if landed) and the worker's memory in Activity Monitor. Then export one MP4 with a zoom and a redaction and one GIF, and compare the first frame, a cut boundary and a slide boundary against a pre-change export: frames must be identical.
- [ ] Open a PR titled `perf(desktop): pooled canvases in the export workers (audit VID-A5)` linking this plan and the finding; include the measurements and the recorded follow-up (`VideoSampleSink` variant to avoid drawing capped frames, only if the measurement shows the dropped-frame draw is still hot). End with **How to test it yourself** = the measurement steps.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
