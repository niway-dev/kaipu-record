---
title: "Video editor v2 — 11 export pass"
description: "Burning zoom, privacy regions and content-pinned annotations into the export: the corrected facts about the current worker, a per-frame plan with a zero-cost direct path, source-resolution composition before the camera crop, transferring copies of the camera path, the canvas-filter probe, and the verification checklist. Verified code and diffs. Fixes audit W15 (export)."
sidebar:
  order: 11
---

# 11 — Export pass

> **Status: 🔵 Proposed** (2026-09-21). PR 9 ("Export pass") in the
> [audit](/plans/video-editor-v2/00-audit/). Requires PR 8 and PR 1. Fixes the export
> half of W15; the capture-resolution half is [12](/plans/video-editor-v2/12-capture-resolution-and-cursor-sprite/).

## Corrected facts

The overview says the worker "decodes with `CanvasSink` at output size" and that
"decoding at source res instead of output res costs memory". In the code:

- The output size **is** the source size: `use-video-export.ts` sends
  `output: { width: videoWidth, height: videoHeight }` (the preview `<video>`'s native
  size), and `CanvasSink` is created with that size and `fit: "contain"`. Decoded frames are
  already source resolution; nothing changes there.
- There is no export resolution option. A zoomed frame is therefore a crop **scaled up**
  to the source size — see doc 12 for what that means for quality.
- Overlays are pre-rasterized full-frame bitmaps at source size, stamped with
  `drawImage(bitmap, 0, 0, W, H)` in **timeline** time. Stamping them onto the pre-crop
  canvas makes them content-pinned for free.
- Audio is a separate pass keyed only on the plan's segments; v2 does not touch it, so A/V
  sync (`rebaseVideoTimestamp`, `trimAudioSample`) is unchanged by construction.

## Decisions

Per clip frame (`planClipFrame`, pure):

```
direct     no zoom at this frame AND no region overlapping it
           → exactly the pre-v2 path (drawImage frame, stamp overlays)
composite  otherwise:
           work (source-res OffscreenCanvas, created lazily once)
             ← frame
             ← applyRedactions (sampling WORK itself, not the decoded frame)
             ← overlays whose timeline window covers outTs
           output ← work, cropped to the camera window (or whole) with imageSmoothingQuality "high"
```

