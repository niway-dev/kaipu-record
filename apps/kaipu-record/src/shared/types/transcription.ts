/**
 * Local transcription over IPC (NIW2-818, ADR 0062 and 0065). This file is reachable from the
 * preload bundle, which cannot load workspace packages at runtime, so it imports none: types
 * and one literal constant only.
 *
 * The flow: the renderer decodes a recording's audio to 16 kHz mono signed 16-bit little-endian
 * PCM and streams it to main (`transcriptionJobBegin`, then `transcriptionJobChunk` per slice,
 * then `transcriptionJobEnd`). Main owns the job from there: it segments, runs the engine in
 * batches, writes `.kaipu/<id>.transcript.json` and broadcasts `TranscriptionJobProgress`.
 */

/**
 * Why the engine cannot run at all. A missing engine, or an installed one that fails its version
 * check, is not here: both read as a model to download, and the download reinstalls the engine.
 */
export type TranscriptionUnavailableReason =
  /** Not macOS arm64 (the first supported target). */
  | "unsupported-platform"
  /** Never sent by main: the renderer's own answer when the status request itself failed. */
  | "unreachable";

export type TranscriptionAvailability =
  | { status: "available" }
  | { status: "unavailable"; reason: TranscriptionUnavailableReason };

export interface TranscriptionModelLicense {
  name: string;
  /** The credit shown in the download prompt and the third-party notices. */
  attribution: string;
  url: string;
}

export type TranscriptionModelStatus =
  | { state: "missing" }
  | { state: "downloading"; receivedBytes: number; totalBytes: number }
  | { state: "ready" }
  | { state: "failed"; reason: string };

/** One catalog entry with its state on this machine. */
export interface TranscriptionModelInfo {
  id: string;
  label: string;
  /** ISO 639-1 codes the model recognises. */
  languages: readonly string[];
  /** Sum of every file: what the download prompt shows. */
  sizeBytes: number;
  /** The folder the model is (or will be) installed in, shown in the download prompt. */
  location: string;
  license: TranscriptionModelLicense;
  status: TranscriptionModelStatus;
}

export interface TranscriptionStatus {
  availability: TranscriptionAvailability;
  /** The model the app offers first (Parakeet v3). */
  defaultModelId: string;
  models: TranscriptionModelInfo[];
  /** The job running now, if any. One job at a time. */
  job: TranscriptionJobProgress | null;
}

/** Pushed from main while a model downloads (throttled). */
export interface TranscriptionModelProgress {
  id: string;
  receivedBytes: number;
  totalBytes: number;
  fileName: string;
}

export type TranscriptionModelDownloadResult =
  | { status: "ready" }
  | { status: "cancelled" }
  | {
      status: "failed";
      code:
        | "network"
        | "hash-mismatch"
        | "size-mismatch"
        | "insufficient-disk-space"
        /** The engine downloaded and verified, but could not be unpacked or does not start here. */
        | "engine-failed-to-start"
        | "busy"
        | "unknown-model";
    };

/** PCM contract: the renderer's decode target and main's input. */
export const TRANSCRIPTION_PCM_SAMPLE_RATE = 16000 as const;

export interface TranscriptionJobRequest {
  /** The library item to transcribe. */
  id: string;
  /** The item's identity under the names lock, so a rename in flight is detected. */
  assetId: string;
  modelId: string;
  /** Duration of the decoded audio in ms, for progress and the segment plan. */
  durationMs: number;
  /**
   * The job starts by itself because the recording changed after it was transcribed (NIW2-891).
   * Main records the attempt against the media's content hash, so it is made once per content.
   */
  automatic?: boolean;
}

export type TranscriptionBeginResult =
  | { status: "accepted"; jobId: string }
  | { status: "refused"; reason: "unavailable" | "model-missing" | "busy" | "invalid-item" };

export type TranscriptionJobPhase =
  | "receiving-audio"
  | "transcribing"
  | "writing"
  | "done"
  | "failed"
  | "cancelled";

export type TranscriptionFailure =
  /** The recording has no audio track, or none the decoder could read. */
  | "no-audio"
  | "engine-unavailable"
  | "model-missing"
  /** The engine exited non-zero, was killed or printed junk. */
  | "engine-failed"
  | "write-failed"
  /** The item was renamed, moved or removed while the job ran. */
  | "item-changed";

export interface TranscriptionJobProgress {
  jobId: string;
  /** The library item. */
  id: string;
  phase: TranscriptionJobPhase;
  segmentsDone: number;
  segmentsTotal: number;
  failure?: TranscriptionFailure;
}

/** A word in the recording's own source time (integer ms), as stored in the transcript file. */
export interface TranscriptWord {
  id: string;
  segmentId: string;
  text: string;
  startMs: number;
  endMs: number;
  logProb: number;
}

export interface TranscriptSegment {
  id: string;
  startMs: number;
  endMs: number;
  status: "ok" | "empty" | "failed";
}

export interface TranscriptUnresolvedInterval {
  startMs: number;
  endMs: number;
  reason: "empty-with-speech" | "segment-failed";
}

/** `.kaipu/<id>.transcript.json`, schema version 1. */
export interface TranscriptDocument {
  schemaVersion: 1;
  model: { id: string; revision: string; files: Record<string, string> };
  engine: { name: string; version: string };
  media: { contentHash: string; durationMs: number };
  createdAt: string;
  segments: TranscriptSegment[];
  unresolved: TranscriptUnresolvedInterval[];
  words: TranscriptWord[];
}

/**
 * Whether a transcript still describes the recording: `checking` when the answer needs the
 * media hash and the cache has none, so the words come back first and
 * `checkTranscriptFreshness` settles it.
 */
export type TranscriptFreshness = "fresh" | "stale" | "checking";

/** `unknown`: the file kept changing while it was hashed, or its hash could not be read. */
export type TranscriptVerdict = "fresh" | "stale" | "unknown";

export interface TranscriptFreshnessResult {
  verdict: TranscriptVerdict;
  /**
   * The verdict is `stale` and no automatic attempt has been made for this media content yet, so
   * the renderer may start a job by itself. False otherwise: the manual button stays.
   */
  autoRetranscribe: boolean;
}

export type TranscriptReadResult =
  /** No transcript file for this item. */
  | { status: "none" }
  /** The file is there but does not validate (kept on disk, never silently deleted). */
  | { status: "invalid" }
  | {
      status: "ready";
      transcript: TranscriptDocument;
      /** The recording's media hash no longer equals the transcript's: words stay readable. */
      stale: boolean;
      /** `checking` while the media hash is not cached; `stale` is false until it settles. */
      freshness: TranscriptFreshness;
    };
