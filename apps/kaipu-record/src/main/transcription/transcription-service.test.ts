import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type {
  TranscriptionJobProgress,
  TranscriptionModelProgress,
} from "@shared/types/transcription";
import { ENGINE_ARCHIVE } from "./engine/engine-catalog";
import { DownloadError } from "./download-file";
import type { EngineLocation } from "./engine/engine-locator";
import { SherpaError, type CliResult, type RunBatchOptions } from "./engine/sherpa-supervisor";
import { DEFAULT_MODEL_ID, getModel } from "./models/catalog";
import { ModelStoreError, type ModelStatus } from "./models/model-store";
import { PcmWriter } from "./pcm";
import { parseTranscript } from "./transcript-file";
import {
  BATCH_DEADLINE_AUDIO_FACTOR,
  BATCH_DEADLINE_BASE_MS,
  IDLE_TIMEOUT_MS,
  MAX_CHUNK_BYTES,
  SEGMENTS_PER_BATCH,
  TranscriptionService,
  type ResolvedItem,
  type TranscriptionServiceDeps,
  type TranscriptionVault,
} from "./transcription-service";

const MODEL_ID = DEFAULT_MODEL_ID;
const AVAILABLE: EngineLocation = {
  available: true,
  cliPath: "/engine/bin/sherpa-onnx-offline",
  libDir: "/engine/lib",
  version: "1.13.8",
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kaipu-transcription-service-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** One recording in a temp vault. Mutating `state` plays a rename or a removal. */
function makeVault() {
  const state = {
    id: "rec",
    assetId: "asset-1",
    mediaPath: join(root, "rec.mp4"),
    transcriptPath: join(root, ".kaipu", "rec.transcript.json"),
    gone: false,
  };
  let tail: Promise<unknown> = Promise.resolve();
  const vault: TranscriptionVault = {
    tmpDir: join(root, ".kaipu", "tmp"),
    async resolve(target): Promise<ResolvedItem | null> {
      if (state.gone || target.id !== state.id || target.assetId !== state.assetId) return null;
      return {
        id: state.id,
        assetId: state.assetId,
        mediaPath: state.mediaPath,
        transcriptPath: state.transcriptPath,
      };
    },
    withItemLock(_id, fn) {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    },
  };
  return { state, vault };
}

function cannedResult(): CliResult {
  return {
    text: "hello world",
    tokens: ["▁hello", "▁world"],
    timestamps: [0.5, 1.0],
    durations: [0.3, 0.3],
    ys_log_probs: [-0.1, -0.2],
  };
}

/** A supervisor that never answers on its own: it ends when the job aborts it, as the real one does. */
const blockUntilAborted = (options: RunBatchOptions): Promise<CliResult[]> =>
  new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () =>
      reject(new SherpaError("cancelled", "cancelled")),
    );
  });

type Batch = (options: RunBatchOptions, call: number) => Promise<CliResult[]>;

function makeHarness(overrides: Partial<TranscriptionServiceDeps> = {}) {
  const { state, vault } = makeVault();
  const events: TranscriptionJobProgress[] = [];
  const modelEvents: TranscriptionModelProgress[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const calls: string[][] = [];
  const optionsSeen: RunBatchOptions[] = [];
  const wavsExisted: boolean[] = [];
  const supervisor = { batch: null as Batch | null };
  const modelStatus = new Map<string, ModelStatus>([
    [MODEL_ID, { state: "ready", dir: `/models/${MODEL_ID}` }],
  ]);
  const modelStore = {
    status: vi.fn((id: string) => modelStatus.get(id) ?? ({ state: "missing" } as ModelStatus)),
    locate: vi.fn((id: string) => {
      const status = modelStatus.get(id);
      return status?.state === "ready" ? status.dir : null;
    }),
    destination: vi.fn((id: string) => `/models/${id}`),
    download: vi.fn(async (_id: string, onProgress: (p: TranscriptionModelProgress) => void) => {
      onProgress({ id: MODEL_ID, receivedBytes: 1, totalBytes: 2, fileName: "encoder.int8.onnx" });
      return `/models/${MODEL_ID}`;
    }),
    cancel: vi.fn(),
    remove: vi.fn(async () => {}),
  };
  /** The downloaded engine: `missing` plays a machine where it was never installed. */
  const engine = { missing: false, broken: false };
  const engineStore = {
    install: vi.fn(
      async (options: {
        force?: boolean;
        signal?: AbortSignal;
        onBytes?: (bytes: number) => void;
      }) => {
        const half = Math.floor(ENGINE_ARCHIVE.sizeBytes / 2);
        options.onBytes?.(half);
        options.onBytes?.(ENGINE_ARCHIVE.sizeBytes - half);
        engine.missing = false;
        engine.broken = false;
        return "/engine";
      },
    ),
  };
  const runBatch = vi.fn(async (options: RunBatchOptions): Promise<CliResult[]> => {
    calls.push(options.wavPaths.map((p) => basename(p, ".wav")));
    optionsSeen.push(options);
    wavsExisted.push(options.wavPaths.every((p) => existsSync(p)));
    if (supervisor.batch) return supervisor.batch(options, calls.length);
    return options.wavPaths.map(cannedResult);
  });
  const deps: TranscriptionServiceDeps = {
    locateEngine: vi.fn(
      async (): Promise<EngineLocation> =>
        engine.missing
          ? { available: false, reason: "binary-missing" }
          : engine.broken
            ? { available: false, reason: "handshake-failed" }
            : AVAILABLE,
    ),
    modelStore,
    engineStore,
    openVault: () => vault,
    runBatch,
    hashMedia: vi.fn(async () => "hash-1"),
    now: () => new Date("2026-11-15T10:00:00.000Z"),
    broadcastJob: (progress) => events.push(progress),
    broadcastModel: (progress) => modelEvents.push(progress),
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    newJobId: (() => {
      let n = 0;
      return () => `job-${++n}`;
    })(),
    ...overrides,
  };
  const service = new TranscriptionService(deps);
  const terminal = () =>
    events.find((e) => e.phase === "done" || e.phase === "failed" || e.phase === "cancelled");
  const settled = async () => {
    await vi.waitFor(() => expect(terminal()).toBeDefined(), { timeout: 15_000 });
    return terminal()!;
  };
  return {
    service,
    state,
    vault,
    deps,
    events,
    modelEvents,
    timers,
    calls,
    optionsSeen,
    wavsExisted,
    supervisor,
    modelStatus,
    modelStore,
    engine,
    engineStore,
    runBatch,
    settled,
  };
}

const REQUEST = { id: "rec", assetId: "asset-1", modelId: MODEL_ID, durationMs: 70_000 };

/** Streams `ms` of silence as 16 kHz mono PCM16, in chunks under the cap. */
async function sendAudio(service: TranscriptionService, jobId: string, ms: number): Promise<void> {
  let remaining = Math.round(ms * 32);
  while (remaining > 0) {
    const size = Math.min(remaining, 1024 * 1024);
    await service.chunk(jobId, new Uint8Array(size).buffer);
    remaining -= size;
  }
}

async function startJob(h: ReturnType<typeof makeHarness>, ms = 70_000): Promise<string> {
  await mkdir(join(root, ".kaipu"), { recursive: true });
  await writeFile(h.state.mediaPath, "media");
  const result = await h.service.begin(REQUEST);
  if (result.status !== "accepted") throw new Error(`refused: ${result.reason}`);
  await sendAudio(h.service, result.jobId, ms);
  return result.jobId;
}

async function runToEnd(h: ReturnType<typeof makeHarness>, ms = 70_000) {
  const jobId = await startJob(h, ms);
  await h.service.end(jobId);
  return h.settled();
}

const tmpEntries = async (h: ReturnType<typeof makeHarness>) =>
  (await readdir(h.vault.tmpDir).catch(() => [])).filter((n) => !n.endsWith(".partial.json"));

describe("status", () => {
  it("maps availability, the catalog, model states and the current job", async () => {
    const h = makeHarness();
    h.modelStatus.set("parakeet-tdt-0.6b-v2-int8", {
      state: "downloading",
      receivedBytes: 5,
      totalBytes: 10,
    });
    const status = await h.service.status();
    expect(status.availability).toEqual({ status: "available" });
    expect(status.defaultModelId).toBe(MODEL_ID);
    expect(status.job).toBeNull();
    const v3 = status.models.find((m) => m.id === MODEL_ID)!;
    const catalogEntry = getModel(MODEL_ID)!;
    expect(v3).toMatchObject({
      label: catalogEntry.label,
      languages: catalogEntry.languages,
      sizeBytes: catalogEntry.sizeBytes,
      location: `/models/${MODEL_ID}`,
      license: catalogEntry.license,
      status: { state: "ready" },
    });
    expect(status.models.find((m) => m.id === "parakeet-tdt-0.6b-v2-int8")!.status).toEqual({
      state: "downloading",
      receivedBytes: 5,
      totalBytes: 10,
    });
  });

  it("maps each engine reason and rechecks only an unavailable engine", async () => {
    const locateEngine = vi
      .fn<() => Promise<EngineLocation>>()
      .mockResolvedValueOnce({ available: false, reason: "binary-missing" })
      .mockResolvedValueOnce({ available: false, reason: "handshake-failed" })
      .mockResolvedValueOnce({ available: false, reason: "unsupported-platform" })
      .mockResolvedValue(AVAILABLE);
    const h = makeHarness({ locateEngine });
    const reasons: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      const { availability } = await h.service.status();
      reasons.push(availability.status === "unavailable" ? availability.reason : null);
    }
    // A missing or failing engine is "not installed", never "unavailable": the download is the repair.
    expect(reasons).toEqual([null, null, "unsupported-platform"]);
    await h.service.status();
    await h.service.status();
    expect(locateEngine).toHaveBeenCalledTimes(4);
  });

  it("reports the job in progress", async () => {
    const h = makeHarness();
    const jobId = await startJob(h);
    expect((await h.service.status()).job).toEqual({
      jobId,
      id: "rec",
      phase: "receiving-audio",
      segmentsDone: 0,
      segmentsTotal: 0,
    });
    await h.service.cancel(jobId);
    expect((await h.service.status()).job).toBeNull();
  });
});

