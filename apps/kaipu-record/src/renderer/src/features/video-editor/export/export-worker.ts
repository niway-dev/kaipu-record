/**
 * Export worker — runs in a Web Worker (OffscreenCanvas + WebCodecs; no DOM).
 *
 * Pipeline:
 *   1. Open the source recording with mediabunny.
 *   2. For each ClipSegment: decode frames → composite overlays → encode.
 *   3. For each SlideSegment: draw the slide bitmap at plan.slideFps → composite overlays → encode.
 *   4. Audio (if present): per-clip decoded AudioSamples, trimmed to the exact
 *      source range → re-encode; silence for slides.
 *   5. Finalize the MP4 and notify the renderer.
 *
 * Chunks are posted via transferable ArrayBuffers so the renderer can write them to
 * disk without an extra copy. Positions are non-monotonic because mediabunny writes
 * the moov box at the END of the file and then seeks back to patch the ftyp offset —
 * hence `StreamTarget` (positional) is required instead of `AppendOnlyStreamTarget`.
 *
 * Audio API choice: the WebCodecs-backed `AudioSample`/`AudioSampleSink`/
 * `AudioSampleSource` path is used, NOT the Web-Audio `AudioBuffer` one. The DOM
 * `AudioBuffer` constructor is not defined in a Web Worker (Web Audio is main-thread
 * only), so `AudioBufferSink`/`AudioBufferSource` throw "AudioBuffer is not defined"
 * here; `AudioSample` wraps `AudioData` and works in workers.
 *
 * Audio timestamps: `AudioSampleSource.add` honors each sample's OWN timestamp (it
 * does NOT auto-advance like `AudioBufferSource`). Every emitted sample is rebased
 * onto a single contiguous `audioCursor` so cuts stay gapless and monotonic.
 *
 * Audio trimming: `AudioSampleSink.samples(start, end)` yields whole decoder samples
 * gated on each sample's OWN timestamp (mediabunny's
 * `BaseMediaSampleSink.mediaSamplesInRange` keeps the last sample with
 * timestamp <= start, then everything up to the first sample with
 * timestamp >= end) — it does not clip a sample's PCM content to the range.
 * Left as-is, the first sample of a clip carries pre-roll before `start` and
 * the last trails past `end`, drifting audio out of sync with the
 * frame-accurate video across cuts. `trimAudioSample` below clips each
 * sample to the segment's exact [sourceStart, sourceEnd).
 *
 * Video timestamp rebasing: `CanvasSink.canvases(start, end)` yields the sample
 * STRADDLING `start` as its first frame, whose own timestamp is usually before
 * `start` for a non-frame-aligned trim/cut. Naively rebasing that onto the output
 * timeline can go negative (a first segment with `timelineStart=0`) or regress
 * below the previous segment's last emitted timestamp (any cut boundary) — both of
 * which `CanvasSource.add` rejects or would hand the muxer non-monotonic data.
 * `rebaseVideoTimestamp` (rebase-timestamp.ts) clamps to the segment's
 * `timelineStart` and drops (skips) any frame that would not strictly advance past
 * the previous emitted timestamp; `prevOutTs` is threaded across ALL segments (not
 * reset per segment) so cut boundaries stay monotonic.
 */

