/**
 * The timeline at 4x and scrolled (NIW2-667). The failure this file exists to catch: a pointer
 * conversion that divides by a width of its own, which is right at 1x and wrong the moment
 * the lanes are wider than the screen — a trim, an edge drag or a seek moving by the 1x
 * amount instead of landing on the time under the pointer. Every test here puts the pointer
 * on a pixel, computes the time that pixel shows from the SCALE and the SCROLL, and checks the
 * lane reports that time (and, where it differs, not the 1x one).
 *
 * The geometry: a 100 s recording in a 1000 px lane (10 px/s at fit), the lane starting at
 * x = 220 (strip at 100, labels 120). At 4x the scale is 40 px/s; scrolled 1200 px, the lane
 * shows 30 s..55 s, so a pointer at clientX 720 (500 px into the lane) is at
 * (500 + 1200) / 40 = 42.5 s. At 1x the same pixel would be 28.5 s.
 */
import { useState } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TrackItem, VideoOverlay } from "../scene";
import {
  layoutDuration,
  setSlideDuration,
  toLayout,
  trimClip,
  type LayoutEntry,
} from "../timeline";
import type { PreviewPlayback } from "../use-preview-playback";
import {
  createTimelineViewStore,
  useTimelineViewStore,
  type TimelineViewStore,
} from "../use-timeline-view";
import type { BlurRedaction } from "../privacy/redaction";
import type { ZoomSegment } from "../zoom/zoom-model";
import type { WebcamSegment } from "../webcam/webcam-model";
import { AudioLane } from "./audio-lane";
import { PrivacyLane } from "./privacy-lane";
import { TimelineStrip, type ExtraLane } from "./timeline-strip";
import { rulerTicks, thumbnailTiles, timeToFraction } from "./timeline-geometry";
import { timeAt, xOf } from "./timeline-view";
import { WebcamLane } from "./webcam-lane";
import { ZoomLane } from "./zoom-lane";
import { ZoomIn } from "lucide-react";

const LANE_LEFT = 220;
const LANE_WIDTH = 1000;
const ZOOM = 4;
const SCROLL = 1200;
/** 500 px into the lane → 42.5 s at 4x scrolled 1200; 28.5 s if a lane forgot both. */
const POINTER = LANE_LEFT + 500;
const TIME_UNDER_POINTER = 42.5;

function rectOf(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 20,
    height: 20,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

function stubGeometry(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const id = this.dataset.testid;
      if (id === "timeline-scroller") return rectOf(100, 120 + LANE_WIDTH);
      if (id === "lane-corner") return rectOf(100, 120);
      return rectOf(0, 0);
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

function makePlayback(overrides: Partial<PreviewPlayback> = {}): PreviewPlayback {
  return {
    videoRef: { current: null },
    playing: false,
    muted: false,
    speed: 1,
    duration: 100,
    timelineTime: 0,
    activeSlideId: null,
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
    toggleMute: vi.fn(),
    setSpeed: vi.fn(),
    seek: vi.fn(),
    onVideoTimeUpdate: vi.fn(),
    onVideoEnded: vi.fn(),
    onVideoLoadedMetadata: vi.fn(),
    onVideoPlay: vi.fn(),
    onVideoPause: vi.fn(),
    subscribeTime: vi.fn(() => () => {}),
    ...overrides,
  };
}

const oneClip: LayoutEntry[] = toLayout([
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 100 },
] as TrackItem[]);

// Two clips of 50 s: the handle of clip "a" sits at 50 s.
const twoClips: LayoutEntry[] = toLayout([
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 50 },
  { id: "b", kind: "clip", sourceStart: 50, sourceEnd: 100 },
] as TrackItem[]);

type EdgeSpy = (
  id: string,
  edge: "start" | "end",
  sourceTime: number | null,
  phase: "start" | "move" | "end",
) => void;

interface Rendered {
  store: TimelineViewStore;
  container: HTMLElement;
  body: HTMLElement;
  rerender: (ui: React.ReactElement) => void;
}

type StripProps = Partial<Parameters<typeof TimelineStrip>[0]>;

function strip(store: TimelineViewStore, props: StripProps = {}): React.ReactElement {
  return (
    <TimelineStrip
      layout={oneClip}
      playback={makePlayback()}
      thumbnails={[]}
      selectedItemId={null}
      onSelectItem={vi.fn()}
      onTrim={vi.fn()}
      overlays={[]}
      selectedOverlayId={null}
      onSelectOverlay={vi.fn()}
      timelineView={store}
      {...props}
    />
  );
}

/** A strip at 4x, scrolled to 1200 px, with the lane sitting where the geometry says. */
function renderZoomed(props: StripProps = {}, duration = 100): Rendered {
  stubGeometry();
  const store = createTimelineViewStore();
  store.setDuration(duration);
  const utils = render(strip(store, props));
  act(() => {
    store.zoomTo(ZOOM);
    store.scrollTo(SCROLL, "user");
  });
  return {
    store,
    container: utils.container,
    body: utils.container.querySelector('[data-testid="timeline-scroller"]') as HTMLElement,
    rerender: utils.rerender,
  };
}

function captureStubs(el: HTMLElement): HTMLElement {
  el.setPointerCapture = vi.fn();
  el.hasPointerCapture = vi.fn(() => true);
  el.releasePointerCapture = vi.fn();
  return el;
}

describe("the view the tests rely on", () => {
  it("is 4x scrolled 1200 px, with the strip measuring the lane at 1000 px", () => {
    const { store, body } = renderZoomed();
    expect(store.getView()).toMatchObject({ zoom: ZOOM, scroll: SCROLL, laneWidth: LANE_WIDTH });
    expect(body.scrollLeft).toBe(SCROLL);
    expect(body.dataset.zoom).toBe(String(ZOOM));
  });
});

describe("the ruler and the track at 4x, scrolled", () => {
  it("a click on the ruler seeks to the time under the pointer, not the 1x time", () => {
    const playback = makePlayback();
    const { container } = renderZoomed({ playback });
    const ruler = captureStubs(container.querySelector('[data-testid="ruler"]') as HTMLElement);
    fireEvent.pointerDown(ruler, { pointerId: 1, clientX: POINTER });
    expect(playback.seek).toHaveBeenLastCalledWith(TIME_UNDER_POINTER);
  });

  it("dragging along the ruler scrubs to the time under each pointer position", () => {
    const playback = makePlayback();
    const { container } = renderZoomed({ playback });
    const ruler = captureStubs(container.querySelector('[data-testid="ruler"]') as HTMLElement);
    fireEvent.pointerDown(ruler, { pointerId: 1, clientX: LANE_LEFT });
    expect(playback.seek).toHaveBeenLastCalledWith(30); // the left edge shows 30 s
    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: LANE_LEFT + LANE_WIDTH });
    expect(playback.seek).toHaveBeenLastCalledWith(55); // the right edge shows 55 s
  });

  it("a click on empty track seeks to the time under the pointer too", () => {
    const playback = makePlayback();
    const { container } = renderZoomed({ playback });
    const track = captureStubs(container.querySelector("button")!.parentElement as HTMLElement);
    fireEvent.pointerDown(track, { pointerId: 1, clientX: POINTER });
    expect(playback.seek).toHaveBeenLastCalledWith(TIME_UNDER_POINTER);
  });

  it("the hover readout names the time under the pointer", () => {
    const { container } = renderZoomed();
    const ruler = container.querySelector('[data-testid="ruler"]') as HTMLElement;
    ruler.hasPointerCapture = vi.fn(() => false);
    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: POINTER });
    expect(container.querySelector("[data-visible]")?.textContent).toBe("0:42.5");
  });

  it("flips the readout by where the line sits in the VISIBLE lane, not in the whole content", () => {
    const { container } = renderZoomed();
    const ruler = container.querySelector('[data-testid="ruler"]') as HTMLElement;
    ruler.hasPointerCapture = vi.fn(() => false);
    // 950 px into the lane: 95% of what is on screen, but only 54% of the whole timeline.
    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: LANE_LEFT + 950 });
    expect(container.querySelector("[data-visible]")).toHaveAttribute("data-flip");
    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: LANE_LEFT + 500 });
    expect(container.querySelector("[data-visible]")).not.toHaveAttribute("data-flip");
  });
});

