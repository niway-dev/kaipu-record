import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TranscriptionJobProgress,
  TranscriptionModelInfo,
  TranscriptionStatus,
} from "@shared/types/transcription";
import { runTranscriptionJob } from "./audio/run-transcription-job";
import { resetTranscriptionJobStore, startTranscription } from "./transcription-job-store";
import { useTranscribeControl, type TranscribeControlItem } from "./use-transcribe-control";

vi.mock("./audio/run-transcription-job", () => ({ runTranscriptionJob: vi.fn() }));
const flag = vi.hoisted(() => ({ on: true }));
vi.mock("@renderer/features/analytics/use-flag", () => ({ useFlag: () => flag.on }));

const MODEL_ID = "parakeet-tdt-0.6b-v3-int8";
const realApi = window.electronAPI;

function stubApi(over: Partial<typeof window.electronAPI>): void {
  window.electronAPI = { ...realApi, ...over };
}

function statusOf(modelStatus: TranscriptionModelInfo["status"]): TranscriptionStatus {
  return {
    availability: { status: "available" },
    defaultModelId: MODEL_ID,
    models: [
      {
        id: MODEL_ID,
        label: "Parakeet",
        languages: ["en"],
        sizeBytes: 1,
        location: "/m",
        license: { name: "l", attribution: "a", url: "u" },
        status: modelStatus,
      },
    ],
    job: null,
  };
}

const ITEM: TranscribeControlItem = {
  id: "a",
  assetId: "asset-a",
  mediaUrl: "kaipu-media://a.mp4",
  durationMs: 5000,
  transcribedAt: null,
};

function progress(
  id: string,
  phase: TranscriptionJobProgress["phase"],
  over: Partial<TranscriptionJobProgress> = {},
): TranscriptionJobProgress {
  return { jobId: "j", id, phase, segmentsDone: 0, segmentsTotal: 0, ...over };
}

const run = vi.mocked(runTranscriptionJob);

/** A job the test finishes and reports on by hand. */
function controlledJob() {
  let finish: (p: TranscriptionJobProgress) => void = () => {};
  let onProgress: ((p: TranscriptionJobProgress) => void) | undefined;
  run.mockImplementationOnce((args) => {
    onProgress = args.onProgress;
    return new Promise((resolve) => {
      finish = (p) => resolve({ status: "finished", progress: p });
    });
  });
  return {
    emit: (p: TranscriptionJobProgress) => onProgress?.(p),
    finish: (p: TranscriptionJobProgress) => finish(p),
  };
}

beforeEach(() => {
  flag.on = true;
  resetTranscriptionJobStore();
  run.mockReset();
});

afterEach(() => {
  window.electronAPI = realApi;
});