import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
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
import { rebaseVideoTimestamp } from "./rebase-timestamp";

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
    ? new AudioSampleSource({ codec: "aac", bitrate: QUALITY_HIGH })
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

  // Poster = the first composed output frame (see ExportWorkerMessage "poster"). Encoded
  // before that frame is handed to the encoder, so it shows exactly what the file starts
  // with — cuts, slides, overlays (and in v2, zoom and privacy regions) included.
  let posterSent = false;
  const sendPosterOnce = async (): Promise<void> => {
    if (posterSent) return;
    posterSent = true;
    const data = await encodePoster(canvas);
    if (data) post({ type: "poster", data }, [data]);
  };

  // Release Output encoders on any error path. Do NOT cancel on the success
  // path — finalize already seals the output and canceling after is an error.
  let finalized = false;
  try {
    // ---------------------------------------------------------------------------
    // Video pass — clips then slides in timeline order. `prevOutTs` is threaded
    // across every segment (not reset per segment) so rebaseVideoTimestamp can
    // detect and drop a straddling frame that would regress across a cut boundary.
    // ---------------------------------------------------------------------------
    let prevOutTs: number | null = null;
    for (const segment of plan.segments) {
      if (segment.kind === "clip") {
        const sink = new CanvasSink(videoTrack, {
          width: size.width,
          height: size.height,
          // 'contain' letterboxes so the aspect ratio is never distorted.
          fit: "contain",
        });

        for await (const wrapped of sink.canvases(segment.sourceStart, segment.sourceEnd)) {
          // Remap the source timestamp to the output (collapsed) timeline, clamped
          // to never go negative or regress — see the header comment and
          // rebase-timestamp.ts for why the straddling first frame needs this.
          const outTs = rebaseVideoTimestamp(
            segment.timelineStart,
            segment.sourceStart,
            wrapped.timestamp,
            prevOutTs,
          );
          if (outTs === null) continue; // straddle/duplicate frame — skip, don't advance prevOutTs
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, size.width, size.height);
          ctx.drawImage(wrapped.canvas, 0, 0);
          stampOverlays(outTs);
          await sendPosterOnce();
          // Use the frame's own decoded duration so clip frames preserve the
          // source's native cadence without rounding to a fixed grid.
          await videoSource.add(outTs, wrapped.duration);
          reportProgress(outTs);
          prevOutTs = outTs;
        }
      } else {
        // Slide segment: synthesize fixed-cadence frames at plan.slideFps. These are
        // already monotonic by construction (fixed cadence from segment.timelineStart),
        // so they don't need rebaseVideoTimestamp's clamp/skip — just keep prevOutTs
        // current so a following clip segment's boundary check has the right value.
        const bitmap = slideBitmaps.get(segment.assetId);
        const frameDuration = 1 / plan.slideFps;
        const frameCount = Math.round(segment.duration * plan.slideFps);

        for (let i = 0; i < frameCount; i++) {
          const outTs = segment.timelineStart + i * frameDuration;
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, size.width, size.height);
          if (bitmap) drawContained(ctx, bitmap, size.width, size.height);
          stampOverlays(outTs);
          await sendPosterOnce();
          await videoSource.add(outTs, frameDuration);
          reportProgress(outTs);
          prevOutTs = outTs;
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
      // AudioSampleSource honors each sample's OWN timestamp (unlike AudioBufferSource,
      // which auto-advances). Rebase every emitted sample onto a single contiguous
      // output cursor so cut boundaries stay gapless and monotonic — the audio analogue
      // of `prevOutTs` on the video pass.
      let audioCursor = 0;
      for (const segment of plan.segments) {
        if (segment.kind === "clip") {
          const sink = new AudioSampleSink(audioTrack);
          for await (const sample of sink.samples(segment.sourceStart, segment.sourceEnd)) {
            // Clip each decoded sample to the segment's exact source range — see the
            // "Audio trimming" header comment for why this is needed.
            const trimmed = trimAudioSample(sample, segment.sourceStart, segment.sourceEnd);
            if (trimmed) {
              trimmed.setTimestamp(audioCursor);
              audioCursor += trimmed.duration;
              await audioSource.add(trimmed);
              if (trimmed !== sample) trimmed.close();
            }
            sample.close();
          }
        } else {
          // Slides are silent. A zeroed interleaved-f32 sample keeps A/V durations
          // aligned so the MP4 muxer doesn't produce a track-length mismatch.
          const frames = Math.ceil(segment.duration * silenceSampleRate);
          const silence = new AudioSample({
            data: new Float32Array(frames * silenceChannelCount),
            format: "f32",
            numberOfChannels: silenceChannelCount,
            sampleRate: silenceSampleRate,
            timestamp: audioCursor,
          });
          audioCursor += silence.duration;
          await audioSource.add(silence);
          silence.close();
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
 * Clips a decoded audio sample's data to `[rangeStart, rangeEnd)`.
 * `sample.timestamp` is the sample's own start time, which per the "Audio
 * trimming" header comment may fall before `rangeStart` (pre-roll) or extend
 * past `rangeEnd` (trailing frames) — both need to be dropped so the encoded
 * duration matches the segment's exact source range.
 *
 * Returns the original `AudioSample` unchanged when it needs no trimming (the
 * common case for interior samples), a new trimmed `AudioSample` when it does
 * (the caller closes it), or `null` if trimming leaves nothing to encode.
 */
function trimAudioSample(
  sample: AudioSample,
  rangeStart: number,
  rangeEnd: number,
): AudioSample | null {
  const { sampleRate, numberOfFrames, timestamp } = sample;
  const sampleEnd = timestamp + numberOfFrames / sampleRate;

  const leadTrim = Math.min(
    numberOfFrames,
    Math.max(0, Math.round((rangeStart - timestamp) * sampleRate)),
  );
  const trailTrim = Math.min(
    numberOfFrames - leadTrim,
    Math.max(0, Math.round((sampleEnd - rangeEnd) * sampleRate)),
  );
  const keepLength = numberOfFrames - leadTrim - trailTrim;
  if (keepLength <= 0) return null;
  if (leadTrim === 0 && trailTrim === 0) return sample;

  // AudioSample.trim takes a [startFrame, endFrame) half-open range and returns a new
  // sample; the caller is responsible for closing it (and the untrimmed original).
  return sample.trim(leadTrim, leadTrim + keepLength);
}

/** Poster width in px; height follows the output aspect (same size generate-thumbnail used). */
const POSTER_WIDTH = 640;

/** JPEG of `source` scaled to POSTER_WIDTH; null if the platform cannot encode (cosmetic). */
async function encodePoster(source: OffscreenCanvas): Promise<ArrayBuffer | null> {
  try {
    const width = Math.min(POSTER_WIDTH, source.width);
    const height = Math.max(1, Math.round((source.height * width) / source.width));
    const poster = new OffscreenCanvas(width, height);
    const pctx = poster.getContext("2d");
    if (!pctx) return null;
    pctx.drawImage(source, 0, 0, width, height);
    const blob = await poster.convertToBlob({ type: "image/jpeg", quality: 0.7 });
    return await blob.arrayBuffer();
  } catch {
    return null;
  }
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
