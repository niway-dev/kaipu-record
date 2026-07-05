/**
 * Export worker — runs in a Web Worker (OffscreenCanvas + WebCodecs; no DOM).
 *
 * Pipeline:
 *   1. Open the source recording with mediabunny.
 *   2. For each ClipSegment: decode frames → composite overlays → encode.
 *   3. For each SlideSegment: draw the slide bitmap at plan.slideFps → composite overlays → encode.
 *   4. Audio (if present): per-clip decoded AudioBuffers, trimmed to the exact
 *      source range → re-encode; silence for slides.
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
 * Audio trimming: `AudioBufferSink.buffers(start, end)` yields whole decoder
 * frames gated on each frame's OWN timestamp (mediabunny's
 * `BaseMediaSampleSink.mediaSamplesInRange` keeps the last frame with
 * timestamp <= start, then everything up to the first frame with
 * timestamp >= end) — it does not clip a frame's PCM content to the range.
 * Left as-is, the first frame of a clip carries pre-roll before `start` and
 * the last trails past `end`, drifting audio out of sync with the
 * frame-accurate video across cuts. `trimAudioBuffer` below clips each
 * frame's sample data to the segment's exact [sourceStart, sourceEnd).
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
import type { StreamTargetChunk, WrappedAudioBuffer } from "mediabunny";
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
  const input = new Input({ source: new BlobSource(msg.sourceBlob), formats: ALL_FORMATS });
  try {
    await runExportWithInput(msg, input);
  } finally {
    // `Input` is the only Disposable handle mediabunny exposes here — neither
    // CanvasSink nor AudioBufferSink implement Disposable/close in the .d.ts,
    // and disposing the Input already cancels their in-flight decode
    // operations and closes their decoders (per Input.dispose()'s docs), so
    // there is nothing else to release per-segment.
    input.dispose();
  }
}

async function runExportWithInput(msg: ExportStartMessage, input: Input): Promise<void> {
  const { plan, output: size } = msg;

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
  // Omit frameRate from VideoTrackMetadata so mediabunny does NOT snap all
  // timestamps to a track-wide grid. Timing is driven entirely by the explicit
  // timestamp+duration pairs passed to videoSource.add(...): clip frames keep
  // the source's native cadence (wrapped.duration from CanvasSink), and slide
  // frames are synthesized at plan.slideFps. A track-wide frameRate hint would
  // collapse high-fps clip frame pairs onto a coarser grid, producing
  // zero-duration or duplicate frames in the encoder.
  out.addVideoTrack(videoSource);

  const audioSource = audioTrack
    ? new AudioBufferSource({ codec: "aac", bitrate: QUALITY_HIGH })
    : null;
  if (audioSource) out.addAudioTrack(audioSource);

  // Sample rate / channel count for synthesized slide silence — derived from
  // the source track so it matches the real audio instead of assuming a
  // fixed layout; 48000/2 is only a fallback if the track ever reports 0.
  const silenceSampleRate = audioTrack ? (await audioTrack.getSampleRate()) || 48000 : 48000;
  const silenceChannelCount = audioTrack ? (await audioTrack.getNumberOfChannels()) || 2 : 2;

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

  // Release Output encoders on any error path. Do NOT cancel on the success
  // path — finalize already seals the output and canceling after is an error.
  let finalized = false;
  try {
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

        for await (const wrapped of sink.canvases(segment.sourceStart, segment.sourceEnd)) {
          // Remap the source timestamp to the output (collapsed) timeline.
          const outTs = segment.timelineStart + (wrapped.timestamp - segment.sourceStart);
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, size.width, size.height);
          ctx.drawImage(wrapped.canvas, 0, 0);
          stampOverlays(outTs);
          // Use the frame's own decoded duration so clip frames preserve the
          // source's native cadence without rounding to a fixed grid.
          await videoSource.add(outTs, wrapped.duration);
          reportProgress(outTs);
        }
      } else {
        // Slide segment: synthesize fixed-cadence frames at plan.slideFps.
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
            // Clip each decoded frame to the segment's exact source range — see
            // the "Audio trimming" header comment for why this is needed.
            const trimmed = trimAudioBuffer(wrapped, segment.sourceStart, segment.sourceEnd);
            if (!trimmed) continue;
            // AudioBufferSource.add auto-advances timestamps: first buffer at 0,
            // each subsequent immediately following the prior. Matches the clip order.
            await audioSource.add(trimmed);
          }
        } else {
          // Slides are silent. A zeroed AudioBuffer keeps A/V durations aligned
          // so the MP4 muxer doesn't produce a track-length mismatch.
          const silence = new AudioBuffer({
            length: Math.ceil(segment.duration * silenceSampleRate),
            numberOfChannels: silenceChannelCount,
            sampleRate: silenceSampleRate,
          });
          await audioSource.add(silence);
        }
      }
      audioSource.close();
    }

    await out.finalize();
    finalized = true;

    post({ type: "progress", fraction: 1 });
    post({ type: "done" });
  } finally {
    if (!finalized) {
      // Cancel releases Output encoders and the muxer on any error path;
      // Input decoders are freed by input.dispose() in the outer runExport finally.
      try {
        await out.cancel();
      } catch {
        /* already tearing down */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clips a decoded audio frame's sample data to `[rangeStart, rangeEnd)`.
 * `wrapped.timestamp` is the frame's own start time, which per the "Audio
 * trimming" header comment may fall before `rangeStart` (pre-roll) or extend
 * past `rangeEnd` (trailing samples) — both need to be dropped so the encoded
 * duration matches the segment's exact source range.
 *
 * Returns the original `AudioBuffer` unchanged when it needs no trimming
 * (the common case for interior frames), a new trimmed `AudioBuffer` when it
 * does, or `null` if trimming leaves nothing to encode.
 */
function trimAudioBuffer(
  wrapped: WrappedAudioBuffer,
  rangeStart: number,
  rangeEnd: number,
): AudioBuffer | null {
  const { buffer, timestamp } = wrapped;
  const sampleRate = buffer.sampleRate;
  const bufferEnd = timestamp + buffer.length / sampleRate;

  const leadTrim = Math.min(
    buffer.length,
    Math.max(0, Math.round((rangeStart - timestamp) * sampleRate)),
  );
  const trailTrim = Math.min(
    buffer.length - leadTrim,
    Math.max(0, Math.round((bufferEnd - rangeEnd) * sampleRate)),
  );
  const keepLength = buffer.length - leadTrim - trailTrim;
  if (keepLength <= 0) return null;
  if (leadTrim === 0 && trailTrim === 0) return buffer;

  const trimmed = new AudioBuffer({
    length: keepLength,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const channelData = buffer.getChannelData(channel).subarray(leadTrim, leadTrim + keepLength);
    trimmed.copyToChannel(channelData, channel);
  }
  return trimmed;
}

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