describe("useTranscribeControl", () => {
  it("is hidden with the flag off and never reads the status", async () => {
    flag.on = false;
    const getTranscriptionStatus = vi.fn(async () => statusOf({ state: "ready" }));
    stubApi({ getTranscriptionStatus });
    const { result } = renderHook(() => useTranscribeControl(ITEM));

    await act(async () => {});
    expect(result.current.state).toEqual({ kind: "hidden" });
    expect(getTranscriptionStatus).not.toHaveBeenCalled();
    await expect(result.current.start()).resolves.toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("is hidden without local media", async () => {
    stubApi({ getTranscriptionStatus: async () => statusOf({ state: "ready" }) });
    const { result } = renderHook(() => useTranscribeControl({ ...ITEM, mediaUrl: null }));

    await act(async () => {});
    expect(result.current.state).toEqual({ kind: "hidden" });
  });

  it("is loading until the status arrives", async () => {
    stubApi({ getTranscriptionStatus: async () => statusOf({ state: "ready" }) });
    const { result } = renderHook(() => useTranscribeControl(ITEM));

    expect(result.current.state).toEqual({ kind: "loading" });
    await waitFor(() => expect(result.current.state.kind).toBe("idle"));
  });

  it("needs a model when it is missing, and start does nothing", async () => {
    stubApi({ getTranscriptionStatus: async () => statusOf({ state: "missing" }) });
    const { result } = renderHook(() => useTranscribeControl(ITEM));
    await waitFor(() => expect(result.current.state.kind).toBe("needs-model"));

    await expect(result.current.start()).resolves.toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("shows the model downloading", async () => {
    stubApi({
      getTranscriptionStatus: async () =>
        statusOf({ state: "downloading", receivedBytes: 1, totalBytes: 2 }),
    });
    const { result } = renderHook(() => useTranscribeControl(ITEM));

    await waitFor(() => expect(result.current.state.kind).toBe("model-downloading"));
  });

  it("goes idle, running, then done, starting the job with the default model", async () => {
    stubApi({ getTranscriptionStatus: async () => statusOf({ state: "ready" }) });
    const job = controlledJob();
    const { result } = renderHook(() => useTranscribeControl(ITEM));
    await waitFor(() => expect(result.current.state.kind).toBe("idle"));

    let outcome: ReturnType<typeof result.current.start> = Promise.resolve(null);
    act(() => {
      outcome = result.current.start();
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "a",
        assetId: "asset-a",
        modelId: MODEL_ID,
        mediaUrl: ITEM.mediaUrl,
        durationMs: 5000,
      }),
    );
    expect(result.current.state).toEqual({
      kind: "running",
      phase: "starting",
      segmentsDone: 0,
      segmentsTotal: 0,
    });

    act(() => job.emit(progress("a", "transcribing", { segmentsDone: 1, segmentsTotal: 4 })));
    expect(result.current.state).toEqual({
      kind: "running",
      phase: "transcribing",
      segmentsDone: 1,
      segmentsTotal: 4,
    });

    await act(async () => {
      job.finish(progress("a", "done"));
      await outcome;
    });
    expect(result.current.state).toEqual({ kind: "done" });
  });

  it("start is a no-op while running", async () => {
    stubApi({ getTranscriptionStatus: async () => statusOf({ state: "ready" }) });
    const job = controlledJob();
    const { result } = renderHook(() => useTranscribeControl(ITEM));
    await waitFor(() => expect(result.current.state.kind).toBe("idle"));
    let first: ReturnType<typeof result.current.start> = Promise.resolve(null);
    act(() => {
      first = result.current.start();
    });

    await expect(result.current.start()).resolves.toBeNull();
    expect(run).toHaveBeenCalledTimes(1);

    await act(async () => {
      job.finish(progress("a", "done"));
      await first;
    });
  });

  it("start is a no-op when a transcript already exists", async () => {
    stubApi({ getTranscriptionStatus: async () => statusOf({ state: "ready" }) });
    const { result } = renderHook(() => useTranscribeControl({ ...ITEM, transcribedAt: 123 }));
    await waitFor(() => expect(result.current.state.kind).toBe("done"));

    await expect(result.current.start()).resolves.toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("treats hasTranscript like a transcript file, with no timestamp", async () => {
    stubApi({ getTranscriptionStatus: async () => statusOf({ state: "ready" }) });
    const { result } = renderHook(() => useTranscribeControl({ ...ITEM, hasTranscript: true }));
    await waitFor(() => expect(result.current.state.kind).toBe("done"));

    await expect(result.current.start()).resolves.toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("is busy elsewhere while another item's job runs, and start does nothing", async () => {
    stubApi({ getTranscriptionStatus: async () => statusOf({ state: "ready" }) });
    const job = controlledJob();
    const { result } = renderHook(() => useTranscribeControl(ITEM));
    await waitFor(() => expect(result.current.state.kind).toBe("idle"));

    let other: Promise<unknown> = Promise.resolve();
    act(() => {
      other = startTranscription({
        itemId: "b",
        assetId: "x",
        modelId: MODEL_ID,
        mediaUrl: "u",
        durationMs: 1,
      });
    });
    expect(result.current.state).toEqual({ kind: "busy-elsewhere" });
    await expect(result.current.start()).resolves.toBeNull();

    await act(async () => {
      job.finish(progress("b", "cancelled"));
      await other;
    });
    expect(result.current.state.kind).toBe("idle");
  });

  it("shows failed after a failure and lets start retry", async () => {
    stubApi({ getTranscriptionStatus: async () => statusOf({ state: "ready" }) });
    const first = controlledJob();
    const { result } = renderHook(() => useTranscribeControl(ITEM));
    await waitFor(() => expect(result.current.state.kind).toBe("idle"));
    let outcome: ReturnType<typeof result.current.start> = Promise.resolve(null);
    act(() => {
      outcome = result.current.start();
    });
    await act(async () => {
      first.finish(progress("a", "failed", { failure: "engine-failed" }));
      await outcome;
    });
    expect(result.current.state).toEqual({ kind: "failed", failure: "engine-failed" });

    const second = controlledJob();
    let retry: ReturnType<typeof result.current.start> = Promise.resolve(null);
    act(() => {
      retry = result.current.start();
    });
    expect(run).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.finish(progress("a", "done"));
      await retry;
    });
    expect(result.current.state.kind).toBe("done");
  });

  it("shows failed when main refuses the start, so the click leaves a trace", async () => {
    stubApi({ getTranscriptionStatus: async () => statusOf({ state: "ready" }) });
    run.mockResolvedValueOnce({ status: "refused", reason: "model-missing" });
    const { result } = renderHook(() => useTranscribeControl(ITEM));
    await waitFor(() => expect(result.current.state.kind).toBe("idle"));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toEqual({ kind: "failed", failure: "model-missing" });
  });

  it("cancel stops this item's job and does nothing for another item's", async () => {
    stubApi({ getTranscriptionStatus: async () => statusOf({ state: "ready" }) });
    let signal: AbortSignal | undefined;
    run.mockImplementationOnce((args) => {
      signal = args.signal;
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useTranscribeControl(ITEM));
    await waitFor(() => expect(result.current.state.kind).toBe("idle"));

    act(() => result.current.cancel());
    expect(signal).toBeUndefined();

    act(() => {
      void result.current.start();
    });
    act(() => result.current.cancel());
    expect(signal?.aborted).toBe(true);
  });
});