- Camera: `cameraAt(path, frame.timestamp)` — the frame's **source** timestamp — on the
  same `CameraPath` the preview uses. The renderer sends **copies** of the three
  `Float32Array`s (transferring the originals would detach the live preview's buffers).
  Sent whenever the scene has **any** zoom segment (`plan.hasZoom`), including one that
  lies entirely in deleted footage: the camera has 0.2 s of lookahead and eases out past a
  segment's `end`, so a zoom buried in a cut still moves the camera over the kept frames on
  either side of it — the preview shows that, and the export must agree. Filtering by
  visibility here would ship `camera: null` for a timeline the preview renders zoomed.
- Regions: `plan.redactions` = regions visible on the timeline; per frame
  `redactionsForFrame(ts, ts + duration)` (interval overlap, doc 10).
- Regions sample the **work canvas**, not the decoded frame. Redactions may overlap
  (doc 06): sampling the original would let a blur drawn over an earlier cover paint
  blurred _original_ pixels back on top of it and re-reveal the secret. Self-`drawImage`
  is legal in Canvas2D, so `applyRedactions` is handed `work` as its source.
- Cover labels, accepted deviation from the preview: the export renders them in the
  platform sans-serif at weight 600 (`600 ${coverLabelPx(height)}px sans-serif`) and a long
  label **condenses** to fit the block, where the preview uses the app font at the semibold
  token and **ellipses**. The inset is resolution-relative (`coverLabelPx(height) * 0.8` ≈
  the preview's 4 px padding at the 382 px reference height), so it neither vanishes at 4K
  nor eats a small block. The block geometry, fill and label colour are identical.
- Slides: unchanged (no camera, no regions); overlays stamped on the output as today.
- Canvas filter probe (`canvasFilterSupported`) runs once per export; `false` → gaussian
  regions use the mosaic (fail closed).
- Worker bundle invariant: **nothing reachable from `compose-frame.ts` may touch the DOM or
  React.** It pulls in `../zoom/camera-path` (→ `@shared/cursor-track`) and
  `../privacy/redaction`; both are pure, DOM-free modules, and both aliases already resolve
  in the worker bundle (`electron.vite.config.ts`). A DOM import would only fail at runtime
  inside the worker, so keep the module's import list to pure code.
- Poster (PR 1) is taken after composition, so it shows zoom and regions too. Accepted
  consequence: if the first output frame is fully covered, the library card of the export is
  a solid block. That is the correct fail-closed outcome — the alternative is a thumbnail
  that shows what the user redacted — and the user can cut to a different opening frame.
- Progress, cancellation, errors: unchanged.

## Files

| Action | Path (under `apps/kaipu-record/src/renderer/src/features/video-editor/`) |
| ------ | ------------------------------------------------------------------------ |
| Create | `export/compose-frame.ts` + `.test.ts`                                   |
| Modify | `export/export-plan.ts` + `.test.ts`                                     |
| Modify | `export/export-messages.ts`, `export/export-worker.ts`                   |
| Modify | `export/use-video-export.ts` + `.test.ts`                                |
| Modify | `components/export-dialog.tsx`                                           |
| Modify | `pages/video-editor/video-editor-page.tsx` (`src/renderer/src/pages/…`)  |

Outside that root, this PR also touches the message catalogues:

| Action | Path                             |
| ------ | -------------------------------- |
| Modify | `packages/i18n/messages/es.json` |
| Modify | `packages/i18n/messages/en.json` |

i18n (dialog note):

| Key                  | es                                                                           | en                                                                      |
| -------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `exportOriginalNote` | La grabación original y su miniatura en la biblioteca siguen mostrando todo. | The original recording and its library thumbnail still show everything. |

Paste into `packages/i18n/messages/es.json` → `"videoEditor"` (without the outer braces):

```json
{
  "exportOriginalNote": "La grabación original y su miniatura en la biblioteca siguen mostrando todo."
}
```

and into `packages/i18n/messages/en.json` → `"videoEditor"`:

```json
{
  "exportOriginalNote": "The original recording and its library thumbnail still show everything."
}
```

## Tasks

### Task 1 — frame composition (pure, unit-tested with a recording fake context)

**`apps/kaipu-record/src/renderer/src/features/video-editor/export/compose-frame.ts`**

```ts
/**
 * Per-frame composition for the export worker (plans/video-editor-v2/11), split out of
 * export-worker.ts so it is unit-testable with a fake 2D context. Order, identical to the
 * preview's DOM layering (doc 09):
 *
 *   decoded source frame → privacy regions → content-pinned overlays → camera crop
 *
 * Everything before the crop happens at SOURCE resolution on a scratch canvas, so a
 * redaction always covers the same pixels whatever the zoom does afterwards.
 *
 * WORKER-BUNDLE INVARIANT: nothing reachable from this module may touch the DOM or React.
 * It reaches ../zoom/camera-path (→ `@shared/cursor-track`) and ../privacy/redaction; both
 * are pure and DOM-free, and both aliases are declared for the worker bundle in
 * `electron.vite.config.ts`. Importing anything DOM-bound here fails at runtime inside the
 * worker, not at build time.
 */
import { type CameraPath, cameraAt, cropRect, isIdentity } from "../zoom/camera-path";
import {
  blurSigmaPx,
  coverLabelColor,
  coverLabelPx,
  pixelBlockPx,
  rectToPx,
  type Redaction,
  redactionsForFrame,
} from "../privacy/redaction";

/** The subset of CanvasRenderingContext2D / OffscreenCanvasRenderingContext2D used here. */
export interface Ctx2D {
  filter: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/** A resizable canvas for the mosaic downscale (an OffscreenCanvas in the worker). */
export interface ScratchCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): Ctx2D | null;
}

export interface CropPx {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface ClipFramePlan {
  /** "direct": no zoom and no region → draw the frame as-is (today's path, zero cost). */
  mode: "direct" | "composite";
  /** Source-pixel window to scale onto the output; null = whole frame. */
  crop: CropPx | null;
  redactions: Redaction[];
}

export function cropRectPx(
  camera: { cx: number; cy: number; scale: number },
  width: number,
  height: number,
): CropPx {
  const r = cropRect(camera);
  // The simulation already clamps the window inside the frame, but the path is stored as
  // Float32: a rounded edge can land a fraction of a pixel outside, and drawImage with an
  // out-of-bounds source rect samples transparent black (a black hairline on the export).
  const sx = Math.max(0, r.x * width);
  const sy = Math.max(0, r.y * height);
  return {
    sx,
    sy,
    sw: Math.min(width - sx, r.w * width),
    sh: Math.min(height - sy, r.h * height),
  };
}

/**
 * What to do with one decoded clip frame on screen during source
 * [frameStart, frameStart + frameDuration).
 */
export function planClipFrame(
  camera: CameraPath | null,
  redactions: Redaction[],
  frameStart: number,
  frameDuration: number,
  width: number,
  height: number,
): ClipFramePlan {
  const active = redactionsForFrame(redactions, frameStart, frameStart + frameDuration);
  const cam = camera ? cameraAt(camera, frameStart) : null;
  const crop = cam && !isIdentity(cam) ? cropRectPx(cam, width, height) : null;
  return { mode: crop || active.length > 0 ? "composite" : "direct", crop, redactions: active };
}

/**
 * Burn `redactions` into `ctx` at source resolution. `source` is the canvas `ctx` itself
 * draws on (self-drawImage is legal in Canvas2D): every region samples the pixels COMPOSED
 * SO FAR, not the decoded original, so a blur stacked on an earlier cover re-blurs the
 * cover instead of re-revealing what it hid. Regions may overlap (doc 06). A blur on a
 * platform without canvas filters falls back to the mosaic — never to an unredacted region.
 */
export function applyRedactions(
  ctx: Ctx2D,
  source: CanvasImageSource,
  redactions: Redaction[],
  width: number,
  height: number,
  scratch: ScratchCanvas,
  canvasFilterSupported: boolean,
): void {
  for (const r of redactions) {
    const px = rectToPx(r.rect, width, height);
    if (px.w === 0 || px.h === 0) continue;

    if (r.kind === "cover") {
      ctx.fillStyle = r.fill;
      ctx.fillRect(px.x, px.y, px.w, px.h);
      if (r.label) {
        ctx.fillStyle = coverLabelColor(r.fill);
        ctx.font = `600 ${coverLabelPx(height)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Inset relative to the label size (≈ the preview's 4 px padding at the 382 px
        // reference height), so it holds at any resolution instead of vanishing at 4K.
        const maxWidth = Math.max(1, px.w - coverLabelPx(height) * 0.8);
        ctx.fillText(r.label, px.x + px.w / 2, px.y + px.h / 2, maxWidth);
      }
      continue;
    }

    if (r.style === "gaussian" && canvasFilterSupported) {
      const sigma = blurSigmaPx(r.intensity, height);
      // Sample a margin around the region so the blur doesn't fade to transparent at
      // its edge; the clip keeps the result inside the region.
      const m = Math.ceil(sigma * 3);
      const x0 = Math.max(0, px.x - m);
      const y0 = Math.max(0, px.y - m);
      const x1 = Math.min(width, px.x + px.w + m);
      const y1 = Math.min(height, px.y + px.h + m);
      ctx.save();
      ctx.beginPath();
      ctx.rect(px.x, px.y, px.w, px.h);
      ctx.clip();
      // FAIL CLOSED against the frame borders. The 3σ margin is clamped at the frame edge,
      // so for a region flush against a border the filtered draw's own alpha fade lands
      // INSIDE the clip — drawn source-over onto a canvas that already holds the unblurred
      // frame, the original would show through in that band. Painting the region opaque
      // first means whatever the fade lets through blends against a solid block.
      ctx.filter = "none";
      ctx.fillStyle = "#18181b";
      ctx.fillRect(px.x, px.y, px.w, px.h);
      ctx.filter = `blur(${sigma}px)`;
      ctx.drawImage(source, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
      continue;
    }

    // Pixelate (or gaussian fallback): average down into cells, scale back up unsmoothed.
    const cell = pixelBlockPx(r.intensity, height);
    const cols = Math.max(1, Math.ceil(px.w / cell));
    const rows = Math.max(1, Math.ceil(px.h / cell));
    scratch.width = cols;
    scratch.height = rows;
    const sctx = scratch.getContext("2d");
    if (!sctx) {
      // No scratch context: fail CLOSED with a solid block rather than leak the region.
      ctx.fillStyle = "#18181b";
      ctx.fillRect(px.x, px.y, px.w, px.h);
      continue;
    }
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(source, px.x, px.y, px.w, px.h, 0, 0, cols, rows);
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      scratch as unknown as CanvasImageSource,
      0,
      0,
      cols,
      rows,
      px.x,
      px.y,
      px.w,
      px.h,
    );
    ctx.imageSmoothingEnabled = smoothing;
  }
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/export/compose-frame.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildCameraPath } from "../zoom/camera-path";
import type { ZoomSegment } from "../zoom/zoom-model";
import { coverLabelPx, type Redaction } from "../privacy/redaction";
import {
  applyRedactions,
  type Ctx2D,
  cropRectPx,
  planClipFrame,
  type ScratchCanvas,
} from "./compose-frame";

