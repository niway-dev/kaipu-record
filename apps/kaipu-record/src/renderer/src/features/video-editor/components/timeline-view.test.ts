import { describe, expect, it } from "vitest";
import {
  FOLLOW_EDGE,
  MAX_PX_PER_SECOND,
  clampView,
  contentWidth,
  fitView,
  followPlayhead,
  formatZoom,
  keepLeftEdge,
  maxZoom,
  panBy,
  revealTime,
  scaleOf,
  sliderToZoom,
  timeAt,
  timeDelta,
  visibleRange,
  wheelZoomFactor,
  xOf,
  zoomAt,
  zoomToSlider,
  type TimelineView,
} from "./timeline-view";

// A 100 s timeline in a 1000 px lane: 10 px per second at fit.
const LANE_LEFT = 120;
const fit = fitView(1000, 100);

function viewAt(zoom: number, scroll: number): TimelineView {
  return clampView({ ...fit, zoom, scroll });
}

describe("fitView", () => {
  it("is 1x with scroll 0: the whole recording in the lane, as before zoom existed", () => {
    expect(fit).toEqual({ zoom: 1, scroll: 0, laneWidth: 1000, duration: 100 });
    expect(scaleOf(fit)).toBe(10);
    expect(contentWidth(fit)).toBe(1000);
  });

  it("an empty timeline or an unmeasured lane has no scale and converts everything to 0", () => {
    expect(scaleOf(fitView(1000, 0))).toBe(0);
    expect(scaleOf(fitView(0, 100))).toBe(0);
    expect(timeAt(fitView(1000, 0), 500, LANE_LEFT)).toBe(0);
    expect(timeAt(fitView(0, 100), 500, LANE_LEFT)).toBe(0);
    expect(xOf(fitView(0, 100), 5)).toBe(0);
  });
});

describe("maxZoom", () => {
  it("is the zoom at which one second is MAX_PX_PER_SECOND wide", () => {
    // fit = 10 px/s, so 240 px/s is 24x.
    expect(maxZoom(1000, 100)).toBeCloseTo(MAX_PX_PER_SECOND / 10);
  });

  it("is never below 1x: a recording already wider than the maximum cannot zoom out of fit", () => {
    // 2 s in 1000 px is 500 px/s at fit, past the 240 px/s cap.
    expect(maxZoom(1000, 2)).toBe(1);
  });

  it("is 1x while the lane or the timeline is unmeasured", () => {
    expect(maxZoom(0, 100)).toBe(1);
    expect(maxZoom(1000, 0)).toBe(1);
  });
});

describe("clampView", () => {
  it("keeps zoom within [1, maxZoom]", () => {
    expect(clampView({ ...fit, zoom: 0.2 }).zoom).toBe(1);
    expect(clampView({ ...fit, zoom: 1000 }).zoom).toBeCloseTo(24);
  });

  it("keeps scroll within [0, contentWidth - laneWidth]", () => {
    expect(clampView({ ...fit, zoom: 4, scroll: -50 }).scroll).toBe(0);
    expect(clampView({ ...fit, zoom: 4, scroll: 99_999 }).scroll).toBe(3000);
    expect(clampView({ ...fit, zoom: 1, scroll: 300 }).scroll).toBe(0);
  });

  it("repairs non-finite input instead of spreading NaN into every lane", () => {
    const view = clampView({
      zoom: Number.NaN,
      scroll: Number.NaN,
      laneWidth: 1000,
      duration: 100,
    });
    expect(view.zoom).toBe(1);
    expect(view.scroll).toBe(0);
  });
});

