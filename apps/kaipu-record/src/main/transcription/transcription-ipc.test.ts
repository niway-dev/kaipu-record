import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC_CHANNELS } from "@shared/types/ipc";
import { VAULT_MAINTENANCE_MARKER } from "@shared/types/library-storage";

const state = vi.hoisted(() => ({
  dir: "",
  handle: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  sent: [] as string[],
}));

vi.mock("electron", () => ({
  app: { getPath: () => state.dir },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      state.handle.set(channel, fn),
    on: () => {},
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string) => state.sent.push(channel) },
      },
    ],
    fromWebContents: () => null,
  },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  shell: { openPath: vi.fn(async () => ""), showItemInFolder: vi.fn() },
}));
// The real hash, counted: the cache tests assert on how often the media was read.
vi.mock("../library/content-hash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../library/content-hash")>();
  return { sha256FileBase64: vi.fn(actual.sha256FileBase64) };
});
vi.mock("../infrastructure/settings-store", () => ({ getAppSettings: () => ({ locale: "en" }) }));
// The gate here checks the stamp the way the real one does: a call without the active
// workspace's stamp as its first argument is refused.
vi.mock("../workspaces", () => ({
  activeWorkspace: () => ({ id: "ws-test", path: join(state.dir, "vault") }),
  ownsLegacyCloud: () => true,
  workspaceGate: () => ({
    run: (stamp: { workspaceId?: string } | null, fn: () => unknown) =>
      stamp?.workspaceId === "ws-test"
        ? Promise.resolve().then(fn)
        : Promise.reject(new Error("stale-workspace")),
  }),
}));

import { sha256FileBase64 } from "../library/content-hash";
import { LibraryVault } from "../library/library-vault";
import { vaultActivity } from "../library/vault-activity";
import type { Transcript } from "./transcript-file";
import {
  broadcastJobProgress,
  hashMediaThroughCache,
  openTranscriptionVault,
  registerTranscriptionIpc,
} from "./transcription-ipc";
import { MAX_CHUNK_BYTES, type TranscriptionService } from "./transcription-service";

const STAMP = { workspaceId: "ws-test", generation: 1 };
const event = {};

const service = {
  status: vi.fn(async () => ({ job: null })),
  downloadModel: vi.fn(async () => ({ status: "ready" })),
  cancelModel: vi.fn(),
  removeModel: vi.fn(async () => {}),
  begin: vi.fn(async () => ({ status: "accepted", jobId: "job-1" })),
  chunk: vi.fn(async () => {}),
  end: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  shutdown: vi.fn(),
};

const call = (channel: string, ...args: unknown[]) =>
  Promise.resolve().then(() => state.handle.get(channel)!(event, ...args));

const REQUEST = {
  id: "clip",
  assetId: "asset-1",
  modelId: "parakeet-tdt-0.6b-v3-int8",
  durationMs: 5000,
};

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), "kaipu-transcription-ipc-"));
  registerTranscriptionIpc({
    engineRoot: join(state.dir, "speech-engine"),
    modelsRoot: join(state.dir, "models"),
    service: service as unknown as TranscriptionService,
  });
});
afterAll(async () => {
  await rm(state.dir, { recursive: true, force: true });
});
beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockClear();
});

describe("broadcastJobProgress", () => {
  const progress = (phase: "transcribing" | "done" | "failed") =>
    ({ jobId: "j", id: "r", phase, segmentsDone: 1, segmentsTotal: 1 }) as never;

  beforeEach(() => {
    state.sent.length = 0;
  });

  it("re-lists the library when a job finishes, because its transcript file now exists", () => {
    broadcastJobProgress(progress("done"));
    expect(state.sent).toEqual([
      IPC_CHANNELS.transcriptionJobProgress,
      IPC_CHANNELS.libraryChanged,
    ]);
  });

  it("does not re-list for a phase that wrote no transcript", () => {
    broadcastJobProgress(progress("transcribing"));
    broadcastJobProgress(progress("failed"));
    expect(state.sent).not.toContain(IPC_CHANNELS.libraryChanged);
  });
});

