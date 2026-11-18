import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { pictureBox, RecordingPlayer, type PlayerHandle } from "./recording-player";

function video(container: HTMLElement): HTMLVideoElement {
  return container.querySelector("video")!;
}

/** jsdom has no media pipeline: set what the element would report, then fire its event. */
function at(element: HTMLVideoElement, time: number): void {
  element.currentTime = time;
  fireEvent.timeUpdate(element);
}

describe("RecordingPlayer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("serves the id through the media protocol", () => {
    const { container } = render(<RecordingPlayer id="Sprint demo" />);
    expect(video(container).getAttribute("src")).toBe("kaipu-media://recording/Sprint%20demo");
  });

  it("restores the playback position after the id changes (a rename moved the file)", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { container, rerender } = render(<RecordingPlayer id="old" />);
    fireEvent.play(video(container));
    at(video(container), 42);

    rerender(<RecordingPlayer id="New name" />);
    // The reload's own events must not overwrite the saved position.
    at(video(container), 0);
    fireEvent.loadedMetadata(video(container));

    expect(video(container).getAttribute("src")).toBe("kaipu-media://recording/New%20name");
    expect(video(container).currentTime).toBe(42);
    expect(pause).not.toHaveBeenCalled();
  });

  it("keeps a paused video paused across the id change", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { container, rerender } = render(<RecordingPlayer id="old" />);
    at(video(container), 7);
    fireEvent.pause(video(container));

    rerender(<RecordingPlayer id="new" />);
    fireEvent.play(video(container)); // autoplay on the new source
    fireEvent.loadedMetadata(video(container));

    expect(video(container).currentTime).toBe(7);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("does not seek on the first load", () => {
    const { container } = render(<RecordingPlayer id="clip" />);
    at(video(container), 3);
    fireEvent.loadedMetadata(video(container));
    expect(video(container).currentTime).toBe(3);
  });

  it("opens paused at startAt, once", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { container } = render(<RecordingPlayer id="clip" startAt={33.4} />);
    fireEvent.loadedMetadata(video(container));
    expect(video(container).currentTime).toBe(33.4);
    expect(pause).toHaveBeenCalledTimes(1);

    at(video(container), 50);
    fireEvent.loadedMetadata(video(container));
    expect(video(container).currentTime).toBe(50);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("neither seeks nor pauses without startAt", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { container } = render(<RecordingPlayer id="clip" />);
    fireEvent.loadedMetadata(video(container));
    expect(video(container).currentTime).toBe(0);
    expect(pause).not.toHaveBeenCalled();
  });
});