describe("the room the stylesheet leaves around the lanes", () => {
  it("is part of the lane's geometry: the lane starts after the labels AND the gap, and ends before the trailing room", () => {
    const playback = makePlayback();
    stubGeometry();
    const store = createTimelineViewStore();
    store.setDuration(100);
    const { container } = render(strip(store, { playback }));
    const body = container.querySelector('[data-testid="timeline-scroller"]') as HTMLElement;
    // What `.timelineBody` declares (jsdom loads no stylesheet, so say it inline).
    body.style.setProperty("--lane-gap", "8px");
    body.style.setProperty("--lane-end", "6px");
    const ruler = captureStubs(container.querySelector('[data-testid="ruler"]') as HTMLElement);
    // The lane starts at 100 + 120 + 8 = 228 and is 1120 - 120 - 8 - 6 = 986 px wide.
    const seekedTo = (clientX: number): number => {
      fireEvent.pointerDown(ruler, { pointerId: 1, clientX });
      return (playback.seek as Mock).mock.lastCall![0] as number;
    };
    expect(seekedTo(228)).toBeCloseTo(0, 9);
    expect(seekedTo(228 + 493)).toBeCloseTo(50, 9);
    expect(seekedTo(228 + 986)).toBeCloseTo(100, 9);
    expect(store.getState().laneWidth).toBe(986);
  });
});

describe("trim and slide handles at 4x, scrolled", () => {
  it("a trim handle moves by the pointer distance over the 4x scale, not the 1x scale", () => {
    const onTrim = vi.fn();
    const { container } = renderZoomed({
      layout: twoClips,
      selectedItemId: "a",
      onTrim,
    });
    const end = captureStubs(container.querySelector('[data-trim-handle="end"]') as HTMLElement);
    fireEvent.pointerDown(end, { pointerId: 1, clientX: 500 }); // clip a ends at 50 s
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 700 }); // +200 px
    // 200 px at 40 px/s is 5 s. At 1x (10 px/s) it would have been 20 s.
    expect(onTrim).toHaveBeenLastCalledWith("a", "end", 55, "move");
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 420 }); // -80 px
    expect(onTrim).toHaveBeenLastCalledWith("a", "end", 48, "move");
    fireEvent.pointerUp(end, { pointerId: 1, clientX: 420 });
    expect(onTrim).toHaveBeenLastCalledWith("a", "end", 48, "end");
  });

  it("the start handle of the second clip too", () => {
    const onTrim = vi.fn();
    const { container } = renderZoomed({ layout: twoClips, selectedItemId: "b", onTrim });
    const start = captureStubs(
      container.querySelector('[data-trim-handle="start"]') as HTMLElement,
    );
    fireEvent.pointerDown(start, { pointerId: 1, clientX: 600 }); // clip b starts at source 50
    fireEvent.pointerMove(start, { pointerId: 1, clientX: 680 }); // +80 px = +2 s
    expect(onTrim).toHaveBeenLastCalledWith("b", "start", 52, "move");
  });

  it("the end handle of clip b is not clamped at the visible edge of the strip when dragged past it", () => {
    // Clip b (source 50-100) ends at the last second of the timeline, so its end handle sits
    // at the strip's right edge. Dragging it far to the right of the last pixel (+4000 px,
    // +100 s at 40 px/s) must keep reporting the pointer's time, not stick where the strip ends.
    const onTrim = vi.fn();
    const { container } = renderZoomed({ layout: twoClips, selectedItemId: "b", onTrim });
    const end = captureStubs(container.querySelector('[data-trim-handle="end"]') as HTMLElement);
    fireEvent.pointerDown(end, { pointerId: 1, clientX: 900 });
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 900 + 4000 }); // far right: +100 s
    expect(onTrim).toHaveBeenLastCalledWith("b", "end", 200, "move");
  });

  it("a slide's duration handle follows the 4x scale", () => {
    const onSlideDuration = vi.fn();
    const slideThenClip = toLayout([
      { id: "s1", kind: "slide", assetId: "x", duration: 40 },
      { id: "b", kind: "clip", sourceStart: 0, sourceEnd: 60 },
    ] as TrackItem[]);
    const { container } = renderZoomed({
      layout: slideThenClip,
      selectedItemId: "s1",
      onSlideDuration,
      slideUrlFor: () => null,
    });
    const handle = captureStubs(container.querySelector("[data-slide-handle]") as HTMLElement);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400 });
    expect(onSlideDuration).toHaveBeenLastCalledWith("s1", 40, "start");
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 440 }); // +40 px = +1 s at 4x
    expect(onSlideDuration).toHaveBeenLastCalledWith("s1", 41, "move");
  });
});