describe("timeAt and xOf", () => {
  it.each([
    [1, 0],
    [2, 0],
    [2, 500],
    [4, 0],
    [4, 1500],
    [4, 3000],
    [16, 0],
    [16, 7000],
    [16, 15_000],
  ])("round-trips at zoom %d, scroll %d", (zoom, scroll) => {
    const view = viewAt(zoom, scroll);
    for (const t of [0, 1.25, 33.3, 50, 99.9]) {
      const x = xOf(view, t);
      // A time scrolled out of the lane is still converted back exactly.
      expect(timeAt(view, LANE_LEFT + x, LANE_LEFT, false)).toBeCloseTo(t, 9);
    }
  });

  it("converts the pointer by the scale, not by the 1x amount (the failure this exists to stop)", () => {
    const view = viewAt(4, 1200); // 40 px per second, scrolled 1200 px = 30 s in
    // 200 px right of the lane's left edge is 5 s into the visible window, 35 s overall.
    expect(timeAt(view, LANE_LEFT + 200, LANE_LEFT)).toBeCloseTo(35, 9);
    // At 1x the same pixel would have been 20 s.
    expect(timeAt(fit, LANE_LEFT + 200, LANE_LEFT)).toBeCloseTo(20, 9);
  });

  it("clamps to the timeline by default and leaves the raw value for drags that extend a trim", () => {
    expect(timeAt(fit, LANE_LEFT - 80, LANE_LEFT)).toBe(0);
    expect(timeAt(fit, LANE_LEFT + 2000, LANE_LEFT)).toBe(100);
    expect(timeAt(fit, LANE_LEFT - 80, LANE_LEFT, false)).toBeCloseTo(-8, 9);
    expect(timeAt(fit, LANE_LEFT + 2000, LANE_LEFT, false)).toBeCloseTo(200, 9);
  });

  it("puts the end of the timeline on the lane's right edge at fit", () => {
    expect(xOf(fit, 100)).toBe(1000);
    expect(xOf(viewAt(4, 3000), 100)).toBe(1000);
  });
});

describe("timeDelta", () => {
  it("is the pointer distance over the scale, whatever the scroll", () => {
    // 40 px per second: 200 px is 5 s, at any scroll.
    expect(timeDelta(viewAt(4, 0), 300, 500)).toBeCloseTo(5, 9);
    expect(timeDelta(viewAt(4, 1700), 300, 500)).toBeCloseTo(5, 9);
    expect(timeDelta(viewAt(4, 1700), 500, 300)).toBeCloseTo(-5, 9);
  });

  it("is not clamped: a handle dragged past the end of the visible timeline keeps going", () => {
    expect(timeDelta(fit, 900, 3000)).toBeCloseTo(210, 9);
  });

  it("is 0 while the lane is unmeasured", () => {
    expect(timeDelta(fitView(0, 100), 10, 500)).toBe(0);
  });
});

