import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { buildCameraPath, type CameraPath } from "../zoom/camera-path";
import { WEBCAM_DEFAULTS, webcamStateAt, type WebcamScene } from "../webcam/webcam-model";
import { webcamStateRect } from "../webcam/webcam-layout";
import { WebcamLayer } from "./webcam-layer";
import { PreviewStage } from "./preview-stage";
import type { PreviewPlayback } from "../use-preview-playback";
import { sourceAxis } from "../source-axis";
import type { PreviewMedia } from "../playback-media";

const FRAME = { width: 1000, height: 1000 };
const flatPath: CameraPath = buildCameraPath([], null, 30);
const scene = (patch: Partial<WebcamScene> = {}): WebcamScene => ({
  layout: {
    ...WEBCAM_DEFAULTS,
    size: 0.2,
    position: { x: 0.5, y: 0.5 },
    // The default is no shrink (1); the shrink tests need it on.
    scaleDuringZoom: 0.7,
  },
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

/**
 * The webcam file is `duration` seconds long; until then jsdom says NaN. `readyState` is the
 * element's (2 = HAVE_CURRENT_DATA: a decoded frame is there; jsdom always says 0).
 */
function loadWebcam(duration: number, readyState = 2): HTMLVideoElement {
  const cam = screen.getByTestId("webcam-video") as HTMLVideoElement;
  Object.defineProperty(cam, "duration", { configurable: true, get: () => duration });
  Object.defineProperty(cam, "readyState", { configurable: true, get: () => readyState });
  fireEvent.loadedMetadata(cam);
  return cam;
}

const bubble = (): HTMLElement => screen.getByTestId("webcam-layer");

function renderLayer(
  props: Partial<React.ComponentProps<typeof WebcamLayer>> & {
    videoRef: React.RefObject<PreviewMedia | null>;
  },
) {
  const handlers = {
    onSelect: vi.fn(),
    onDrop: vi.fn(),
    onResizeBegin: vi.fn(),
    onResize: vi.fn(),
    onResizeEnd: vi.fn(),
  };
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
      dropAt={null}
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
  vi.unstubAllGlobals();
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
    expect((bubble().firstElementChild as HTMLElement).style.clipPath).toBe(
      "inset(0 round 18% / 18%)",
    );
    expect(cam.style.transform).toContain("scaleX(-1)");
  });

  it("is hidden beyond the lead-in hold and after the webcam's last frame (offset subtracted)", () => {
    const { ref, el } = mainVideo(0.2);
    renderLayer({ videoRef: ref, startOffsetMs: 2000 });
    loadWebcam(10);
    expect(bubble().style.display).toBe("none");
    act(() => setTime(el, 2.6));
    expect(bubble().style.display).toBe("");
    act(() => setTime(el, 12.6));
    expect(bubble().style.display).toBe("none");
  });

  it.each([75, 500])(
    "shows the bubble at 0:00, paused, when the webcam started %i ms late (first frame held)",
    (startOffsetMs) => {
      const { ref } = mainVideo(0);
      renderLayer({ videoRef: ref, startOffsetMs });
      const cam = loadWebcam(30);
      expect(bubble().style.display).toBe("");
      expect(cam.currentTime).toBe(0);
    },
  );

  it("holds the webcam paused on its first frame while playing through the lead-in, then plays it", () => {
    const { ref, el } = mainVideo(3);
    renderLayer({ videoRef: ref, startOffsetMs: 500 });
    const cam = loadWebcam(30);
    let camTime = 0;
    let camPaused = false;
    let seeking = false;
    const writes: number[] = [];
    Object.defineProperty(cam, "currentTime", {
      configurable: true,
      get: () => camTime,
      set: (v: number) => {
        writes.push(v);
        camTime = v;
        seeking = true;
      },
    });
    Object.defineProperty(cam, "seeking", { configurable: true, get: () => seeking });
    Object.defineProperty(cam, "paused", { configurable: true, get: () => camPaused });
    Object.defineProperty(el, "paused", { configurable: true, get: () => false });
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(() => {
      camPaused = true;
    });
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    act(() => setTime(el, 4));
    // A 400 ms seek: during playback the next one would lead by 400 ms.
    now.mockReturnValue(1_400);
    seeking = false;
    act(() => void fireEvent(cam, new Event("seeked")));
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    // Playing, the user scrubs back into the lead-in: the first frame is held, not played,
    // and the seek to it gets no lead (a lead would land past the frame that is meant to show).
    writes.length = 0;
    act(() => setTime(el, 0.3));
    expect(writes).toEqual([0]);
    expect(camPaused).toBe(true);
    seeking = false;
    act(() => void fireEvent(cam, new Event("seeked")));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(bubble().style.display).toBe("");
    act(() => setTime(el, 0.6));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("keeps the bubble hidden at 0:00 when the camera really started 11 s late", () => {
    const { ref, el } = mainVideo(0);
    renderLayer({ videoRef: ref, startOffsetMs: 11386 });
    loadWebcam(30);
    expect(bubble().style.display).toBe("none");
    act(() => setTime(el, 11.5));
    expect(bubble().style.display).toBe("");
  });

  it("does not show an empty box before the webcam has a decoded frame, then paints on loadeddata", () => {
    const { ref } = mainVideo(0);
    renderLayer({ videoRef: ref, startOffsetMs: 75 });
    const cam = loadWebcam(30, 1);
    expect(bubble().style.display).toBe("none");
    Object.defineProperty(cam, "readyState", { configurable: true, get: () => 2 });
    fireEvent.loadedData(cam);
    expect(bubble().style.display).toBe("");
  });

  it("keeps a painted bubble through a seek, when Chromium drops readyState until the frame lands", () => {
    const { ref, el } = mainVideo(1);
    renderLayer({ videoRef: ref });
    const cam = loadWebcam(30);
    expect(bubble().style.display).toBe("");
    Object.defineProperty(cam, "readyState", { configurable: true, get: () => 1 });
    act(() => setTime(el, 5));
    expect(bubble().style.display).toBe("");
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
    // scaleDuringZoom 0.7 (set by this file's scene) at a settled 2× zoom: 20 % × 0.7.
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
        dropAt={null}
        onSelect={vi.fn()}
        onDrop={vi.fn()}
        onResizeBegin={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
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

  it("leads the catch-up seek during playback by how long the last seek took", () => {
    const { ref, el } = mainVideo(1);
    renderLayer({ videoRef: ref });
    const cam = loadWebcam(30);
    let camTime = 1;
    let seeking = false;
    const writes: number[] = [];
    Object.defineProperty(cam, "currentTime", {
      configurable: true,
      get: () => camTime,
      set: (v: number) => {
        writes.push(v);
        camTime = v;
        seeking = true;
      },
    });
    Object.defineProperty(cam, "seeking", { configurable: true, get: () => seeking });
    Object.defineProperty(el, "paused", { configurable: true, get: () => false });
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    act(() => setTime(el, 3)); // 2 s off: the first seek has no measured duration yet
    expect(writes).toEqual([3]);
    // That seek takes 400 ms (a long keyframe interval) while the main video plays on.
    now.mockReturnValue(1_400);
    el.currentTime = 3.4;
    seeking = false;
    act(() => void fireEvent(cam, new Event("seeked")));
    // Seeking to 3.4 would land at 3.4 when the screen is at 3.8: aim where it will be.
    expect(writes[1]).toBeCloseTo(3.8);
  });

  it.each([
    [2, 4.2],
    [0.5, 3.6],
  ])(
    "measures the lead in media time at playbackRate %s (the webcam follows the main's rate)",
    (rate, expected) => {
      const { ref, el } = mainVideo(1);
      renderLayer({ videoRef: ref });
      const cam = loadWebcam(30);
      let camTime = 1;
      let seeking = false;
      const writes: number[] = [];
      Object.defineProperty(cam, "currentTime", {
        configurable: true,
        get: () => camTime,
        set: (v: number) => {
          writes.push(v);
          camTime = v;
          seeking = true;
        },
      });
      Object.defineProperty(cam, "seeking", { configurable: true, get: () => seeking });
      Object.defineProperty(el, "paused", { configurable: true, get: () => false });
      el.playbackRate = rate;
      const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
      act(() => setTime(el, 3)); // the first seek has no measured duration yet
      expect(writes).toEqual([3]);
      expect(cam.playbackRate).toBe(rate);
      // That seek takes 400 ms of wall time; the main video advances 400 ms × rate.
      now.mockReturnValue(1_400);
      el.currentTime = 3.4;
      seeking = false;
      act(() => void fireEvent(cam, new Event("seeked")));
      expect(writes[1]).toBeCloseTo(expected);
    },
  );

  it("gives no lead while the main video waits for data: its clock is not moving", () => {
    const { ref, el } = mainVideo(1);
    renderLayer({ videoRef: ref });
    const cam = loadWebcam(30);
    let camTime = 1;
    let seeking = false;
    const writes: number[] = [];
    Object.defineProperty(cam, "currentTime", {
      configurable: true,
      get: () => camTime,
      set: (v: number) => {
        writes.push(v);
        camTime = v;
        seeking = true;
      },
    });
    Object.defineProperty(cam, "seeking", { configurable: true, get: () => seeking });
    Object.defineProperty(el, "paused", { configurable: true, get: () => false });
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    act(() => setTime(el, 3));
    // A 400 ms seek: during playback the next one would lead by 400 ms.
    now.mockReturnValue(1_400);
    seeking = false;
    act(() => void fireEvent(cam, new Event("seeked")));
    // The screen runs out of data and a scrub lands elsewhere: it holds at 6, so the face
    // must too — a lead would jump it ahead, then back when `playing` resyncs it.
    act(() => void fireEvent(el, new Event("waiting")));
    writes.length = 0;
    act(() => setTime(el, 6));
    expect(writes).toEqual([6]);
  });

  it("pauses the webcam while the main video waits for data, and resumes on playing", () => {
    const { ref, el } = mainVideo(1);
    renderLayer({ videoRef: ref });
    const cam = loadWebcam(30);
    let camPaused = false;
    Object.defineProperty(el, "paused", { configurable: true, get: () => false });
    Object.defineProperty(cam, "paused", { configurable: true, get: () => camPaused });
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    pause.mockClear();
    play.mockClear();
    act(() => void fireEvent(el, new Event("waiting")));
    expect(pause).toHaveBeenCalledOnce();
    camPaused = true;
    // Still buffering: a timeupdate or seeked must not restart the face on its own.
    act(() => setTime(el, 1));
    expect(play).not.toHaveBeenCalled();
    act(() => void fireEvent(el, new Event("playing")));
    expect(play).toHaveBeenCalledOnce();
  });

  it("a stalled fetch pauses the webcam only when the main video has run out of data", () => {
    const { ref, el } = mainVideo(1);
    renderLayer({ videoRef: ref });
    const cam = loadWebcam(30);
    let readyState = 4;
    Object.defineProperty(el, "paused", { configurable: true, get: () => false });
    Object.defineProperty(cam, "paused", { configurable: true, get: () => false });
    Object.defineProperty(el, "readyState", { configurable: true, get: () => readyState });
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    act(() => void fireEvent(el, new Event("stalled")));
    expect(pause).not.toHaveBeenCalled(); // still playing from its buffer
    readyState = 2;
    act(() => void fireEvent(el, new Event("stalled")));
    expect(pause).toHaveBeenCalledOnce();
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

  it("names the draggable bubble for assistive tech", () => {
    const { ref } = mainVideo(1);
    renderLayer({ videoRef: ref });
    loadWebcam(30);
    expect(screen.getByRole("button", { name: "Webcam: drag to move it" })).toBe(bubble());
  });

  it("selects from the keyboard without letting Space reach the page's play shortcut", () => {
    const { ref } = mainVideo(1);
    const { handlers } = renderLayer({ videoRef: ref });
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    fireEvent.keyDown(bubble(), { key: " " });
    window.removeEventListener("keydown", onWindowKey);
    expect(handlers.onSelect).toHaveBeenCalledWith(1);
    expect(onWindowKey).not.toHaveBeenCalled();
  });

  /** A layer in a 1000 px frame whose slot measures 1000 px, with the webcam file loaded. */
  function dragSetup(
    webcam: WebcamScene = scene(),
    extra: Partial<React.ComponentProps<typeof WebcamLayer>> = {},
  ) {
    const { ref, el } = mainVideo(1);
    const view = renderLayer({ videoRef: ref, webcam, ...extra });
    loadWebcam(30);
    const slot = view.container.querySelector('[data-testid="webcam-slot"]') as HTMLElement;
    slot.getBoundingClientRect = () => ({ width: 1000, height: 1000 }) as DOMRect;
    return { ...view, el, ref };
  }
  const center = (): { x: number; y: number } => {
    const b = bubble();
    return {
      x: parseFloat(b.style.left) / 100 + parseFloat(b.style.width) / 200,
      y: parseFloat(b.style.top) / 100 + parseFloat(b.style.height) / 200,
    };
  };

  it("a drag moves only the bubble's element, 1:1 with the pointer and stopped by the frame edge", () => {
    const { handlers } = dragSetup();
    fireEvent.pointerDown(bubble(), { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(bubble(), { clientX: 600, clientY: 500, pointerId: 1 });
    expect(center().x).toBeCloseTo(0.6, 6);
    expect(center().y).toBeCloseTo(0.5, 6);
    // Far right: held so the 200 px bubble stays inside the frame.
    fireEvent.pointerMove(bubble(), { clientX: 2000, clientY: 500, pointerId: 1 });
    expect(center().x).toBeCloseTo(0.9, 6);
    // Nothing reached the page: no selection, no drop, until the pointer is released.
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(handlers.onDrop).not.toHaveBeenCalled();
    expect(bubble().dataset.dragging).toBe("true");
  });

  it("reports ONE drop on release, with the clamped centre and the source time", () => {
    const { handlers } = dragSetup();
    fireEvent.pointerDown(bubble(), { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(bubble(), { clientX: 600, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(bubble(), { clientX: 2000, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(bubble(), { clientX: 2000, clientY: 500, pointerId: 1 });
    expect(handlers.onDrop).toHaveBeenCalledOnce();
    const [position, sourceTime] = handlers.onDrop.mock.calls[0]!;
    expect(position.x).toBeCloseTo(0.9, 6);
    expect(position.y).toBeCloseTo(0.5, 6);
    expect(sourceTime).toBe(1);
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(bubble().dataset.dragging).toBe("false");
  });

  it("a press that moves under 3 px is a click: it selects and drops nothing", () => {
    const { handlers } = dragSetup();
    fireEvent.pointerDown(bubble(), { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(bubble(), { clientX: 502, clientY: 501, pointerId: 1 });
    fireEvent.pointerUp(bubble(), { clientX: 502, clientY: 501, pointerId: 1 });
    expect(handlers.onSelect).toHaveBeenCalledExactlyOnceWith(1);
    expect(handlers.onDrop).not.toHaveBeenCalled();
    // And the bubble is back where the scene has it.
    expect(center().x).toBeCloseTo(0.5, 6);
  });

  it("a press that moves 3 px or more is a drag", () => {
    const { handlers } = dragSetup();
    fireEvent.pointerDown(bubble(), { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(bubble(), { clientX: 503, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(bubble(), { clientX: 503, clientY: 500, pointerId: 1 });
    expect(handlers.onDrop).toHaveBeenCalledOnce();
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("a press that went out past 3 px and came back is still a drag: it drops and selects nothing", () => {
    const { handlers } = dragSetup();
    fireEvent.pointerDown(bubble(), { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(bubble(), { clientX: 600, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(bubble(), { clientX: 501, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(bubble(), { clientX: 501, clientY: 500, pointerId: 1 });
    expect(handlers.onDrop).toHaveBeenCalledOnce();
    expect(handlers.onDrop.mock.calls[0]![0].x).toBeCloseTo(0.501, 6);
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("an aborted drag puts the bubble back and calls nothing", () => {
    for (const abort of ["pointerCancel", "lostPointerCapture"] as const) {
      const { handlers, unmount } = dragSetup();
      fireEvent.pointerDown(bubble(), { clientX: 500, clientY: 500, pointerId: 1 });
      fireEvent.pointerMove(bubble(), { clientX: 700, clientY: 500, pointerId: 1 });
      expect(center().x).toBeCloseTo(0.7, 6);
      fireEvent[abort](bubble(), { pointerId: 1 });
      expect(center().x).toBeCloseTo(0.5, 6);
      expect(bubble().dataset.dragging).toBe("false");
      expect(handlers.onDrop).not.toHaveBeenCalled();
      expect(handlers.onSelect).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("a second drag cancelled while a card waits puts the bubble back at the dropped place", () => {
    for (const abort of ["pointerCancel", "lostPointerCapture"] as const) {
      const { rerender, handlers, ref, unmount } = dragSetup();
      const props = {
        src: "kaipu-media://webcam/rec-1",
        startOffsetMs: 0,
        webcam: scene(),
        path: flatPath,
        cameraEnabled: true,
        frame: FRAME,
        hidden: false,
        interactive: true,
        selected: false,
        videoRef: ref,
        ...handlers,
      };
      rerender(<WebcamLayer {...props} dropAt={{ x: 0.8, y: 0.3 }} />);
      fireEvent.pointerDown(bubble(), { clientX: 800, clientY: 300, pointerId: 1 });
      fireEvent.pointerMove(bubble(), { clientX: 600, clientY: 300, pointerId: 1 });
      expect(center().x).toBeCloseTo(0.6, 6);
      fireEvent[abort](bubble(), { pointerId: 1 });
      // The card is still open on the dropped place, so that is where the bubble stays.
      expect(center().x).toBeCloseTo(0.8, 6);
      expect(center().y).toBeCloseTo(0.3, 6);
      expect(handlers.onDrop).not.toHaveBeenCalled();
      unmount();
    }
  });

  describe("onHeldChange", () => {
    /** The layer reports its state once on mount; what matters is what a gesture adds. */
    function heldSetup() {
      const onHeldChange = vi.fn();
      const setup = dragSetup(scene(), { onHeldChange });
      onHeldChange.mockClear();
      return { ...setup, onHeldChange };
    }

    it("is true once the bubble moves past the click slop and false on release", () => {
      const { onHeldChange } = heldSetup();
      fireEvent.pointerDown(bubble(), { clientX: 500, clientY: 500, pointerId: 1 });
      expect(onHeldChange).not.toHaveBeenCalled();
      fireEvent.pointerMove(bubble(), { clientX: 503, clientY: 500, pointerId: 1 });
      expect(onHeldChange.mock.calls).toEqual([[true]]);
      fireEvent.pointerUp(bubble(), { clientX: 503, clientY: 500, pointerId: 1 });
      expect(onHeldChange.mock.calls).toEqual([[true], [false]]);
    });

    it("is false when the drag is cancelled or loses the pointer", () => {
      for (const abort of ["pointerCancel", "lostPointerCapture"] as const) {
        const { onHeldChange, unmount } = heldSetup();
        fireEvent.pointerDown(bubble(), { clientX: 500, clientY: 500, pointerId: 1 });
        fireEvent.pointerMove(bubble(), { clientX: 700, clientY: 500, pointerId: 1 });
        expect(onHeldChange.mock.calls).toEqual([[true]]);
        fireEvent[abort](bubble(), { pointerId: 1 });
        expect(onHeldChange.mock.calls).toEqual([[true], [false]]);
        unmount();
      }
    });

    // In the page, "held" pauses a playing video: a plain click must not.
    it("is never raised by a press that moves under 3 px", () => {
      const { onHeldChange } = heldSetup();
      fireEvent.pointerDown(bubble(), { clientX: 500, clientY: 500, pointerId: 1 });
      fireEvent.pointerMove(bubble(), { clientX: 502, clientY: 501, pointerId: 1 });
      fireEvent.pointerUp(bubble(), { clientX: 502, clientY: 501, pointerId: 1 });
      expect(onHeldChange).not.toHaveBeenCalled();
    });
  });

  it("stays at the dropped place while a card waits, and goes back when it is gone", () => {
    const { rerender, handlers, ref } = dragSetup();
    const props = {
      src: "kaipu-media://webcam/rec-1",
      startOffsetMs: 0,
      webcam: scene(),
      path: flatPath,
      cameraEnabled: true,
      frame: FRAME,
      hidden: false,
      interactive: true,
      selected: false,
      videoRef: ref,
      ...handlers,
    };
    rerender(<WebcamLayer {...props} dropAt={{ x: 0.8, y: 0.3 }} />);
    expect(center().x).toBeCloseTo(0.8, 6);
    expect(center().y).toBeCloseTo(0.3, 6);
    rerender(<WebcamLayer {...props} dropAt={null} />);
    expect(center().x).toBeCloseTo(0.5, 6);
    expect(center().y).toBeCloseTo(0.5, 6);
  });
});

// Camera sections (ADR 0039): the preview reads the export's state function at the media
// time, with no CSS transition, so a slide is drawn frame by frame and seeking is exact.
describe("WebcamLayer — a camera block's slide", () => {
  const TARGET = { x: 0.8, y: 0.2 };
  const sliding = (): WebcamScene =>
    scene({
      segments: [
        {
          id: "b",
          start: 2,
          end: 8,
          mode: "override",
          layout: { position: TARGET },
          transition: { kind: "slide", ms: 700, easing: "back" },
        },
      ],
    });
  const box = () => ({
    left: parseFloat(bubble().style.left),
    top: parseFloat(bubble().style.top),
    width: parseFloat(bubble().style.width),
    height: parseFloat(bubble().style.height),
  });

  it("places the box where webcamStateRect puts it at each source time, inside the frame", () => {
    const { ref, el } = mainVideo(1);
    renderLayer({ videoRef: ref, webcam: sliding() });
    loadWebcam(30);
    const lefts: number[] = [];
    for (const t of [2.1, 2.25, 2.4]) {
      act(() => setTime(el, t));
      const state = webcamStateAt({ webcam: sliding() }, t)!;
      const rect = webcamStateRect(state, FRAME, 1)!;
      const placed = box();
      expect(placed.left).toBeCloseTo((rect.x / FRAME.width) * 100, 4);
      expect(placed.top).toBeCloseTo((rect.y / FRAME.height) * 100, 4);
      expect(placed.left).toBeGreaterThanOrEqual(0);
      expect(placed.left + placed.width).toBeLessThanOrEqual(100 + 1e-9);
      expect(placed.top).toBeGreaterThanOrEqual(0);
      expect(placed.top + placed.height).toBeLessThanOrEqual(100 + 1e-9);
      lefts.push(placed.left);
    }
    expect(new Set(lefts.map((l) => l.toFixed(3))).size).toBe(3);
    // No CSS transition animates it: the box is exactly what the function says.
    expect(bubble().style.transition).toBe("");
  });

  it("is where it was at the same time after seeking backwards", () => {
    const { ref, el } = mainVideo(1);
    renderLayer({ videoRef: ref, webcam: sliding() });
    loadWebcam(30);
    act(() => setTime(el, 2.25));
    const forwards = box();
    act(() => setTime(el, 5));
    act(() => setTime(el, 1));
    act(() => setTime(el, 2.25));
    expect(box()).toEqual(forwards);
  });

  it("takes the non-position fields of the layout in force at once, not eased", () => {
    const { ref, el } = mainVideo(1);
    const webcam = scene({
      segments: [
        {
          id: "b",
          start: 2,
          end: 8,
          mode: "override",
          layout: { position: TARGET, shape: "rounded", mirrored: false },
          transition: { kind: "slide", ms: 700, easing: "back" },
        },
      ],
    });
    const { container } = renderLayer({ videoRef: ref, webcam });
    const cam = loadWebcam(30);
    act(() => setTime(el, 2.05));
    expect(
      (container.querySelector("[data-testid=webcam-layer]")!.firstElementChild as HTMLElement)
        .style.clipPath,
    ).toBe("inset(0 round 18% / 18%)");
    expect(cam.style.transform).not.toContain("scaleX(-1)");
  });

  it("a drag grabbed mid-slide starts from where the bubble is drawn now, and keeps the bubble under the pointer", () => {
    const { ref, el } = mainVideo(1);
    const { handlers, container } = renderLayer({ videoRef: ref, webcam: sliding() });
    loadWebcam(30);
    act(() => setTime(el, 2.25));
    const state = webcamStateAt({ webcam: sliding() }, 2.25)!;
    const rect = webcamStateRect(state, FRAME, 1)!;
    const slot = container.querySelector('[data-testid="webcam-slot"]') as HTMLElement;
    slot.getBoundingClientRect = () => ({ width: 1000, height: 1000 }) as DOMRect;
    fireEvent.pointerDown(bubble(), { clientX: 500, clientY: 500, pointerId: 1 });
    // A tick of the clock mid-drag must not slide the bubble toward the part's place.
    act(() => setTime(el, 2.3));
    fireEvent.pointerMove(bubble(), { clientX: 550, clientY: 500, pointerId: 1 });
    const left = parseFloat(bubble().style.left);
    const width = parseFloat(bubble().style.width);
    expect((left + width / 2) / 100).toBeCloseTo((rect.x + rect.width / 2) / FRAME.width + 0.05, 6);
    fireEvent.pointerUp(bubble(), { clientX: 550, clientY: 500, pointerId: 1 });
    const [position] = handlers.onDrop.mock.calls[0]!;
    expect(position.x).toBeCloseTo((rect.x + rect.width / 2) / FRAME.width + 0.05, 6);
    expect(position.y).toBeCloseTo((rect.y + rect.height / 2) / FRAME.height, 6);
  });

  it("moves a slide on every display frame while the screen is still, and stops when paused", () => {
    // A queue of pending frames by id, so a cancel really removes one.
    const queue = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queue.set(nextId, cb);
      return nextId++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => void queue.delete(id));
    const { ref, el } = mainVideo(2.1);
    renderLayer({ videoRef: ref, webcam: sliding() });
    loadWebcam(30);
    let paused = true;
    Object.defineProperty(el, "paused", { configurable: true, get: () => paused });
    paused = false;
    act(() => void fireEvent(el, new Event("play")));
    // No presented frame and no `timeupdate`: only the media clock moves.
    const leftAt = (t: number): number => {
      el.currentTime = t;
      const next = [...queue.values()];
      queue.clear();
      act(() => next.forEach((cb) => cb(0)));
      return box().left;
    };
    const a = leftAt(2.2);
    const b = leftAt(2.3);
    const rect = (t: number) =>
      webcamStateRect(webcamStateAt({ webcam: sliding() }, t)!, FRAME, 1)!;
    expect(a).toBeCloseTo((rect(2.2).x / FRAME.width) * 100, 6);
    expect(b).toBeCloseTo((rect(2.3).x / FRAME.width) * 100, 6);
    expect(a).not.toBe(b);
    // Paused: the frame the loop had queued is cancelled, so nothing keeps asking for more.
    expect(queue.size).toBe(1);
    paused = true;
    act(() => void fireEvent(el, new Event("pause")));
    expect(queue.size).toBe(0);
  });

  it("caps the last return by the recording's end when it is given", () => {
    const back = (): WebcamScene =>
      scene({
        segments: [
          {
            id: "b",
            start: 2,
            end: 5,
            mode: "override",
            layout: { position: TARGET },
            transition: { kind: "slide", ms: 700, easing: "linear" },
          },
        ],
      });
    const settledLeft = (() => {
      const { ref, el } = mainVideo(1);
      const view = renderLayer({ videoRef: ref, webcam: back(), endSeconds: 6 });
      loadWebcam(30);
      // 1 s are left after the block: its return takes 0.5 s, so it is settled at 5.6.
      act(() => setTime(el, 5.6));
      const left = parseFloat(bubble().style.left);
      view.unmount();
      return left;
    })();
    expect(settledLeft).toBeCloseTo(40, 3);
    const { ref, el } = mainVideo(1);
    renderLayer({ videoRef: ref, webcam: back() });
    loadWebcam(30);
    // Without the end the return takes its whole 0.7 s: still moving at 5.6.
    act(() => setTime(el, 5.6));
    expect(parseFloat(bubble().style.left)).not.toBeCloseTo(40, 1);
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
    // The layers are siblings inside the picture (NIW2-668): the content layer carries the
    // camera transform, the webcam and the chrome sit beside it, untransformed.
    const picture = contentRef.current!.parentElement!;
    expect(container.contains(picture)).toBe(true);
    const children = Array.from(picture.children);
    expect(children.indexOf(webcam)).toBe(children.indexOf(contentRef.current!) + 1);
    expect(children.indexOf(screen.getByTestId("slot-chrome"))).toBe(children.indexOf(webcam) + 1);
  });
});

describe("WebcamLayer over joined recordings (ADR 0058)", () => {
  const source = (id: string, offset: number, durationSeconds: number) => ({
    id,
    assetId: `asset-${id}`,
    title: id,
    offset,
    durationSeconds,
    width: 1280,
    height: 720,
  });
  // Opened [0, 100] (webcam, 500 ms late); B [3600, 3640] (webcam, 200 ms late); C [7200, 7230] has none.
  const recordings = {
    axis: sourceAxis(100, [source("B", 3600, 40), source("C", 7200, 30)]),
    files: new Map([
      [null, { src: "kaipu-media://webcam/opened", startOffsetMs: 500 }],
      ["B", { src: "kaipu-media://webcam/b", startOffsetMs: 200 }],
      ["C", { src: null, startOffsetMs: 0 }],
    ]),
  };
  const layer = (el: HTMLVideoElement) =>
    renderLayer({
      videoRef: { current: el },
      src: "kaipu-media://webcam/opened",
      startOffsetMs: 500,
      recordings,
    });

  it("plays the active recording's own webcam file, swapped when the playhead crosses over", () => {
    const { el } = mainVideo(5);
    layer(el);
    const cam = loadWebcam(100);
    expect(cam.getAttribute("src")).toBe("kaipu-media://webcam/opened");
    act(() => setTime(el, 3610));
    expect(cam.getAttribute("src")).toBe("kaipu-media://webcam/b");
    act(() => setTime(el, 20));
    expect(cam.getAttribute("src")).toBe("kaipu-media://webcam/opened");
  });

  it("aims the webcam at the LOCAL second minus that file's own offset", () => {
    const { el } = mainVideo(5);
    layer(el);
    const cam = loadWebcam(100);
    act(() => setTime(el, 3610)); // 10 s into B; its webcam started 200 ms late
    expect(cam.currentTime).toBeCloseTo(9.8, 6);
  });

  it("hides the face during clips of a recording that has no webcam, and brings it back", () => {
    const { el } = mainVideo(5);
    layer(el);
    loadWebcam(100);
    expect(bubble().style.display).toBe("");
    act(() => setTime(el, 7210));
    expect(bubble().style.display).toBe("none");
    act(() => setTime(el, 20));
    expect(bubble().style.display).toBe("");
  });

  it("applies the scene's one layout to every recording's face", () => {
    const { el } = mainVideo(5);
    layer(el);
    loadWebcam(100);
    const before = [bubble().style.left, bubble().style.top, bubble().style.width];
    act(() => setTime(el, 3610));
    loadWebcam(100);
    expect([bubble().style.left, bubble().style.top, bubble().style.width]).toEqual(before);
  });
});

// Corner handles (NIW2-888): the selected bubble gets four, a drag resizes it live and ends as one
// gesture; the page writes the layout, so the layer only reports a size (and a centre).
describe("WebcamLayer — corner resize", () => {
  const handle = (corner: string): HTMLElement => screen.getByTestId(`webcam-handle-${corner}`);
  const chip = (): HTMLElement | null => screen.queryByTestId("webcam-size-chip");

  /** A selected bubble in a 1000 px frame whose slot measures 1000 px: 200 px at (400, 400). */
  function resizeSetup(
    extra: Partial<React.ComponentProps<typeof WebcamLayer>> = {},
    webcam: WebcamScene = scene(),
  ) {
    const { ref, el } = mainVideo(1);
    const view = renderLayer({ videoRef: ref, webcam, selected: true, ...extra });
    loadWebcam(30);
    const slot = view.container.querySelector('[data-testid="webcam-slot"]') as HTMLElement;
    slot.getBoundingClientRect = () => ({ width: 1000, height: 1000 }) as DOMRect;
    return { ...view, el, ref };
  }

  it("draws four corner handles for the selected bubble", () => {
    resizeSetup();
    for (const corner of ["nw", "ne", "sw", "se"]) expect(handle(corner)).toBeTruthy();
    const overlay = screen.getByTestId("webcam-resize-overlay");
    // The overlay is the bubble's box, so the handles sit on the bubble's corners.
    expect(overlay.style.left).toBe(bubble().style.left);
    expect(overlay.style.top).toBe(bubble().style.top);
    expect(overlay.style.width).toBe(bubble().style.width);
    expect(overlay.style.height).toBe(bubble().style.height);
  });

  it("draws no handles for a bubble that is not selected", () => {
    resizeSetup({ selected: false });
    expect(screen.queryByTestId("webcam-handle-se")).toBeNull();
    expect(screen.queryByTestId("webcam-resize-overlay")).toBeNull();
  });

  it("draws no handles while a drawing tool is armed (not interactive)", () => {
    resizeSetup({ interactive: false });
    expect(screen.queryByTestId("webcam-handle-se")).toBeNull();
  });

  it("hides the handles when the playhead moves from the bubble into a hidden segment", () => {
    const { el } = resizeSetup(
      {},
      scene({ segments: [{ id: "h", mode: "hidden", start: 3, end: 5 }] }),
    );
    const overlay = screen.getByTestId("webcam-resize-overlay");
    // Visible first: the overlay only shows once the bubble is drawn, so the next step has
    // something to hide (it starts hidden, and a hidden segment alone would leave it that way).
    expect(overlay.style.display).toBe("");
    act(() => setTime(el, 4));
    expect(bubble().style.display).toBe("none");
    expect(overlay.style.display).toBe("none");
    act(() => setTime(el, 1));
    expect(overlay.style.display).toBe("");
  });

  it("draws no handles when the page says this bubble cannot be resized now", () => {
    resizeSetup({ resizable: false });
    expect(screen.queryByTestId("webcam-handle-se")).toBeNull();
    expect(screen.queryByTestId("webcam-resize-overlay")).toBeNull();
  });

  it("reports the new size and centre live, one begin and one end", () => {
    const { handlers } = resizeSetup();
    fireEvent.pointerDown(handle("se"), { clientX: 600, clientY: 600, pointerId: 1 });
    expect(handlers.onResizeBegin).not.toHaveBeenCalled();
    fireEvent.pointerMove(handle("se"), { clientX: 700, clientY: 700, pointerId: 1 });
    expect(handlers.onResizeBegin).toHaveBeenCalledTimes(1);
    // 100 px outwards on both axes: the height grows by 100 px, the top-left corner stays.
    expect(handlers.onResize).toHaveBeenLastCalledWith(
      { size: 0.3, position: { x: 0.55, y: 0.55 } },
      1,
    );
    fireEvent.pointerMove(handle("se"), { clientX: 650, clientY: 650, pointerId: 1 });
    expect(handlers.onResizeBegin).toHaveBeenCalledTimes(1);
    expect(handlers.onResize).toHaveBeenLastCalledWith(
      { size: 0.25, position: { x: 0.525, y: 0.525 } },
      1,
    );
    expect(handlers.onResizeEnd).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle("se"), { clientX: 650, clientY: 650, pointerId: 1 });
    expect(handlers.onResizeEnd).toHaveBeenCalledTimes(1);
    // Nothing else reached the page: not a selection, not a drop.
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(handlers.onDrop).not.toHaveBeenCalled();
  });

  it("anchors the opposite corner for every handle", () => {
    const anchors: Array<[string, number, number, { x: number; y: number }]> = [
      ["nw", 400, 400, { x: 0.45, y: 0.45 }],
      ["ne", 600, 400, { x: 0.55, y: 0.45 }],
      ["sw", 400, 600, { x: 0.45, y: 0.55 }],
      ["se", 600, 600, { x: 0.55, y: 0.55 }],
    ];
    for (const [corner, x, y, position] of anchors) {
      const { handlers, unmount } = resizeSetup();
      // Each corner pulled 100 px away from the centre along both axes.
      const out = { x: x + (x < 500 ? -100 : 100), y: y + (y < 500 ? -100 : 100) };
      fireEvent.pointerDown(handle(corner), { clientX: x, clientY: y, pointerId: 1 });
      fireEvent.pointerMove(handle(corner), { clientX: out.x, clientY: out.y, pointerId: 1 });
      expect(handlers.onResize).toHaveBeenLastCalledWith({ size: 0.3, position }, 1);
      unmount();
    }
  });

  it("shows the size and the preset while dragging, and drops the chip on release", () => {
    resizeSetup();
    expect(chip()).toBeNull();
    fireEvent.pointerDown(handle("se"), { clientX: 600, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(handle("se"), { clientX: 730, clientY: 730, pointerId: 1 });
    expect(chip()?.textContent).toBe("33% · L");
    fireEvent.pointerMove(handle("se"), { clientX: 680, clientY: 680, pointerId: 1 });
    expect(chip()?.textContent).toBe("28%");
    fireEvent.pointerUp(handle("se"), { clientX: 680, clientY: 680, pointerId: 1 });
    expect(chip()).toBeNull();
  });

  it("is not a resize when the press moves under 2 px", () => {
    const { handlers } = resizeSetup();
    fireEvent.pointerDown(handle("se"), { clientX: 600, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(handle("se"), { clientX: 601, clientY: 600, pointerId: 1 });
    fireEvent.pointerUp(handle("se"), { clientX: 601, clientY: 600, pointerId: 1 });
    expect(handlers.onResizeBegin).not.toHaveBeenCalled();
    expect(handlers.onResize).not.toHaveBeenCalled();
    expect(handlers.onResizeEnd).not.toHaveBeenCalled();
  });

  it("does not move the bubble: a handle press never starts the body's drag", () => {
    const { handlers } = resizeSetup();
    fireEvent.pointerDown(handle("nw"), { clientX: 400, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(handle("nw"), { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(handle("nw"), { clientX: 300, clientY: 300, pointerId: 1 });
    expect(bubble().dataset.dragging).toBe("false");
    expect(handlers.onDrop).not.toHaveBeenCalled();
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("reports only the size when it grows around the centre", () => {
    const { handlers } = resizeSetup({ resizeAnchor: "center" });
    fireEvent.pointerDown(handle("se"), { clientX: 600, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(handle("se"), { clientX: 650, clientY: 650, pointerId: 1 });
    expect(handlers.onResize).toHaveBeenLastCalledWith({ size: 0.3 }, 1);
  });

  it("keeps the rectangle's 3/4 aspect from a horizontal move", () => {
    const { handlers } = resizeSetup(
      {},
      scene({ layout: { ...scene().layout, shape: "rectangle" } }),
    );
    // The rectangle is 150 × 200 at (425, 400): its se corner is at (575, 600).
    fireEvent.pointerDown(handle("se"), { clientX: 575, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(handle("se"), { clientX: 650, clientY: 600, pointerId: 1 });
    // 75 px wider is 100 px taller.
    expect(handlers.onResize).toHaveBeenLastCalledWith(
      { size: 0.3, position: { x: 0.5375, y: 0.55 } },
      1,
    );
  });

  it("starts from the size the zoom draws, so the bubble does not jump", () => {
    const zoomed = buildCameraPath(
      [
        {
          id: "z",
          start: 0,
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
    const { handlers, container } = (() => {
      const view = renderLayer({ videoRef: ref, selected: true, path: zoomed });
      return view;
    })();
    loadWebcam(30);
    const slot = container.querySelector('[data-testid="webcam-slot"]') as HTMLElement;
    slot.getBoundingClientRect = () => ({ width: 1000, height: 1000 }) as DOMRect;
    // 0.2 × 0.7 (this file's shrink) = a 140 px bubble at (430, 430)..(570, 570).
    expect(parseFloat(bubble().style.width)).toBeCloseTo(14, 0);
    fireEvent.pointerDown(handle("se"), { clientX: 570, clientY: 570, pointerId: 1 });
    fireEvent.pointerMove(handle("se"), { clientX: 620, clientY: 570, pointerId: 1 });
    // 50 px more on screen is 50 / 0.7 more of the layout's own height: 0.2 + 0.0714 → 0.27.
    expect(handlers.onResize.mock.calls.at(-1)?.[0].size).toBe(0.27);
  });

  it("raises held while resizing and lowers it on release", () => {
    const onHeldChange = vi.fn();
    resizeSetup({ onHeldChange });
    onHeldChange.mockClear();
    fireEvent.pointerDown(handle("se"), { clientX: 600, clientY: 600, pointerId: 1 });
    expect(onHeldChange).not.toHaveBeenCalled();
    fireEvent.pointerMove(handle("se"), { clientX: 650, clientY: 650, pointerId: 1 });
    expect(onHeldChange.mock.calls).toEqual([[true]]);
    fireEvent.pointerUp(handle("se"), { clientX: 650, clientY: 650, pointerId: 1 });
    expect(onHeldChange.mock.calls).toEqual([[true], [false]]);
  });

  it("ends the gesture once when the pointer is cancelled or lost", () => {
    for (const abort of ["pointerCancel", "lostPointerCapture"] as const) {
      const { handlers, unmount } = resizeSetup();
      fireEvent.pointerDown(handle("se"), { clientX: 600, clientY: 600, pointerId: 1 });
      fireEvent.pointerMove(handle("se"), { clientX: 650, clientY: 650, pointerId: 1 });
      fireEvent[abort](handle("se"), { pointerId: 1 });
      fireEvent.pointerUp(handle("se"), { clientX: 650, clientY: 650, pointerId: 1 });
      expect(handlers.onResizeEnd).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it("ends the gesture when the bubble is deselected mid-drag", () => {
    const { handlers, rerender, ref } = resizeSetup();
    fireEvent.pointerDown(handle("se"), { clientX: 600, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(handle("se"), { clientX: 650, clientY: 650, pointerId: 1 });
    rerender(
      <WebcamLayer
        videoRef={ref}
        src="kaipu-media://webcam/rec-1"
        startOffsetMs={0}
        webcam={scene()}
        path={flatPath}
        cameraEnabled
        frame={FRAME}
        hidden={false}
        interactive
        selected={false}
        dropAt={null}
        {...handlers}
      />,
    );
    expect(handlers.onResizeEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("webcam-handle-se")).toBeNull();
  });

  it("ignores a second pointer while one resize is live", () => {
    const { handlers } = resizeSetup();
    fireEvent.pointerDown(handle("se"), { clientX: 600, clientY: 600, pointerId: 1 });
    fireEvent.pointerDown(handle("nw"), { clientX: 400, clientY: 400, pointerId: 2 });
    fireEvent.pointerMove(handle("nw"), { clientX: 300, clientY: 300, pointerId: 2 });
    expect(handlers.onResizeBegin).not.toHaveBeenCalled();
    fireEvent.pointerMove(handle("se"), { clientX: 650, clientY: 650, pointerId: 1 });
    expect(handlers.onResizeBegin).toHaveBeenCalledTimes(1);
  });
});