describe("registration", () => {
  it("registers every transcription request channel", () => {
    for (const channel of [
      IPC_CHANNELS.transcriptionStatus,
      IPC_CHANNELS.transcriptionModelDownload,
      IPC_CHANNELS.transcriptionModelCancel,
      IPC_CHANNELS.transcriptionModelRemove,
      IPC_CHANNELS.transcriptionJobBegin,
      IPC_CHANNELS.transcriptionJobChunk,
      IPC_CHANNELS.transcriptionJobEnd,
      IPC_CHANNELS.transcriptionJobCancel,
      IPC_CHANNELS.transcriptionReadTranscript,
      IPC_CHANNELS.transcriptionCheckFreshness,
    ]) {
      expect(state.handle.has(channel), channel).toBe(true);
    }
  });
});

describe("scoped channels", () => {
  it.each([IPC_CHANNELS.transcriptionJobBegin, IPC_CHANNELS.transcriptionReadTranscript])(
    "%s refuses a call without the workspace stamp and never reaches the service",
    async (channel) => {
      await expect(call(channel, REQUEST)).rejects.toThrow("stale-workspace");
      await expect(
        call(channel, { workspaceId: "ws-other", generation: 1 }, REQUEST),
      ).rejects.toThrow("stale-workspace");
      expect(service.begin).not.toHaveBeenCalled();
    },
  );

  it("begin passes a valid request after the stamp", async () => {
    expect(await call(IPC_CHANNELS.transcriptionJobBegin, STAMP, REQUEST)).toEqual({
      status: "accepted",
      jobId: "job-1",
    });
    expect(service.begin).toHaveBeenCalledWith(REQUEST);
  });

  it("begin and readTranscript are refused while Check and fix files runs", async () => {
    const exit = await vaultActivity.enterMaintenance();
    try {
      for (const [channel, args] of [
        [IPC_CHANNELS.transcriptionJobBegin, [STAMP, REQUEST]],
        [IPC_CHANNELS.transcriptionReadTranscript, [STAMP, "clip"]],
      ] as const) {
        await expect(call(channel, ...args)).rejects.toThrow(VAULT_MAINTENANCE_MARKER);
      }
    } finally {
      exit();
    }
    expect(service.begin).not.toHaveBeenCalled();
  });

  it.each([
    ["not an object", "clip"],
    ["null", null],
    ["a missing id", { ...REQUEST, id: undefined }],
    ["an id with a path", { ...REQUEST, id: "../clip" }],
    ["an id that is a number", { ...REQUEST, id: 7 }],
    ["an empty assetId", { ...REQUEST, assetId: "" }],
    ["a model id that is not a string", { ...REQUEST, modelId: {} }],
    ["a duration that is a string", { ...REQUEST, durationMs: "5000" }],
    ["a zero duration", { ...REQUEST, durationMs: 0 }],
    ["a NaN duration", { ...REQUEST, durationMs: Number.NaN }],
    ["a duration beyond any recording", { ...REQUEST, durationMs: 1e12 }],
    ["an automatic flag that is a string", { ...REQUEST, automatic: "yes" }],
  ])("begin rejects %s", async (_name, request) => {
    await expect(call(IPC_CHANNELS.transcriptionJobBegin, STAMP, request)).rejects.toThrow(
      /transcription/,
    );
    expect(service.begin).not.toHaveBeenCalled();
  });

  it("readTranscript rejects an id that is not a string or has a path", async () => {
    for (const id of [undefined, 5, "", "../clip", "a/b"]) {
      await expect(call(IPC_CHANNELS.transcriptionReadTranscript, STAMP, id)).rejects.toThrow(
        /transcription/,
      );
    }
  });
});