describe("zoomAt", () => {
  // The time under the pointer is the thing that must not move.
  function timeUnder(view: TimelineView, clientX: number): number {
    return timeAt(view, clientX, LANE_LEFT, false);
  }

  it.each([
    ["left edge", LANE_LEFT],
    ["centre", LANE_LEFT + 500],
    ["right edge", LANE_LEFT + 1000],
  ])("keeps the time under the pointer fixed at the %s", (_name, anchor) => {
    const before = viewAt(2, 400);
    const t = timeUnder(before, anchor);
    const after = zoomAt(before, 2, anchor, LANE_LEFT);
    expect(after.zoom).toBeCloseTo(4);
    expect(timeUnder(after, anchor)).toBeCloseTo(t, 6);
  });

  it("zooms in from fit around the pointer, so the pointer keeps its time", () => {
    const anchor = LANE_LEFT + 250; // 25 s at fit
    const after = zoomAt(fit, 4, anchor, LANE_LEFT);
    expect(after.zoom).toBe(4);
    expect(timeUnder(after, anchor)).toBeCloseTo(25, 9);
    expect(after.scroll).toBeCloseTo(25 * 40 - 250, 9);
  });

  it("clamps the zoom at the maximum and still keeps the time under the pointer", () => {
    const anchor = LANE_LEFT + 700;
    const t = timeUnder(fit, anchor);
    const after = zoomAt(fit, 10_000, anchor, LANE_LEFT);
    expect(after.zoom).toBeCloseTo(24);
    expect(timeUnder(after, anchor)).toBeCloseTo(t, 6);
  });

  it("cannot zoom out past fit, and returns to scroll 0 there", () => {
    const after = zoomAt(viewAt(4, 1500), 0.0001, LANE_LEFT + 300, LANE_LEFT);
    expect(after.zoom).toBe(1);
    expect(after.scroll).toBe(0);
  });

  it("at the far left a zoom-in keeps scroll 0 (nothing to the left of the start)", () => {
    const after = zoomAt(fit, 2, LANE_LEFT, LANE_LEFT);
    expect(after.scroll).toBe(0);
  });

  it("at the far right a zoom-in stays pinned to the end of the timeline", () => {
    const after = zoomAt(fit, 2, LANE_LEFT + 1000, LANE_LEFT);
    expect(after.scroll).toBe(contentWidth(after) - after.laneWidth);
    expect(timeUnder(after, LANE_LEFT + 1000)).toBeCloseTo(100, 9);
  });

  it("treats a pointer outside the lane (the label column, past the end) as the nearest edge", () => {
    const left = zoomAt(fit, 2, LANE_LEFT - 60, LANE_LEFT);
    expect(timeUnder(left, LANE_LEFT)).toBeCloseTo(0, 9);
    const right = zoomAt(fit, 2, LANE_LEFT + 1300, LANE_LEFT);
    expect(timeUnder(right, LANE_LEFT + 1000)).toBeCloseTo(100, 9);
  });
});

describe("panBy", () => {
  it("moves the scroll and clamps it at both ends", () => {
    const view = viewAt(4, 1000);
    expect(panBy(view, 250).scroll).toBe(1250);
    expect(panBy(view, -5000).scroll).toBe(0);
    expect(panBy(view, 5000).scroll).toBe(3000);
  });

  it("does nothing at fit: there is nowhere to scroll", () => {
    expect(panBy(fit, 400)).toEqual(fit);
  });
});

describe("followPlayhead", () => {
  const zoomed = viewAt(4, 1000); // visible 25 s .. 50 s (40 px/s)

  it("leaves the view alone while the playhead is left of the 80% mark", () => {
    // 80% of 1000 px is 800 px = 20 s into the window: 45 s overall.
    expect(followPlayhead(zoomed, 44).scroll).toBe(1000);
    expect(followPlayhead(zoomed, 30).scroll).toBe(1000);
  });

  it("scrolls once the playhead passes 80% of the visible width, keeping it in view", () => {
    const next = followPlayhead(zoomed, 46);
    expect(next.scroll).toBeGreaterThan(1000);
    const x = xOf(next, 46);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(next.laneWidth * FOLLOW_EDGE);
  });

  it("brings a playhead that is off screen (a loop back to the start) into view", () => {
    const next = followPlayhead(zoomed, 2);
    expect(xOf(next, 2)).toBeGreaterThanOrEqual(0);
    expect(xOf(next, 2)).toBeLessThanOrEqual(next.laneWidth * FOLLOW_EDGE);
  });

  it("never scrolls past the end of the timeline", () => {
    const next = followPlayhead(zoomed, 100);
    expect(next.scroll).toBe(3000);
  });

  it("does nothing at fit", () => {
    expect(followPlayhead(fit, 99)).toEqual(fit);
  });

  it("returns the same object when nothing changes, so callers can skip a re-render", () => {
    expect(followPlayhead(zoomed, 30)).toBe(zoomed);
  });
});

describe("revealTime", () => {
  const zoomed = viewAt(4, 1000);

  it("does not move the view for a time that is already visible, even past 80%", () => {
    expect(revealTime(zoomed, 49)).toBe(zoomed);
  });

  it("scrolls only when the time is outside the visible window", () => {
    const after = revealTime(zoomed, 80);
    expect(xOf(after, 80)).toBeGreaterThanOrEqual(0);
    expect(xOf(after, 80)).toBeLessThanOrEqual(after.laneWidth);
    const before = revealTime(zoomed, 3);
    expect(xOf(before, 3)).toBeGreaterThanOrEqual(0);
  });
});

