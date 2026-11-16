/**
 * The transcription job in the main process (NIW2-818 M1, ADR 0062 and 0065).
 *
 * The renderer streams the recording's decoded audio (16 kHz mono PCM16) to `.kaipu/tmp`; this
 * service then segments it, runs `sherpa-onnx-offline` over the segments in batches and commits
 * `.kaipu/<id>.transcript.json`. One job at a time. Nothing here holds the whole audio in memory:
 * levels are computed in chunks and each batch reads only its own segments.
 *
 * Words are transcript content: no log line or error message below carries them. They exist only
 * in the transcript file and in the partial file a crashed job resumes from.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  TranscriptionBeginResult,
  TranscriptionFailure,
  TranscriptionJobPhase,
  TranscriptionJobProgress,
  TranscriptionJobRequest,
  TranscriptionModelDownloadResult,
  TranscriptionModelInfo,
  TranscriptionModelProgress,
  TranscriptionModelStatus,
  TranscriptionStatus,
} from "@shared/types/transcription";
import { atomicWriteFile } from "../library/atomic-write";
import { ENGINE_ARCHIVE, type EngineArchive } from "./engine/engine-catalog";
import type { EngineStore } from "./engine/engine-store";
import type { EngineLocation } from "./engine/engine-locator";
import { SherpaError, type CliResult, type RunBatchOptions } from "./engine/sherpa-supervisor";
import { DEFAULT_MODEL_ID, listModels, type ModelCatalogEntry } from "./models/catalog";
import { DownloadError } from "./download-file";
import type { ModelStore } from "./models/model-store";
import { PcmWriter, computeFrameLevelsDb, writeSegmentWav } from "./pcm";
import { planSegments, type Segment } from "./segment";
import { buildTranscript, writeTranscriptFileAtomic } from "./transcript-file";
import { groupTokens, type Word } from "./words";

/**
 * Segments sent to one CLI call. M0 measured it against the ~1.5 s model load and the progress
 * granularity; the owner will confirm the value.
 */
export const SEGMENTS_PER_BATCH = 4;
/** A batch may run for this long plus `BATCH_DEADLINE_AUDIO_FACTOR` times its audio duration. */
export const BATCH_DEADLINE_BASE_MS = 30_000;
export const BATCH_DEADLINE_AUDIO_FACTOR = 2;
/** The largest PCM chunk main accepts in one call. */
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
/** Audio shorter than this is treated as no audio. */
export const MIN_AUDIO_MS = 500;
/** A job whose renderer sends nothing for this long is failed, so no job can hang. */
export const IDLE_TIMEOUT_MS = 60_000;
/** No recording is longer: a renderer that keeps sending past this is refused. */
const MAX_AUDIO_MS = 12 * 60 * 60 * 1000;
const MAX_AUDIO_BYTES = (MAX_AUDIO_MS / 1000) * 16_000 * 2;
const STALE_TMP_MS = 60 * 60 * 1000;
const STALE_PARTIAL_MS = 7 * 24 * 60 * 60 * 1000;
export const ENGINE_NAME = "sherpa-onnx-offline";

