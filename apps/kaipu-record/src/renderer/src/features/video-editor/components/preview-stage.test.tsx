import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import type { PreviewPlayback } from "../use-preview-playback";
import { PreviewStage } from "./preview-stage";
import { previewBackgroundStyle } from "./preview-background";

/** Only the members PreviewStage wires to the <video> element. */
function stubPlayback(): PreviewPlayback {
  return {
    videoRef: { current: null },
    onVideoTimeUpdate: vi.fn(),
    onVideoEnded: vi.fn(),
    onVideoPlay: vi.fn(),
    onVideoPause: vi.fn(),
    onVideoLoadedMetadata: vi.fn(),
    toggle: vi.fn(),
  } as unknown as PreviewPlayback;
}

describe("PreviewStage — onFrameSize", () => {
  it("reports the decoded frame size once metadata lands", () => {
    const onFrameSize = vi.fn();
    const { container } = render(
      <PreviewStage playback={stubPlayback()} mediaUrl="blob:x" onFrameSize={onFrameSize} />,
    );
    const video = container.querySelector("video")!;

    // jsdom decodes nothing, so the size has to be stubbed onto the element the event
    // reports through — the same approach video-editor-page.test.tsx uses.
    Object.defineProperty(video, "videoWidth", { configurable: true, get: () => 2560 });
    Object.defineProperty(video, "videoHeight", { configurable: true, get: () => 1440 });
    fireEvent.loadedMetadata(video);

    expect(onFrameSize).toHaveBeenCalledWith({ width: 2560, height: 1440 });
  });

  it("stays silent while the size is still 0 — a 0 would read as a known-small source", () => {
    const onFrameSize = vi.fn();
    const { container } = render(
      <PreviewStage playback={stubPlayback()} mediaUrl="blob:x" onFrameSize={onFrameSize} />,
    );
    fireEvent.loadedMetadata(container.querySelector("video")!);
    expect(onFrameSize).not.toHaveBeenCalled();
  });

  it("does not require the callback", () => {
    const { container } = render(<PreviewStage playback={stubPlayback()} mediaUrl="blob:x" />);
    expect(() => fireEvent.loadedMetadata(container.querySelector("video")!)).not.toThrow();
  });
});

describe("PreviewStage — playback speed", () => {
  it("tells the playback hook when metadata lands, so a new src gets the chosen rate again", () => {
    const playback = stubPlayback();
    const { container } = render(<PreviewStage playback={playback} mediaUrl="blob:x" />);
    // The decoded size is still 0 here: the rate must be re-applied regardless of it.
    fireEvent.loadedMetadata(container.querySelector("video")!);
    expect(playback.onVideoLoadedMetadata).toHaveBeenCalledOnce();
  });
});

