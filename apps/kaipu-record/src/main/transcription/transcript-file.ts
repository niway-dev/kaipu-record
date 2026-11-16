/**
 * The transcript file, schema version 1 (see the local transcription design page). Times are
 * integer ms on the recording's own source time. `parseTranscript` never throws: it returns a
 * typed rejection, so a caller can tell a file from a newer app (`unsupported-version`) from a
 * damaged one (`invalid`).
 */
import { open, readFile, rename, rm } from "node:fs/promises";
import { z } from "zod";
import type { Seam, Segment } from "./segment";
import { DEFAULT_SPEECH_MARGIN_DB, speechThresholdDb, voicedMs } from "./segment";
import { reconcile, type Word } from "./words";

export const TRANSCRIPT_SCHEMA_VERSION = 1;

/** A segment with no words but at least this much speech is an empty-with-speech hole. */
export const EMPTY_WITH_SPEECH_MIN_MS = 1000;

const timeMs = z.number().int().nonnegative();

const transcriptSchema = z.strictObject({
  schemaVersion: z.literal(TRANSCRIPT_SCHEMA_VERSION),
  model: z.strictObject({
    id: z.string().min(1),
    revision: z.string(),
    files: z.record(z.string(), z.string()),
  }),
  engine: z.strictObject({ name: z.string().min(1), version: z.string() }),
  media: z.strictObject({ contentHash: z.string().min(1), durationMs: timeMs }),
  createdAt: z.iso.datetime({ offset: true }),
  segments: z.array(
    z.strictObject({
      id: z.string().min(1),
      startMs: timeMs,
      endMs: timeMs,
      status: z.enum(["ok", "empty", "failed"]),
    }),
  ),
  unresolved: z.array(
    z.strictObject({
      startMs: timeMs,
      endMs: timeMs,
      reason: z.enum(["empty-with-speech", "segment-failed"]),
    }),
  ),
  words: z.array(
    z.strictObject({
      id: z.string().min(1),
      segmentId: z.string().min(1),
      text: z.string(),
      startMs: timeMs,
      endMs: timeMs,
      logProb: z.number(),
    }),
  ),
});

export type Transcript = z.infer<typeof transcriptSchema>;
export type TranscriptSegment = Transcript["segments"][number];
export type TranscriptUnresolved = Transcript["unresolved"][number];
export type TranscriptWord = Transcript["words"][number];
export type SegmentStatus = TranscriptSegment["status"];
export type UnresolvedReason = TranscriptUnresolved["reason"];

export type TranscriptRejection = {
  ok: false;
  reason: "unsupported-version" | "invalid";
  message: string;
};
export type ParseResult = { ok: true; transcript: Transcript } | TranscriptRejection;
export type ReadResult = ParseResult | { ok: false; reason: "not-found" };

const invalid = (message: string): TranscriptRejection => ({
  ok: false,
  reason: "invalid",
  message,
});

export function parseTranscript(json: unknown): ParseResult {
  try {
    if (typeof json === "object" && json !== null && !Array.isArray(json)) {
      const version = (json as { schemaVersion?: unknown }).schemaVersion;
      if (
        typeof version === "number" &&
        Number.isInteger(version) &&
        version > TRANSCRIPT_SCHEMA_VERSION
      ) {
        return {
          ok: false,
          reason: "unsupported-version",
          message: `schemaVersion ${version} is newer than ${TRANSCRIPT_SCHEMA_VERSION}`,
        };
      }
    }
    const parsed = transcriptSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return invalid(issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "invalid");
    }
    const problem = checkInvariants(parsed.data);
    return problem ? invalid(problem) : { ok: true, transcript: parsed.data };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "unreadable value");
  }
}

/** What the shape alone cannot say: ordering, ranges and references. Returns the first problem. */
function checkInvariants(t: Transcript): string | null {
  const segmentIds = new Set<string>();
  for (const [i, s] of t.segments.entries()) {
    if (s.startMs > s.endMs) return `segments.${i}: startMs is after endMs`;
    if (segmentIds.has(s.id)) return `segments.${i}: duplicate id ${s.id}`;
    segmentIds.add(s.id);
  }
  for (const [i, u] of t.unresolved.entries()) {
    if (u.startMs > u.endMs) return `unresolved.${i}: startMs is after endMs`;
  }
  const wordIds = new Set<string>();
  let previousStart = 0;
  for (const [i, w] of t.words.entries()) {
    if (w.startMs > w.endMs) return `words.${i}: startMs is after endMs`;
    if (w.startMs < previousStart) return `words.${i}: words are not sorted by startMs`;
    previousStart = w.startMs;
    if (!segmentIds.has(w.segmentId)) return `words.${i}: unknown segment ${w.segmentId}`;
    if (wordIds.has(w.id)) return `words.${i}: duplicate id ${w.id}`;
    wordIds.add(w.id);
  }
  return null;
}

