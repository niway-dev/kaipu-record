/**
 * IPC for local transcription (NIW2-818 M1). Every argument comes from the renderer, so each is
 * checked here before the service sees it. `transcriptionJobBegin` and
 * `transcriptionReadTranscript` and `transcriptionCheckFreshness` act on a library item: they
 * run inside the workspace gate and under one vault lease, like the other item handlers. The rest are app-wide or address a job
 * by the id main gave it.
 */
import { join } from "node:path";
import { ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/types";
import type {
  TranscriptionBeginResult,
  TranscriptionJobProgress,
  TranscriptionJobRequest,
  TranscriptionModelDownloadResult,
  TranscriptFreshnessResult,
  TranscriptReadResult,
} from "@shared/types/transcription";
import { sha256FileBase64 } from "../library/content-hash";
import { broadcast, broadcastLibraryChanged, currentVault, scopedAdmitted } from "../library";
import { withItemLock } from "../library/item-lock";
import { FileChangedWhileHashingError, META_DIR, isPlainItemId } from "../library/library-vault";
import { activeWorkspace } from "../workspaces";
import { PinnedJobs } from "./dev-job-pin";
import { applyTranscriptionOverride, type TranscriptionOverride } from "./dev-override";
import { locateEngine } from "./engine/engine-locator";
import { EngineStore } from "./engine/engine-store";
import { runBatch } from "./engine/sherpa-supervisor";
import { ModelStore } from "./models/model-store";
import { readTranscriptFile } from "./transcript-file";
import {
  MAX_CHUNK_BYTES,
  TranscriptionService,
  type ResolvedItem,
  type TranscriptionVault,
} from "./transcription-service";

/** No recording is longer than this; a bigger number is not a duration the renderer measured. */
const MAX_DURATION_MS = 12 * 60 * 60 * 1000;
const MAX_ID_LENGTH = 512;

export interface TranscriptionIpcDeps {
  /** `userData/speech-engine`: where the downloaded engine installs. */
  engineRoot: string;
  /** `userData/models`. */
  modelsRoot: string;
  /** Test seam: the service the handlers drive. */
  service?: TranscriptionService;
  /**
   * `KAIPU_TRANSCRIPTION` already resolved for this build (`resolveTranscriptionOverride`), for
   * the UI state catalog. While it is set, main reports the pinned model state and touches
   * neither the network nor the model folder.
   */
  override?: TranscriptionOverride | null;
}

/** The active workspace's vault, as the job sees it. Called inside the workspace gate. */
export function openTranscriptionVault(): TranscriptionVault {
  const vault = currentVault();
  const workspaceId = activeWorkspace().id;
  return {
    tmpDir: join(vault.directory, META_DIR, "tmp"),
    async resolve({ id, assetId }) {
      if (!isPlainItemId(id)) return null;
      const item = await vault.describe(id);
      if (!item || item.assetId !== assetId || item.kind !== "recording") return null;
      return {
        id: item.id,
        assetId,
        mediaPath: item.filePath,
        transcriptPath: vault.companionPaths(item.id).transcript,
      };
    },
    withItemLock: (id, fn) => withItemLock(workspaceId, id, fn),
  };
}

/**
 * A job's last phase is published after its transcript file is written, so "done" is the moment
 * the library list gains a "Transcribed" item: tell every window to re-list.
 */
export function broadcastJobProgress(progress: TranscriptionJobProgress): void {
  broadcast(IPC_CHANNELS.transcriptionJobProgress, progress);
  if (progress.phase === "done") broadcastLibraryChanged();
}

/**
 * The media hash a job stores. It goes through the vault's content-hash cache, so the job leaves
 * the stamp behind and the transcript it writes opens warm (NIW2-891). The cache re-hashes the
 * real content whenever the stamp does not match. A file that keeps changing while it is hashed
 * is hashed plainly once, as before the cache: the job still needs a number, and the transcript
 * reads as out of date if the file moved on.
 */
export async function hashMediaThroughCache(
  item: Pick<ResolvedItem, "id" | "mediaPath">,
): Promise<string> {
  try {
    const hashed = await currentVault().ensureContentHash(item.id);
    if (hashed) return hashed.contentSha256;
  } catch {
    // The cache could not answer (the file kept changing, or the sidecar cannot be written on a
    // read-only vault): hash plainly, as before the cache. A file that is gone fails with ENOENT.
    return sha256FileBase64(item.mediaPath);
  }
  throw Object.assign(new Error(`transcription: media of "${item.id}" is gone`), {
    code: "ENOENT",
  });
}

function createService(deps: TranscriptionIpcDeps): TranscriptionService {
  const engineStore = new EngineStore({ rootDir: deps.engineRoot });
  return new TranscriptionService({
    locateEngine: () => locateEngine({ engineDir: engineStore.installDir }),
    engineStore,
    modelStore: new ModelStore({ rootDir: deps.modelsRoot }),
    openVault: openTranscriptionVault,
    runBatch,
    hashMedia: hashMediaThroughCache,
    now: () => new Date(),
    broadcastJob: broadcastJobProgress,
    broadcastModel: (progress) => broadcast(IPC_CHANNELS.transcriptionModelProgress, progress),
  });
}

function parseId(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new Error(`transcription: invalid ${what}`);
  }
  return value;
}

