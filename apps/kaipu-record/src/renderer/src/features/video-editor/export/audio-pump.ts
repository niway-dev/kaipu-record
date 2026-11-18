/**
 * The MP4 export's audio, produced on demand (NIW2-806) instead of in one pass after the video.
 *
 * mediabunny's muxer interleaves tracks by timestamp: a sample leaves its queue only once every
 * open track has one queued, so video fed far ahead of audio waits in RAM (a real take reached
 * 6.5 GB with a 28-byte file on disk). The export worker therefore asks this pump for audio up to
 * a little past each video frame, and drains the rest after the last frame.
 *
 * What each sample goes through is unchanged from the old single pass (trim to the cut, convert
 * to the reference format, zero the muted spans, downmix, silence for slides and for clips
 * without audio, a contiguous cursor from 0): only WHEN a sample is produced changed.
 *
 * Audio timestamps: `AudioSampleSource.add` honors each sample's OWN timestamp (it does NOT
 * auto-advance like `AudioBufferSource`). Every emitted sample is rebased onto one contiguous
 * `audioCursor`, so cuts stay gapless and monotonic: the audio analogue of `prevOutTs` on the
 * video pass. That cursor and the video's `outTs` (a segment's `timelineStart` plus the offset
 * into it) are the same output timeline, which is what lets the worker interleave by time.
 *
 * Audio trimming: `AudioSampleSink.samples(start, end)` yields whole decoder samples gated on
 * each sample's OWN timestamp (mediabunny's `BaseMediaSampleSink.mediaSamplesInRange` keeps the
 * last sample with timestamp <= start, then everything up to the first sample with
 * timestamp >= end) — it does not clip a sample's PCM content to the range. Left as-is, the
 * first sample of a clip carries pre-roll before `start` and the last trails past `end`,
 * drifting audio out of sync with the frame-accurate video across cuts. `trimAudioSample`
 * clips each sample to the segment's exact range.
 */
import { AudioSample } from "mediabunny";
import { silencedSpansFor, type AudioEdits, type SilencedSpan } from "../audio-edits";
import type { RenderSegment } from "./export-plan";
import {
  clipAudioOf,
  createResampler,
  interleave,
  mapChannels,
  needsResampling,
  overlapsSilence,
  placeFlushed,
  type AudioReference,
  type Resampler,
} from "./joined-audio";
import { clipSource, type ClipSource, type JoinedClipRef } from "./joined-media";
import { silenceChunkFrames } from "./silence-chunks";

/**
 * How far past a video frame's timestamp the audio is produced before that frame is added, in
 * seconds. The muxer holds whatever is ahead of the slower track, so this lead times the video
 * bitrate bounds the video that waits in RAM. A larger lead buys no speed: the video encoder
 * makes about 8 MB/s while the disk takes about 500 MB/s, so the encoder is always the limit.
 */
export const AUDIO_LEAD_SECONDS = 1;

/** Where the pump hands its samples: the output's `AudioSampleSource`. */
export interface AudioSink {
  add(sample: AudioSample): Promise<unknown>;
  /** Called once, as soon as the audio timeline has been produced to its end. */
  close(): void;
}

export interface AudioPumpOptions {
  segments: readonly RenderSegment[];
  /** One entry per segment: decode the clip's own audio, or write silence for it. */
  perSegment: readonly ("decode" | "silence")[];
  edits: AudioEdits;
  joined: readonly JoinedClipRef[];
  /** The clips' audio, per recording (null: the opened one), in that file's own seconds. */
  readers: ReadonlyMap<
    string | null,
    { samples(start: number, end: number): AsyncIterable<AudioSample> }
  >;
  /** The track's format; every clip is converted to it. */
  reference: AudioReference;
  /** Sample rate and channel count of the synthesized silence. */
  silenceSampleRate: number;
  silenceChannelCount: number;
  /** Light: fold every channel into one. */
  downmix: boolean;
  sink: AudioSink;
}

export interface AudioPump {
  /** Produces audio until the cursor reaches at least `t` seconds, or the timeline ends. */
  advanceTo(t: number): Promise<void>;
  /** Produces everything left, including the resampler's tail, and closes the sink. */
  drain(): Promise<void>;
  /** Releases the decoder of a run in progress; for an export that ends early. */
  dispose(): Promise<void>;
  /** The output time the audio has reached, in seconds. */
  readonly cursor: number;
  /** Whether the whole audio timeline has been produced. */
  readonly done: boolean;
}

/** The segment being produced: bounded pieces of silence, or one clip's decoded samples. */
type Run =
  | { kind: "silence"; pieces: number[]; next: number }
  | {
      kind: "decode";
      src: ClipSource;
      silenced: SilencedSpan[];
      iterator: AsyncIterator<AudioSample>;
      // One resampler per clip run, created on the first sample whose rate differs from the
      // reference, so the phase and the total length survive the chunk boundaries. The same
      // rate never creates one.
      resampler: Resampler | null;
      lastEnd: number;
      // Frames the resampler has produced for this run, so its flush stays inside the clip.
      resampledFrames: number;
    };

