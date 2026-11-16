import type {
  TranscriptDocument,
  TranscriptSegment,
  TranscriptUnresolvedInterval,
  TranscriptWord,
} from "../../src/shared/types/transcription";
import { DEFAULT_MODEL_ID, getModel } from "../../src/main/transcription/models/catalog";

/**
 * The transcript files the `transcripts` profile option seeds beside four demo recordings
 * (`.kaipu/<stem>.transcript.json`, schema v1), so the Transcript panel and the Transcribe
 * buttons have every look to show without an engine. The words are invented, English, about
 * 40 for the main one, and every time is an integer ms inside the recording's real length.
 * None of them sits on “Team notes” except the unreadable one: its saved edit mutes 6 s to 7.5 s,
 * which would hide words from the editor's Transcript panel.
 *
 * Which look each recording gets:
 *
 * - `ready`: all words resolved, and the media hash is the file's own, so it is not stale;
 * - `unresolved`: two stretches the engine could not recognise (one failed segment, one empty
 *   segment with speech), words missing there;
 * - `stale`: complete, but the recorded media hash is not the file's, as after the recording
 *   changed (what the panel calls out of date);
 * - `invalid`: the file is not valid JSON, so the panel reports it unreadable. The Library still
 *   lists the item as transcribed: a file exists.
 *
 * Not imported by `src/shared/**` or the app: catalog fixtures only.
 */

export type SeededTranscriptKind = "ready" | "unresolved" | "stale" | "invalid";

/** The recordings that get a transcript, by file stem, and what each one's file looks like. */
export const SEEDED_TRANSCRIPTS: readonly { stem: string; kind: SeededTranscriptKind }[] = [
  { stem: "Walkthrough 1", kind: "ready" },
  { stem: "Release demo", kind: "unresolved" },
  { stem: "Onboarding flow", kind: "stale" },
  { stem: "Team notes", kind: "invalid" },
];

/** What an unreadable transcript file holds. */
export const INVALID_TRANSCRIPT_TEXT = "{ not json\n";

/** Not the hash of any file: what a `stale` transcript says its recording used to be. */
export const STALE_CONTENT_HASH = "c3RhbGUtdHJhbnNjcmlwdC1maXh0dXJlLW5vdC1hLXJlYWwtaGFzaA==";

/** `ENGINE_NAME` of the transcription service; a test pins them equal. */
export const FIXTURE_ENGINE_NAME = "sherpa-onnx-offline";

const CREATED_AT = "2026-11-01T10:00:00.000Z";
const LEAD_MS = 350;
/** The silence between paragraphs: longer than the panel's 1.5 s paragraph break. */
const PAUSE_MS = 1_800;
const TAIL_MS = 350;
const WORD_GAP_MS = 40;

interface Script {
  /** Each paragraph is a sentence run; words are split on spaces and keep their punctuation. */
  paragraphs: readonly string[];
  /** Word index ranges the engine could not recognise: kept out of `words`, recorded instead. */
  holes?: readonly {
    from: number;
    to: number;
    reason: TranscriptUnresolvedInterval["reason"];
  }[];
}

const SCRIPTS: Record<Exclude<SeededTranscriptKind, "invalid">, Script> = {
  ready: {
    paragraphs: [
      "Welcome to the Kaipu walkthrough. Today we will record a short demo, trim the quiet parts, and share the result.",
      "First, press the shortcut to start. When you finish, the editor opens and every word is ready to search.",
    ],
  },
  unresolved: {
    paragraphs: [
      "Quick notes from the planning meeting. We agreed to ship the editor update on Friday, then review the feedback together.",
      "Next steps are listed in the shared document.",
    ],
    holes: [
      { from: 9, to: 12, reason: "segment-failed" },
      { from: 22, to: 25, reason: "empty-with-speech" },
    ],
  },
  stale: {
    paragraphs: [
      "This is the release demo. The recording was edited afterwards, so these words may no longer match.",
    ],
  },
};

/** The transcript document for one seeded look, laid out to fit `durationMs`. */
export function buildFixtureTranscript(args: {
  kind: Exclude<SeededTranscriptKind, "invalid">;
  durationMs: number;
  /** The hash the document records; `stale` always records `STALE_CONTENT_HASH` instead. */
  contentHash: string;
}): TranscriptDocument {
  const { kind, durationMs } = args;
  const script = SCRIPTS[kind];
  const sentences = script.paragraphs.map((p) => p.split(" "));
  const count = sentences.reduce((n, p) => n + p.length, 0);
  const free = durationMs - LEAD_MS - TAIL_MS - PAUSE_MS * (sentences.length - 1);
  const step = Math.floor(free / count);
  if (step < 120)
    throw new Error(`a ${durationMs} ms recording is too short for the ${kind} script`);

  // Every word's slot, in order, with its text.
  const slots: { text: string; startMs: number; endMs: number }[] = [];
  let at = LEAD_MS;
  sentences.forEach((paragraph, p) => {
    if (p > 0) at += PAUSE_MS;
    for (const text of paragraph) {
      slots.push({ text, startMs: at, endMs: at + step - WORD_GAP_MS });
      at += step;
    }
  });

  const holes = script.holes ?? [];
  const holeAt = (index: number) => holes.find((h) => index >= h.from && index < h.to);

  // Runs of kept words become `ok` segments; each hole becomes a `failed` or `empty` one.
  const segments: TranscriptSegment[] = [];
  const unresolved: TranscriptUnresolvedInterval[] = [];
  const words: TranscriptWord[] = [];
  let run: typeof slots = [];
  let runSegment = "";
  let index = 0;
  const closeRun = (): void => {
    if (run.length === 0) return;
    segments.push({
      id: runSegment,
      startMs: run[0].startMs,
      endMs: run[run.length - 1].endMs,
      status: "ok",
    });
    run = [];
  };
  for (const slot of slots) {
    const hole = holeAt(index);
    if (hole) {
      closeRun();
      if (index === hole.from) {
        const last = slots[hole.to - 1];
        segments.push({
          id: `seg-${String(segments.length + 1).padStart(4, "0")}`,
          startMs: slot.startMs,
          endMs: last.endMs,
          status: hole.reason === "segment-failed" ? "failed" : "empty",
        });
        unresolved.push({ startMs: slot.startMs, endMs: last.endMs, reason: hole.reason });
      }
    } else {
      if (run.length === 0) runSegment = `seg-${String(segments.length + 1).padStart(4, "0")}`;
      run.push(slot);
      words.push({
        id: `w-${String(words.length + 1).padStart(4, "0")}`,
        segmentId: runSegment,
        text: slot.text,
        startMs: slot.startMs,
        endMs: slot.endMs,
        logProb: -(0.02 + (index % 5) * 0.03),
      });
    }
    index += 1;
  }
  closeRun();

  const model = getModel(DEFAULT_MODEL_ID);
  if (!model) throw new Error(`the model catalog has no ${DEFAULT_MODEL_ID}`);
  return {
    schemaVersion: 1,
    model: {
      id: model.id,
      revision: model.revision,
      files: Object.fromEntries(model.files.map((file) => [file.name, file.sha256])),
    },
    engine: { name: FIXTURE_ENGINE_NAME, version: "1.12.0" },
    media: {
      contentHash: kind === "stale" ? STALE_CONTENT_HASH : args.contentHash,
      durationMs,
    },
    createdAt: CREATED_AT,
    segments,
    unresolved,
    words,
  };
}
