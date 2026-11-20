import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TranscriptDocument,
  TranscriptFreshnessResult,
  TranscriptReadResult,
  TranscriptionJobProgress,
} from "@shared/types/transcription";
import { runTranscriptionJob } from "./audio/run-transcription-job";
import { resetTranscriptionJobStore, startTranscription } from "./transcription-job-store";
import { useTranscript } from "./use-transcript";

vi.mock("./audio/run-transcription-job", () => ({ runTranscriptionJob: vi.fn() }));

const realApi = window.electronAPI;

function stubApi(over: Partial<typeof window.electronAPI>): void {
  window.electronAPI = { ...realApi, ...over };
}

const DOC: TranscriptDocument = {
  schemaVersion: 1,
  model: { id: "m", revision: "1", files: {} },
  engine: { name: "sherpa", version: "1" },
  media: { contentHash: "h", durationMs: 1000 },
  createdAt: "2026-11-15T00:00:00.000Z",
  segments: [],
  unresolved: [],
  words: [],
};

const READY: TranscriptReadResult = {
  status: "ready",
  transcript: DOC,
  stale: false,
  freshness: "fresh",
};

beforeEach(() => {
  resetTranscriptionJobStore();
  vi.mocked(runTranscriptionJob).mockReset();
});

afterEach(() => {
  window.electronAPI = realApi;
});

