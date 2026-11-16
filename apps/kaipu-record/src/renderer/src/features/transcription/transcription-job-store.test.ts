import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptionJobProgress } from "@shared/types/transcription";
import { NoAudioError } from "./audio/decode-audio";
import { runTranscriptionJob } from "./audio/run-transcription-job";
import {
  cancelRunningTranscription,
  getSnapshot,
  resetTranscriptionJobStore,
  startTranscription,
  subscribe,
} from "./transcription-job-store";

vi.mock("./audio/run-transcription-job", () => ({ runTranscriptionJob: vi.fn() }));

const run = vi.mocked(runTranscriptionJob);

const ARGS = {
  itemId: "item-1",
  assetId: "asset-1",
  modelId: "model-1",
  mediaUrl: "kaipu-media://item-1.mp4",
  durationMs: 60_000,
};

function progress(
  phase: TranscriptionJobProgress["phase"],
  over: Partial<TranscriptionJobProgress> = {},
): TranscriptionJobProgress {
  return { jobId: "job-1", id: "item-1", phase, segmentsDone: 0, segmentsTotal: 0, ...over };
}

/** A job the test finishes by hand. */
function controlledJob() {
  let finish: (value: Awaited<ReturnType<typeof runTranscriptionJob>>) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  let args: Parameters<typeof runTranscriptionJob>[0] | undefined;
  run.mockImplementationOnce((a) => {
    args = a;
    return new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  });
  return {
    finish: (p: TranscriptionJobProgress) => finish({ status: "finished", progress: p }),
    fail: (error: unknown) => fail(error),
    emit: (p: TranscriptionJobProgress) => args?.onProgress?.(p),
    signal: () => args?.signal,
  };
}

beforeEach(() => {
  resetTranscriptionJobStore();
  run.mockReset();
});

