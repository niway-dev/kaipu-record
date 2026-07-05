/**
 * Export worker — runs in a Web Worker (OffscreenCanvas + WebCodecs; no DOM).
 *
 * Pipeline:
 *   1. Open the source recording with mediabunny.
 *   2. For each ClipSegment: decode frames → composite overlays → encode.
 *   3. For each SlideSegment: draw the slide bitmap at slideFps → composite overlays → encode.
 *   4. Audio (if present): per-clip decoded AudioBuffers → re-encode; silence for slides.
 *   5. Finalize the MP4 and notify the renderer.
 *
 * Chunks are posted via transferable ArrayBuffers so the renderer can write them to
 * disk without an extra copy. Positions are non-monotonic because mediabunny writes
 * the moov box at the END of the file and then seeks back to patch the ftyp offset —
 * hence `StreamTarget` (positional) is required instead of `AppendOnlyStreamTarget`.
 *
 * Audio timestamps: `AudioBufferSource.add` self-advances (first buffer at 0,
 * each subsequent at prior cumulative duration) — no explicit timestamps needed.
 *
 * Known: `AudioBuffer` constructor is available in Electron's Chromium workers.
 * If it throws in a future Electron version, build silence via AudioSampleSource
 * with a zeroed Float32Array and explicit timestamps instead.
 */

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
import type { StreamTargetChunk } from "mediabunny";
import type { ExportStartMessage, ExportWorkerMessage } from "./export-messages";

// ---------------------------------------------------------------------------
// Typing helper: TypeScript doesn't expose `Worker` on `self` in module workers.
// ---------------------------------------------------------------------------
type WorkerSelf = typeof self & {
  onmessage: ((event: MessageEvent<ExportStartMessage>) => void) | null;
  postMessage(message: ExportWorkerMessage, transfer?: Transferable[]): void;
};

const workerSelf = self as unknown as WorkerSelf;

const post = (message: ExportWorkerMessage, transfer: Transferable[] = []): void =>
  workerSelf.postMessage(message, transfer);

workerSelf.onmessage = (event: MessageEvent<ExportStartMessage>) => {
  void runExport(event.data).catch((error: unknown) => {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  });
};

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

