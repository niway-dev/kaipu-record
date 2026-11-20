import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TranscriptionBeginResult,
  TranscriptionJobProgress,
} from "@shared/types/transcription";
import { NoAudioError, UndecodableAudioError, decodeAudioToPcm } from "./decode-audio";
import { runTranscriptionJob, TRANSCRIPTION_PROGRESS_TIMEOUT_MS } from "./run-transcription-job";

vi.mock("./decode-audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./decode-audio")>()),
  decodeAudioToPcm: vi.fn(),
}));

const decodeMock = vi.mocked(decodeAudioToPcm);

const JOB = "job-1";
const MEDIA_URL = "kaipu-media://recording/r1";

function progress(
  phase: TranscriptionJobProgress["phase"],
  extra: Partial<TranscriptionJobProgress> = {},
): TranscriptionJobProgress {
  return { jobId: JOB, id: "r1", phase, segmentsDone: 0, segmentsTotal: 0, ...extra };
}

const chunk = (): ArrayBuffer => new ArrayBuffer(128_000);

/** The decoder fake: yields these chunks, then throws `then` if given. */
function stubDecoder(
  chunks: number,
  then?: Error,
  between?: (index: number) => Promise<void>,
): void {
  decodeMock.mockImplementation((_source, options) =>
    (async function* () {
      for (let i = 0; i < chunks; i++) {
        await between?.(i);
        if (options?.signal?.aborted) throw new DOMException("aborted", "AbortError");
        yield chunk();
      }
      if (then) throw then;
    })(),
  );
}

interface Harness {
  calls: string[];
  emit: (event: TranscriptionJobProgress) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
  api: Record<string, ReturnType<typeof vi.fn>>;
  /** What main does when it receives each message; defaults model a healthy main. */
  main: {
    begin: () => Promise<TranscriptionBeginResult>;
    onEnd: () => void;
    onFail: (reason: string) => void;
    onCancel: () => Promise<void>;
  };
}

let original: typeof window.electronAPI;
let harness: Harness;

function installApi(): void {
  const calls: string[] = [];
  let listener: ((event: TranscriptionJobProgress) => void) | null = null;
  const unsubscribe = vi.fn(() => {
    calls.push("unsubscribe");
    listener = null;
  });
  const emit = (event: TranscriptionJobProgress): void => listener?.(event);
  const main: Harness["main"] = {
    begin: async () => ({ status: "accepted", jobId: JOB }),
    onEnd: () =>
      queueMicrotask(() => emit(progress("done", { segmentsDone: 3, segmentsTotal: 3 }))),
    onFail: (reason) =>
      queueMicrotask(() =>
        emit(progress("failed", { failure: reason === "no-audio" ? "no-audio" : "engine-failed" })),
      ),
    onCancel: async () => {
      queueMicrotask(() => emit(progress("cancelled")));
    },
  };
  const api = {
    beginTranscription: vi.fn(async () => {
      calls.push("begin");
      return main.begin();
    }),
    sendTranscriptionAudio: vi.fn(async (_jobId: string, pcm: ArrayBuffer) => {
      calls.push(`chunk:${pcm.byteLength}`);
    }),
    endTranscriptionAudio: vi.fn(async () => {
      calls.push("end");
      main.onEnd();
    }),
    failTranscriptionAudio: vi.fn(async (_jobId: string, reason: string) => {
      calls.push(`fail:${reason}`);
      main.onFail(reason);
    }),
    cancelTranscription: vi.fn(async () => {
      calls.push("cancel");
      await main.onCancel();
    }),
    onTranscriptionJobProgress: vi.fn((callback: (event: TranscriptionJobProgress) => void) => {
      calls.push("subscribe");
      listener = callback;
      return unsubscribe;
    }),
  };
  window.electronAPI = { ...original, ...api } as never;
  harness = { calls, emit, unsubscribe, api, main };
}

const request = {
  id: "r1",
  assetId: "asset-1",
  modelId: "parakeet-v3",
  mediaUrl: MEDIA_URL,
  durationMs: 12_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  original = window.electronAPI;
  installApi();
});

afterEach(() => {
  window.electronAPI = original;
  vi.useRealTimers();
});