describe("every lane's edge drag at 4x, scrolled", () => {
  const zoomSegment: ZoomSegment = {
    id: "z",
    start: 42,
    end: 50,
    scale: 2,
    mode: "follow",
    anchor: null,
    smoothing: 70,
    origin: "auto",
    trigger: "click",
  };
  const webcamSegment: WebcamSegment = { id: "w", start: 42, end: 50, mode: "hidden" };
  const blur: BlurRedaction = {
    id: "b1",
    kind: "blur",
    start: 42,
    end: 50,
    rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
    intensity: 70,
    style: "gaussian",
  };
  const box: VideoOverlay = {
    id: "o1",
    kind: "box",
    x: 0.1,
    y: 0.1,
    w: 0.2,
    h: 0.2,
    color: "#f6055c",
    stroke: 1,
    seed: 1,
    start: 42,
    end: 50,
  };

  /** Each lane, selected on a block that ends at 50 s, handing back its edge-drag spy. */
  const lanes: {
    name: string;
    handle: string;
    build: (spy: Mock<EdgeSpy>) => ExtraLane;
  }[] = [
    {
      name: "zooms",
      handle: '[data-zoom-handle="end"]',
      build: (spy) => ({
        key: "zooms",
        label: "Zooms",
        icon: ZoomIn,
        node: (
          <ZoomLane
            layout={oneClip}
            segments={[zoomSegment]}
            selectedId="z"
            onSelect={vi.fn()}
            onEdgeDrag={spy}
          />
        ),
      }),
    },
    {
      name: "webcam",
      handle: '[data-webcam-handle="end"]',
      build: (spy) => ({
        key: "webcam",
        label: "Webcam",
        icon: ZoomIn,
        node: (
          <WebcamLane
            layout={oneClip}
            segments={[webcamSegment]}
            selectedId="w"
            onSelect={vi.fn()}
            onEdgeDrag={spy}
          />
        ),
      }),
    },
    {
      name: "privacy",
      handle: '[data-privacy-handle="end"]',
      build: (spy) => ({
        key: "privacy",
        label: "Privacy",
        icon: ZoomIn,
        node: (
          <PrivacyLane
            layout={oneClip}
            redactions={[blur]}
            selectedId="b1"
            onSelect={vi.fn()}
            onEdgeDrag={spy}
            ghost={null}
          />
        ),
      }),
    },
    {
      name: "audio",
      handle: '[data-mute-handle="end"]',
      build: (spy) => ({
        key: "audio",
        label: "Audio",
        icon: ZoomIn,
        node: (
          <AudioLane
            layout={oneClip}
            ranges={[{ id: "m1", sourceStart: 42, sourceEnd: 50 }]}
            audioMuted={false}
            selectedId="m1"
            onSelect={vi.fn()}
            onEdgeDrag={spy}
          />
        ),
      }),
    },
  ];

  it.each(lanes)("$name: the dragged edge lands on the time under the pointer", (lane) => {
    const spy = vi.fn<EdgeSpy>();
    const { container } = renderZoomed({ extraLanes: [lane.build(spy)] });
    const handle = captureStubs(container.querySelector(lane.handle) as HTMLElement);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: LANE_LEFT + 320 });
    // 700 px into the lane: (700 + 1200) / 40 = 47.5 s. At 1x it would have been 70 s.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: LANE_LEFT + 700 });
    expect(spy).toHaveBeenLastCalledWith(expect.any(String), "end", 47.5, "move");
    // The left edge of the lane shows 30 s; the right edge, 55 s.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: LANE_LEFT });
    expect(spy).toHaveBeenLastCalledWith(expect.any(String), "end", 30, "move");
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: LANE_LEFT + LANE_WIDTH });
    expect(spy).toHaveBeenLastCalledWith(expect.any(String), "end", 55, "move");
  });

  it("annotations: a pill dragged by its body moves by the time under the pointer", () => {
    const onWindowChange = vi.fn();
    const { container } = renderZoomed({
      overlays: [box],
      onWindowChange,
      selectedOverlayId: "o1",
    });
    const pill = captureStubs(
      container.querySelector("[data-overlay-handle]")!.previousElementSibling as HTMLElement,
    );
    fireEvent.pointerDown(pill, { pointerId: 1, clientX: POINTER }); // 42.5 s
    fireEvent.pointerMove(pill, { pointerId: 1, clientX: POINTER + 40 }); // +1 s at 4x
    expect(onWindowChange).toHaveBeenLastCalledWith("o1", 43, 51, "move");
  });

  it("annotations: a pill's end handle lands on the time under the pointer", () => {
    const onWindowChange = vi.fn();
    const { container } = renderZoomed({ overlays: [box], onWindowChange });
    const end = captureStubs(container.querySelector('[data-overlay-handle="end"]') as HTMLElement);
    fireEvent.pointerDown(end, { pointerId: 1, clientX: LANE_LEFT + 320 });
    fireEvent.pointerMove(end, { pointerId: 1, clientX: LANE_LEFT + 700 });
    expect(onWindowChange).toHaveBeenLastCalledWith("o1", 42, 47.5, "move");
  });
});

describe("zoom and pan", () => {
  it("⌘ + wheel zooms around the pointer: the time under it stays under it", () => {
    const { store, body } = renderZoomed();
    const before = store.getView();
    const notPrevented = fireEvent.wheel(body, { metaKey: true, deltaY: -40, clientX: POINTER });
    const after = store.getView();
    expect(notPrevented).toBe(false); // the page's own zoom was stopped
    expect(after.zoom).toBeGreaterThan(before.zoom);
    const timeAfter = (POINTER - LANE_LEFT + after.scroll) / ((after.zoom * LANE_WIDTH) / 100);
    expect(timeAfter).toBeCloseTo(TIME_UNDER_POINTER, 6);
  });

  it("Ctrl + wheel does the same: a trackpad pinch reaches Chromium as a wheel with ctrlKey", () => {
    const { store, body } = renderZoomed();
    fireEvent.wheel(body, { ctrlKey: true, deltaY: 6, clientX: POINTER });
    expect(store.getView().zoom).toBeLessThan(ZOOM); // scrolling down zooms out
  });

  it("a plain wheel is left to the browser: the container pans natively, nothing zooms", () => {
    const { store, body } = renderZoomed();
    const notPrevented = fireEvent.wheel(body, { deltaX: 80, deltaY: 0, clientX: POINTER });
    expect(notPrevented).toBe(true);
    expect(store.getView().zoom).toBe(ZOOM);
  });

  it("a scroll the user makes (scrollbar, trackpad swipe) reaches the store", () => {
    const { store, body } = renderZoomed();
    body.scrollLeft = 640;
    fireEvent.scroll(body);
    expect(store.getState().scroll).toBe(640);
  });

  it("FIT returns to 1x and scroll 0, in the DOM too", () => {
    const { store, body } = renderZoomed();
    act(() => store.fit());
    expect(body.dataset.zoom).toBe("1");
    expect(body.scrollLeft).toBe(0);
  });

  it("the lanes are zoom-times as wide: the content column follows --zoom, the labels do not", () => {
    const { body } = renderZoomed();
    expect(body.style.getPropertyValue("--zoom")).toBe(String(ZOOM));
  });
});