describe("PreviewStage — background (NIW2-668)", () => {
  const MAGENTA = { bg: "magenta", padding: 48, radius: 16, shadow: 24 } as const;

  /** The frame measures itself with clientWidth/Height; jsdom has no layout, so stub them. */
  function stageSize(width: number, height: number): void {
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(width);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(height);
  }
  afterEach(() => vi.restoreAllMocks());

  const frameOf = (c: HTMLElement) =>
    c.querySelector<HTMLElement>('[data-testid="preview-frame"]')!;
  const pictureOf = (c: HTMLElement) =>
    c.querySelector<HTMLElement>('[data-testid="preview-picture"]')!;

  it("draws no background with none: no paint on the frame, nothing on the picture", () => {
    stageSize(960, 540);
    const { container } = render(
      <PreviewStage
        playback={stubPlayback()}
        mediaUrl="blob:x"
        background={{ bg: "none", padding: 48, radius: 16, shadow: 24 }}
      />,
    );
    expect(frameOf(container).style.getPropertyValue("--frame-bg")).toBe("");
    expect(pictureOf(container).style.left).toBe("");
    expect(pictureOf(container).style.width).toBe("");
    expect(pictureOf(container).style.borderRadius).toBe("");
  });

  it("draws no background when none is given", () => {
    stageSize(960, 540);
    const { container } = render(<PreviewStage playback={stubPlayback()} mediaUrl="blob:x" />);
    expect(frameOf(container).style.getPropertyValue("--frame-bg")).toBe("");
    expect(pictureOf(container).style.left).toBe("");
  });

  it("paints the frame and insets the picture with exactly backgroundFrame's numbers", () => {
    stageSize(960, 540);
    const { container } = render(
      <PreviewStage playback={stubPlayback()} mediaUrl="blob:x" background={MAGENTA} />,
    );
    const expected = previewBackgroundStyle(MAGENTA, 960, 540);
    const frame = frameOf(container);
    const picture = pictureOf(container);
    expect(frame.style.getPropertyValue("--frame-bg")).toBe(
      "linear-gradient(135deg, #ff2d6e, #a3044a)",
    );
    for (const key of ["left", "top", "width", "height", "borderRadius"] as const) {
      expect(parseFloat(picture.style[key])).toBeCloseTo(
        parseFloat(String(expected.picture[key])),
        6,
      );
    }
    expect(picture.style.boxShadow).toBe(expected.picture.boxShadow);
    // 48 px at 1080 → 24 px at a 540-high stage; the picture keeps 16:9.
    expect(parseFloat(picture.style.top)).toBeCloseTo(24, 6);
    expect(parseFloat(picture.style.width) / parseFloat(picture.style.height)).toBeCloseTo(
      16 / 9,
      6,
    );
  });

  it("keeps the picture in step with the stage when it is resized", () => {
    // The stage re-reads its size when the browser says it changed (fullscreen, a window
    // resize, the timeline growing): capture the observer and fire it.
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      },
    );
    stageSize(960, 540);
    const { container } = render(
      <PreviewStage playback={stubPlayback()} mediaUrl="blob:x" background={MAGENTA} />,
    );
    expect(parseFloat(pictureOf(container).style.top)).toBeCloseTo(24, 6);
    expect(parseFloat(pictureOf(container).style.width)).toBeCloseTo((492 * 16) / 9, 6);

    vi.restoreAllMocks();
    stageSize(480, 270);
    act(() => observers.forEach((notify) => notify()));
    // The same 48 px at 1080 is 12 px at 270, and the picture shrinks with the stage.
    expect(parseFloat(pictureOf(container).style.top)).toBeCloseTo(12, 6);
    expect(parseFloat(pictureOf(container).style.width)).toBeCloseTo((246 * 16) / 9, 6);
    vi.unstubAllGlobals();
  });

  it("keeps everything of the footage inside the picture: video, annotations, privacy regions, cursor, webcam and chrome", () => {
    stageSize(960, 540);
    const { container } = render(
      <PreviewStage
        playback={stubPlayback()}
        mediaUrl="blob:x"
        background={MAGENTA}
        overlay={<i data-testid="overlay" />}
        underlay={<i data-testid="underlay" />}
        cursor={<i data-testid="cursor" />}
        webcam={<i data-testid="webcam" />}
        chrome={<i data-testid="chrome" />}
      />,
    );
    const picture = pictureOf(container);
    for (const id of ["overlay", "underlay", "cursor", "webcam", "chrome"]) {
      expect(picture.contains(container.querySelector(`[data-testid="${id}"]`))).toBe(true);
    }
    expect(picture.contains(container.querySelector("video"))).toBe(true);
    // The zoom transform lands on the content layer, which is inside the picture: a zoom
    // is clipped by the picture and never reaches the padding.
    expect(picture.contains(container.querySelector('[data-testid="preview-content"]'))).toBe(true);
    expect(frameOf(container).contains(picture)).toBe(true);
  });

  it("hands the camera transform's ref to the content layer, inside the picture", () => {
    stageSize(960, 540);
    const contentRef = { current: null as HTMLDivElement | null };
    const { container } = render(
      <PreviewStage
        playback={stubPlayback()}
        mediaUrl="blob:x"
        background={MAGENTA}
        contentRef={contentRef}
      />,
    );
    expect(contentRef.current).toBe(container.querySelector('[data-testid="preview-content"]'));
  });

  it("does not remount the video when the background changes (playback must not restart)", () => {
    stageSize(960, 540);
    const playback = stubPlayback();
    const { container, rerender } = render(<PreviewStage playback={playback} mediaUrl="blob:x" />);
    const video = container.querySelector("video");
    rerender(<PreviewStage playback={playback} mediaUrl="blob:x" background={MAGENTA} />);
    expect(container.querySelector("video")).toBe(video);
    rerender(<PreviewStage playback={playback} mediaUrl="blob:x" />);
    expect(container.querySelector("video")).toBe(video);
  });
});

