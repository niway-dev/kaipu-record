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