describe("visibleRange", () => {
  it("is the whole timeline at fit", () => {
    expect(visibleRange(fit)).toEqual({ start: 0, end: 100 });
  });

  it("is the window the lane shows when zoomed and scrolled", () => {
    const range = visibleRange(viewAt(4, 1000));
    expect(range.start).toBeCloseTo(25, 9);
    expect(range.end).toBeCloseTo(50, 9);
  });

  it("stays inside [0, duration]", () => {
    const range = visibleRange(viewAt(4, 3000));
    expect(range.end).toBe(100);
    expect(range.start).toBeCloseTo(75, 9);
  });
});

describe("resizing under a live view (a cut while zoomed)", () => {
  it("keeps the zoom factor when the duration shrinks, so a cut does not change the apparent zoom", () => {
    const zoomed = viewAt(4, 1500);
    const cut = clampView({ ...zoomed, duration: 60 });
    expect(cut.zoom).toBe(4);
    expect(contentWidth(cut)).toBe(4000);
    expect(cut.scroll).toBe(1500);
  });

  it("keeps the scroll when a wider lane still leaves room to scroll", () => {
    const zoomed = viewAt(4, 3000);
    const wider = clampView({ ...zoomed, laneWidth: 1500 });
    // content is now 6000 px, so the maximum scroll is 4500: 3000 is still inside it.
    expect(wider.zoom).toBe(4);
    expect(wider.scroll).toBe(3000);
  });

  it("re-clamps the zoom and the scroll when the lane grows so wide that nothing is left to scroll", () => {
    const zoomed = viewAt(4, 3000);
    // 24 000 px for 100 s is 240 px/s at fit, already MAX_PX_PER_SECOND: maxZoom falls to 1,
    // the content is exactly the lane, and the old scroll of 3000 has nowhere to go.
    const huge = clampView({ ...zoomed, laneWidth: 24_000 });
    expect(maxZoom(24_000, 100)).toBe(1);
    expect(huge.zoom).toBe(1);
    expect(huge.scroll).toBe(0);
  });

  it("drops the zoom to the new maximum when a cut leaves too little to zoom into", () => {
    const zoomed = viewAt(20, 0);
    const cut = clampView({ ...zoomed, duration: 10 });
    expect(cut.zoom).toBeCloseTo(maxZoom(1000, 10));
    expect(cut.scroll).toBeLessThanOrEqual(contentWidth(cut) - cut.laneWidth);
  });
});

describe("the zoom slider", () => {
  const max = maxZoom(1000, 100);

  it("maps fit to 0 and the maximum to 1", () => {
    expect(zoomToSlider(fit.zoom, max)).toBe(0);
    expect(zoomToSlider(max, max)).toBeCloseTo(1, 9);
  });

  it("is logarithmic: the midpoint is the geometric mean, not the average", () => {
    expect(sliderToZoom(0.5, max)).toBeCloseTo(Math.sqrt(max), 9);
  });

  it("round-trips", () => {
    for (const v of [0, 0.1, 0.37, 0.8, 1]) {
      expect(zoomToSlider(sliderToZoom(v, max), max)).toBeCloseTo(v, 9);
    }
  });

  it("is pinned at 0 when the recording cannot zoom (already past the maximum at fit)", () => {
    expect(zoomToSlider(1, maxZoom(1000, 2))).toBe(0);
    expect(sliderToZoom(0.7, maxZoom(1000, 2))).toBe(1);
  });
});