describe("a cut while zoomed", () => {
  it("keeps the scroll inside the shorter content and the apparent zoom where it still fits", () => {
    const { store, body, rerender } = renderZoomed();
    // 2400 px at 40 px/s is 60 s: the left edge of the lane sits at 60 s.
    act(() => store.scrollTo(2400, "user"));
    expect(body.scrollLeft).toBe(2400);
    // Delete 40 s: 60 s left, which can still zoom 14x, so the zoom stays at 4x. The scale
    // becomes 4000 px / 60 s = 66.7 px/s, so keeping the left edge at 60 s asks for 4000 px,
    // which the 3000 px maximum clamps. Carrying the pixels over would stay at 2400, so
    // this tells the two behaviours apart (a scroll that was already at the maximum would not).
    const shorter = toLayout([
      { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 60 },
    ] as TrackItem[]);
    act(() => store.setDuration(60));
    rerender(strip(store, { layout: shorter, playback: makePlayback({ duration: 60 }) }));
    expect(store.getView().zoom).toBe(ZOOM);
    expect(store.getState().scroll).toBe(3000);
    expect(body.scrollLeft).toBe(3000);
  });

  it("drops the zoom to what the remaining footage allows and re-clamps the scroll", () => {
    stubGeometry();
    const store = createTimelineViewStore();
    store.setDuration(100);
    const utils = render(strip(store));
    act(() => {
      store.zoomTo(20);
      store.scrollTo(17_000, "user");
    });
    const body = utils.container.querySelector('[data-testid="timeline-scroller"]') as HTMLElement;
    expect(body.scrollLeft).toBe(17_000);
    const shorter = toLayout([
      { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 40 },
    ] as TrackItem[]);
    act(() => store.setDuration(40));
    utils.rerender(strip(store, { layout: shorter, playback: makePlayback({ duration: 40 }) }));
    const view = store.getView();
    expect(view.zoom).toBeCloseTo(9.6, 6); // 240 px/s over 40 s in 1000 px
    // The left edge was at 85 s (17 000 px at 200 px/s): past the 40 s that are left, so the
    // scroll lands on the very end of the shorter content, 9.6 x 1000 - 1000 px.
    expect(view.scroll).toBeCloseTo(view.zoom * LANE_WIDTH - LANE_WIDTH, 6);
    expect(body.scrollLeft).toBeCloseTo(8600, 6);
    expect(body.dataset.zoom).toBe(String(view.zoom));
  });
});

describe("a cut while zoomed keeps the window on screen", () => {
  it("the lane still starts at the same time after the take is shortened, in the DOM too", () => {
    const { store, body, rerender } = renderZoomed(); // 100 s at 4x, scroll 1200: from 30 s
    expect(timeAt(store.getView(), LANE_LEFT, LANE_LEFT)).toBeCloseTo(30, 9);
    const shorter = toLayout([
      { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 60 },
    ] as TrackItem[]);
    act(() => store.setDuration(60)); // 66.7 px/s now
    rerender(strip(store, { layout: shorter, playback: makePlayback({ duration: 60 }) }));
    expect(timeAt(store.getView(), LANE_LEFT, LANE_LEFT)).toBeCloseTo(30, 9);
    expect(body.scrollLeft).toBeCloseTo(2000, 6); // 30 s x 66.7 px/s, in the DOM
  });
});

describe("a cut while zoomed, with the playhead where it was", () => {
  it("a new duration alone never reveals the playhead: only a playhead that moves does", () => {
    // 100 s at 4x (40 px/s), scrolled to the start: the lane shows 0..25 s and the paused
    // playhead sits at 50 s, off screen to the right, where the user left it.
    const playback = makePlayback({ timelineTime: 50 });
    const { store, rerender } = renderZoomed({ playback });
    act(() => store.scrollTo(0, "user"));
    // A cut shortens the take to 55 s. The playhead is still at 50 s, still off screen.
    const shorter = toLayout([
      { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 55 },
    ] as TrackItem[]);
    act(() => store.setDuration(55));
    rerender(
      strip(store, { layout: shorter, playback: makePlayback({ duration: 55, timelineTime: 50 }) }),
    );
    expect(store.getState().scroll).toBe(0);
  });
});

describe("following the playhead", () => {
  function playingStrip(): Rendered & { tick: (t: number) => void } {
    let listener: ((t: number) => void) | null = null;
    const playback = makePlayback({
      playing: true,
      subscribeTime: vi.fn((cb: (t: number) => void) => {
        listener = cb;
        return () => {};
      }),
    });
    const rendered = renderZoomed({ playback });
    act(() => {
      rendered.store.scrollTo(0, "follow"); // start at the left, still following
      rendered.store.resumeFollow();
    });
    return {
      ...rendered,
      tick: (t) => {
        act(() => listener?.(t));
      },
    };
  }

  it("scrolls once the playhead passes 80% of the visible lane, and keeps it in view", () => {
    const { store, body, tick } = playingStrip();
    tick(10); // 400 px in: left of the 800 px mark
    expect(body.scrollLeft).toBe(0);
    tick(21); // 840 px in: past it
    expect(body.scrollLeft).toBeGreaterThan(0);
    const x = 21 * 40 - store.getState().scroll;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(LANE_WIDTH * 0.8);
  });

  it("moves the playhead line itself as a share of the content, wherever the view is", () => {
    const { container, tick } = playingStrip();
    tick(25);
    const playhead = container.querySelector<HTMLElement>(
      '[data-testid="timeline-scroller"] > div:last-child > div:last-child',
    );
    expect(playhead?.style.left).toBe("25%");
  });

  it("stops following when the user pans, until the next play", () => {
    const { store, body, tick, rerender } = playingStrip();
    body.scrollLeft = 100;
    fireEvent.scroll(body); // the user took over
    tick(60);
    expect(store.getState().scroll).toBe(100);
    // Pause, then play again: the playhead leads again.
    rerender(strip(store, { playback: makePlayback({ playing: false }) }));
    rerender(
      strip(store, {
        playback: makePlayback({
          playing: true,
          subscribeTime: vi.fn((cb: (t: number) => void) => {
            cb(60);
            return () => {};
          }),
        }),
      }),
    );
    expect(store.getState().scroll).toBeGreaterThan(100);
  });

  it("pressing + while playing keeps following: the playhead is back in the lane on the next tick", () => {
    const { store, tick } = playingStrip();
    tick(20); // x = 800 at 4x: at the mark, no page turn yet
    expect(store.getState().scroll).toBe(0);
    act(() => {
      store.zoomStep(1);
      store.zoomStep(1);
    }); // 8x around the centre: the playhead at 20 s is now off the right edge
    tick(20);
    const x = xOf(store.getView(), 20);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(LANE_WIDTH * 0.8);
  });

  it("a pan then a zoom leaves the view where the user put it, until the next play", () => {
    const { store, body, tick } = playingStrip();
    body.scrollLeft = 100;
    fireEvent.scroll(body); // the user took over
    act(() => store.zoomStep(1));
    const scroll = store.getState().scroll;
    tick(90);
    expect(store.getState().scroll).toBe(scroll);
  });

  it("pausing does not snap the view back to a playhead the user panned away from", () => {
    const playing = makePlayback({ playing: true, timelineTime: 10 }); // 10 s = 400 px in
    const { store, body, rerender } = renderZoomed({ playback: playing });
    act(() => store.scrollTo(0, "follow"));
    body.scrollLeft = 1500; // the user pans well past the playhead
    fireEvent.scroll(body);
    rerender(strip(store, { playback: makePlayback({ playing: false, timelineTime: 10 }) }));
    expect(store.getState().scroll).toBe(1500);
  });

  it("a scroll the strip made itself is not mistaken for the user taking over", () => {
    const { store, body, tick } = playingStrip();
    tick(21); // the strip scrolls the element
    fireEvent.scroll(body); // ...which fires a scroll event
    tick(60); // still following
    expect(store.getState().scroll).toBeGreaterThan(0);
    expect(60 * 40 - store.getState().scroll).toBeLessThan(LANE_WIDTH);
  });

  it("does not turn a page under the pointer that is scrubbing the playhead", () => {
    const { store, container, tick } = playingStrip();
    const ruler = captureStubs(container.querySelector('[data-testid="ruler"]') as HTMLElement);
    fireEvent.pointerDown(ruler, { pointerId: 1, clientX: LANE_LEFT + 900 });
    tick(21);
    expect(store.getState().scroll).toBe(0);
    fireEvent.pointerUp(ruler, { pointerId: 1, clientX: LANE_LEFT + 900 });
    tick(21);
    expect(store.getState().scroll).toBeGreaterThan(0);
  });
});