describe("models", () => {
  it("forwards progress and reports ready", async () => {
    const h = makeHarness();
    expect(await h.service.downloadModel(MODEL_ID)).toEqual({ status: "ready" });
    expect(h.modelEvents).toEqual([
      { id: MODEL_ID, receivedBytes: 1, totalBytes: 2, fileName: "encoder.int8.onnx" },
    ]);
  });

  it("answers unknown-model for an id outside the catalog, without asking the store", async () => {
    const h = makeHarness();
    expect(await h.service.downloadModel("nope")).toEqual({
      status: "failed",
      code: "unknown-model",
    });
    expect(h.modelStore.download).not.toHaveBeenCalled();
  });

  it.each([
    "network",
    "hash-mismatch",
    "size-mismatch",
    "insufficient-disk-space",
    "busy",
  ] as const)("maps the %s error code", async (code) => {
    const h = makeHarness();
    h.modelStore.download.mockRejectedValueOnce(new ModelStoreError(code, "x"));
    expect(await h.service.downloadModel(MODEL_ID)).toEqual({ status: "failed", code });
  });

  it("maps a cancelled download to cancelled", async () => {
    const h = makeHarness();
    h.modelStore.download.mockRejectedValueOnce(new ModelStoreError("cancelled", "x"));
    expect(await h.service.downloadModel(MODEL_ID)).toEqual({ status: "cancelled" });
  });

  it("does not hide an error the store did not classify", async () => {
    const h = makeHarness();
    h.modelStore.download.mockRejectedValueOnce(new Error("boom"));
    await expect(h.service.downloadModel(MODEL_ID)).rejects.toThrow("boom");
  });

  it("cancels through the store", () => {
    const h = makeHarness();
    h.service.cancelModel(MODEL_ID);
    expect(h.modelStore.cancel).toHaveBeenCalledWith(MODEL_ID);
  });

  it("removes a model, but not while a job uses it", async () => {
    const h = makeHarness();
    await h.service.removeModel(MODEL_ID);
    expect(h.modelStore.remove).toHaveBeenCalledTimes(1);
    const jobId = await startJob(h);
    await expect(h.service.removeModel(MODEL_ID)).rejects.toThrow(/in use/);
    expect(h.modelStore.remove).toHaveBeenCalledTimes(1);
    await h.service.cancel(jobId);
    await h.service.removeModel(MODEL_ID);
    expect(h.modelStore.remove).toHaveBeenCalledTimes(2);
  });
});