describe("wheelZoomFactor", () => {
  it("zooms in on a scroll up and out on a scroll down", () => {
    expect(wheelZoomFactor(-10, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10, 0)).toBeLessThan(1);
  });

  it("is symmetric, so a pinch out then in lands where it started", () => {
    expect(wheelZoomFactor(-12, 0) * wheelZoomFactor(12, 0)).toBeCloseTo(1, 12);
  });

  it("caps one event, so a mouse-wheel notch does not jump the whole range", () => {
    expect(wheelZoomFactor(-4000, 0)).toBe(wheelZoomFactor(-40, 0));
  });

  it("reads line-mode deltas (a mouse wheel on some platforms) as lines, not pixels", () => {
    expect(wheelZoomFactor(-1, 1)).toBe(wheelZoomFactor(-16, 0));
    expect(wheelZoomFactor(-1, 1)).not.toBe(wheelZoomFactor(-1, 0));
  });
});

describe("keepLeftEdge", () => {
  const zoomedIn = viewAt(4, 1200); // 40 px/s, the lane starts at 30 s

  it("keeps the time at the left edge when the duration changes", () => {
    const next = keepLeftEdge(zoomedIn, { ...zoomedIn, duration: 60 });
    expect(next.scroll / scaleOf(next)).toBeCloseTo(30, 9);
    expect(next.zoom).toBe(4);
  });

  it("keeps it when the lane width changes", () => {
    const next = keepLeftEdge(zoomedIn, { ...zoomedIn, laneWidth: 500 });
    expect(next.scroll / scaleOf(next)).toBeCloseTo(30, 9);
    expect(next.scroll).toBeCloseTo(600, 9);
  });

  it("clamps the zoom first, then sets the scroll for the clamped zoom's scale", () => {
    // 20x in 100 s; the cut to 40 s allows 9.6x at most (240 px/s). 50 s is the left edge,
    // which is past the end of 40 s, so the scroll ends up clamped to the content.
    const deep = viewAt(20, 10_000);
    const next = keepLeftEdge(deep, { ...deep, duration: 40 });
    expect(next.zoom).toBeCloseTo(9.6, 9);
    expect(next.scroll).toBeCloseTo(contentWidth(next) - next.laneWidth, 9);
  });

  it("clamps the scroll to the new content, never past its end", () => {
    const end = viewAt(4, 3000); // the last lane of 100 s
    const next = keepLeftEdge(end, { ...end, duration: 60 });
    expect(next.scroll).toBeLessThanOrEqual(contentWidth(next) - next.laneWidth);
    expect(next.scroll).toBeGreaterThanOrEqual(0);
  });

  it("only clamps when either side has no scale yet (nothing to keep)", () => {
    const unmeasured = fitView(0, 100);
    expect(keepLeftEdge(unmeasured, { ...unmeasured, laneWidth: 1000 })).toEqual(fit);
    const empty = fitView(1000, 0);
    expect(keepLeftEdge(empty, { ...empty, duration: 100 })).toEqual(fit);
  });

  it("leaves the scroll bit-for-bit alone when the scale did not change (no float error invents a move)", () => {
    const next = keepLeftEdge(zoomedIn, { ...zoomedIn });
    expect(next).toEqual(zoomedIn);
    expect(next.scroll).toBe(zoomedIn.scroll);
  });
});

describe("formatZoom", () => {
  it("writes one decimal with the locale's separator: 4.0 in English, 4,0 in Spanish", () => {
    expect(formatZoom(4, "en")).toBe("4.0");
    expect(formatZoom(4, "es")).toBe("4,0");
    expect(formatZoom(1, "en")).toBe("1.0");
    expect(formatZoom(1, "es")).toBe("1,0");
  });

  it("rounds to one decimal", () => {
    expect(formatZoom(Math.SQRT2, "en")).toBe("1.4");
    expect(formatZoom(Math.SQRT2, "es")).toBe("1,4");
    expect(formatZoom(23.96, "en")).toBe("24.0");
  });

  it("gives the same text on a second call (the formatter is reused per locale)", () => {
    expect(formatZoom(2.5, "es")).toBe(formatZoom(2.5, "es"));
  });
});