/**
 * A layout that CHANGES while the user drags (NIW2-667 review). A trim or a slide-duration
 * drag rewrites the cut layout on every pointermove, so the timeline's duration (and with
 * it the pixel scale) moves under the pointer. The tests above pass a spy as `onTrim`, so
 * their layout never changes and could not see what a changing one does to the view; this
 * harness wires the strip the way the editor page does: the drag edits real items, the
 * duration feeds `useTimelineViewStore`, and the playhead stays where the page left it
 * (a trim never seeks).
 */
describe("a layout that changes during a drag", () => {
  const SOURCE = 60;
  const sixtySeconds: TrackItem[] = [
    { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 30 },
    { id: "b", kind: "clip", sourceStart: 30, sourceEnd: 60 },
  ];
  const slideThenClip: TrackItem[] = [
    {
      id: "s1",
      kind: "slide",
      assetId: "x",
      duration: 40,
      naturalWidth: 1920,
      naturalHeight: 1080,
    },
    { id: "b", kind: "clip", sourceStart: 0, sourceEnd: 60 },
  ];

  interface Spies {
    onTrim: Mock;
    onSlideDuration: Mock;
  }

  function EditableStrip({
    initial,
    timelineTime,
    selectedItemId,
    storeRef,
    spies,
  }: {
    initial: TrackItem[];
    timelineTime: number;
    selectedItemId: string;
    storeRef: { current: TimelineViewStore | null };
    spies: Spies;
  }): React.JSX.Element {
    const [items, setItems] = useState(initial);
    const layout = toLayout(items);
    const duration = layoutDuration(layout);
    const store = useTimelineViewStore(duration);
    storeRef.current = store;
    return (
      <TimelineStrip
        layout={layout}
        playback={makePlayback({ duration, timelineTime })}
        thumbnails={[]}
        selectedItemId={selectedItemId}
        onSelectItem={vi.fn()}
        onTrim={(id, edge, sourceTime, phase) => {
          spies.onTrim(id, edge, sourceTime, phase);
          if (phase === "move") setItems((cur) => trimClip(cur, id, edge, sourceTime, SOURCE));
        }}
        slideUrlFor={() => null}
        onSlideDuration={(id, next, phase) => {
          spies.onSlideDuration(id, next, phase);
          if (phase === "move") setItems((cur) => setSlideDuration(cur, id, next));
        }}
        overlays={[]}
        selectedOverlayId={null}
        onSelectOverlay={vi.fn()}
        timelineView={store}
      />
    );
  }

  function renderEditable(options: {
    items: TrackItem[];
    selectedItemId: string;
    timelineTime: number;
    scroll: number;
  }): {
    store: TimelineViewStore;
    spies: Spies;
    body: HTMLElement;
    container: HTMLElement;
    seekTo: (timelineTime: number) => void;
  } {
    stubGeometry();
    const storeRef: { current: TimelineViewStore | null } = { current: null };
    const spies: Spies = { onTrim: vi.fn(), onSlideDuration: vi.fn() };
    const element = (timelineTime: number): React.ReactElement => (
      <EditableStrip
        initial={options.items}
        timelineTime={timelineTime}
        selectedItemId={options.selectedItemId}
        storeRef={storeRef}
        spies={spies}
      />
    );
    const utils = render(element(options.timelineTime));
    const store = storeRef.current!;
    act(() => {
      store.zoomTo(ZOOM);
      store.scrollTo(options.scroll, "user");
    });
    return {
      store,
      spies,
      container: utils.container,
      body: utils.container.querySelector('[data-testid="timeline-scroller"]') as HTMLElement,
      seekTo: (timelineTime) => utils.rerender(element(timelineTime)),
    };
  }

  it("a start trim drag never moves the view toward a playhead that is far off screen", () => {
    // 60 s at 4x in a 1000 px lane: 66.67 px/s, the lane shows 0..15 s, the playhead is at
    // 50 s (3333 px, 2300 px off the right). Each pointermove shortens the take by a
    // little and changes the scale; none of that may reveal the playhead.
    const { store, spies, body, container } = renderEditable({
      items: sixtySeconds,
      selectedItemId: "a",
      timelineTime: 50,
      scroll: 0,
    });
    const handle = captureStubs(
      container.querySelector('[data-trim-handle="start"]') as HTMLElement,
    );
    const scale = (ZOOM * LANE_WIDTH) / 60;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: LANE_LEFT });
    for (const dx of [80, 160, 240, 320]) {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: LANE_LEFT + dx });
      // The trim lands on the time under the pointer, by the scale the drag began with.
      expect(spies.onTrim).toHaveBeenLastCalledWith("a", "start", expect.any(Number), "move");
      const reported = (spies.onTrim.mock.lastCall as [string, string, number])[2];
      expect(reported).toBeCloseTo(dx / scale, 9);
      expect(store.getState().scroll).toBe(0);
      expect(body.scrollLeft).toBe(0);
    }
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: LANE_LEFT + 320 });
    expect(store.getState().scroll).toBe(0);
  });

  it("the same drag scrolled into the middle of the take leaves the view where it was", () => {
    // Clip b starts at 30 s; at scroll 1200 the lane shows 18..33 s, so its start handle
    // is on screen and the playhead (5 s, left of the view) is not.
    const { store, spies, body, container } = renderEditable({
      items: sixtySeconds,
      selectedItemId: "b",
      timelineTime: 5,
      scroll: SCROLL,
    });
    const reveal = vi.spyOn(store, "reveal");
    const handle = captureStubs(
      container.querySelector('[data-trim-handle="start"]') as HTMLElement,
    );
    const scale = (ZOOM * LANE_WIDTH) / 60;
    const x0 = LANE_LEFT + 30 * scale - SCROLL; // where the handle is
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: x0 });
    for (const dx of [60, 120, 180]) {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: x0 + dx });
      const reported = (spies.onTrim.mock.lastCall as [string, string, number])[2];
      expect(reported).toBeCloseTo(30 + dx / scale, 9);
    }
    expect(reveal).not.toHaveBeenCalled();
    // The window the user was looking at is still the one on screen: it began at 18 s.
    expect(timeAt(store.getView(), LANE_LEFT, LANE_LEFT)).toBeCloseTo(18, 6);
    expect(Math.abs(body.scrollLeft - store.getState().scroll)).toBeLessThanOrEqual(1);
  });

  it("a slide-duration drag does not move the view either", () => {
    // 100 s at 4x: 40 px/s. Scrolled to 1200 px the lane shows 30..55 s, so the slide's
    // right handle (40 s) is on screen; the playhead at 90 s is not.
    const { store, spies, body, container } = renderEditable({
      items: slideThenClip,
      selectedItemId: "s1",
      timelineTime: 90,
      scroll: SCROLL,
    });
    const reveal = vi.spyOn(store, "reveal");
    const handle = captureStubs(container.querySelector("[data-slide-handle]") as HTMLElement);
    const scale = (ZOOM * LANE_WIDTH) / 100;
    const x0 = LANE_LEFT + 40 * scale - SCROLL;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: x0 });
    for (const dx of [40, 80, 120]) {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: x0 + dx });
      const reported = (spies.onSlideDuration.mock.lastCall as [string, number])[1];
      expect(reported).toBeCloseTo(40 + dx / scale, 9);
    }
    expect(reveal).not.toHaveBeenCalled();
    expect(timeAt(store.getView(), LANE_LEFT, LANE_LEFT)).toBeCloseTo(30, 6); // began at 30 s
    expect(Math.abs(body.scrollLeft - store.getState().scroll)).toBeLessThanOrEqual(1);
  });

  it("a paused playhead that really moves (a seek) off screen is still revealed", () => {
    const { store, seekTo } = renderEditable({
      items: sixtySeconds,
      selectedItemId: "a",
      timelineTime: 5,
      scroll: SCROLL,
    });
    seekTo(50); // a keyboard or button seek far to the right
    const view = store.getView();
    const x = xOf(view, 50);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(view.laneWidth);
  });

  it("a seek that lands while a trim drag is in progress does not move the view under it", () => {
    const { store, seekTo, container } = renderEditable({
      items: sixtySeconds,
      selectedItemId: "a",
      timelineTime: 5,
      scroll: SCROLL,
    });
    const handle = captureStubs(
      container.querySelector('[data-trim-handle="start"]') as HTMLElement,
    );
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: LANE_LEFT });
    const before = store.getState().scroll;
    seekTo(50); // the playhead moves for some other reason mid-drag
    expect(store.getState().scroll).toBe(before);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: LANE_LEFT });
    seekTo(55); // once the drag is over, an off-screen seek is revealed again
    expect(xOf(store.getView(), 55)).toBeGreaterThanOrEqual(0);
    expect(xOf(store.getView(), 55)).toBeLessThanOrEqual(LANE_WIDTH);
  });
});