/** Records every call and property write, in order. */
function fakeCtx(): { ctx: Ctx2D; log: unknown[][] } {
  const log: unknown[][] = [];
  const state: Record<string, unknown> = { imageSmoothingEnabled: true };
  const ctx = new Proxy({} as Ctx2D, {
    get: (_t, key: string) =>
      key in state ? state[key] : (...args: unknown[]) => void log.push([key, ...args]),
    set: (_t, key: string, value) => {
      state[key] = value;
      log.push([`=${key}`, value]);
      return true;
    },
  });
  return { ctx, log };
}

function scratch(withContext = true): { canvas: ScratchCanvas; log: unknown[][] } {
  const { ctx, log } = fakeCtx();
  return { canvas: { width: 0, height: 0, getContext: () => (withContext ? ctx : null) }, log };
}

/** Stands in for the WORK canvas: regions sample the pixels composed so far, not the decoded frame. */
const WORK = {} as CanvasImageSource;
const W = 1000;
const H = 500;

const blur = (partial: Partial<Redaction> = {}): Redaction =>
  ({
    id: "b",
    kind: "blur",
    start: 1,
    end: 3,
    rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
    intensity: 100,
    style: "gaussian",
    ...partial,
  }) as Redaction;

const ZOOM: ZoomSegment = {
  id: "z",
  start: 0,
  end: 10,
  scale: 2,
  mode: "fixed",
  anchor: { x: 0.25, y: 0.25 },
  smoothing: 0,
  origin: "manual",
  trigger: null,
};

