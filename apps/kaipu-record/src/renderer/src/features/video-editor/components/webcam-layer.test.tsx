import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { buildCameraPath, type CameraPath } from "../zoom/camera-path";
import { WEBCAM_DEFAULTS, type WebcamScene } from "../webcam/webcam-model";
import { WebcamLayer } from "./webcam-layer";
import { PreviewStage } from "./preview-stage";
import type { PreviewPlayback } from "../use-preview-playback";

const FRAME = { width: 1000, height: 1000 };
const flatPath: CameraPath = buildCameraPath([], null, 30);
const scene = (patch: Partial<WebcamScene> = {}): WebcamScene => ({
  layout: { ...WEBCAM_DEFAULTS, size: 0.2, position: { x: 0.5, y: 0.5 } },
  segments: [],
  ...patch,
});

/** A main <video> whose clock the test sets by hand (jsdom plays nothing). */
function mainVideo(time = 0): {
  ref: React.RefObject<HTMLVideoElement | null>;
  el: HTMLVideoElement;
} {
  const el = document.createElement("video");
  let current = time;
  Object.defineProperty(el, "currentTime", {
    configurable: true,
    get: () => current,
    set: (v: number) => {
      current = v;
    },
  });
  document.body.appendChild(el);
  return { ref: { current: el }, el };
}

function setTime(el: HTMLVideoElement, t: number): void {
  el.currentTime = t;
  fireEvent(el, new Event("seeked"));
}

/** The webcam file is `duration` seconds long; until then jsdom says NaN. */
function loadWebcam(duration: number): HTMLVideoElement {
  const cam = screen.getByTestId("webcam-video") as HTMLVideoElement;
  Object.defineProperty(cam, "duration", { configurable: true, get: () => duration });
  fireEvent.loadedMetadata(cam);
  return cam;
}

const bubble = (): HTMLElement => screen.getByTestId("webcam-layer");