describe("the engine downloads with the model", () => {
  const ENGINE = ENGINE_ARCHIVE.sizeBytes;
  const MODEL = getModel(MODEL_ID)!.sizeBytes;
  const OTHER_ID = "parakeet-tdt-0.6b-v2-int8";

  /** A clock that moves 300 ms per read, so the progress throttle never swallows an event. */
  const steppingClock = () => {
    let ms = 0;
    return () => new Date((ms += 300));
  };

  /** An install that waits until released or aborted, like a download in flight. */
  function pausedInstall(h: ReturnType<typeof makeHarness>) {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    h.engineStore.install.mockImplementationOnce(async (options) => {
      options.onBytes?.(1000);
      started.resolve();
      await new Promise<void>((resolve, reject) => {
        release.promise.then(resolve);
        options.signal?.addEventListener("abort", () =>
          reject(new DownloadError("cancelled", "The download was cancelled.")),
        );
      });
      h.engine.missing = false;
      return "/engine";
    });
    return { started: started.promise, release: release.resolve };
  }

  it("offers the download: models read missing and the size includes the engine", async () => {
    const h = makeHarness();
    h.engine.missing = true;
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    const status = await h.service.status();
    expect(status.availability).toEqual({ status: "available" });
    const info = (id: string) => status.models.find((m) => m.id === id)!;
    expect(info(MODEL_ID).status).toEqual({ state: "missing" });
    expect(info(MODEL_ID).sizeBytes).toBe(MODEL + ENGINE);
    expect(info(OTHER_ID).sizeBytes).toBe(getModel(OTHER_ID)!.sizeBytes + ENGINE);
  });

  it("reads an installed model as missing while the engine is missing, sized as the engine only", async () => {
    const h = makeHarness();
    h.engine.missing = true;
    const status = await h.service.status();
    const info = status.models.find((m) => m.id === MODEL_ID)!;
    expect(info.status).toEqual({ state: "missing" });
    expect(info.sizeBytes).toBe(ENGINE);
  });

  it("leaves other model states and the plain size alone once the engine is installed", async () => {
    const h = makeHarness();
    const info = (await h.service.status()).models.find((m) => m.id === MODEL_ID)!;
    expect(info.status).toEqual({ state: "ready" });
    expect(info.sizeBytes).toBe(MODEL);
  });

  it("treats an engine that fails its handshake like a missing one: the download is the repair", async () => {
    const h = makeHarness();
    h.engine.broken = true;
    const status = await h.service.status();
    expect(status.availability).toEqual({ status: "available" });
    const info = status.models.find((m) => m.id === MODEL_ID)!;
    expect(info.status).toEqual({ state: "missing" });
    expect(info.sizeBytes).toBe(ENGINE);
  });

  it("keeps an unsupported machine unavailable, with every model state as the store reports it", async () => {
    const h = makeHarness({
      locateEngine: async () => ({ available: false, reason: "unsupported-platform" }),
    });
    const status = await h.service.status();
    expect(status.availability).toEqual({
      status: "unavailable",
      reason: "unsupported-platform",
    });
    const info = status.models.find((m) => m.id === MODEL_ID)!;
    expect(info.status).toEqual({ state: "ready" });
    expect(info.sizeBytes).toBe(MODEL);
  });

  it("force-reinstalls a failing engine on download, and a missing one without force", async () => {
    const h = makeHarness();
    h.engine.broken = true;
    await h.service.downloadModel(MODEL_ID);
    expect(h.engineStore.install).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    expect((await h.service.status()).availability).toEqual({ status: "available" });
    expect(h.engine.broken).toBe(false);

    const fresh = makeHarness();
    fresh.engine.missing = true;
    await fresh.service.downloadModel(MODEL_ID);
    expect(fresh.engineStore.install.mock.calls[0]![0].force).toBeFalsy();
  });

  it("reports engine-failed-to-start when the fresh engine fails its handshake", async () => {
    const h = makeHarness();
    h.engine.broken = true;
    h.engineStore.install.mockRejectedValueOnce(
      new DownloadError("engine-failed-to-start", "did not pass its version check"),
    );
    expect(await h.service.downloadModel(MODEL_ID)).toEqual({
      status: "failed",
      code: "engine-failed-to-start",
    });
    expect(h.modelStore.download).not.toHaveBeenCalled();
    // The failure stays visible to the offer, as a failed ModelStore download does.
    expect((await h.service.status()).models.find((m) => m.id === MODEL_ID)!.status).toEqual({
      state: "failed",
      reason: "did not pass its version check",
    });
  });

  it("installs the engine, then the model, in one monotonic progress stream", async () => {
    const h = makeHarness({ now: steppingClock() });
    h.engine.missing = true;
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    h.modelStore.download.mockImplementationOnce(async (_id, onProgress) => {
      onProgress({ id: MODEL_ID, receivedBytes: 100, totalBytes: MODEL, fileName: "encoder" });
      onProgress({ id: MODEL_ID, receivedBytes: MODEL, totalBytes: MODEL, fileName: "tokens" });
      return `/models/${MODEL_ID}`;
    });

    expect(await h.service.downloadModel(MODEL_ID)).toEqual({ status: "ready" });

    expect(h.engineStore.install).toHaveBeenCalledTimes(1);
    const received = h.modelEvents.map((e) => e.receivedBytes);
    expect(received).toEqual([...received].sort((a, b) => a - b));
    expect(new Set(h.modelEvents.map((e) => e.id))).toEqual(new Set([MODEL_ID]));
    expect(new Set(h.modelEvents.map((e) => e.totalBytes))).toEqual(new Set([ENGINE + MODEL]));
    expect(received).toContain(ENGINE);
    expect(received.at(-1)).toBe(ENGINE + MODEL);
    expect(h.modelEvents[0]!.fileName).toBe(ENGINE_ARCHIVE.archiveName);
    expect(h.modelEvents.at(-1)!.fileName).toBe("tokens");
    // The install happened before the model's first byte.
    expect(h.engineStore.install.mock.invocationCallOrder[0]!).toBeLessThan(
      h.modelStore.download.mock.invocationCallOrder[0]!,
    );
  });

  it("reports the model as downloading with the combined numbers during the engine phase", async () => {
    const h = makeHarness({ now: steppingClock() });
    h.engine.missing = true;
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    const install = pausedInstall(h);

    const pending = h.service.downloadModel(MODEL_ID);
    await install.started;
    const status = await h.service.status();
    const info = (id: string) => status.models.find((m) => m.id === id)!;
    expect(info(MODEL_ID).status).toEqual({
      state: "downloading",
      receivedBytes: 1000,
      totalBytes: ENGINE + MODEL,
    });
    expect(info(OTHER_ID).status).toEqual({ state: "missing" });

    install.release();
    await pending;
  });

  it("adds the engine's bytes to the model's own while the model downloads", async () => {
    const h = makeHarness();
    h.engine.missing = true;
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    const reached = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    h.modelStore.download.mockImplementationOnce(async () => {
      h.modelStatus.set(MODEL_ID, { state: "downloading", receivedBytes: 50, totalBytes: MODEL });
      reached.resolve();
      await finish.promise;
      return `/models/${MODEL_ID}`;
    });

    const pending = h.service.downloadModel(MODEL_ID);
    await reached.promise;
    const info = (await h.service.status()).models.find((m) => m.id === MODEL_ID)!;
    expect(info.status).toEqual({
      state: "downloading",
      receivedBytes: ENGINE + 50,
      totalBytes: ENGINE + MODEL,
    });
    finish.resolve();
    await pending;
  });

  it("finds the engine after the install, without asking for a restart", async () => {
    const h = makeHarness();
    h.engine.missing = true;
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    expect((await h.service.status()).availability).toEqual({ status: "available" });
    await h.service.downloadModel(MODEL_ID);
    h.modelStatus.set(MODEL_ID, { state: "ready", dir: `/models/${MODEL_ID}` });
    const status = await h.service.status();
    expect(status.models.find((m) => m.id === MODEL_ID)!.status).toEqual({ state: "ready" });
    const begin = await h.service.begin({ ...REQUEST, id: "missing-item" });
    expect(begin).not.toEqual({ status: "refused", reason: "unavailable" });
  });

  it("cancels during the engine phase and the model never starts", async () => {
    const h = makeHarness();
    h.engine.missing = true;
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    const install = pausedInstall(h);

    const pending = h.service.downloadModel(MODEL_ID);
    await install.started;
    h.service.cancelModel(MODEL_ID);

    expect(await pending).toEqual({ status: "cancelled" });
    expect(h.modelStore.download).not.toHaveBeenCalled();
    expect((await h.service.status()).models.find((m) => m.id === MODEL_ID)!.status).toEqual({
      state: "missing",
    });
  });

  it("cancels during the model phase through the same call", async () => {
    const h = makeHarness();
    h.engine.missing = true;
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    h.modelStore.download.mockImplementationOnce(
      (_id, _onProgress, signal?: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new ModelStoreError("cancelled", "The download was cancelled.")),
          );
          queueMicrotask(() => h.service.cancelModel(MODEL_ID));
        }),
    );
    expect(await h.service.downloadModel(MODEL_ID)).toEqual({ status: "cancelled" });
    expect(h.modelStore.cancel).toHaveBeenCalledWith(MODEL_ID);
  });

  it("does not let a probe that was in flight across the install report the engine as missing", async () => {
    const h = makeHarness();
    h.engine.missing = true;
    const install = pausedInstall(h);
    const pending = h.service.downloadModel(MODEL_ID);
    await install.started;
    // A status call during the install probes the disk and sees no engine, slowly.
    const stale = Promise.withResolvers<EngineLocation>();
    vi.mocked(h.deps.locateEngine).mockImplementationOnce(() => stale.promise);
    const duringInstall = h.service.status();
    await Promise.resolve();

    install.release();
    await pending;
    // Asked while the old probe is still running: it must start its own, not join the old one.
    const afterInstall = h.service.status();
    stale.resolve({ available: false, reason: "binary-missing" });
    // The call that joined the old probe gets the post-install state, not the old answer.
    const early = await duringInstall;
    expect(early.availability).toEqual({ status: "available" });
    expect(early.models.find((m) => m.id === MODEL_ID)!.status).toEqual({ state: "ready" });

    const status = await afterInstall;
    expect(status.models.find((m) => m.id === MODEL_ID)!.status).toEqual({ state: "ready" });
    expect(await h.service.begin({ ...REQUEST, id: "none" })).not.toEqual({
      status: "refused",
      reason: "unavailable",
    });
  });

  it("reports the model as downloading, not missing, to a poll that resumes during the engine check", async () => {
    const h = makeHarness({ now: steppingClock() });
    h.engine.missing = true;
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    const install = pausedInstall(h);
    // A poll is already waiting on the engine probe when the download starts and joins it.
    const probe = Promise.withResolvers<EngineLocation>();
    vi.mocked(h.deps.locateEngine).mockImplementationOnce(() => probe.promise);
    const poll = h.service.status();
    const pending = h.service.downloadModel(MODEL_ID);
    probe.resolve({ available: false, reason: "binary-missing" });

    // The poll resumes before the download leaves its "checking" phase.
    const status = await poll;
    expect(status.models.find((m) => m.id === MODEL_ID)!.status).toEqual({
      state: "downloading",
      receivedBytes: 0,
      totalBytes: MODEL + ENGINE,
    });

    await install.started;
    install.release();
    expect(await pending).toEqual({ status: "ready" });
  });

  it("reports the model's own progress while only the model downloads", async () => {
    const h = makeHarness();
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    const reached = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    h.modelStore.download.mockImplementationOnce(async () => {
      h.modelStatus.set(MODEL_ID, { state: "downloading", receivedBytes: 50, totalBytes: MODEL });
      reached.resolve();
      await finish.promise;
      return `/models/${MODEL_ID}`;
    });

    const pending = h.service.downloadModel(MODEL_ID);
    await reached.promise;
    const info = (await h.service.status()).models.find((m) => m.id === MODEL_ID)!;
    // The engine is installed, so nothing leaves the "checking" phase except the model's own state.
    expect(info.status).toEqual({ state: "downloading", receivedBytes: 50, totalBytes: MODEL });
    finish.resolve();
    await pending;
  });

  it("installs only the engine when the model is already installed", async () => {
    const h = makeHarness({ now: steppingClock() });
    h.engine.missing = true;

    expect(await h.service.downloadModel(MODEL_ID)).toEqual({ status: "ready" });

    expect(h.engineStore.install).toHaveBeenCalledTimes(1);
    expect(h.modelStore.download).not.toHaveBeenCalled();
    expect(new Set(h.modelEvents.map((e) => e.totalBytes))).toEqual(new Set([ENGINE]));
    expect(h.modelEvents.at(-1)!.receivedBytes).toBe(ENGINE);
  });

  it("does not touch the engine store when the engine is installed", async () => {
    const h = makeHarness();
    await h.service.downloadModel(MODEL_ID);
    expect(h.engineStore.install).not.toHaveBeenCalled();
  });

  it.each([
    ["network", "network"],
    ["hash-mismatch", "hash-mismatch"],
    ["size-mismatch", "size-mismatch"],
    ["insufficient-disk-space", "insufficient-disk-space"],
    ["engine-failed-to-start", "engine-failed-to-start"],
  ] as const)(
    "maps an engine %s failure to %s, and the model is not downloaded",
    async (code, expected) => {
      const h = makeHarness();
      h.engine.missing = true;
      h.modelStatus.set(MODEL_ID, { state: "missing" });
      h.engineStore.install.mockRejectedValueOnce(new DownloadError(code, "x"));
      expect(await h.service.downloadModel(MODEL_ID)).toEqual({ status: "failed", code: expected });
      expect(h.modelStore.download).not.toHaveBeenCalled();
      // The offer shows the failure until the next try, which starts clean.
      const model = (await h.service.status()).models.find((m) => m.id === MODEL_ID)!;
      expect(model.status).toEqual({ state: "failed", reason: "x" });
      expect((await h.service.status()).models.find((m) => m.id === OTHER_ID)!.status).toEqual({
        state: "missing",
      });
      const retry = Promise.withResolvers<void>();
      h.engineStore.install.mockImplementationOnce(async () => {
        retry.resolve();
        await new Promise(() => {});
        return "/engine";
      });
      void h.service.downloadModel(MODEL_ID);
      await retry.promise;
      expect((await h.service.status()).models.find((m) => m.id === MODEL_ID)!.status.state).toBe(
        "downloading",
      );
    },
  );

  it("does not keep an engine failure after the next download succeeds", async () => {
    const h = makeHarness();
    h.engine.missing = true;
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    h.engineStore.install.mockRejectedValueOnce(new DownloadError("network", "offline"));
    await h.service.downloadModel(MODEL_ID);
    expect(await h.service.downloadModel(MODEL_ID)).toEqual({ status: "ready" });
    h.engine.missing = true;
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    expect((await h.service.status()).models.find((m) => m.id === MODEL_ID)!.status).toEqual({
      state: "missing",
    });
  });

  it("does not hide an engine error nobody classified", async () => {
    const h = makeHarness();
    h.engine.missing = true;
    h.engineStore.install.mockRejectedValueOnce(new Error("boom"));
    await expect(h.service.downloadModel(MODEL_ID)).rejects.toThrow("boom");
    // The run is over: a new download is not refused as busy.
    expect(await h.service.downloadModel(MODEL_ID)).toEqual({ status: "ready" });
  });

  it("shares the run for the same model and refuses another model with busy", async () => {
    const h = makeHarness();
    h.engine.missing = true;
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    const install = pausedInstall(h);

    const first = h.service.downloadModel(MODEL_ID);
    await install.started;
    expect(h.service.downloadModel(MODEL_ID)).toBe(first);
    expect(await h.service.downloadModel(OTHER_ID)).toEqual({ status: "failed", code: "busy" });

    install.release();
    expect(await first).toEqual({ status: "ready" });
    expect(h.engineStore.install).toHaveBeenCalledTimes(1);
  });

  it("removes a model without touching the engine", async () => {
    const h = makeHarness();
    await h.service.removeModel(MODEL_ID);
    expect(h.modelStore.remove).toHaveBeenCalledTimes(1);
    expect(h.engineStore.install).not.toHaveBeenCalled();
  });

  it("stops a running engine download before removing its model", async () => {
    const h = makeHarness();
    h.engine.missing = true;
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    const install = pausedInstall(h);
    const pending = h.service.downloadModel(MODEL_ID);
    await install.started;
    await h.service.removeModel(MODEL_ID);
    expect(await pending).toEqual({ status: "cancelled" });
    expect(h.modelStore.remove).toHaveBeenCalledTimes(1);
  });

  it("refuses a download of a model whose removal is still running", async () => {
    const h = makeHarness();
    let finishRemoval!: () => void;
    h.modelStore.remove.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishRemoval = resolve)),
    );
    const removal = h.service.removeModel(MODEL_ID);
    expect(await h.service.downloadModel(MODEL_ID)).toEqual({ status: "failed", code: "busy" });
    finishRemoval();
    await removal;
    expect(await h.service.downloadModel(MODEL_ID)).toEqual({ status: "ready" });
  });

  it("refuses a job while the engine is not installed", async () => {
    const h = makeHarness();
    h.engine.missing = true;
    expect(await h.service.begin(REQUEST)).toEqual({ status: "refused", reason: "unavailable" });
  });
});