describe("plain channels", () => {
  it("passes model ids and job ids through, and rejects anything else", async () => {
    await call(IPC_CHANNELS.transcriptionModelDownload, "m");
    await call(IPC_CHANNELS.transcriptionModelCancel, "m");
    await call(IPC_CHANNELS.transcriptionModelRemove, "m");
    await call(IPC_CHANNELS.transcriptionJobCancel, "job-1");
    expect(service.downloadModel).toHaveBeenCalledWith("m");
    expect(service.cancelModel).toHaveBeenCalledWith("m");
    expect(service.removeModel).toHaveBeenCalledWith("m");
    expect(service.cancel).toHaveBeenCalledWith("job-1");
    for (const channel of [
      IPC_CHANNELS.transcriptionModelDownload,
      IPC_CHANNELS.transcriptionModelCancel,
      IPC_CHANNELS.transcriptionModelRemove,
      IPC_CHANNELS.transcriptionJobCancel,
    ]) {
      for (const bad of [undefined, 3, {}, ""]) {
        await expect(call(channel, bad)).rejects.toThrow(/transcription/);
      }
    }
  });

  it("answers status", async () => {
    expect(await call(IPC_CHANNELS.transcriptionStatus)).toEqual({ job: null });
  });

  it("chunk accepts an ArrayBuffer or a typed array and hands main a Uint8Array", async () => {
    await call(IPC_CHANNELS.transcriptionJobChunk, "job-1", new Uint8Array([1, 2, 3, 4]).buffer);
    await call(IPC_CHANNELS.transcriptionJobChunk, "job-1", new Int16Array([5, 6]));
    await call(IPC_CHANNELS.transcriptionJobChunk, "job-1", Buffer.from([7, 8]));
    const sent = (service.chunk.mock.calls as unknown as [string, Uint8Array][]).map(
      ([, bytes]) => [...bytes],
    );
    expect(sent).toEqual([
      [1, 2, 3, 4],
      [5, 0, 6, 0],
      [7, 8],
    ]);
  });

  it("chunk rejects text, plain arrays, a bad job id and an oversized chunk", async () => {
    await expect(call(IPC_CHANNELS.transcriptionJobChunk, "job-1", "audio")).rejects.toThrow(
      /binary/,
    );
    await expect(call(IPC_CHANNELS.transcriptionJobChunk, "job-1", [1, 2])).rejects.toThrow(
      /binary/,
    );
    await expect(call(IPC_CHANNELS.transcriptionJobChunk, 5, new ArrayBuffer(4))).rejects.toThrow(
      /job id/,
    );
    await expect(
      call(IPC_CHANNELS.transcriptionJobChunk, "job-1", new ArrayBuffer(MAX_CHUNK_BYTES + 1)),
    ).rejects.toThrow(/too large/);
    expect(service.chunk).not.toHaveBeenCalled();
  });

  it("end completes the audio, or fails it with one of the two reasons", async () => {
    await call(IPC_CHANNELS.transcriptionJobEnd, "job-1");
    await call(IPC_CHANNELS.transcriptionJobEnd, "job-1", "no-audio");
    await call(IPC_CHANNELS.transcriptionJobEnd, "job-1", "decode-failed");
    expect(service.end.mock.calls).toEqual([
      ["job-1", undefined],
      ["job-1", "no-audio"],
      ["job-1", "decode-failed"],
    ]);
    service.end.mockClear();
    for (const reason of ["engine-failed", "", 1, null]) {
      await expect(call(IPC_CHANNELS.transcriptionJobEnd, "job-1", reason)).rejects.toThrow(
        /fail reason/,
      );
    }
    await expect(call(IPC_CHANNELS.transcriptionJobEnd, 9)).rejects.toThrow(/job id/);
    expect(service.end).not.toHaveBeenCalled();
  });
});

