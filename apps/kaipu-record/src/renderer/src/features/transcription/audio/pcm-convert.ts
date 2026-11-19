import { TRANSCRIPTION_PCM_SAMPLE_RATE } from "@shared/types/transcription";

/** Average of the channels, sample by sample. A single channel is returned as is, not copied. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const mono = new Float32Array(first.length);
  for (const channel of channels) {
    for (let i = 0; i < mono.length; i++) mono[i]! += channel[i]!;
  }
  const scale = 1 / channels.length;
  for (let i = 0; i < mono.length; i++) mono[i]! *= scale;
  return mono;
}

/**
 * Float samples in [-1, 1] to signed 16-bit PCM. Both signs scale by 32767 so a positive and
 * a negative full-scale value stay symmetric. The result is read through its `buffer`, which
 * is little-endian on every machine the app runs on (arm64 and x64).
 */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = Math.round(clamped * 32767);
  }
  return out;
}

/** Fractional-delay positions per input sample; the kernel is tabulated at each one. */
const PHASES = 1024;
/** Lobes of the sinc kept on each side of the centre, counted in the cutoff's own period. */
const ZERO_CROSSINGS = 10;
/** Kaiser shape: about 70 dB of stopband rejection, which is far below speech energy. */
const KAISER_BETA = 7;
/** Pass up to this fraction of the output's Nyquist so the transition band ends before it. */
const CUTOFF_FRACTION = 0.94;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

/**
 * Streaming sample-rate converter to 16 kHz.
 *
 * It is a windowed-sinc (Kaiser) low-pass evaluated only at the output instants, which is
 * the polyphase form of "low-pass, then decimate": the input is never filtered at its own
 * rate and thrown away. Linear interpolation would be cheaper, but it leaves almost no
 * rejection above the new Nyquist, so anything between 8 and 24 kHz folds down into the
 * speech band as audible-to-the-engine noise. The kernel is tabulated at `PHASES` fractional
 * delays and each output takes the nearest one: an error of 1/2048 of an input sample, far
 * below the filter's own ripple. Taps run on typed arrays with no per-sample allocation, so
 * an hour of stereo 48 kHz audio costs seconds.
 *
 * Output instant k sits at input position k * rate / 16000, computed in integers so a long
 * stream does not drift. The first outputs see zeros before the stream starts and `flush`
 * sees zeros after it, so the length is exactly `round(frames * 16000 / rate)`.
 * State carries across `push` calls: the unconsumed tail of the input is kept, so a chunk
 * seam is the same arithmetic as any other sample.
 */
export class Resampler {
  readonly #rate: number;
  readonly #halfTaps: number;
  readonly #table: Float32Array;
  #work = new Float32Array(0);
  /** Valid samples in `#work`. */
  #workLength = 0;
  /** Absolute input index of `#work[0]`. */
  #workStart = 0;
  #totalInput = 0;
  #nextOutput = 0;

  constructor(inputRate: number) {
    if (!Number.isInteger(inputRate) || inputRate <= 0) {
      throw new RangeError(`Sample rate must be a positive integer, got ${inputRate}`);
    }
    this.#rate = inputRate;
    const cutoff = CUTOFF_FRACTION * Math.min(1, TRANSCRIPTION_PCM_SAMPLE_RATE / inputRate);
    this.#halfTaps = Math.ceil(ZERO_CROSSINGS / cutoff);
    this.#table = buildKernelTable(cutoff, this.#halfTaps);
    this.#reset();
  }

