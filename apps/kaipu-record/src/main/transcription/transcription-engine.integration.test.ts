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

  async function runJob(
    pcm: Buffer,
    durationMs: number,
  ): Promise<{ transcriptPath: string; events: TranscriptionJobProgress[] }> {
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
      engineStore: { install: async () => engineDir! },
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
      durationMs,
    });
    if (begin.status !== "accepted") throw new Error(`refused: ${begin.reason}`);
    for (let at = 0; at < pcm.length; at += 1_000_000) {
      const slice = pcm.subarray(at, at + 1_000_000);
      await service.chunk(
        begin.jobId,
        slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length) as ArrayBuffer,
      );
    }
    await service.end(begin.jobId);
    const terminal = ["done", "failed", "cancelled"];
    await expect
      .poll(() => terminal.includes(events.at(-1)?.phase ?? ""), {
        timeout: 120_000,
        interval: 250,
      })
      .toBe(true);
    const last = events.at(-1);
    if (last?.phase !== "done") {
      throw new Error(`the job ended as ${last?.phase} (${last?.failure ?? "no failure code"})`);
    }

    return { transcriptPath, events };
  }

  it("transcribes silence into a valid, empty transcript", async () => {
    const { transcriptPath } = await runJob(Buffer.alloc(5 * 32_000), 5000);
    const parsed = parseTranscript(JSON.parse(await readFile(transcriptPath, "utf8")));
    expect(parsed.ok).toBe(true);
  }, 150_000);

  // A 16 kHz mono 16-bit WAV with speech longer than one 30 s window, so the job cuts overlapping
  // segments and reconciles them. Optional: KAIPU_SPEECH_SAMPLE_WAV.
  it.skipIf(!process.env.KAIPU_SPEECH_SAMPLE_WAV)(
    "transcribes spoken audio into ordered words in source time",
    async () => {
      const wav = await readFile(process.env.KAIPU_SPEECH_SAMPLE_WAV!);
      const pcm = wav.subarray(44);
      const durationMs = Math.round((pcm.length / 32_000) * 1000);
      const { transcriptPath } = await runJob(pcm, durationMs);
      const parsed = parseTranscript(JSON.parse(await readFile(transcriptPath, "utf8")));
      if (!parsed.ok) throw new Error(parsed.message);
      const { words, segments } = parsed.transcript;
      expect(segments.length).toBeGreaterThan(1);
      expect(words.length).toBeGreaterThan(20);
      for (let i = 1; i < words.length; i++) {
        expect(words[i]!.startMs).toBeGreaterThanOrEqual(words[i - 1]!.startMs);
      }
      expect(words.at(-1)!.endMs).toBeLessThanOrEqual(durationMs + 100);
    },
    300_000,
  );
});