/** What the job needs from the vault of the workspace it started in. */
export interface TranscriptionVault {
  /** `<vault>/.kaipu/tmp`: the job's audio and WAV files, and the partial files. */
  tmpDir: string;
  /** The item `{ id, assetId }` names right now, or null (gone, renamed, not a recording). */
  resolve(target: { id: string; assetId: string }): Promise<ResolvedItem | null>;
  /** Runs `fn` holding the item lock a rename takes, so the two never interleave. */
  withItemLock<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

export interface ResolvedItem {
  id: string;
  assetId: string;
  mediaPath: string;
  transcriptPath: string;
}

type ModelStoreApi = Pick<
  ModelStore,
  "status" | "locate" | "destination" | "download" | "cancel" | "remove"
>;

type EngineStoreApi = Pick<EngineStore, "install">;

export interface TranscriptionServiceDeps {
  locateEngine: () => Promise<EngineLocation>;
  /** Installs the engine the first time a model is downloaded (ADR 0062, amendment). */
  engineStore: EngineStoreApi;
  /** Defaults to the pinned release; its size is part of the first download's size. */
  engineArchive?: Pick<EngineArchive, "archiveName" | "sizeBytes">;
  modelStore: ModelStoreApi;
  /** The vault of the active workspace. Called from `begin`, inside the workspace gate. */
  openVault: () => TranscriptionVault;
  runBatch: (options: RunBatchOptions) => Promise<CliResult[]>;
  /** base64 sha256 of a media file (`content-hash.ts`). */
  hashMedia: (path: string) => Promise<string>;
  now: () => Date;
  broadcastJob: (progress: TranscriptionJobProgress) => void;
  broadcastModel: (progress: TranscriptionModelProgress) => void;
  /** Runs `fn` after `ms`; the returned function cancels it. Injected so tests control time. */
  setTimer?: (fn: () => void, ms: number) => () => void;
  newJobId?: () => string;
  catalog?: readonly ModelCatalogEntry[];
}

const partialSchema = z.strictObject({
  key: z.strictObject({
    mediaHash: z.string(),
    modelId: z.string(),
    engineVersion: z.string(),
    durationMs: z.number(),
    planFingerprint: z.string(),
  }),
  words: z.record(
    z.string(),
    z.array(
      z.strictObject({
        segmentId: z.string(),
        text: z.string(),
        startMs: z.number(),
        endMs: z.number(),
        logProb: z.number(),
      }),
    ),
  ),
});
type PartialKey = z.infer<typeof partialSchema>["key"];

/** Raised inside a job to end it with a specific failure. */
class JobFailure extends Error {
  constructor(readonly failure: TranscriptionFailure) {
    super(`transcription job failed: ${failure}`);
    this.name = "JobFailure";
  }
}

interface Job {
  id: string;
  request: TranscriptionJobRequest;
  vault: TranscriptionVault;
  item: ResolvedItem;
  /** The recording's hash taken at `begin`, before the renderer reads the file to decode it. */
  contentHash: string;
  modelDir: string;
  model: ModelCatalogEntry;
  engine: { cliPath: string; libDir: string; version: string };
  writer: PcmWriter;
  pcmPath: string;
  dir: string;
  partialPath: string;
  controller: AbortController;
  cancelIdle: () => void;
  phase: TranscriptionJobPhase;
  segmentsDone: number;
  segmentsTotal: number;
  /** `end` has taken the audio: the idle timer no longer applies. */
  ending: boolean;
  running: boolean;
  closed: boolean;
  finished: Promise<void>;
  markFinished: () => void;
  receivedBytes: number;
}

/**
 * A missing engine, or an installed one that fails its check, is "not installed": the download
 * is offered and is the repair (it reinstalls). Unavailable is only for a machine that cannot
 * run the engine at all.
 */
function availabilityOf(engine: EngineLocation): TranscriptionStatus["availability"] {
  if (engine.available) return { status: "available" };
  switch (engine.reason) {
    case "unsupported-platform":
      return { status: "unavailable", reason: "unsupported-platform" };
    case "binary-missing":
    case "handshake-failed":
      return { status: "available" };
  }
}

/** The engine has to be (re)installed before a model can be used. */
const needsEngine = (engine: EngineLocation): boolean =>
  !engine.available && (engine.reason === "binary-missing" || engine.reason === "handshake-failed");

/** Minimum gap between engine progress events, as ModelStore's default. */
const ENGINE_PROGRESS_INTERVAL_MS = 200;

/**
 * One `downloadModel` call, from its first await to its result. It owns the abort signal for
 * both phases (engine, then model) and the numbers `status` shows while it runs.
 */
interface ModelDownload {
  id: string;
  controller: AbortController;
  promise: Promise<TranscriptionModelDownloadResult>;
  phase: "checking" | "engine" | "model";
  /** Bytes of the engine archive received so far. */
  engineReceived: number;
  /** Engine plus model bytes this call will download. */
  totalBytes: number;
  /** The engine's bytes once it is installed in this call: added to every model byte. */
  engineBytes: number;
}

function toModelStatus(status: ReturnType<ModelStoreApi["status"]>): TranscriptionModelStatus {
  return status.state === "ready" ? { state: "ready" } : status;
}

function toDownloadResult(error: DownloadError): TranscriptionModelDownloadResult {
  if (error.code === "cancelled") return { status: "cancelled" };
  return { status: "failed", code: error.code };
}

function toBytes(pcm: ArrayBuffer | Uint8Array): Uint8Array {
  return pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
}

function planFingerprint(segments: readonly Segment[]): string {
  const hash = createHash("sha256");
  for (const s of segments) hash.update(`${s.id}:${s.startMs}-${s.endMs};`);
  return hash.digest("hex");
}

function keysEqual(a: PartialKey, b: PartialKey): boolean {
  return (
    a.mediaHash === b.mediaHash &&
    a.modelId === b.modelId &&
    a.engineVersion === b.engineVersion &&
    a.durationMs === b.durationMs &&
    a.planFingerprint === b.planFingerprint
  );
}

/** The words of the segments an earlier run finished, or nothing (a bad file is deleted). */
async function loadPartial(path: string, key: PartialKey): Promise<Map<string, Word[]>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return new Map();
  }
  try {
    const parsed = partialSchema.parse(JSON.parse(text));
    if (keysEqual(parsed.key, key)) return new Map(Object.entries(parsed.words));
  } catch {
    // corrupt: fall through to delete
  }
  await rm(path, { force: true }).catch(() => {});
  return new Map();
}

