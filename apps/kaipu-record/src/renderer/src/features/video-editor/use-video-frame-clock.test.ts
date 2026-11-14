import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MediaSwitch } from "./media-switch";
import { asElement, FakeVideo, joinedSource } from "./media-switch.fixture";
import { sourceAxis } from "./source-axis";
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

describe("useVideoFrameClock over a MediaSwitch (two recordings, ADR 0058)", () => {
  function twoRecordings() {
    const sw = new MediaSwitch({ now: () => 0 });
    sw.setAxis(sourceAxis(100, [joinedSource("B", 3600, 40)]));
    const a = new FakeVideo();
    const b = new FakeVideo();
    sw.attach(null, asElement(a));
    sw.attach("B", asElement(b));
    return { sw, a, b };
  }

  it("gives consumers the active element's media time plus its offset", () => {
    const { sw, a, b } = twoRecordings();
    const onTime = vi.fn();
    renderHook(() => useVideoFrameClock({ current: sw }, onTime));
    a.presentFrame(12);
    expect(onTime).toHaveBeenLastCalledWith(12);
    sw.currentTime = 3610;
    b.presentFrame(10.5);
    expect(onTime).toHaveBeenLastCalledWith(3610.5);
  });

  it("re-applies at once on a switch, even on a paused preview with no frame or seek", () => {
    const { sw } = twoRecordings();
    const onTime = vi.fn();
    renderHook(() => useVideoFrameClock({ current: sw }, onTime));
    onTime.mockClear();
    sw.currentTime = 3620;
    expect(onTime).toHaveBeenCalledTimes(1);
    expect(onTime.mock.calls[0][0]).toBeCloseTo(3620, 9);
  });

  it("drops the frames of the element that is not on screen", () => {
    const { sw, b } = twoRecordings();
    const onTime = vi.fn();
    renderHook(() => useVideoFrameClock({ current: sw }, onTime));
    onTime.mockClear();
    b.presentFrame(4); // a primed standby presents its first frame
    expect(onTime).not.toHaveBeenCalled();
  });

  it("keeps the frame loop running across a switch and stops it on unmount", () => {
    const { sw, a, b } = twoRecordings();
    const onTime = vi.fn();
    const { unmount } = renderHook(() => useVideoFrameClock({ current: sw }, onTime));
    a.presentFrame(9.9);
    sw.currentTime = 3600;
    b.presentFrame(0.04);
    expect(onTime).toHaveBeenLastCalledWith(3600.04);
    b.presentFrame(0.08);
    expect(onTime).toHaveBeenLastCalledWith(3600.08);
    unmount();
    expect(a.pendingFrames).toBe(0);
    expect(b.pendingFrames).toBe(0);
  });
});

describe("useVideoFrameClock while a switch of recording is pending", () => {
  function pending() {
    const sw = new MediaSwitch({ now: () => 0 });
    sw.setAxis(sourceAxis(100, [joinedSource("B", 3600, 40)]));
    const a = new FakeVideo();
    const b = new FakeVideo();
    sw.attach(null, asElement(a));
    sw.attach("B", asElement(b));
    a.currentTime = 10;
    b.readyState = 1;
    return { sw, a, b };
  }

  it("reports the frame on screen, not the requested time, until the new frame arrives", () => {
    const { sw, b } = pending();
    const onTime = vi.fn();
    renderHook(() => useVideoFrameClock({ current: sw }, onTime));
    onTime.mockClear();
    sw.currentTime = 3605; // paused on a redacted frame of A, seek into unprimed B
    expect(onTime).toHaveBeenCalled();
    expect(onTime.mock.calls.every(([t]) => t === 10)).toBe(true);
    onTime.mockClear();
    b.readyState = 4;
    b.emit("seeked");
    expect(onTime).toHaveBeenCalled();
    expect(onTime.mock.calls.at(-1)![0]).toBeCloseTo(3605, 9);
  });

  it("applies the presented time on a trigger change too", () => {
    const { sw } = pending();
    const onTime = vi.fn();
    const videoRef = { current: sw };
    const { rerender } = renderHook(({ t }) => useVideoFrameClock(videoRef, onTime, t), {
      initialProps: { t: {} },
    });
    sw.currentTime = 3605;
    onTime.mockClear();
    rerender({ t: {} });
    expect(onTime).toHaveBeenLastCalledWith(10);
  });
});
