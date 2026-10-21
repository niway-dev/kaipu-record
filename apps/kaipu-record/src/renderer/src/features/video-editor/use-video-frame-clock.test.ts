import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVideoFrameClock } from "./use-video-frame-clock";

describe("useVideoFrameClock (no rVFC, like jsdom)", () => {
  it("fires on mount and on seeked/timeupdate with the source time", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 0, writable: true });
    const onTime = vi.fn();
    const { unmount } = renderHook(() => useVideoFrameClock({ current: video }, onTime));
    expect(onTime).toHaveBeenLastCalledWith(0);
    video.currentTime = 4.2;
    video.dispatchEvent(new Event("seeked"));
    expect(onTime).toHaveBeenLastCalledWith(4.2);
    unmount();
    video.currentTime = 9;
    video.dispatchEvent(new Event("timeupdate"));
    expect(onTime).toHaveBeenLastCalledWith(4.2);
  });

  it("uses requestVideoFrameCallback media time when available", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 0, writable: true });
    let frame: VideoFrameRequestCallback | null = null;
    video.requestVideoFrameCallback = (cb) => {
      frame = cb;
      return 1;
    };
    video.cancelVideoFrameCallback = vi.fn();
    const onTime = vi.fn();
    renderHook(() => useVideoFrameClock({ current: video }, onTime));
    frame!(0, { mediaTime: 7.5 } as VideoFrameCallbackMetadata);
    expect(onTime).toHaveBeenLastCalledWith(7.5);
  });

  it("re-applies the callback on a new trigger without re-subscribing", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 3, writable: true });
    const request = vi.fn(() => 1);
    const cancel = vi.fn();
    video.requestVideoFrameCallback = request;
    video.cancelVideoFrameCallback = cancel;
    const onTime = vi.fn();
    // One ref object for the whole hook life, as in the app: `playback.videoRef` is a
    // useRef, so the subscription's [videoRef] dependency never changes. A fresh
    // `{ current: video }` per render would re-subscribe for that reason alone and say
    // nothing about `trigger`.
    const videoRef = { current: video };
    const { rerender } = renderHook(
      ({ trigger }) => useVideoFrameClock(videoRef, onTime, trigger),
      { initialProps: { trigger: {} } },
    );
    expect(request).toHaveBeenCalledTimes(1);
    // A live gesture produces a new trigger per pointermove. The rVFC loop must survive
    // it — tearing it down and re-requesting can drop the frame in between.
    rerender({ trigger: {} });
    rerender({ trigger: {} });
    expect(request).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    // Mount applies the callback from both effects (idempotent: it only writes the DOM),
    // then exactly one apply per trigger.
    expect(onTime).toHaveBeenCalledTimes(4);
    expect(onTime).toHaveBeenLastCalledWith(3);
  });
});
