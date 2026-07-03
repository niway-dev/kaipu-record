---
title: "Video editor 06 — export with mediabunny + edit sessions"
description: "Sixth implementation plan for the video editor: a Web Worker export pipeline (decode → canvas composite with burned-in overlays/slides → MP4 encode → vault via the recording writer IPC), a progress dialog, and re-editable session persistence."
---

# Video editor 06 — export & sessions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Exportar" renders the edited timeline — cuts, burned-in annotations, image
slides, audio kept in sync — into a new `"<title> (editado)"` MP4 in the vault, with a
cancelable progress dialog, then navigates to the new library item. The edit session is
saved as JSON next to the original recording and restored when the editor reopens.

**Architecture:** Three layers, hard boundaries:

1. **Pure planning** (`export-plan.ts`): `VideoScene` → `ExportPlan` (ordered render
   segments + overlay windows + output config). Fully unit-tested; the worker executes
   it blindly.
2. **Renderer prep** (`overlay-raster.ts`, `use-video-export.ts`): everything that
   needs the DOM — fetch the source Blob, rasterize each overlay's SVG to an
   `ImageBitmap` at native resolution (workers cannot decode SVG), decode slide
   bitmaps — then transfer it all to the worker. Receives progress/chunks back and
   forwards chunks to the vault over the existing `recording:create/write/finalize`
   IPC (the export lands like a live recording: sidecar + thumbnail included).
3. **Worker** (`export-worker.ts`): mediabunny only. Per clip segment
   `CanvasSink.canvases(start, end)` → draw to one OffscreenCanvas → stamp visible
   overlay bitmaps → `CanvasSource.add(rebasedTs)`. Slides draw at a fixed 30 fps.
   Audio per clip via `AudioBufferSink` → `AudioBufferSource`, silence during slides.
   `Mp4OutputFormat({ fastStart: false })` + `StreamTarget` posting positioned chunks.

**Tech Stack:** mediabunny 1.49 (`Input`, `BlobSource`, `CanvasSink`,
`AudioBufferSink`, `Output`, `CanvasSource`, `AudioBufferSource`, `Mp4OutputFormat`,
`StreamTarget`, `QUALITY_HIGH`), OffscreenCanvas, Vite `new Worker(new URL(...))`.

**Design spec:** `apps/documentation/src/content/docs/specs/2026-07-03-video-editor-design.md`

## Global Constraints

- Same as plan 01: English code/comments, neutral-Spanish copy, no enums, kebab-case,
  `bunx oxfmt --check .` before every commit.