/**
 * A handle that goes away in the middle of its own drag (NIW2-667 review R2-1). The trim and
 * slide handles render only while their clip is selected, and Esc runs the page's
 * clearSelection() (unlike split and delete it is not held back while a drag owns the scene).
 * The handle held pointer capture: when a captured element leaves the DOM the browser sends
 * `lostpointercapture` to the document, so React's onLostPointerCapture never runs and the
 * drag's own finish() is never called. Two things then stayed wrong for good: the strip's
 * "a handle is being dragged" flag (a paused seek no longer scrolled an off-screen playhead
 * into view) and the page's begin/endInteract pair (the scene stayed "owned by a drag").
 */
describe("a handle that goes away in the middle of its drag", () => {
  const slides = toLayout([
    {
      id: "s1",
      kind: "slide",
      assetId: "x",
      duration: 40,
      naturalWidth: 1920,
      naturalHeight: 1080,
    },
    { id: "b", kind: "clip", sourceStart: 0, sourceEnd: 60 },
  ] as TrackItem[]);

  interface Case {
    name: string;
    layout: LayoutEntry[];
    selected: string;
    handle: string;
  }
  const cases: Case[] = [
    { name: "trim", layout: twoClips, selected: "a", handle: '[data-trim-handle="end"]' },
    { name: "slide-duration", layout: slides, selected: "s1", handle: "[data-slide-handle]" },
  ];

  function setup(c: Case): {
    store: TimelineViewStore;
    container: HTMLElement;
    onTrim: Mock;
    onSlideDuration: Mock;
    show: (selectedItemId: string | null, timelineTime?: number) => void;
  } {
    const onTrim = vi.fn();
    const onSlideDuration = vi.fn();
    const props = (selectedItemId: string | null, timelineTime: number): StripProps => ({
      layout: c.layout,
      selectedItemId,
      onTrim,
      onSlideDuration,
      slideUrlFor: () => null,
      playback: makePlayback({ timelineTime }),
    });
    // 100 s at 4x scrolled 1200: the lane shows 30..55 s; the playhead (5 s) is off to the left.
    const r = renderZoomed(props(c.selected, 5));
    return {
      store: r.store,
      container: r.container,
      onTrim,
      onSlideDuration,
      show: (selectedItemId, timelineTime = 5) =>
        r.rerender(strip(r.store, props(selectedItemId, timelineTime))),
    };
  }

  const ends = (spy: Mock, phaseIndex: number): unknown[][] =>
    spy.mock.calls.filter((call) => call[phaseIndex] === "end");

  const inView = (store: TimelineViewStore, time: number): boolean => {
    const x = xOf(store.getView(), time);
    return x >= 0 && x <= LANE_WIDTH;
  };

  describe.each(cases)("a $name handle", (c) => {
    it("is released when the clip is deselected mid-drag (Esc): the drag is reported as ended once", () => {
      const { container, onTrim, onSlideDuration, show } = setup(c);
      const handle = captureStubs(container.querySelector(c.handle) as HTMLElement);
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: LANE_LEFT + 400 });
      expect(ends(onTrim, 3)).toHaveLength(0);
      expect(ends(onSlideDuration, 2)).toHaveLength(0);

      show(null); // Esc → clearSelection(): the handle unmounts under the pointer
      expect(container.querySelector(c.handle)).toBeNull();
      // The page maps "end" to endInteract(): without it the scene stays owned by the drag.
      expect(ends(onTrim, 3)).toHaveLength(c.name === "trim" ? 1 : 0);
      expect(ends(onSlideDuration, 2)).toHaveLength(c.name === "trim" ? 0 : 1);
    });

    it("lets a paused seek far off screen be revealed again after that", () => {
      const { store, container, show } = setup(c);
      const handle = captureStubs(container.querySelector(c.handle) as HTMLElement);
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: LANE_LEFT + 400 });
      show(null);
      const before = store.getState().scroll;
      show(null, 90); // a keyboard or button seek to 90 s, nowhere near the lane
      expect(inView(store, 90)).toBe(true);
      expect(store.getState().scroll).not.toBe(before);
    });

    it("also lets go when another clip is selected instead", () => {
      const { store, container, show } = setup(c);
      const other = "b"; // a clip both layouts have
      const handle = captureStubs(container.querySelector(c.handle) as HTMLElement);
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: LANE_LEFT + 400 });
      show(other);
      show(other, 90);
      expect(inView(store, 90)).toBe(true);
    });

    it("an ordinary drag that ends with pointerup still ends exactly once, and deselecting afterwards adds nothing", () => {
      const { store, container, onTrim, onSlideDuration, show } = setup(c);
      const handle = captureStubs(container.querySelector(c.handle) as HTMLElement);
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: LANE_LEFT + 400 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: LANE_LEFT + 440 });
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: LANE_LEFT + 440 });
      const trimEnds = ends(onTrim, 3).length;
      const slideEnds = ends(onSlideDuration, 2).length;
      expect(trimEnds + slideEnds).toBe(1);

      show(null); // the drag is over: nothing is left to end
      expect(ends(onTrim, 3)).toHaveLength(trimEnds);
      expect(ends(onSlideDuration, 2)).toHaveLength(slideEnds);
      show(null, 90);
      expect(inView(store, 90)).toBe(true);
    });

    it("while the drag is live, a seek still does not move the view under it", () => {
      const { store, container, show } = setup(c);
      const handle = captureStubs(container.querySelector(c.handle) as HTMLElement);
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: LANE_LEFT + 400 });
      const before = store.getState().scroll;
      show(c.selected, 90);
      expect(store.getState().scroll).toBe(before);
    });
  });
});