describe("RecordingPlayer handle", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  const cancelled = vi.fn();

  beforeEach(() => {
    frames = new Map();
    nextFrame = 1;
    cancelled.mockClear();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      cancelled(id);
      frames.delete(id);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Run the next pending frame, as the browser would. */
  function tick(): void {
    const [id, callback] = [...frames.entries()][0] ?? [];
    if (id === undefined || !callback) return;
    frames.delete(id);
    callback(0);
  }

  function mount(onHandle: (handle: PlayerHandle | null) => void = () => {}) {
    const view = render(<RecordingPlayer id="clip" onHandle={onHandle} />);
    return { ...view, el: video(view.container) };
  }

  it("hands the handle out on mount and null on unmount", () => {
    const onHandle = vi.fn();
    const { unmount } = mount(onHandle);
    expect(onHandle).toHaveBeenLastCalledWith(
      expect.objectContaining({
        seek: expect.any(Function),
        readTime: expect.any(Function),
        subscribeTime: expect.any(Function),
      }),
    );
    unmount();
    expect(onHandle).toHaveBeenLastCalledWith(null);
  });

  it("reads the element's own clock and seeks it", () => {
    let handle: PlayerHandle | null = null;
    const { el } = mount((h) => (handle = h));
    el.currentTime = 12.5;
    expect(handle!.readTime()).toBe(12.5);
    handle!.seek(30);
    expect(el.currentTime).toBe(30);
  });

  it("notifies listeners with the new time when the player seeks while paused", () => {
    let handle: PlayerHandle | null = null;
    const { el } = mount((h) => (handle = h));
    const listener = vi.fn();
    handle!.subscribeTime(listener);
    el.currentTime = 8.5;
    fireEvent.seeked(el);
    expect(listener).toHaveBeenLastCalledWith(8.5);
    handle!.seek(2);
    expect(listener).toHaveBeenLastCalledWith(2);
  });

  it("runs the frame loop only while playing, feeding listeners the current time", () => {
    let handle: PlayerHandle | null = null;
    const { el } = mount((h) => (handle = h));
    const listener = vi.fn();
    handle!.subscribeTime(listener);
    expect(frames.size).toBe(0);

    fireEvent.play(el);
    expect(frames.size).toBe(1);
    el.currentTime = 1.5;
    tick();
    expect(listener).toHaveBeenLastCalledWith(1.5);
    expect(frames.size).toBe(1);

    fireEvent.pause(el);
    expect(frames.size).toBe(0);
    const calls = listener.mock.calls.length;
    tick();
    expect(listener.mock.calls.length).toBe(calls);
  });

  it("stops the loop when the video ends", () => {
    let handle: PlayerHandle | null = null;
    const { el } = mount((h) => (handle = h));
    handle!.subscribeTime(() => {});
    fireEvent.play(el);
    expect(frames.size).toBe(1);
    fireEvent.ended(el);
    expect(frames.size).toBe(0);
  });

  it("stops listeners after unsubscribe, and the loop and listeners after unmount", () => {
    let handle: PlayerHandle | null = null;
    const { el, unmount } = mount((h) => (handle = h));
    const kept = vi.fn();
    const dropped = vi.fn();
    const unsubscribe = handle!.subscribeTime(dropped);
    handle!.subscribeTime(kept);
    fireEvent.play(el);
    unsubscribe();
    tick();
    expect(dropped).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalled();

    const before = kept.mock.calls.length;
    unmount();
    expect(frames.size).toBe(0);
    expect(cancelled).toHaveBeenCalled();
    expect(kept.mock.calls.length).toBe(before);
  });

  it("runs no loop without listeners, starts when one arrives mid-play and stops with the last", () => {
    let handle: PlayerHandle | null = null;
    const { el } = mount((h) => (handle = h));
    fireEvent.play(el);
    expect(frames.size).toBe(0);
    const first = handle!.subscribeTime(() => {});
    const second = handle!.subscribeTime(() => {});
    expect(frames.size).toBe(1);
    first();
    expect(frames.size).toBe(1);
    second();
    expect(frames.size).toBe(0);
  });

  it("schedules no further frame when the last listener unsubscribes from inside its own call", () => {
    let handle: PlayerHandle | null = null;
    const { el } = mount((h) => (handle = h));
    fireEvent.play(el);
    let unsubscribe = (): void => {};
    const listener = vi.fn(() => unsubscribe());
    unsubscribe = handle!.subscribeTime(listener);
    expect(frames.size).toBe(1);
    tick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it("keeps the loop going for a listener that subscribes from inside another's call", () => {
    let handle: PlayerHandle | null = null;
    const { el } = mount((h) => (handle = h));
    fireEvent.play(el);
    const late = vi.fn();
    let first = (): void => {};
    first = handle!.subscribeTime(() => {
      first();
      handle!.subscribeTime(late);
    });
    tick();
    expect(frames.size).toBe(1);
    tick();
    expect(late).toHaveBeenCalled();
    expect(frames.size).toBe(1);
  });

  it("behaves as before for a caller that passes no handle prop", () => {
    const { container } = render(<RecordingPlayer id="clip" />);
    const el = video(container);
    expect(() => {
      fireEvent.play(el);
      tick();
      fireEvent.pause(el);
      fireEvent.seeked(el);
    }).not.toThrow();
  });
});

describe("pictureBox", () => {
  it("fills the 16:9 player with a 16:9 picture", () => {
    expect(pictureBox({ width: 1920, height: 1080 })).toEqual({ width: "100%", height: "100%" });
  });

  it("pillarboxes a taller picture: full height, narrower width", () => {
    expect(pictureBox({ width: 1080, height: 1080 })).toEqual({
      width: "56.25%",
      height: "100%",
    });
  });

  it("letterboxes a wider picture: full width, shorter height", () => {
    const box = pictureBox({ width: 3200, height: 900 });
    expect(box.width).toBe("100%");
    expect(parseFloat(box.height)).toBeCloseTo(50, 5);
  });
});
