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

/**
 * Linear resampling of one channel. mediabunny resamples only whole files (Conversion), not
 * the samples an `AudioSampleSink` yields, so the worker converts per sample with this. The
 * length follows the duration, within one sample.
 */
export function resampleLinear(
  plane: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || plane.length === 0) return plane;
  const length = Math.max(1, Math.round((plane.length * toRate) / fromRate));
  const out = new Float32Array(length);
  const step = fromRate / toRate;
  const last = plane.length - 1;
  for (let i = 0; i < length; i++) {
    const position = Math.min(i * step, last);
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, last);
    const fraction = position - lower;
    out[i] = plane[lower]! * (1 - fraction) + plane[upper]! * fraction;
  }
  return out;
}

/**
 * Planar channels converted to `toChannels` and `toRate`. Mono is duplicated up; more channels
 * than wanted are averaged into mono, or cut to the first `toChannels` when the target is not
 * mono. The same format returns the input unchanged.
 */
export function convertPlanar(
  planes: Float32Array[],
  fromRate: number,
  toRate: number,
  toChannels: number,
): Float32Array[] {
  if (fromRate === toRate && planes.length === toChannels) return planes;
  let channels = planes;
  if (planes.length !== toChannels) {
    if (toChannels === 1) {
      const frames = planes[0]?.length ?? 0;
      const mono = new Float32Array(frames);
      for (const plane of planes) for (let i = 0; i < frames; i++) mono[i] += plane[i]!;
      for (let i = 0; i < frames; i++) mono[i] /= planes.length;
      channels = [mono];
    } else if (planes.length === 1) {
      channels = Array.from({ length: toChannels }, () => planes[0]!);
    } else {
      channels = Array.from(
        { length: toChannels },
        (_, c) => planes[Math.min(c, planes.length - 1)]!,
      );
    }
  }
  return channels.map((plane) => resampleLinear(plane, fromRate, toRate));
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