- Prerequisites: plans 01–05 merged.
- **The mediabunny `.d.ts` is the contract**: before Task 3, read
  `apps/kaipu-record/node_modules/mediabunny/dist/mediabunny.d.ts` for the exact
  signatures of every class named above (especially `WrappedCanvas`/`WrappedAudioBuffer`
  timestamp fields, `CanvasSource#add(timestamp, duration)`, `AudioBufferSource#add`,
  and `StreamTarget`'s constructor). Where this plan's snippets disagree with the
  types, the types win. `recorder-engine.ts` shows working `Output`+`StreamTarget`
  wiring; `recording-writer.ts` + `src/shared/types/ipc.ts` show the writer IPC.
- The export must never modify the original recording or the current editor state.

---

### Task 1: Pure export plan

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-plan.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-plan.test.ts`

**Interfaces:**

- Consumes: `VideoScene`, `TrackItem`, `VideoOverlay` (scene.ts); `toLayout`,
  `layoutDuration` (timeline.ts).
- Produces (consumed verbatim by Tasks 2–4):

  ```ts
  export interface RenderClipSegment { kind: "clip"; timelineStart: number; duration: number; sourceStart: number; sourceEnd: number }
  export interface RenderSlideSegment { kind: "slide"; timelineStart: number; duration: number; assetId: string }
  export type RenderSegment = RenderClipSegment | RenderSlideSegment;
  export interface OverlayWindow { overlayId: string; start: number; end: number }
  export interface ExportPlan {
    segments: RenderSegment[];        // ordered, contiguous, timelineStart ascending
    overlayWindows: OverlayWindow[];  // stamping order = scene order (draw order)
    totalDuration: number;
    slideFps: 30;
  }
  export function buildExportPlan(scene: VideoScene): ExportPlan;
  ```

- [ ] **Step 1: Write failing tests** — reuse the `clip`/`slide` fixture helpers from
      `timeline.test.ts` (copy the two small factories into this test file):

```ts
import { describe, expect, it } from "vitest";
import { buildExportPlan } from "./export-plan";
// clip()/slide() factories as in timeline.test.ts

describe("buildExportPlan", () => {
  it("maps the track to contiguous render segments", () => {
    const plan = buildExportPlan({
      items: [slide("s1", 3), clip("a", 0, 10), clip("b", 20, 25)],
      overlays: [],
    });
    expect(plan.totalDuration).toBe(18);
    expect(plan.segments).toEqual([
      { kind: "slide", timelineStart: 0, duration: 3, assetId: "asset-s1" },
      { kind: "clip", timelineStart: 3, duration: 10, sourceStart: 0, sourceEnd: 10 },
      { kind: "clip", timelineStart: 13, duration: 5, sourceStart: 20, sourceEnd: 25 },
    ]);
  });

  it("carries overlay windows in scene order", () => {
    const overlays = [
      { id: "o1", kind: "text", x: 0, y: 0, text: "hola", size: 19, color: "#000", start: 1, end: 4 },
    ] as const;
    const plan = buildExportPlan({ items: [clip("a", 0, 10)], overlays: [...overlays] });
    expect(plan.overlayWindows).toEqual([{ overlayId: "o1", start: 1, end: 4 }]);
  });

  it("throws on an empty timeline", () => {
    expect(() => buildExportPlan({ items: [], overlays: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Verify failure, implement, verify pass** — implementation is a direct
      fold over `toLayout(scene.items)`; throw `new Error("empty timeline")` when the
      layout is empty (the UI disables Exportar in that case; the throw is a backstop).

- [ ] **Step 3: Format and commit**

```bash
bunx oxfmt . && git add -A apps/kaipu-record && git commit -m "feat(video-editor): pure export plan"
```

---

### Task 2: Overlay rasterization (renderer side)

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/export/overlay-raster.ts`

**Interfaces:**

- Consumes: `VideoOverlay`; `roughRect`, `roughArrow`, `HAND_FONT` from the screenshots
  feature (same imports as the annotation layer, plan 04).
- Produces:

  ```ts
  export interface RasterizedOverlay { overlayId: string; bitmap: ImageBitmap }
  export async function rasterizeOverlays(
    overlays: VideoOverlay[],
    videoWidth: number,   // native pixels of the source video track
    videoHeight: number,
    previewWidth: number, // displayed px of the preview video box (for scale-true strokes)
  ): Promise<RasterizedOverlay[]>;
  ```

- [ ] **Step 1: Implement**

Each overlay renders to a full-frame transparent SVG string at `videoWidth×videoHeight`
and rasterizes to an `ImageBitmap` (SVG → `Blob` → object URL → `Image` → canvas →
`createImageBitmap(canvas)`). Scaling rules — the screenshot compositor
(`features/screenshots/annotations/compositor.ts`) solved these exact problems, read
its `buildSvg` before writing this:

- `scale = videoWidth / previewWidth`. Multiply stroke widths and text `size` by
  `scale` so exported weight matches the preview.
- `roughArrow(..., seed, scale)` — pass the scale so jitter/arrowhead stay
  proportional at native resolution (the "arrow-scale fix").
- Text uses `HAND_FONT`; wrap `<text>` content in a CDATA-safe escape (reuse the
  compositor's escaping helper if exported; otherwise escape `& < >`).
- Geometry: overlay coords are normalized 0–1 of the video frame → multiply by
  `videoWidth`/`videoHeight` directly (no beautify padding here — that is a
  screenshot-only concept).

Full-frame bitmaps keep the worker's stamping trivial (`drawImage(bitmap, 0, 0)`); at
1080p a bitmap is ~8 MB and counts of overlays are small — acceptable, do not optimize
to tight bounding boxes preemptively.

- [ ] **Step 2: Typecheck, format, commit**

```bash
cd apps/kaipu-record && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): overlay rasterization for export"
```

---

### Task 3: The export worker

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts`
- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-messages.ts`

**Interfaces:**

- Consumes: `ExportPlan` (Task 1); mediabunny.
- Produces (`export-messages.ts`, shared by worker and hook):

  ```ts
  export interface ExportStartMessage {
    type: "start";
    sourceBlob: Blob;
    plan: ExportPlan;
    overlays: { overlayId: string; start: number; end: number; bitmap: ImageBitmap }[];
    slides: { assetId: string; bitmap: ImageBitmap }[];
    output: { width: number; height: number };
  }
  export type ExportWorkerMessage =
    | { type: "chunk"; data: ArrayBuffer; position: number }
    | { type: "progress"; fraction: number }        // 0..1, throttled to ~4 Hz
    | { type: "done" }
    | { type: "error"; message: string };
  ```

  Cancellation = the hook calls `worker.terminate()` (no message needed; the vault temp
  file is aborted renderer-side).

- [ ] **Step 1: Implement the worker**

```ts
// export-worker.ts — runs with OffscreenCanvas + WebCodecs; no DOM access allowed here.
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
} from "mediabunny";
import type { ExportStartMessage, ExportWorkerMessage } from "./export-messages";

const post = (message: ExportWorkerMessage, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = (event: MessageEvent<ExportStartMessage>) => {
  void runExport(event.data).catch((error: unknown) => {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  });
};

async function runExport(msg: ExportStartMessage): Promise<void> {
  const { plan, output: size } = msg;
  const input = new Input({ source: new BlobSource(msg.sourceBlob), formats: ALL_FORMATS });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error("source has no video track");
  const audioTrack = await input.getPrimaryAudioTrack(); // null for video-only recordings

  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  const target = new StreamTarget(
    new WritableStream({
      write(chunk) {
        // StreamTarget chunks carry {data, position}; moov is rewritten at finalize,
        // hence positioned writes — mirror recorder-engine.ts. Copy the bytes: the
        // underlying buffer is reused by mediabunny.
        const data = chunk.data.slice().buffer as ArrayBuffer;
        post({ type: "chunk", data, position: chunk.position }, [data]);
      },
    }),
  );
  const out = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: QUALITY_HIGH,
    hardwareAcceleration: "prefer-hardware",
  });
  out.addVideoTrack(videoSource, { frameRate: plan.slideFps });
  const audioSource = audioTrack ? new AudioBufferSource({ codec: "aac", bitrate: QUALITY_HIGH }) : null;
  if (audioSource) out.addAudioTrack(audioSource);
  await out.start();

  const overlayByIds = new Map(msg.overlays.map((o) => [o.overlayId, o]));
  const slideBitmaps = new Map(msg.slides.map((s) => [s.assetId, s.bitmap]));
  let lastProgressPost = 0;

  const stampOverlays = (outTs: number) => {
    for (const window of plan.overlayWindows) {
      if (outTs < window.start || outTs > window.end) continue;
      const overlay = overlayByIds.get(window.overlayId);
      if (overlay) ctx.drawImage(overlay.bitmap, 0, 0, size.width, size.height);
    }
  };

  const reportProgress = (outTs: number) => {
    const now = Date.now();
    if (now - lastProgressPost < 250) return;
    lastProgressPost = now;
    post({ type: "progress", fraction: Math.min(1, outTs / plan.totalDuration) });
  };

  // ---- video ----
  for (const segment of plan.segments) {
    if (segment.kind === "clip") {
      const sink = new CanvasSink(videoTrack, {
        width: size.width,
        height: size.height,
        fit: "contain",
      });
      let prevOutTs: number | null = null;
      for await (const wrapped of sink.canvases(segment.sourceStart, segment.sourceEnd)) {
        const outTs = segment.timelineStart + (wrapped.timestamp - segment.sourceStart);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(wrapped.canvas, 0, 0);
        stampOverlays(outTs);
        const duration = prevOutTs === null ? undefined : Math.max(0, outTs - prevOutTs);
        await videoSource.add(outTs, duration ?? wrapped.duration);
        prevOutTs = outTs;
        reportProgress(outTs);
      }
    } else {
      const bitmap = slideBitmaps.get(segment.assetId);
      const frameDuration = 1 / plan.slideFps;
      for (let i = 0; i < Math.round(segment.duration * plan.slideFps); i++) {
        const outTs = segment.timelineStart + i * frameDuration;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, size.width, size.height);
        if (bitmap) drawContained(ctx, bitmap, size.width, size.height);
        stampOverlays(outTs);
        await videoSource.add(outTs, frameDuration);
        reportProgress(outTs);
      }
    }
  }
  videoSource.close?.();

  // ---- audio ----
  if (audioTrack && audioSource) {
    for (const segment of plan.segments) {
      if (segment.kind === "clip") {
        const sink = new AudioBufferSink(audioTrack);
        for await (const wrapped of sink.buffers(segment.sourceStart, segment.sourceEnd)) {
          await audioSource.add(wrapped.buffer);
        }
      } else {
        // Slides are silent: a zeroed AudioBuffer keeps A/V durations aligned.
        const sampleRate = 48000;
        await audioSource.add(
          new AudioBuffer({ length: Math.ceil(segment.duration * sampleRate), numberOfChannels: 2, sampleRate }),
        );
      }
    }
    audioSource.close?.();
  }

  await out.finalize();
  post({ type: "progress", fraction: 1 });
  post({ type: "done" });
}

function drawContained(
  ctx: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  w: number,
  h: number,
): void {
  const scale = Math.min(w / bitmap.width, h / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
```

**Verify against the `.d.ts` and adjust (this is part of the task, not optional):**

- `AudioBufferSink#buffers` name/shape, `AudioBufferSource` constructor + whether
  sequential `add(buffer)` self-advances timestamps (if it needs explicit timestamps,
  pass `segment.timelineStart` accordingly).
- `CanvasSource#add` signature and whether `close()` exists (recorder-engine's sources
  are closed on stop — mirror it).
- Whether audio can be interleaved with video instead of a second pass. Two passes are
  fine (decode is fast relative to encode), but if `Output` requires interleaved
  feeding (check for backpressure notes on `add`), restructure to alternate
  per-segment: video segment N, then its audio, then segment N+1.
- `new AudioBuffer(...)` exists in workers in Electron's Chromium; if not, build
  silence via `AudioSampleSource` and an `AudioSample` with zeroed data, or fall back
  to constructing the buffer renderer-side and transferring the channel data.

- [ ] **Step 2: Typecheck, format, commit**

```bash
cd apps/kaipu-record && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): export worker (decode-composite-encode)"
```

---

### Task 4: Export orchestration hook + dialog

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts`
- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/export-dialog.tsx`
- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/export-dialog.module.css`
- Modify: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`
- Modify: `apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.tsx`

**Interfaces:**

- Consumes: `buildExportPlan`, `rasterizeOverlays`, worker messages;
  `window.electronAPI` recording-writer methods (read `recorder-engine.ts` for their
  exact names and call order — create/write/finalize/abort — and `electron-api.ts`
  for signatures; finalize takes title/duration/thumbnail metadata and returns a
  `LocalRecording`).
- Produces:

  ```ts
  interface VideoExportState { status: "idle" | "exporting" | "error"; fraction: number; error: string | null }
  function useVideoExport(): VideoExportState & {
    start(args: {
      scene: VideoScene;
      sourceId: string;
      title: string;
      videoWidth: number;    // from the <video> element's videoWidth/videoHeight
      videoHeight: number;
      previewWidth: number;  // displayed px of the preview box
      slideAssets: SlideAssetStore;
      onSaved: (recording: LocalRecording) => void;
    }): Promise<void>;
    cancel(): void;
  }
  ```

- [ ] **Step 1: Implement the hook**

Flow of `start`:

1. `plan = buildExportPlan(scene)`.
2. `blob = await (await fetch(\`kaipu-media://recording/${sourceId}\`)).blob()`.
3. `rasterizeOverlays(scene.overlays, videoWidth, videoHeight, previewWidth)`; decode
   each used slide asset to an `ImageBitmap` (`createImageBitmap(new Blob([bytes]))`).
4. Open the vault writer (same call sequence as recorder-engine's create).
5. `new Worker(new URL("./export-worker.ts", import.meta.url), { type: "module" })`;
   post the start message transferring all bitmaps.
6. `chunk` → forward to the writer IPC (fire-and-forget, positions included);
   `progress` → state; `error` → abort writer, status error;
   `done` → capture a thumbnail (reuse the first slide/clip frame: simplest is to draw
   the preview `<video>` to a canvas at `seek(0)` before starting — mirror however
   recorder-engine builds its `thumbnail: ArrayBuffer`), then finalize with
   `title: \`${title} (editado)\``, `durationSeconds: plan.totalDuration`→`onSaved(recording)`.
7. `cancel()` → `worker.terminate()` + writer abort + status idle.

Export must refuse to start (`status: "error"`, message
**"No hay nada que exportar"**) when the plan throws on an empty timeline.

- [ ] **Step 2: Dialog + toolbar button**

`EditorToolbar` gains a primary **"Exportar"** button (right-aligned, `Download` icon,
disabled while exporting or when the timeline is empty). `ExportDialog` is a modal
(reuse the app's `Modal`/dialog primitive from `ui/`): title **"Exportando video…"**,
a determinate progress bar (`fraction`), percentage text, and **"Cancelar"**. On error:
message + **"Reintentar"** / **"Cerrar"**. On success the dialog closes itself.

- [ ] **Step 3: Post-export navigation**

In the page: `onSaved: (recording) => { markClean(); navigate(\`/library/${recording.id}\`); }`where`markClean`clears the dirty/blocker state so`useBlocker`does not intercept the
programmatic navigation (add a`markClean()`method to`VideoSceneController`— it
resets`past`/`future` around the current scene). Session persistence in Task 5 runs
BEFORE navigation.

- [ ] **Step 4: Manual verification (the big one)**

- Cut a recording into 3 segments, delete the middle, add an arrow (0:02–0:06), a text,
  and a 3 s intro image → Exportar → progress advances smoothly → lands on the new
  library item.
- Play the exported MP4 **in QuickTime, not just the app**: cuts are seamless, audio
  stays in sync after the cut and after the slide, annotations appear/disappear at the
  right times with preview-matching stroke weight and position, the slide shows 3 s of
  silence.
- Cancel mid-export: no new library item, no orphan `.part` file in the vault
  (check the vault folder), editor still fully functional.
- Export a video-only recording (macOS system-audio fallback case): works, no audio track.

- [ ] **Step 5: Full suite, format, commit**

```bash
cd apps/kaipu-record && bunx vitest run && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): export pipeline with progress dialog"
```

---

### Task 5: Edit-session persistence

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/session.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/video-editor/session.test.ts`
- Modify: `apps/kaipu-record/src/shared/types/ipc.ts` (channels + payload types)
- Modify: `apps/kaipu-record/src/shared/types/electron-api.ts`
- Modify: `apps/kaipu-record/src/preload/index.ts`
- Create: `apps/kaipu-record/src/main/library/video-edit-session.ts`
- Modify: `apps/kaipu-record/src/main/index.ts` (or wherever library IPC handlers are registered — follow `screenshot-ipc.ts`'s registration pattern)
- Modify: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`

**Interfaces:**

- Produces IPC (names in `IPC_CHANNELS`, each with a purpose comment like every
  existing entry):
  - `videoEdit:save-session` (invoke): `(id: string, sessionJson: string, assets: { assetId: string; bytes: ArrayBuffer }[]) => void` — writes `.kaipu/<id>.edit.json` and `.kaipu/<id>.assets/<assetId>.png`, pruning asset files no longer referenced.
  - `videoEdit:load-session` (invoke): `(id: string) => { sessionJson: string; assets: { assetId: string; bytes: ArrayBuffer }[] } | null`
- Produces renderer module `session.ts`:

  ```ts
  export interface VideoEditSession { version: 1; scene: VideoScene }
  export function serializeSession(scene: VideoScene): string;
  export function parseSession(json: string): VideoEditSession | null; // null on anything invalid
  ```

- [ ] **Step 1: TDD `parseSession`** — tests: round-trips a scene with all three
      overlay kinds and a slide; returns `null` for invalid JSON, wrong `version`,
      missing `items`, item with unknown `kind`, non-numeric times. Validate structurally
      field-by-field (no zod in this app — check first; if a validation lib exists in the
      renderer, use it).

- [ ] **Step 2: Main-process handler** — `video-edit-session.ts` uses the vault dir
      (follow `library-vault.ts`'s path helpers; sessions live under `.kaipu/` beside the
      existing metadata sidecars). Write atomically (temp + rename) — the pattern used by
      the settings service, read it. Deleting a recording should also delete its session +
      assets: hook into the existing `deleteLocalRecording` handler.

- [ ] **Step 3: Save on export** — in the page, right before `onSaved` navigation:
      `serializeSession(scene)` + `assetStore.entries()` → `saveVideoEditSession(...)`.
      Also add a toolbar **"Guardar borrador"** action? **No** — YAGNI; the session saves
      on export only, per the approved design (MVP). Do not add extra save points.

- [ ] **Step 4: Restore on open** — on editor mount (before building the initial
      scene): `loadVideoEditSession(source.id)`; if `parseSession` succeeds, hydrate the
      asset store from the returned assets and use the session's scene as `initialScene`;
      toast **"Se restauró tu edición anterior"** (use the app's toast store). Invalid or
      missing → fresh scene, and if it was invalid (non-null load, failed parse) toast
      **"No se pudo restaurar la edición anterior"**. Slides whose assets are missing are
      dropped from the restored scene (filter + `clampOverlays` is NOT needed for this —
      just filter the items).

- [ ] **Step 5: Manual verification** — export an edited video; reopen the editor on
      the ORIGINAL recording → cuts/overlays/slides restored; delete the original recording
      → `.kaipu` session + assets are gone.

- [ ] **Step 6: Full suite, format, commit**

```bash
cd apps/kaipu-record && bunx vitest run && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): edit-session persistence"
```

---

## Done when

- Suites + typecheck green, oxfmt clean.
- Manual: the full flow — cut, annotate, slide, export, verify in QuickTime, reopen and
  see the session restored, cancel mid-export leaves no debris.
- Update the backlog doc status (`backlog/video-editor.md`) to 🟢 and note anything
  learned in its Gotchas section.
- PR: `feat(video-editor): export & sessions (plan 06)` → **stop for owner review**.

## Follow-ups explicitly deferred (do not build now)

- Replace-vs-duplicate export choice (design decided: a dialog at export time; MVP
  always duplicates).
- Overlay image track (image floating over video) — add `kind: "image"` to
  `VideoOverlay` + an asset ref; the lane/raster/worker all extend naturally.
- Background export (navigate away while encoding) — needs a global progress store.
- Timeline zoom for long recordings; audio mute/volume per segment; export quality
  picker (reuse `recording-quality.ts` presets).