describe("with a real vault", () => {
  let vault: LibraryVault;
  let vaultDir: string;
  const readTranscript = (id: string) =>
    call(IPC_CHANNELS.transcriptionReadTranscript, STAMP, id) as Promise<{
      status: string;
      stale?: boolean;
      freshness?: string;
      transcript?: Transcript;
    }>;

  async function addMedia(id: string, content = "video bytes", ext = ".mp4") {
    await writeFile(join(vaultDir, `${id}${ext}`), content);
    const item = await vault.describe(id);
    return item!;
  }

  function transcriptFor(contentHash: string): Transcript {
    return {
      schemaVersion: 1,
      model: { id: "m", revision: "r", files: {} },
      engine: { name: "sherpa-onnx-offline", version: "1.13.8" },
      media: { contentHash, durationMs: 1000 },
      createdAt: "2026-11-15T10:00:00.000Z",
      segments: [
        { id: "s0", startMs: 0, endMs: 500, status: "ok" },
        { id: "s1", startMs: 500, endMs: 1000, status: "failed" },
      ],
      unresolved: [{ startMs: 500, endMs: 1000, reason: "segment-failed" }],
      words: [{ id: "w1", segmentId: "s0", text: "hi", startMs: 0, endMs: 200, logProb: -0.1 }],
    };
  }

  beforeAll(async () => {
    vaultDir = join(state.dir, "vault");
    await mkdir(join(vaultDir, ".kaipu"), { recursive: true });
    vault = new LibraryVault(vaultDir, "ws-test");
  });

  const checkFreshness = (id: string) =>
    call(IPC_CHANNELS.transcriptionCheckFreshness, STAMP, id) as Promise<{
      verdict: string;
      autoRetranscribe: boolean;
    }>;
  const hashSpy = vi.mocked(sha256FileBase64);
  const timing = vi.spyOn(console, "info").mockImplementation(() => {});
  const timingLines = () =>
    timing.mock.calls
      .map((args) => String(args[0]))
      .filter((l) => l.startsWith("[transcript-timing]"));

  async function seedTranscript(id: string, hash: string): Promise<void> {
    await writeFile(vault.companionPaths(id).transcript, JSON.stringify(transcriptFor(hash)));
  }

  describe("readTranscript", () => {
    beforeEach(() => {
      hashSpy.mockClear();
      timing.mockClear();
    });

    it("answers none when the item has no transcript", async () => {
      await addMedia("no-transcript");
      expect(await readTranscript("no-transcript")).toEqual({ status: "none" });
    });

    it("answers the words at once on a cold cache, without reading the media", async () => {
      const item = await addMedia("cold");
      await seedTranscript("cold", await sha256FileBase64(item.filePath));
      hashSpy.mockClear();

      const result = await readTranscript("cold");
      expect(result.status).toBe("ready");
      expect(result).toMatchObject({ stale: false, freshness: "checking" });
      expect(result.transcript!.words).toHaveLength(1);
      expect(result.transcript!.unresolved).toEqual([
        { startMs: 500, endMs: 1000, reason: "segment-failed" },
      ]);
      expect(hashSpy).not.toHaveBeenCalled();
    });

    it("reads nothing from the media when the cached stamp matches", async () => {
      const item = await addMedia("warm");
      const hash = await sha256FileBase64(item.filePath);
      await seedTranscript("warm", hash);
      await vault.ensureContentHash("warm");
      hashSpy.mockClear();

      expect(await readTranscript("warm")).toMatchObject({ freshness: "fresh", stale: false });
      expect(hashSpy).not.toHaveBeenCalled();
    });

    it("says stale from the cache alone when the cached hash differs from the transcript's", async () => {
      await addMedia("warm-stale");
      await seedTranscript("warm-stale", "an-older-hash");
      await vault.ensureContentHash("warm-stale");
      hashSpy.mockClear();

      expect(await readTranscript("warm-stale")).toMatchObject({
        freshness: "stale",
        stale: true,
      });
      expect(hashSpy).not.toHaveBeenCalled();
    });

    it("logs one timing line per read with the cache outcome", async () => {
      await addMedia("logged");
      await seedTranscript("logged", "h");
      await readTranscript("logged");
      await vault.ensureContentHash("logged");
      await readTranscript("logged");
      expect(timingLines()).toEqual([
        expect.stringMatching(/^\[transcript-timing\] read logged \d+ms cache=miss$/),
        expect.stringMatching(/^\[transcript-timing\] read logged \d+ms cache=hit$/),
      ]);
    });

    it("answers invalid, and keeps the file, for a file that does not validate", async () => {
      await addMedia("damaged");
      const path = vault.companionPaths("damaged").transcript;
      await writeFile(path, "{ not json");
      expect(await readTranscript("damaged")).toEqual({ status: "invalid" });
      await writeFile(path, JSON.stringify({ schemaVersion: 99 }));
      expect(await readTranscript("damaged")).toEqual({ status: "invalid" });
      expect(await readFile(path, "utf8")).toContain("99");
    });

    it("answers none for a transcript whose recording is gone", async () => {
      await seedTranscript("orphan", "hash");
      expect(await readTranscript("orphan")).toEqual({ status: "none" });
    });
  });

  describe("checkTranscriptFreshness", () => {
    beforeEach(() => {
      hashSpy.mockClear();
      timing.mockClear();
    });

    it("answers fresh for an unchanged recording, and the next read is warm", async () => {
      const item = await addMedia("c-fresh");
      await seedTranscript("c-fresh", await sha256FileBase64(item.filePath));
      hashSpy.mockClear();

      expect(await checkFreshness("c-fresh")).toEqual({
        verdict: "fresh",
        autoRetranscribe: false,
      });
      expect(hashSpy).toHaveBeenCalledTimes(1);
      expect(await readTranscript("c-fresh")).toMatchObject({ freshness: "fresh" });
      expect(hashSpy).toHaveBeenCalledTimes(1);
    });

    it("answers stale, and allows one automatic attempt, when the recording changed", async () => {
      const item = await addMedia("c-stale");
      await seedTranscript("c-stale", await sha256FileBase64(item.filePath));
      await writeFile(item.filePath, "different bytes now");

      expect(await checkFreshness("c-stale")).toEqual({
        verdict: "stale",
        autoRetranscribe: true,
      });
    });

    it("does not allow a second automatic attempt for the same content", async () => {
      const item = await addMedia("c-once");
      await seedTranscript("c-once", "an-older-hash");
      expect((await checkFreshness("c-once")).autoRetranscribe).toBe(true);
      // The attempt begins: main records it against the media's content hash.
      await call(IPC_CHANNELS.transcriptionJobBegin, STAMP, {
        ...REQUEST,
        id: "c-once",
        automatic: true,
      });
      expect(await checkFreshness("c-once")).toEqual({ verdict: "stale", autoRetranscribe: false });
      // New content is a new attempt.
      await writeFile(item.filePath, "yet another recording");
      expect(await checkFreshness("c-once")).toEqual({ verdict: "stale", autoRetranscribe: true });
    });

    it("a manual begin does not use up the automatic attempt", async () => {
      await addMedia("c-manual");
      await seedTranscript("c-manual", "an-older-hash");
      await call(IPC_CHANNELS.transcriptionJobBegin, STAMP, { ...REQUEST, id: "c-manual" });
      expect((await checkFreshness("c-manual")).autoRetranscribe).toBe(true);
    });

    it("answers unknown when the file keeps changing while it is hashed", async () => {
      await addMedia("c-busy");
      await seedTranscript("c-busy", "h");
      hashSpy.mockImplementation(async (path: string) => {
        await appendFile(path, "x");
        return "never-stable";
      });
      try {
        expect(await checkFreshness("c-busy")).toEqual({
          verdict: "unknown",
          autoRetranscribe: false,
        });
      } finally {
        const actual =
          await vi.importActual<typeof import("../library/content-hash")>(
            "../library/content-hash",
          );
        hashSpy.mockImplementation(actual.sha256FileBase64);
      }
    });

    it("shares one hash between concurrent checks of the same item", async () => {
      const item = await addMedia("c-shared");
      await seedTranscript("c-shared", await sha256FileBase64(item.filePath));
      hashSpy.mockClear();

      const answers = await Promise.all([checkFreshness("c-shared"), checkFreshness("c-shared")]);
      expect(answers[0]).toEqual(answers[1]);
      expect(hashSpy).toHaveBeenCalledTimes(1);
    });

    it("logs one timing line per check with the verdict", async () => {
      await addMedia("c-logged");
      await seedTranscript("c-logged", "an-older-hash");
      await checkFreshness("c-logged");
      expect(timingLines()).toEqual([
        expect.stringMatching(/^\[transcript-timing\] check c-logged \d+ms result=stale$/),
      ]);
    });

    it("answers unknown without a transcript or without a recording", async () => {
      await addMedia("c-none");
      expect(await checkFreshness("c-none")).toEqual({
        verdict: "unknown",
        autoRetranscribe: false,
      });
      await seedTranscript("c-orphan", "h");
      expect(await checkFreshness("c-orphan")).toEqual({
        verdict: "unknown",
        autoRetranscribe: false,
      });
    });
  });

  describe("hashMediaThroughCache", () => {
    beforeEach(() => {
      hashSpy.mockClear();
    });
    const job = (item: { id: string; filePath: string }) => ({
      id: item.id,
      mediaPath: item.filePath,
    });

    it("hashes the real content, leaves a stamp, and a second job reads nothing", async () => {
      const item = await addMedia("job-hash", "first recording");
      const first = await hashMediaThroughCache(job(item));
      expect(first).toBe(
        await vi
          .importActual<typeof import("../library/content-hash")>("../library/content-hash")
          .then((m) => m.sha256FileBase64(item.filePath)),
      );
      expect((await vault.cachedContentHash("job-hash")).status).toBe("hit");
      hashSpy.mockClear();
      expect(await hashMediaThroughCache(job(item))).toBe(first);
      expect(hashSpy).not.toHaveBeenCalled();
    });

    it("hashes again when the stamp no longer matches", async () => {
      const item = await addMedia("job-changed", "first recording");
      const first = await hashMediaThroughCache(job(item));
      await writeFile(item.filePath, "second recording");
      hashSpy.mockClear();
      expect(await hashMediaThroughCache(job(item))).not.toBe(first);
      expect(hashSpy).toHaveBeenCalledTimes(1);
    });

    it("fails with ENOENT for a file that is gone, as the job expects", async () => {
      const item = await addMedia("job-gone");
      await rm(item.filePath);
      await expect(hashMediaThroughCache(job(item))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  describe("the vault the job sees", () => {
    it("resolves an item only under its own identity, and only a recording", async () => {
      const item = await addMedia("takes");
      const jobVault = openTranscriptionVault();
      expect(jobVault.tmpDir).toBe(join(vaultDir, ".kaipu", "tmp"));
      expect(await jobVault.resolve({ id: "takes", assetId: item.assetId })).toEqual({
        id: "takes",
        assetId: item.assetId,
        mediaPath: item.filePath,
        transcriptPath: vault.companionPaths("takes").transcript,
      });
      expect(await jobVault.resolve({ id: "takes", assetId: "someone-else" })).toBeNull();
      expect(await jobVault.resolve({ id: "missing", assetId: item.assetId })).toBeNull();
      expect(await jobVault.resolve({ id: "../takes", assetId: item.assetId })).toBeNull();

      const shot = await addMedia("shot", "png bytes", ".png");
      expect(await jobVault.resolve({ id: "shot", assetId: shot.assetId })).toBeNull();
    });

    it("runs a function under the item lock", async () => {
      const order: string[] = [];
      const jobVault = openTranscriptionVault();
      const first = jobVault.withItemLock("takes", async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("first");
      });
      const second = jobVault.withItemLock("takes", async () => {
        order.push("second");
      });
      await Promise.all([first, second]);
      expect(order).toEqual(["first", "second"]);
    });
  });
});

describe("a dev override", () => {
  const REAL_STATUS = {
    availability: { status: "available" },
    defaultModelId: "m",
    models: [
      {
        id: "m",
        label: "M",
        languages: ["en"],
        sizeBytes: 100,
        location: "/models/m",
        license: { name: "L", attribution: "A", url: "https://example.test" },
        status: { state: "missing" },
      },
    ],
    job: null,
  };

  beforeAll(() => {
    service.status.mockImplementation((async () => REAL_STATUS) as never);
    registerTranscriptionIpc({
      engineRoot: join(state.dir, "speech-engine"),
      modelsRoot: join(state.dir, "models"),
      service: service as unknown as TranscriptionService,
      override: { kind: "ready" },
    });
  });
  afterAll(() => {
    // Registering again replaces the override handlers (the mock's `handle` overwrites by
    // channel) with the plain ones, so a test added after this block sees no override.
    registerTranscriptionIpc({
      engineRoot: join(state.dir, "speech-engine"),
      modelsRoot: join(state.dir, "models"),
      service: service as unknown as TranscriptionService,
    });
    service.status.mockImplementation((async () => ({ job: null })) as never);
  });

  it("answers the status from the override, built on the real one", async () => {
    const status = (await call(IPC_CHANNELS.transcriptionStatus)) as typeof REAL_STATUS;
    expect(service.status).toHaveBeenCalled();
    expect(status.models[0]!.status).toEqual({ state: "ready" });
    expect(status.models[0]!.location).toBe("/models/m");
  });

  it("never starts a real download", async () => {
    expect(await call(IPC_CHANNELS.transcriptionModelDownload, "m")).toEqual({
      status: "cancelled",
    });
    expect(service.downloadModel).not.toHaveBeenCalled();
  });

  it("removes nothing", async () => {
    await call(IPC_CHANNELS.transcriptionModelRemove, "m");
    expect(service.removeModel).not.toHaveBeenCalled();
  });

  it("refuses a job as unavailable", async () => {
    expect(await call(IPC_CHANNELS.transcriptionJobBegin, STAMP, REQUEST)).toEqual({
      status: "refused",
      reason: "unavailable",
    });
    expect(service.begin).not.toHaveBeenCalled();
  });
});

describe("a dev override with a pinned job", () => {
  beforeAll(() => {
    registerTranscriptionIpc({
      engineRoot: join(state.dir, "speech-engine"),
      modelsRoot: join(state.dir, "models"),
      service: service as unknown as TranscriptionService,
      override: { kind: "ready", job: { kind: "running", segmentsDone: 3, segmentsTotal: 12 } },
    });
  });
  afterAll(() => {
    registerTranscriptionIpc({
      engineRoot: join(state.dir, "speech-engine"),
      modelsRoot: join(state.dir, "models"),
      service: service as unknown as TranscriptionService,
    });
  });
  beforeEach(() => {
    state.sent.length = 0;
  });

  it("accepts a job without the service, announces progress on the first audio, and cancels", async () => {
    const begin = (await call(IPC_CHANNELS.transcriptionJobBegin, STAMP, REQUEST)) as {
      status: string;
      jobId: string;
    };
    expect(begin.status).toBe("accepted");
    expect(service.begin).not.toHaveBeenCalled();
    expect(state.sent).toEqual([]);

    await call(IPC_CHANNELS.transcriptionJobChunk, begin.jobId, new Uint8Array(4));
    expect(state.sent).toEqual([IPC_CHANNELS.transcriptionJobProgress]);
    await call(IPC_CHANNELS.transcriptionJobEnd, begin.jobId);
    expect(state.sent).toHaveLength(1);
    expect(service.chunk).not.toHaveBeenCalled();
    expect(service.end).not.toHaveBeenCalled();

    await call(IPC_CHANNELS.transcriptionJobCancel, begin.jobId);
    expect(state.sent).toHaveLength(2);
    expect(service.cancel).not.toHaveBeenCalled();
  });
});
