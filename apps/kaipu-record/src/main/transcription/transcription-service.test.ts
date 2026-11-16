import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type {
  TranscriptionJobProgress,
  TranscriptionModelProgress,
} from "@shared/types/transcription";
import type { EngineLocation } from "./engine/engine-locator";
import { SherpaError, type CliResult, type RunBatchOptions } from "./engine/sherpa-supervisor";
import { DEFAULT_MODEL_ID, getModel } from "./models/catalog";
import { ModelStoreError, type ModelStatus } from "./models/model-store";
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
  const runBatch = vi.fn(async (options: RunBatchOptions): Promise<CliResult[]> => {
    calls.push(options.wavPaths.map((p) => basename(p, ".wav")));
    optionsSeen.push(options);
    wavsExisted.push(options.wavPaths.every((p) => existsSync(p)));
    if (supervisor.batch) return supervisor.batch(options, calls.length);
    return options.wavPaths.map(cannedResult);
  });
  const deps: TranscriptionServiceDeps = {
    locateEngine: vi.fn(async () => AVAILABLE),
    modelStore,
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
    expect(reasons).toEqual(["engine-missing", "engine-broken", "unsupported-platform"]);
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

  it("ignores a partial made for another file content or other audio", async () => {
    const h = makeHarness();
    h.supervisor.batch = async (options, call) => {
      if (call === 2) throw new SherpaError("exit", "killed");
      return options.wavPaths.map(cannedResult);
    };
    await runToEnd(h, 250_000);

    for (const change of ["media", "duration"] as const) {
      h.events.length = 0;
      h.calls.length = 0;
      h.supervisor.batch = async (options, call) => {
        if (call === 2) throw new SherpaError("exit", "killed");
        return options.wavPaths.map(cannedResult);
      };
      // The partial the previous run left no longer matches what this run is made for.
      if (change === "media") {
        vi.mocked(h.deps.hashMedia).mockResolvedValue("hash-2");
      }
      await runToEnd(h, change === "duration" ? 260_000 : 250_000);
      // A mismatching partial is not used: the run starts from segment 0 again.
      expect(h.calls[0]).toEqual(["s0", "s1", "s2", "s3"]);
    }
  });

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

  it("fails with item-changed when the media vanished before it could be hashed", async () => {
    const h = makeHarness();
    vi.mocked(h.deps.hashMedia).mockRejectedValue(
      Object.assign(new Error("gone"), { code: "ENOENT" }),
    );
    expect(await runToEnd(h)).toMatchObject({ phase: "failed", failure: "item-changed" });
    expect(h.runBatch).not.toHaveBeenCalled();
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