function parseRequest(value: unknown): TranscriptionJobRequest {
  const request = value as Partial<Record<keyof TranscriptionJobRequest, unknown>> | null;
  if (typeof request !== "object" || request === null) {
    throw new Error("transcription: invalid request");
  }
  const id = parseId(request.id, "item id");
  if (!isPlainItemId(id)) throw new Error("transcription: invalid item id");
  const { durationMs } = request;
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs > MAX_DURATION_MS
  ) {
    throw new Error("transcription: invalid duration");
  }
  if (request.automatic !== undefined && typeof request.automatic !== "boolean") {
    throw new Error("transcription: invalid automatic flag");
  }
  return {
    id,
    assetId: parseId(request.assetId, "asset id"),
    modelId: parseId(request.modelId, "model id"),
    durationMs,
    ...(request.automatic === true ? { automatic: true } : {}),
  };
}

/** The renderer sends an ArrayBuffer, or a typed array depending on the IPC path. */
function parseChunk(value: unknown): Uint8Array {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : null;
  if (!bytes) throw new Error("transcription: audio must be binary");
  if (bytes.byteLength > MAX_CHUNK_BYTES) throw new Error("transcription: audio chunk too large");
  return bytes;
}

function parseFailReason(value: unknown): "no-audio" | "decode-failed" | undefined {
  if (value === undefined) return undefined;
  if (value === "no-audio" || value === "decode-failed") return value;
  throw new Error("transcription: invalid fail reason");
}

/** `[transcript-timing]` lines: the base point for how long opening a transcript takes. */
function logTiming(what: string, started: number, outcome: string): void {
  console.info(
    `[transcript-timing] ${what} ${Math.round(performance.now() - started)}ms ${outcome}`,
  );
}

/**
 * The file's words and what the cache already says about them. The media is never read here:
 * when the vault's content-hash cache matches the file the verdict is exact (`fresh` or
 * `stale`), otherwise it is `checking` and `checkTranscriptFreshness` settles it. A full hash
 * of a 15 GB recording took 7 to 22 seconds, and the words themselves read in 13 ms.
 */
async function readTranscript(id: string): Promise<TranscriptReadResult> {
  if (!isPlainItemId(id)) throw new Error("transcription: invalid item id");
  const started = performance.now();
  const vault = currentVault();
  const read = await readTranscriptFile(vault.companionPaths(id).transcript);
  if (!read.ok) return { status: read.reason === "not-found" ? "none" : "invalid" };
  const cached = await vault.cachedContentHash(id);
  // A transcript with no recording beside it belongs to nothing the app shows.
  if (cached.status === "missing") return { status: "none" };
  const hit = cached.status === "hit";
  const stale = hit && cached.contentSha256 !== read.transcript.media.contentHash;
  logTiming(`read ${id}`, started, `cache=${hit ? "hit" : "miss"}`);
  return {
    status: "ready",
    transcript: read.transcript,
    stale,
    freshness: !hit ? "checking" : stale ? "stale" : "fresh",
  };
}