describe("begin", () => {
  it("refuses with unavailable when the engine is not available", async () => {
    const h = makeHarness({
      locateEngine: async () => ({ available: false, reason: "binary-missing" }),
    });
    expect(await h.service.begin(REQUEST)).toEqual({ status: "refused", reason: "unavailable" });
  });

  it("refuses with model-missing for a model that is not ready or not in the catalog", async () => {
    const h = makeHarness();
    h.modelStatus.set(MODEL_ID, { state: "missing" });
    expect(await h.service.begin(REQUEST)).toEqual({ status: "refused", reason: "model-missing" });
    expect(await h.service.begin({ ...REQUEST, modelId: "nope" })).toEqual({
      status: "refused",
      reason: "model-missing",
    });
  });

  it("refuses with invalid-item when the item does not resolve under id and assetId", async () => {
    const h = makeHarness();
    expect(await h.service.begin({ ...REQUEST, assetId: "other" })).toEqual({
      status: "refused",
      reason: "invalid-item",
    });
    expect(await h.service.begin({ ...REQUEST, id: "other" })).toEqual({
      status: "refused",
      reason: "invalid-item",
    });
    h.state.gone = true;
    expect(await h.service.begin(REQUEST)).toEqual({ status: "refused", reason: "invalid-item" });
  });

  it("refuses invalid-item when the vault lookup throws", async () => {
    const h = makeHarness();
    h.vault.resolve = async () => {
      throw new Error("sidecar unreadable");
    };
    expect(await h.service.begin(REQUEST)).toEqual({ status: "refused", reason: "invalid-item" });
  });

  it("accepts, opens the audio file under .kaipu/tmp and announces receiving-audio", async () => {
    const h = makeHarness();
    const result = await h.service.begin(REQUEST);
    expect(result).toEqual({ status: "accepted", jobId: "job-1" });
    expect(h.events).toEqual([
      { jobId: "job-1", id: "rec", phase: "receiving-audio", segmentsDone: 0, segmentsTotal: 0 },
    ]);
    await h.service.chunk("job-1", new Uint8Array(64).buffer);
    expect(await readdir(h.vault.tmpDir)).toEqual(["job-1.pcm"]);
  });

  it("refuses a model with model-missing while its removal is pending", async () => {
    const h = makeHarness();
    await mkdir(join(root, ".kaipu"), { recursive: true });
    await writeFile(h.state.mediaPath, "media");
    const deletion = Promise.withResolvers<void>();
    // The store keeps reporting the model as installed until the delete finishes.
    h.modelStore.remove.mockImplementationOnce(() => deletion.promise);

    const removing = h.service.removeModel(MODEL_ID);
    expect(await h.service.begin(REQUEST)).toEqual({ status: "refused", reason: "model-missing" });

    deletion.resolve();
    await removing;
    // The reservation is gone once the removal returned.
    expect((await h.service.begin(REQUEST)).status).toBe("accepted");
  });

  it("keeps refusing the model until the last of two overlapping removals returns", async () => {
    const h = makeHarness();
    await mkdir(join(root, ".kaipu"), { recursive: true });
    await writeFile(h.state.mediaPath, "media");
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    h.modelStore.remove
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const removingFirst = h.service.removeModel(MODEL_ID);
    const removingSecond = h.service.removeModel(MODEL_ID);
    first.resolve();
    await removingFirst;
    // One delete is still in flight, so the model stays reserved.
    expect(await h.service.begin(REQUEST)).toEqual({ status: "refused", reason: "model-missing" });

    second.resolve();
    await removingSecond;
    expect((await h.service.begin(REQUEST)).status).toBe("accepted");
  });

  it("refuses a second job with busy, also while the first is still being opened", async () => {
    const h = makeHarness();
    const first = h.service.begin(REQUEST);
    const second = h.service.begin(REQUEST);
    expect(await second).toEqual({ status: "refused", reason: "busy" });
    expect((await first).status).toBe("accepted");
    expect(await h.service.begin(REQUEST)).toEqual({ status: "refused", reason: "busy" });
  });

  it("accepts a new job after the previous one ended", async () => {
    const h = makeHarness();
    const first = await startJob(h);
    await h.service.cancel(first);
    expect(await h.service.begin(REQUEST)).toEqual({ status: "accepted", jobId: "job-2" });
  });
});

