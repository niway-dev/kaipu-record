import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Seam, Segment } from "./segment";
import {
  buildTranscript,
  parseTranscript,
  readTranscriptFile,
  serializeTranscript,
  writeTranscriptFileAtomic,
  type Transcript,
} from "./transcript-file";
import type { Word } from "./words";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kaipu-transcript-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function valid(): Transcript {
  return {
    schemaVersion: 1,
    model: { id: "test-model", revision: "abc123", files: { "encoder.onnx": "deadbeef" } },
    engine: { name: "sherpa-onnx-offline", version: "1.13.8" },
    media: { contentHash: "aGFzaA==", durationMs: 60_000 },
    createdAt: "2026-11-15T00:00:00Z",
    segments: [
      { id: "s1", startMs: 0, endMs: 30_000, status: "ok" },
      { id: "s2", startMs: 27_000, endMs: 57_000, status: "empty" },
    ],
    unresolved: [{ startMs: 27_000, endMs: 57_000, reason: "empty-with-speech" }],
    words: [
      { id: "w1", segmentId: "s1", text: "Hoy", startMs: 0, endMs: 320, logProb: -0.00002 },
      { id: "w2", segmentId: "s1", text: "es", startMs: 400, endMs: 560, logProb: -0.3 },
    ],
  };
}

function rejection(value: unknown) {
  const result = parseTranscript(value);
  if (result.ok) throw new Error("expected a rejection");
  return result;
}

describe("parseTranscript", () => {
  it("parses a valid file and returns it unchanged", () => {
    const result = parseTranscript(valid());
    expect(result).toEqual({ ok: true, transcript: valid() });
  });

  it("accepts an empty file with no words and no segments", () => {
    const t = { ...valid(), segments: [], unresolved: [], words: [] };
    expect(parseTranscript(t).ok).toBe(true);
  });

  it("accepts the timestamp buildTranscript writes", () => {
    const t = { ...valid(), createdAt: new Date("2026-11-15T10:20:30.123Z").toISOString() };
    expect(parseTranscript(t).ok).toBe(true);
  });

  it("rejects a future schema version as unsupported-version", () => {
    expect(rejection({ ...valid(), schemaVersion: 2 }).reason).toBe("unsupported-version");
    // Even when the rest of that future file would not match today's shape.
    expect(rejection({ schemaVersion: 7, whatever: true }).reason).toBe("unsupported-version");
  });

  it.each([
    ["not an object", "text"],
    ["null", null],
    ["an array", []],
    [
      "a missing version",
      (() => {
        const { schemaVersion: _, ...rest } = valid();
        return rest;
      })(),
    ],
    ["version 0", { ...valid(), schemaVersion: 0 }],
    ["a fractional version", { ...valid(), schemaVersion: 1.5 }],
    ["a string version", { ...valid(), schemaVersion: "1" }],
    ["a missing model", { ...valid(), model: undefined }],
    ["a non-string file hash", { ...valid(), model: { ...valid().model, files: { a: 1 } } }],
    [
      "a bad status",
      { ...valid(), segments: [{ id: "s1", startMs: 0, endMs: 1, status: "done" }] },
    ],
    [
      "a bad unresolved reason",
      { ...valid(), unresolved: [{ startMs: 0, endMs: 1, reason: "nope" }] },
    ],
    ["a bad createdAt", { ...valid(), createdAt: "yesterday" }],
    ["an unknown top-level field", { ...valid(), extra: 1 }],
    ["a non-finite logProb", { ...valid(), words: [{ ...valid().words[0], logProb: Number.NaN }] }],
  ])("rejects %s as invalid", (_name, value) => {
    expect(rejection(value).reason).toBe("invalid");
  });

  it("rejects negative and fractional times", () => {
    const negative = valid();
    negative.words[0] = { ...negative.words[0]!, startMs: -1 };
    expect(rejection(negative).reason).toBe("invalid");
    const fractional = valid();
    fractional.words[0] = { ...fractional.words[0]!, endMs: 320.5 };
    expect(rejection(fractional).reason).toBe("invalid");
    const media = valid();
    media.media.durationMs = 1.5;
    expect(rejection(media).reason).toBe("invalid");
  });

  it("rejects start after end in a word, a segment and an unresolved interval", () => {
    const word = valid();
    word.words[0] = { ...word.words[0]!, startMs: 500, endMs: 100 };
    expect(rejection(word).reason).toBe("invalid");
    const segment = valid();
    segment.segments[0] = { ...segment.segments[0]!, startMs: 40_000 };
    expect(rejection(segment).reason).toBe("invalid");
    const gap = valid();
    gap.unresolved[0] = { ...gap.unresolved[0]!, startMs: 99_000 };
    expect(rejection(gap).reason).toBe("invalid");
  });

  it("rejects words that are not sorted by start", () => {
    const t = valid();
    t.words = [t.words[1]!, t.words[0]!];
    expect(rejection(t).reason).toBe("invalid");
  });

  it("rejects a word that names a segment that does not exist", () => {
    const t = valid();
    t.words[1] = { ...t.words[1]!, segmentId: "s9" };
    const result = rejection(t);
    expect(result.reason).toBe("invalid");
    expect(result.message).toContain("s9");
  });

  it("rejects duplicate segment ids and duplicate word ids", () => {
    const segments = valid();
    segments.segments[1] = { ...segments.segments[1]!, id: "s1" };
    expect(rejection(segments).reason).toBe("invalid");
    const words = valid();
    words.words[1] = { ...words.words[1]!, id: "w1" };
    expect(rejection(words).reason).toBe("invalid");
  });

  it("never throws on hostile input", () => {
    for (const value of [undefined, 1, true, Symbol.iterator.toString(), { schemaVersion: {} }]) {
      expect(() => parseTranscript(value)).not.toThrow();
    }
  });
});

