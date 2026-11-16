import { AudioSampleSink } from "mediabunny";
import { openRecordingInput } from "@renderer/lib/open-recording-input";
import { TRANSCRIPTION_PCM_SAMPLE_RATE } from "@shared/types/transcription";
import { downmixToMono, floatToInt16, Resampler } from "./pcm-convert";

/** How much audio one yielded chunk holds: 4 s is 128000 bytes of 16 kHz mono 16-bit PCM. */
export const AUDIO_CHUNK_MS = 4000;

/** A sample this far past the audio produced so far means the track started or resumed late. */
const GAP_TOLERANCE_SECONDS = 0.02;

/** The recording has no audio track at all. */
export class NoAudioError extends Error {
  constructor() {
    super("The recording has no audio track");
    this.name = "NoAudioError";
  }
}

/** There is an audio track, but the decoder cannot read it (unsupported codec, broken data). */
export class UndecodableAudioError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UndecodableAudioError";
  }
}

function abortError(): DOMException {
  return new DOMException("Audio decoding was aborted", "AbortError");
}

/** Cuts a stream of int16 frames into chunks of a fixed length. */
class ChunkAssembler {
  readonly #chunkFrames: number;
  #chunk: Int16Array<ArrayBuffer>;
  #filled = 0;

  constructor(chunkFrames: number) {
    this.#chunkFrames = chunkFrames;
    this.#chunk = new Int16Array(chunkFrames);
  }

  *add(frames: Int16Array): Generator<ArrayBuffer> {
    let offset = 0;
    while (offset < frames.length) {
      const take = Math.min(this.#chunkFrames - this.#filled, frames.length - offset);
      this.#chunk.set(frames.subarray(offset, offset + take), this.#filled);
      this.#filled += take;
      offset += take;
      if (this.#filled === this.#chunkFrames) {
        yield this.#chunk.buffer;
        this.#chunk = new Int16Array(this.#chunkFrames);
        this.#filled = 0;
      }
    }
  }

  /** The last, shorter chunk; null when the audio ended exactly on a chunk boundary. */
  finish(): ArrayBuffer | null {
    return this.#filled > 0 ? this.#chunk.slice(0, this.#filled).buffer : null;
  }
}

/**
 * Decodes a recording's audio to 16 kHz mono signed 16-bit little-endian PCM, as chunks of
 * about `chunkMs`. The file is opened through the Range-aware media URL, decoded sequentially
 * and converted as it streams, so memory stays bounded whatever the duration: the decoder is
 * pulled only as fast as the consumer takes chunks.
 *
 * PCM time equals media time: a late audio start or a gap longer than 20 ms is filled with
 * silence, and audio stamped before zero is dropped.
 *
 * Throws `NoAudioError` without an audio track and `UndecodableAudioError` when the file or
 * the track cannot be read, including a decoder failure midway (chunks already yielded stay
 * valid). An aborted `signal` ends the stream with an `AbortError`, never with a quiet
 * `done`, so a consumer cannot mistake truncated audio for a complete recording. The input
 * is disposed on every exit, and also the moment the signal aborts, which interrupts a read
 * that is waiting on the file.
 */
export async function* decodeAudioToPcm(
  source: { url: string },
  options: {
    chunkMs?: number;
    signal?: AbortSignal;
    onDecoded?: (decodedMs: number) => void;
  } = {},
): AsyncGenerator<ArrayBuffer> {
  const { chunkMs = AUDIO_CHUNK_MS, signal, onDecoded } = options;
  if (signal?.aborted) throw abortError();

  const input = openRecordingInput(source.url);
  const onAbort = (): void => input.dispose();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new NoAudioError();
    if (!(await track.canDecode())) {
      throw new UndecodableAudioError("The audio track uses a codec this app cannot decode");
    }

    const assembler = new ChunkAssembler(
      Math.max(1, Math.round((chunkMs * TRANSCRIPTION_PCM_SAMPLE_RATE) / 1000)),
    );
    let resampler: Resampler | null = null;
    let rate = 0;
    /** Input-rate frames fed to the resampler so far, padding included: the media time reached. */
    let framesFed = 0;
    let silence = new Float32Array(0);
    const planeBuffers: Float32Array[] = [];

    function* feed(mono: Float32Array): Generator<ArrayBuffer> {
      framesFed += mono.length;
      yield* assembler.add(floatToInt16(resampler!.push(mono)));
    }

    for await (const sample of new AudioSampleSink(track).samples()) {
      if (signal?.aborted) {
        sample.close();
        throw abortError();
      }
      if (!resampler) {
        rate = sample.sampleRate;
        resampler = new Resampler(rate);
        silence = new Float32Array(rate);
      } else if (sample.sampleRate !== rate) {
        sample.close();
        throw new UndecodableAudioError(
          `The audio sample rate changed from ${rate} Hz to ${sample.sampleRate} Hz`,
        );
      }

      const frames = sample.numberOfFrames;
      const startFrame = Math.round(sample.timestamp * rate);
      const planes: Float32Array[] = [];
      try {
        for (let plane = 0; plane < sample.numberOfChannels; plane++) {
          let buffer = planeBuffers[plane];
          if (!buffer || buffer.length < frames)
            planeBuffers[plane] = buffer = new Float32Array(frames);
          const view = buffer.subarray(0, frames);
          sample.copyTo(view, { format: "f32-planar", planeIndex: plane });
          planes.push(view);
        }
      } finally {
        sample.close();
      }

      const skip = Math.min(Math.max(0, -startFrame), frames);
      const gap = startFrame + skip - framesFed;
      if (gap > GAP_TOLERANCE_SECONDS * rate) {
        for (let left = gap; left > 0; left -= silence.length) {
          yield* feed(silence.subarray(0, Math.min(left, silence.length)));
        }
      }
      if (skip < frames) {
        yield* feed(
          downmixToMono(skip === 0 ? planes : planes.map((plane) => plane.subarray(skip))),
        );
      }
      onDecoded?.((framesFed / rate) * 1000);
    }

    if (!resampler) throw new UndecodableAudioError("The audio track produced no samples");
    yield* assembler.add(floatToInt16(resampler.flush()));
    const last = assembler.finish();
    if (last) yield last;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (error instanceof NoAudioError || error instanceof UndecodableAudioError) throw error;
    throw new UndecodableAudioError("The audio could not be decoded", { cause: error });
  } finally {
    signal?.removeEventListener("abort", onAbort);
    input.dispose();
  }
}