async function savePartial(
  path: string,
  key: PartialKey,
  words: Map<string, Word[]>,
): Promise<void> {
  const body = { key, words: Object.fromEntries(words) };
  await atomicWriteFile(path, JSON.stringify(body));
}

/**
 * A job's own work folder is named by its job id, a UUID. Other features keep dotless folders in
 * the same `.kaipu/tmp` (`placed-parts`, `move-<id>`) that must outlive the sweep, so a dotless
 * name is a leftover only when it looks like a job id.
 */
const JOB_FOLDER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Leftovers of a crashed job: audio and WAV files after an hour, partial files after a week. */
async function sweepStaleTmp(dir: string, nowMs: number): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const isPartial = name.endsWith(".partial.json");
    const isLeftover = name.endsWith(".pcm") || name.endsWith(".wav") || JOB_FOLDER.test(name);
    if (!isPartial && !isLeftover) continue;
    const path = join(dir, name);
    try {
      const { mtimeMs } = await stat(path);
      if (nowMs - mtimeMs > (isPartial ? STALE_PARTIAL_MS : STALE_TMP_MS)) {
        await rm(path, { recursive: true, force: true });
      }
    } catch {
      // gone already, or unreadable: the next sweep tries again
    }
  }
}

export class TranscriptionService {
  private readonly catalog: readonly ModelCatalogEntry[];
  private readonly setTimer: NonNullable<TranscriptionServiceDeps["setTimer"]>;
  private readonly newJobId: () => string;
  private readonly engineArchive: NonNullable<TranscriptionServiceDeps["engineArchive"]>;
  private download: ModelDownload | null = null;
  private engineCache: EngineLocation | null = null;
  private engineInflight: Promise<EngineLocation> | null = null;
  /** Bumped when the install ends: a probe started before it must not write its old answer. */
  private engineGeneration = 0;
  /** Why the engine phase of the last download of a model failed (a cancel is not recorded). */
  private readonly engineFailures = new Map<string, string>();
  private job: Job | null = null;
  /** The model id of a `begin` that passed its checks and is still resolving the item. */
  private opening: string | null = null;
  private readonly sweptDirs = new Set<string>();

  constructor(private readonly deps: TranscriptionServiceDeps) {
    this.catalog = deps.catalog ?? listModels();
    this.setTimer =
      deps.setTimer ??
      ((fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      });
    this.newJobId = deps.newJobId ?? randomUUID;
    this.engineArchive = deps.engineArchive ?? ENGINE_ARCHIVE;
  }

  async status(): Promise<TranscriptionStatus> {
    const engine = await this.locate();
    const engineMissing = needsEngine(engine);
    const engineSize = this.engineArchive.sizeBytes;
    return {
      availability: availabilityOf(engine),
      defaultModelId: DEFAULT_MODEL_ID,
      models: this.catalog.map((model): TranscriptionModelInfo => {
        const own = toModelStatus(this.deps.modelStore.status(model.id));
        const download = this.download?.id === model.id ? this.download : null;
        // What the consent prompt shows: only what will actually be downloaded.
        const sizeBytes = !engineMissing
          ? model.sizeBytes
          : own.state === "ready"
            ? engineSize
            : model.sizeBytes + engineSize;
        let status = own;
        if (download?.phase === "checking") {
          // The run has not looked at the engine yet, but it is running: a poll that lands here
          // must not read it as missing, or the renderer stops polling.
          status = { state: "downloading", receivedBytes: 0, totalBytes: sizeBytes };
        } else if (download?.phase === "engine") {
          status = {
            state: "downloading",
            receivedBytes: download.engineReceived,
            totalBytes: download.totalBytes,
          };
        } else if (own.state === "downloading" && download) {
          status = {
            state: "downloading",
            receivedBytes: own.receivedBytes + download.engineBytes,
            totalBytes: own.totalBytes + download.engineBytes,
          };
        } else if (engineMissing && (own.state === "ready" || own.state === "missing")) {
          // Same shape ModelStore gives a failed download, so the offer shows its message.
          const failure = this.engineFailures.get(model.id);
          status =
            failure === undefined ? { state: "missing" } : { state: "failed", reason: failure };
        }
        return {
          id: model.id,
          label: model.label,
          languages: model.languages,
          sizeBytes,
          location: this.deps.modelStore.destination(model.id),
          license: model.license,
          status,
        };
      }),
      job: this.job ? this.progressOf(this.job) : null,
    };
  }

