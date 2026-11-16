import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PcmWriter,
  SAMPLE_RATE,
  computeFrameLevelsDb,
  pcmDurationMs,
  readPcm,
  writeSegmentWav,
} from "./pcm";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kaipu-pcm-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Samples whose value is their own index (mod 2^15), so any misplaced read shows. */
function ramp(count: number): Int16Array {
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) out[i] = i & 0x7fff;
  return out;
}

async function writePcm(name: string, samples: Int16Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  return path;
}

describe("PcmWriter", () => {
  it("round-trips Int16Array and Uint8Array chunks, including a split sample", async () => {
    const samples = ramp(SAMPLE_RATE); // 1 s
    const bytes = new Uint8Array(samples.buffer);
    const writer = new PcmWriter(join(dir, "a.pcm16"));
    await writer.append(samples.subarray(0, 4000));
    // A byte chunk that ends in the middle of a sample, then the rest.
    await writer.append(bytes.subarray(8000, 12001));
    await writer.append(bytes.subarray(12001));
    const result = await writer.finish();
    expect(result.path).toBe(join(dir, "a.pcm16"));
    expect(result.durationMs).toBe(1000);
    const back = await readPcm(result.path, 0, 1000);
    expect(back).toEqual(samples);
    expect((await stat(result.path)).size).toBe(samples.byteLength);
  });

  it("serializes appends that are not awaited", async () => {
    const writer = new PcmWriter(join(dir, "b.pcm16"));
    const a = ramp(1000);
    const b = ramp(500);
    void writer.append(a);
    void writer.append(b);
    const { path } = await writer.finish();
    const buf = await readFile(path);
    expect(buf.length).toBe(3000);
    expect(new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + 2000))).toEqual(a);
  });

  it("finish on an empty writer yields an empty file of 0 ms", async () => {
    const writer = new PcmWriter(join(dir, "c.pcm16"));
    const result = await writer.finish();
    expect(result.durationMs).toBe(0);
    expect((await stat(result.path)).size).toBe(0);
  });

  it("abort removes the file and later appends are rejected", async () => {
    const path = join(dir, "d.pcm16");
    const writer = new PcmWriter(path);
    await writer.append(ramp(100));
    await writer.abort();
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(writer.append(ramp(1))).rejects.toThrow();
  });

  it("abort after finish keeps the finished file", async () => {
    const writer = new PcmWriter(join(dir, "f.pcm16"));
    await writer.append(ramp(10));
    const { path } = await writer.finish();
    await writer.abort();
    expect((await stat(path)).size).toBe(20);
  });

  it("rejects appends after finish", async () => {
    const writer = new PcmWriter(join(dir, "e.pcm16"));
    await writer.finish();
    await expect(writer.append(ramp(1))).rejects.toThrow();
  });
});

describe("pcmDurationMs and readPcm", () => {
  it("measures duration from the file size", async () => {
    const path = await writePcm("dur.pcm16", ramp(SAMPLE_RATE * 2.5));
    expect(await pcmDurationMs(path)).toBe(2500);
  });

  it("reads exactly the requested range", async () => {
    const path = await writePcm("range.pcm16", ramp(SAMPLE_RATE * 2));
    const got = await readPcm(path, 500, 600);
    expect(got.length).toBe(1600);
    expect(got[0]).toBe(8000);
    expect(got[1599]).toBe(9599);
  });

  it("clamps to the end of the file and returns empty for an empty range", async () => {
    const path = await writePcm("clamp.pcm16", ramp(SAMPLE_RATE));
    const tail = await readPcm(path, 900, 5000);
    expect(tail.length).toBe(1600);
    expect((await readPcm(path, 300, 300)).length).toBe(0);
    expect((await readPcm(path, 400, 300)).length).toBe(0);
    expect((await readPcm(path, 2000, 3000)).length).toBe(0);
  });
});

describe("writeSegmentWav", () => {
  it("writes a 44-byte canonical header followed by the range", async () => {
    const path = await writePcm("seg.pcm16", ramp(SAMPLE_RATE));
    const out = join(dir, "seg.wav");
    await writeSegmentWav(path, 250, 750, out);
    const buf = await readFile(out);
    const dataBytes = 8000 * 2;
    expect(buf.length).toBe(44 + dataBytes);
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buf.readUInt32LE(4)).toBe(36 + dataBytes);
    expect(buf.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(buf.readUInt32LE(16)).toBe(16);
    expect(buf.readUInt16LE(20)).toBe(1); // PCM
    expect(buf.readUInt16LE(22)).toBe(1); // mono
    expect(buf.readUInt32LE(24)).toBe(16000);
    expect(buf.readUInt32LE(28)).toBe(32000);
    expect(buf.readUInt16LE(32)).toBe(2);
    expect(buf.readUInt16LE(34)).toBe(16);
    expect(buf.toString("ascii", 36, 40)).toBe("data");
    expect(buf.readUInt32LE(40)).toBe(dataBytes);
    expect(buf.readInt16LE(44)).toBe(4000);
    expect(buf.readInt16LE(44 + dataBytes - 2)).toBe(11999);
  });
});

describe("computeFrameLevelsDb", () => {
  function sineThenSilence(): Int16Array {
    const out = new Int16Array(SAMPLE_RATE * 2);
    for (let i = 0; i < SAMPLE_RATE; i++) {
      out[i] = Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE));
    }
    return out;
  }

  it("reads about -9 dBFS for a half-scale sine and the floor for silence", async () => {
    const path = await writePcm("sine.pcm16", sineThenSilence());
    const levels = await computeFrameLevelsDb(path);
    expect(levels.length).toBe(100);
    for (let f = 0; f < 50; f++) expect(levels[f]).toBeCloseTo(-9.03, 0);
    for (let f = 50; f < 100; f++) expect(levels[f]).toBeLessThan(-100);
  });

  it("gives the same levels for any chunk size, across chunk boundaries", async () => {
    const samples = new Int16Array(SAMPLE_RATE * 3 + 100); // a trailing partial frame
    let seed = 12345;
    for (let i = 0; i < samples.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      samples[i] = ((seed >> 8) % 20000) - 10000;
    }
    const path = await writePcm("noise.pcm16", samples);
    const reference = await computeFrameLevelsDb(path, 20, { chunkFrames: 1_000_000 });
    expect(reference.length).toBe(150); // the 100 trailing samples are not a whole frame
    for (const chunkFrames of [1, 7, 64]) {
      expect(await computeFrameLevelsDb(path, 20, { chunkFrames })).toEqual(reference);
    }
    expect(await computeFrameLevelsDb(path)).toEqual(reference);
  });

  it("supports another frame length", async () => {
    const path = await writePcm("frame.pcm16", ramp(SAMPLE_RATE));
    expect((await computeFrameLevelsDb(path, 100)).length).toBe(10);
  });
});
