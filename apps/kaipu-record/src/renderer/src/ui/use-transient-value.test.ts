import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTransientValue } from "./use-transient-value";

afterEach(() => vi.useRealTimers());

describe("useTransientValue", () => {
  it("shows a value then auto-clears after the timeout", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTransientValue<string>(1000));
    expect(result.current[0]).toBeNull();

    act(() => result.current[1]("done"));
    expect(result.current[0]).toBe("done");

    act(() => vi.advanceTimersByTime(999));
    expect(result.current[0]).toBe("done");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current[0]).toBeNull();
  });

  it("a second show resets the timer (no early clear)", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTransientValue<string>(1000));
    act(() => result.current[1]("a"));
    act(() => vi.advanceTimersByTime(800));
    act(() => result.current[1]("b")); // restarts the 1000ms window
    act(() => vi.advanceTimersByTime(800));
    expect(result.current[0]).toBe("b"); // would be null if the timer hadn't reset
    act(() => vi.advanceTimersByTime(200));
    expect(result.current[0]).toBeNull();
  });
});