function renderLayer(
  props: Partial<React.ComponentProps<typeof WebcamLayer>> & {
    videoRef: React.RefObject<HTMLVideoElement | null>;
  },
) {
  const handlers = { onSelect: vi.fn(), onBegin: vi.fn(), onMove: vi.fn(), onEnd: vi.fn() };
  const utils = render(
    <WebcamLayer
      src="kaipu-media://webcam/rec-1"
      startOffsetMs={0}
      webcam={scene()}
      path={flatPath}
      cameraEnabled
      frame={FRAME}
      hidden={false}
      interactive
      selected={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...utils, handlers };
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("WebcamLayer", () => {
  it("plays the webcam file muted and inline", () => {
    const { ref } = mainVideo();
    renderLayer({ videoRef: ref });
    const cam = screen.getByTestId("webcam-video") as HTMLVideoElement;
    expect(cam.getAttribute("src")).toBe("kaipu-media://webcam/rec-1");
    expect(cam.muted).toBe(true);
    expect(cam.hasAttribute("playsinline")).toBe(true);
  });

  it("places the bubble from the layout as percentages of the output frame", () => {
    const { ref } = mainVideo(1);
    renderLayer({ videoRef: ref });
    loadWebcam(30);
    expect(bubble().style.display).toBe("");
    expect(bubble().style.left).toBe("40%");
    expect(bubble().style.top).toBe("40%");
    expect(bubble().style.width).toBe("20%");
  });

  it("cuts the shape with clip-path and mirrors with a transform", () => {
    const { ref } = mainVideo(1);
    renderLayer({
      videoRef: ref,
      webcam: scene({
        layout: { ...WEBCAM_DEFAULTS, shape: "rounded", mirrored: true },
      }),
    });
    const cam = loadWebcam(30);
    expect((bubble().firstElementChild as HTMLElement).style.clipPath).toBe("inset(0 round 18%)");
    expect(cam.style.transform).toContain("scaleX(-1)");
  });

  it("is hidden before the webcam's first frame and after its last (offset subtracted)", () => {
    const { ref, el } = mainVideo(0.2);
    renderLayer({ videoRef: ref, startOffsetMs: 500 });
    loadWebcam(10);
    expect(bubble().style.display).toBe("none");
    act(() => setTime(el, 0.6));
    expect(bubble().style.display).toBe("");
    act(() => setTime(el, 10.6));
    expect(bubble().style.display).toBe("none");
  });

  it("shrinks during a zoom from the camera path's scale, and not in the unzoomed view", () => {
    const zoomed = buildCameraPath(
      [
        {
          id: "z",
          start: 1,
          end: 9,
          scale: 2,
          mode: "fixed",
          anchor: { x: 0.5, y: 0.5 },
          smoothing: 0,
          origin: "manual",
          trigger: null,
        },
      ],
      null,
      10,
    );
    const { ref } = mainVideo(5);
    const { rerender } = renderLayer({ videoRef: ref, path: zoomed });
    loadWebcam(30);
    // scaleDuringZoom 0.7 (the default) at a settled 2× zoom: 20 % × 0.7.
    expect(parseFloat(bubble().style.width)).toBeCloseTo(14, 0);
    rerender(
      <WebcamLayer
        videoRef={ref}
        src="kaipu-media://webcam/rec-1"
        startOffsetMs={0}
        webcam={scene()}
        path={zoomed}
        cameraEnabled={false}
        frame={FRAME}
        hidden={false}
        interactive
        selected={false}
        onSelect={vi.fn()}
        onBegin={vi.fn()}
        onMove={vi.fn()}
        onEnd={vi.fn()}
      />,
    );
    expect(bubble().style.width).toBe("20%");
  });

  it("is hidden inside a hidden segment", () => {
    const { ref, el } = mainVideo(1);
    renderLayer({
      videoRef: ref,
      webcam: scene({ segments: [{ id: "h", start: 2, end: 4, mode: "hidden" }] }),
    });
    loadWebcam(30);
    expect(bubble().style.display).toBe("");
    act(() => setTime(el, 3));
    expect(bubble().style.display).toBe("none");
  });

  it("is hidden while holding the original", () => {
    const { ref } = mainVideo(1);
    renderLayer({ videoRef: ref, hidden: true });
    loadWebcam(30);
    expect(bubble().style.display).toBe("none");
  });

  it("re-seeks the webcam to t − offset when it drifts past 80 ms", () => {
    const { ref, el } = mainVideo(1);
    renderLayer({ videoRef: ref, startOffsetMs: 250 });
    const cam = loadWebcam(30);
    expect(cam.currentTime).toBeCloseTo(0.75);
    cam.currentTime = 0.8; // 50 ms off: left alone
    act(() => setTime(el, 1));
    expect(cam.currentTime).toBeCloseTo(0.8);
    act(() => setTime(el, 5));
    expect(cam.currentTime).toBeCloseTo(4.75);
  });

  it("does not stack a new seek on one still in flight; resyncs once it lands", () => {
    const { ref, el } = mainVideo(1);
    renderLayer({ videoRef: ref });
    const cam = loadWebcam(30);
    // Track every write to the webcam's currentTime, and hold it "seeking".
    let camTime = 1;
    let seeking = false;
    const writes: number[] = [];
    Object.defineProperty(cam, "currentTime", {
      configurable: true,
      get: () => camTime,
      set: (v: number) => {
        writes.push(v);
        camTime = v;
      },
    });
    Object.defineProperty(cam, "seeking", { configurable: true, get: () => seeking });
    act(() => setTime(el, 3)); // 2 s off: one seek starts
    expect(writes).toEqual([3]);
    seeking = true;
    // The decoder is still busy; the main clock runs on, frame after frame, > 80 ms each.
    act(() => setTime(el, 3.1));
    act(() => setTime(el, 3.2));
    act(() => setTime(el, 3.3));
    expect(writes).toEqual([3]);
    // The seek lands at 3 while the main video is at 3.3: one catch-up seek.
    seeking = false;
    act(() => void fireEvent(cam, new Event("seeked")));
    expect(writes).toEqual([3, 3.3]);
  });

  it("mirrors the main element's play and pause", () => {
    const { ref, el } = mainVideo(1);
    renderLayer({ videoRef: ref });
    const cam = loadWebcam(30);
    let mainPaused = false;
    Object.defineProperty(el, "paused", { configurable: true, get: () => mainPaused });
    Object.defineProperty(cam, "paused", { configurable: true, get: () => true });
    act(() => void fireEvent(el, new Event("play")));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    mainPaused = true;
    Object.defineProperty(cam, "paused", { configurable: true, get: () => false });
    act(() => void fireEvent(el, new Event("pause")));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("a drag reports clamped centres between one begin and one end", () => {
    const { ref } = mainVideo(1);
    const { handlers, container } = renderLayer({ videoRef: ref });
    loadWebcam(30);
    const slot = container.querySelector('[data-testid="webcam-slot"]') as HTMLElement;
    slot.getBoundingClientRect = () => ({ width: 1000, height: 1000 }) as DOMRect;
    fireEvent.pointerDown(bubble(), { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(bubble(), { clientX: 600, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(bubble(), { clientX: 2000, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(bubble(), { pointerId: 1 });
    expect(handlers.onSelect).toHaveBeenCalledOnce();
    expect(handlers.onBegin).toHaveBeenCalledOnce();
    expect(handlers.onMove).toHaveBeenNthCalledWith(1, { x: 0.6, y: 0.5 }, 1);
    // Far right: held so the 200 px bubble stays inside the frame.
    expect(handlers.onMove).toHaveBeenNthCalledWith(2, { x: 0.9, y: 0.5 }, 1);
    expect(handlers.onEnd).toHaveBeenCalledOnce();
  });
});

describe("PreviewStage — webcam slot", () => {
  const playback = {
    videoRef: { current: null },
    onVideoTimeUpdate: vi.fn(),
    onVideoEnded: vi.fn(),
    onVideoPlay: vi.fn(),
    onVideoPause: vi.fn(),
    toggle: vi.fn(),
  } as unknown as PreviewPlayback;

  it("renders the webcam outside the transformed content, before the chrome", () => {
    const contentRef = { current: null as HTMLDivElement | null };
    const { container } = render(
      <PreviewStage
        playback={playback}
        mediaUrl="blob:x"
        contentRef={contentRef}
        webcam={<div data-testid="slot-webcam" />}
        chrome={<div data-testid="slot-chrome" />}
      />,
    );
    const webcam = screen.getByTestId("slot-webcam");
    expect(contentRef.current!.contains(webcam)).toBe(false);
    const stage = container.firstElementChild!;
    const children = Array.from(stage.children);
    expect(children.indexOf(webcam)).toBe(children.indexOf(contentRef.current!) + 1);
    expect(children.indexOf(screen.getByTestId("slot-chrome"))).toBe(children.indexOf(webcam) + 1);
  });
});