describe("transcription job store", () => {
  it("mirrors progress into running and clears it when the job is done", async () => {
    const job = controlledJob();
    const outcome = startTranscription(ARGS);

    expect(getSnapshot().running).toEqual({
      itemId: "item-1",
      phase: "starting",
      segmentsDone: 0,
      segmentsTotal: 0,
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "item-1",
        assetId: "asset-1",
        modelId: "model-1",
        mediaUrl: ARGS.mediaUrl,
        durationMs: 60_000,
      }),
    );

    job.emit(progress("transcribing", { segmentsDone: 2, segmentsTotal: 8 }));
    expect(getSnapshot().running).toEqual({
      itemId: "item-1",
      phase: "transcribing",
      segmentsDone: 2,
      segmentsTotal: 8,
    });

    job.finish(progress("done", { segmentsDone: 8, segmentsTotal: 8 }));
    await expect(outcome).resolves.toEqual({ status: "done" });
    expect(getSnapshot().running).toBeNull();
    expect(getSnapshot().doneCounts).toEqual({ "item-1": 1 });
  });

  it("notifies subscribers and stops after unsubscribe", async () => {
    const job = controlledJob();
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    const outcome = startTranscription(ARGS);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    job.finish(progress("done"));
    await outcome;
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("refuses a second start while one runs, without calling main", async () => {
    const job = controlledJob();
    const first = startTranscription(ARGS);

    await expect(startTranscription({ ...ARGS, itemId: "item-2" })).resolves.toEqual({
      status: "refused",
      reason: "busy",
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(getSnapshot().running?.itemId).toBe("item-1");
    // The controls already show the other job running, so nothing is recorded against item-2.
    expect(getSnapshot().failures).toEqual({});

    job.finish(progress("done"));
    await first;
  });

  it.each([
    ["unavailable", "engine-unavailable"],
    ["model-missing", "model-missing"],
    ["busy", "busy"],
    ["invalid-item", "item-changed"],
  ] as const)(
    "passes main's %s refusal through, leaves nothing running and records it as the item's failure",
    async (reason, failure) => {
      run.mockResolvedValueOnce({ status: "refused", reason });

      await expect(startTranscription(ARGS)).resolves.toEqual({ status: "refused", reason });
      expect(getSnapshot().running).toBeNull();
      expect(getSnapshot().failures).toEqual({ "item-1": failure });
    },
  );

  it("clears a refusal's failure when the item starts again", async () => {
    run.mockResolvedValueOnce({ status: "refused", reason: "model-missing" });
    await startTranscription(ARGS);
    const job = controlledJob();
    const again = startTranscription(ARGS);

    expect(getSnapshot().failures).toEqual({});
    job.finish(progress("done"));
    await again;
  });

  it("records a failed job's failure for the item and clears it when the item starts again", async () => {
    const first = controlledJob();
    const failed = startTranscription(ARGS);
    first.finish(progress("failed", { failure: "engine-failed" }));
    await expect(failed).resolves.toEqual({ status: "failed", failure: "engine-failed" });
    expect(getSnapshot().failures).toEqual({ "item-1": "engine-failed" });

    const second = controlledJob();
    const retry = startTranscription(ARGS);
    expect(getSnapshot().failures).toEqual({});
    second.finish(progress("done"));
    await retry;
    expect(getSnapshot().failures).toEqual({});
  });

  it("keeps another item's failure when a different item starts", async () => {
    const first = controlledJob();
    const failed = startTranscription(ARGS);
    first.finish(progress("failed", { failure: "write-failed" }));
    await failed;

    const second = controlledJob();
    const other = startTranscription({ ...ARGS, itemId: "item-2" });
    expect(getSnapshot().failures).toEqual({ "item-1": "write-failed" });
    second.finish(progress("cancelled", { id: "item-2" }));
    await other;
  });

  it("maps a failed progress without a failure code to unknown", async () => {
    const job = controlledJob();
    const outcome = startTranscription(ARGS);
    job.finish(progress("failed"));

    await expect(outcome).resolves.toEqual({ status: "failed", failure: "unknown" });
  });

  it("resolves cancelled when the job ends cancelled, and records no failure", async () => {
    const job = controlledJob();
    const outcome = startTranscription(ARGS);
    job.finish(progress("cancelled"));

    await expect(outcome).resolves.toEqual({ status: "cancelled" });
    expect(getSnapshot().failures).toEqual({});
    expect(getSnapshot().doneCounts).toEqual({});
  });

  it("aborts the running job's signal on cancel", async () => {
    const job = controlledJob();
    const outcome = startTranscription(ARGS);
    expect(job.signal()?.aborted).toBe(false);

    cancelRunningTranscription();
    expect(job.signal()?.aborted).toBe(true);

    job.finish(progress("cancelled"));
    await outcome;
  });

  it("cancel with nothing running does nothing", () => {
    expect(() => cancelRunningTranscription()).not.toThrow();
  });

  it("turns a thrown error into an unknown failure and frees the engine slot", async () => {
    const job = controlledJob();
    const outcome = startTranscription(ARGS);
    job.fail(new Error("ipc down"));

    await expect(outcome).resolves.toEqual({ status: "failed", failure: "unknown" });
    expect(getSnapshot().running).toBeNull();
    expect(getSnapshot().failures).toEqual({ "item-1": "unknown" });
  });

  it("maps a NoAudioError to no-audio", async () => {
    const job = controlledJob();
    const outcome = startTranscription(ARGS);
    job.fail(new NoAudioError());

    await expect(outcome).resolves.toEqual({ status: "failed", failure: "no-audio" });
  });

  it("maps a no-audio progress failure to no-audio", async () => {
    const job = controlledJob();
    const outcome = startTranscription(ARGS);
    job.finish(progress("failed", { failure: "no-audio" }));

    await expect(outcome).resolves.toEqual({ status: "failed", failure: "no-audio" });
  });

  it("counts each finished job of an item", async () => {
    for (let i = 0; i < 2; i++) {
      const job = controlledJob();
      const outcome = startTranscription(ARGS);
      job.finish(progress("done"));
      await outcome;
    }
    expect(getSnapshot().doneCounts).toEqual({ "item-1": 2 });
  });

  it("reset forgets the running job, failures and done counts", async () => {
    const job = controlledJob();
    const outcome = startTranscription(ARGS);
    job.finish(progress("failed", { failure: "engine-failed" }));
    await outcome;
    const other = controlledJob();
    void startTranscription({ ...ARGS, itemId: "item-2" });
    expect(getSnapshot().running).not.toBeNull();

    resetTranscriptionJobStore();

    expect(getSnapshot()).toEqual({ running: null, failures: {}, doneCounts: {} });
    other.finish(progress("done", { id: "item-2" }));
  });
});