const UNKNOWN: TranscriptFreshnessResult = { verdict: "unknown", autoRetranscribe: false };

/** The checks in flight, so two windows (or two hooks) asking about one item share one hash. */
const checksInFlight = new Map<string, Promise<TranscriptFreshnessResult>>();

async function checkFreshness(id: string): Promise<TranscriptFreshnessResult> {
  const vault = currentVault();
  const read = await readTranscriptFile(vault.companionPaths(id).transcript);
  if (!read.ok) return UNKNOWN;
  let contentSha256: string;
  try {
    const hashed = await vault.ensureContentHash(id);
    if (!hashed) return UNKNOWN;
    contentSha256 = hashed.contentSha256;
  } catch (error) {
    if (!(error instanceof FileChangedWhileHashingError)) {
      console.warn(`[transcript-timing] check ${id} could not hash the media`, error);
    }
    return UNKNOWN;
  }
  // The hash can take seconds, and a job may rewrite the transcript meanwhile: judge against
  // the transcript as it is now, not the one read before hashing.
  const current = await readTranscriptFile(vault.companionPaths(id).transcript);
  if (!current.ok) return UNKNOWN;
  if (contentSha256 === current.transcript.media.contentHash) {
    return { verdict: "fresh", autoRetranscribe: false };
  }
  const sidecar = await vault.sidecar(id).catch(() => null);
  return {
    verdict: "stale",
    autoRetranscribe: sidecar !== null && sidecar.autoRetranscribedSha256 !== contentSha256,
    mediaContentSha256: contentSha256,
  };
}

/**
 * Settles a `checking` read: the media hash comes from the cache, or is computed once and
 * cached. Concurrent calls for one item share one promise.
 */
function checkTranscriptFreshness(id: string): Promise<TranscriptFreshnessResult> {
  if (!isPlainItemId(id)) throw new Error("transcription: invalid item id");
  const key = `${activeWorkspace().id}:${id}`;
  const running = checksInFlight.get(key);
  if (running) return running;
  const started = performance.now();
  const promise = checkFreshness(id)
    .then((result) => {
      logTiming(`check ${id}`, started, `result=${result.verdict}`);
      return result;
    })
    .finally(() => checksInFlight.delete(key));
  checksInFlight.set(key, promise);
  return promise;
}

/**
 * An automatic job is recorded against the content hash it was admitted with, so a run that
 * fails or is cancelled does not start again on the next open. The hash is the one taken before
 * the job began: hashing again here could record content the job never transcribed.
 */
async function recordAutomaticAttempt(id: string, contentSha256: string): Promise<void> {
  await currentVault().writeMeta(id, { autoRetranscribedSha256: contentSha256 });
}

/** Automatic begins in flight, `${workspace}:${item}:${hash}`, so two windows cannot both start. */
const automaticInFlight = new Set<string>();

