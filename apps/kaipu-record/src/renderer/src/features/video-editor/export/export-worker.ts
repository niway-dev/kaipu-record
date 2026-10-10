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
 * disk without an extra copy. Positions are non-monotonic: with `fastStart: 'reserve'`
 * (NIW2-218) mediabunny reserves room for the moov box at the START of the file and
 * seeks back to fill it at finalize (without fast start it writes moov at the end and
 * patches earlier headers) — hence `StreamTarget` (positional) is required instead of
 * `AppendOnlyStreamTarget`. Never `'in-memory'`: it buffers the whole file in the worker.
 *
 * Presets (NIW2-218, `msg.target`): Original and Small file compose straight onto the
 * output canvas (same aspect as the source). Fixed-canvas presets compose a source-size
 * VIEW first (frame → redactions → overlays → zoom crop, exactly as Original) and then
 * frame it onto the target canvas (Fit/Fill, see `createFramer`).
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
  canEncodeVideo,
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
import { silencedSpansFor } from "../audio-edits";
import { rebaseVideoTimestamp } from "./rebase-timestamp";
import { createFramer, createOutputComposer } from "./compose-output-frame";
import { packetCountsFor, slideFrameCount } from "./export-presets";

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
  const { plan, output: size, target: preset } = msg;
  // Fixed-canvas presets compose at SOURCE size into a view canvas, then frame it onto the
  // output. Identity framing (Original, Small file) composes straight onto the output.
  const framed = preset.framing !== "identity";
  const composeSize = framed ? msg.source : size;

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
    format: new Mp4OutputFormat({ fastStart: preset.fastStart }),
    target,
  });

  // A composite view canvas for the fixed-canvas presets (see the header comment).
  const view = framed ? new OffscreenCanvas(composeSize.width, composeSize.height) : null;
  const viewCtx = view ? view.getContext("2d") : ctx;
  if (!viewCtx) throw new Error("export-worker: no 2D context on the view canvas");
  const framer = view
    ? createFramer({ ctx, width: size.width, height: size.height, padding: preset.padding })
    : null;

  const videoBitrate = preset.videoBitrate === "high" ? QUALITY_HIGH : preset.videoBitrate;
  // Portrait 1080×1920 needs H.264 level ≥ 4.0; some hardware encoders refuse it. Fall back
  // to letting the platform pick (software if need be) rather than failing the export.
  const hardwareOk = await canEncodeVideo("avc", {
    width: size.width,
    height: size.height,
    bitrate: videoBitrate,
    hardwareAcceleration: "prefer-hardware",
  }).catch(() => false);
  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: videoBitrate,
    hardwareAcceleration: hardwareOk ? "prefer-hardware" : "no-preference",
  });
  // Omit frameRate from VideoTrackMetadata so mediabunny does NOT snap all
  // timestamps to a track-wide grid. Timing is driven entirely by the explicit
  // timestamp+duration pairs passed to videoSource.add(...): clip frames keep
  // the source's native cadence (wrapped.duration from CanvasSink), and slide
  // frames are synthesized at plan.slideFps. A track-wide frameRate hint would
  // collapse high-fps clip frame pairs onto a coarser grid, producing
  // zero-duration or duplicate frames in the encoder.
  //
  // A whole-video mute produces a file with NO audio track, not a silent one:
  // smaller, and no dead volume control in the player. This is the same branch a
  // screen-only recording already takes, so nothing downstream is new.
  const audioMuted = plan.audio.audioMuted;
  const audioSource =
    audioTrack && !audioMuted
      ? new AudioSampleSource({
          codec: "aac",
          bitrate: preset.audioBitrate === "high" ? QUALITY_HIGH : preset.audioBitrate,
        })
      : null;

  // Sample rate / channel count for synthesized slide silence — derived from
  // the source track so it matches the real audio instead of assuming a
  // fixed layout; 48000/2 is only a fallback if the track ever reports 0.
  // Small file downmixes to mono (preset.audioChannels), silence included.
  const silenceSampleRate = audioTrack ? (await audioTrack.getSampleRate()) || 48000 : 48000;
  const silenceChannelCount =
    preset.audioChannels ?? (audioTrack ? (await audioTrack.getNumberOfChannels()) || 2 : 2);

  // `maximumPacketCount` for the moov reservation: the renderer's estimate, raised with the
  // real source rate/sample rate when the worker sees more (too small → the muxer throws
  // and the hook retries once without fast start).
  const stats = await videoTrack.computePacketStats(240).catch(() => null);
  const workerCounts = packetCountsFor({
    durationSec: plan.totalDuration,
    fps: stats?.averagePacketRate ?? 30,
    maxFps: preset.maxFps,
    slideFrames: slideFrameCount(plan.segments, plan.slideFps),
    hasAudio: audioSource !== null,
    sampleRate: silenceSampleRate,
  });
  const maxVideoPackets = Math.max(preset.packetCounts.video, workerCounts.video);
  const maxAudioPackets = Math.max(preset.packetCounts.audio, workerCounts.audio);
  const reserve = preset.fastStart === "reserve";
  out.addVideoTrack(videoSource, reserve ? { maximumPacketCount: maxVideoPackets } : {});
  if (audioSource) {
    out.addAudioTrack(audioSource, reserve ? { maximumPacketCount: maxAudioPackets } : {});
  }

  await out.start();

  // Per-frame composition (fill → zoom/redactions/overlays) is shared with the GIF worker
  // in compose-output-frame.ts so the two exports can never diverge on privacy.
  const compose = createOutputComposer({
    ctx: viewCtx,
    width: composeSize.width,
    height: composeSize.height,
    camera: msg.camera,
    redactions: plan.redactions,
    overlayWindows: plan.overlayWindows,
    overlayBitmaps: new Map(msg.overlays.map((o) => [o.overlayId, o.bitmap])),
  });
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
    // fps cap (Small file below 1080p): the earliest output time the next kept frame may have.
    const minFrameGap = preset.maxFps ? 1 / preset.maxFps : 0;
    let nextSlot: number | null = null;
    for (const segment of plan.segments) {
      if (segment.kind === "clip") {
        const sink = new CanvasSink(videoTrack, {
          width: composeSize.width,
          height: composeSize.height,
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
          // fps cap: drop frames before the next slot. The kept frame's sample lasts until
          // the next kept one (the muxer derives durations from timestamp deltas), so
          // timestamps stay monotonic and the timeline length is unchanged.
          if (nextSlot !== null && outTs < nextSlot - 1e-6) continue;
          if (minFrameGap > 0) nextSlot = outTs + minFrameGap;
          compose.clip(wrapped.canvas, wrapped.timestamp, wrapped.duration, outTs);
          if (framer && view) framer.frame(view, preset.framing === "fill" ? "fill" : "fit");
          await sendPosterOnce();
          // Use the frame's own decoded duration so clip frames preserve the
          // source's native cadence without rounding to a fixed grid.
          await videoSource.add(outTs, Math.max(wrapped.duration, minFrameGap));
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
          compose.slide(bitmap, outTs);
          // Slides are always contained ("fit"), never cropped, whatever the clip framing.
          if (framer && view) framer.frame(view, "fit");
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
          // Muted spans of THIS segment, clipped and merged. Walking them in
          // order lets each decoded sample be zeroed in place rather than
          // dropped: dropping would shorten the audio and drift it out of sync
          // with the video, which is silence's whole job to avoid.
          const silenced = silencedSpansFor(segment.sourceStart, segment.sourceEnd, plan.audio);
          const sink = new AudioSampleSink(audioTrack);
          for await (const sample of sink.samples(segment.sourceStart, segment.sourceEnd)) {
            // Clip each decoded sample to the segment's exact source range — see the
            // "Audio trimming" header comment for why this is needed.
            const trimmed = trimAudioSample(sample, segment.sourceStart, segment.sourceEnd);
            if (trimmed) {
              const start = trimmed.timestamp;
              const end = start + trimmed.duration;
              const muted = silenced.some((span) => start < span.end && end > span.start);
              const shaped = preset.audioChannels === 1 ? downmixToMono(trimmed) : trimmed;
              const emitted = muted ? zeroedLike(shaped) : shaped;
              emitted.setTimestamp(audioCursor);
              audioCursor += emitted.duration;
              await audioSource.add(emitted);
              if (emitted !== shaped) emitted.close();
              if (shaped !== trimmed) shaped.close();
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
/**
 * A silent copy of a sample: same layout, same duration, zeroed data.
 *
 * A copy rather than a mutation because `AudioSample` owns its backing buffer
 * and the caller still has to close the original. Same rate and channel count,
 * so the encoder sees one continuous stream and not a format change mid-file.
 */
function zeroedLike(sample: AudioSample): AudioSample {
  return new AudioSample({
    data: new Float32Array(sample.numberOfFrames * sample.numberOfChannels),
    format: "f32",
    numberOfChannels: sample.numberOfChannels,
    sampleRate: sample.sampleRate,
    timestamp: sample.timestamp,
  });
}

/**
 * Small file (NIW2-218): average every channel into one. A mono source passes through
 * unchanged; the caller closes a new sample when one is returned.
 */
function downmixToMono(sample: AudioSample): AudioSample {
  const channels = sample.numberOfChannels;
  if (channels <= 1) return sample;
  const frames = sample.numberOfFrames;
  const mono = new Float32Array(frames);
  const plane = new Float32Array(frames);
  for (let c = 0; c < channels; c++) {
    sample.copyTo(plane, { planeIndex: c, format: "f32-planar" });
    for (let i = 0; i < frames; i++) mono[i] += plane[i];
  }
  for (let i = 0; i < frames; i++) mono[i] /= channels;
  return new AudioSample({
    data: mono,
    format: "f32",
    numberOfChannels: 1,
    sampleRate: sample.sampleRate,
    timestamp: sample.timestamp,
  });
}

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
