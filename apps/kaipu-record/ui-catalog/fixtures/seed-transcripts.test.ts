import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256FileBase64 } from "../../src/main/library/content-hash";
import { ENGINE_NAME } from "../../src/main/transcription/transcription-service";
import { parseTranscript } from "../../src/main/transcription/transcript-file";
import {
  buildFixtureTranscript,
  FIXTURE_ENGINE_NAME,
  INVALID_TRANSCRIPT_TEXT,
  SEEDED_TRANSCRIPTS,
  STALE_CONTENT_HASH,
} from "./seed-transcripts";
import { seedTranscripts } from "./seed-vault";

const REAL_HASH = "cmVhbC1tZWRpYS1oYXNoLWZvci10aGUtZml4dHVyZS10ZXN0cw==";
const kinds = ["ready", "unresolved", "stale"] as const;

describe("buildFixtureTranscript", () => {
  it.each(kinds)("a %s transcript is one the app's own parser accepts", (kind) => {
    const doc = buildFixtureTranscript({ kind, durationMs: 9_000, contentHash: REAL_HASH });
    expect(parseTranscript(JSON.parse(JSON.stringify(doc)))).toMatchObject({ ok: true });
  });

  it.each(kinds)("a %s transcript has integer times, sorted, inside the recording", (kind) => {
    const durationMs = kind === "ready" ? 12_000 : 7_000;
    const doc = buildFixtureTranscript({ kind, durationMs, contentHash: REAL_HASH });
    const times = [
      ...doc.words.flatMap((w) => [w.startMs, w.endMs]),
      ...doc.segments.flatMap((s) => [s.startMs, s.endMs]),
      ...doc.unresolved.flatMap((u) => [u.startMs, u.endMs]),
    ];
    for (const t of times) {
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(durationMs);
    }
    const starts = doc.words.map((w) => w.startMs);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("the ready transcript is about 40 words, in two paragraphs split by a pause over 1.5 s", () => {
    const doc = buildFixtureTranscript({
      kind: "ready",
      durationMs: 12_000,
      contentHash: REAL_HASH,
    });
    expect(doc.words.length).toBeGreaterThanOrEqual(35);
    expect(doc.words.length).toBeLessThanOrEqual(45);
    expect(doc.unresolved).toEqual([]);
    const gaps = doc.words.slice(1).map((w, i) => w.startMs - doc.words[i]!.endMs);
    expect(gaps.filter((gap) => gap > 1_500)).toHaveLength(1);
  });

  it("the unresolved transcript records one failed and one empty-with-speech stretch with no words in them", () => {
    const doc = buildFixtureTranscript({
      kind: "unresolved",
      durationMs: 9_000,
      contentHash: REAL_HASH,
    });
    expect(doc.unresolved.map((u) => u.reason)).toEqual(["segment-failed", "empty-with-speech"]);
    for (const u of doc.unresolved) {
      expect(doc.words.some((w) => w.startMs >= u.startMs && w.endMs <= u.endMs)).toBe(false);
    }
  });

  it("the stale transcript records a hash that is not the media's", () => {
    const doc = buildFixtureTranscript({
      kind: "stale",
      durationMs: 7_000,
      contentHash: REAL_HASH,
    });
    expect(doc.media.contentHash).toBe(STALE_CONTENT_HASH);
    expect(doc.media.contentHash).not.toBe(REAL_HASH);
    const ready = buildFixtureTranscript({
      kind: "ready",
      durationMs: 12_000,
      contentHash: REAL_HASH,
    });
    expect(ready.media.contentHash).toBe(REAL_HASH);
  });

  it("refuses a recording too short to hold the script", () => {
    expect(() =>
      buildFixtureTranscript({ kind: "ready", durationMs: 3_000, contentHash: REAL_HASH }),
    ).toThrow(/too short/);
  });

  it("names the same engine the transcription service writes", () => {
    expect(FIXTURE_ENGINE_NAME).toBe(ENGINE_NAME);
  });

  it("the unreadable text is not JSON", () => {
    expect(() => JSON.parse(INVALID_TRANSCRIPT_TEXT)).toThrow();
  });
});

describe("seedTranscripts", () => {
  it("writes one transcript file per seeded recording, each of the kind it names", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "seed-transcripts-"));
    const meta = path.join(vault, ".kaipu");
    await mkdir(meta, { recursive: true });
    for (const { stem } of SEEDED_TRANSCRIPTS) {
      await writeFile(path.join(vault, `${stem}.mp4`), `media of ${stem}`);
    }

    await seedTranscripts(vault, meta);

    for (const { stem, kind } of SEEDED_TRANSCRIPTS) {
      const text = await readFile(path.join(meta, `${stem}.transcript.json`), "utf8");
      if (kind === "invalid") {
        expect(text).toBe(INVALID_TRANSCRIPT_TEXT);
        continue;
      }
      const parsed = parseTranscript(JSON.parse(text));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const mediaHash = await sha256FileBase64(path.join(vault, `${stem}.mp4`));
      // Only the stale one disagrees with its recording.
      expect(parsed.transcript.media.contentHash === mediaHash).toBe(kind !== "stale");
      expect(parsed.transcript.media.durationMs % 1_000).toBe(0);
    }
  });
});