  /**
   * Installs the engine when it is missing, then the model: one call, one progress stream (the
   * engine's bytes first, then the model's), one cancel. A call for the model already
   * downloading returns the same promise; a call for another one is `busy`.
   */
  downloadModel(id: string): Promise<TranscriptionModelDownloadResult> {
    const model = this.catalog.find((entry) => entry.id === id);
    if (!model) return Promise.resolve({ status: "failed", code: "unknown-model" });
    if (this.download) {
      return this.download.id === id
        ? this.download.promise
        : Promise.resolve({ status: "failed", code: "busy" });
    }
    this.engineFailures.delete(id);
    const run: ModelDownload = {
      id,
      controller: new AbortController(),
      promise: undefined as unknown as Promise<TranscriptionModelDownloadResult>,
      phase: "checking",
      engineReceived: 0,
      totalBytes: 0,
      engineBytes: 0,
    };
    this.download = run;
    run.promise = this.runDownload(model, run).finally(() => {
      if (this.download === run) this.download = null;
    });
    return run.promise;
  }

  private async runDownload(
    model: ModelCatalogEntry,
    run: ModelDownload,
  ): Promise<TranscriptionModelDownloadResult> {
    const { signal } = run.controller;
    try {
      const engine = await this.locate();
      const engineMissing = needsEngine(engine);
      const modelInstalled = this.deps.modelStore.locate(model.id) !== null;
      if (engineMissing) {
        // An engine whose files exist but fail the handshake is reinstalled, not reused.
        const force = !engine.available && engine.reason === "handshake-failed";
        await this.installEngine(model, run, modelInstalled, force);
      }
      if (signal.aborted) return { status: "cancelled" };
      // Engine installed, model already there: nothing left to download.
      if (!(engineMissing && modelInstalled)) {
        await this.deps.modelStore.download(
          model.id,
          (progress) =>
            this.deps.broadcastModel({
              ...progress,
              receivedBytes: progress.receivedBytes + run.engineBytes,
              totalBytes: progress.totalBytes + run.engineBytes,
            }),
          signal,
        );
      }
      return { status: "ready" };
    } catch (error) {
      if (!(error instanceof DownloadError)) throw error;
      if (run.phase === "engine" && error.code !== "cancelled") {
        this.engineFailures.set(model.id, error.message);
      }
      return toDownloadResult(error);
    }
  }

  /** The engine phase: progress is the archive's bytes out of the engine plus the model. */
  private async installEngine(
    model: ModelCatalogEntry,
    run: ModelDownload,
    modelInstalled: boolean,
    force: boolean,
  ): Promise<void> {
    const archive = this.engineArchive;
    run.phase = "engine";
    run.totalBytes = archive.sizeBytes + (modelInstalled ? 0 : model.sizeBytes);
    let lastEmitAt = Number.NEGATIVE_INFINITY;
    let lastEmittedBytes = -1;
    const emit = () => {
      lastEmitAt = this.deps.now().getTime();
      lastEmittedBytes = run.engineReceived;
      this.deps.broadcastModel({
        id: model.id,
        receivedBytes: run.engineReceived,
        totalBytes: run.totalBytes,
        fileName: archive.archiveName,
      });
    };
    try {
      await this.deps.engineStore.install({
        force,
        signal: run.controller.signal,
        onBytes: (bytes) => {
          run.engineReceived += bytes;
          if (this.deps.now().getTime() - lastEmitAt >= ENGINE_PROGRESS_INTERVAL_MS) emit();
        },
      });
    } finally {
      // Whatever happened, the next `locate` looks at the disk again, and no probe that began
      // before this point is joined or believed.
      this.engineGeneration += 1;
      this.engineCache = null;
      this.engineInflight = null;
    }
    this.engineFailures.clear();
    run.engineBytes = archive.sizeBytes;
    run.engineReceived = archive.sizeBytes;
    if (lastEmittedBytes !== run.engineReceived) emit();
    run.phase = "model";
  }

