/**
 * Export worker — runs in a Web Worker (OffscreenCanvas + WebCodecs; no DOM).
 *
 * Pipeline:
 *   1. Open the source recording with mediabunny.
 *   2. For each ClipSegment: decode frames → composite overlays → encode.
 *   3. For each SlideSegment: draw the slide bitmap at plan.slideFps → composite overlays → encode.
 *   4. Audio (if present): per-clip decoded AudioSamples, trimmed to the exact
 *      source range → re-encode; silence for slides. Produced in step with the video
 *      (each frame asks the audio pump for audio up to a second past it), never as a pass
 *      of its own after the video.
 *   5. Finalize the MP4 and notify the renderer.
 *
 * Chunks are posted via transferable ArrayBuffers so the renderer can write them to
 * disk without an extra copy. Positions are non-monotonic: with `fastStart: 'reserve'`
 * (NIW2-218) mediabunny reserves room for the moov box at the START of the file and
 * seeks back to fill it at finalize (without fast start it writes moov at the end and
 * patches earlier headers) — hence `StreamTarget` (positional) is required instead of
 * `AppendOnlyStreamTarget`. Never `'in-memory'`: it buffers the whole file in the worker.
 *
 * Presets (NIW2-218, `msg.target`): Balanced, Light and Maximum compose straight onto the
 * output canvas (same aspect as the source). Fixed-canvas presets compose a source-size
 * VIEW first (frame → redactions → overlays → zoom crop, exactly as Maximum) and then
 * frame it onto the target canvas (Fit/Fill, see `createFramer`).
 *
 * Webcam (ADR 0038): when the plan has a webcam layer and the renderer sent its file, a
 * second Input decodes it in lockstep with the screen (one cursor per clip segment over
 * that segment's source range, `webcam-lockstep.ts`), and the composer draws the layer
 * last, onto the final canvas. Without one, no second Input is opened.
 *
 * Screen capture is change-driven: over a still screen one screen frame can stay up for
 * seconds. With a visible webcam layer, the gap is filled with extra output frames at the
 * webcam's rate (or the preset's cap), each the held screen frame re-composed with the next
 * webcam frame, so the face keeps moving (`fillWebcamGap`). Fills stay inside their clip.
 *
 * Encoding (NIW2-218): AVC with a keyframe every 10 s (2 s for YouTube). The quality tiers
 * use quantizer mode (constant quality) on the hardware encoder, at most 24 fps; everything
 * else, and a platform without quantizer support, targets a bitrate. `pickVideoEncoding` probes
 * the encoder first and the renderer logs a software fallback (video-encoding.ts).
 *
 * Audio API choice: the WebCodecs-backed `AudioSample`/`AudioSampleSink`/
 * `AudioSampleSource` path is used, NOT the Web-Audio `AudioBuffer` one. The DOM
 * `AudioBuffer` constructor is not defined in a Web Worker (Web Audio is main-thread
 * only), so `AudioBufferSink`/`AudioBufferSource` throw "AudioBuffer is not defined"
 * here; `AudioSample` wraps `AudioData` and works in workers.
 *
 * Audio timestamps, trimming, resampling and silence: audio-pump.ts, which produces the
 * samples on demand so the muxer is never fed video far ahead of audio (see the video pass).
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
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  canEncodeAudio,
  canEncodeVideo,
  CanvasSink,
  CanvasSource,
  Input,
  type InputAudioTrack,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
} from "mediabunny";
import type { StreamTargetChunk } from "mediabunny";
import type { ExportStartMessage, ExportWorkerMessage } from "./export-messages";
import { exportClipFrames } from "./export-clip-frames";
import { exportCanvasSinkOptions } from "./canvas-sink-options";
import { createOutputComposer } from "./compose-output-frame";
import { floatingLiveAt } from "./floating-frame";
import {
  audioEncodingCandidates,
  packetCountsFor,
  slideFrameCount,
  type AudioEncoding,
  type ResolvedExportTarget,
} from "./export-presets";
import { cappedSlideFps, createFrameRateCap } from "./frame-rate-cap";
import { chooseVideoEncoding, type VideoEncodingChoice } from "./video-encoding";
import { WEBCAM_FPS } from "@shared/webcam-track";
import { openWebcamSourceOrNone, webcamImageOf, type WebcamSource } from "./webcam-source";
import { clipFramesOf, clipSource, clipWebcamCursorOf } from "./joined-media";
import { AUDIO_LEAD_SECONDS, createAudioPump } from "./audio-pump";
import { audioPlan, type RecordingAudio } from "./joined-audio";

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
  // One Input (and webcam source) per joined recording, keyed by `SceneSource.id`; the opened
  // recording is key null. Empty for a scene without joins.
  const joinedInputs = new Map<string, Input>();
  const webcams = new Map<string | null, WebcamSource>();
  try {
    // A broken webcam file never fails the export: it goes on without the layer. For a joined
    // recording only that recording loses its camera.
    const onWebcamError = (error: unknown): void =>
      post({ type: "webcam-error", message: errorMessage(error) });
    const openedWebcam = await openWebcamSourceOrNone(msg.webcam, msg.plan.webcam, onWebcamError);
    if (openedWebcam) webcams.set(null, openedWebcam);
    for (const entry of msg.joined) {
      joinedInputs.set(
        entry.sourceId,
        new Input({ source: new BlobSource(entry.blob), formats: ALL_FORMATS }),
      );
      const joinedWebcam = await openWebcamSourceOrNone(
        entry.webcam,
        msg.plan.webcam,
        onWebcamError,
      );
      if (joinedWebcam) webcams.set(entry.sourceId, joinedWebcam);
    }
    await runExportWithInput(msg, input, joinedInputs, webcams);
  } finally {
    for (const source of webcams.values()) source.dispose();
    for (const joinedInput of joinedInputs.values()) joinedInput.dispose();
    // `Input` is the only Disposable handle mediabunny exposes here — neither
    // CanvasSink nor AudioBufferSink implement Disposable/close in the .d.ts,
    // and disposing the Input already cancels their in-flight decode
    // operations and closes their decoders (per Input.dispose()'s docs), so
    // there is nothing else to release per-segment.
    input.dispose();
  }
}

async function runExportWithInput(
  msg: ExportStartMessage,
  input: Input,
  joinedInputs: ReadonlyMap<string, Input>,
  webcams: ReadonlyMap<string | null, WebcamSource>,
): Promise<void> {
  const { plan, output: size, target: preset } = msg;
  const joinedRefs = msg.joined.map((j) => ({ sourceId: j.sourceId, offset: j.offset }));
  // Fixed-canvas presets compose at SOURCE size into a view canvas, then frame it onto the
  // output. Identity framing (Balanced, Light, Maximum) composes straight onto the output.
  const framed = preset.framing !== "identity";
  const composeSize = framed ? msg.source : size;

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error("source has no video track");
  // Each joined recording decodes from its own file: the clips' sinks are built on its track.
  const trackOf = new Map<string | null, typeof videoTrack>([[null, videoTrack]]);
  for (const [sourceId, joinedInput] of joinedInputs) {
    const joinedTrack = await joinedInput.getPrimaryVideoTrack();
    if (!joinedTrack) throw new Error(`joined recording ${sourceId} has no video track`);
    trackOf.set(sourceId, joinedTrack);
  }
  // `fit: "contain"` (canvas-sink-options.ts) letterboxes a joined recording of another
  // aspect inside the opened recording's frame, the same as the preview.
  const readers = new Map(
    [...trackOf].map(([key, track]) => [
      key,
      {
        canvases: (start: number, end: number) =>
          new CanvasSink(
            track,
            exportCanvasSinkOptions(composeSize.width, composeSize.height),
          ).canvases(start, end),
      },
    ]),
  );
  // Audio is optional: a recording can have no audio track. Each recording that has one is
  // read from its own file; `audioPlan` decides whether the MP4 has audio and in which format.
  const audioTracks = new Map<string | null, InputAudioTrack>();
  const recordingAudio: RecordingAudio[] = [];
  const openedAudio = await input.getPrimaryAudioTrack();
  if (openedAudio) audioTracks.set(null, openedAudio);
  recordingAudio.push(await audioFacts(null, openedAudio));
  for (const [sourceId, joinedInput] of joinedInputs) {
    const joinedAudio = await joinedInput.getPrimaryAudioTrack();
    if (joinedAudio) audioTracks.set(sourceId, joinedAudio);
    recordingAudio.push(await audioFacts(sourceId, joinedAudio));
  }
  const audioDecision = audioPlan(plan, recordingAudio);
  const audioReference = audioDecision.reference;
  const audioReaders = new Map(
    [...audioTracks].map(([key, track]) => [
      key,
      { samples: (start: number, end: number) => new AudioSampleSink(track).samples(start, end) },
    ]),
  );

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

  // Hardware AVC in quantizer mode for the tiers, else at the bitrate, else whatever the
  // platform offers (see video-encoding.ts). Portrait 1080×1920 needs H.264 level ≥ 4.0, which
  // some hardware encoders refuse: that also lands on the platform's pick rather than failing.
  const encoding = await pickVideoEncoding(preset, size);
  post({ type: "encoder", choice: encoding });
  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    quality: videoQuality(encoding),
    keyFrameInterval: encoding.keyFrameInterval,
    hardwareAcceleration: encoding.hardwareAcceleration,
  });
  // Omit frameRate from VideoTrackMetadata so mediabunny does NOT snap all
  // timestamps to a track-wide grid. Timing is driven entirely by the explicit
  // timestamp+duration pairs passed to videoSource.add(...): clip frames keep
  // the source's own timestamps (thinned by the preset's fps cap, frame-rate-cap.ts),
  // and slide frames are synthesized at plan.slideFps (or the cap, if lower). A
  // track-wide frameRate hint would collapse high-fps clip frame pairs onto a
  // coarser grid, producing zero-duration or duplicate frames in the encoder.
  //
  // A whole-video mute produces a file with NO audio track, not a silent one:
  // smaller, and no dead volume control in the player. This is the same branch a
  // screen-only recording already takes, so nothing downstream is new.
  //
  // The runner reaches the same decision from its probes, but only for the size estimate; this
  // one, from the opened files, is what the MP4 gets.
  //
  // Sample rate / channel count of the track and of the synthesized silence — the reference
  // recording's (the first used one with audio), so every clip is converted to one format.
  const silenceSampleRate = audioReference?.sampleRate ?? 48000;
  const sourceChannels = audioReference?.channels ?? 2;
  // An explicit AAC config (every preset but Maximum) is checked against the encoder first:
  // Light asks for mono 64 kbps, which Chromium's AAC encoder on macOS refuses.
  const audioEncoding =
    preset.audioBitrate === "high" || !audioReference
      ? null
      : await pickAudioEncoding(audioEncodingCandidates(preset, sourceChannels), silenceSampleRate);
  const audioSource = audioReference
    ? new AudioSampleSource({
        codec: "aac",
        quality: audioEncoding
          ? new Quality({ bitrate: audioEncoding.bitrate })
          : new Quality("high"),
      })
    : null;
  // Downmix (Light) only when the encoder took the mono config; silence matches it.
  const downmix = audioEncoding?.numberOfChannels === 1 && sourceChannels !== 1;
  const silenceChannelCount = audioEncoding?.numberOfChannels ?? sourceChannels;

  // `maximumPacketCount` for the moov reservation: the renderer's estimate, raised with the
  // real source rate/sample rate when the worker sees more (too small → the muxer throws
  // and the hook retries once without fast start).
  const stats = await videoTrack.computePacketStats(240).catch(() => null);
  // Webcam fills (see the header) add frames up to the webcam's rate over a still screen.
  const fillFps = Math.min(WEBCAM_FPS, preset.maxFps ?? WEBCAM_FPS);
  const sourceFps = stats?.averagePacketRate ?? 30;
  // Floating images add frames over a still screen too, at the same rate.
  const floatingItems = (plan.floating?.items.length ?? 0) > 0;
  const workerCounts = packetCountsFor({
    durationSec: plan.totalDuration,
    fps: webcams.size > 0 || floatingItems ? Math.max(sourceFps, fillFps) : sourceFps,
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

  // The audio, produced on demand (audio-pump.ts); null for an export without an audio track.
  const audio =
    audioReference && audioSource
      ? createAudioPump({
          segments: plan.segments,
          perSegment: audioDecision.perSegment,
          edits: plan.audio,
          joined: joinedRefs,
          readers: audioReaders,
          reference: audioReference,
          silenceSampleRate,
          silenceChannelCount,
          downmix,
          sink: audioSource,
        })
      : null;

  // Per-frame composition (fill → zoom/redactions/overlays → framing → webcam) is shared
  // with the GIF worker in compose-output-frame.ts so the two exports can never diverge.
  const compose = createOutputComposer({
    ctx: viewCtx,
    width: composeSize.width,
    height: composeSize.height,
    camera: msg.camera,
    cursor: msg.cursor,
    redactions: plan.redactions,
    overlayWindows: plan.overlayWindows,
    overlayBitmaps: new Map(msg.overlays.map((o) => [o.overlayId, o.bitmap])),
    webcam: plan.webcam,
    sourceEndSeconds: plan.sourceDurationSeconds,
    // Floating images (spec 2026-11-13): drawn whenever the plan has them, no flag.
    floating: {
      plan: plan.floating,
      bitmaps: new Map<string, ImageBitmap>(
        (msg.mediaImages ?? []).map((m) => [m.assetId, m.bitmap]),
      ),
    },
    // ADR 0051: the preset's background around the picture, drawn last; `none` draws nothing.
    background: plan.background,
    framing: view
      ? {
          view,
          ctx,
          width: size.width,
          height: size.height,
          mode: preset.framing === "fill" ? "fill" : "fit",
          padding: preset.padding,
        }
      : null,
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

  // Every video frame goes through here. mediabunny's muxer writes samples in timestamp
  // order across tracks and keeps whatever is ahead of the slower track in RAM until that
  // track catches up, so the audio is produced up to AUDIO_LEAD_SECONDS past the frame before
  // the frame is added. Its guide asks for exactly this ("add media in a somewhat interleaved
  // way to keep memory usage low", https://mediabunny.dev/guide/writing-media-files). Feeding
  // all the video first held the whole encoded video in the worker (6.5 GB on a real take)
  // while the file on disk stayed empty. The video `outTs` and the audio cursor are the same
  // output timeline: segments are contiguous from 0, and the audio of each is its duration.
  const addVideoFrame = async (outTs: number, duration: number): Promise<void> => {
    await sendPosterOnce();
    await audio?.advanceTo(outTs + AUDIO_LEAD_SECONDS);
    await videoSource.add(outTs, duration);
    reportProgress(outTs);
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
    // fps cap (the quality tiers, 24 fps): one frame per 1/maxFps slot, see frame-rate-cap.ts.
    const cap = createFrameRateCap(preset.maxFps);
    const minFrameGap = preset.maxFps ? 1 / preset.maxFps : 0;
    const slideFps = cappedSlideFps(plan.slideFps, preset.maxFps);
    for (const segment of plan.segments) {
      if (segment.kind === "clip") {
        // Which file the clip reads and where in it (axis -> local); frames and webcam
        // lookups come back in axis seconds, so everything below stays on the axis.
        const src = clipSource(segment, msg.joined);
        // The webcam frames of this clip, decoded beside the screen's (null: no webcam).
        const webcamCursor = clipWebcamCursorOf(src, webcams);
        try {
          // Fills, rebase, fps cap and composition: export-clip-frames.ts.
          prevOutTs = await exportClipFrames({
            segment,
            frames: clipFramesOf(src, readers),
            webcamCursor,
            layer: plan.webcam,
            sourceEndSeconds: plan.sourceDurationSeconds,
            webcamImageOf,
            fillFps,
            cap,
            minFrameGap,
            prevOutTs,
            // Floating images over a still screen: the held frame is re-composed while one is
            // on screen (export-clip-frames.ts), so it shows at its own times with its fades.
            floatingLive: floatingItems
              ? (outTs) => floatingLiveAt(plan.floating, outTs)
              : undefined,
            compose,
            emit: addVideoFrame,
          });
        } finally {
          await webcamCursor?.close();
        }
      } else {
        // Slide segment: synthesize fixed-cadence frames at slideFps. These are
        // already monotonic by construction (fixed cadence from segment.timelineStart),
        // so they don't need rebaseVideoTimestamp's clamp/skip — just keep prevOutTs
        // current so a following clip segment's boundary check has the right value.
        // They go through the cap too: the first one may share a slot with the clip
        // frame before it.
        const bitmap = slideBitmaps.get(segment.assetId);
        const frameDuration = 1 / slideFps;
        const frameCount = Math.round(segment.duration * slideFps);

        for (let i = 0; i < frameCount; i++) {
          const outTs = segment.timelineStart + i * frameDuration;
          if (!cap.keep(outTs)) continue;
          // Slides are always contained ("fit"), never cropped, and carry no webcam.
          compose.slide(bitmap, outTs);
          await addVideoFrame(outTs, frameDuration);
          prevOutTs = outTs;
        }
      }
    }

    // Signal no more video frames — improves encoder flush latency, and lets the muxer write
    // the audio still to come without waiting for a video sample to pair it with.
    videoSource.close();

    // The audio still owed after the last video frame: whatever the lead did not reach, and
    // the resampler's tail. The pump closes the audio source when its timeline ends.
    await audio?.drain();

    await out.finalize();
    finalized = true;

    post({ type: "progress", fraction: 1 });
    post({ type: "done" });
  } finally {
    if (!finalized) {
      // Cancel releases Output encoders and the muxer on any error path;
      // Input decoders are freed by input.dispose() in the outer runExport finally; the
      // audio pump releases the decoder of the clip it was in the middle of.
      try {
        await out.cancel();
      } catch {
        /* already tearing down */
      }
      try {
        await audio?.dispose();
      } catch {
        /* already tearing down */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Probes the hardware AVC encoder for the preset's rate control and picks per
 * video-encoding.ts. The quantizer probe passes a quantizer-only Quality: with a bitrate
 * fallback in it, `canEncodeVideo` would say yes whenever the bitrate alone works.
 */
async function pickVideoEncoding(
  preset: ResolvedExportTarget,
  size: { width: number; height: number },
): Promise<VideoEncodingChoice> {
  const probe = (quality: Quality): Promise<boolean> =>
    canEncodeVideo("avc", {
      width: size.width,
      height: size.height,
      quality,
      hardwareAcceleration: "prefer-hardware",
      frameRate: preset.maxFps ?? undefined,
    }).catch(() => false);
  const hardwareQuantizer =
    preset.quantizer !== null && (await probe(new Quality({ quantizer: preset.quantizer })));
  const hardwareBitrate = hardwareQuantizer || (await probe(bitrateQuality(preset.videoBitrate)));
  return chooseVideoEncoding(preset, { hardwareQuantizer, hardwareBitrate });
}

/**
 * The bitrate as a mediabunny Quality. Maximum's "high" stays bitrate-driven
 * (`preferBitrate`): since mediabunny 1.52 a bare quality level would switch to quantizer mode,
 * and Maximum is meant to be the pre-preset export.
 */
function bitrateQuality(bitrate: number | "high"): Quality {
  return bitrate === "high"
    ? new Quality({ quality: "high", preferBitrate: true })
    : new Quality({ bitrate });
}

/** Quantizer with the bitrate as mediabunny's fallback, or the bitrate alone. */
function videoQuality(choice: VideoEncodingChoice): Quality {
  if (
    choice.rateControl === "quantizer" &&
    choice.quantizer !== null &&
    choice.bitrate !== "high"
  ) {
    return new Quality({ quantizer: choice.quantizer, bitrate: choice.bitrate });
  }
  return bitrateQuality(choice.bitrate);
}

/** The first AAC config the platform encoder accepts; the last one when none says yes. */
async function pickAudioEncoding(
  candidates: AudioEncoding[],
  sampleRate: number,
): Promise<AudioEncoding> {
  for (const candidate of candidates) {
    const ok = await canEncodeAudio("aac", {
      numberOfChannels: candidate.numberOfChannels,
      sampleRate,
      quality: new Quality({ bitrate: candidate.bitrate }),
    }).catch(() => false);
    if (ok) return candidate;
  }
  return candidates[candidates.length - 1]!;
}

/** What `audioPlan` needs to know about a recording's audio track (none: no audio). */
async function audioFacts(
  sourceId: string | null,
  track: InputAudioTrack | null,
): Promise<RecordingAudio> {
  return {
    sourceId,
    hasAudio: track !== null,
    sampleRate: track ? (await track.getSampleRate()) || 48000 : 48000,
    channels: track ? (await track.getNumberOfChannels()) || 2 : 2,
  };
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