describe("cropRectPx", () => {
  it("converts the camera window to source pixels", () => {
    expect(cropRectPx({ cx: 0.25, cy: 0.25, scale: 2 }, W, H)).toEqual({
      sx: 0,
      sy: 0,
      sw: 500,
      sh: 250,
    });
  });
  it("clamps a window that Float32 rounding pushed outside the frame", () => {
    const out = cropRectPx({ cx: 0.2499, cy: 0.2499, scale: 2 }, W, H);
    expect(out.sx).toBe(0);
    expect(out.sy).toBe(0);
    expect(out.sx + out.sw).toBeLessThanOrEqual(W);
    expect(out.sy + out.sh).toBeLessThanOrEqual(H);
  });
});

describe("planClipFrame", () => {
  it("takes the direct path with no zoom and no region", () => {
    expect(planClipFrame(null, [], 1, 1 / 30, W, H)).toEqual({
      mode: "direct",
      crop: null,
      redactions: [],
    });
  });
  it("composites when a region overlaps the frame interval (edge frames included)", () => {
    const plan = planClipFrame(null, [blur({ start: 1.02 })], 1, 1 / 30, W, H);
    expect(plan.mode).toBe("composite");
    expect(plan.redactions).toHaveLength(1);
  });
  it("crops when the camera is zoomed at the frame's source time", () => {
    const path = buildCameraPath([ZOOM], null, 10);
    const plan = planClipFrame(path, [], 5, 1 / 30, W, H);
    expect(plan.mode).toBe("composite");
    expect(plan.crop!.sw).toBeCloseTo(500, 0);
  });
});

