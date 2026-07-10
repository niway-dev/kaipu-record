import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useMissingRecordingRecovery,
  type MissingRecoveryParams,
} from "./use-missing-recording-recovery";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigateMock }));

const captureEventMock = vi.fn();
vi.mock("@renderer/features/analytics", () => ({
  captureEvent: (...args: unknown[]) => captureEventMock(...args),
}));

type Props = Omit<MissingRecoveryParams, "refresh">;

function setup(initial: Props) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const { result, rerender } = renderHook(
    (props: Props) => useMissingRecordingRecovery({ ...props, refresh }),
    { initialProps: initial },
  );
  return { result, rerender: (p: Props) => rerender(p), refresh };
}

const loaded = (over: Partial<Props> = {}): Props => ({
  id: "r1",
  found: false,
  isLoading: false,
  listSize: 2,
  fromRecording: true,
  ...over,
});

describe("useMissingRecordingRecovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does nothing while the list is still loading", () => {
    const { result, refresh } = setup(loaded({ isLoading: true }));
    expect(result.current.recovering).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(refresh).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("does nothing when the recording is present", () => {
    const { result, refresh } = setup(loaded({ found: true }));
    expect(result.current.recovering).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(refresh).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(captureEventMock).not.toHaveBeenCalled();
  });

  it("re-lists once when the recording is missing, keeping the loader up", () => {
    const { result, refresh } = setup(loaded());
    expect(result.current.recovering).toBe(true); // loader, not "File not found"
    act(() => vi.advanceTimersByTime(500));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("stops recovering when the retry surfaces the recording", () => {
    const { result, rerender, refresh } = setup(loaded());
    act(() => vi.advanceTimersByTime(500));
    expect(refresh).toHaveBeenCalledTimes(1);
    // The re-list finds it (loading → loaded with the item present).
    act(() => rerender(loaded({ isLoading: true })));
    act(() => rerender(loaded({ found: true, listSize: 3 })));
    expect(result.current.recovering).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(captureEventMock).not.toHaveBeenCalled();
  });

  it("logs the miss and falls back to the Library when still missing after retry", () => {
    const { rerender } = setup(loaded());
    act(() => vi.advanceTimersByTime(500));
    // The re-list settles and the id is *still* absent.
    act(() => rerender(loaded({ isLoading: true })));
    act(() => rerender(loaded()));
    expect(captureEventMock).toHaveBeenCalledWith("library-detail-missing", {
      id: "r1",
      listSize: 2,
      fromRecording: true,
    });
    expect(navigateMock).toHaveBeenCalledWith("/library", { replace: true });
  });

  it("re-arms recovery after the id changes", () => {
    const { rerender, refresh } = setup(loaded());
    act(() => vi.advanceTimersByTime(500));
    act(() => rerender(loaded({ isLoading: true })));
    act(() => rerender(loaded()));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    navigateMock.mockClear();
    // Navigating to a different, also-missing recording recovers from scratch.
    act(() => rerender(loaded({ id: "r2" })));
    act(() => vi.advanceTimersByTime(500));
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => rerender(loaded({ id: "r2", isLoading: true })));
    act(() => rerender(loaded({ id: "r2" })));
    expect(navigateMock).toHaveBeenCalledWith("/library", { replace: true });
  });
});
