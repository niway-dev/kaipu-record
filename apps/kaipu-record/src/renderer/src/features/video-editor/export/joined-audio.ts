/**
 * Joined recordings in the MP4 export's audio (ADR 0058). Which recordings carry audio, which
 * format the one track has, how a clip's audio is read in its own file's seconds, and how it
 * is converted to that format. The mute spans stay AXIS seconds; only the decoder reads local
 * ones.
 *
 * WORKER-BUNDLE INVARIANT, like joined-media.ts: pure and DOM-free; no mediabunny import.
 */
import type { SilencedSpan } from "../audio-edits";
import type { RenderSegment } from "./export-plan";
import { recordingsUsed } from "./export-recordings";
import type { ClipSource } from "./joined-media";

/** What the audio decision needs to know about one recording's file. */
export interface RecordingAudio {
  /** `SceneSource.id`, or null for the opened recording. */
  sourceId: string | null;
  hasAudio: boolean;
  sampleRate: number;
  channels: number;
}

export interface AudioReference {
  sourceId: string | null;
  sampleRate: number;
  channels: number;
}

export interface AudioPlan {
  /** The one track's format, or null when the MP4 has no audio track. */
  reference: AudioReference | null;
  /** One entry per plan segment: decode the clip's own audio, or write silence for it. */
  perSegment: Array<"decode" | "silence">;
}

/**
 * The MP4 has an audio track iff the scene is not muted and at least one recording a clip
 * reads has audio. Its format is the first such recording's, in plan order. A clip whose
 * recording has no audio, and every slide, is silence. A plan with no clip at all counts the
 * opened recording, as it always did.
 */
export function audioPlan(
  plan: { segments: readonly RenderSegment[]; audio: { audioMuted: boolean } },
  recordings: readonly RecordingAudio[],
): AudioPlan {
  const used = recordingsUsed(plan as { segments: readonly RenderSegment[] });
  const candidates = used.length > 0 ? used : [null];
  const facts = (id: string | null): RecordingAudio | undefined =>
    recordings.find((r) => r.sourceId === id);
  const hasAudio = (id: string | null): boolean => facts(id)?.hasAudio === true;
  const first = plan.audio.audioMuted ? undefined : candidates.find(hasAudio);
  if (first === undefined) {
    return { reference: null, perSegment: plan.segments.map(() => "silence") };
  }
  const ref = facts(first)!;
  return {
    reference: { sourceId: first, sampleRate: ref.sampleRate, channels: ref.channels },
    perSegment: plan.segments.map((s) =>
      s.kind === "clip" && hasAudio(s.sourceId) ? "decode" : "silence",
    ),
  };
}

/**
 * Whether a sample at local `[start, end)` of a file whose second 0 is axis `offset` overlaps
 * a muted span; the spans are in axis seconds.
 */
export function overlapsSilence(
  localStart: number,
  localEnd: number,
  offset: number,
  silenced: readonly SilencedSpan[],
): boolean {
  const start = localStart + offset;
  const end = localEnd + offset;
  return silenced.some((span) => start < span.end && end > span.start);
}

/** The clip's audio samples in its own recording's seconds, or null without an audio reader. */
export function clipAudioOf<S>(
  src: ClipSource,
  readers: ReadonlyMap<string | null, { samples(start: number, end: number): AsyncIterable<S> }>,
): AsyncIterable<S> | null {
  const reader = readers.get(src.key);
  return reader ? reader.samples(src.localStart, src.localEnd) : null;
}

/** Whether samples at `fromRate` need resampling to reach `toRate`; the same rate creates none. */
export function needsResampling(fromRate: number, toRate: number): boolean {
  return fromRate !== toRate;
}

/** Streaming linear resampler for one clip run; see {@link createResampler}. */
export interface Resampler {
  /** Resamples the next chunk (one plane per channel); may return fewer frames than due. */
  push(planes: Float32Array[]): Float32Array[];
  /** The frames still owed once the run ends, so the total length is exact. */
  flush(): Float32Array[];
}