describe("a job that completes", () => {
  it("writes a transcript with words in source time, and reports each phase", async () => {
    const h = makeHarness();
    const outcome = await runToEnd(h);
    expect(outcome).toMatchObject({ phase: "done", segmentsDone: 3, segmentsTotal: 3 });
    expect(outcome.failure).toBeUndefined();

    expect(h.events.map((e) => [e.phase, e.segmentsDone, e.segmentsTotal])).toEqual([
      ["receiving-audio", 0, 0],
      ["transcribing", 0, 3],
      ["transcribing", 3, 3],
      ["writing", 3, 3],
      ["done", 3, 3],
    ]);

    const parsed = parseTranscript(JSON.parse(await readFile(h.state.transcriptPath, "utf8")));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const t = parsed.transcript;
    expect(t.media).toEqual({ contentHash: "hash-1", durationMs: 70_000 });
    expect(t.engine).toEqual({ name: "sherpa-onnx-offline", version: "1.13.8" });
    const model = getModel(MODEL_ID)!;
    expect(t.model.id).toBe(MODEL_ID);
    expect(t.model.revision).toBe(model.revision);
    expect(t.model.files).toEqual(Object.fromEntries(model.files.map((f) => [f.name, f.sha256])));
    expect(t.createdAt).toBe("2026-11-15T10:00:00.000Z");
    expect(t.segments.map((s) => [s.id, s.startMs, s.endMs, s.status])).toEqual([
      ["s0", 0, 30_000, "ok"],
      ["s1", 27_000, 57_000, "ok"],
      ["s2", 54_000, 70_000, "ok"],
    ]);
    expect(t.words.map((w) => [w.id, w.segmentId, w.text, w.startMs, w.endMs])).toEqual([
      ["w1", "s0", "hello", 500, 800],
      ["w2", "s0", "world", 1000, 1300],
      ["w3", "s1", "hello", 27_500, 27_800],
      ["w4", "s1", "world", 28_000, 28_300],
      ["w5", "s2", "hello", 54_500, 54_800],
      ["w6", "s2", "world", 55_000, 55_300],
    ]);
  });

  it("sends the engine the pinned paths, the model dir and a deadline sized to the audio", async () => {
    const h = makeHarness();
    await runToEnd(h);
    expect(h.optionsSeen).toHaveLength(1);
    const options = h.optionsSeen[0]!;
    expect(options).toMatchObject({
      cliPath: "/engine/bin/sherpa-onnx-offline",
      libDir: "/engine/lib",
      modelDir: `/models/${MODEL_ID}`,
    });
    // 30 s + 30 s + 16 s of segment audio
    expect(options.deadlineMs).toBe(BATCH_DEADLINE_BASE_MS + BATCH_DEADLINE_AUDIO_FACTOR * 76_000);
    expect(options.signal.aborted).toBe(false);
    expect(h.wavsExisted).toEqual([true]);
  });

  it("runs the segments in batches and removes each batch's WAV files and every temp file", async () => {
    const h = makeHarness();
    const outcome = await runToEnd(h, 250_000); // 10 segments
    expect(outcome.phase).toBe("done");
    expect(h.calls.map((c) => c.length)).toEqual([SEGMENTS_PER_BATCH, SEGMENTS_PER_BATCH, 2]);
    expect(h.calls.flat()).toEqual(Array.from({ length: 10 }, (_, i) => `s${i}`));
    expect(h.wavsExisted.every(Boolean)).toBe(true);
    expect(await tmpEntries(h)).toEqual([]);
    expect(existsSync(join(h.vault.tmpDir, "rec.partial.json"))).toBe(false);
    const progress = h.events.filter((e) => e.phase === "transcribing").map((e) => e.segmentsDone);
    expect(progress).toEqual([0, 4, 8, 10]);
  });

  it("does not count a segment with no words as a failure", async () => {
    const h = makeHarness();
    h.supervisor.batch = async (options) =>
      options.wavPaths.map((p) =>
        basename(p) === "s1.wav" ? { text: "", tokens: [], timestamps: [] } : cannedResult(),
      );
    expect((await runToEnd(h)).phase).toBe("done");
    const parsed = parseTranscript(JSON.parse(await readFile(h.state.transcriptPath, "utf8")));
    if (!parsed.ok) throw new Error("transcript rejected");
    expect(parsed.transcript.segments.map((s) => s.status)).toEqual(["ok", "empty", "ok"]);
  });
});