  cancelModel(id: string): void {
    if (this.download?.id === id) this.download.controller.abort();
    this.deps.modelStore.cancel(id);
  }

  async removeModel(id: string): Promise<void> {
    if (this.job?.request.modelId === id || this.opening === id) {
      throw new Error("The speech model is in use by a transcription job");
    }
    const running = this.download;
    if (running?.id === id) {
      running.controller.abort();
      await running.promise.catch(() => undefined);
    }
    await this.deps.modelStore.remove(id);
  }

  async begin(request: TranscriptionJobRequest): Promise<TranscriptionBeginResult> {
    const engine = await this.locate();
    if (!engine.available) return { status: "refused", reason: "unavailable" };
    const model = this.catalog.find((m) => m.id === request.modelId);
    const modelDir = model ? this.deps.modelStore.locate(model.id) : null;
    if (!model || !modelDir) return { status: "refused", reason: "model-missing" };
    if (this.job || this.opening) return { status: "refused", reason: "busy" };

    this.opening = model.id;
    try {
      const vault = this.deps.openVault();
      const item = await this.resolve(vault, request);
      if (!item) return { status: "refused", reason: "invalid-item" };
      let contentHash: string;
      try {
        contentHash = await this.deps.hashMedia(item.mediaPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { status: "refused", reason: "invalid-item" };
        }
        throw error;
      }
      if (!this.sweptDirs.has(vault.tmpDir)) {
        this.sweptDirs.add(vault.tmpDir);
        await sweepStaleTmp(vault.tmpDir, this.deps.now().getTime());
      }
      await mkdir(vault.tmpDir, { recursive: true });

      const id = this.newJobId();
      const pcmPath = join(vault.tmpDir, `${id}.pcm`);
      let markFinished = () => {};
      const job: Job = {
        id,
        request,
        vault,
        item,
        contentHash,
        modelDir,
        model,
        engine: { cliPath: engine.cliPath, libDir: engine.libDir, version: engine.version },
        writer: new PcmWriter(pcmPath),
        pcmPath,
        dir: join(vault.tmpDir, id),
        partialPath: join(vault.tmpDir, `${item.id}.partial.json`),
        controller: new AbortController(),
        cancelIdle: () => {},
        phase: "receiving-audio",
        segmentsDone: 0,
        segmentsTotal: 0,
        ending: false,
        running: false,
        closed: false,
        finished: new Promise<void>((resolve) => (markFinished = resolve)),
        markFinished: () => markFinished(),
        receivedBytes: 0,
      };
      this.job = job;
      this.armIdle(job);
      this.emit(job);
      return { status: "accepted", jobId: id };
    } finally {
      this.opening = null;
    }
  }

  async chunk(jobId: string, pcm: ArrayBuffer | Uint8Array): Promise<void> {
    const job = this.liveJob(jobId);
    if (job.ending) throw new Error("transcription: the audio of this job already ended");
    const bytes = toBytes(pcm);
    if (bytes.byteLength > MAX_CHUNK_BYTES) {
      throw new RangeError(`transcription: a chunk is at most ${MAX_CHUNK_BYTES} bytes`);
    }
    if (job.receivedBytes + bytes.byteLength > MAX_AUDIO_BYTES) {
      await this.finish(job, "failed", "no-audio");
      throw new RangeError("transcription: more audio than any recording holds");
    }
    job.receivedBytes += bytes.byteLength;
    this.armIdle(job);
    try {
      await job.writer.append(bytes);
    } catch (error) {
      await this.finish(job, "failed", "write-failed");
      throw error;
    }
  }