/**
 * The strip measures its lane with a ResizeObserver. An element that is hidden (a collapsed
 * panel) or not laid out yet reports a 0 px lane; that is "not measurable", not "a lane that
 * shrank to nothing", and must not cost the user the zoom they chose (R2-4).
 */
describe("a lane that measures 0 px", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not reset the zoom: it is still 4x, at the same left edge, when the lane returns", () => {
    const callbacks: Array<() => void> = [];
    class FakeResizeObserver {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const resized = (): void => act(() => callbacks.forEach((callback) => callback()));

    const { store } = renderZoomed();
    const leftEdge = (): number => timeAt(store.getView(), LANE_LEFT, LANE_LEFT);
    expect(store.getState().zoom).toBe(ZOOM);
    expect(leftEdge()).toBeCloseTo(30, 6); // 4x scrolled 1200 px: the lane starts at 30 s

    // The strip is hidden: everything measures 0.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rectOf(0, 0));
    resized();
    expect(store.getState().zoom).toBe(ZOOM);

    // It is shown again, as wide as before.
    stubGeometry();
    resized();
    expect(store.getState().zoom).toBe(ZOOM);
    expect(leftEdge()).toBeCloseTo(30, 6);
  });

  it("puts the DOM scroll back when the lane returns at the SAME width after the browser reset it", () => {
    const callbacks: Array<() => void> = [];
    class FakeResizeObserver {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const resized = (): void => act(() => callbacks.forEach((callback) => callback()));

    const { store, body } = renderZoomed();
    expect(body.scrollLeft).toBe(SCROLL);

    // Hidden (display: none): the lane measures 0 and the browser may drop scrollLeft to 0.
    // The store ignores the 0 and keeps its scroll, so nothing in it changes to re-run the
    // strip's layout effect.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rectOf(0, 0));
    resized();
    body.scrollLeft = 0;
    expect(store.getState().scroll).toBe(SCROLL);

    // Shown again at exactly the width it had: setLaneWidth commits nothing, so only the
    // strip's own measure callback can put the element back where the store says it is.
    stubGeometry();
    const scrollTo = vi.spyOn(store, "scrollTo");
    resized();
    expect(store.getState().scroll).toBe(SCROLL);
    expect(body.scrollLeft).toBe(SCROLL);

    // The scroll event that write causes is the strip's own echo, not the user panning.
    act(() => {
      fireEvent.scroll(body);
    });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(store.getState().scroll).toBe(SCROLL);
  });
});

/**
 * `data-scrolled` on the scroll container (NIW2-667 review R2-2). The sticky label column
 * fills the gap to the lane with a shadow so scrolled content cannot show through it; that fill
 * must exist only while the content IS scrolled, or it covers what sits in the gap at scroll 0
 * (the start handle of a clip at t=0, the playhead's head at t=0). The stylesheet hangs those
 * fills on this attribute; editor-layout-css.test.ts pins the stylesheet side.
 */
describe("the scrolled marker on the scroll container", () => {
  const scrolled = (body: HTMLElement): string | undefined => body.dataset.scrolled;

  function renderAtFit(): Rendered {
    stubGeometry();
    const store = createTimelineViewStore();
    store.setDuration(100);
    const utils = render(strip(store));
    return {
      store,
      container: utils.container,
      body: utils.container.querySelector('[data-testid="timeline-scroller"]') as HTMLElement,
      rerender: utils.rerender,
    };
  }

  it("is false at fit, where there is nothing to scroll", () => {
    const { body } = renderAtFit();
    expect(scrolled(body)).toBe("false");
  });

  it("is false when zoomed but still at the start, true once scrolled, false again back at 0", () => {
    const { store, body } = renderAtFit();
    act(() => store.zoomTo(ZOOM)); // around the centre of the lane: scrolls to 1500 px
    expect(store.getState().scroll).toBeGreaterThan(0);
    expect(scrolled(body)).toBe("true");
    act(() => store.scrollTo(0, "user"));
    expect(scrolled(body)).toBe("false");
    act(() => store.scrollTo(300, "user"));
    expect(scrolled(body)).toBe("true");
    act(() => store.scrollTo(0, "user"));
    expect(scrolled(body)).toBe("false");
  });

  it("follows a pan by the user (a scroll event) and FIT", () => {
    const { store, body } = renderZoomed();
    expect(scrolled(body)).toBe("true");
    act(() => {
      body.scrollLeft = 0;
      fireEvent.scroll(body);
    });
    expect(store.getState().scroll).toBe(0);
    expect(scrolled(body)).toBe("false");
    act(() => {
      body.scrollLeft = 300;
      fireEvent.scroll(body);
    });
    expect(scrolled(body)).toBe("true");
    act(() => store.fit());
    expect(scrolled(body)).toBe("false");
  });

  it("is true for any scroll above 0, however small", () => {
    const { store, body } = renderAtFit();
    act(() => store.zoomTo(ZOOM));
    act(() => store.scrollTo(0.25, "user"));
    expect(scrolled(body)).toBe("true");
  });
});

/**
 * Which ruler ticks keep their label. A labelled tick this close to the right END of the
 * content keeps its line but drops its text, which would hang past the end. The room is
 * measured in pixels against the content's right edge, not as a share of the whole
 * timeline: at 16x the old "last 4 %" rule left the final 4 s of a 100 s take without any
 * label, which is about two thirds of the screenful at the end.
 */