describe("audio that is not there", () => {
  it.each(["no-audio", "decode-failed"] as const)(
    "a renderer reporting %s fails the job with no-audio and cleans up",
    async (reason) => {
      const h = makeHarness();
      const jobId = await startJob(h, 1000);
      await h.service.end(jobId, reason);
      expect(await h.settled()).toMatchObject({ phase: "failed", failure: "no-audio" });
      expect(h.runBatch).not.toHaveBeenCalled();
      expect(await tmpEntries(h)).toEqual([]);
    },
  );

  it("treats audio shorter than 500 ms as no audio", async () => {
    const h = makeHarness();
    const jobId = await startJob(h, 400);
    await h.service.end(jobId);
    expect(await h.settled()).toMatchObject({ phase: "failed", failure: "no-audio" });
    expect(h.runBatch).not.toHaveBeenCalled();
    expect(await tmpEntries(h)).toEqual([]);
  });

  it("ignores a second end for a job that is already running", async () => {
    const h = makeHarness();
    const jobId = await startJob(h);
    await h.service.end(jobId);
    await h.service.end(jobId);
    expect(await h.settled()).toMatchObject({ phase: "done" });
  });

  it("treats a job that ends with no chunk at all as no audio", async () => {
    const h = makeHarness();
    const result = await h.service.begin(REQUEST);
    if (result.status !== "accepted") throw new Error("refused");
    await h.service.end(result.jobId);
    expect(await h.settled()).toMatchObject({ phase: "failed", failure: "no-audio" });
  });

  it("fails a job whose renderer goes quiet for 60 s, and frees the slot", async () => {
    const h = makeHarness();
    const jobId = await startJob(h, 1000);
    const idle = h.timers.filter((t) => !t.cancelled);
    expect(idle).toHaveLength(1);
    expect(idle[0]!.ms).toBe(IDLE_TIMEOUT_MS);
    idle[0]!.fn();
    expect(await h.settled()).toMatchObject({ phase: "failed", failure: "no-audio" });
    expect(await tmpEntries(h)).toEqual([]);
    await expect(h.service.chunk(jobId, new Uint8Array(2))).rejects.toThrow(/unknown job/);
    expect((await h.service.begin(REQUEST)).status).toBe("accepted");
  });

  it("restarts the idle timer on every chunk and stops it once the audio ended", async () => {
    const h = makeHarness();
    const jobId = await startJob(h, 1000);
    await h.service.chunk(jobId, new Uint8Array(2));
    expect(h.timers.filter((t) => !t.cancelled)).toHaveLength(1);
    await h.service.end(jobId);
    await h.settled();
    expect(h.timers.every((t) => t.cancelled)).toBe(true);
  });
});

describe("chunks", () => {
  it("rejects a chunk over 8 MB without touching the job", async () => {
    const h = makeHarness();
    const jobId = await startJob(h, 1000);
    await expect(h.service.chunk(jobId, new Uint8Array(MAX_CHUNK_BYTES + 1))).rejects.toThrow(
      RangeError,
    );
    await h.service.chunk(jobId, new Uint8Array(MAX_CHUNK_BYTES));
    expect((await h.service.status()).job?.phase).toBe("receiving-audio");
  });

  it("fails the job with no-audio and frees the slot when the audio passes the 12 h cap", async () => {
    // The writer is stubbed: the point is the byte count, not 1.3 GB on disk.
    const append = vi.spyOn(PcmWriter.prototype, "append").mockResolvedValue(undefined);
    try {
      const h = makeHarness();
      const jobId = await startJob(h, 1000);
      const chunk = new Uint8Array(MAX_CHUNK_BYTES);
      // 12 h of 16 kHz 16-bit mono is 1,382,400,000 bytes: 164 whole chunks fit, the 165th does not.
      for (let i = 0; i < 164; i++) await h.service.chunk(jobId, chunk);
      await expect(h.service.chunk(jobId, chunk)).rejects.toThrow(RangeError);
      expect(await h.settled()).toMatchObject({ phase: "failed", failure: "no-audio" });
      await expect(h.service.chunk(jobId, new Uint8Array(2))).rejects.toThrow(/unknown job/);
      expect((await h.service.begin(REQUEST)).status).toBe("accepted");
    } finally {
      append.mockRestore();
    }
  });

  it("fails the job with write-failed and frees the slot when the writer cannot append", async () => {
    const h = makeHarness();
    const jobId = await startJob(h, 1000);
    const append = vi.spyOn(PcmWriter.prototype, "append").mockImplementation(async () => {
      throw new Error("disk full");
    });
    try {
      await expect(h.service.chunk(jobId, new Uint8Array(2))).rejects.toThrow("disk full");
    } finally {
      append.mockRestore();
    }
    expect(await h.settled()).toMatchObject({ phase: "failed", failure: "write-failed" });
    expect(await tmpEntries(h)).toEqual([]);
    await expect(h.service.chunk(jobId, new Uint8Array(2))).rejects.toThrow(/unknown job/);
    expect((await h.service.begin(REQUEST)).status).toBe("accepted");
  });

  it("throws for an unknown job, for chunk and for end", async () => {
    const h = makeHarness();
    await expect(h.service.chunk("nope", new Uint8Array(2))).rejects.toThrow(/unknown job/);
    await expect(h.service.end("nope")).rejects.toThrow(/unknown job/);
  });

  it("refuses audio after the audio ended", async () => {
    const h = makeHarness();
    const jobId = await startJob(h);
    h.supervisor.batch = blockUntilAborted;
    await h.service.end(jobId);
    await expect(h.service.chunk(jobId, new Uint8Array(2))).rejects.toThrow(/already ended/);
    await h.service.cancel(jobId);
  });
});