describe("serialize, read and write", () => {
  it("round-trips through serialize and parse", () => {
    const json = serializeTranscript(valid());
    expect(parseTranscript(JSON.parse(json))).toEqual({ ok: true, transcript: valid() });
  });

  it("writes atomically and reads back", async () => {
    const path = join(dir, "clip.transcript.json");
    await writeTranscriptFileAtomic(path, valid());
    expect(await readdir(dir)).toEqual(["clip.transcript.json"]);
    expect(await readTranscriptFile(path)).toEqual({ ok: true, transcript: valid() });
  });

  it("replaces an existing file", async () => {
    const path = join(dir, "t.json");
    await writeFile(path, "old");
    await writeTranscriptFileAtomic(path, valid());
    expect(await readTranscriptFile(path)).toEqual({ ok: true, transcript: valid() });
  });

  it("removes the temp file and keeps the target when the rename fails", async () => {
    const path = join(dir, "target");
    await mkdir(path);
    await writeFile(join(path, "keep.txt"), "x");
    await expect(writeTranscriptFileAtomic(path, valid())).rejects.toThrow();
    expect((await readdir(dir)).sort()).toEqual(["target"]);
    expect(await readFile(join(path, "keep.txt"), "utf8")).toBe("x");
  });

  it("removes the temp file when the directory is missing and the write fails", async () => {
    await expect(writeTranscriptFileAtomic(join(dir, "nope", "t.json"), valid())).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  it("reports a missing file, bad JSON and an unsupported version without throwing", async () => {
    expect(await readTranscriptFile(join(dir, "missing.json"))).toEqual({
      ok: false,
      reason: "not-found",
    });
    const bad = join(dir, "bad.json");
    await writeFile(bad, "{not json");
    expect(await readTranscriptFile(bad)).toMatchObject({ ok: false, reason: "invalid" });
    const future = join(dir, "future.json");
    await writeFile(future, JSON.stringify({ ...valid(), schemaVersion: 2 }));
    expect(await readTranscriptFile(future)).toMatchObject({
      ok: false,
      reason: "unsupported-version",
    });
  });
});

describe("buildTranscript", () => {
  const FRAME_MS = 20;
  const segments: Segment[] = [
    { id: "s0", startMs: 0, endMs: 30_000 },
    { id: "s1", startMs: 27_000, endMs: 57_000 },
    { id: "s2", startMs: 54_000, endMs: 84_000 },
  ];
  const seams: Seam[] = [
    { beforeId: "s0", afterId: "s1", cutMs: 28_500, overlapStartMs: 27_000, overlapEndMs: 30_000 },
    { beforeId: "s1", afterId: "s2", cutMs: 55_500, overlapStartMs: 54_000, overlapEndMs: 57_000 },
  ];
  const word = (segmentId: string, text: string, startMs: number, endMs: number): Word => ({
    segmentId,
    text,
    startMs,
    endMs,
    logProb: -0.1,
  });
  const base = {
    model: valid().model,
    engine: valid().engine,
    media: { contentHash: "aGFzaA==", durationMs: 84_000 },
    now: new Date("2026-11-15T10:20:30.000Z"),
  };

  /** Loud everywhere except inside the [from, to) ranges. */
  function levels(quiet: Array<[number, number]> = []): Float32Array {
    const out = new Float32Array(84_000 / FRAME_MS).fill(-20);
    // 10 s of quiet at the very end (inside s2 only) so the noise floor sits well below speech.
    for (let f = 74_000 / FRAME_MS; f < out.length; f++) out[f] = -80;
    for (const [from, to] of quiet)
      for (let f = from / FRAME_MS; f < to / FRAME_MS; f++) out[f] = -80;
    return out;
  }

  it("builds a file that parses, with reconciled words, ids and the timestamp", () => {
    const t = buildTranscript({
      ...base,
      segments,
      seams,
      levels: levels(),
      wordsBySegment: new Map([
        ["s0", [word("s0", "uno", 1000, 1300), word("s0", "dos", 29_000, 29_300)]],
        ["s1", [word("s1", "dos", 29_000, 29_300), word("s1", "tres", 40_000, 40_300)]],
        ["s2", [word("s2", "cuatro", 70_000, 70_300)]],
      ]),
    });
    expect(parseTranscript(JSON.parse(serializeTranscript(t))).ok).toBe(true);
    expect(t.schemaVersion).toBe(1);
    expect(t.createdAt).toBe("2026-11-15T10:20:30.000Z");
    expect(t.words.map((w) => [w.id, w.text])).toEqual([
      ["w1", "uno"],
      ["w2", "dos"],
      ["w3", "tres"],
      ["w4", "cuatro"],
    ]);
    expect(t.segments).toEqual([
      { id: "s0", startMs: 0, endMs: 30_000, status: "ok" },
      { id: "s1", startMs: 27_000, endMs: 57_000, status: "ok" },
      { id: "s2", startMs: 54_000, endMs: 84_000, status: "ok" },
    ]);
    expect(t.unresolved).toEqual([]);
  });

  it("flags a segment with no words and at least 1 s of speech as empty-with-speech", () => {
    const t = buildTranscript({
      ...base,
      segments,
      seams,
      levels: levels(),
      wordsBySegment: new Map([
        ["s0", [word("s0", "uno", 1000, 1300)]],
        ["s2", [word("s2", "cuatro", 70_000, 70_300)]],
      ]),
    });
    expect(t.segments[1]).toEqual({ id: "s1", startMs: 27_000, endMs: 57_000, status: "empty" });
    expect(t.unresolved).toEqual([{ startMs: 27_000, endMs: 57_000, reason: "empty-with-speech" }]);
  });

  it("does not flag an empty segment that has no speech", () => {
    // s1 is silent from 27 s to 57 s.
    const t = buildTranscript({
      ...base,
      segments,
      seams,
      levels: levels([[27_000, 57_000]]),
      wordsBySegment: new Map([["s0", [word("s0", "uno", 1000, 1300)]]]),
    });
    expect(t.segments[1]!.status).toBe("empty");
    expect(t.unresolved.some((u) => u.startMs === 27_000)).toBe(false);
  });

  it("does not flag a segment with under 1 s of speech", () => {
    // Only 0.8 s of voiced frames inside s1: everything else quiet.
    const t = buildTranscript({
      ...base,
      segments: [{ id: "s0", startMs: 0, endMs: 30_000 }],
      seams: [],
      levels: levels([
        [8000, 30_000],
        [0, 7200],
      ]),
      wordsBySegment: new Map(),
      media: { contentHash: "x", durationMs: 30_000 },
    });
    expect(t.segments[0]!.status).toBe("empty");
    expect(t.unresolved).toEqual([]);
  });

  it("marks a failed segment and gives it a segment-failed interval", () => {
    const t = buildTranscript({
      ...base,
      segments,
      seams,
      levels: levels(),
      failedSegmentIds: ["s1"],
      wordsBySegment: new Map([
        ["s0", [word("s0", "uno", 1000, 1300)]],
        ["s2", [word("s2", "cuatro", 70_000, 70_300)]],
      ]),
    });
    expect(t.segments[1]).toEqual({ id: "s1", startMs: 27_000, endMs: 57_000, status: "failed" });
    expect(t.unresolved).toEqual([{ startMs: 27_000, endMs: 57_000, reason: "segment-failed" }]);
  });

  it("keeps a neighbour's words in the overlap with a failed or empty segment", () => {
    // s0 heard "dos" at 29 s, after the cut at 28.5 s; s1 failed, so nobody else owns it.
    const t = buildTranscript({
      ...base,
      segments,
      seams,
      levels: levels(),
      failedSegmentIds: new Set(["s1"]),
      wordsBySegment: new Map([
        ["s0", [word("s0", "dos", 29_000, 29_300)]],
        ["s1", [word("s1", "ignored", 40_000, 40_300)]],
      ]),
    });
    expect(t.words.map((w) => w.text)).toEqual(["dos"]);
  });

  it("orders unresolved intervals by start", () => {
    const t = buildTranscript({
      ...base,
      segments,
      seams,
      levels: levels(),
      failedSegmentIds: ["s2"],
      wordsBySegment: new Map([["s0", [word("s0", "uno", 1000, 1300)]]]),
    });
    expect(t.unresolved.map((u) => [u.startMs, u.reason])).toEqual([
      [27_000, "empty-with-speech"],
      [54_000, "segment-failed"],
    ]);
  });
});