describe("applyRedactions", () => {
  it("cover: solid fill then a centered label inset by a share of the label size", () => {
    const { ctx, log } = fakeCtx();
    const cover: Redaction = {
      id: "c",
      kind: "cover",
      start: 0,
      end: 1,
      rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
      fill: "#F6055C",
      label: "API key",
    };
    applyRedactions(ctx, WORK, [cover], W, H, scratch().canvas, true);
    expect(log[0]).toEqual(["=fillStyle", "#F6055C"]);
    expect(log[1]).toEqual(["fillRect", 0, 0, 500, 250]);
    const label = log.at(-1)!;
    expect(label.slice(0, 4)).toEqual(["fillText", "API key", 250, 125]);
    expect(label[4] as number).toBeCloseTo(500 - coverLabelPx(H) * 0.8, 9);
  });

  it("gaussian: clipped, filtered redraw from the composed canvas with a 3σ margin", () => {
    const { ctx, log } = fakeCtx();
    applyRedactions(ctx, WORK, [blur()], W, H, scratch().canvas, true);
    const filter = log.find((e) => e[0] === "=filter" && String(e[1]).startsWith("blur("));
    expect(filter![1]).toMatch(/^blur\(14\.3\d*px\)$/); // 11/382 × 500
    const draw = log.find((e) => e[0] === "drawImage")!;
    expect(draw.slice(0, 2)).toEqual(["drawImage", WORK]);
    expect(log.map((e) => e[0])).toEqual(
      expect.arrayContaining(["save", "beginPath", "rect", "clip", "restore"]),
    );
  });

  it("gaussian: fills the clip opaque BEFORE the filtered draw (no fade onto the original)", () => {
    const { ctx, log } = fakeCtx();
    applyRedactions(ctx, WORK, [blur()], W, H, scratch().canvas, true);
    const keys = log.map((e) => e[0]);
    const clip = keys.indexOf("clip");
    const fill = keys.indexOf("fillRect");
    const blurSet = log.findIndex((e) => e[0] === "=filter" && String(e[1]).startsWith("blur("));
    const draw = keys.indexOf("drawImage");
    expect(log[fill]).toEqual(["fillRect", 100, 100, 300, 100]); // the region itself
    expect(clip).toBeLessThan(fill);
    expect(fill).toBeLessThan(blurSet);
    expect(blurSet).toBeLessThan(draw);
    // The opaque fill must not itself be blurred, or it fades at the same edge.
    expect(log[fill - 1]).toEqual(["=fillStyle", "#18181b"]);
    expect(log[fill - 2]).toEqual(["=filter", "none"]);
  });

  it("gaussian without canvas filters falls back to the mosaic, never to nothing", () => {
    const { ctx, log } = fakeCtx();
    const s = scratch();
    applyRedactions(ctx, WORK, [blur()], W, H, s.canvas, false);
    expect(log.some((e) => e[0] === "=filter")).toBe(false);
    expect(s.canvas.width).toBeGreaterThan(0);
    expect(log.filter((e) => e[0] === "drawImage")).toHaveLength(1);
  });

  it("pixelate: downscale into cells, upscale without smoothing, restore smoothing", () => {
    const { ctx, log } = fakeCtx();
    const s = scratch();
    applyRedactions(ctx, WORK, [blur({ style: "pixelate", intensity: 100 })], W, H, s.canvas, true);
    // cell = 0.04 × 500 = 20 px → region 300 × 100 px → 15 × 5 cells
    expect([s.canvas.width, s.canvas.height]).toEqual([15, 5]);
    const writes = log.filter((e) => e[0] === "=imageSmoothingEnabled").map((e) => e[1]);
    expect(writes).toEqual([false, true]);
  });

  it("a blur over an earlier cover samples the COVER, not what it hid", () => {
    const { ctx, log } = fakeCtx();
    const cover: Redaction = {
      id: "c",
      kind: "cover",
      start: 0,
      end: 5,
      rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
      fill: "#18181b",
      label: "",
    };
    applyRedactions(ctx, WORK, [cover, blur()], W, H, scratch().canvas, true);
    // The only image the blur redraws is WORK — the canvas that now holds the cover.
    for (const entry of log.filter((e) => e[0] === "drawImage")) expect(entry[1]).toBe(WORK);
  });

  it("fails closed with a solid block when no scratch context exists", () => {
    const { ctx, log } = fakeCtx();
    applyRedactions(ctx, WORK, [blur({ style: "pixelate" })], W, H, scratch(false).canvas, true);
    expect(log).toContainEqual(["fillRect", 100, 100, 300, 100]);
  });
});
```

### Task 2 — plan and messages

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-plan.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-plan.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-plan.ts
@@ -6,6 +6,8 @@
  */
 import { layoutDuration, toLayout } from "../timeline";
 import type { VideoScene } from "../scene";
+import type { Redaction } from "../privacy/redaction";
+import { isSourceRangeVisible } from "../source-time";

 export interface RenderClipSegment {
   kind: "clip";
@@ -37,6 +39,13 @@
   overlayWindows: OverlayWindow[];
   totalDuration: number;
   slideFps: 30;
+  /**
+   * v2: privacy regions (SOURCE time) that are visible somewhere on the timeline. The
+   * worker selects per frame by interval overlap (redactionsForFrame).
+   */
+  redactions: Redaction[];
+  /** v2: true when the scene has ANY zoom — the renderer then sends the camera path. */
+  hasZoom: boolean;
 }

 export function buildExportPlan(scene: VideoScene): ExportPlan {
@@ -74,5 +83,11 @@
     overlayWindows,
     totalDuration: layoutDuration(layout),
     slideFps: 30,
+    redactions: scene.redactions.filter((r) => isSourceRangeVisible(layout, r.start, r.end)),
+    // NOT filtered by visibility, unlike the redactions: the camera has 0.2 s of lookahead
+    // and eases out past a segment's end, so a zoom sitting entirely in deleted footage
+    // still moves the camera over the kept frames next to the cut — exactly as the preview
+    // renders it. Dropping the path here would silently un-zoom those frames.
+    hasZoom: scene.zoomSegments.length > 0,
   };
 }
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-plan.test.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-plan.test.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-plan.test.ts
@@ -60,4 +60,50 @@
   it("throws on an empty timeline", () => {
     expect(() => buildExportPlan({ ...initialScene(1), items: [], overlays: [] })).toThrow();
   });
+
+  it("carries only visible redactions, but flags a zoom even inside a cut (v2)", () => {
+    const base = initialScene(30);
+    const plan = buildExportPlan({
+      ...base,
+      items: [clip("a", 0, 10), clip("b", 20, 30)],
+      redactions: [
+        {
+          id: "kept",
+          kind: "cover",
+          start: 2,
+          end: 4,
+          rect: { x: 0, y: 0, w: 1, h: 1 },
+          fill: "#18181b",
+          label: "",
+        },
+        {
+          id: "cut",
+          kind: "cover",
+          start: 12,
+          end: 18,
+          rect: { x: 0, y: 0, w: 1, h: 1 },
+          fill: "#18181b",
+          label: "",
+        },
+      ],
+      zoomSegments: [
+        {
+          id: "z",
+          start: 12,
+          end: 15,
+          scale: 2,
+          mode: "follow",
+          anchor: null,
+          smoothing: 70,
+          origin: "auto",
+          trigger: "click",
+        },
+      ],
+    });
+    expect(plan.redactions.map((r) => r.id)).toEqual(["kept"]);
+    // The zoom lies in deleted footage, yet lookahead + ease-out still carry the camera
+    // over the kept frames on either side of the cut — the preview zooms there, so the
+    // export needs the path too.
+    expect(plan.hasZoom).toBe(true);
+  });
 });
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-messages.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-messages.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-messages.ts
@@ -7,6 +7,14 @@
  */
 import type { ExportPlan } from "./export-plan";

+/** A CameraPath's arrays (transferred — the renderer sends COPIES, see use-video-export). */
+export interface CameraPathMessage {
+  fps: number;
+  cx: Float32Array;
+  cy: Float32Array;
+  scale: Float32Array;
+}
+
 /** Sent once from the renderer to the worker to kick off the export. */
 export interface ExportStartMessage {
   type: "start";
@@ -23,6 +31,8 @@
   slides: Array<{ assetId: string; bitmap: ImageBitmap }>;
   /** Native pixel dimensions of the output video. */
   output: { width: number; height: number };
+  /** v2: the preview's camera path (same simulation), or null when the scene has no zoom. */
+  camera: CameraPathMessage | null;
 }

 /**
```