  #reset(): void {
    // Virtual silence before the stream: the first output's left taps read these zeros.
    this.#workStart = -this.#halfTaps;
    this.#workLength = this.#halfTaps;
    this.#work.fill(0, 0, this.#workLength);
    this.#totalInput = 0;
    this.#nextOutput = 0;
  }

  push(chunk: Float32Array): Float32Array {
    if (this.#rate === TRANSCRIPTION_PCM_SAMPLE_RATE) return new Float32Array(chunk);
    if (chunk.length === 0) return new Float32Array(0);
    this.#append(chunk);
    this.#totalInput += chunk.length;
    const available = this.#workStart + this.#workLength;
    // Output k needs input up to index floor(k * rate / 16000) + halfTaps, so k * rate must be
    // below (available - halfTaps) * 16000.
    const limit = (available - this.#halfTaps) * TRANSCRIPTION_PCM_SAMPLE_RATE;
    const endOutput = limit > 0 ? Math.floor((limit - 1) / this.#rate) + 1 : 0;
    return this.#produce(endOutput);
  }

  flush(): Float32Array {
    if (this.#rate === TRANSCRIPTION_PCM_SAMPLE_RATE) return new Float32Array(0);
    this.#append(new Float32Array(this.#halfTaps));
    const endOutput = Math.round((this.#totalInput * TRANSCRIPTION_PCM_SAMPLE_RATE) / this.#rate);
    const out = this.#produce(endOutput);
    this.#reset();
    return out;
  }

  #append(chunk: Float32Array): void {
    const needed = this.#workLength + chunk.length;
    if (needed > this.#work.length) {
      const grown = new Float32Array(Math.max(needed, this.#work.length * 2));
      grown.set(this.#work.subarray(0, this.#workLength));
      this.#work = grown;
    }
    this.#work.set(chunk, this.#workLength);
    this.#workLength = needed;
  }

  #produce(endOutput: number): Float32Array {
    const first = this.#nextOutput;
    const count = Math.max(0, endOutput - first);
    const out = new Float32Array(count);
    const taps = this.#halfTaps * 2;
    const work = this.#work;
    const table = this.#table;
    const rate = this.#rate;
    const base = TRANSCRIPTION_PCM_SAMPLE_RATE;
    let position = first * rate;
    for (let i = 0; i < count; i++) {
      const remainder = position % base;
      const centre = (position - remainder) / base;
      const row = Math.floor((remainder * PHASES + base / 2) / base) * taps;
      const start = centre - this.#halfTaps + 1 - this.#workStart;
      let acc = 0;
      for (let j = 0; j < taps; j++) acc += work[start + j]! * table[row + j]!;
      out[i] = acc;
      position += rate;
    }
    this.#nextOutput = first + count;
    this.#discardConsumed();
    return out;
  }

  /** Keeps only the input the next output still reads, so memory does not grow with duration. */
  #discardConsumed(): void {
    const keepFrom =
      Math.floor((this.#nextOutput * this.#rate) / TRANSCRIPTION_PCM_SAMPLE_RATE) -
      this.#halfTaps +
      1;
    const drop = Math.min(Math.max(0, keepFrom - this.#workStart), this.#workLength);
    if (drop === 0) return;
    this.#work.copyWithin(0, drop, this.#workLength);
    this.#workLength -= drop;
    this.#workStart += drop;
  }
}

/** `PHASES + 1` rows of `2 * halfTaps` weights; row p is the kernel for a delay of p / PHASES. */
function buildKernelTable(cutoff: number, halfTaps: number): Float32Array {
  const taps = halfTaps * 2;
  const table = new Float32Array((PHASES + 1) * taps);
  const window0 = besselI0(KAISER_BETA);
  for (let phase = 0; phase <= PHASES; phase++) {
    const fraction = phase / PHASES;
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      // Tap j reads input index centre - halfTaps + 1 + j, which is this far from the output.
      const x = fraction + halfTaps - 1 - j;
      const arg = Math.PI * cutoff * x;
      const sinc = x === 0 ? 1 : Math.sin(arg) / arg;
      const ratio = x / halfTaps;
      const weight =
        (cutoff * sinc * besselI0(KAISER_BETA * Math.sqrt(Math.max(0, 1 - ratio * ratio)))) /
        window0;
      table[phase * taps + j] = weight;
      sum += weight;
    }
    // Unit gain at DC for every phase, so the delay does not modulate the level.
    for (let j = 0; j < taps; j++) table[phase * taps + j]! /= sum;
  }
  return table;
}