describe("PreviewStage — media slot (NIW2-771)", () => {
  it("draws floating images in the picture, outside the zoomed content layer and before the webcam", () => {
    const { getByTestId } = render(
      <PreviewStage
        playback={stubPlayback()}
        mediaUrl="blob:x"
        cursor={<i data-testid="cursor" />}
        media={<i data-testid="media" />}
        webcam={<i data-testid="webcam" />}
      />,
    );
    const media = getByTestId("media");
    expect(getByTestId("preview-content").contains(media)).toBe(false);
    expect(getByTestId("preview-picture").contains(media)).toBe(true);
    const order = [...getByTestId("preview-picture").children].map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(order.indexOf("cursor")).toBeLessThan(order.indexOf("media"));
    expect(order.indexOf("media")).toBeLessThan(order.indexOf("webcam"));
  });
});

describe("PreviewStage — joined recordings (ADR 0058)", () => {
  // The opened recording sits at axis [0, 100]; joined B at [3600, 3640]; joined M is missing at [7200, 7210].
  const axis = {
    recordings: [
      { sourceId: null, offset: 0, duration: 100 },
      { sourceId: "B", offset: 3600, duration: 40 },
      { sourceId: "M", offset: 7200, duration: 10 },
    ],
  };
  const recordings = [
    { sourceId: "B", title: "Standup", mediaUrl: "blob:b", missing: false },
    { sourceId: "M", title: "Old demo", mediaUrl: null, missing: true },
    { sourceId: "L", title: "Still loading", mediaUrl: null, missing: false },
  ];
  const videosOf = (c: HTMLElement) => Array.from(c.querySelectorAll("video"));
  const frameOf = (c: HTMLElement) =>
    c.querySelector<HTMLElement>('[data-testid="preview-frame"]')!;

  function setup(extra: Partial<React.ComponentProps<typeof PreviewStage>> = {}) {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const playback = stubPlayback();
    const view = render(
      <PreviewStage
        playback={playback}
        mediaUrl="blob:a"
        axis={axis}
        recordings={recordings}
        {...extra}
      />,
    );
    return { playback, ...view };
  }
  afterEach(() => vi.restoreAllMocks());

  it("renders one video per recording that has a file, and none for a missing or loading one", () => {
    const { container } = setup();
    const srcs = videosOf(container).map((v) => v.getAttribute("src"));
    expect(srcs).toEqual(["blob:a", "blob:b"]);
  });

  it("publishes one media switch as the playback's video", () => {
    const { playback } = setup();
    const media = playback.videoRef.current!;
    expect(media).not.toBeNull();
    expect(media.activeElement?.()).toBe(document.querySelector('video[src="blob:a"]'));
  });

  it("shows only the video of the recording the playhead is in", () => {
    const { container, playback } = setup();
    const [a, b] = videosOf(container);
    act(() => {
      playback.videoRef.current!.currentTime = 3605;
    });
    // The old frame stays up until the new recording has one to show, so a seek never flashes,
    // and a canvas sampling "the element on screen" keeps reading that old picture.
    expect(playback.videoRef.current!.activeElement?.()).toBe(a);
    expect(a!.style.visibility).toBe("visible");
    fireEvent(b!, new Event("seeked"));
    expect(playback.videoRef.current!.activeElement?.()).toBe(b);
    expect(b!.style.visibility).toBe("visible");
    expect(a!.style.visibility).toBe("hidden");
    act(() => {
      playback.videoRef.current!.currentTime = 20;
    });
    fireEvent(a!, new Event("seeked"));
    expect(a!.style.visibility).toBe("visible");
    expect(b!.style.visibility).toBe("hidden");
  });

  it("keeps the frame's ratio and the reported size the opened recording's", () => {
    const onFrameSize = vi.fn();
    const { container } = setup({ onFrameSize });
    const [a, b] = videosOf(container);
    const size = (v: HTMLVideoElement, w: number, h: number) => {
      Object.defineProperty(v, "videoWidth", { configurable: true, get: () => w });
      Object.defineProperty(v, "videoHeight", { configurable: true, get: () => h });
    };
    size(a!, 1920, 1080);
    fireEvent.loadedMetadata(a!);
    size(b!, 1080, 1920); // a portrait recording joined to a landscape one
    fireEvent.loadedMetadata(b!);
    expect(onFrameSize).toHaveBeenCalledTimes(1);
    expect(onFrameSize).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    expect(frameOf(container).style.getPropertyValue("--frame-ratio")).toBe(String(1920 / 1080));
  });

  it("re-applies the chosen speed when any recording's metadata lands", () => {
    const { container, playback } = setup();
    fireEvent.loadedMetadata(videosOf(container)[1]!);
    expect(playback.onVideoLoadedMetadata).toHaveBeenCalledOnce();
  });

  it("lets only the video on screen drive the transport", () => {
    const { container, playback } = setup();
    const [a, b] = videosOf(container);
    fireEvent.pause(b!); // the standby: paused and primed, not the picture
    fireEvent.timeUpdate(b!);
    fireEvent.ended(b!);
    expect(playback.onVideoPause).not.toHaveBeenCalled();
    expect(playback.onVideoTimeUpdate).not.toHaveBeenCalled();
    expect(playback.onVideoEnded).not.toHaveBeenCalled();
    fireEvent.pause(a!);
    fireEvent.timeUpdate(a!);
    expect(playback.onVideoPause).toHaveBeenCalledOnce();
    expect(playback.onVideoTimeUpdate).toHaveBeenCalledOnce();
  });

  it("says which recording is missing while the playhead is on its clip, and not before or after", () => {
    const { playback, queryByTestId } = setup();
    expect(queryByTestId("preview-missing")).toBeNull();
    act(() => {
      playback.videoRef.current!.currentTime = 7203;
    });
    const notice = queryByTestId("preview-missing")!;
    expect(notice.textContent).toContain("Old demo");
    expect(notice.getAttribute("role")).toBe("status");
    act(() => {
      playback.videoRef.current!.currentTime = 20;
    });
    expect(queryByTestId("preview-missing")).toBeNull();
  });

  it("does not show the missing notice for a recording that is only loading", () => {
    const { playback, queryByTestId } = setup({
      axis: { recordings: [...axis.recordings, { sourceId: "L", offset: 9000, duration: 10 }] },
    });
    act(() => {
      playback.videoRef.current!.currentTime = 9003;
    });
    expect(queryByTestId("preview-missing")).toBeNull();
  });

  it("puts a slide over the missing notice", () => {
    const { playback, queryByTestId, rerender } = setup();
    act(() => {
      playback.videoRef.current!.currentTime = 7203;
    });
    expect(queryByTestId("preview-missing")).not.toBeNull();
    rerender(
      <PreviewStage
        playback={playback}
        mediaUrl="blob:a"
        axis={axis}
        recordings={recordings}
        slideUrl="blob:slide"
      />,
    );
    expect(queryByTestId("preview-missing")).toBeNull();
  });

  it("keeps every recording's video inside the picture, over the frame's background", () => {
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(960);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(540);
    const { container } = setup({
      background: { bg: "magenta", padding: 48, radius: 16, shadow: 24 },
    });
    const picture = container.querySelector('[data-testid="preview-picture"]')!;
    expect(videosOf(container).every((v) => picture.contains(v))).toBe(true);
    expect(frameOf(container).style.getPropertyValue("--frame-bg")).toBe(
      "linear-gradient(135deg, #ff2d6e, #a3044a)",
    );
  });

  it("drops a recording's video from the switch when its file goes away", () => {
    const { container, playback, rerender } = setup();
    expect(videosOf(container)).toHaveLength(2);
    rerender(
      <PreviewStage
        playback={playback}
        mediaUrl="blob:a"
        axis={axis}
        recordings={[{ ...recordings[0]!, mediaUrl: null, missing: true }]}
      />,
    );
    expect(videosOf(container)).toHaveLength(1);
    act(() => {
      playback.videoRef.current!.currentTime = 3605;
    });
    expect(playback.videoRef.current!.activeElement?.()).toBeNull();
  });
});