export function createAudioPump(opts: AudioPumpOptions): AudioPump {
  const { reference, sink } = opts;
  let audioCursor = 0;
  let segmentIndex = 0;
  let run: Run | null = null;
  let done = false;

  const addSample = async (sample: AudioSample): Promise<void> => {
    sample.setTimestamp(audioCursor);
    audioCursor += sample.duration;
    await sink.add(sample);
  };

  const emitConverted = async (
    converted: AudioSample,
    start: number,
    end: number,
    r: Extract<Run, { kind: "decode" }>,
  ): Promise<void> => {
    const muted = overlapsSilence(start, end, r.src.offset, r.silenced);
    const shaped = opts.downmix ? downmixToMono(converted) : converted;
    const emitted = muted ? zeroedLike(shaped) : shaped;
    await addSample(emitted);
    if (emitted !== shaped) emitted.close();
    if (shaped !== converted) shaped.close();
  };

  const startRun = (): Run => {
    const segment = opts.segments[segmentIndex]!;
    // Slides, and clips of a recording without audio, are silence of the segment's length.
    const silence = (): Run => ({
      kind: "silence",
      // In bounded pieces: one clip of silence can be half an hour, and as a single array
      // that is hundreds of megabytes inside the worker.
      pieces: silenceChunkFrames(segment.duration, opts.silenceSampleRate),
      next: 0,
    });
    if (segment.kind !== "clip" || opts.perSegment[segmentIndex] !== "decode") return silence();
    // The decoder reads the clip's own recording in LOCAL seconds.
    const src = clipSource(segment, opts.joined);
    const decoded = clipAudioOf(src, opts.readers);
    if (!decoded) return silence();
    return {
      kind: "decode",
      src,
      // Muted spans of THIS segment, clipped and merged, in AXIS seconds. Walking them in
      // order lets each decoded sample be zeroed in place rather than dropped: dropping would
      // shorten the audio and drift it out of sync with the video, which is silence's whole
      // job to avoid.
      silenced: silencedSpansFor(segment.sourceStart, segment.sourceEnd, opts.edits),
      iterator: decoded[Symbol.asyncIterator](),
      resampler: null,
      lastEnd: src.localStart,
      resampledFrames: 0,
    };
  };

  /** The frames the resampler still owes, so the clip's audio ends where its video does. */
  const flushRun = async (r: Extract<Run, { kind: "decode" }>): Promise<void> => {
    const owed = r.resampler?.flush();
    const placed =
      owed &&
      placeFlushed(owed, {
        emittedFrames: r.resampledFrames,
        lastEnd: r.lastEnd,
        localStart: r.src.localStart,
        localEnd: r.src.localEnd,
        toRate: reference.sampleRate,
      });
    if (placed) {
      const tail = planesToSample(placed.planes, reference, placed.start);
      await emitConverted(tail, placed.start, placed.end, r);
      tail.close();
    }
  };

  const consume = async (r: Extract<Run, { kind: "decode" }>, sample: AudioSample) => {
    // Clip each decoded sample to the segment's exact (local) range — see the header comment.
    const trimmed = trimAudioSample(sample, r.src.localStart, r.src.localEnd);
    if (trimmed) {
      const start = trimmed.timestamp;
      const end = start + trimmed.duration;
      r.lastEnd = end;
      if (!r.resampler && needsResampling(trimmed.sampleRate, reference.sampleRate)) {
        r.resampler = createResampler(trimmed.sampleRate, reference.sampleRate, reference.channels);
      }
      const converted = toReferenceFormat(trimmed, reference, r.resampler);
      if (converted) {
        if (r.resampler) r.resampledFrames += converted.numberOfFrames;
        await emitConverted(converted, start, end, r);
        if (converted !== trimmed) converted.close();
      }
      if (trimmed !== sample) trimmed.close();
    }
    sample.close();
  };

  /** One unit of work: a silence piece, a decoded sample, or the end of a run. */
  const step = async (): Promise<void> => {
    if (!run) {
      if (segmentIndex >= opts.segments.length) {
        done = true;
        sink.close();
        return;
      }
      run = startRun();
    }
    if (run.kind === "silence") {
      const frames = run.pieces[run.next++];
      if (frames === undefined) {
        run = null;
        segmentIndex++;
        return;
      }
      // A zeroed interleaved-f32 sample keeps A/V durations aligned so the MP4 muxer
      // doesn't produce a track-length mismatch.
      const silence = new AudioSample({
        data: new Float32Array(frames * opts.silenceChannelCount),
        format: "f32",
        numberOfChannels: opts.silenceChannelCount,
        sampleRate: opts.silenceSampleRate,
        timestamp: audioCursor,
      });
      await addSample(silence);
      silence.close();
      return;
    }
    const next = await run.iterator.next();
    if (next.done) {
      const finished = run;
      run = null;
      segmentIndex++;
      await flushRun(finished);
      return;
    }
    await consume(run, next.value);
  };

  return {
    async advanceTo(t) {
      while (!done && audioCursor < t) await step();
    },
    async drain() {
      while (!done) await step();
    },
    async dispose() {
      const active = run;
      run = null;
      if (active?.kind === "decode") await active.iterator.return?.();
    },
    get cursor() {
      return audioCursor;
    },
    get done() {
      return done;
    },
  };
}

