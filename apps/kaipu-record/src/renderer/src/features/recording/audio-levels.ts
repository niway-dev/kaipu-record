/**
 * Maps an AnalyserNode time-domain byte buffer to N bar heights (0..1) for the
 * control-bar mic meter. Pure: the AudioContext/AnalyserNode plumbing lives in
 * the hook; this is just the math, so it's unit-testable.
 *
 * Each bar is the RMS of one slice of the buffer, boosted for visual response
 * (quiet speech should still wiggle the bars) and clamped to 1.
 */
export function levelsFromTimeDomain(data: Uint8Array, bars = 5, boost = 25): number[] {
  const size = Math.max(1, Math.floor(data.length / bars));
  const out: number[] = [];
  for (let b = 0; b < bars; b++) {
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const norm = (data[b * size + i] - 128) / 128;
      sum += norm * norm;
    }
    out.push(Math.min(1, Math.sqrt(sum / size) * boost));
  }
  return out;
}