### Task 3 — worker

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts
@@ -63,6 +63,7 @@
 import type { StreamTargetChunk } from "mediabunny";
 import type { ExportStartMessage, ExportWorkerMessage } from "./export-messages";
 import { rebaseVideoTimestamp } from "./rebase-timestamp";
+import { applyRedactions, planClipFrame, type Ctx2D, type ScratchCanvas } from "./compose-frame";

 // ---------------------------------------------------------------------------
 // Typing helper: TypeScript doesn't expose `Worker` on `self` in module workers.
@@ -159,6 +160,17 @@

   await out.start();

+  // v2 composition resources (plans/video-editor-v2/11): a source-resolution work canvas
+  // for redactions + content-pinned overlays before the camera crop, and a scratch canvas
+  // for mosaics. The work canvas is created lazily — a recording with no zoom and no region
+  // never allocates it; the mosaic scratch stays 1×1 until a pixelated region resizes it.
+  const camera = msg.camera;
+  const redactions = plan.redactions;
+  let work: OffscreenCanvas | null = null;
+  let workCtx: OffscreenCanvasRenderingContext2D | null = null;
+  const scratch = new OffscreenCanvas(1, 1);
+  const filterSupported = canvasFilterSupported();
+
   // Lookup helpers built once, not rebuilt per-frame.
   const overlayByIds = new Map(msg.overlays.map((o) => [o.overlayId, o]));
   const slideBitmaps = new Map(msg.slides.map((s) => [s.assetId, s.bitmap]));
@@ -175,11 +187,13 @@
   };

   // Stamp any overlay whose visibility window covers the current output timestamp.
-  const stampOverlays = (outTs: number): void => {
+  // `target` defaults to the output; clip frames that are composited stamp onto the
+  // source-resolution work canvas instead, BEFORE the crop, so overlays are content-pinned.
+  const stampOverlays = (outTs: number, target: OffscreenCanvasRenderingContext2D = ctx): void => {
     for (const window of plan.overlayWindows) {
       if (outTs < window.start || outTs > window.end) continue;
       const overlay = overlayByIds.get(window.overlayId);
-      if (overlay) ctx.drawImage(overlay.bitmap, 0, 0, size.width, size.height);
+      if (overlay) target.drawImage(overlay.bitmap, 0, 0, size.width, size.height);
     }
   };

@@ -226,8 +240,47 @@
           if (outTs === null) continue; // straddle/duplicate frame — skip, don't advance prevOutTs
           ctx.fillStyle = "#000";
           ctx.fillRect(0, 0, size.width, size.height);
-          ctx.drawImage(wrapped.canvas, 0, 0);
-          stampOverlays(outTs);
+          const frame = planClipFrame(
+            camera,
+            redactions,
+            wrapped.timestamp,
+            wrapped.duration,
+            size.width,
+            size.height,
+          );
+          if (frame.mode === "direct") {
+            // Unchanged pre-v2 path: no zoom and no privacy region on this frame.
+            ctx.drawImage(wrapped.canvas, 0, 0);
+            stampOverlays(outTs);
+          } else {
+            if (!work || !workCtx) {
+              work = new OffscreenCanvas(size.width, size.height);
+              workCtx = work.getContext("2d");
+              if (!workCtx) throw new Error("export-worker: no 2D context on the work canvas");
+            }
+            workCtx.filter = "none";
+            workCtx.drawImage(wrapped.canvas, 0, 0);
+            // Source = `work` itself, NOT wrapped.canvas: regions may overlap, and a blur
+            // sampling the decoded frame would paint blurred original pixels over a cover
+            // drawn before it. Self-drawImage is legal in Canvas2D.
+            applyRedactions(
+              workCtx as unknown as Ctx2D,
+              work,
+              frame.redactions,
+              size.width,
+              size.height,
+              scratch as unknown as ScratchCanvas,
+              filterSupported,
+            );
+            stampOverlays(outTs, workCtx);
+            if (frame.crop) {
+              ctx.imageSmoothingQuality = "high";
+              const { sx, sy, sw, sh } = frame.crop;
+              ctx.drawImage(work, sx, sy, sw, sh, 0, 0, size.width, size.height);
+            } else {
+              ctx.drawImage(work, 0, 0);
+            }
+          }
           await sendPosterOnce();
           // Use the frame's own decoded duration so clip frames preserve the
           // source's native cadence without rounding to a fixed grid.
@@ -364,6 +419,30 @@
   return sample.trim(leadTrim, leadTrim + keepLength);
 }

