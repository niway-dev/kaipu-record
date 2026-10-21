---
title: "Video editor v2 — 10 redactions: rendering and leaks"
description: "Blur and cover regions end to end: the export poster that leaked the original, edge frames, resolution-independent strength shared by preview and export, fail-closed rendering, the drawing / editing / Privacy-lane UI and its inspectors. Verified code and diffs. Fixes audit W14."
sidebar:
  order: 10
---

# 10 — Redactions: rendering and leaks

> **Status: 🟡 In progress** (2026-09-22). Covers PR 1 (poster), the math in PR 4, and
> PR 8 ("Redactions in the editor") of the [audit](/plans/video-editor-v2/00-audit/).
> Fixes W14. The export side of the regions is in [11](/plans/video-editor-v2/11-export-pass/).
> Implemented across `feat/video-editor-v2-poster-from-output`,
> `feat/video-editor-v2-zoom-math` and `feat/video-editor-v2-redactions` — none merged,
> none validated in production; see the
> [backlog PR table](/backlog/video-editor-zoom-blur-cover/).

## Problem

Privacy regions are the one feature where a bug is not "it looks off" but "the secret is
published". The overview treats them as a drawing feature. Leaks it does not see:

1. **The exported file's poster is the ORIGINAL's first frame.** `use-video-export.ts:109`
   calls `generateThumbnail(sourceBlob)` — the source recording, not the render. Today that
   already shows footage the user cut away; with v2 it shows the content the user covered
   or blurred, as the library card of the "safe" export (and wherever the poster goes).
2. **Point-in-time checks leak edge frames.** A frame is on screen for an interval. Testing
   only its timestamp against `[start, end]` lets the frame that _starts_ just before
   `start` through unredacted.
3. **Blur strength depends on resolution.** The UI spec's `blur(2 + intensity/100 × 9 px)`
   is in preview CSS pixels. Applied as-is at export on a 2560×1600 source, the same
   intensity is ~4× weaker — the preview looks safe, the file is readable.
4. **Unsupported paths fail open.** If `ctx.filter` is not honoured on a platform's
   OffscreenCanvas, a naive implementation draws the frame unblurred.
5. **Edits that weaken a region.** Hand-edited or future-version sessions could carry an
   intensity below the spec's minimum.

## Decisions

| Topic             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export poster     | **PR 1, ships first, independent of v2.** The worker encodes a JPEG of its first _composed_ output frame (`poster` message) before encoding it. No poster → `null`; the library's orphan heal (`use-orphan-heal.ts`, which triggers on `!thumbnailUrl`) decodes one later from the **exported** file. Never fall back to the source.                                                                                                                                    |
| Frame selection   | Interval overlap: a frame on screen during `[ts, ts + duration)` gets every region with `start < ts + duration && end > ts` (`redactionsForFrame`). The preview pads ±50 ms more (never shows what the export hides).                                                                                                                                                                                                                                                   |
| Strength parity   | Every resolution-dependent size is a fraction of the frame height, tuned on the spec's 382 px preview: `blurSigmaPx`, `pixelBlockPx`, `coverLabelPx`. Preview uses the displayed height, export the source height. One accepted exception: the cover label's **typeface and inset** differ (platform sans-serif, condense-to-fit) — see [11 § Task 1](/plans/video-editor-v2/11-export-pass/#task-1--frame-composition-pure-unit-tested-with-a-recording-fake-context). |
| Pixel rounding    | `rectToPx` rounds outward (floor near edges, ceil far edges, with a 1e-6 guard against float noise) so no 1 px seam survives.                                                                                                                                                                                                                                                                                                                                           |
| Fail closed       | Gaussian without canvas filters → mosaic. No scratch context → solid block. Never "draw nothing".                                                                                                                                                                                                                                                                                                                                                                       |
| Minimum intensity | 40, enforced in the slider (`min`), in `updateRedaction`, and on session load.                                                                                                                                                                                                                                                                                                                                                                                          |
| Space / time      | Normalized rect of the ORIGINAL frame, SOURCE seconds (doc 06). Drawn and edited on the **unzoomed** frame: while a privacy tool is active or a region is selected the camera is off, so stage coordinates = frame coordinates.                                                                                                                                                                                                                                         |
| Selection         | From the Privacy lane, or automatically right after drawing (spec § 4.4). **Deviation from spec § 4.3**: clicking a region _on the preview_ does not select it in v2 — the annotation layer owns preview clicks; see "Reopen if".                                                                                                                                                                                                                                       |
| What stays unsafe | The original file, its thumbnail and any Cloud copy of it keep everything (by design — non-destructive). The export dialog says so (`exportOriginalNote`, PR 9).                                                                                                                                                                                                                                                                                                        |

Gaussian blur is not a cryptographic redaction; the inspector recommends Cover "for real
secrets" (spec § 7.2). Pixelate at intensity ≥ 40 uses cells ≥ 1.2 % of the frame height.

## PR 1 — Export poster from the rendered output

Applies to `main` directly (verified). Files: `export/export-messages.ts`,
`export/export-worker.ts`, `export/use-video-export.ts`, `export/use-video-export.test.ts`.

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-messages.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-messages.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-messages.ts
@@ -32,6 +32,12 @@
  */
 export type ExportWorkerMessage =
   | { type: "chunk"; data: ArrayBuffer; position: number }
+  /**
+   * JPEG poster of the FIRST RENDERED output frame (transferable), sent once before the
+   * first frame is encoded. It replaces decoding the poster from the source file, which
+   * showed footage the edit deleted and — with video-editor v2 — content it redacted.
+   */
+  | { type: "poster"; data: ArrayBuffer }
   | { type: "progress"; fraction: number }
   | { type: "done" }
   | { type: "error"; message: string };
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts
@@ -181,6 +181,17 @@
       const overlay = overlayByIds.get(window.overlayId);
       if (overlay) ctx.drawImage(overlay.bitmap, 0, 0, size.width, size.height);
     }
+  };
+
+  // Poster = the first composed output frame (see ExportWorkerMessage "poster"). Encoded
+  // before that frame is handed to the encoder, so it shows exactly what the file starts
+  // with — cuts, slides, overlays (and in v2, zoom and privacy regions) included.
+  let posterSent = false;
+  const sendPosterOnce = async (): Promise<void> => {
+    if (posterSent) return;
+    posterSent = true;
+    const data = await encodePoster(canvas);
+    if (data) post({ type: "poster", data }, [data]);
   };

   // Release Output encoders on any error path. Do NOT cancel on the success
@@ -217,6 +228,7 @@
           ctx.fillRect(0, 0, size.width, size.height);
           ctx.drawImage(wrapped.canvas, 0, 0);
           stampOverlays(outTs);
+          await sendPosterOnce();
           // Use the frame's own decoded duration so clip frames preserve the
           // source's native cadence without rounding to a fixed grid.
           await videoSource.add(outTs, wrapped.duration);
@@ -238,6 +250,7 @@
           ctx.fillRect(0, 0, size.width, size.height);
           if (bitmap) drawContained(ctx, bitmap, size.width, size.height);
           stampOverlays(outTs);
+          await sendPosterOnce();
           await videoSource.add(outTs, frameDuration);
           reportProgress(outTs);
           prevOutTs = outTs;
@@ -349,6 +362,25 @@
   // AudioSample.trim takes a [startFrame, endFrame) half-open range and returns a new
   // sample; the caller is responsible for closing it (and the untrimmed original).
   return sample.trim(leadTrim, leadTrim + keepLength);
+}
+
+/** Poster width in px; height follows the output aspect (same size generate-thumbnail used). */
+const POSTER_WIDTH = 640;
+
+/** JPEG of `source` scaled to POSTER_WIDTH; null if the platform cannot encode (cosmetic). */
+async function encodePoster(source: OffscreenCanvas): Promise<ArrayBuffer | null> {
+  try {
+    const width = Math.min(POSTER_WIDTH, source.width);
+    const height = Math.max(1, Math.round((source.height * width) / source.width));
+    const poster = new OffscreenCanvas(width, height);
+    const pctx = poster.getContext("2d");
+    if (!pctx) return null;
+    pctx.drawImage(source, 0, 0, width, height);
+    const blob = await poster.convertToBlob({ type: "image/jpeg", quality: 0.7 });
+    return await blob.arrayBuffer();
+  } catch {
+    return null;
+  }
 }

 /**
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts
@@ -2,7 +2,6 @@
 import { useTranslations } from "@kaipu/i18n";
 import type { LocalRecording } from "@shared/types/library-storage";
 import { captureException } from "@renderer/features/analytics";
-import { generateThumbnail } from "@renderer/lib/generate-thumbnail";
 import type { SlideAssetStore } from "../slide-assets";
 import type { VideoScene } from "../scene";
 import { buildExportPlan } from "./export-plan";
@@ -102,11 +101,11 @@
       try {
         const sourceResponse = await fetch(`kaipu-media://recording/${args.sourceId}`);
         const sourceBlob = await sourceResponse.blob();
-        // Kicked off in parallel with rasterizing/decoding below — it only reads the
-        // already-fetched Blob, so it never contends with the worker's own read of it.
-        // Poster is decoded from the source's first frame via mediabunny (see
-        // generate-thumbnail); a null result just means no poster is written.
-        const thumbnailPromise = generateThumbnail(sourceBlob);
+        // The poster comes from the worker's first RENDERED frame ("poster" message), never
+        // from the source file: the source still holds deleted footage and redacted content.
+        // No poster (encode failed) → null, and the vault's self-healing metadata decodes
+        // one later from the exported file itself.
+        let poster: ArrayBuffer | null = null;

         const rasterized = await rasterizeOverlays(
           args.scene.overlays,
@@ -159,17 +158,20 @@
           if (!activeRef.current) return;
           if (msg.type === "chunk") {
             window.electronAPI.recordingWrite(sessionId, msg.data, msg.position);
+          } else if (msg.type === "poster") {
+            poster = msg.data;
           } else if (msg.type === "progress") {
             setState((s) => (s.status === "exporting" ? { ...s, fraction: msg.fraction } : s));
           } else if (msg.type === "error") {
             fail(GENERIC_ERROR, new Error(msg.message));
           } else if (msg.type === "done") {
             void (async () => {
-              const thumbnail = await thumbnailPromise;
-              // cancel() may have run while awaiting the thumbnail (worker terminated,
+              const thumbnail = poster;
+              // Yield once so a cancel() queued in the same tick wins (worker terminated,
               // writer session aborted, activeRef flipped false) — finalizing or calling
               // onSaved past that point would resurrect a cancelled export (navigating
               // to it, or racing cancel()'s own reset with this callback's).
+              await Promise.resolve();
               if (!activeRef.current) return;
               try {
                 const recording = await window.electronAPI.recordingFinalize(sessionId, {
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts
@@ -10,14 +10,9 @@
 // This suite exercises everything the HOOK itself owns: plan validation, session
 // lifecycle (create/write/finalize/abort), message routing, and cancellation —
 // with a fake Worker standing in for the real one.
-// The poster is decoded via mediabunny (WebCodecs), which jsdom lacks — mock the
-// shared primitive so the hook's plumbing is observable. A non-null buffer here
-// proves the fix: the export must forward a real poster to finalize (the old
-// `<video>`-seek capture always resolved null, so no thumbnail was ever written).
-const { FAKE_THUMB } = vi.hoisted(() => ({ FAKE_THUMB: new Uint8Array([9, 8, 7]).buffer }));
-vi.mock("@renderer/lib/generate-thumbnail", () => ({
-  generateThumbnail: vi.fn(async () => FAKE_THUMB),
-}));
+// The poster is the worker's first rendered frame, delivered as a "poster" message
+// (never decoded from the source — it holds deleted and redacted content).
+const FAKE_THUMB = new Uint8Array([9, 8, 7]).buffer;

 class FakeWorker {
   onmessage: ((event: MessageEvent) => void) | null = null;
@@ -180,9 +175,7 @@
   });

   it("does not call onSaved when cancel() runs during the done→finalize window", async () => {
-    // generateThumbnail is mocked to resolve immediately (see module mock at the
-    // top), so by the time `done` fires the thumbnailPromise has already settled —
-    // the await inside the done handler's IIFE still yields a microtask, which is the
+    // The done handler's IIFE yields a microtask before finalizing, which is the
     // exact window cancel() races against. recordingFinalize is made to hang so we can
     // land cancel() squarely inside that second await too.
     let resolveFinalize!: (recording: LocalRecording) => void;
@@ -202,8 +195,8 @@
     const worker = createdWorkers[0];

     act(() => worker.onmessage?.({ data: { type: "done" } } as MessageEvent));
-    // Wait for the done handler's IIFE to actually reach recordingFinalize (it awaits
-    // thumbnailPromise first) before racing cancel() against it.
+    // Wait for the done handler's IIFE to actually reach recordingFinalize (it yields
+    // once first) before racing cancel() against it.
     await waitFor(() => expect(window.electronAPI.recordingFinalize).toHaveBeenCalled());
     // Cancel while still awaiting the (still-pending) recordingFinalize call.
     act(() => result.current.cancel());
@@ -242,6 +235,7 @@
       .calls[0][0] as string;
     const worker = createdWorkers[0];

+    act(() => worker.onmessage?.({ data: { type: "poster", data: FAKE_THUMB } } as MessageEvent));
     act(() => worker.onmessage?.({ data: { type: "done" } } as MessageEvent));

     await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
@@ -257,4 +251,19 @@
     );
     expect(result.current.status).toBe("idle");
   });
+
+  it("finalizes without a poster when the worker sent none (never the source's first frame)", async () => {
+    const onSaved = vi.fn();
+    const { result } = renderHook(() => useVideoExport());
+    await act(async () => {
+      await result.current.start(startArgs({ onSaved }));
+    });
+    const worker = createdWorkers[0];
+    act(() => worker.onmessage?.({ data: { type: "done" } } as MessageEvent));
+    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
+    expect(window.electronAPI.recordingFinalize).toHaveBeenCalledWith(
+      expect.any(String),
+      expect.objectContaining({ thumbnail: null }),
+    );
+  });
 });
```

Verify: checks (audit rule 4); manually cut the first 3 s of a recording, add a text
annotation at 0:00, export → the library card of the export shows the annotated frame
that starts the edit, not the original's first frame. Also start a recording's edit on a
frame that a later PR would fully cover (for PR 1 alone: a full-frame annotation) → the
card is a solid block. That is accepted and correct: a poster that shows what the user
redacted is the bug this PR exists to fix, and the user can cut to a different opening
frame. It is stated as a Decision in
[11](/plans/video-editor-v2/11-export-pass/#decisions).

## PR 4 — Redaction model and math

**`apps/kaipu-record/src/renderer/src/features/video-editor/privacy/redaction.ts`**

```ts
/**
 * Privacy regions (blur / cover). Geometry is normalized 0–1 of the ORIGINAL frame;
 * times are SOURCE seconds. Every size that depends on resolution is expressed as a
 * fraction of the frame height, so the preview (CSS px of the displayed video) and
 * the export (native px) compute the same visual strength — see `blurSigmaPx`.
 */

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RedactionBase {
  id: string;
  start: number;
  end: number;
  rect: NormRect;
}