describe("ruler labels near the end of the content", () => {
  function rulerLabels(container: HTMLElement): string[] {
    const ruler = container.querySelector('[data-testid="ruler"]') as HTMLElement;
    return Array.from(ruler.querySelectorAll("span"))
      .map((el) => el.textContent ?? "")
      .filter(Boolean);
  }

  function clipOf(duration: number): LayoutEntry[] {
    return toLayout([
      { id: "a", kind: "clip", sourceStart: 0, sourceEnd: duration },
    ] as TrackItem[]);
  }

  /** The rule as it was at 1x (before zoom): drop a label from 96 % of the ruler on. */
  function labelsAtFit(duration: number): string[] {
    return rulerTicks(duration)
      .filter((tick) => timeToFraction(tick.time, duration) < 0.96)
      .map((tick) => tick.label);
  }

  function renderAt(duration: number, zoom: number, scroll: number): HTMLElement {
    stubGeometry();
    const store = createTimelineViewStore();
    store.setDuration(duration);
    const { container } = render(
      strip(store, { layout: clipOf(duration), playback: makePlayback({ duration }) }),
    );
    act(() => {
      store.zoomTo(zoom);
      store.scrollTo(scroll, "user");
    });
    return container;
  }

  it.each([100, 125, 140, 59, 600, 3600])(
    "at 1x the labels are exactly the ones the old rule kept (%s s)",
    (duration) => {
      const container = renderAt(duration, 1, 0);
      expect(rulerLabels(container)).toEqual(labelsAtFit(duration));
    },
  );

  it("at 1x a tick exactly at 96 % is dropped, as before (120 s of 125 s)", () => {
    const container = renderAt(125, 1, 0);
    expect(rulerLabels(container)).not.toContain("2:00");
    expect(rulerLabels(container)).toContain("1:45");
  });

  it("at 16x the final viewport of a 100 s take is labelled, up to the last second but one", () => {
    // 160 px/s, a label every second, scrolled to the end: the lane shows 93.75..100 s.
    const labels = rulerLabels(renderAt(100, 16, 1e9));
    for (const label of ["1:34", "1:35", "1:36", "1:37", "1:38", "1:39"]) {
      expect(labels).toContain(label);
    }
    // 1:40 sits ON the end: its text would hang past it, so only its line is drawn.
    expect(labels).not.toContain("1:40");
  });

  it("scrolling at a fixed zoom moves the labelled window: the memoised ruler marks follow the scroll", () => {
    // The strip memoises the ruler's spans (NIW2-662) on the duration, the zoom and the window on
    // screen. A scroll alone changes only the window, so it must still rebuild them.
    stubGeometry();
    const store = createTimelineViewStore();
    store.setDuration(100);
    const { container } = render(
      strip(store, { layout: clipOf(100), playback: makePlayback({ duration: 100 }) }),
    );
    act(() => {
      store.zoomTo(16);
      store.scrollTo(0, "user");
    });
    const atStart = rulerLabels(container);
    expect(atStart).toContain("0:01");
    expect(atStart).not.toContain("1:35");

    act(() => store.scrollTo(1e9, "user"));
    const atEnd = rulerLabels(container);
    expect(atEnd).toContain("1:35");
    expect(atEnd).not.toContain("0:01");

    act(() => store.scrollTo(0, "user"));
    expect(rulerLabels(container)).toEqual(atStart);
  });

  it("at the deepest zoom of a 10-minute take (240 px/s) the last seconds are labelled too", () => {
    // Half-second labels, 120 px apart, the lane shows 595.8..600 s. The old rule dropped
    // every label from 576 s on, so this stretch of the ruler was blank.
    const labels = rulerLabels(renderAt(600, 1e9, 1e9));
    for (const label of ["9:56.0", "9:57.0", "9:58.0", "9:59.0", "9:59.5"]) {
      expect(labels).toContain(label);
    }
    expect(labels).not.toContain("10:00.0");
  });
});

describe("the playhead stays aligned with the ruler", () => {
  it("lives inside the scroll container, so it scrolls with the lanes it points into", () => {
    const { container, body } = renderZoomed({ playback: makePlayback({ timelineTime: 42.5 }) });
    const playhead = container.querySelector<HTMLElement>("[style*='left: 42.5%']");
    expect(playhead).not.toBeNull();
    expect(body.contains(playhead)).toBe(true);
  });

  it("is placed by the same share of the content as the ruler's tick for that time", () => {
    const { container } = renderZoomed({ playback: makePlayback({ timelineTime: 40 }) });
    const ruler = container.querySelector('[data-testid="ruler"]') as HTMLElement;
    const ticks = Array.from(ruler.querySelectorAll<HTMLElement>("span")).map(
      (el) => el.style.left,
    );
    // 100 s at 4x labels every 5 s: 40 s is a labelled tick at 40%.
    expect(ticks).toContain("40%");
    expect(container.querySelector("[style*='left: 40%']")).not.toBeNull();
  });
});

describe("thumbnails at high zoom", () => {
  const thumbnails = Array.from({ length: 24 }, (_, i) => ({
    sourceTime: 5 + i * 10,
    url: `u${i}`,
  }));
  const long = toLayout([{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 240 }] as TrackItem[]);

  it("draws only the tiles in view, and leaves no blank stretch in them", () => {
    stubGeometry();
    const store = createTimelineViewStore();
    store.setDuration(240);
    const { container } = render(
      strip(store, { layout: long, playback: makePlayback({ duration: 240 }), thumbnails }),
    );
    act(() => {
      store.zoomTo(16);
      store.scrollTo(5000, "user");
    });
    const view = store.getView();
    const content = view.zoom * LANE_WIDTH;
    const imgs = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs.length).toBeLessThan(30); // ~178 tiles in all; a screenful here
    // Every pixel of the visible window [scroll, scroll + lane] is under some tile.
    const spans = imgs
      .map((img) => ({
        from: (parseFloat(img.style.left) / 100) * content,
        to: ((parseFloat(img.style.left) + parseFloat(img.style.width)) / 100) * content,
      }))
      .sort((a, b) => a.from - b.from);
    let covered = view.scroll;
    for (const span of spans) {
      if (span.from > covered + 0.5) break; // a gap: stop, the check below fails
      covered = Math.max(covered, span.to);
    }
    expect(covered).toBeGreaterThanOrEqual(view.scroll + LANE_WIDTH - 0.5);
    // ...and the tile count is what the geometry module says.
    const scale = (view.zoom * LANE_WIDTH) / 240;
    const { tiles } = thumbnailTiles({
      timelineStart: 0,
      timelineEnd: 240,
      sourceStart: 0,
      sourceEnd: 240,
      scale,
      visible: { start: view.scroll / scale, end: (view.scroll + LANE_WIDTH) / scale },
    });
    expect(imgs).toHaveLength(tiles.length);
  });

  it("scrolling swaps the tiles: the ones that left the window are gone", () => {
    stubGeometry();
    const store = createTimelineViewStore();
    store.setDuration(240);
    const { container } = render(
      strip(store, { layout: long, playback: makePlayback({ duration: 240 }), thumbnails }),
    );
    act(() => {
      store.zoomTo(16);
      store.scrollTo(0, "user");
    });
    const first = container.querySelectorAll("img").length;
    act(() => store.scrollTo(8000, "user"));
    const second = container.querySelectorAll("img").length;
    expect(first).toBeLessThan(30);
    expect(second).toBeLessThan(30);
  });

  it("the ruler is windowed too: a 4-minute take at 16x does not build every tick", () => {
    stubGeometry();
    const store = createTimelineViewStore();
    store.setDuration(240);
    const { container } = render(
      strip(store, { layout: long, playback: makePlayback({ duration: 240 }), thumbnails }),
    );
    act(() => {
      store.zoomTo(16);
      store.scrollTo(5000, "user");
    });
    const ruler = container.querySelector('[data-testid="ruler"]') as HTMLElement;
    expect(ruler.querySelectorAll("span").length).toBeLessThan(80);
  });
});