+/**
+ * Whether `ctx.filter` blurs on this platform's OffscreenCanvas 2D. Checked once per
+ * export; when false, gaussian regions fall back to the mosaic (applyRedactions), so a
+ * region is never left unredacted.
+ */
+function canvasFilterSupported(): boolean {
+  try {
+    const src = new OffscreenCanvas(3, 1);
+    const sctx = src.getContext("2d");
+    const dst = new OffscreenCanvas(3, 1);
+    const dctx = dst.getContext("2d");
+    if (!sctx || !dctx) return false;
+    sctx.fillStyle = "#fff";
+    sctx.fillRect(1, 0, 1, 1);
+    dctx.filter = "blur(1px)";
+    if (dctx.filter !== "blur(1px)") return false;
+    dctx.drawImage(src, 0, 0);
+    // A working blur spreads the middle white pixel into its neighbours.
+    return dctx.getImageData(0, 0, 1, 1).data[3] > 0;
+  } catch {
+    return false;
+  }
+}
+
 /** Poster width in px; height follows the output aspect (same size generate-thumbnail used). */
 const POSTER_WIDTH = 640;

```

### Task 4 — hook, dialog, page

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts
@@ -4,6 +4,7 @@
 import { captureException } from "@renderer/features/analytics";
 import type { SlideAssetStore } from "../slide-assets";
 import type { VideoScene } from "../scene";
+import type { CameraPath } from "../zoom/camera-path";
 import { buildExportPlan } from "./export-plan";
 import type { ExportStartMessage, ExportWorkerMessage } from "./export-messages";
 import { rasterizeOverlays } from "./overlay-raster";
@@ -26,6 +27,8 @@
   /** Displayed px of the preview video box — used to scale overlay strokes true-to-preview. */
   previewWidth: number;
   slideAssets: SlideAssetStore;
+  /** v2: the preview's camera path (useCameraPath). Sent whenever the plan has a zoom. */
+  cameraPath: CameraPath | null;
   onSaved: (recording: LocalRecording) => void;
 }

@@ -199,6 +202,17 @@
           fail(GENERIC_ERROR, event.error ?? new Error(event.message));
         };

+        // COPIES of the camera arrays: transferring the preview's own buffers would detach
+        // them and break the live preview (and undo) after the export starts.
+        const camera =
+          plan.hasZoom && args.cameraPath
+            ? {
+                fps: args.cameraPath.fps,
+                cx: args.cameraPath.cx.slice(),
+                cy: args.cameraPath.cy.slice(),
+                scale: args.cameraPath.scale.slice(),
+              }
+            : null;
         const startMessage: ExportStartMessage = {
           type: "start",
           sourceBlob,
@@ -206,10 +220,12 @@
           overlays,
           slides,
           output: { width: args.videoWidth, height: args.videoHeight },
+          camera,
         };
         worker.postMessage(startMessage, [
           ...overlays.map((o) => o.bitmap),
           ...slides.map((s) => s.bitmap),
+          ...(camera ? [camera.cx.buffer, camera.cy.buffer, camera.scale.buffer] : []),
         ]);
       } catch (error) {
         fail(GENERIC_ERROR, error);
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts
@@ -4,7 +4,21 @@
 import { initialScene, type VideoScene } from "../scene";
 import { createSlideAssetStore } from "../slide-assets";
 import { useVideoExport } from "./use-video-export";
+import { buildCameraPath } from "../zoom/camera-path";
+import type { ZoomSegment } from "../zoom/zoom-model";

+const ZOOM: ZoomSegment = {
+  id: "z",
+  start: 2,
+  end: 5,
+  scale: 2,
+  mode: "fixed",
+  anchor: { x: 0.5, y: 0.5 },
+  smoothing: 70,
+  origin: "manual",
+  trigger: null,
+};
+
 // The actual worker-run export (mediabunny decode/encode inside a Web Worker) is
 // runtime-deferred — jsdom can neither construct a real Worker nor run WebCodecs.
 // This suite exercises everything the HOOK itself owns: plan validation, session
@@ -46,6 +60,7 @@
     videoHeight: 720,
     previewWidth: 640,
     slideAssets: createSlideAssetStore(),
+    cameraPath: null,
     onSaved: vi.fn(),
     ...overrides,
   };
@@ -271,4 +286,28 @@
       expect.objectContaining({ thumbnail: null }),
     );
   });
+
+  it("sends a COPY of the camera path when the scene has a zoom", async () => {
+    const cameraPath = buildCameraPath([ZOOM], null, 10);
+    const { result } = renderHook(() => useVideoExport());
+    await act(async () => {
+      await result.current.start(
+        startArgs({ scene: { ...CLIP_SCENE, zoomSegments: [ZOOM] }, cameraPath }),
+      );
+    });
+    const [message, transfer] = createdWorkers[0].postMessage.mock.calls[0];
+    expect(message.camera.fps).toBe(60);
+    expect(message.camera.scale).not.toBe(cameraPath.scale);
+    expect(Array.from(message.camera.scale)).toEqual(Array.from(cameraPath.scale));
+    expect(transfer).toContain(message.camera.scale.buffer);
+    expect(transfer).not.toContain(cameraPath.scale.buffer);
+  });
+
+  it("sends no camera when the scene has no zoom at all", async () => {
+    const { result } = renderHook(() => useVideoExport());
+    await act(async () => {
+      await result.current.start(startArgs({ cameraPath: buildCameraPath([], null, 10) }));
+    });
+    expect(createdWorkers[0].postMessage.mock.calls[0][0].camera).toBeNull();
+  });
 });
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/export-dialog.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/export-dialog.tsx
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/export-dialog.tsx
@@ -68,6 +68,8 @@
       >
         <div className={styles.progressFill} style={{ width: `${percent}%` }} />
       </div>
+      {/* v2: the export burns zoom/blur/cover in; the original on disk keeps everything. */}
+      <ModalText>{t("exportOriginalNote")}</ModalText>
       <ModalText>{percent}%</ModalText>
       <ModalActions>
         <ModalButton variant="ghost" onClick={onCancel}>
```