export interface BlurRedaction extends RedactionBase {
  kind: "blur";
  /** REDACTION.minIntensity–100. */
  intensity: number;
  style: "gaussian" | "pixelate";
}

export interface CoverRedaction extends RedactionBase {
  kind: "cover";
  /** One of REDACTION.coverFills. */
  fill: string;
  /** Optional centered text; "" = plain block. */
  label: string;
}

export type Redaction = BlurRedaction | CoverRedaction;

export const REDACTION = {
  /** A soft gaussian over text can be partially reversed — never allow less. */
  minIntensity: 40,
  defaultIntensity: 70,
  defaultSeconds: 5,
  minSeconds: 1,
  /** Smallest drawable region, normalized (avoids invisible slivers). */
  minSize: 0.01,
  coverFills: ["#18181b", "#F6055C", "#3d5570", "#f3f3f5"],
  /** Reference preview height the UI spec's `2 + intensity/100 × 9 px` was tuned on. */
  specPreviewHeight: 382,
} as const;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function clampIntensity(intensity: number): number {
  return clamp(Math.round(intensity), REDACTION.minIntensity, 100);
}

/** Gaussian standard deviation in px for a frame `frameHeightPx` tall. */
export function blurSigmaPx(intensity: number, frameHeightPx: number): number {
  const specPx = 2 + (clampIntensity(intensity) / 100) * 9;
  return (specPx / REDACTION.specPreviewHeight) * frameHeightPx;
}

/** Mosaic cell size in px (≥ 4) for a frame `frameHeightPx` tall. */
export function pixelBlockPx(intensity: number, frameHeightPx: number): number {
  const k = (clampIntensity(intensity) - REDACTION.minIntensity) / (100 - REDACTION.minIntensity);
  return Math.max(4, Math.round((0.012 + (0.04 - 0.012) * k) * frameHeightPx));
}

/** Cover label size: the spec's 10.5 px at the 382 px reference preview height. */
export function coverLabelPx(frameHeightPx: number): number {
  return (10.5 / REDACTION.specPreviewHeight) * frameHeightPx;
}

/** Readable label color on a cover fill: dark text on the light swatch, white elsewhere. */
export function coverLabelColor(fill: string): string {
  return fill.toLowerCase() === "#f3f3f5" ? "#18181b" : "#ffffff";
}

/**
 * Integer pixel rect for a normalized rect, rounded OUTWARD (floor the near edge, ceil
 * the far edge) so a redaction never leaves a 1 px unredacted seam, clipped to the frame.
 */