export function serializeTranscript(transcript: Transcript): string {
  return `${JSON.stringify(transcript)}\n`;
}

/** Reads and validates a transcript file. A missing file is `not-found`; other I/O errors throw. */
export async function readTranscriptFile(path: string): Promise<ReadResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { ok: false, reason: "not-found" };
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return invalid("not valid JSON");
  }
  return parseTranscript(json);
}

/** Writes `<path>.tmp`, flushes it, renames it over `path`. The temp file is removed on failure. */
export async function writeTranscriptFileAtomic(
  path: string,
  transcript: Transcript,
): Promise<void> {
  const temp = `${path}.tmp`;
  try {
    const handle = await open(temp, "w");
    try {
      await handle.writeFile(serializeTranscript(transcript), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

export type BuildTranscriptInput = {
  segments: Segment[];
  seams: Seam[];
  wordsBySegment: Map<string, Word[]>;
  /** Frame levels of the whole file, as `computeFrameLevelsDb` returns them. */
  levels: Float32Array;
  model: Transcript["model"];
  engine: Transcript["engine"];
  media: Transcript["media"];
  now: Date;
  /** Segments the engine could not transcribe; their words, if any, are ignored. */
  failedSegmentIds?: Iterable<string>;
  speechMarginDb?: number;
};

/**
 * Reconciles the segments' words and records what is still missing. A segment with no words is
 * `empty`; if it has at least 1 s of voiced frames it also gets an `empty-with-speech` interval,
 * so the editor can show a hole instead of silence. A failed segment gets `segment-failed`.
 * A seam that touches an empty or failed segment is not applied: the healthy neighbour keeps its
 * words in the overlap, because nobody else will say them.
 */
export function buildTranscript(input: BuildTranscriptInput): Transcript {
  const failed = new Set(input.failedSegmentIds ?? []);
  const threshold = speechThresholdDb(
    input.levels,
    input.speechMarginDb ?? DEFAULT_SPEECH_MARGIN_DB,
  );
  const wordsOf = (segment: Segment): Word[] =>
    failed.has(segment.id) ? [] : (input.wordsBySegment.get(segment.id) ?? []);

  const segments: TranscriptSegment[] = [];
  const unresolved: TranscriptUnresolved[] = [];
  const populated = new Set<string>();
  for (const segment of input.segments) {
    const startMs = Math.round(segment.startMs);
    const endMs = Math.round(segment.endMs);
    if (failed.has(segment.id)) {
      segments.push({ id: segment.id, startMs, endMs, status: "failed" });
      unresolved.push({ startMs, endMs, reason: "segment-failed" });
    } else if (wordsOf(segment).length > 0) {
      populated.add(segment.id);
      segments.push({ id: segment.id, startMs, endMs, status: "ok" });
    } else {
      segments.push({ id: segment.id, startMs, endMs, status: "empty" });
      if (voicedMs(input.levels, segment, threshold) >= EMPTY_WITH_SPEECH_MIN_MS) {
        unresolved.push({ startMs, endMs, reason: "empty-with-speech" });
      }
    }
  }
  unresolved.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const seams = input.seams.filter((s) => populated.has(s.beforeId) && populated.has(s.afterId));
  const wordsBySegment = new Map(input.segments.map((s) => [s.id, wordsOf(s)]));
  const words = reconcile(input.segments, seams, wordsBySegment).map(
    (w): TranscriptWord => ({
      id: w.id,
      segmentId: w.segmentId,
      text: w.text,
      startMs: w.startMs,
      endMs: w.endMs,
      logProb: w.logProb,
    }),
  );

  return {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    model: input.model,
    engine: input.engine,
    media: input.media,
    createdAt: input.now.toISOString(),
    segments,
    unresolved,
    words,
  };
}
