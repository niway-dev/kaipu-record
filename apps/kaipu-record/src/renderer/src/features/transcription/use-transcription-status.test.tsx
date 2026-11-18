import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TranscriptionModelDownloadResult,
  TranscriptionModelInfo,
  TranscriptionModelProgress,
  TranscriptionStatus,
} from "@shared/types/transcription";
import { resetTranscriptionStatusStore, useTranscriptionStatus } from "./use-transcription-status";

const MODEL_ID = "parakeet-tdt-0.6b-v3-int8";

function model(status: TranscriptionModelInfo["status"]): TranscriptionModelInfo {
  return {
    id: MODEL_ID,
    label: "Parakeet",
    languages: ["en", "es"],
    sizeBytes: 640_000_000,
    location: "/models/parakeet",
    license: { name: "CC-BY-4.0", attribution: "Credit line", url: "https://example.test/l" },
    status,
  };
}

function statusOf(status: TranscriptionModelInfo["status"]): TranscriptionStatus {
  return {
    availability: { status: "available" },
    defaultModelId: MODEL_ID,
    models: [model(status)],
    job: null,
  };
}

const realApi = window.electronAPI;

function stubApi(over: Partial<typeof window.electronAPI>): void {
  window.electronAPI = { ...realApi, ...over };
}

beforeEach(() => {
  resetTranscriptionStatusStore();
});

afterEach(() => {
  window.electronAPI = realApi;
});

