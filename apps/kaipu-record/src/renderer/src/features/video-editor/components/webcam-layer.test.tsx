import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { buildCameraPath, type CameraPath } from "../zoom/camera-path";
import { WEBCAM_DEFAULTS, webcamStateAt, type WebcamScene } from "../webcam/webcam-model";
import { webcamStateRect } from "../webcam/webcam-layout";
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
  const handlers = { onSelect: vi.fn(), onDrop: vi.fn() };
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
        dropAt={null}
        onSelect={vi.fn()}
        onDrop={vi.fn()}
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
