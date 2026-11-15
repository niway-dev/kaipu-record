/**
 * 16 kHz mono 16-bit PCM WAV helpers. The spike reads the whole file into one Int16Array:
 * 60 minutes is 115 MB, which is fine for a measurement script.
 */
import { readFileSync, writeFileSync } from "node:fs";

export const SAMPLE_RATE = 16000;

export function readWav(path: string): Int16Array {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path}: not a RIFF/WAVE file`);
  }
  let offset = 12;
  let rate = 0;
  let channels = 0;
  let bits = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(offset + 10);
      rate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      if (rate !== SAMPLE_RATE || channels !== 1 || bits !== 16) {
        throw new Error(`${path}: need 16 kHz mono s16, got ${rate} Hz ${channels} ch ${bits} bit`);
      }
      const end = Math.min(offset + 8 + size, buf.length);
      const bytes = buf.subarray(offset + 8, end - ((end - offset - 8) % 2));
      return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${path}: no data chunk`);
}

export function writeWav(path: string, samples: Int16Array): void {
  const dataBytes = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  writeFileSync(
    path,
    Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, dataBytes)]),
  );
}

/** Per-frame RMS in dBFS. Frame = hop = `frameMs`. */
export function frameLevelsDb(samples: Int16Array, frameMs: number): Float32Array {
  const frame = Math.round((SAMPLE_RATE * frameMs) / 1000);
  const count = Math.floor(samples.length / frame);
  const out = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    let sum = 0;
    const start = f * frame;
    for (let i = 0; i < frame; i++) {
      const v = samples[start + i]! / 32768;
      sum += v * v;
    }
    out[f] = 10 * Math.log10(sum / frame + 1e-12);
  }
  return out;
}