  /** Completes the audio, or with `failReason` reports that the renderer could not provide it. */
  async end(jobId: string, failReason?: "no-audio" | "decode-failed"): Promise<void> {
    const job = this.liveJob(jobId);
    // A repeated `end` must not finish the writer twice and fail a job that is already running.
    if (job.ending) return;
    job.ending = true;
    job.cancelIdle();
    if (failReason !== undefined) {
      // "decode-failed" is the same thing for the user: no readable audio.
      await this.finish(job, "failed", "no-audio");
      return;
    }
    let audioMs: number;
    try {
      audioMs = (await job.writer.finish()).durationMs;
    } catch {
      await this.finish(job, "failed", "write-failed");
      return;
    }
    if (job.closed) return;
    if (job.controller.signal.aborted) {
      await this.finish(job, "cancelled");
      return;
    }
    if (audioMs < MIN_AUDIO_MS) {
      await this.finish(job, "failed", "no-audio");
      return;
    }
    job.running = true;
    void this.run(job, audioMs);
  }

  /** Stops the job and resolves once it has ended (the engine child is gone, tmp deleted). */
  async cancel(jobId: string): Promise<void> {
    const job = this.job;
    if (!job || job.id !== jobId || job.closed) return;
    job.controller.abort();
    if (job.running) await job.finished;
    else await this.finish(job, "cancelled");
  }

  /** Quit: signals the running job so the engine child does not outlive the app. */
  shutdown(): void {
    this.job?.controller.abort();
  }

  private liveJob(jobId: string): Job {
    const job = this.job;
    if (!job || job.id !== jobId || job.closed) throw new Error("transcription: unknown job");
    return job;
  }

  /** The engine is located once; a result of "unavailable" is looked up again on the next ask. */
  /**
   * A call that joined a probe begun before an engine install ended must not get that probe's
   * "missing": it looks again once (the new probe is current).
   */
  private async locate(): Promise<EngineLocation> {
    const generation = this.engineGeneration;
    const location = await this.probe();
    if (location.available || generation === this.engineGeneration) return location;
    return this.probe();
  }

  private probe(): Promise<EngineLocation> {
    if (this.engineCache?.available) return Promise.resolve(this.engineCache);
    if (!this.engineInflight) {
      const generation = this.engineGeneration;
      const probe: Promise<EngineLocation> = this.deps
        .locateEngine()
        .then((location) => {
          if (generation === this.engineGeneration) this.engineCache = location;
          return location;
        })
        .finally(() => {
          if (this.engineInflight === probe) this.engineInflight = null;
        });
      this.engineInflight = probe;
    }
    return this.engineInflight;
  }

  private async resolve(
    vault: TranscriptionVault,
    target: { id: string; assetId: string },
  ): Promise<ResolvedItem | null> {
    try {
      return await vault.resolve(target);
    } catch (error) {
      console.warn("[transcription] item lookup failed:", (error as Error).name);
      return null;
    }
  }

  private armIdle(job: Job): void {
    job.cancelIdle();
    job.cancelIdle = this.setTimer(() => {
      if (!job.ending) void this.finish(job, "failed", "no-audio");
    }, IDLE_TIMEOUT_MS);
  }

  private progressOf(job: Job, failure?: TranscriptionFailure): TranscriptionJobProgress {
    return {
      jobId: job.id,
      id: job.item.id,
      phase: job.phase,
      segmentsDone: job.segmentsDone,
      segmentsTotal: job.segmentsTotal,
      ...(failure ? { failure } : {}),
    };
  }

  private emit(job: Job, failure?: TranscriptionFailure): void {
    this.deps.broadcastJob(this.progressOf(job, failure));
  }

  /** Ends the job: cleans up first, then publishes the final phase, so a new job can start. */
  private async finish(
    job: Job,
    phase: "done" | "failed" | "cancelled",
    failure?: TranscriptionFailure,
  ): Promise<void> {
    if (job.closed) return;
    job.closed = true;
    job.cancelIdle();
    // A crash or a failed write can be resumed from the partial; every other end drops it.
    const keepPartial = failure === "engine-failed" || failure === "write-failed";
    await job.writer.abort().catch(() => {});
    await rm(job.pcmPath, { force: true }).catch(() => {});
    await rm(job.dir, { recursive: true, force: true }).catch(() => {});
    if (!keepPartial) await rm(job.partialPath, { force: true }).catch(() => {});
    if (this.job === job) this.job = null;
    job.phase = phase;
    this.emit(job, failure);
    job.markFinished();
  }