/**
 * Linear resampling that carries its state across chunks. mediabunny resamples only whole
 * files (Conversion), not the samples an `AudioSampleSink` yields, so the worker feeds every
 * trimmed sample of one clip, in order, to one of these.
 *
 * Output frame `j` sits at input position `j * fromRate / toRate`, counted from the first
 * frame of the run, so the phase survives chunk boundaries: the last input frame is kept to
 * interpolate with the next chunk's first. The total is capped at
 * `round(totalIn * toRate / fromRate)` frames, so the cumulative length error stays below one
 * frame however many chunks arrive (rounding each chunk alone drifts by a fraction of a frame
 * per chunk, always in one direction). A frame whose right neighbour has not arrived yet waits
 * for the next push, or for `flush`, which holds the last frame.
 */
export function createResampler(fromRate: number, toRate: number, channels: number): Resampler {
  let tail: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(0));
  let tailStart = 0; // global input index of tail[c][0]
  let totalIn = 0;
  let totalOut = 0;

  const emit = (planes: Float32Array[], final: boolean): Float32Array[] => {
    const joined = tail.map((old, c) => {
      const next = planes[c] ?? new Float32Array(0);
      const all = new Float32Array(old.length + next.length);
      all.set(old, 0);
      all.set(next, old.length);
      return all;
    });
    totalIn += planes[0]?.length ?? 0;
    const target = Math.round((totalIn * toRate) / fromRate);
    const out: number[][] = Array.from({ length: channels }, () => []);
    let j = totalOut;
    for (; j < target; j++) {
      const scaled = j * fromRate;
      const rem = scaled % toRate;
      const lower = (scaled - rem) / toRate;
      const upper = rem > 0 ? lower + 1 : lower;
      if (!final && upper > totalIn - 1) break;
      const fraction = rem / toRate;
      for (let c = 0; c < channels; c++) {
        const plane = joined[c]!;
        const last = tailStart + plane.length - 1;
        const a = plane[lower - tailStart]!;
        const b = plane[Math.min(upper, last) - tailStart]!;
        out[c]!.push(a * (1 - fraction) + b * fraction);
      }
    }
    totalOut = j;
    // Keep from the lower neighbour of the next frame to emit.
    const keepFrom = Math.min(Math.floor((totalOut * fromRate) / toRate), totalIn);
    const drop = Math.max(0, keepFrom - tailStart);
    tail = joined.map((plane) => plane.slice(drop));
    tailStart += drop;
    return out.map((values) => Float32Array.from(values));
  };

  return {
    push: (planes) => emit(planes, false),
    flush: () =>
      emit(
        Array.from({ length: channels }, () => new Float32Array(0)),
        true,
      ),
  };
}

/**
 * Planar channels mapped to `toChannels`. Mono is duplicated up; more channels than wanted are
 * averaged into mono, or cut to the first `toChannels` when the target is not mono. The same
 * count returns the input unchanged.
 */
export function mapChannels(planes: Float32Array[], toChannels: number): Float32Array[] {
  if (planes.length === toChannels) return planes;
  if (toChannels === 1) {
    const frames = planes[0]?.length ?? 0;
    const mono = new Float32Array(frames);
    for (const plane of planes) for (let i = 0; i < frames; i++) mono[i] += plane[i]!;
    for (let i = 0; i < frames; i++) mono[i] /= planes.length;
    return [mono];
  }
  if (planes.length === 1) return Array.from({ length: toChannels }, () => planes[0]!);
  return Array.from({ length: toChannels }, (_, c) => planes[Math.min(c, planes.length - 1)]!);
}

/** Planar channels as one interleaved array (frame 0 of each channel, then frame 1, ...). */
export function interleave(planes: readonly Float32Array[]): Float32Array {
  const channels = planes.length;
  const frames = planes[0]?.length ?? 0;
  const out = new Float32Array(frames * channels);
  for (let c = 0; c < channels; c++) {
    const plane = planes[c]!;
    for (let i = 0; i < frames; i++) out[i * channels + c] = plane[i]!;
  }
  return out;
}