`cameraPath` must be declared **before** `handleExport` in the page (a `const` read in a
callback's dependency array before its declaration throws at render). PR 7's diff already
places `useCameraPath` right after `useZoomEditing` for this reason.

**Diff — `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx
+++ b/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx
@@ -493,6 +493,7 @@
       videoHeight: video.videoHeight,
       previewWidth: video.clientWidth,
       slideAssets: assetStoreRef.current,
+      cameraPath,
       onSaved: async (recording) => {
         // Persist the session before navigating away so reopening the editor on the
         // original recording restores cuts/overlays/slides. Non-fatal if it fails —
@@ -516,7 +517,7 @@
         navigate(`/library/${recording.assetId}`);
       },
     });
-  }, [playback, videoExport, scene, source, controller, navigate, assetStoreRef]);
+  }, [playback, videoExport, scene, source, controller, navigate, assetStoreRef, cameraPath]);

   const handleDeleteOverlay = useCallback(() => {
     // Same rationale as handleDeleteSelected: don't touch scene/selection while a
```

### Task 5 — verify

- [ ] Checks (audit rule 4). **Expected after PRs 1–9**, not something this 🔵 Proposed doc
      has already observed on `main`: with the chain of diffs in docs 01–11 applied cleanly,
      in order, `check-types:web` and `check-types:node` come back clean, `oxfmt --check` passes,
      and the full suite is green — ~1,024 tests across the `main` and `renderer` vitest
      projects. Record the real numbers in the PR when it lands.
- [ ] Pre-v2 regression: export a recording with cuts + slides + annotations and **no**
      zooms/regions → byte-for-byte same pipeline (`direct` path on every frame); A/V in sync
      at every cut (existing e2e: `bun run test:e2e` in `apps/kaipu-record`).
- [ ] Zoom: export a PR 2 recording with detected zooms → the file zooms where the preview
      does (compare 5 timestamps side by side); no zoom on slides; text annotations grow with
      the zoom (content-pinned).
- [ ] Regions: the leak checks in [10 § Task 10](/plans/video-editor-v2/10-redactions-rendering-and-leaks/#task-10--verify).
- [ ] Perf: export a 30 s 2560×1600 clip with two zooms and one gaussian region; record the
      wall time next to the same export on `main`. Write both numbers into this section. If
      v2 is more than 2× slower, stop and report (likely cause: blur on large regions).
- [ ] Memory: during that export, the renderer's memory in Activity Monitor must not grow
      by more than ~100 MB (one extra source-size canvas ≈ 16 MB).
- [ ] Poster: export a recording whose first kept frame is fully covered → the library card
      is a solid block, and no covered content is visible on it (accepted, see Decisions).

Housekeeping: [09 § Task 6](/plans/video-editor-v2/09-preview-compositing/) carries the same
"Verified before publishing: … tests" wording inside an unchecked box on a 🔵 Proposed doc.
It should be rephrased as an expectation the way this section now is — that edit belongs to
whoever owns doc 09, not to this PR.

## Non-goals

An export resolution / format option (spec § 11 open item; separate backlog item
"Formatos de export"), GPU shaders, motion blur, drawing a cursor sprite (doc 12).

## Reopen if

The perf check fails (move blur to a WebGL pass, or blur a downscaled region and upscale),
or an export resolution option lands (then crop from source and scale to the output size —
zoom gets real headroom, see doc 12).
