import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC_CHANNELS } from "@shared/types/ipc";
import { VAULT_MAINTENANCE_MARKER } from "@shared/types/library-storage";

const state = vi.hoisted(() => ({
  dir: "",
  handle: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => state.dir },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      state.handle.set(channel, fn),
    on: () => {},
  },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  shell: { openPath: vi.fn(async () => ""), showItemInFolder: vi.fn() },
}));
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
import { openTranscriptionVault, registerTranscriptionIpc } from "./transcription-ipc";
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
    resourcesPath: state.dir,
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

  describe("readTranscript", () => {
    it("answers none when the item has no transcript", async () => {
      await addMedia("no-transcript");
      expect(await readTranscript("no-transcript")).toEqual({ status: "none" });
    });

    it("answers ready, not stale, and maps segment-failed to the shared reason", async () => {
      const item = await addMedia("fresh");
      const hash = await sha256FileBase64(item.filePath);
      await writeFile(
        vault.companionPaths("fresh").transcript,
        JSON.stringify(transcriptFor(hash)),
      );
      const result = await readTranscript("fresh");
      expect(result.status).toBe("ready");
      expect(result.stale).toBe(false);
      expect(result.transcript!.words).toHaveLength(1);
      expect(result.transcript!.unresolved).toEqual([
        { startMs: 500, endMs: 1000, reason: "failed" },
      ]);
    });

    it("marks the transcript stale, words still readable, when the recording changed", async () => {
      const item = await addMedia("changed");
      const hash = await sha256FileBase64(item.filePath);
      await writeFile(
        vault.companionPaths("changed").transcript,
        JSON.stringify(transcriptFor(hash)),
      );
      await writeFile(item.filePath, "different bytes now");
      const result = await readTranscript("changed");
      expect(result.status).toBe("ready");
      expect(result.stale).toBe(true);
      expect(result.transcript!.words).toHaveLength(1);
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
      await writeFile(
        vault.companionPaths("orphan").transcript,
        JSON.stringify(transcriptFor("hash")),
      );
      expect(await readTranscript("orphan")).toEqual({ status: "none" });
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