async function runExport(msg: ExportStartMessage): Promise<void> {
  const { plan, output: size } = msg;

  const input = new Input({ source: new BlobSource(msg.sourceBlob), formats: ALL_FORMATS });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error("source has no video track");
  // Audio is optional: screen-only recordings produce no audio track.
  const audioTrack = await input.getPrimaryAudioTrack();

  // OffscreenCanvas — the only canvas type available in workers.
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("export-worker: no 2D context on OffscreenCanvas");

  // StreamTarget requires positional writes (mediabunny seeks back to patch moov),
  // so `AppendOnlyStreamTarget` cannot be used here. Mirror recorder-engine.ts.
  const target = new StreamTarget(
    new WritableStream<StreamTargetChunk>({
      write(chunk) {
        // chunk.data is a pooled Uint8Array — copy it before transferring so
        // mediabunny can reuse its buffer without aliasing the in-flight data.
        const data = chunk.data.slice().buffer as ArrayBuffer;
        post({ type: "chunk", data, position: chunk.position }, [data]);
      },
    }),
  );

  const out = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target,
  });

  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: QUALITY_HIGH,
    hardwareAcceleration: "prefer-hardware",
  });
  // frameRate in the track metadata snaps timestamps to the fixed grid;
  // slide segments emit exactly slideFps frames/s, so the grid must match.
  out.addVideoTrack(videoSource, { frameRate: plan.slideFps });

  const audioSource = audioTrack
    ? new AudioBufferSource({ codec: "aac", bitrate: QUALITY_HIGH })
    : null;
  if (audioSource) out.addAudioTrack(audioSource);

  await out.start();

  // Lookup helpers built once, not rebuilt per-frame.
  const overlayByIds = new Map(msg.overlays.map((o) => [o.overlayId, o]));
  const slideBitmaps = new Map(msg.slides.map((s) => [s.assetId, s.bitmap]));

  // Progress is throttled via performance.now() to ~4 Hz (≤250 ms intervals)
  // to avoid flooding the renderer's message queue during a long export.
  let lastProgressPost = 0;

  const reportProgress = (outTs: number): void => {
    const now = performance.now();
    if (now - lastProgressPost < 250) return;
    lastProgressPost = now;
    post({ type: "progress", fraction: Math.min(1, outTs / plan.totalDuration) });
  };

  // Stamp any overlay whose visibility window covers the current output timestamp.
  const stampOverlays = (outTs: number): void => {
    for (const window of plan.overlayWindows) {
      if (outTs < window.start || outTs > window.end) continue;
      const overlay = overlayByIds.get(window.overlayId);
      if (overlay) ctx.drawImage(overlay.bitmap, 0, 0, size.width, size.height);
    }
  };

  // ---------------------------------------------------------------------------
  // Video pass — clips then slides in timeline order.
  // ---------------------------------------------------------------------------
  for (const segment of plan.segments) {
    if (segment.kind === "clip") {
      const sink = new CanvasSink(videoTrack, {
        width: size.width,
        height: size.height,
        // 'contain' letterboxes so the aspect ratio is never distorted.
        fit: "contain",
      });

      // prevOutTs is used to derive each frame's duration from the gap to the
      // next frame, giving precise durations without relying on packet metadata.
      let prevOutTs: number | null = null;

      for await (const wrapped of sink.canvases(segment.sourceStart, segment.sourceEnd)) {
        // Remap the source timestamp to the output (collapsed) timeline.
        const outTs = segment.timelineStart + (wrapped.timestamp - segment.sourceStart);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(wrapped.canvas, 0, 0);
        stampOverlays(outTs);

        // Use the inter-frame gap as duration for all but the first frame (which
        // falls back to the wrapped duration so the very first frame isn't 0 s).
        const duration = prevOutTs !== null ? Math.max(0, outTs - prevOutTs) : wrapped.duration;
        await videoSource.add(outTs, duration);
        prevOutTs = outTs;
        reportProgress(outTs);
      }
    } else {
      // Slide segment: emit fixed-cadence frames at slideFps.
      const bitmap = slideBitmaps.get(segment.assetId);
      const frameDuration = 1 / plan.slideFps;
      const frameCount = Math.round(segment.duration * plan.slideFps);

      for (let i = 0; i < frameCount; i++) {
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

  // Signal no more video frames — improves encoder flush latency.
  videoSource.close();

  // ---------------------------------------------------------------------------
  // Audio pass — separate second pass; two-pass is fine because audio decode
  // is cheap relative to encode, and mediabunny accepts interleaved or separate
  // feeding without backpressure issues.
  // ---------------------------------------------------------------------------
  if (audioTrack && audioSource) {
    for (const segment of plan.segments) {
      if (segment.kind === "clip") {
        const sink = new AudioBufferSink(audioTrack);
        for await (const wrapped of sink.buffers(segment.sourceStart, segment.sourceEnd)) {
          // AudioBufferSource.add auto-advances timestamps: first buffer at 0,
          // each subsequent immediately following the prior. Matches the clip order.
          await audioSource.add(wrapped.buffer);
        }
      } else {
        // Slides are silent. A zeroed AudioBuffer keeps A/V durations aligned
        // so the MP4 muxer doesn't produce a track-length mismatch.
        const sampleRate = 48000;
        const silence = new AudioBuffer({
          length: Math.ceil(segment.duration * sampleRate),
          numberOfChannels: 2,
          sampleRate,
        });
        await audioSource.add(silence);
      }
    }
    audioSource.close();
  }

  await out.finalize();

  post({ type: "progress", fraction: 1 });
  post({ type: "done" });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Draw `bitmap` into `(w × h)` with letterboxing (contain), centred, on a
 * black background that was already filled by the caller.
 */
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