export function rectToPx(
  rect: NormRect,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  // EPS absorbs float noise (0.301 × 1000 = 301.00000000000006) so an exact edge
  // doesn't grow by a spurious pixel; any real fraction still rounds outward.
  const EPS = 1e-6;
  const x0 = clamp(Math.floor(rect.x * width + EPS), 0, width);
  const y0 = clamp(Math.floor(rect.y * height + EPS), 0, height);
  const x1 = clamp(Math.ceil((rect.x + rect.w) * width - EPS), 0, width);
  const y1 = clamp(Math.ceil((rect.y + rect.h) * height - EPS), 0, height);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Redactions to apply to a frame that is on screen during source [frameStart, frameEnd).
 * Interval OVERLAP, not a point test on the frame timestamp: a frame that is visible for
 * any part of a redaction's window gets redacted, so no frame at either edge leaks.
 */
export function redactionsForFrame(
  redactions: Redaction[],
  frameStart: number,
  frameEnd: number,
): Redaction[] {
  return redactions.filter((r) => r.start < frameEnd && r.end > frameStart);
}

/** Normalize a drag from (ax, ay) to (bx, by) into a rect clamped to the frame. */
export function rectFromDrag(ax: number, ay: number, bx: number, by: number): NormRect {
  const x0 = clamp(Math.min(ax, bx), 0, 1);
  const y0 = clamp(Math.min(ay, by), 0, 1);
  const x1 = clamp(Math.max(ax, bx), 0, 1);
  const y1 = clamp(Math.max(ay, by), 0, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/privacy/redaction.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  blurSigmaPx,
  clampIntensity,
  pixelBlockPx,
  coverLabelColor,
  coverLabelPx,
  rectFromDrag,
  rectToPx,
  redactionsForFrame,
  type Redaction,
} from "./redaction";

describe("redaction math", () => {
  it("matches the UI spec at the spec preview height", () => {
    expect(blurSigmaPx(100, 382)).toBeCloseTo(11, 6);
    expect(blurSigmaPx(40, 382)).toBeCloseTo(5.6, 6);
  });
  it("scales with frame height (preview/export parity)", () => {
    expect(blurSigmaPx(70, 1080) / blurSigmaPx(70, 540)).toBeCloseTo(2, 6);
  });
  it("never goes below the minimum intensity", () => {
    expect(clampIntensity(0)).toBe(40);
    expect(blurSigmaPx(0, 382)).toBeCloseTo(blurSigmaPx(40, 382), 6);
  });
  it("pixel blocks are at least 4 px", () => {
    expect(pixelBlockPx(40, 100)).toBe(4);
    expect(pixelBlockPx(100, 1000)).toBe(40);
  });
  it("rounds rects outward and clips to the frame", () => {
    expect(rectToPx({ x: 0.101, y: 0.2, w: 0.2, h: 0.899 }, 1000, 100)).toEqual({
      x: 101,
      y: 20,
      w: 200,
      h: 80,
    });
  });
  it("selects redactions overlapping the frame interval", () => {
    const r = (id: string, start: number, end: number): Redaction => ({
      id,
      kind: "cover",
      start,
      end,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      fill: "#000",
      label: "",
    });
    const list = [r("before", 0, 1), r("edge", 1.99, 3), r("after", 2.04, 4)];
    expect(redactionsForFrame(list, 2, 2.033).map((x) => x.id)).toEqual(["edge"]);
  });
  it("normalizes a drag in any direction", () => {
    expect(rectFromDrag(0.8, 0.9, 0.2, 1.4)).toEqual({
      x: 0.2,
      y: 0.9,
      w: 0.6000000000000001,
      h: 0.09999999999999998,
    });
  });
  it("cover labels scale with the frame and stay readable", () => {
    expect(coverLabelPx(382)).toBeCloseTo(10.5, 9);
    expect(coverLabelPx(1080)).toBeCloseTo(29.69, 2);
    expect(coverLabelColor("#F3F3F5")).toBe("#18181b");
    expect(coverLabelColor("#18181b")).toBe("#ffffff");
  });
});
```

(`privacy/redaction-edits.ts` ships in PR 5 — [07 Task 3](/plans/video-editor-v2/07-scene-session-and-history/#task-3--pure-helpers).)

## PR 8 — Redactions in the editor

Requires PR 7 ([09](/plans/video-editor-v2/09-preview-compositing/)): regions render in
the `underlay` slot; drawing and editing live in the `chrome` slot.

### Files

| Action | Path (under `apps/kaipu-record/src/renderer/src/features/video-editor/`)              |
| ------ | ------------------------------------------------------------------------------------- |
| Create | `privacy/region-geometry.ts` + `.test.ts`                                             |
| Create | `privacy/use-redaction-editing.ts` + `.test.ts`                                       |
| Create | `components/redaction-layer.tsx` + `.module.css`                                      |
| Create | `components/region-drawer.tsx` + `.module.css`                                        |
| Create | `components/region-editor.tsx` + `.module.css`                                        |
| Create | `components/privacy-lane.tsx` + `.module.css`                                         |
| Create | `components/inspector/blur-inspector.tsx`, `components/inspector/cover-inspector.tsx` |
| Create | `components/privacy-components.test.tsx`                                              |
| Modify | `annotations/video-tools.ts`, `components/editor-toolbar.tsx` + `.test.tsx`           |
| Modify | `pages/video-editor/video-editor-page.tsx` (`src/renderer/src/pages/…`)               |

### Task 1 — i18n keys

| Key                     | es                                                                                        | en                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `lanePrivacy`           | PRIVACIDAD                                                                                | PRIVACY                                                                         |
| `toolBlur`              | Desenfocar                                                                                | Blur                                                                            |
| `toolCover`             | Cubrir                                                                                    | Cover                                                                           |
| `hintBlur`              | Arrastra sobre la vista previa para desenfocar un área durante un rango de tiempo.        | Drag over the preview to blur an area for a time range.                         |
| `hintCover`             | Arrastra sobre la vista previa para ocultar un área por completo.                         | Drag over the preview to hide an area completely.                               |
| `privacyCount`          | {count, plural, one {# región privada} other {# regiones privadas}}                       | {count, plural, one {# private region} other {# private regions}}               |
| `drawSizeBadge`         | {w} × {h} · {kind}                                                                        | {w} × {h} · {kind}                                                              |
| `drawRangeBadge`        | SUELTA PARA AGREGAR · {from} → {to}                                                       | RELEASE TO ADD · {from} → {to}                                                  |
| `ghostBlur`             | NUEVO DESENFOQUE                                                                          | NEW BLUR                                                                        |
| `ghostCover`            | NUEVA COBERTURA                                                                           | NEW COVER                                                                       |
| `blurTitle`             | Región desenfocada                                                                        | Blur region                                                                     |
| `blurBadge`             | DESENFOQUE                                                                                | BLUR                                                                            |
| `blurIntensity`         | Intensidad                                                                                | Intensity                                                                       |
| `blurIntensityNote`     | Mínimo 40: un desenfoque suave sobre texto se puede revertir en parte.                    | Minimum 40 — a soft gaussian over text can be partially reversed.               |
| `blurStyle`             | Estilo                                                                                    | Style                                                                           |
| `blurGaussian`          | Gaussiano                                                                                 | Gaussian                                                                        |
| `blurPixelate`          | Pixelado                                                                                  | Pixelate                                                                        |
| `blurSecretNote`        | Para secretos reales usa Cubrir: no deja rastro que recuperar.                            | For real secrets use Cover — it leaves no trace to recover.                     |
| `privacyPinnedNote`     | Se aplica antes del recorte del zoom, así que queda fijo sobre el contenido.              | Applied before the zoom crop, so it stays pinned to the content.                |
| `coverTitle`            | Región cubierta                                                                           | Cover region                                                                    |
| `coverBadge`            | COBERTURA                                                                                 | COVER                                                                           |
| `coverFill`             | Relleno                                                                                   | Fill                                                                            |
| `coverLabel`            | Etiqueta (opcional)                                                                       | Label (optional)                                                                |
| `coverLabelPlaceholder` | p. ej. clave de API oculta                                                                | e.g. API key hidden                                                             |
| `coverBurnNote`         | Queda grabado en los píxeles al exportar: el archivo exportado nunca contiene el secreto. | Burned into the pixels on export — the exported file never contains the secret. |
| `removeRegion`          | Quitar región                                                                             | Remove region                                                                   |
| `privacyNotOnSlide`     | Las imágenes no se pueden desenfocar ni cubrir.                                           | Images can't be blurred or covered.                                             |

Paste into `packages/i18n/messages/es.json` → `"videoEditor"` (without the outer braces):

```json
{
  "lanePrivacy": "PRIVACIDAD",
  "toolBlur": "Desenfocar",
  "toolCover": "Cubrir",
  "hintBlur": "Arrastra sobre la vista previa para desenfocar un área durante un rango de tiempo.",
  "hintCover": "Arrastra sobre la vista previa para ocultar un área por completo.",
  "privacyCount": "{count, plural, one {# región privada} other {# regiones privadas}}",
  "drawSizeBadge": "{w} × {h} · {kind}",
  "drawRangeBadge": "SUELTA PARA AGREGAR · {from} → {to}",
  "ghostBlur": "NUEVO DESENFOQUE",
  "ghostCover": "NUEVA COBERTURA",
  "blurTitle": "Región desenfocada",
  "blurBadge": "DESENFOQUE",
  "blurIntensity": "Intensidad",
  "blurIntensityNote": "Mínimo 40: un desenfoque suave sobre texto se puede revertir en parte.",
  "blurStyle": "Estilo",
  "blurGaussian": "Gaussiano",
  "blurPixelate": "Pixelado",
  "blurSecretNote": "Para secretos reales usa Cubrir: no deja rastro que recuperar.",
  "privacyPinnedNote": "Se aplica antes del recorte del zoom, así que queda fijo sobre el contenido.",
  "coverTitle": "Región cubierta",
  "coverBadge": "COBERTURA",
  "coverFill": "Relleno",
  "coverLabel": "Etiqueta (opcional)",
  "coverLabelPlaceholder": "p. ej. clave de API oculta",
  "coverBurnNote": "Queda grabado en los píxeles al exportar: el archivo exportado nunca contiene el secreto.",
  "removeRegion": "Quitar región",
  "privacyNotOnSlide": "Las imágenes no se pueden desenfocar ni cubrir."
}
```

and into `packages/i18n/messages/en.json` → `"videoEditor"`:

```json
{
  "lanePrivacy": "PRIVACY",
  "toolBlur": "Blur",
  "toolCover": "Cover",
  "hintBlur": "Drag over the preview to blur an area for a time range.",
  "hintCover": "Drag over the preview to hide an area completely.",
  "privacyCount": "{count, plural, one {# private region} other {# private regions}}",
  "drawSizeBadge": "{w} × {h} · {kind}",
  "drawRangeBadge": "RELEASE TO ADD · {from} → {to}",
  "ghostBlur": "NEW BLUR",
  "ghostCover": "NEW COVER",
  "blurTitle": "Blur region",
  "blurBadge": "BLUR",
  "blurIntensity": "Intensity",
  "blurIntensityNote": "Minimum 40 — a soft gaussian over text can be partially reversed.",
  "blurStyle": "Style",
  "blurGaussian": "Gaussian",
  "blurPixelate": "Pixelate",
  "blurSecretNote": "For real secrets use Cover — it leaves no trace to recover.",
  "privacyPinnedNote": "Applied before the zoom crop, so it stays pinned to the content.",
  "coverTitle": "Cover region",
  "coverBadge": "COVER",
  "coverFill": "Fill",
  "coverLabel": "Label (optional)",
  "coverLabelPlaceholder": "e.g. API key hidden",
  "coverBurnNote": "Burned into the pixels on export — the exported file never contains the secret.",
  "removeRegion": "Remove region",
  "privacyNotOnSlide": "Images can't be blurred or covered."
}
```

### Task 2 — geometry and editing hook

**`apps/kaipu-record/src/renderer/src/features/video-editor/privacy/region-geometry.ts`**

```ts
/** Move / resize math for a privacy region's normalized rect, clamped to the frame. */
import { type NormRect, REDACTION } from "./redaction";

export type Corner = "nw" | "ne" | "sw" | "se";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function moveRect(orig: NormRect, dx: number, dy: number): NormRect {
  return {
    ...orig,
    x: clamp(orig.x + dx, 0, 1 - orig.w),
    y: clamp(orig.y + dy, 0, 1 - orig.h),
  };
}

/** Drag `corner` to `to`; the opposite corner stays fixed; never smaller than REDACTION.minSize. */
export function resizeRect(orig: NormRect, corner: Corner, to: { x: number; y: number }): NormRect {
  const min = REDACTION.minSize;
  const left = orig.x;
  const top = orig.y;
  const right = orig.x + orig.w;
  const bottom = orig.y + orig.h;
  const px = clamp(to.x, 0, 1);
  const py = clamp(to.y, 0, 1);
  const x0 = corner === "nw" || corner === "sw" ? Math.min(px, right - min) : left;
  const x1 = corner === "ne" || corner === "se" ? Math.max(px, left + min) : right;
  const y0 = corner === "nw" || corner === "ne" ? Math.min(py, bottom - min) : top;
  const y1 = corner === "sw" || corner === "se" ? Math.max(py, top + min) : bottom;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/privacy/region-geometry.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { NormRect } from "./redaction";
import { moveRect, resizeRect } from "./region-geometry";

const R = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 };

function expectRect(actual: NormRect, expected: NormRect): void {
  for (const key of ["x", "y", "w", "h"] as const)
    expect(actual[key]).toBeCloseTo(expected[key], 9);
}

describe("moveRect", () => {
  it("moves and stays inside the frame", () => {
    expectRect(moveRect(R, 0.1, 0.1), { x: 0.3, y: 0.3, w: 0.4, h: 0.2 });
    expectRect(moveRect(R, 1, -1), { x: 0.6, y: 0, w: 0.4, h: 0.2 });
  });
});

describe("resizeRect", () => {
  it("keeps the opposite corner fixed", () => {
    expectRect(resizeRect(R, "se", { x: 0.8, y: 0.5 }), { x: 0.2, y: 0.2, w: 0.6, h: 0.3 });
    expectRect(resizeRect(R, "nw", { x: 0.1, y: 0.1 }), { x: 0.1, y: 0.1, w: 0.5, h: 0.3 });
  });
  it("never inverts or collapses", () => {
    expectRect(resizeRect(R, "se", { x: 0, y: 0 }), { x: 0.2, y: 0.2, w: 0.01, h: 0.01 });
  });
  it("clamps to the frame", () => {
    expectRect(resizeRect(R, "ne", { x: 2, y: -1 }), { x: 0.2, y: 0, w: 0.8, h: 0.4 });
  });
});
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/privacy/use-redaction-editing.ts`**

```ts
/**
 * Privacy-region editing handlers for the editor page — same history contract as
 * use-zoom-editing (plans/video-editor-v2/07). Regions are SOURCE-anchored (doc 06) and
 * may overlap each other.
 */
import { useCallback, useMemo } from "react";
import { dragRangeEdge, isSourceRangeVisible, sourceTimeAtTimeline } from "../source-time";
import type { LayoutEntry } from "../timeline";
import type { VideoSceneController } from "../use-video-scene";
import { REDACTION, type NormRect, type Redaction } from "./redaction";
import {
  addRedaction,
  type BlurPatch,
  type CoverPatch,
  removeRedaction,
  updateRedaction,
} from "./redaction-edits";

export type AddRedactionResult =
  | { ok: true; id: string }
  | { ok: false; reason: "on-slide" | "too-small" | "busy" };

export interface RedactionEditing {
  visibleRedactions: Redaction[];
  /** Source window a region drawn now would get (for the range badge / ghost block); null on a slide. */
  windowAt(timelineTime: number): { start: number; end: number } | null;
  add(kind: Redaction["kind"], rect: NormRect, timelineTime: number): AddRedactionResult;
  remove(id: string): void;
  commitPatch(id: string, patch: BlurPatch | CoverPatch): void;
  begin(): void;
  livePatch(id: string, patch: BlurPatch | CoverPatch): void;
  end(): void;
  edgeDrag(
    id: string,
    edge: "start" | "end",
    sourceTime: number | null,
    phase: "start" | "move" | "end",
  ): void;
}

export function useRedactionEditing({
  controller,
  layout,
  sourceDuration,
}: {
  controller: VideoSceneController;
  layout: LayoutEntry[];
  sourceDuration: number;
}): RedactionEditing {
  const { scene } = controller;

  const visibleRedactions = useMemo(
    () => scene.redactions.filter((r) => isSourceRangeVisible(layout, r.start, r.end)),
    [scene.redactions, layout],
  );

  const windowAt = useCallback(
    (timelineTime: number) => {
      const at = sourceTimeAtTimeline(layout, timelineTime);
      if (at === null) return null;
      const start = Math.min(at, Math.max(0, sourceDuration - REDACTION.minSeconds));
      return { start, end: Math.min(sourceDuration, start + REDACTION.defaultSeconds) };
    },
    [layout, sourceDuration],
  );

  const add = useCallback(
    (kind: Redaction["kind"], rect: NormRect, timelineTime: number): AddRedactionResult => {
      if (controller.interacting) return { ok: false, reason: "busy" };
      if (rect.w < REDACTION.minSize || rect.h < REDACTION.minSize)
        return { ok: false, reason: "too-small" };
      const window = windowAt(timelineTime);
      if (!window) return { ok: false, reason: "on-slide" };
      const { scene: next, id } = addRedaction(controller.scene, kind, rect, window);
      controller.commit(next);
      return { ok: true, id };
    },
    [controller, windowAt],
  );

  const remove = useCallback(
    (id: string) => {
      if (controller.interacting) return;
      controller.commit(removeRedaction(controller.scene, id));
    },
    [controller],
  );

  const commitPatch = useCallback(
    (id: string, patch: BlurPatch | CoverPatch) => {
      if (controller.interacting) return;
      controller.commit(updateRedaction(controller.scene, id, patch));
    },
    [controller],
  );

  const livePatch = useCallback(
    (id: string, patch: BlurPatch | CoverPatch) =>
      controller.updateLive(updateRedaction(controller.scene, id, patch)),
    [controller],
  );

  const edgeDrag = useCallback(
    (
      id: string,
      edge: "start" | "end",
      sourceTime: number | null,
      phase: "start" | "move" | "end",
    ) => {
      if (phase === "start") controller.beginInteract();
      if (phase === "move" && sourceTime !== null) {
        const self = controller.scene.redactions.find((r) => r.id === id);
        if (self) {
          // Regions may overlap: the only sibling that constrains the drag is itself.
          const range = dragRangeEdge(
            [self],
            id,
            edge,
            sourceTime,
            sourceDuration,
            REDACTION.minSeconds,
          );
          controller.updateLive(updateRedaction(controller.scene, id, range));
        }
      }
      if (phase === "end") controller.endInteract();
    },
    [controller, sourceDuration],
  );

  return {
    visibleRedactions,
    windowAt,
    add,
    remove,
    commitPatch,
    begin: controller.beginInteract,
    livePatch,
    end: controller.endInteract,
    edgeDrag,
  };
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/privacy/use-redaction-editing.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { initialScene } from "../scene";
import { toLayout } from "../timeline";
import { useVideoScene } from "../use-video-scene";
import { useRedactionEditing } from "./use-redaction-editing";

const RECT = { x: 0.1, y: 0.1, w: 0.3, h: 0.1 };

function setup() {
  return renderHook(() => {
    const controller = useVideoScene(initialScene(20));
    const redactions = useRedactionEditing({
      controller,
      layout: toLayout(controller.scene.items),
      sourceDuration: 20,
    });
    return { controller, redactions };
  });
}

describe("useRedactionEditing", () => {
  it("adds a 5 s region at the playhead as one undo step", () => {
    const { result } = setup();
    act(() => {
      result.current.redactions.add("blur", RECT, 3);
    });
    expect(result.current.controller.scene.redactions[0]).toMatchObject({
      kind: "blur",
      start: 3,
      end: 8,
    });
    act(() => result.current.controller.undo());
    expect(result.current.controller.scene.redactions).toEqual([]);
  });

  it("near the end the window still has the minimum length", () => {
    const { result } = setup();
    expect(result.current.redactions.windowAt(19.8)).toEqual({ start: 19, end: 20 });
  });

  it("refuses slivers", () => {
    const { result } = setup();
    let r: ReturnType<typeof result.current.redactions.add> | undefined;
    act(() => {
      r = result.current.redactions.add("cover", { x: 0, y: 0, w: 0.001, h: 0.5 }, 1);
    });
    expect(r).toEqual({ ok: false, reason: "too-small" });
  });

  it("an intensity drag is one undo step and never goes below 40", () => {
    const { result } = setup();
    act(() => {
      result.current.redactions.add("blur", RECT, 1);
    });
    const id = result.current.controller.scene.redactions[0].id;
    act(() => result.current.redactions.begin());
    act(() => result.current.redactions.livePatch(id, { intensity: 10 }));
    act(() => result.current.redactions.end());
    expect(result.current.controller.scene.redactions[0]).toMatchObject({ intensity: 40 });
    act(() => result.current.controller.undo());
    expect(result.current.controller.scene.redactions[0]).toMatchObject({ intensity: 70 });
  });
});
```

### Task 3 — preview layer (underlay)

`backdrop-filter` blurs whatever is behind the element — here the `<video>` — in the
element's own (camera-transformed) space, so the blur zooms with the footage exactly as
the export's pre-crop blur does. Pixelate redraws a tiny canvas from the video per frame
and lets CSS upscale it `pixelated`, with the same cell size the export uses.

One deliberate asymmetry between the two: `backdrop-filter`'s sigma is a **displayed**-pixel
length, so it takes the displayed frame height, and so does the cover label's `font-size`.
`drawPixelated`, in contrast, works entirely in **source** pixels (`video.videoWidth/Height`)
— the cell grid then lands on exactly the same content pixels the export's mosaic uses, and
CSS scales the result to whatever size the preview happens to be.

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/redaction-layer.tsx`**

```tsx
/**
 * Privacy regions in the preview. Rendered in PreviewStage's `underlay` slot — inside the
 * camera-transformed content layer and under the annotations — so they stay glued to the
 * footage when the camera zooms (UI spec § 4.1, "non-negotiable").
 *
 * Visibility is decided per video frame from SOURCE time (useVideoFrameClock), padded by
 * PREVIEW_PAD_SECONDS on both sides so the preview never shows a secret the export hides.
 *
 * Strength parity with the export comes from redaction.ts: every size is a fraction of the
 * frame height. Which height depends on the unit: the blur sigma (`backdrop-filter`) and
 * the cover label's font-size are DISPLAYED-pixel lengths, so they take the displayed frame
 * height; the pixelate canvas is computed in SOURCE px (drawPixelated) so its cell grid is
 * identical to the export's mosaic, and CSS upscales it to whatever the preview's size is.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useVideoFrameClock } from "../use-video-frame-clock";
import {
  blurSigmaPx,
  coverLabelColor,
  coverLabelPx,
  pixelBlockPx,
  rectToPx,
  type Redaction,
} from "../privacy/redaction";
import styles from "./redaction-layer.module.css";

const PREVIEW_PAD_SECONDS = 0.05;

export function rectStyle(rect: Redaction["rect"]): React.CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}

/**
 * Downscale the region of the current video frame into `canvas` (cells, sized in SOURCE px
 * so the grid matches the export's mosaic exactly); CSS upscales it `pixelated`.
 */
function drawPixelated(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement,
  r: Redaction,
): void {
  if (!canvas || r.kind !== "blur") return;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) return;
  const px = rectToPx(r.rect, vw, vh);
  if (px.w === 0 || px.h === 0) return;
  const cell = pixelBlockPx(r.intensity, vh);
  const cols = Math.max(1, Math.ceil(px.w / cell));
  const rows = Math.max(1, Math.ceil(px.h / cell));
  if (canvas.width !== cols) canvas.width = cols;
  if (canvas.height !== rows) canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true; // averaging on the way down = the mosaic colors
  ctx.drawImage(video, px.x, px.y, px.w, px.h, 0, 0, cols, rows);
}

export function RedactionView({
  redaction,
  frameHeightPx,
}: {
  redaction: Redaction;
  /** Layout height of the displayed frame, px (untransformed). */
  frameHeightPx: number;
}): React.JSX.Element {
  const base = rectStyle(redaction.rect);
  if (redaction.kind === "cover") {
    return (
      <div
        data-redaction-id={redaction.id}
        className={styles.cover}
        style={{ ...base, background: redaction.fill }}
      >
        {redaction.label && (
          <span
            className={styles.label}
            style={{
              fontSize: `${coverLabelPx(frameHeightPx)}px`,
              color: coverLabelColor(redaction.fill),
            }}
          >
            {redaction.label}
          </span>
        )}
      </div>
    );
  }
  if (redaction.style === "pixelate") {
    return (
      <div data-redaction-id={redaction.id} className={styles.region} style={base}>
        <canvas className={styles.pixels} />
      </div>
    );
  }
  return (
    <div
      data-redaction-id={redaction.id}
      className={styles.region}
      style={{
        ...base,
        backdropFilter: `blur(${blurSigmaPx(redaction.intensity, frameHeightPx)}px)`,
      }}
    />
  );
}

export function RedactionLayer({
  redactions,
  videoRef,
  hidden,
}: {
  /** Only regions visible on the timeline (use-redaction-editing's visibleRedactions). */
  redactions: Redaction[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Hold-to-compare or a slide: render nothing. */
  hidden: boolean;
}): React.JSX.Element {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [heightPx, setHeightPx] = useState(0);

  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const measure = (): void => setHeightPx(el.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  const trigger = useMemo(() => ({ redactions, hidden }), [redactions, hidden]);
  useVideoFrameClock(
    videoRef,
    (t) => {
      const layer = layerRef.current;
      const video = videoRef.current;
      if (!layer || !video) return;
      for (const r of redactions) {
        const el = layer.querySelector<HTMLElement>(`[data-redaction-id="${r.id}"]`);
        if (!el) continue;
        const on =
          !hidden && t >= r.start - PREVIEW_PAD_SECONDS && t <= r.end + PREVIEW_PAD_SECONDS;
        el.style.display = on ? "" : "none";
        if (on && r.kind === "blur" && r.style === "pixelate") {
          drawPixelated(el.querySelector("canvas"), video, r);
        }
      }
    },
    trigger,
  );

  return (
    <div ref={layerRef} className={styles.layer} aria-hidden data-testid="redaction-layer">
      {redactions.map((r) => (
        <RedactionView key={r.id} redaction={r} frameHeightPx={heightPx} />
      ))}
    </div>
  );
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/redaction-layer.module.css`**

```css
/* Covers the content layer exactly (same box as the video), never takes pointer input —
   selection/editing of regions happens in the stage chrome (region-editor). */
.layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.region,
.cover {
  position: absolute;
  overflow: hidden;
}

.cover {
  display: flex;
  align-items: center;
  justify-content: center;
}

.label {
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 4px;
}

.pixels {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
```

### Task 4 — drawing and editing (chrome)

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/region-drawer.tsx`**

```tsx
/**
 * Drawing a privacy region (UI spec § 4.4). Active while the Blur or Cover tool is on.
 * Lives in the stage chrome over the UNZOOMED frame (the camera is off while a privacy
 * tool is active), so stage-normalized pointer coordinates ARE original-frame coordinates.
 * Shows marching ants, a size badge in SOURCE pixels, a range badge, a live effect; the
 * page mirrors the draft as a ghost block on the Privacy lane via onDraft.
 */
import { useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import {
  blurSigmaPx,
  type NormRect,
  rectFromDrag,
  rectToPx,
  REDACTION,
} from "../privacy/redaction";
import { rectStyle } from "./redaction-layer";
import styles from "./region-drawer.module.css";

export function RegionDrawer({
  kind,
  videoRef,
  range,
  onDraft,
  onCreate,
}: {
  kind: "blur" | "cover";
  /** The preview video — its native size feeds the size badge (source pixels). */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Formatted source window the region will get ("0:12.0" → "0:17.0"); null over a slide. */
  range: { from: string; to: string } | null;
  onDraft(rect: NormRect | null): void;
  onCreate(rect: NormRect): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const surface = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<NormRect | null>(null);
  const [surfaceHeight, setSurfaceHeight] = useState(0);

  const norm = (event: React.PointerEvent): { x: number; y: number } => {
    const r = surface.current!.getBoundingClientRect();
    return { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height };
  };

  const video = videoRef.current;
  const px = rect && video ? rectToPx(rect, video.videoWidth, video.videoHeight) : null;

  return (
    <div
      ref={surface}
      className={styles.surface}
      data-testid="region-drawer"
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!surface.current) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        start.current = norm(event);
        setSurfaceHeight(surface.current.clientHeight);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        const p = norm(event);
        const next = rectFromDrag(start.current.x, start.current.y, p.x, p.y);
        setRect(next);
        onDraft(next);
      }}
      onPointerUp={() => {
        const drawn = rect;
        start.current = null;
        setRect(null);
        onDraft(null);
        if (drawn && drawn.w >= REDACTION.minSize && drawn.h >= REDACTION.minSize) onCreate(drawn);
      }}
    >
      {rect && px && (
        <div
          className={kind === "cover" ? `${styles.draft} ${styles.draftCover}` : styles.draft}
          style={{
            ...rectStyle(rect),
            ...(kind === "blur"
              ? {
                  backdropFilter: `blur(${blurSigmaPx(REDACTION.defaultIntensity, surfaceHeight)}px)`,
                }
              : {}),
          }}
        >
          <svg className={styles.ants} width="100%" height="100%" aria-hidden>
            <rect x="0" y="0" width="100%" height="100%" />
          </svg>
          <span className={styles.sizeBadge}>
            {t("drawSizeBadge", {
              w: px.w,
              h: px.h,
              kind: kind === "blur" ? t("blurBadge") : t("coverBadge"),
            })}
          </span>
          {range && (
            <span className={styles.rangeBadge}>
              {t("drawRangeBadge", { from: range.from, to: range.to })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/region-drawer.module.css`**

```css
.surface {
  position: absolute;
  inset: 0;
  z-index: 4;
  cursor: crosshair;
  touch-action: none;
}

.draft {
  position: absolute;
  pointer-events: none;
}

.draftCover {
  background: color-mix(in srgb, #18181b 85%, transparent);
}

/* Marching ants: UI spec stroke-dasharray 8 8, animated. */
.ants {
  position: absolute;
  inset: 0;
  overflow: visible;
}

.ants rect {
  fill: none;
  stroke: var(--accent-primary);
  stroke-width: 1.5;
  stroke-dasharray: 8 8;
  animation: march 0.6s linear infinite;
}

@keyframes march {
  to {
    stroke-dashoffset: -16;
  }
}

.sizeBadge,
.rangeBadge {
  position: absolute;
  left: 0;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: rgba(8, 8, 10, 0.85);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
}

.sizeBadge {
  top: -20px;
}

.rangeBadge {
  bottom: -20px;
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/region-editor.tsx`**

```tsx
/**
 * Move / resize the SELECTED privacy region (UI spec § 4.3: 1.5 px accent border + four
 * white corner handles). Stage chrome over the unzoomed frame, like region-drawer: the
 * camera is off while a region is selected, so stage-normalized = original-frame coords.
 * Same begin → change… → end contract as every continuous edit (doc 07).
 */
import { useRef } from "react";
import { type Corner, moveRect, resizeRect } from "../privacy/region-geometry";
import type { NormRect } from "../privacy/redaction";
import { rectStyle } from "./redaction-layer";
import styles from "./region-editor.module.css";

const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

type Drag = { mode: "move"; from: { x: number; y: number }; orig: NormRect } | { mode: Corner };

export function RegionEditor({
  rect,
  onBegin,
  onChange,
  onEnd,
}: {
  rect: NormRect;
  onBegin(): void;
  onChange(rect: NormRect): void;
  onEnd(): void;
}): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);

  const norm = (event: React.PointerEvent): { x: number; y: number } | null => {
    const stage = boxRef.current?.parentElement?.getBoundingClientRect();
    if (!stage || stage.width === 0 || stage.height === 0) return null;
    return {
      x: (event.clientX - stage.left) / stage.width,
      y: (event.clientY - stage.top) / stage.height,
    };
  };

  const begin = (event: React.PointerEvent, next: Drag): void => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = next;
    onBegin();
  };

  const move = (event: React.PointerEvent): void => {
    const d = drag.current;
    const p = norm(event);
    if (!d || !p) return;
    if (d.mode === "move") onChange(moveRect(d.orig, p.x - d.from.x, p.y - d.from.y));
    else onChange(resizeRect(rect, d.mode, p));
  };

  const end = (): void => {
    if (!drag.current) return;
    drag.current = null;
    onEnd();
  };

  return (
    <div
      ref={boxRef}
      className={styles.box}
      style={rectStyle(rect)}
      data-testid="region-editor"
      onPointerDown={(event) => {
        const p = norm(event);
        if (p) begin(event, { mode: "move", from: p, orig: rect });
      }}
      onPointerMove={move}
      onPointerUp={end}
    >
      {CORNERS.map((corner) => (
        <span
          key={corner}
          className={`${styles.handle} ${styles[corner]}`}
          data-region-handle={corner}
          onPointerDown={(event) => begin(event, { mode: corner })}
          onPointerMove={move}
          onPointerUp={end}
        />
      ))}
    </div>
  );
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/region-editor.module.css`**

```css
.box {
  position: absolute;
  z-index: 4;
  border: 1.5px solid var(--accent-primary);
  cursor: move;
  touch-action: none;
}

.handle {
  position: absolute;
  width: 9px;
  height: 9px;
  border: 1px solid var(--accent-primary);
  border-radius: 2px;
  background: #fff;
  touch-action: none;
}

.nw {
  top: -5px;
  left: -5px;
  cursor: nwse-resize;
}

.ne {
  top: -5px;
  right: -5px;
  cursor: nesw-resize;
}

.sw {
  bottom: -5px;
  left: -5px;
  cursor: nesw-resize;
}

.se {
  bottom: -5px;
  right: -5px;
  cursor: nwse-resize;
}
```

### Task 5 — Privacy lane

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/privacy-lane.tsx`**

```tsx
/**
 * Privacy lane (UI spec § 6.4) — one block per visible piece of each blur/cover region,
 * same selection and edge-drag contract as the Zooms lane. While a region is being drawn
 * the page passes `ghost` and a dashed "NEW BLUR / NEW COVER" block shows its window.
 */
import { useRef } from "react";
import { Droplet, RectangleHorizontal } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { Redaction } from "../privacy/redaction";
import { sourceRangeToTimelineBlocks, sourceTimeAtTimeline } from "../source-time";
import { type LayoutEntry, layoutDuration } from "../timeline";
import { fractionToTime, timeToFraction } from "./timeline-geometry";
import type { EdgePhase } from "./zoom-lane";
import styles from "./privacy-lane.module.css";

export interface PrivacyLaneProps {
  redactions: Redaction[];
  layout: LayoutEntry[];
  selectedId: string | null;
  onSelect(id: string): void;
  onEdgeDrag(id: string, edge: "start" | "end", sourceTime: number | null, phase: EdgePhase): void;
  ghost: { kind: "blur" | "cover"; start: number; end: number } | null;
}

export function PrivacyLane({
  redactions,
  layout,
  selectedId,
  onSelect,
  onEdgeDrag,
  ghost,
}: PrivacyLaneProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragEdge = useRef<{ id: string; edge: "start" | "end" } | null>(null);
  const duration = layoutDuration(layout);
  const pos = (start: number, end: number): React.CSSProperties => ({
    left: `${timeToFraction(start, duration) * 100}%`,
    width: `${timeToFraction(end - start, duration) * 100}%`,
  });

  const sourceFromPointer = (clientX: number): number | null => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return sourceTimeAtTimeline(
      layout,
      fractionToTime((clientX - rect.left) / rect.width, duration),
    );
  };

  const handle = (r: Redaction, edge: "start" | "end", timelineAt: number) => (
    <div
      key={`${r.id}-${edge}`}
      className={styles.handle}
      style={{ left: `calc(${timeToFraction(timelineAt, duration) * 100}% - 3px)` }}
      data-privacy-handle={edge}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragEdge.current = { id: r.id, edge };
        onEdgeDrag(r.id, edge, edge === "start" ? r.start : r.end, "start");
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        const drag = dragEdge.current;
        if (!drag || drag.id !== r.id || drag.edge !== edge) return;
        onEdgeDrag(r.id, edge, sourceFromPointer(event.clientX), "move");
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        if (!dragEdge.current) return;
        dragEdge.current = null;
        onEdgeDrag(r.id, edge, null, "end");
      }}
    />
  );

  return (
    <div ref={laneRef} className={styles.lane} data-testid="privacy-lane">
      {redactions.flatMap((r) => {
        const blocks = sourceRangeToTimelineBlocks(layout, r.start, r.end);
        const selected = r.id === selectedId;
        const Icon = r.kind === "blur" ? Droplet : RectangleHorizontal;
        const label = r.kind === "blur" ? t("blurBadge") : r.label || t("coverBadge");
        const nodes = blocks.map((block, i) => (
          <button
            key={`${r.id}-${i}`}
            type="button"
            data-redaction-block={r.id}
            className={[
              styles.block,
              r.kind === "blur" ? styles.blur : styles.cover,
              selected && styles.selected,
            ]
              .filter(Boolean)
              .join(" ")}
            style={pos(block.timelineStart, block.timelineEnd)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(r.id);
            }}
          >
            <Icon size={10} />
            <span className={styles.text}>{label}</span>
          </button>
        ));
        if (selected && blocks.length > 0) {
          const first = blocks[0];
          const last = blocks[blocks.length - 1];
          if (first.sourceStart === r.start) nodes.push(handle(r, "start", first.timelineStart));
          if (last.sourceEnd === r.end) nodes.push(handle(r, "end", last.timelineEnd));
        }
        return nodes;
      })}
      {ghost &&
        sourceRangeToTimelineBlocks(layout, ghost.start, ghost.end).map((block, i) => (
          <span
            key={`ghost-${i}`}
            className={styles.ghost}
            style={pos(block.timelineStart, block.timelineEnd)}
          >
            {ghost.kind === "blur" ? t("ghostBlur") : t("ghostCover")}
          </span>
        ))}
    </div>
  );
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/privacy-lane.module.css`**

```css
.lane {
  position: relative;
  height: 38px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
}

.block,
.ghost {
  position: absolute;
  top: 3px;
  bottom: 3px;
  min-width: 10px;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 5px;
  overflow: hidden;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.block {
  border: 1px solid transparent;
  cursor: pointer;
}

/* UI spec § 6.4: blur = translucent blue #58a6ff, cover = light neutral. */
.blur {
  background: color-mix(in srgb, #58a6ff 22%, transparent);
  color: #58a6ff;
}

.cover {
  background: color-mix(in srgb, var(--text-primary) 14%, transparent);
  color: var(--text-primary);
}

.selected {
  border-color: var(--accent-primary);
  z-index: 1;
}

.text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.ghost {
  border: 1px dashed var(--accent-primary);
  color: var(--accent-primary);
  pointer-events: none;
}

.handle {
  position: absolute;
  top: 0;
  width: 6px;
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--accent-primary);
  cursor: ew-resize;
  touch-action: none;
  z-index: 2;
}
```

### Task 6 — inspectors

They reuse `inspector.module.css` from PR 6 (`badgeBlur`, `noteInfo`, `swatches`,
`field`, … are already there).

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/blur-inspector.tsx`**

```tsx
/** Inspector for a selected blur region (UI spec § 7.2). */
import { Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { RedactionEditing } from "../../privacy/use-redaction-editing";
import { type BlurRedaction, REDACTION } from "../../privacy/redaction";
import { HistorySlider } from "../history-slider";
import { formatPrecise } from "./format";
import styles from "./inspector.module.css";

export function BlurInspector({
  redaction,
  range,
  edits,
  onRemoved,
}: {
  redaction: BlurRedaction;
  /** Timeline range of the region's visible pieces. */
  range: { from: number; to: number };
  edits: RedactionEditing;
  onRemoved(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  return (
    <section className={styles.panel} aria-label={t("blurTitle")}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("blurTitle")}</h2>
        <span className={styles.badgeBlur}>{t("blurBadge")}</span>
      </header>
      <p className={styles.range}>
        {formatPrecise(range.from)} → {formatPrecise(range.to)}
      </p>
      <HistorySlider
        label={t("blurIntensity")}
        value={redaction.intensity}
        min={REDACTION.minIntensity}
        max={100}
        step={1}
        note={t("blurIntensityNote")}
        onBegin={edits.begin}
        onLive={(intensity) => edits.livePatch(redaction.id, { intensity })}
        onEnd={edits.end}
        onCommit={(intensity) => edits.commitPatch(redaction.id, { intensity })}
      />
      <div className={styles.segmented} role="group" aria-label={t("blurStyle")}>
        {(["gaussian", "pixelate"] as const).map((style) => (
          <button
            key={style}
            type="button"
            aria-pressed={redaction.style === style}
            className={redaction.style === style ? styles.segmentActive : styles.segment}
            onClick={() => edits.commitPatch(redaction.id, { style })}
          >
            {style === "gaussian" ? t("blurGaussian") : t("blurPixelate")}
          </button>
        ))}
      </div>
      <p className={styles.note}>{t("blurSecretNote")}</p>
      <p className={styles.noteInfo}>{t("privacyPinnedNote")}</p>
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => {
          edits.remove(redaction.id);
          onRemoved();
        }}
      >
        <Trash2 size={14} />
        {t("removeRegion")}
      </button>
    </section>
  );
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/cover-inspector.tsx`**

```tsx
/** Inspector for a selected cover region (UI spec § 7.3). */
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { RedactionEditing } from "../../privacy/use-redaction-editing";
import { type CoverRedaction, REDACTION } from "../../privacy/redaction";
import { formatPrecise } from "./format";
import styles from "./inspector.module.css";

export function CoverInspector({
  redaction,
  range,
  edits,
  onRemoved,
}: {
  redaction: CoverRedaction;
  range: { from: number; to: number };
  edits: RedactionEditing;
  onRemoved(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  // The label is edited locally and committed once (blur / Enter) — one undo step per edit,
  // not one per keystroke.
  const [label, setLabel] = useState(redaction.label);
  useEffect(() => setLabel(redaction.label), [redaction.id, redaction.label]);
  const commitLabel = (): void => {
    if (label !== redaction.label) edits.commitPatch(redaction.id, { label });
  };

  return (
    <section className={styles.panel} aria-label={t("coverTitle")}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("coverTitle")}</h2>
        <span className={styles.badge}>{t("coverBadge")}</span>
      </header>
      <p className={styles.range}>
        {formatPrecise(range.from)} → {formatPrecise(range.to)}
      </p>
      <div className={styles.field}>
        <span>{t("coverFill")}</span>
        <div className={styles.swatches}>
          {REDACTION.coverFills.map((fill) => (
            <button
              key={fill}
              type="button"
              aria-label={fill}
              aria-pressed={redaction.fill === fill}
              className={redaction.fill === fill ? styles.swatchActive : styles.swatch}
              style={{ background: fill }}
              onClick={() => edits.commitPatch(redaction.id, { fill })}
            />
          ))}
        </div>
      </div>
      <label className={styles.field}>
        <span>{t("coverLabel")}</span>
        <input
          className={styles.fieldInput}
          value={label}
          maxLength={60}
          placeholder={t("coverLabelPlaceholder")}
          onChange={(event) => setLabel(event.currentTarget.value)}
          onBlur={commitLabel}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </label>
      <p className={styles.note}>{t("coverBurnNote")}</p>
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => {
          edits.remove(redaction.id);
          onRemoved();
        }}
      >
        <Trash2 size={14} />
        {t("removeRegion")}
      </button>
    </section>
  );
}
```

### Task 7 — component tests

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/privacy-components.test.tsx`**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BlurRedaction, CoverRedaction } from "../privacy/redaction";
import type { RedactionEditing } from "../privacy/use-redaction-editing";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import { BlurInspector } from "./inspector/blur-inspector";
import { CoverInspector } from "./inspector/cover-inspector";
import { PrivacyLane } from "./privacy-lane";
import { RedactionLayer } from "./redaction-layer";
import { RegionDrawer } from "./region-drawer";
import { RegionEditor } from "./region-editor";

const layout = toLayout([
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 5 },
  { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 20 },
] as TrackItem[]);

const BLUR: BlurRedaction = {
  id: "b1",
  kind: "blur",
  start: 1,
  end: 3,
  rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
  intensity: 70,
  style: "gaussian",
};
const COVER: CoverRedaction = {
  id: "c1",
  kind: "cover",
  start: 4,
  end: 12,
  rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
  fill: "#18181b",
  label: "API key",
};

function rect(el: Element, width: number, height: number): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function videoAt(t: number): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "currentTime", { value: t, writable: true });
  return video;
}

function edits(partial: Partial<RedactionEditing> = {}): RedactionEditing {
  return {
    visibleRedactions: [],
    windowAt: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    commitPatch: vi.fn(),
    begin: vi.fn(),
    livePatch: vi.fn(),
    end: vi.fn(),
    edgeDrag: vi.fn(),
    ...partial,
  };
}

describe("PrivacyLane", () => {
  it("splits a cover across a cut, labels it, and shows the ghost", () => {
    const { container } = render(
      <PrivacyLane
        redactions={[BLUR, COVER]}
        layout={layout}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
        ghost={{ kind: "blur", start: 12, end: 14 }}
      />,
    );
    expect(container.querySelectorAll('[data-redaction-block="c1"]')).toHaveLength(2);
    expect(screen.getAllByText("API key")).toHaveLength(2);
    expect(screen.getByText("BLUR")).toBeInTheDocument();
    expect(screen.getByText("NEW BLUR")).toBeInTheDocument();
  });
});

describe("RedactionLayer", () => {
  it("shows a region only while the source time is inside its window", () => {
    const video = videoAt(2);
    const { container } = render(
      <RedactionLayer redactions={[BLUR]} videoRef={{ current: video }} hidden={false} />,
    );
    const el = container.querySelector('[data-redaction-id="b1"]') as HTMLElement;
    expect(el.style.display).toBe("");
    video.currentTime = 3.2;
    video.dispatchEvent(new Event("seeked"));
    expect(el.style.display).toBe("none");
  });
  it("hides everything while the original is held", () => {
    const { container } = render(
      <RedactionLayer redactions={[BLUR]} videoRef={{ current: videoAt(2) }} hidden />,
    );
    expect((container.querySelector('[data-redaction-id="b1"]') as HTMLElement).style.display).toBe(
      "none",
    );
  });
  it("renders a cover with its fill and label", () => {
    render(
      <RedactionLayer redactions={[COVER]} videoRef={{ current: videoAt(4.5) }} hidden={false} />,
    );
    expect(screen.getByText("API key")).toBeInTheDocument();
  });
});

describe("RegionDrawer", () => {
  it("draws, shows the badges, and creates on release", () => {
    const onCreate = vi.fn();
    const onDraft = vi.fn();
    const video = videoAt(1);
    Object.defineProperty(video, "videoWidth", { value: 2000 });
    Object.defineProperty(video, "videoHeight", { value: 1000 });
    render(
      <RegionDrawer
        kind="blur"
        videoRef={{ current: video }}
        range={{ from: "0:12.0", to: "0:17.0" }}
        onDraft={onDraft}
        onCreate={onCreate}
      />,
    );
    const surface = screen.getByTestId("region-drawer");
    rect(surface, 1000, 500);
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 700, clientY: 150 });
    expect(screen.getByText("1200 × 100 · BLUR")).toBeInTheDocument();
    expect(screen.getByText("RELEASE TO ADD · 0:12.0 → 0:17.0")).toBeInTheDocument();
    fireEvent.pointerUp(surface, { pointerId: 1 });
    const created = onCreate.mock.calls[0][0];
    expect(created.x).toBeCloseTo(0.1, 9);
    expect(created.y).toBeCloseTo(0.2, 9);
    expect(created.w).toBeCloseTo(0.6, 9);
    expect(created.h).toBeCloseTo(0.1, 9);
    expect(onDraft).toHaveBeenLastCalledWith(null);
  });
  it("ignores a click without a drag", () => {
    const onCreate = vi.fn();
    render(
      <RegionDrawer
        kind="cover"
        videoRef={{ current: videoAt(1) }}
        range={null}
        onDraft={vi.fn()}
        onCreate={onCreate}
      />,
    );
    const surface = screen.getByTestId("region-drawer");
    rect(surface, 1000, 500);
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("RegionEditor", () => {
  it("moves the region as one gesture", () => {
    const onBegin = vi.fn();
    const onChange = vi.fn();
    const onEnd = vi.fn();
    const { container } = render(
      <div>
        <RegionEditor rect={BLUR.rect} onBegin={onBegin} onChange={onChange} onEnd={onEnd} />
      </div>,
    );
    rect(container.firstElementChild!, 1000, 500);
    const box = screen.getByTestId("region-editor");
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 200, clientY: 125 });
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 300, clientY: 125 });
    fireEvent.pointerUp(box, { pointerId: 1 });
    expect(onBegin).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls.at(-1)![0].x).toBeCloseTo(0.2, 9);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
  it("resizes from a corner", () => {
    const onChange = vi.fn();
    const { container } = render(
      <div>
        <RegionEditor rect={BLUR.rect} onBegin={vi.fn()} onChange={onChange} onEnd={vi.fn()} />
      </div>,
    );
    rect(container.firstElementChild!, 1000, 500);
    const handle = container.querySelector('[data-region-handle="se"]')!;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400, clientY: 150 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600, clientY: 250 });
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.w).toBeCloseTo(0.5, 9);
    expect(next.h).toBeCloseTo(0.3, 9);
  });
});

describe("Blur / Cover inspectors", () => {
  it("blur: switches style with a commit and removes", () => {
    const e = edits();
    const onRemoved = vi.fn();
    render(
      <BlurInspector redaction={BLUR} range={{ from: 1, to: 3 }} edits={e} onRemoved={onRemoved} />,
    );
    expect(screen.getByText(/Minimum 40/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pixelate" }));
    expect(e.commitPatch).toHaveBeenCalledWith("b1", { style: "pixelate" });
    fireEvent.click(screen.getByRole("button", { name: /Remove region/ }));
    expect(e.remove).toHaveBeenCalledWith("b1");
    expect(onRemoved).toHaveBeenCalled();
  });
  it("blur: the slider cannot go below 40", () => {
    render(
      <BlurInspector
        redaction={BLUR}
        range={{ from: 1, to: 3 }}
        edits={edits()}
        onRemoved={vi.fn()}
      />,
    );
    expect(screen.getByRole("slider")).toHaveAttribute("min", "40");
  });
  it("cover: picks a fill and commits the label once on Enter", () => {
    const e = edits();
    render(
      <CoverInspector
        redaction={COVER}
        range={{ from: 4, to: 12 }}
        edits={e}
        onRemoved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "#F6055C" }));
    expect(e.commitPatch).toHaveBeenCalledWith("c1", { fill: "#F6055C" });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Token" } });
    fireEvent.change(input, { target: { value: "Token hidden" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(e.commitPatch).toHaveBeenCalledWith("c1", { label: "Token hidden" });
    expect(
      (e.commitPatch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => "label" in c[1]),
    ).toHaveLength(1);
  });
});
```

### Task 8 — tools and toolbar

`PRIVACY_TOOLS` is kept separate from `VIDEO_TOOLS` so the annotation layer and its
`Record<VideoTool, …>` maps never see them; the page passes `"select"` to the annotation
layer while a privacy tool is active.

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-tools.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-tools.ts
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-tools.ts
@@ -14,6 +14,17 @@
 export const VIDEO_TOOLS = ["select", "box", "arrow", "text"] as const;
 export type VideoTool = (typeof VIDEO_TOOLS)[number];

+/** Privacy drawing modes (video-editor v2). Separate from VIDEO_TOOLS: the annotation
+ *  layer never sees them (it gets "select" while one is active). */
+export const PRIVACY_TOOLS = ["blur", "cover"] as const;
+export type PrivacyTool = (typeof PRIVACY_TOOLS)[number];
+
+export type EditorTool = VideoTool | PrivacyTool;
+
+export function isPrivacyTool(tool: EditorTool): tool is PrivacyTool {
+  return tool === "blur" || tool === "cover";
+}
+
 /**
  * Default visibility-window length (seconds) for a freshly drawn overlay — long
  * enough to read a label/box without scrubbing, short enough not to blanket the
@@ -22,7 +33,7 @@
 export const DEFAULT_OVERLAY_SECONDS = 3;

 export interface VideoToolState {
-  tool: VideoTool;
+  tool: EditorTool;
   /** Selected drawing colour (hex) — see ANNOTATION_COLORS. */
   color: string;
   /** Stroke level — an index into STROKE_WIDTHS (0–2). */
@@ -32,7 +43,7 @@
 }

 export interface VideoToolsController extends VideoToolState {
-  setTool(tool: VideoTool): void;
+  setTool(tool: EditorTool): void;
   setColor(color: string): void;
   setStroke(level: number): void;
   setTextSize(level: number): void;
@@ -40,7 +51,7 @@

 /** Toolbar state for the video-editor annotation tools. */
 export function useVideoTools(): VideoToolsController {
-  const [tool, setTool] = useState<VideoTool>("select");
+  const [tool, setTool] = useState<EditorTool>("select");
   const [color, setColor] = useState<string>(ANNOTATION_COLORS[0].value);
   const [stroke, setStroke] = useState<number>(1);
   const [textSize, setTextSize] = useState<number>(1);
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.tsx
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.tsx
@@ -2,18 +2,26 @@
 import {
   ArrowUpRight,
   Download,
+  Droplet,
   ImagePlus,
   MousePointer2,
   Redo2,
   Scissors,
   Square,
+  RectangleHorizontal,
   Trash2,
   Type,
   Undo2,
   ZoomIn,
 } from "lucide-react";
 import { useTranslations } from "@kaipu/i18n";
-import { VIDEO_TOOLS, type VideoTool } from "../annotations/video-tools";
+import {
+  type EditorTool,
+  PRIVACY_TOOLS,
+  type PrivacyTool,
+  VIDEO_TOOLS,
+  type VideoTool,
+} from "../annotations/video-tools";
 import styles from "./editor-toolbar.module.css";

 /** Accepted image types for the "Add image" tool — matches SlideAssetStore's decode path. */
@@ -21,16 +29,27 @@

 type ToolLabelKey = "toolSelect" | "toolBox" | "toolArrow" | "toolText";

-type HintKey = "hintSelect" | "hintBox" | "hintArrow" | "hintText";
+type HintKey = "hintSelect" | "hintBox" | "hintArrow" | "hintText" | "hintBlur" | "hintCover";

 /** Contextual one-line hint per active tool (UI spec § 3.2). */
-const TOOL_HINT: Record<VideoTool, HintKey> = {
+const TOOL_HINT: Record<EditorTool, HintKey> = {
   select: "hintSelect",
   box: "hintBox",
   arrow: "hintArrow",
   text: "hintText",
+  blur: "hintBlur",
+  cover: "hintCover",
 };

+/** Blur uses the screenshot editor's Droplet on purpose (UI spec § 3.1: same icon, same behavior). */
+const PRIVACY_META: Record<
+  PrivacyTool,
+  { labelKey: "toolBlur" | "toolCover"; Icon: typeof Square }
+> = {
+  blur: { labelKey: "toolBlur", Icon: Droplet },
+  cover: { labelKey: "toolCover", Icon: RectangleHorizontal },
+};
+
 const TOOL_META: Record<VideoTool, { labelKey: ToolLabelKey; Icon: typeof Square }> = {
   select: { labelKey: "toolSelect", Icon: MousePointer2 },
   box: { labelKey: "toolBox", Icon: Square },
@@ -51,11 +70,13 @@
   deleteDisabled: boolean;
   /** Insert an image slide at the playhead's nearest item boundary. */
   onAddImage(file: File): void;
-  /** Current annotation tool. */
-  tool: VideoTool;
-  onToolChange(tool: VideoTool): void;
+  /** Current tool (annotation or privacy). */
+  tool: EditorTool;
+  onToolChange(tool: EditorTool): void;
   /** Add a zoom at the playhead, or select the one already there (video-editor v2). */
   onAddZoom(): void;
+  /** Blur/Cover need footage: disabled while the playhead is on a slide. */
+  privacyDisabled: boolean;
   /** Run the export pipeline. Disabled while exporting or when the timeline is empty. */
   onExport(): void;
   exportDisabled: boolean;
@@ -80,6 +101,7 @@
   tool,
   onToolChange,
   onAddZoom,
+  privacyDisabled,
   onExport,
   exportDisabled,
 }: EditorToolbarProps): React.JSX.Element {
@@ -119,6 +141,24 @@
         >
           <ZoomIn size={19} />
         </button>
+        {PRIVACY_TOOLS.map((toolKey) => {
+          const { labelKey, Icon } = PRIVACY_META[toolKey];
+          const label = t(labelKey);
+          return (
+            <button
+              key={toolKey}
+              type="button"
+              title={label}
+              aria-label={label}
+              aria-pressed={tool === toolKey}
+              disabled={privacyDisabled}
+              className={`${styles.tool} ${tool === toolKey ? styles.toolActive : ""}`}
+              onClick={() => onToolChange(toolKey)}
+            >
+              <Icon size={19} />
+            </button>
+          );
+        })}
       </div>
       <span className={styles.hint}>{t(TOOL_HINT[tool])}</span>
       <div className={styles.actions}>
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.test.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.test.tsx
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.test.tsx
@@ -16,6 +16,7 @@
     tool: "select",
     onToolChange: vi.fn(),
     onAddZoom: vi.fn(),
+    privacyDisabled: false,
     onExport: vi.fn(),
     exportDisabled: false,
     ...overrides,
@@ -123,3 +124,18 @@
     expect(screen.getByText("Drag on the preview to draw an arrow.")).toBeInTheDocument();
   });
 });
+
+describe("EditorToolbar — v2 privacy tools", () => {
+  it("activates Blur and Cover as tools", () => {
+    const props = renderToolbar();
+    fireEvent.click(screen.getByRole("button", { name: "Blur" }));
+    expect(props.onToolChange).toHaveBeenCalledWith("blur");
+    fireEvent.click(screen.getByRole("button", { name: "Cover" }));
+    expect(props.onToolChange).toHaveBeenCalledWith("cover");
+  });
+
+  it("disables them over a slide", () => {
+    renderToolbar({ privacyDisabled: true });
+    expect(screen.getByRole("button", { name: "Blur" })).toBeDisabled();
+  });
+});
```

### Task 9 — page wiring

On top of PR 7. Adds the editing hook, the privacy tool / selection state, the camera-off
rule (privacy tool active or region selected), `handleToolChange` (a privacy tool clears
the selection), `handleCreateRegion` (create → select → back to Select), region
selection with seek, Delete precedence for regions, the underlay layer, the drawer and
editor in the chrome, the Blur/Cover inspectors, the privacy count and the Privacy lane
with its ghost block.

**Diff — `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx
+++ b/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx
@@ -63,6 +63,19 @@
 import { HoldOriginalButton } from "@renderer/features/video-editor/components/hold-original-button";
 import { useCameraPath } from "@renderer/features/video-editor/zoom/use-camera-path";
 import { useCameraPreview } from "@renderer/features/video-editor/zoom/use-camera-preview";
+import {
+  isPrivacyTool,
+  type EditorTool,
+} from "@renderer/features/video-editor/annotations/video-tools";
+import type { NormRect } from "@renderer/features/video-editor/privacy/redaction";
+import { useRedactionEditing } from "@renderer/features/video-editor/privacy/use-redaction-editing";
+import { RedactionLayer } from "@renderer/features/video-editor/components/redaction-layer";
+import { RegionDrawer } from "@renderer/features/video-editor/components/region-drawer";
+import { RegionEditor } from "@renderer/features/video-editor/components/region-editor";
+import { PrivacyLane } from "@renderer/features/video-editor/components/privacy-lane";
+import { BlurInspector } from "@renderer/features/video-editor/components/inspector/blur-inspector";
+import { CoverInspector } from "@renderer/features/video-editor/components/inspector/cover-inspector";
+import { formatPrecise } from "@renderer/features/video-editor/components/inspector/format";
 import { usePreviewPlayback } from "@renderer/features/video-editor/use-preview-playback";
 import { useSourceThumbnails } from "@renderer/features/video-editor/use-source-thumbnails";
 import { useVideoScene } from "@renderer/features/video-editor/use-video-scene";
@@ -283,6 +296,11 @@
     timelineDuration: playback.duration,
     sourceDuration: source.durationSeconds,
     cursorTrack,
+  });
+  const redactionEdits = useRedactionEditing({
+    controller,
+    layout,
+    sourceDuration: source.durationSeconds,
   });
   // One camera simulation shared by the preview (useCameraPreview) and the export (doc 05).
   // Declared before any callback that closes over it (handleExport).
@@ -635,8 +653,73 @@

   const selectedZoom = selectedZoomId
     ? (zooms.visibleZooms.find((z) => z.id === selectedZoomId) ?? null)
+    : null;
+
+  // Privacy (doc 10). While a privacy tool is active or a region is selected the preview
+  // shows the unzoomed original frame, so drawing/editing maps 1:1 to frame coordinates.
+  const privacyTool = isPrivacyTool(videoTools.tool) ? videoTools.tool : null;
+  const onSlide = playback.activeSlideId !== null;
+  const [draftRegion, setDraftRegion] = useState<NormRect | null>(null);
+  const selectedRedaction = selectedRedactionId
+    ? (redactionEdits.visibleRedactions.find((r) => r.id === selectedRedactionId) ?? null)
     : null;
+  /** Timeline range covered by a source range's visible pieces (inspector + draw badge). */
+  const timelineRangeOf = useCallback(
+    (start: number, end: number): { from: number; to: number } => {
+      const blocks = sourceRangeToTimelineBlocks(layout, start, end);
+      return {
+        from: blocks[0]?.timelineStart ?? 0,
+        to: blocks[blocks.length - 1]?.timelineEnd ?? 0,
+      };
+    },
+    [layout],
+  );
+  const drawWindow = privacyTool ? redactionEdits.windowAt(playback.timelineTime) : null;
+  const drawRange = drawWindow ? timelineRangeOf(drawWindow.start, drawWindow.end) : null;

+  const handleToolChange = useCallback(
+    (tool: EditorTool) => {
+      // Drawing a region starts from a clean slate: no zoom/region box competing with it.
+      if (isPrivacyTool(tool)) clearSelection();
+      videoTools.setTool(tool);
+    },
+    [clearSelection, videoTools],
+  );
+
+  const handleCreateRegion = useCallback(
+    (rect: NormRect) => {
+      if (!privacyTool) return;
+      const result = redactionEdits.add(privacyTool, rect, playback.timelineTime);
+      if (result.ok) {
+        // UI spec § 4.4: on release the region is created, selected, and the tool returns to Select.
+        selectKind("redaction", result.id);
+        videoTools.setTool("select");
+      } else if (result.reason === "on-slide") {
+        showToast({ message: t("privacyNotOnSlide") });
+      }
+    },
+    [privacyTool, redactionEdits, playback.timelineTime, selectKind, videoTools, t],
+  );
+
+  const handleSelectRedaction = useCallback(
+    (id: string) => {
+      selectKind("redaction", id);
+      const r = controller.scene.redactions.find((x) => x.id === id);
+      if (!r) return;
+      const [first] = sourceRangeToTimelineBlocks(layout, r.start, r.end);
+      if (first) playback.seek((first.timelineStart + first.timelineEnd) / 2);
+    },
+    [selectKind, controller, layout, playback],
+  );
+
+  const handleRemoveRedaction = useCallback(
+    (id: string) => {
+      redactionEdits.remove(id);
+      selectKind("redaction", null);
+    },
+    [redactionEdits, selectKind],
+  );
+
   // Preview camera (doc 09). Result view applies the camera; selecting a zoom switches to
   // the zoom-edit view (full frame + camera box); holding "original" shows the raw frame.
   const contentRef = useRef<HTMLDivElement | null>(null);
@@ -645,7 +728,11 @@
     playback.videoRef,
     contentRef,
     cameraPath,
-    !holdingOriginal && selectedZoom === null && playback.activeSlideId === null,
+    !holdingOriginal &&
+      selectedZoom === null &&
+      selectedRedaction === null &&
+      privacyTool === null &&
+      !onSlide,
   );

   useEffect(() => {
@@ -679,7 +766,8 @@
       // Cmd/Ctrl+Backspace is a common "delete line/word" chord in text contexts —
       // require !isMod so it doesn't also delete an overlay or a segment.
       if (!isMod && (e.key === "Delete" || e.key === "Backspace")) {
-        if (selectedZoomId) handleRemoveZoom(selectedZoomId);
+        if (selectedRedactionId) handleRemoveRedaction(selectedRedactionId);
+        else if (selectedZoomId) handleRemoveZoom(selectedZoomId);
         else if (selectedOverlayId) handleDeleteOverlay();
         else if (!deleteDisabled) handleDeleteSelected();
       }
@@ -700,6 +788,8 @@
     clearSelection,
     selectedZoomId,
     handleRemoveZoom,
+    selectedRedactionId,
+    handleRemoveRedaction,
   ]);

   return (
@@ -718,8 +808,9 @@
         deleteDisabled={deleteDisabled}
         onAddImage={handleAddImage}
         tool={videoTools.tool}
-        onToolChange={videoTools.setTool}
+        onToolChange={handleToolChange}
         onAddZoom={handleAddZoom}
+        privacyDisabled={onSlide}
         onExport={handleExport}
         exportDisabled={videoExport.status === "exporting" || scene.items.length === 0}
       />
@@ -749,9 +840,16 @@
               slideUrl={slideUrl}
               expanded={isFullscreen}
               contentRef={contentRef}
+              underlay={
+                <RedactionLayer
+                  redactions={redactionEdits.visibleRedactions}
+                  videoRef={playback.videoRef}
+                  hidden={holdingOriginal || onSlide}
+                />
+              }
               chrome={
                 <>
-                  {selectedZoom && !holdingOriginal && playback.activeSlideId === null && (
+                  {selectedZoom && !holdingOriginal && !onSlide && (
                     <CameraBox
                       videoRef={playback.videoRef}
                       path={cameraPath}
@@ -759,6 +857,27 @@
                       onBegin={zooms.begin}
                       onMove={(center) => zooms.liveLock(selectedZoom.id, center)}
                       onEnd={zooms.end}
+                    />
+                  )}
+                  {selectedRedaction && !holdingOriginal && !onSlide && (
+                    <RegionEditor
+                      rect={selectedRedaction.rect}
+                      onBegin={redactionEdits.begin}
+                      onChange={(rect) => redactionEdits.livePatch(selectedRedaction.id, { rect })}
+                      onEnd={redactionEdits.end}
+                    />
+                  )}
+                  {privacyTool && !holdingOriginal && !onSlide && (
+                    <RegionDrawer
+                      kind={privacyTool}
+                      videoRef={playback.videoRef}
+                      range={
+                        drawRange
+                          ? { from: formatPrecise(drawRange.from), to: formatPrecise(drawRange.to) }
+                          : null
+                      }
+                      onDraft={setDraftRegion}
+                      onCreate={handleCreateRegion}
                     />
                   )}
                   <HoldOriginalButton holding={holdingOriginal} onHoldChange={setHoldingOriginal} />
@@ -770,7 +889,7 @@
                   visibleIds={visibleIds}
                   selectedId={selectedOverlayId}
                   onSelect={setSelectedOverlayId}
-                  tool={videoTools.tool}
+                  tool={isPrivacyTool(videoTools.tool) ? "select" : videoTools.tool}
                   toolState={{
                     color: videoTools.color,
                     stroke: videoTools.stroke,
@@ -825,6 +944,11 @@
                 {t("zoomCount", { count: zooms.visibleZooms.length })}
               </span>
             )}
+            {redactionEdits.visibleRedactions.length > 0 && (
+              <span className={styles.counts}>
+                {t("privacyCount", { count: redactionEdits.visibleRedactions.length })}
+              </span>
+            )}
             <button
               type="button"
               className={styles.fullscreenButton}
@@ -836,7 +960,21 @@
           </div>
         </main>
         <EditorInspector>
-          {selectedZoom ? (
+          {selectedRedaction?.kind === "blur" ? (
+            <BlurInspector
+              redaction={selectedRedaction}
+              range={timelineRangeOf(selectedRedaction.start, selectedRedaction.end)}
+              edits={redactionEdits}
+              onRemoved={() => selectKind("redaction", null)}
+            />
+          ) : selectedRedaction?.kind === "cover" ? (
+            <CoverInspector
+              redaction={selectedRedaction}
+              range={timelineRangeOf(selectedRedaction.start, selectedRedaction.end)}
+              edits={redactionEdits}
+              onRemoved={() => selectKind("redaction", null)}
+            />
+          ) : selectedZoom ? (
             <ZoomInspector
               segment={selectedZoom}
               index={zooms.visibleZooms.indexOf(selectedZoom) + 1}
@@ -890,6 +1028,24 @@
                 />
               ),
             },
+            {
+              key: "privacy",
+              label: t("lanePrivacy"),
+              node: (
+                <PrivacyLane
+                  redactions={redactionEdits.visibleRedactions}
+                  layout={layout}
+                  selectedId={selectedRedactionId}
+                  onSelect={handleSelectRedaction}
+                  onEdgeDrag={redactionEdits.edgeDrag}
+                  ghost={
+                    draftRegion && privacyTool && drawWindow
+                      ? { kind: privacyTool, start: drawWindow.start, end: drawWindow.end }
+                      : null
+                  }
+                />
+              ),
+            },
           ]}
         />
       </footer>
```

### Task 10 — verify

- [ ] Checks (audit rule 4). **Expected after PRs 5–8**, not something this 🟡 In progress doc
      has already observed on `main`: with those PRs applied, `check-types:web` comes back
      clean and the renderer suite is green. Record the real numbers in the PR when it lands.
- [ ] Manual, preview:
  - Draw a Blur over text → marching ants, `W × H · BLUR` in **source** pixels, range
    badge, dashed ghost on the Privacy lane; release → selected, inspector open, tool back
    to Select.
  - Scrub across the region's start and end: it appears/disappears on the exact frame.
  - Zoom a segment over the region (deselect everything): the blur stays glued to the text
    while the camera moves.
  - Intensity slider cannot go below 40; Pixelate shows square cells of the same size in
    preview and export (compare a screenshot of each).
  - Cover with a label on the light swatch: dark label; on the others: white.
  - Hold "original": regions disappear; release: back.
  - Cut the footage under half of a region: two blocks on the lane; undo: one.
- [ ] Manual, leak checks (export after PR 9), with a frame-accurate player on the exported
      file. These are the four ways a region has been observed to leak; all four must be
      clean:
  - **Temporal edges:** step through the first and last frame of each region — no
    unredacted frame at either end.
  - **Spatial edges:** a Blur drawn flush against the **top** and against the **left** frame
    edge — no readable content anywhere in the region, in particular in the outer ~3σ band
    (~93 px at 1080p) where the sample margin is truncated by the frame border and the
    filtered draw's own fade lands inside the clip. See [11 § Task 1](/plans/video-editor-v2/11-export-pass/#task-1--frame-composition-pure-unit-tested-with-a-recording-fake-context)
    for the opaque pre-fill that makes this fail closed.
  - **Stacking:** a Blur drawn **over a Cover**, both on screen at the same time — the
    covered content must not be re-revealed by the blur (regions sample the composed canvas,
    not the decoded frame).
  - **Poster:** the export's library poster shows no covered content (a fully covered first
    frame yields a solid block — accepted, see 11 § Decisions).

## Non-goals

Motion tracking (spec § 11: cut and draw another region), freehand shapes, redacting
audio, redacting the original file or its Cloud copy, selecting regions by clicking the
preview.

## Reopen if

Users expect click-to-select on the preview (add a hit-test on the page's
`onBackgroundClick` that checks visible regions under the pointer before toggling play), or
`backdrop-filter` misrenders under the transformed layer on a supported GPU (render
gaussian regions in the preview with the same per-frame canvas path as pixelate).