describe("runTranscriptionJob", () => {
  it("begins, subscribes, streams every chunk in order, ends and resolves with the done progress", async () => {
    stubDecoder(3);
    const seen: TranscriptionJobProgress[] = [];

    const result = await runTranscriptionJob({ ...request, onProgress: (p) => seen.push(p) });

    expect(result).toEqual({
      status: "finished",
      progress: progress("done", { segmentsDone: 3, segmentsTotal: 3 }),
    });
    expect(harness.calls).toEqual([
      "begin",
      "subscribe",
      "chunk:128000",
      "chunk:128000",
      "chunk:128000",
      "end",
      "unsubscribe",
    ]);
    expect(harness.api.beginTranscription).toHaveBeenCalledWith({
      id: "r1",
      assetId: "asset-1",
      modelId: "parakeet-v3",
      durationMs: 12_000,
    });
    expect(harness.api.sendTranscriptionAudio).toHaveBeenCalledWith(JOB, expect.any(ArrayBuffer));
    expect(harness.api.endTranscriptionAudio).toHaveBeenCalledWith(JOB);
    expect(decodeMock).toHaveBeenCalledWith({ url: MEDIA_URL }, expect.any(Object));
    expect(seen.map((p) => p.phase)).toEqual(["done"]);
  });

  it("marks the begin request automatic only when the caller says so", async () => {
    stubDecoder(1);
    await runTranscriptionJob({ ...request, automatic: true });
    expect(harness.api.beginTranscription).toHaveBeenLastCalledWith({
      id: "r1",
      assetId: "asset-1",
      modelId: "parakeet-v3",
      durationMs: 12_000,
      automatic: true,
    });
  });

  it("waits for each chunk to be taken before sending the next", async () => {
    stubDecoder(2);
    let release: () => void = () => {};
    harness.api.sendTranscriptionAudio!.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    const running = runTranscriptionJob(request);
    await vi.waitFor(() => expect(harness.api.sendTranscriptionAudio).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.api.sendTranscriptionAudio).toHaveBeenCalledTimes(1);

    release();
    await running;
    expect(harness.api.sendTranscriptionAudio).toHaveBeenCalledTimes(2);
  });

  it("forwards every progress event of the job, not only the last", async () => {
    stubDecoder(1);
    harness.main.onEnd = () =>
      queueMicrotask(() => {
        harness.emit(progress("transcribing", { segmentsDone: 1, segmentsTotal: 3 }));
        harness.emit(progress("done", { segmentsDone: 3, segmentsTotal: 3 }));
      });
    const phases: string[] = [];

    await runTranscriptionJob({ ...request, onProgress: (p) => phases.push(p.phase) });

    expect(phases).toEqual(["transcribing", "done"]);
  });

  describe("refused", () => {
    it.each(["unavailable", "model-missing", "busy", "invalid-item"] as const)(
      "returns the %s refusal without decoding or subscribing",
      async (reason) => {
        harness.main.begin = async () => ({ status: "refused", reason });

        const result = await runTranscriptionJob(request);

        expect(result).toEqual({ status: "refused", reason });
        expect(decodeMock).not.toHaveBeenCalled();
        expect(harness.api.onTranscriptionJobProgress).not.toHaveBeenCalled();
      },
    );
  });

  describe("decode failures", () => {
    it("reports no-audio when the recording has no audio track and does not end the stream", async () => {
      stubDecoder(0, new NoAudioError());

      const result = await runTranscriptionJob(request);

      expect(harness.calls).toEqual(["begin", "subscribe", "fail:no-audio", "unsubscribe"]);
      expect(result).toEqual({
        status: "finished",
        progress: progress("failed", { failure: "no-audio" }),
      });
    });

    it("reports decode-failed for an undecodable track", async () => {
      stubDecoder(0, new UndecodableAudioError("bad codec"));

      await runTranscriptionJob(request);

      expect(harness.calls).toEqual(["begin", "subscribe", "fail:decode-failed", "unsubscribe"]);
    });

    it("reports decode-failed for any other decode error after some chunks were sent", async () => {
      stubDecoder(2, new Error("decoder exploded"));

      await runTranscriptionJob(request);

      expect(harness.calls).toEqual([
        "begin",
        "subscribe",
        "chunk:128000",
        "chunk:128000",
        "fail:decode-failed",
        "unsubscribe",
      ]);
      expect(harness.api.endTranscriptionAudio).not.toHaveBeenCalled();
    });
  });

  describe("abort", () => {
    it("cancels the job, stops decoding and never ends the stream", async () => {
      const controller = new AbortController();
      let decodeSignal: AbortSignal | undefined;
      decodeMock.mockImplementation((_source, options) => {
        decodeSignal = options?.signal;
        return (async function* () {
          for (let i = 0; i < 50; i++) {
            if (options?.signal?.aborted) throw new DOMException("aborted", "AbortError");
            yield chunk();
          }
        })();
      });
      harness.api.sendTranscriptionAudio!.mockImplementation(async () => {
        harness.calls.push("chunk");
        if (harness.calls.filter((call) => call === "chunk").length === 2) controller.abort();
      });

      const result = await runTranscriptionJob({ ...request, signal: controller.signal });

      expect(result).toEqual({ status: "finished", progress: progress("cancelled") });
      expect(harness.api.cancelTranscription).toHaveBeenCalledTimes(1);
      expect(harness.api.cancelTranscription).toHaveBeenCalledWith(JOB);
      expect(harness.api.endTranscriptionAudio).not.toHaveBeenCalled();
      expect(harness.api.failTranscriptionAudio).not.toHaveBeenCalled();
      expect(harness.calls.filter((call) => call === "chunk")).toHaveLength(2);
      expect(decodeSignal?.aborted).toBe(true);
      expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("cancels a job that was accepted while the signal aborted", async () => {
      stubDecoder(5);
      const controller = new AbortController();
      harness.main.begin = async () => {
        controller.abort();
        return { status: "accepted", jobId: JOB };
      };

      const result = await runTranscriptionJob({ ...request, signal: controller.signal });

      expect(result).toEqual({ status: "finished", progress: progress("cancelled") });
      expect(harness.api.cancelTranscription).toHaveBeenCalledWith(JOB);
      expect(harness.api.endTranscriptionAudio).not.toHaveBeenCalled();
    });

    it("cancels while waiting for main's final answer after the audio was sent", async () => {
      stubDecoder(1);
      const controller = new AbortController();
      harness.main.onEnd = () => queueMicrotask(() => controller.abort());

      const result = await runTranscriptionJob({ ...request, signal: controller.signal });

      expect(harness.api.endTranscriptionAudio).toHaveBeenCalledTimes(1);
      expect(harness.api.cancelTranscription).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: "finished", progress: progress("cancelled") });
    });

    it("rejects with an AbortError, without calling main, when already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        runTranscriptionJob({ ...request, signal: controller.signal }),
      ).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(harness.api.beginTranscription).not.toHaveBeenCalled();
    });
  });

  describe("progress events", () => {
    it("ignores events of other jobs", async () => {
      stubDecoder(1);
      const seen: TranscriptionJobProgress[] = [];
      harness.main.onEnd = () =>
        queueMicrotask(() => {
          harness.emit(progress("done", { jobId: "other-job", id: "other" }));
          harness.emit(progress("failed", { jobId: "older-job", failure: "engine-failed" }));
          harness.emit(progress("transcribing"));
          harness.emit(progress("done", { segmentsDone: 2, segmentsTotal: 2 }));
        });

      const result = await runTranscriptionJob({ ...request, onProgress: (p) => seen.push(p) });

      expect(result).toEqual({
        status: "finished",
        progress: progress("done", { segmentsDone: 2, segmentsTotal: 2 }),
      });
      expect(seen.map((p) => p.jobId)).toEqual([JOB, JOB]);
    });

    it("stops streaming and resolves when main ends the job on its own", async () => {
      stubDecoder(10, undefined, async (index) => {
        if (index === 2) harness.emit(progress("failed", { failure: "item-changed" }));
      });

      const result = await runTranscriptionJob(request);

      expect(result).toEqual({
        status: "finished",
        progress: progress("failed", { failure: "item-changed" }),
      });
      expect(harness.api.endTranscriptionAudio).not.toHaveBeenCalled();
      expect(harness.api.sendTranscriptionAudio.mock.calls.length).toBeLessThan(10);
      expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe("main never answers", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("defaults to 330 seconds, longer than main's longest batch deadline", () => {
      expect(TRANSCRIPTION_PROGRESS_TIMEOUT_MS).toBe(330_000);
    });

    it("rejects after the default silence once the audio is sent, then unsubscribes and cancels", async () => {
      stubDecoder(1);
      harness.main.onEnd = () => {};
      let outcome: unknown = "pending";
      void runTranscriptionJob(request).then(
        (value) => (outcome = value),
        (error: unknown) => (outcome = error),
      );

      await vi.advanceTimersByTimeAsync(TRANSCRIPTION_PROGRESS_TIMEOUT_MS - 1);
      expect(outcome).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);

      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toMatch(/330 s/);
      expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
      expect(harness.api.cancelTranscription).toHaveBeenCalledWith(JOB);
    });

    it("restarts the silence timer on every event of the job", async () => {
      stubDecoder(1);
      harness.main.onEnd = () => {};
      let outcome: unknown = "pending";
      void runTranscriptionJob({ ...request, progressTimeoutMs: 1000 }).then(
        (value) => (outcome = value),
        (error: unknown) => (outcome = error),
      );

      await vi.advanceTimersByTimeAsync(900);
      harness.emit(progress("transcribing", { segmentsDone: 1, segmentsTotal: 5 }));
      await vi.advanceTimersByTimeAsync(900);
      expect(outcome).toBe("pending");
      harness.emit(progress("transcribing", { jobId: "other-job" }));
      await vi.advanceTimersByTimeAsync(200);

      expect(outcome).toBeInstanceOf(Error);
    });

    it("does not time out while the audio is still being decoded and sent", async () => {
      let release: () => void = () => {};
      stubDecoder(1, undefined, () => new Promise<void>((resolve) => (release = resolve)));
      const running = runTranscriptionJob({ ...request, progressTimeoutMs: 1000 });

      await vi.advanceTimersByTimeAsync(60_000);
      release();
      await expect(running).resolves.toMatchObject({ status: "finished" });
    });

    it("times out after a cancel that main never confirms", async () => {
      stubDecoder(0);
      harness.main.onEnd = () => {};
      harness.main.onCancel = async () => {};
      const controller = new AbortController();
      let outcome: unknown = "pending";
      void runTranscriptionJob({
        ...request,
        signal: controller.signal,
        progressTimeoutMs: 1000,
      }).then(
        (value) => (outcome = value),
        (error: unknown) => (outcome = error),
      );
      await vi.advanceTimersByTimeAsync(900);
      controller.abort();
      await vi.advanceTimersByTimeAsync(900);
      expect(outcome).toBe("pending");
      await vi.advanceTimersByTimeAsync(100);

      expect(outcome).toBeInstanceOf(Error);
    });
  });

  describe("unexpected IPC failures", () => {
    it("rejects, cancels the job best effort and unsubscribes when sending a chunk fails", async () => {
      stubDecoder(3);
      harness.api.sendTranscriptionAudio!.mockRejectedValue(new Error("ipc closed"));

      await expect(runTranscriptionJob(request)).rejects.toThrow("ipc closed");

      expect(harness.api.cancelTranscription).toHaveBeenCalledWith(JOB);
      expect(harness.api.endTranscriptionAudio).not.toHaveBeenCalled();
      expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("rejects when the cancel itself fails", async () => {
      stubDecoder(5);
      harness.api.cancelTranscription!.mockRejectedValue(new Error("cancel failed"));
      const controller = new AbortController();
      harness.api.sendTranscriptionAudio!.mockImplementation(async () => controller.abort());

      await expect(runTranscriptionJob({ ...request, signal: controller.signal })).rejects.toThrow(
        "cancel failed",
      );
      expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("rejects when begin itself fails", async () => {
      harness.main.begin = async () => {
        throw new Error("no ipc");
      };

      await expect(runTranscriptionJob(request)).rejects.toThrow("no ipc");
      expect(harness.api.onTranscriptionJobProgress).not.toHaveBeenCalled();
    });
  });
});
