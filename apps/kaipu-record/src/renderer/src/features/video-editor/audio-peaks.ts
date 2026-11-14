/**
 * Loudness peaks of the recording's audio, reduced on the fly (NIW2-775).
 *
 * A 54-minute take decoded whole would hold over 1 GB of samples; reduced as it
 * streams, it holds {@link PEAK_BUCKETS_PER_SECOND} numbers per second (about 1.3 MB for
 * that take). Pure and DOM-free: the decode loop lives in `use-audio-peaks.ts`.
 */

/** Fine enough for the deepest zoom on a short clip, small enough for an hour-long take. */
export const PEAK_BUCKETS_PER_SECOND = 100;

/** Quieter than this, relative to the reference, draws as a stub. */
const FLOOR_DB = -48;

/** At most this many values are sorted to find the reference level of a long take. */
const REFERENCE_SAMPLE_LIMIT = 20_000;

/** Collects the largest absolute sample of each bucket, across channels. */
export class PeakAccumulator {
  readonly peaks: Float32Array;
  /** One past the highest bucket written: everything below it has been decoded. */
  filled = 0;

  constructor(durationSeconds: number) {
    const seconds = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
    this.peaks = new Float32Array(Math.ceil(seconds * PEAK_BUCKETS_PER_SECOND));
  }

  /** One plane of samples per channel, the first sample at `timestampSeconds`. */
  add(timestampSeconds: number, sampleRate: number, planes: Float32Array[]): void {
    if (!(sampleRate > 0)) return;
    const { peaks } = this;
    for (const plane of planes) {
      for (let i = 0; i < plane.length; i++) {
        const bucket = Math.floor((timestampSeconds + i / sampleRate) * PEAK_BUCKETS_PER_SECOND);
        if (bucket < 0 || bucket >= peaks.length) continue;
        const value = Math.abs(plane[i]!);
        if (value > peaks[bucket]!) peaks[bucket] = value;
        if (bucket >= this.filled) this.filled = bucket + 1;
      }
    }
  }

  /** Interleaved samples (`L R L R …` for two channels). */
  addInterleaved(
    timestampSeconds: number,
    sampleRate: number,
    data: Float32Array,
    channels: number,
  ): void {
    if (!(sampleRate > 0) || channels < 1) return;
    const { peaks } = this;
    const frames = Math.floor(data.length / channels);
    for (let frame = 0; frame < frames; frame++) {
      const bucket = Math.floor((timestampSeconds + frame / sampleRate) * PEAK_BUCKETS_PER_SECOND);
      if (bucket < 0 || bucket >= peaks.length) continue;
      let value = 0;
      for (let c = 0; c < channels; c++) {
        const abs = Math.abs(data[frame * channels + c]!);
        if (abs > value) value = abs;
      }
      if (value > peaks[bucket]!) peaks[bucket] = value;
      if (bucket >= this.filled) this.filled = bucket + 1;
    }
  }
}

/**
 * The level that draws as a full-height bar: the 99th percentile of the non-zero peaks, so
 * one loud click does not flatten everything else. 0 when the whole take is silent.
 */
export function referenceLevel(peaks: Float32Array, filled: number): number {
  const end = Math.min(filled, peaks.length);
  const step = Math.max(1, Math.floor(end / REFERENCE_SAMPLE_LIMIT));
  const values: number[] = [];
  let max = 0;
  for (let i = 0; i < end; i += step) {
    const value = peaks[i]!;
    if (value <= 0) continue;
    values.push(value);
    if (value > max) max = value;
  }
  if (values.length === 0) return 0;
  if (values.length < 20) return max;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * 0.99))]!;
}

/**
 * Bar height as a share of the lane, 0..1, on a decibel scale relative to `reference`:
 * 0 dB is 1 and -48 dB is 0. Speech peaks are often a fifth of full scale, so a linear
 * scale would draw them as stubs.
 */
export function levelToHeight(peak: number, reference: number): number {
  if (!(peak > 0) || !(reference > 0)) return 0;
  const db = 20 * Math.log10(peak / reference);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
}