async function beginAutomatic(
  service: TranscriptionService,
  parsed: ReturnType<typeof parseRequest>,
): Promise<TranscriptionBeginResult> {
  const vault = currentVault();
  // The service checks the asset id and the kind. An item that is gone, or media that cannot be
  // hashed, gets the service's own refusal or failure: there is no content to record against.
  const item = await vault.describe(parsed.id);
  if (!item) return service.begin(parsed);
  let hash: string;
  try {
    hash = await hashMediaThroughCache({ id: item.id, mediaPath: item.filePath });
  } catch {
    return service.begin(parsed);
  }
  const key = `${activeWorkspace().id}:${parsed.id}:${hash}`;
  // No await between the check and the add: the claim is atomic within this process.
  if (automaticInFlight.has(key)) return { status: "refused", reason: "busy" };
  automaticInFlight.add(key);
  try {
    const sidecar = await vault.sidecar(parsed.id).catch(() => null);
    if (sidecar?.autoRetranscribedSha256 === hash) return { status: "refused", reason: "busy" };
    const result = await service.begin(parsed);
    if (result.status === "accepted") {
      // The job already holds the slot: the renderer must get its id even when the record
      // cannot be written.
      try {
        await recordAutomaticAttempt(parsed.id, hash);
      } catch (error) {
        console.warn(
          `transcription: could not record the automatic attempt for ${parsed.id}`,
          error,
        );
      }
    }
    return result;
  } finally {
    automaticInFlight.delete(key);
  }
}

export function registerTranscriptionIpc(deps: TranscriptionIpcDeps): TranscriptionService {
  const service = deps.service ?? createService(deps);

  const { override } = deps;
  // A pinned job (`KAIPU_TRANSCRIPTION=ready,job:...`, unpackaged builds only) replaces the
  // service for the job calls, so a catalog shot can show a running or failed job.
  const pinned = override?.job ? new PinnedJobs(override.job, broadcastJobProgress) : null;

  ipcMain.handle(IPC_CHANNELS.transcriptionStatus, async () => {
    const status = await service.status();
    return override ? applyTranscriptionOverride(override, status) : status;
  });
  ipcMain.handle(
    IPC_CHANNELS.transcriptionModelDownload,
    async (_event, id: unknown): Promise<TranscriptionModelDownloadResult> => {
      const modelId = parseId(id, "model id");
      // A stray click in a shot must not start a 640 MB download.
      return override ? { status: "cancelled" } : service.downloadModel(modelId);
    },
  );
  ipcMain.handle(IPC_CHANNELS.transcriptionModelCancel, (_event, id: unknown) =>
    service.cancelModel(parseId(id, "model id")),
  );
  ipcMain.handle(IPC_CHANNELS.transcriptionModelRemove, async (_event, id: unknown) => {
    const modelId = parseId(id, "model id");
    if (!override) await service.removeModel(modelId);
  });

  ipcMain.handle(
    IPC_CHANNELS.transcriptionJobBegin,
    scopedAdmitted("library", async (request: unknown): Promise<TranscriptionBeginResult> => {
      const parsed = parseRequest(request);
      if (pinned) return pinned.begin(parsed);
      if (override) return { status: "refused", reason: "unavailable" };
      if (parsed.automatic) return beginAutomatic(service, parsed);
      return service.begin(parsed);
    }),
  );
  ipcMain.handle(IPC_CHANNELS.transcriptionJobChunk, (_event, jobId: unknown, pcm: unknown) => {
    const id = parseId(jobId, "job id");
    const bytes = parseChunk(pcm);
    if (!pinned) return service.chunk(id, bytes);
    return pinned.audio(id);
  });
  ipcMain.handle(IPC_CHANNELS.transcriptionJobEnd, (_event, jobId: unknown, reason?: unknown) => {
    const id = parseId(jobId, "job id");
    const failReason = parseFailReason(reason);
    if (!pinned) return service.end(id, failReason);
    return pinned.audio(id);
  });
  ipcMain.handle(IPC_CHANNELS.transcriptionJobCancel, (_event, jobId: unknown) => {
    const id = parseId(jobId, "job id");
    if (!pinned) return service.cancel(id);
    return pinned.cancel(id);
  });
  ipcMain.handle(
    IPC_CHANNELS.transcriptionReadTranscript,
    scopedAdmitted("library", (id: unknown) => readTranscript(parseId(id, "item id"))),
  );
  ipcMain.handle(
    IPC_CHANNELS.transcriptionCheckFreshness,
    scopedAdmitted("library", (id: unknown) => checkTranscriptFreshness(parseId(id, "item id"))),
  );

  return service;
}
