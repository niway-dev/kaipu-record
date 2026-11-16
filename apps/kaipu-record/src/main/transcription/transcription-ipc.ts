/**
 * IPC for local transcription (NIW2-818 M1). Every argument comes from the renderer, so each is
 * checked here before the service sees it. `transcriptionJobBegin` and
 * `transcriptionReadTranscript` act on a library item: they run inside the workspace gate and
 * under one vault lease, like the other item handlers. The rest are app-wide or address a job
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
  TranscriptReadResult,
} from "@shared/types/transcription";
import { sha256FileBase64 } from "../library/content-hash";
import { broadcast, broadcastLibraryChanged, currentVault, scopedAdmitted } from "../library";
import { withItemLock } from "../library/item-lock";
import { META_DIR, isPlainItemId } from "../library/library-vault";
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

function createService(deps: TranscriptionIpcDeps): TranscriptionService {
  const engineStore = new EngineStore({ rootDir: deps.engineRoot });
  return new TranscriptionService({
    locateEngine: () => locateEngine({ engineDir: engineStore.installDir }),
    modelStore: new ModelStore({ rootDir: deps.modelsRoot }),
    openVault: openTranscriptionVault,
    runBatch,
    hashMedia: sha256FileBase64,
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
  return {
    id,
    assetId: parseId(request.assetId, "asset id"),
    modelId: parseId(request.modelId, "model id"),
    durationMs,
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

/**
 * The file's words, with `stale` when the recording's content no longer matches the one that was
 * transcribed. The hash is computed on each call and kept nowhere. That streams the whole file while
 * the library gate is held, so the cost grows with the recording's size; a (size, mtime) precheck
 * that skips the hash is the known follow-up, left out because the media hash is what marks a
 * transcript stale.
 */
async function readTranscript(id: string): Promise<TranscriptReadResult> {
  if (!isPlainItemId(id)) throw new Error("transcription: invalid item id");
  const vault = currentVault();
  const read = await readTranscriptFile(vault.companionPaths(id).transcript);
  if (!read.ok) return { status: read.reason === "not-found" ? "none" : "invalid" };
  let hash: string;
  try {
    hash = await sha256FileBase64(await vault.filePath(id));
  } catch (error) {
    // A transcript with no recording beside it belongs to nothing the app shows.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "none" };
    throw error;
  }
  return {
    status: "ready",
    transcript: read.transcript,
    stale: hash !== read.transcript.media.contentHash,
  };
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
      return override ? { status: "refused", reason: "unavailable" } : service.begin(parsed);
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

  return service;
}