describe("cancel", () => {
  it("while receiving audio ends the job as cancelled and removes the audio file", async () => {
    const h = makeHarness();
    const jobId = await startJob(h, 5000);
    await h.service.cancel(jobId);
    expect(h.events.at(-1)).toMatchObject({ phase: "cancelled" });
    expect(await tmpEntries(h)).toEqual([]);
    expect(h.runBatch).not.toHaveBeenCalled();
  });

  it("in the middle of a batch aborts the engine, ends as cancelled and removes tmp", async () => {
    const h = makeHarness();
    let started!: () => void;
    const batchStarted = new Promise<void>((resolve) => (started = resolve));
    h.supervisor.batch = (options) => {
      started();
      return blockUntilAborted(options);
    };
    const jobId = await startJob(h);
    await h.service.end(jobId);
    await batchStarted;
    await h.service.cancel(jobId);
    expect(h.events.at(-1)).toMatchObject({ phase: "cancelled" });
    expect(h.events.at(-1)!.failure).toBeUndefined();
    expect(h.optionsSeen[0]!.signal.aborted).toBe(true);
    expect(await tmpEntries(h)).toEqual([]);
    expect(existsSync(join(h.vault.tmpDir, "rec.partial.json"))).toBe(false);
    expect(existsSync(h.state.transcriptPath)).toBe(false);
    expect((await h.service.begin(REQUEST)).status).toBe("accepted");
  });

  it("is a no-op for an unknown or finished job", async () => {
    const h = makeHarness();
    await h.service.cancel("nope");
    await runToEnd(h);
    await h.service.cancel("job-1");
    expect(h.events.filter((e) => e.phase === "cancelled")).toHaveLength(0);
  });

  it("shutdown signals the running engine batch", async () => {
    const h = makeHarness();
    h.supervisor.batch = blockUntilAborted;
    const jobId = await startJob(h);
    await h.service.end(jobId);
    await vi.waitFor(() => expect(h.runBatch).toHaveBeenCalled());
    h.service.shutdown();
    expect(await h.settled()).toMatchObject({ phase: "cancelled" });
  });
});

describe("engine failure and resume", () => {
  it.each(["exit", "deadline", "bad-output", "spawn-failed"] as const)(
    "a %s error from the supervisor fails the job with engine-failed",
    async (code) => {
      const h = makeHarness();
      h.supervisor.batch = async () => {
        throw new SherpaError(code, "engine error");
      };
      expect(await runToEnd(h)).toMatchObject({ phase: "failed", failure: "engine-failed" });
      expect(existsSync(h.state.transcriptPath)).toBe(false);
      expect(await tmpEntries(h)).toEqual([]);
    },
  );

  it("keeps the finished batches' words, and a later job skips those segments", async () => {
    const h = makeHarness();
    h.supervisor.batch = async (options, call) => {
      if (call === 2) throw new SherpaError("exit", "killed");
      return options.wavPaths.map(cannedResult);
    };
    expect(await runToEnd(h, 250_000)).toMatchObject({ phase: "failed", failure: "engine-failed" });
    expect(h.calls).toEqual([
      ["s0", "s1", "s2", "s3"],
      ["s4", "s5", "s6", "s7"],
    ]);
    const partial = JSON.parse(await readFile(join(h.vault.tmpDir, "rec.partial.json"), "utf8"));
    expect(Object.keys(partial.words)).toEqual(["s0", "s1", "s2", "s3"]);
    expect(partial.key).toMatchObject({
      mediaHash: "hash-1",
      modelId: MODEL_ID,
      engineVersion: "1.13.8",
      durationMs: 250_000,
    });

    // The next run: the same audio again, the same item.
    h.events.length = 0;
    h.supervisor.batch = null;
    const outcome = await runToEnd(h, 250_000);
    expect(outcome).toMatchObject({ phase: "done", segmentsDone: 10, segmentsTotal: 10 });
    expect(h.events.find((e) => e.phase === "transcribing")).toMatchObject({
      segmentsDone: 4,
      segmentsTotal: 10,
    });
    expect(h.calls.slice(2)).toEqual([
      ["s4", "s5", "s6", "s7"],
      ["s8", "s9"],
    ]);
    expect(h.calls.flat().filter((id) => id === "s0")).toHaveLength(1);

    const parsed = parseTranscript(JSON.parse(await readFile(h.state.transcriptPath, "utf8")));
    if (!parsed.ok) throw new Error("transcript rejected");
    const words = parsed.transcript.words;
    expect(words).toHaveLength(20);
    expect(new Set(words.map((w) => w.id)).size).toBe(20);
    expect(new Set(words.map((w) => `${w.segmentId}:${w.startMs}`)).size).toBe(20);
    expect(existsSync(join(h.vault.tmpDir, "rec.partial.json"))).toBe(false);
  });

  it.each(["mediaHash", "modelId", "engineVersion", "durationMs", "planFingerprint"] as const)(
    "ignores a partial whose %s key does not match, with everything else equal",
    async (field) => {
      const h = makeHarness();
      h.supervisor.batch = async (options, call) => {
        if (call === 2) throw new SherpaError("exit", "killed");
        return options.wavPaths.map(cannedResult);
      };
      await runToEnd(h, 250_000);
      // Change one key field in the saved partial; the next run is the same audio and item.
      const path = join(h.vault.tmpDir, "rec.partial.json");
      const partial = JSON.parse(await readFile(path, "utf8"));
      partial.key[field] = typeof partial.key[field] === "number" ? 1 : "other";
      await writeFile(path, JSON.stringify(partial));

      h.events.length = 0;
      h.calls.length = 0;
      h.supervisor.batch = null;
      expect((await runToEnd(h, 250_000)).phase).toBe("done");
      // A mismatching partial is not used: the run starts from segment 0 again.
      expect(h.calls[0]).toEqual(["s0", "s1", "s2", "s3"]);
    },
  );

  it("deletes a corrupt partial and transcribes everything", async () => {
    const h = makeHarness();
    await mkdir(h.vault.tmpDir, { recursive: true });
    await writeFile(join(h.vault.tmpDir, "rec.partial.json"), "{not json");
    expect((await runToEnd(h)).phase).toBe("done");
    expect(h.calls.flat()).toEqual(["s0", "s1", "s2"]);
    expect(existsSync(join(h.vault.tmpDir, "rec.partial.json"))).toBe(false);
  });

  it("deletes a partial that has the right key but a wrong shape", async () => {
    const h = makeHarness();
    h.supervisor.batch = async (options, call) => {
      if (call === 2) throw new SherpaError("exit", "killed");
      return options.wavPaths.map(cannedResult);
    };
    await runToEnd(h, 250_000);
    const path = join(h.vault.tmpDir, "rec.partial.json");
    const partial = JSON.parse(await readFile(path, "utf8"));
    partial.words = { s0: [{ text: 5 }] };
    await writeFile(path, JSON.stringify(partial));
    h.events.length = 0;
    h.calls.length = 0;
    h.supervisor.batch = null;
    expect((await runToEnd(h, 250_000)).phase).toBe("done");
    expect(h.calls.flat()).toEqual(Array.from({ length: 10 }, (_, i) => `s${i}`));
  });
});

