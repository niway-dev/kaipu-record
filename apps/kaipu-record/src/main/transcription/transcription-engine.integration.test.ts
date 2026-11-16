import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TranscriptionJobProgress } from "@shared/types/transcription";
import { runBatch } from "./engine/sherpa-supervisor";
import { DEFAULT_MODEL_ID } from "./models/catalog";
import { parseTranscript } from "./transcript-file";
import { TranscriptionService } from "./transcription-service";

/**
 * Runs the real engine over five seconds of silence: the job must finish and write a valid
 * transcript (with no words). Skipped unless both folders are set:
 * KAIPU_SPEECH_ENGINE_DIR (the engine root with bin/ and lib/) and KAIPU_SPEECH_MODEL_DIR
 * (a Parakeet model folder).
 */
const engineDir = process.env.KAIPU_SPEECH_ENGINE_DIR;
const modelDir = process.env.KAIPU_SPEECH_MODEL_DIR;

describe.skipIf(!engineDir || !modelDir)("transcription with the real engine", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "kaipu-transcription-engine-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("transcribes silence into a valid, empty transcript", async () => {
    const transcriptPath = join(root, ".kaipu", "rec.transcript.json");
    await mkdir(join(root, ".kaipu"), { recursive: true });
    await writeFile(join(root, "rec.mp4"), "media");
    const events: TranscriptionJobProgress[] = [];
    const service = new TranscriptionService({
      locateEngine: async () => ({
        available: true,
        cliPath: join(engineDir!, "bin", "sherpa-onnx-offline"),
        libDir: join(engineDir!, "lib"),
        version: "test",
      }),
      modelStore: {
        status: () => ({ state: "ready", dir: modelDir! }),
        locate: () => modelDir!,
        destination: () => modelDir!,
        download: async () => modelDir!,
        cancel: () => {},
        remove: async () => {},
      },
      openVault: () => ({
        tmpDir: join(root, ".kaipu", "tmp"),
        resolve: async (target) =>
          target.id === "rec"
            ? {
                id: "rec",
                assetId: "a",
                mediaPath: join(root, "rec.mp4"),
                transcriptPath,
              }
            : null,
        withItemLock: (_id, fn) => fn(),
      }),
      runBatch,
      hashMedia: async () => "hash",
      now: () => new Date(),
      broadcastJob: (progress) => events.push(progress),
      broadcastModel: () => {},
    });

    const begin = await service.begin({
      id: "rec",
      assetId: "a",
      modelId: DEFAULT_MODEL_ID,
      durationMs: 5000,
    });
    if (begin.status !== "accepted") throw new Error(`refused: ${begin.reason}`);
    await service.chunk(begin.jobId, new Uint8Array(5 * 32_000).buffer);
    await service.end(begin.jobId);
    await expect.poll(() => events.at(-1)?.phase, { timeout: 120_000, interval: 250 }).toBe("done");

    const parsed = parseTranscript(JSON.parse(await readFile(transcriptPath, "utf8")));
    expect(parsed.ok).toBe(true);
  }, 150_000);
});