/**
 * Clips a decoded audio sample's data to `[rangeStart, rangeEnd)`.
 * `sample.timestamp` is the sample's own start time, which per the header comment may fall
 * before `rangeStart` (pre-roll) or extend past `rangeEnd` (trailing frames) — both need to be
 * dropped so the encoded duration matches the segment's exact source range.
 *
 * Returns the original `AudioSample` unchanged when it needs no trimming (the
 * common case for interior samples), a new trimmed `AudioSample` when it does
 * (the caller closes it), or `null` if trimming leaves nothing to encode.
 */
export function trimAudioSample(
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
 * Light (NIW2-218): average every channel into one. A mono source passes through
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

/**
 * The sample in the reference recording's channel count and sample rate. The same format
 * returns the sample itself (the common case, and always so without joins); otherwise a new
 * sample, which the caller closes, or null when the resampler has no frame due yet. A
 * differing rate comes with the clip run's `resampler`.
 */
function toReferenceFormat(
  sample: AudioSample,
  reference: AudioReference,
  resampler: Resampler | null,
): AudioSample | null {
  if (
    sample.sampleRate === reference.sampleRate &&
    sample.numberOfChannels === reference.channels
  ) {
    return sample;
  }
  const frames = sample.numberOfFrames;
  const planes: Float32Array[] = [];
  for (let c = 0; c < sample.numberOfChannels; c++) {
    const plane = new Float32Array(frames);
    sample.copyTo(plane, { planeIndex: c, format: "f32-planar" });
    planes.push(plane);
  }
  const mapped = mapChannels(planes, reference.channels);
  const converted = resampler ? resampler.push(mapped) : mapped;
  if ((converted[0]?.length ?? 0) === 0) return null;
  return planesToSample(converted, reference, sample.timestamp);
}

function planesToSample(
  planes: Float32Array[],
  reference: AudioReference,
  timestamp: number,
): AudioSample {
  return new AudioSample({
    data: interleave(planes),
    format: "f32",
    numberOfChannels: reference.channels,
    sampleRate: reference.sampleRate,
    timestamp,
  });
}

/** The video side of the output, as the feed below needs it: the `VideoSource` in the worker. */
export interface VideoSink {
  add(timestamp: number, duration: number): Promise<unknown>;
  close(): void;
}

export interface InterleavedFeed {
  /**
   * Adds one video frame, then produces the audio up to AUDIO_LEAD_SECONDS past it. The frame goes
   * first so it is already queued while the audio crosses the gap to the next frame.
   */
  frame(timestamp: number, duration: number): Promise<void>;
  /** After the last frame: closes the video, then produces the audio still owed. */
  finish(): Promise<void>;
}

/**
 * The order the muxer is fed in. mediabunny's muxer writes samples in timestamp order across
 * tracks and keeps whatever is ahead of the slower track in RAM until that track catches up,
 * so each frame is added first and the audio is then produced up to AUDIO_LEAD_SECONDS past it.
 * Its guide asks for exactly this ("add media in a somewhat interleaved way to keep memory usage
 * low", https://mediabunny.dev/guide/writing-media-files). Feeding all the video first held the
 * whole encoded video in the worker (6.5 GB on a real take) while the file on disk stayed empty.
 *
 * The frame must be queued BEFORE the audio crosses the gap to the next frame. The muxer holds
 * a track's samples while another open track has nothing queued, and frames can be far apart
 * (a still screen with no webcam or floating images emits none in between: frames at 0 s and
 * 600 s). Advancing the audio to 601 s first would leave the video queue empty while 600 s of
 * encoded audio arrive and wait in RAM. With the frame at t queued, each audio sample below t is
 * written as it arrives, so memory follows the lead, not the gap.
 *
 * Closing the video before the drain lets the muxer write the remaining audio without waiting
 * for a video sample to pair it with. `audio` is null for an export without an audio track.
 */
export function createInterleavedFeed(
  audio: Pick<AudioPump, "advanceTo" | "drain"> | null,
  video: VideoSink,
): InterleavedFeed {
  return {
    async frame(timestamp, duration) {
      await video.add(timestamp, duration);
      await audio?.advanceTo(timestamp + AUDIO_LEAD_SECONDS);
    },
    async finish() {
      video.close();
      await audio?.drain();
    },
  };
}