describe("commit", () => {
  it("fails with item-changed and writes nothing when the item was renamed during the job", async () => {
    const h = makeHarness();
    h.supervisor.batch = async (options) => {
      h.state.id = "renamed";
      return options.wavPaths.map(cannedResult);
    };
    expect(await runToEnd(h)).toMatchObject({ phase: "failed", failure: "item-changed" });
    expect(existsSync(h.state.transcriptPath)).toBe(false);
    expect(await tmpEntries(h)).toEqual([]);
    expect(existsSync(join(h.vault.tmpDir, "rec.partial.json"))).toBe(false);
  });

  it("fails with item-changed when the item was removed during the job", async () => {
    const h = makeHarness();
    h.supervisor.batch = async (options) => {
      h.state.gone = true;
      return options.wavPaths.map(cannedResult);
    };
    expect(await runToEnd(h)).toMatchObject({ phase: "failed", failure: "item-changed" });
    expect(existsSync(h.state.transcriptPath)).toBe(false);
  });

  it("fails with item-changed when the item's media moved to another path", async () => {
    const h = makeHarness();
    h.supervisor.batch = async (options) => {
      h.state.mediaPath = join(root, "elsewhere.mp4");
      return options.wavPaths.map(cannedResult);
    };
    expect(await runToEnd(h)).toMatchObject({ phase: "failed", failure: "item-changed" });
  });

  it("hashes the resolved item, so the caller can serve the hash from its cache", async () => {
    const h = makeHarness();
    await startJob(h);
    expect(h.deps.hashMedia).toHaveBeenCalledWith(
      expect.objectContaining({ id: REQUEST.id, mediaPath: h.state.mediaPath }),
    );
  });

  it("refuses to begin when the media vanished before it could be hashed", async () => {
    const h = makeHarness();
    vi.mocked(h.deps.hashMedia).mockRejectedValue(
      Object.assign(new Error("gone"), { code: "ENOENT" }),
    );
    expect(await h.service.begin(REQUEST)).toEqual({ status: "refused", reason: "invalid-item" });
    expect(h.runBatch).not.toHaveBeenCalled();
  });

  it("refuses to begin on media a sync provider offloaded: its audio cannot be read without downloading it", async () => {
    const h = makeHarness();
    vi.mocked(h.deps.hashMedia).mockRejectedValue(
      Object.assign(new Error("Not downloaded"), { code: "EVICTED" }),
    );
    expect(await h.service.begin(REQUEST)).toEqual({ status: "refused", reason: "invalid-item" });
    expect(h.runBatch).not.toHaveBeenCalled();
  });

  it("stores the hash taken at begin, so a file replaced during the job reads as stale", async () => {
    const h = makeHarness();
    const jobId = await startJob(h);
    // The recording is replaced after the audio was decoded from the old one.
    vi.mocked(h.deps.hashMedia).mockResolvedValue("hash-replaced");
    await h.service.end(jobId);
    expect(await h.settled()).toMatchObject({ phase: "done" });
    const parsed = parseTranscript(JSON.parse(await readFile(h.state.transcriptPath, "utf8")));
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.transcript.media.contentHash).toBe("hash-1");
  });

  it("waits for a rename holding the item lock, then sees the new name and writes nothing", async () => {
    const h = makeHarness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let rename!: Promise<void>;
    h.supervisor.batch = async (options) => {
      // A rename takes the item lock and is still moving the file when the job reaches its commit.
      rename = h.vault.withItemLock("rec", async () => {
        await gate;
        h.state.id = "renamed";
      });
      return options.wavPaths.map(cannedResult);
    };
    const jobId = await startJob(h);
    await h.service.end(jobId);
    await vi.waitFor(() => expect(h.events.some((e) => e.phase === "writing")).toBe(true));
    // Queued behind the rename: nothing is written, the job has not finished.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(h.state.transcriptPath)).toBe(false);
    expect(h.events.at(-1)!.phase).toBe("writing");
    release();
    await rename;
    expect(await h.settled()).toMatchObject({ phase: "failed", failure: "item-changed" });
    expect(existsSync(h.state.transcriptPath)).toBe(false);
  });

  it("writes the transcript when a rename finished before the lock and the item is unchanged", async () => {
    const h = makeHarness();
    let rename!: Promise<void>;
    h.supervisor.batch = async (options) => {
      rename = h.vault.withItemLock("rec", async () => {}); // a no-op "rename": nothing moved
      return options.wavPaths.map(cannedResult);
    };
    expect((await runToEnd(h)).phase).toBe("done");
    await rename;
    expect(existsSync(h.state.transcriptPath)).toBe(true);
  });

  it("fails with write-failed when the file cannot be written, keeping the partial to resume", async () => {
    const h = makeHarness();
    h.state.transcriptPath = join(root, "no-such-folder", "rec.transcript.json");
    expect(await runToEnd(h)).toMatchObject({ phase: "failed", failure: "write-failed" });
    expect(existsSync(join(h.vault.tmpDir, "rec.partial.json"))).toBe(true);
    expect(await tmpEntries(h)).toEqual([]);

    // The folder is fixed; the next run only writes.
    await mkdir(join(root, "no-such-folder"));
    h.events.length = 0;
    h.calls.length = 0;
    expect((await runToEnd(h)).phase).toBe("done");
    expect(h.calls).toEqual([]);
    expect(existsSync(h.state.transcriptPath)).toBe(true);
  });
});

describe("stale tmp cleanup", () => {
  const ago = async (path: string, ms: number) => {
    const when = new Date(Date.now() - ms);
    await utimes(path, when, when);
  };

  it("runs at the first begin: old audio and WAV files go, partial files stay for a week", async () => {
    const h = makeHarness({ now: () => new Date() }); // the files' ages are real
    const tmp = h.vault.tmpDir;
    const deadJob = "3f2b8c1e-9d4a-4e6b-8a57-1c0d2e3f4a5b";
    await mkdir(join(tmp, deadJob), { recursive: true });
    await writeFile(join(tmp, deadJob, "s0.wav"), "x");
    // Other features' folders in the same directory are never this job's to delete.
    for (const other of ["placed-parts", "move-7"]) {
      await mkdir(join(tmp, other), { recursive: true });
      await writeFile(join(tmp, other, "keep.bin"), "x");
      await ago(join(tmp, other), 2 * 3600_000);
    }
    const files = {
      "old.pcm": 2 * 3600_000,
      "old.wav": 2 * 3600_000,
      "fresh.pcm": 60_000,
      "old.partial.json": 8 * 24 * 3600_000,
      "recent.partial.json": 2 * 24 * 3600_000,
      "keep.txt": 9 * 24 * 3600_000,
    };
    for (const [name, age] of Object.entries(files)) {
      await writeFile(join(tmp, name), "x");
      await ago(join(tmp, name), age);
    }
    await ago(join(tmp, deadJob), 2 * 3600_000);
    expect((await readdir(tmp)).length).toBe(9);

    await h.service.begin(REQUEST);
    expect((await readdir(tmp)).sort()).toEqual([
      "fresh.pcm",
      "keep.txt",
      "move-7",
      "placed-parts",
      "recent.partial.json",
    ]);
  });

  it("does not run at construction", async () => {
    const h = makeHarness();
    await mkdir(h.vault.tmpDir, { recursive: true });
    await writeFile(join(h.vault.tmpDir, "old.pcm"), "x");
    await ago(join(h.vault.tmpDir, "old.pcm"), 2 * 3600_000);
    await h.service.status();
    expect(existsSync(join(h.vault.tmpDir, "old.pcm"))).toBe(true);
  });
});
