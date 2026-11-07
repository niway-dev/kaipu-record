import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { contentWidth, maxZoom, scaleOf, timeAt, xOf, ZOOM_STEP } from "./components/timeline-view";
import {
  createTimelineViewStore,
  useTimelineMaxZoom,
  useTimelineViewState,
  useTimelineViewStore,
  useTimelineZoom,
} from "./use-timeline-view";

function makeStore(laneWidth = 1000, duration = 100) {
  const store = createTimelineViewStore();
  store.setDuration(duration);
  store.setLaneWidth(laneWidth);
  return store;
}

describe("the timeline view store", () => {
  it("starts at fit: zoom 1, scroll 0 (the editor opens showing the whole recording)", () => {
    const store = makeStore();
    expect(store.getState()).toEqual({ zoom: 1, scroll: 0, laneWidth: 1000 });
    expect(store.getView()).toEqual({ zoom: 1, scroll: 0, laneWidth: 1000, duration: 100 });
  });

  it("zoomStep steps by the square root of two around the centre of the visible window", () => {
    const store = makeStore();
    store.zoomStep(1);
    expect(store.getState().zoom).toBeCloseTo(ZOOM_STEP, 9);
    // The centre of a fit view is 50 s; it must still be the centre after the step.
    const view = store.getView();
    expect(timeAt(view, 500, 0)).toBeCloseTo(50, 6);
    store.zoomStep(-1);
    expect(store.getState().zoom).toBe(1);
    expect(store.getState().scroll).toBe(0);
  });

  it("two + steps double the zoom and keep the centre fixed when scrolled", () => {
    const store = makeStore();
    store.zoomTo(4);
    store.scrollTo(1000, "user");
    const centreBefore = timeAt(store.getView(), 500, 0);
    store.zoomStep(1);
    store.zoomStep(1);
    expect(store.getState().zoom).toBeCloseTo(8, 9);
    expect(timeAt(store.getView(), 500, 0)).toBeCloseTo(centreBefore, 6);
  });

  it("zoomTo sets an absolute zoom and clamps it to the maximum", () => {
    const store = makeStore();
    store.zoomTo(1e9);
    expect(store.getState().zoom).toBeCloseTo(maxZoom(1000, 100), 9);
    store.zoomTo(0.1);
    expect(store.getState().zoom).toBe(1);
  });

  it("zoomAtPointer keeps the time under the pointer on the same pixel", () => {
    const store = makeStore();
    const laneLeft = 120;
    const clientX = laneLeft + 300;
    const t = timeAt(store.getView(), clientX, laneLeft);
    store.zoomAtPointer(4, clientX, laneLeft);
    expect(store.getState().zoom).toBe(4);
    expect(timeAt(store.getView(), clientX, laneLeft)).toBeCloseTo(t, 6);
  });

  it("FIT returns to 1x and scroll 0", () => {
    const store = makeStore();
    store.zoomTo(6);
    store.scrollTo(2000, "user");
    store.fit();
    expect(store.getState()).toEqual({ zoom: 1, scroll: 0, laneWidth: 1000 });
  });

  it("clamps scroll to the content, so a scrollbar overshoot cannot leave the timeline empty", () => {
    const store = makeStore();
    store.zoomTo(4);
    store.scrollTo(99_999, "user");
    expect(store.getState().scroll).toBe(contentWidth(store.getView()) - 1000);
    store.scrollTo(-10, "user");
    expect(store.getState().scroll).toBe(0);
  });

  it("re-clamps scroll and zoom when the duration shrinks (deleting a clip while zoomed)", () => {
    const store = makeStore();
    store.zoomTo(20);
    store.scrollTo(15_000, "user");
    store.setDuration(10); // most of the timeline is gone
    const view = store.getView();
    expect(view.zoom).toBeLessThanOrEqual(maxZoom(1000, 10));
    expect(view.scroll).toBeLessThanOrEqual(Math.max(0, contentWidth(view) - 1000));
    expect(store.getState().zoom).toBe(view.zoom);
    expect(store.getState().scroll).toBe(view.scroll);
  });

  it("keeps the apparent zoom through a cut that still allows it", () => {
    const store = makeStore();
    store.zoomTo(4);
    store.setDuration(60);
    expect(store.getState().zoom).toBe(4);
  });

  it("re-clamps when the lane resizes", () => {
    const store = makeStore();
    store.zoomTo(4);
    store.scrollTo(3000, "user");
    store.setLaneWidth(2000);
    const view = store.getView();
    expect(view.scroll).toBeLessThanOrEqual(contentWidth(view) - 2000);
  });

  it("notifies subscribers once per change and never when nothing changed", () => {
    const store = makeStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.zoomTo(2);
    expect(listener).toHaveBeenCalledTimes(1);
    store.zoomTo(2);
    store.setLaneWidth(1000);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.zoomTo(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("gives useSyncExternalStore a stable snapshot until something changes", () => {
    const store = makeStore();
    const before = store.getState();
    expect(store.getState()).toBe(before);
    store.zoomTo(2);
    expect(store.getState()).not.toBe(before);
  });
});

/**
 * The time at the lane's LEFT edge is what the user is looking at, so a resize or a cut must
 * not change it. The scroll is in pixels and the scale (pixels per second) moves with the
 * lane width and with the duration, so keeping the pixels would move the window: 60 s at 4x
 * in a 1200 px lane shows from 30 s at scroll 2400, and the same 2400 px in a 900 px lane
 * would show from 40 s.
 */
describe("the time at the left edge survives a resize and a cut", () => {
  const leftEdge = (store: ReturnType<typeof makeStore>): number => timeAt(store.getView(), 0, 0);

  function zoomedAt30s() {
    const store = makeStore(1200, 60);
    store.zoomTo(4); // 80 px/s
    store.scrollTo(2400, "user"); // the lane shows 30..45 s
    return store;
  }

  it("a narrower lane rescales the scroll (1200 → 900 px)", () => {
    const store = zoomedAt30s();
    expect(leftEdge(store)).toBeCloseTo(30, 9);
    store.setLaneWidth(900);
    expect(leftEdge(store)).toBeCloseTo(30, 9); // not 40 s
    expect(store.getState().scroll).toBeCloseTo(1800, 9); // 2400 x 900 / 1200
  });

  it("a wider lane rescales it too (1200 → 1600 px)", () => {
    const store = zoomedAt30s();
    store.setLaneWidth(1600);
    expect(leftEdge(store)).toBeCloseTo(30, 9);
    expect(store.getState().scroll).toBeCloseTo(3200, 9);
  });

  it("keeps the left edge when the resize also lowers the deepest zoom", () => {
    // 100 s in 1000 px zooms at most 24x; in 2000 px, 12x, so the 20x the user had is
    // clamped to 12x. Scaling the scroll by the lane ratio alone (20000 px) would put the
    // window at 83 s; the time at the left edge is 50 s.
    const store = makeStore(1000, 100);
    store.zoomTo(20);
    store.scrollTo(10_000, "user");
    expect(leftEdge(store)).toBeCloseTo(50, 9);
    store.setLaneWidth(2000);
    expect(store.getState().zoom).toBeCloseTo(12, 9);
    expect(leftEdge(store)).toBeCloseTo(50, 9);
  });

  it("a cut keeps the time at the left edge (100 s → 60 s at 4x)", () => {
    const store = makeStore(1000, 100);
    store.zoomTo(4); // 40 px/s
    store.scrollTo(1200, "user"); // the lane shows 30..55 s
    expect(leftEdge(store)).toBeCloseTo(30, 9);
    store.setDuration(60); // 66.7 px/s now
    expect(leftEdge(store)).toBeCloseTo(30, 9);
    expect(store.getState().scroll).toBeCloseTo(2000, 9);
  });

  it("a longer take (a slide stretched) keeps it too", () => {
    const store = makeStore(1000, 100);
    store.zoomTo(4);
    store.scrollTo(1200, "user");
    store.setDuration(120);
    expect(leftEdge(store)).toBeCloseTo(30, 9);
  });

  it("a cut that ends before the old left edge clamps to the end of the shorter take", () => {
    // Scrolled to the very end of 100 s (left edge 75 s), then cut to 60 s: 75 s is gone,
    // so the view lands on the last lane of what is left, not past it.
    const store = makeStore(1000, 100);
    store.zoomTo(4);
    store.scrollTo(99_999, "user");
    expect(leftEdge(store)).toBeCloseTo(75, 9);
    store.setDuration(60);
    const view = store.getView();
    expect(view.zoom).toBe(4);
    expect(store.getState().scroll).toBeCloseTo(contentWidth(view) - 1000, 9);
    expect(leftEdge(store)).toBeCloseTo(45, 9);
  });

  it("a cut that also lowers the deepest zoom keeps the left edge until the end clamps it", () => {
    const store = makeStore(1000, 100);
    store.zoomTo(20); // 200 px/s
    store.scrollTo(10_000, "user"); // left edge 50 s
    store.setDuration(40); // deepest zoom 9.6x: 240 px/s
    const view = store.getView();
    expect(view.zoom).toBeCloseTo(9.6, 9);
    // 50 s is past the end of a 40 s take: the window ends at the end.
    expect(store.getState().scroll).toBeCloseTo(contentWidth(view) - 1000, 9);
  });

  it("a trim drag (the duration moving every frame) does not drift the window", () => {
    const store = makeStore(1000, 60);
    store.zoomTo(4);
    store.scrollTo(1200, "user"); // left edge 18 s
    for (let i = 1; i <= 120; i++) store.setDuration(60 - i * 0.05);
    expect(leftEdge(store)).toBeCloseTo(18, 6);
  });

  it("changes nothing, and tells nobody, when the duration or the lane stays the same", () => {
    const store = zoomedAt30s();
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setDuration(60);
    store.setLaneWidth(1200);
    expect(listener).not.toHaveBeenCalled();
    expect(store.getState()).toBe(before);
  });

  it("an unmeasured lane has no window to keep: the first width leaves the scroll alone", () => {
    const store = createTimelineViewStore();
    store.setDuration(100);
    store.setLaneWidth(1000);
    expect(store.getState()).toEqual({ zoom: 1, scroll: 0, laneWidth: 1000 });
  });

  // A lane that measures 0 px is not a lane that got narrower: the element is hidden (a
  // collapsed panel, a background tab) or a ResizeObserver fired before layout. Taking it at
  // its word clamps the zoom to 1 (nothing can be zoomed in a 0 px lane) and the scroll to 0,
  // and the zoom the user chose is gone when the lane comes back (NIW2-667 review R2-4).
  it("ignores a lane that measures 0 px: the zoom and the window are still there when it returns", () => {
    const store = zoomedAt30s();
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setLaneWidth(0);
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    store.setLaneWidth(1200);
    expect(store.getState().zoom).toBe(4);
    expect(leftEdge(store)).toBeCloseTo(30, 6);
  });

  it("keeps the zoom and the left edge when the lane returns at another width", () => {
    const store = zoomedAt30s();
    store.setLaneWidth(0);
    store.setLaneWidth(900); // came back narrower: rescaled as any resize is
    expect(store.getState().zoom).toBe(4);
    expect(leftEdge(store)).toBeCloseTo(30, 6);
  });

  it("ignores a negative or non-numeric width the same way", () => {
    const store = zoomedAt30s();
    const before = store.getState();
    store.setLaneWidth(-20);
    store.setLaneWidth(Number.NaN);
    expect(store.getState()).toBe(before);
  });
});

describe("following the playhead", () => {
  function zoomed() {
    const store = makeStore();
    store.zoomTo(4); // 40 px/s, the lane shows 25 s
    store.scrollTo(0, "follow"); // zoomTo centred the view; start from the left
    store.resumeFollow(); // play was pressed
    return store;
  }

  it("scrolls when the playing playhead passes 80% of the lane and keeps it visible", () => {
    const store = zoomed();
    expect(store.getState().scroll).toBe(0);
    store.follow(10); // x = 400: left of the mark
    expect(store.getState().scroll).toBe(0);
    store.follow(21); // x = 840: past the mark
    const view = store.getView();
    expect(view.scroll).toBeGreaterThan(0);
    expect(xOf(view, 21)).toBeGreaterThanOrEqual(0);
    expect(xOf(view, 21)).toBeLessThan(1000 * 0.8);
  });

  it("stops following once the user pans, until the next play", () => {
    const store = zoomed();
    store.scrollTo(100, "user"); // the user took over
    store.follow(60);
    expect(store.getState().scroll).toBe(100);
    store.resumeFollow(); // play pressed
    store.follow(60);
    expect(store.getState().scroll).toBeGreaterThan(100);
  });

  it("a scroll that is not a pan does not take the view from the playhead", () => {
    const store = zoomed();
    store.follow(21);
    const after = store.getState().scroll;
    store.scrollTo(after, "follow"); // a scroll that is not a pan (production never sends "follow")
    store.follow(45);
    expect(store.getState().scroll).toBeGreaterThan(after);
  });

  // Only a PAN takes the view out of the playhead's hands. A zoom keeps the anchor the user
  // chose (the centre, or the pointer) and the next playback tick turns the page if the
  // playhead ended up outside the lane.
  it.each([
    [
      "+ and − (twice)",
      (store: ReturnType<typeof makeStore>) => {
        store.zoomStep(1);
        store.zoomStep(1);
      },
    ],
    ["the slider", (store: ReturnType<typeof makeStore>) => store.zoomTo(8)],
    ["⌘ + wheel / pinch", (store: ReturnType<typeof makeStore>) => store.zoomAtPointer(2, 500, 0)],
  ])(
    "zooming with %s keeps following: the playhead is back in the lane on the next tick",
    (_name, zoom) => {
      const store = zoomed(); // 4x: 40 px/s, the lane shows 0..25 s
      store.follow(20); // x = 800, at the mark: no scroll yet
      expect(store.getState().scroll).toBe(0);
      zoom(store); // 8x around the centre (12.5 s): the playhead at 20 s is now at x = 1100
      expect(xOf(store.getView(), 20)).toBeGreaterThan(1000); // off the right edge for now
      store.follow(20); // the next tick
      const x = xOf(store.getView(), 20);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1000 * 0.8);
    },
  );

  it("a pan then a zoom still does not follow, until the next play", () => {
    const store = zoomed();
    store.scrollTo(100, "user"); // the user took over
    store.zoomStep(1); // a zoom must not give the view back
    const scroll = store.getState().scroll;
    store.follow(90);
    expect(store.getState().scroll).toBe(scroll);
    store.resumeFollow(); // play pressed
    store.follow(90);
    expect(store.getState().scroll).toBeGreaterThan(scroll);
  });

  it("reveal scrolls to an off-screen time even after the user took over, but not a visible one", () => {
    const store = zoomed();
    store.scrollTo(100, "user");
    store.reveal(10); // visible (x = 300): no move
    expect(store.getState().scroll).toBe(100);
    store.reveal(90); // off screen
    expect(xOf(store.getView(), 90)).toBeGreaterThanOrEqual(0);
    expect(xOf(store.getView(), 90)).toBeLessThanOrEqual(1000);
  });

  it("does nothing at fit", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.follow(99);
    store.reveal(99);
    expect(listener).not.toHaveBeenCalled();
    expect(scaleOf(store.getView())).toBe(10);
  });
});

describe("the hooks", () => {
  it("useTimelineViewStore gives one stable store and keeps its duration current", () => {
    const { result, rerender } = renderHook(({ d }) => useTimelineViewStore(d), {
      initialProps: { d: 100 },
    });
    const store = result.current;
    store.setLaneWidth(1000);
    expect(store.getView().duration).toBe(100);
    rerender({ d: 40 });
    expect(result.current).toBe(store);
    expect(store.getView().duration).toBe(40);
  });

  it("useTimelineZoom re-renders on a zoom change but not on a scroll", () => {
    const store = makeStore();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useTimelineZoom(store);
    });
    expect(result.current).toBe(1);
    const baseline = renders;
    act(() => store.zoomTo(4));
    expect(result.current).toBe(4);
    const afterZoom = renders;
    expect(afterZoom).toBeGreaterThan(baseline);
    act(() => store.scrollTo(500, "user"));
    expect(renders).toBe(afterZoom);
  });

  it("useTimelineMaxZoom follows a cut even when the zoom itself did not move", () => {
    const store = makeStore();
    const { result } = renderHook(() => useTimelineMaxZoom(store));
    expect(result.current).toBeCloseTo(maxZoom(1000, 100), 9);
    act(() => store.setDuration(50)); // zoom 1 stays 1, but 50 s zooms half as deep
    expect(result.current).toBeCloseTo(maxZoom(1000, 50), 9);
  });

  it("useTimelineViewState re-renders on every state change", () => {
    const store = makeStore();
    const { result } = renderHook(() => useTimelineViewState(store));
    act(() => store.zoomTo(4));
    act(() => store.scrollTo(500, "user"));
    expect(result.current).toEqual({ zoom: 4, scroll: 500, laneWidth: 1000 });
  });
});
