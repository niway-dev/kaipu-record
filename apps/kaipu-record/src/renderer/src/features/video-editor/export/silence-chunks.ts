/** The longest piece of silence the export worker allocates at once, in seconds. */
export const SILENCE_CHUNK_SECONDS = 1;

/**
 * The sizes, in frames, of the silence pieces that fill `durationSeconds` at `sampleRate`. They
 * add up to exactly what one allocation would have held (`ceil(duration * rate)`), so the audio
 * keeps its length, but no piece is longer than `SILENCE_CHUNK_SECONDS`: a 30-minute stereo clip
 * at 48 kHz is 690 MB as one Float32Array and 384 KB as pieces.
 */
export function silenceChunkFrames(durationSeconds: number, sampleRate: number): number[] {
  const total = Math.ceil(durationSeconds * sampleRate);
  if (!(total > 0)) return [];
  const chunk = Math.max(1, Math.round(sampleRate * SILENCE_CHUNK_SECONDS));
  const out: number[] = [];
  for (let left = total; left > 0; left -= chunk) out.push(Math.min(chunk, left));
  return out;
}