describe("useTranscript", () => {
  it("is loading, then ready with the transcript", async () => {
    stubApi({ readTranscript: async () => READY });
    const { result } = renderHook(() => useTranscript("a"));

    expect(result.current.state).toBe("loading");
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.transcript).toBe(DOC);
    expect(result.current.stale).toBe(false);
  });

  it("reports none when there is no file", async () => {
    stubApi({ readTranscript: async () => ({ status: "none" }) });
    const { result } = renderHook(() => useTranscript("a"));

    await waitFor(() => expect(result.current.state).toBe("none"));
    expect(result.current.transcript).toBeNull();
  });

  it("reports invalid for an unreadable file", async () => {
    stubApi({ readTranscript: async () => ({ status: "invalid" }) });
    const { result } = renderHook(() => useTranscript("a"));

    await waitFor(() => expect(result.current.state).toBe("invalid"));
    expect(result.current.transcript).toBeNull();
  });

  it("exposes the stale flag and keeps the words readable", async () => {
    stubApi({
      readTranscript: async () => ({
        status: "ready",
        transcript: DOC,
        stale: true,
        freshness: "stale",
      }),
      checkTranscriptFreshness: async () => ({ verdict: "stale", autoRetranscribe: false }),
    });
    const { result } = renderHook(() => useTranscript("a"));

    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.stale).toBe(true);
    expect(result.current.transcript).toBe(DOC);
  });

  describe("freshness check", () => {
    const COLD: TranscriptReadResult = {
      status: "ready",
      transcript: DOC,
      stale: false,
      freshness: "checking",
    };

    it("shows the words at once while the check is out, then applies the verdict", async () => {
      let settle!: (result: TranscriptFreshnessResult) => void;
      stubApi({
        readTranscript: async () => COLD,
        checkTranscriptFreshness: () => new Promise((resolve) => (settle = resolve)),
      });
      const { result } = renderHook(() => useTranscript("a"));

      await waitFor(() => expect(result.current.state).toBe("ready"));
      expect(result.current.transcript).toBe(DOC);
      expect(result.current.freshness).toBe("checking");
      expect(result.current.stale).toBe(false);

      await act(async () => settle({ verdict: "fresh", autoRetranscribe: false }));
      expect(result.current.freshness).toBe("fresh");
      expect(result.current.stale).toBe(false);
      expect(result.current.autoRetranscribe).toBe(false);
    });

    it("marks the words stale and passes on whether an automatic re-transcribe is allowed", async () => {
      stubApi({
        readTranscript: async () => COLD,
        checkTranscriptFreshness: async () => ({ verdict: "stale", autoRetranscribe: true }),
      });
      const { result } = renderHook(() => useTranscript("a"));

      await waitFor(() => expect(result.current.freshness).toBe("stale"));
      expect(result.current.stale).toBe(true);
      expect(result.current.autoRetranscribe).toBe(true);
      expect(result.current.transcript).toBe(DOC);
    });

    it("shows an unverifiable recording as out of date, with no automatic attempt", async () => {
      stubApi({
        readTranscript: async () => COLD,
        checkTranscriptFreshness: async () => ({ verdict: "unknown", autoRetranscribe: false }),
      });
      const { result } = renderHook(() => useTranscript("a"));

      await waitFor(() => expect(result.current.freshness).toBe("unknown"));
      expect(result.current.stale).toBe(true);
      expect(result.current.autoRetranscribe).toBe(false);
    });

    it("does not check a warm, fresh read", async () => {
      const check = vi.fn(
        async (): Promise<TranscriptFreshnessResult> => ({
          verdict: "fresh",
          autoRetranscribe: false,
        }),
      );
      stubApi({ readTranscript: async () => READY, checkTranscriptFreshness: check });
      const { result } = renderHook(() => useTranscript("a"));

      await waitFor(() => expect(result.current.state).toBe("ready"));
      await act(async () => {});
      expect(check).not.toHaveBeenCalled();
    });

    it("checks a warm stale read too, because only the check says if a retry is allowed", async () => {
      const check = vi.fn(
        async (): Promise<TranscriptFreshnessResult> => ({
          verdict: "stale",
          autoRetranscribe: true,
        }),
      );
      stubApi({
        readTranscript: async () => ({
          status: "ready",
          transcript: DOC,
          stale: true,
          freshness: "stale",
        }),
        checkTranscriptFreshness: check,
      });
      const { result } = renderHook(() => useTranscript("a"));

      await waitFor(() => expect(result.current.autoRetranscribe).toBe(true));
      expect(check).toHaveBeenCalledWith("a");
      expect(result.current.stale).toBe(true);
    });

    it("treats a failed check as unknown", async () => {
      stubApi({
        readTranscript: async () => COLD,
        checkTranscriptFreshness: async () => {
          throw new Error("ipc down");
        },
      });
      const { result } = renderHook(() => useTranscript("a"));

      await waitFor(() => expect(result.current.freshness).toBe("unknown"));
    });

    it("drops a verdict that lands after the id changed", async () => {
      const verdicts = new Map<string, (result: TranscriptFreshnessResult) => void>();
      stubApi({
        readTranscript: async () => COLD,
        checkTranscriptFreshness: (id) => new Promise((resolve) => verdicts.set(id, resolve)),
      });
      const { result, rerender } = renderHook(({ id }) => useTranscript(id), {
        initialProps: { id: "a" },
      });
      await waitFor(() => expect(verdicts.has("a")).toBe(true));
      rerender({ id: "b" });
      await waitFor(() => expect(verdicts.has("b")).toBe(true));

      await act(async () => verdicts.get("a")!({ verdict: "stale", autoRetranscribe: true }));
      expect(result.current.freshness).toBe("checking");
      expect(result.current.autoRetranscribe).toBe(false);
    });
  });

  it("treats a rejected read as none", async () => {
    stubApi({
      readTranscript: async () => {
        throw new Error("ipc down");
      },
    });
    const { result } = renderHook(() => useTranscript("a"));

    await waitFor(() => expect(result.current.state).toBe("none"));
  });

  it("keeps the newer read's answer when an older read of the same item lands after it", async () => {
    const resolvers: Array<(r: TranscriptReadResult) => void> = [];
    const readTranscript = vi.fn(
      () => new Promise<TranscriptReadResult>((resolve) => resolvers.push(resolve)),
    );
    stubApi({ readTranscript });
    const { result } = renderHook(() => useTranscript("a"));
    await waitFor(() => expect(resolvers).toHaveLength(1));

    let refreshed: Promise<void> = Promise.resolve();
    act(() => {
      refreshed = result.current.refresh();
    });
    await waitFor(() => expect(resolvers).toHaveLength(2));

    await act(async () => {
      resolvers[1](READY);
      await refreshed;
    });
    expect(result.current.state).toBe("ready");

    await act(async () => {
      resolvers[0]({ status: "none" });
    });
    expect(result.current.state).toBe("ready");
  });

  it("does not read without an item id", async () => {
    const readTranscript = vi.fn(async (): Promise<TranscriptReadResult> => READY);
    stubApi({ readTranscript });
    const { result } = renderHook(() => useTranscript(null));

    await act(async () => {});
    expect(readTranscript).not.toHaveBeenCalled();
    expect(result.current.state).toBe("none");
  });

  it("refresh re-reads the file", async () => {
    const readTranscript = vi
      .fn<(id: string) => Promise<TranscriptReadResult>>()
      .mockResolvedValueOnce({ status: "none" })
      .mockResolvedValue(READY);
    stubApi({ readTranscript });
    const { result } = renderHook(() => useTranscript("a"));
    await waitFor(() => expect(result.current.state).toBe("none"));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.state).toBe("ready");
  });

  it("re-reads when a job for that item finishes with done, and not for another item", async () => {
    const readTranscript = vi
      .fn<(id: string) => Promise<TranscriptReadResult>>()
      .mockResolvedValueOnce({ status: "none" })
      .mockResolvedValue(READY);
    stubApi({ readTranscript });
    const { result } = renderHook(() => useTranscript("a"));
    await waitFor(() => expect(result.current.state).toBe("none"));

    const done = (id: string): TranscriptionJobProgress => ({
      jobId: "j",
      id,
      phase: "done",
      segmentsDone: 1,
      segmentsTotal: 1,
    });
    vi.mocked(runTranscriptionJob).mockResolvedValueOnce({
      status: "finished",
      progress: done("b"),
    });
    await act(async () => {
      await startTranscription({
        itemId: "b",
        assetId: "x",
        modelId: "m",
        mediaUrl: "u",
        durationMs: 1,
      });
    });
    expect(readTranscript).toHaveBeenCalledTimes(1);

    vi.mocked(runTranscriptionJob).mockResolvedValueOnce({
      status: "finished",
      progress: done("a"),
    });
    await act(async () => {
      await startTranscription({
        itemId: "a",
        assetId: "x",
        modelId: "m",
        mediaUrl: "u",
        durationMs: 1,
      });
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(readTranscript).toHaveBeenCalledTimes(2);
  });

  it("drops an answer that lands after the id changed", async () => {
    const pending = new Map<string, (result: TranscriptReadResult) => void>();
    stubApi({
      readTranscript: (id) => new Promise((resolve) => pending.set(id, resolve)),
    });
    const { result, rerender } = renderHook(({ id }) => useTranscript(id), {
      initialProps: { id: "a" },
    });
    rerender({ id: "b" });
    expect(result.current.state).toBe("loading");

    await act(async () => {
      pending.get("a")?.(READY);
    });
    expect(result.current.state).toBe("loading");
    expect(result.current.transcript).toBeNull();

    await act(async () => {
      pending.get("b")?.({ status: "invalid" });
    });
    expect(result.current.state).toBe("invalid");
  });
});
