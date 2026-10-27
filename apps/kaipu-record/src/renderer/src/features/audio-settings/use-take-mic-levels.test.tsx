import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook } from "@testing-library/react";
import { useTakeMicLevels } from "./use-take-mic-levels";

const original = { ...window.electronAPI };
afterEach(() => {
  Object.assign(window.electronAPI, original);
});

function stubSubscription() {
  const unsubscribe = vi.fn();
  let push: (levels: number[]) => void = () => {};
  const subscribe = vi.fn((callback: (levels: number[]) => void) => {
    push = callback;
    return unsubscribe;
  });
  window.electronAPI.subscribeMicLevels = subscribe;
  return { subscribe, unsubscribe, push: (levels: number[]) => push(levels) };
}

describe("useTakeMicLevels", () => {
  it("does not subscribe while inactive", () => {
    const { subscribe } = stubSubscription();
    const { result } = renderHook(() => useTakeMicLevels(false));
    expect(subscribe).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });

  it("subscribes while active, exposes the latest bars and unsubscribes when inactive", () => {
    const { subscribe, unsubscribe, push } = stubSubscription();
    const { result, rerender } = renderHook(({ active }) => useTakeMicLevels(active), {
      initialProps: { active: true },
    });
    expect(subscribe).toHaveBeenCalledOnce();
    act(() => push([0.1, 0.2, 0.3, 0.4, 0.5]));
    expect(result.current).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    rerender({ active: false });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(result.current).toBeUndefined();
  });

  it("unsubscribes on unmount", () => {
    const { unsubscribe } = stubSubscription();
    const { unmount } = renderHook(() => useTakeMicLevels(true));
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("lets go while the window is not focused", () => {
    const { subscribe, unsubscribe } = stubSubscription();
    renderHook(() => useTakeMicLevels(true));
    act(() => {
      fireEvent.blur(window);
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
    act(() => {
      fireEvent.focus(window);
    });
    expect(subscribe).toHaveBeenCalledTimes(2);
  });
});