  private async run(job: Job, audioMs: number): Promise<void> {
    try {
      await this.process(job, audioMs);
      await this.finish(job, "done");
    } catch (error) {
      if (job.controller.signal.aborted) {
        await this.finish(job, "cancelled");
      } else if (error instanceof JobFailure) {
        await this.finish(job, "failed", error.failure);
      } else {
        // The error's name and code only: messages of the engine and of fs calls are not ours to log.
        console.warn(
          "[transcription] job failed:",
          error instanceof SherpaError ? error.code : (error as Error)?.name,
        );
        await this.finish(job, "failed", "engine-failed");
      }
    }
  }

  private ensureLive(job: Job): void {
    if (job.controller.signal.aborted) throw new JobFailure("engine-failed");
  }

  private async process(job: Job, audioMs: number): Promise<void> {
    const start = await this.resolve(job.vault, job.request);
    if (!start || start.id !== job.item.id || start.mediaPath !== job.item.mediaPath) {
      throw new JobFailure("item-changed");
    }
    // The hash from `begin`, not one taken now: the audio was decoded from the file as it was
    // then, so a file replaced since must read as stale, never as the file that was transcribed.
    const { contentHash } = job;
    this.ensureLive(job);

    const levels = await computeFrameLevelsDb(job.pcmPath);
    this.ensureLive(job);
    const plan = planSegments({ durationMs: audioMs, levels });
    const key: PartialKey = {
      mediaHash: contentHash,
      modelId: job.model.id,
      engineVersion: job.engine.version,
      durationMs: audioMs,
      planFingerprint: planFingerprint(plan.segments),
    };
    const wordsBySegment = await loadPartial(job.partialPath, key);
    this.ensureLive(job);

    const pending = plan.segments.filter((segment) => !wordsBySegment.has(segment.id));
    job.phase = "transcribing";
    job.segmentsTotal = plan.segments.length;
    job.segmentsDone = plan.segments.length - pending.length;
    this.emit(job);

    await mkdir(job.dir, { recursive: true });
    for (let from = 0; from < pending.length; from += SEGMENTS_PER_BATCH) {
      const batch = pending.slice(from, from + SEGMENTS_PER_BATCH);
      const results = await this.runSegments(job, batch);
      batch.forEach((segment, index) => {
        wordsBySegment.set(segment.id, groupTokens(results[index]!, segment));
      });
      await savePartial(job.partialPath, key, wordsBySegment);
      job.segmentsDone += batch.length;
      this.emit(job);
    }

    job.phase = "writing";
    this.emit(job);
    const transcript = buildTranscript({
      segments: plan.segments,
      seams: plan.seams,
      wordsBySegment,
      levels,
      model: {
        id: job.model.id,
        revision: job.model.revision,
        files: Object.fromEntries(job.model.files.map((file) => [file.name, file.sha256])),
      },
      engine: { name: ENGINE_NAME, version: job.engine.version },
      media: { contentHash, durationMs: audioMs },
      now: this.deps.now(),
    });

    // Under the lock a rename takes: the item is checked and the file written with no rename
    // in between, so a transcript never lands beside a name the item no longer has.
    await job.vault.withItemLock(job.item.id, async () => {
      const current = await this.resolve(job.vault, job.request);
      if (!current || current.id !== job.item.id || current.mediaPath !== job.item.mediaPath) {
        throw new JobFailure("item-changed");
      }
      this.ensureLive(job);
      try {
        await writeTranscriptFileAtomic(current.transcriptPath, transcript);
      } catch {
        throw new JobFailure("write-failed");
      }
    });
  }

  /** Cuts the batch's WAV files, runs the engine once over them and removes the files. */
  private async runSegments(job: Job, batch: Segment[]): Promise<CliResult[]> {
    const wavPaths = batch.map((segment) => join(job.dir, `${segment.id}.wav`));
    try {
      for (const [index, segment] of batch.entries()) {
        await writeSegmentWav(job.pcmPath, segment.startMs, segment.endMs, wavPaths[index]!);
      }
      this.ensureLive(job);
      const batchAudioMs = batch.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
      return await this.deps.runBatch({
        cliPath: job.engine.cliPath,
        libDir: job.engine.libDir,
        modelDir: job.modelDir,
        wavPaths,
        deadlineMs: BATCH_DEADLINE_BASE_MS + BATCH_DEADLINE_AUDIO_FACTOR * batchAudioMs,
        signal: job.controller.signal,
      });
    } finally {
      await Promise.all(wavPaths.map((path) => rm(path, { force: true }).catch(() => {})));
    }
  }
}
