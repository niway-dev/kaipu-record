/**
 * Raw PCM files: little-endian signed 16-bit, mono, 16 kHz, no header (`*.pcm16`). The renderer
 * decodes a recording once and streams the samples here; every later step reads ranges of the file
 * instead of holding 60 minutes (115 MB) in memory. Little-endian hosts only (every platform
 * Electron ships for), so an `Int16Array` view over the file bytes is the file's own sample order.
 */
import { open, rm, stat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

export const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
const SAMPLES_PER_MS = SAMPLE_RATE / 1000;

/** Frames per read while computing levels: 1000 x 20 ms = 640 KB. */
const DEFAULT_CHUNK_FRAMES = 1000;

function sampleIndex(ms: number): number {
  return Math.max(0, Math.round(ms * SAMPLES_PER_MS));
}

/** Duration of the file in whole milliseconds (a trailing odd byte is not a sample). */
export async function pcmDurationMs(path: string): Promise<number> {
  const { size } = await stat(path);
  return Math.round(Math.floor(size / BYTES_PER_SAMPLE) / SAMPLES_PER_MS);
}

/** Reads `[startMs, endMs)`, clamped to the file. Only that range is read from disk. */
export async function readPcm(path: string, startMs: number, endMs: number): Promise<Int16Array> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const total = Math.floor(size / BYTES_PER_SAMPLE);
    const from = Math.min(sampleIndex(startMs), total);
    const to = Math.min(sampleIndex(endMs), total);
    return await readSamples(handle, from, to);
  } finally {
    await handle.close();
  }
}

async function readSamples(handle: FileHandle, from: number, to: number): Promise<Int16Array> {
  const count = Math.max(0, to - from);
  const out = new Int16Array(count);
  const bytes = new Uint8Array(out.buffer);
  let done = 0;
  while (done < bytes.length) {
    const { bytesRead } = await handle.read(
      bytes,
      done,
      bytes.length - done,
      from * BYTES_PER_SAMPLE + done,
    );
    if (bytesRead === 0) break; // the file shrank under us
    done += bytesRead;
  }
  return done === bytes.length ? out : out.slice(0, Math.floor(done / BYTES_PER_SAMPLE));
}

function wavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

/** Writes `[startMs, endMs)` of the PCM file as a 16 kHz mono WAV (44-byte header + samples). */
export async function writeSegmentWav(
  pcmPath: string,
  startMs: number,
  endMs: number,
  outWavPath: string,
): Promise<void> {
  const samples = await readPcm(pcmPath, startMs, endMs);
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  await writeFile(outWavPath, Buffer.concat([wavHeader(data.length), data]));
}

/**
 * Per-frame RMS in dBFS (frame = hop = `frameMs`), read in chunks: working memory is one chunk
 * (640 KB by default) plus the result (4 bytes a frame, 0.7 MB an hour). A trailing partial
 * frame is dropped, as in the spike.
 */
export async function computeFrameLevelsDb(
  pcmPath: string,
  frameMs = 20,
  options: { chunkFrames?: number } = {},
): Promise<Float32Array> {
  const frameSamples = Math.max(1, Math.round(SAMPLES_PER_MS * frameMs));
  const chunkFrames = Math.max(1, Math.floor(options.chunkFrames ?? DEFAULT_CHUNK_FRAMES));
  const handle = await open(pcmPath, "r");
  try {
    const { size } = await handle.stat();
    const totalFrames = Math.floor(Math.floor(size / BYTES_PER_SAMPLE) / frameSamples);
    const levels = new Float32Array(totalFrames);
    const buffer = new Int16Array(Math.min(chunkFrames, Math.max(1, totalFrames)) * frameSamples);
    const bytes = new Uint8Array(buffer.buffer);
    for (let frame = 0; frame < totalFrames; ) {
      const frames = Math.min(chunkFrames, totalFrames - frame, buffer.length / frameSamples);
      const wanted = frames * frameSamples * BYTES_PER_SAMPLE;
      let done = 0;
      while (done < wanted) {
        const { bytesRead } = await handle.read(
          bytes,
          done,
          wanted - done,
          frame * frameSamples * BYTES_PER_SAMPLE + done,
        );
        if (bytesRead === 0) throw new Error(`${pcmPath}: file shrank while reading levels`);
        done += bytesRead;
      }
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        const base = f * frameSamples;
        for (let i = 0; i < frameSamples; i++) {
          const v = buffer[base + i]! / 32768;
          sum += v * v;
        }
        levels[frame + f] = 10 * Math.log10(sum / frameSamples + 1e-12);
      }
      frame += frames;
    }
    return levels;
  } finally {
    await handle.close();
  }
}

/**
 * Receives the decoded audio from the renderer chunk by chunk and writes it to `path`. Appends
 * are serialized, so callers may fire them without awaiting each one. A byte chunk may end in the
 * middle of a sample: the odd byte is held until the next chunk completes it.
 */
export class PcmWriter {
  private handle: FileHandle | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private bytesWritten = 0;
  private carry: number | null = null;
  private closed = false;
  private finished = false;

  constructor(private readonly path: string) {}

  append(chunk: Int16Array | Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error("PcmWriter is closed"));
    const bytes =
      chunk instanceof Uint8Array
        ? chunk
        : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    return this.enqueue(async () => {
      if (this.closed) throw new Error("PcmWriter is closed");
      this.handle ??= await open(this.path, "w");
      let data = bytes;
      if (this.carry !== null) {
        const joined = new Uint8Array(data.length + 1);
        joined[0] = this.carry;
        joined.set(data, 1);
        data = joined;
        this.carry = null;
      }
      if (data.length % BYTES_PER_SAMPLE === 1) {
        this.carry = data[data.length - 1]!;
        data = data.subarray(0, data.length - 1);
      }
      let done = 0;
      while (done < data.length) {
        const { bytesWritten } = await this.handle.write(data, done, data.length - done);
        done += bytesWritten;
      }
      this.bytesWritten += data.length;
    });
  }

  /** Flushes and closes the file. A dangling odd byte is not a sample and is dropped. */
  async finish(): Promise<{ path: string; durationMs: number }> {
    await this.enqueue(async () => {
      if (this.closed) throw new Error("PcmWriter is closed");
      this.closed = true;
      this.handle ??= await open(this.path, "w");
      const handle = this.handle;
      this.handle = null;
      try {
        await handle.sync();
      } finally {
        // Closed even when the flush failed, so `abort` has no handle left to hold the file open.
        await handle.close();
      }
      // Only after a clean close: a failed finish still lets `abort` delete the partial file.
      this.finished = true;
    });
    return {
      path: this.path,
      durationMs: Math.round(this.bytesWritten / BYTES_PER_SAMPLE / SAMPLES_PER_MS),
    };
  }

  /** Closes and deletes the partial file. Safe to call more than once; a no-op after `finish`. */
  async abort(): Promise<void> {
    this.closed = true;
    await this.enqueue(async () => {
      if (this.finished) return;
      await this.handle?.close().catch(() => {});
      this.handle = null;
      await rm(this.path, { force: true });
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    this.tail = run.catch(() => undefined);
    return run;
  }
}