describe("useTranscriptionStatus", () => {
  it("is loading until the status arrives, then exposes it", async () => {
    stubApi({ getTranscriptionStatus: async () => statusOf({ state: "missing" }) });
    const { result } = renderHook(() => useTranscriptionStatus());

    expect(result.current.status).toBeNull();
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.status?.models[0].status).toEqual({ state: "missing" });
  });

  it("re-reads a download it did not start until it settles, and survives a failed read", async () => {
    vi.useFakeTimers();
    try {
      const reads: Array<() => TranscriptionStatus> = [
        () => statusOf({ state: "downloading", receivedBytes: 10, totalBytes: 100 }), // first load
        () => {
          throw new Error("one bad read"); // a failed poll keeps what is on screen
        },
        () => statusOf({ state: "ready" }),
      ];
      let call = 0;
      stubApi({ getTranscriptionStatus: async () => reads[Math.min(call++, reads.length - 1)]!() });
      const { result, unmount } = renderHook(() => useTranscriptionStatus());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.status?.models[0].status.state).toBe("downloading");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(result.current.status?.models[0].status.state).toBe("downloading");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(result.current.status?.models[0].status).toEqual({ state: "ready" });

      // Settled: no more polling, and unmounting leaves nothing running.
      const callsWhenSettled = call;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(call).toBe(callsWhenSettled);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays idle with enabled false: no status call, no progress listener", async () => {
    const getTranscriptionStatus = vi.fn(async () => statusOf({ state: "missing" }));
    const onTranscriptionModelProgress = vi.fn(() => () => {});
    stubApi({ getTranscriptionStatus, onTranscriptionModelProgress });
    const { result } = renderHook(() => useTranscriptionStatus({ enabled: false }));

    await act(async () => {});
    expect(result.current.status).toBeNull();
    expect(getTranscriptionStatus).not.toHaveBeenCalled();
    expect(onTranscriptionModelProgress).not.toHaveBeenCalled();
  });

  it("treats a rejected status call as unreachable (not an unsupported platform) instead of crashing", async () => {
    stubApi({
      getTranscriptionStatus: async () => {
        throw new Error("ipc down");
      },
    });
    const { result } = renderHook(() => useTranscriptionStatus());

    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.status?.availability).toEqual({
      status: "unavailable",
      reason: "unreachable",
    });
    expect(result.current.status?.models).toEqual([]);
  });

  it("updates the downloading model live from progress events, and ignores other ids", async () => {
    let push: (progress: TranscriptionModelProgress) => void = () => {};
    stubApi({
      getTranscriptionStatus: async () =>
        statusOf({ state: "downloading", receivedBytes: 0, totalBytes: 640_000_000 }),
      onTranscriptionModelProgress: (callback) => {
        push = callback;
        return () => {};
      },
    });
    const { result } = renderHook(() => useTranscriptionStatus());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    act(() =>
      push({ id: MODEL_ID, receivedBytes: 320_000_000, totalBytes: 640_000_000, fileName: "a" }),
    );
    expect(result.current.status?.models[0].status).toEqual({
      state: "downloading",
      receivedBytes: 320_000_000,
      totalBytes: 640_000_000,
    });

    act(() => push({ id: "other", receivedBytes: 1, totalBytes: 2, fileName: "b" }));
    expect(result.current.status?.models).toHaveLength(1);
  });

  it("unsubscribes from progress on unmount", async () => {
    const unsubscribe = vi.fn();
    stubApi({
      getTranscriptionStatus: async () => statusOf({ state: "missing" }),
      onTranscriptionModelProgress: () => unsubscribe,
    });
    const { result, unmount } = renderHook(() => useTranscriptionStatus());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("shows the model as downloading right away, then refreshes when the download resolves", async () => {
    let resolveDownload: (result: TranscriptionModelDownloadResult) => void = () => {};
    const download = vi.fn(
      () => new Promise<TranscriptionModelDownloadResult>((resolve) => (resolveDownload = resolve)),
    );
    const getStatus = vi
      .fn<() => Promise<TranscriptionStatus>>()
      .mockResolvedValueOnce(statusOf({ state: "missing" }))
      .mockResolvedValue(statusOf({ state: "ready" }));
    stubApi({ getTranscriptionStatus: getStatus, downloadTranscriptionModel: download });
    const { result } = renderHook(() => useTranscriptionStatus());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    let finished: Promise<void> = Promise.resolve();
    act(() => {
      finished = result.current.download(MODEL_ID);
    });

    expect(download).toHaveBeenCalledWith(MODEL_ID);
    expect(result.current.status?.models[0].status).toEqual({
      state: "downloading",
      receivedBytes: 0,
      totalBytes: 640_000_000,
    });

    await act(async () => {
      resolveDownload({ status: "ready" });
      await finished;
    });

    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status?.models[0].status).toEqual({ state: "ready" });
    expect(result.current.failures).toEqual({});
  });

  it("keeps the failure code of a failed download until the next attempt", async () => {
    const download = vi
      .fn<(id: string) => Promise<TranscriptionModelDownloadResult>>()
      .mockResolvedValueOnce({ status: "failed", code: "hash-mismatch" })
      .mockResolvedValueOnce({ status: "ready" });
    stubApi({
      getTranscriptionStatus: async () =>
        statusOf({ state: "failed", reason: "The checksum did not match." }),
      downloadTranscriptionModel: download,
    });
    const { result } = renderHook(() => useTranscriptionStatus());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.download(MODEL_ID);
    });
    expect(result.current.failures).toEqual({ [MODEL_ID]: "hash-mismatch" });

    await act(async () => {
      await result.current.download(MODEL_ID);
    });
    expect(result.current.failures).toEqual({});
  });

  it("treats a rejected download call as an unknown failure and still refreshes", async () => {
    const getStatus = vi.fn(async () => statusOf({ state: "missing" }));
    stubApi({
      getTranscriptionStatus: getStatus,
      downloadTranscriptionModel: async () => {
        throw new Error("ipc down");
      },
    });
    const { result } = renderHook(() => useTranscriptionStatus());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.download(MODEL_ID);
    });

    expect(result.current.failures).toEqual({ [MODEL_ID]: "unknown" });
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("cancel asks main to cancel the download", async () => {
    const cancel = vi.fn(async () => {});
    stubApi({
      getTranscriptionStatus: async () => statusOf({ state: "missing" }),
      cancelTranscriptionModelDownload: cancel,
    });
    const { result } = renderHook(() => useTranscriptionStatus());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.cancel(MODEL_ID);
    });

    expect(cancel).toHaveBeenCalledWith(MODEL_ID);
  });

  it("remove deletes the model and refreshes", async () => {
    const remove = vi.fn(async () => {});
    const getStatus = vi
      .fn<() => Promise<TranscriptionStatus>>()
      .mockResolvedValueOnce(statusOf({ state: "ready" }))
      .mockResolvedValue(statusOf({ state: "missing" }));
    stubApi({ getTranscriptionStatus: getStatus, removeTranscriptionModel: remove });
    const { result } = renderHook(() => useTranscriptionStatus());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.remove(MODEL_ID);
    });

    expect(remove).toHaveBeenCalledWith(MODEL_ID);
    expect(result.current.status?.models[0].status).toEqual({ state: "missing" });
  });

  it("remove and cancel do not reject when the IPC call does, and remove re-reads the disk state", async () => {
    const getStatus = vi.fn(async () => statusOf({ state: "ready" }));
    stubApi({
      getTranscriptionStatus: getStatus,
      removeTranscriptionModel: async () => {
        throw new Error("ipc down");
      },
      cancelTranscriptionModelDownload: async () => {
        throw new Error("ipc down");
      },
    });
    const { result } = renderHook(() => useTranscriptionStatus());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await expect(result.current.cancel(MODEL_ID)).resolves.toBeUndefined();
      await expect(result.current.remove(MODEL_ID)).resolves.toBeUndefined();
    });

    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status?.models[0].status).toEqual({ state: "ready" });
  });

  it("shares one status call, one progress listener and one poller between many consumers", async () => {
    vi.useFakeTimers();
    try {
      const getStatus = vi.fn(async () =>
        statusOf({ state: "downloading", receivedBytes: 1, totalBytes: 10 }),
      );
      const unsubscribe = vi.fn();
      const onProgress = vi.fn(() => unsubscribe);
      stubApi({ getTranscriptionStatus: getStatus, onTranscriptionModelProgress: onProgress });
      const hooks = Array.from({ length: 20 }, () => renderHook(() => useTranscriptionStatus()));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(getStatus).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledTimes(1);
      for (const { result } of hooks) {
        expect(result.current.status?.models[0].status.state).toBe("downloading");
      }

      // One poll tick is one more read, not twenty.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(getStatus).toHaveBeenCalledTimes(2);

      // The store stays up until the last consumer leaves.
      for (const { unmount } of hooks.slice(1)) unmount();
      expect(unsubscribe).not.toHaveBeenCalled();
      hooks[0]!.unmount();
      expect(unsubscribe).toHaveBeenCalledOnce();
      const callsAtStop = getStatus.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(getStatus).toHaveBeenCalledTimes(callsAtStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a poll from before a restart does not reopen the gate for the poll that replaced it", async () => {
    vi.useFakeTimers();
    try {
      const downloading = statusOf({ state: "downloading", receivedBytes: 1, totalBytes: 10 });
      const pending: Array<(status: TranscriptionStatus) => void> = [];
      let call = 0;
      const getStatus = vi.fn(() => {
        call += 1;
        // Loads (1 and 3) answer at once; the polls (2 and 4) stay out until resolved by hand.
        if (call % 2 === 1) return Promise.resolve(downloading);
        return new Promise<TranscriptionStatus>((resolve) => pending.push(resolve));
      });
      stubApi({ getTranscriptionStatus: getStatus });

      const first = renderHook(() => useTranscriptionStatus());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000); // poll 2 starts and stays in flight
      });
      first.unmount(); // the store goes idle with that poll still out
      renderHook(() => useTranscriptionStatus());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000); // load 3 settled; poll 4 starts and stays in flight
      });
      expect(getStatus).toHaveBeenCalledTimes(4);

      // The old poll ends now. It must not tell the new poll's gate that nothing is in flight.
      await act(async () => {
        pending[0]!(downloading);
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(getStatus).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not subscribe an idle consumer to the shared store", async () => {
    const getStatus = vi.fn(async () => statusOf({ state: "missing" }));
    const onProgress = vi.fn(() => () => {});
    stubApi({ getTranscriptionStatus: getStatus, onTranscriptionModelProgress: onProgress });
    const idle = renderHook(() => useTranscriptionStatus({ enabled: false }));
    const live = renderHook(() => useTranscriptionStatus());
    await waitFor(() => expect(live.result.current.status).not.toBeNull());

    expect(idle.result.current.status).toBeNull();
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it("shows a download started by one consumer as downloading in another, failure included", async () => {
    let resolveDownload: (result: TranscriptionModelDownloadResult) => void = () => {};
    stubApi({
      getTranscriptionStatus: async () => statusOf({ state: "missing" }),
      downloadTranscriptionModel: () =>
        new Promise<TranscriptionModelDownloadResult>((resolve) => (resolveDownload = resolve)),
    });
    const first = renderHook(() => useTranscriptionStatus());
    const second = renderHook(() => useTranscriptionStatus());
    await waitFor(() => expect(second.result.current.status).not.toBeNull());

    let finished: Promise<void> = Promise.resolve();
    act(() => {
      finished = first.result.current.download(MODEL_ID);
    });
    expect(second.result.current.status?.models[0].status.state).toBe("downloading");

    await act(async () => {
      resolveDownload({ status: "failed", code: "hash-mismatch" });
      await finished;
    });
    expect(second.result.current.failures).toEqual({ [MODEL_ID]: "hash-mismatch" });
  });
});
