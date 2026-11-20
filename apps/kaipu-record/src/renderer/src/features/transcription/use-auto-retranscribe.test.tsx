import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StartOutcome } from "./transcription-job-store";
import { resetAutoRetranscribe, useAutoRetranscribe } from "./use-auto-retranscribe";

const started = (): Promise<StartOutcome | null> => Promise.resolve({ status: "done" });

beforeEach(() => {
  resetAutoRetranscribe();
});

describe("useAutoRetranscribe", () => {
  it("starts once when armed", () => {
    const start = vi.fn(started);
    renderHook(() => useAutoRetranscribe("a", true, start));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does nothing while it is not armed, then starts when it becomes armed", () => {
    const start = vi.fn(started);
    const { rerender } = renderHook(({ armed }) => useAutoRetranscribe("a", armed, start), {
      initialProps: { armed: false },
    });
    expect(start).not.toHaveBeenCalled();
    rerender({ armed: true });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("starts once per item even with two hook instances", () => {
    const start = vi.fn(started);
    renderHook(() => useAutoRetranscribe("a", true, start));
    renderHook(() => useAutoRetranscribe("a", true, start));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not start again after a cancel or a re-render", async () => {
    const start = vi.fn(() => Promise.resolve<StartOutcome | null>({ status: "cancelled" }));
    const { rerender } = renderHook(() => useAutoRetranscribe("a", true, start));
    await Promise.resolve();
    rerender();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("claims per item and content: new content starts again, the same content does not", async () => {
    const start = vi.fn(started);
    const { rerender } = renderHook(({ key }) => useAutoRetranscribe(key, true, start), {
      initialProps: { key: "a:hash-1" },
    });
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(1);
    // The same content again (a re-render, a second mount): no second start.
    rerender({ key: "a:hash-1" });
    renderHook(() => useAutoRetranscribe("a:hash-1", true, start));
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(1);
    // The recording changed again after the first re-transcribe: a new attempt.
    rerender({ key: "a:hash-2" });
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("tracks each item on its own", () => {
    const start = vi.fn(started);
    renderHook(() => useAutoRetranscribe("a", true, start));
    renderHook(() => useAutoRetranscribe("b", true, start));
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("gives the claim back when nothing started, so the next time it is armed it can try", async () => {
    const start = vi
      .fn<() => Promise<StartOutcome | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "refused", reason: "busy" })
      .mockResolvedValue({ status: "done" });
    const { rerender } = renderHook(({ armed }) => useAutoRetranscribe("a", armed, start), {
      initialProps: { armed: true },
    });
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    for (const calls of [2, 3]) {
      rerender({ armed: false });
      rerender({ armed: true });
      await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(calls));
    }
    // The third attempt started a job, so the claim is kept.
    rerender({ armed: false });
    rerender({ armed: true });
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(3);
  });
});
