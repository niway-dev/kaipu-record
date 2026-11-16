import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import type { WebcamSegment } from "../webcam/webcam-model";
import { fitView } from "./timeline-view";
import { TimelineShowRangeContext, TimelineViewContext } from "./timeline-pointer";
import { clampCardLeft } from "./webcam-lane-card";
import { WebcamLane } from "./webcam-lane";

/**
 * The Camera lane's hover card (spec decision 16). Same timeline as the lane's other tests:
 * clip a is source 0-5 at timeline 0-5, clip b is source 10-20 at timeline 5-15, and in a
 * 1500 px lane a second is 100 px, so a pointer x reads straight as a time.
 */
const LANE_PX = 1500;
const layout = toLayout([
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 5 },
  { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 20 },
] satisfies TrackItem[]);

const part = (id: string, start: number, end: number, patch: Partial<WebcamSegment> = {}) =>
  ({
    id,
    start,
    end,
    mode: "override",
    layout: { position: { x: 0.8, y: 0.2 } },
    transition: { kind: "slide", ms: 700, easing: "ease-in-out" },
    ...patch,
  }) satisfies WebcamSegment;

function renderLane(
  segments: WebcamSegment[],
  props: {
    selectedId?: string | null;
    onSelect?: (id: string) => void;
    showRange?: (start: number, end: number) => void;
  } = {},
) {
  const view = fitView(LANE_PX, 15);
  const ui = (v = view) => (
    <TimelineShowRangeContext.Provider value={props.showRange ?? null}>
      <TimelineViewContext.Provider value={v}>
        <WebcamLane
          layout={layout}
          segments={segments}
          selectedId={props.selectedId ?? null}
          onSelect={props.onSelect ?? vi.fn()}
          onEdgeDrag={vi.fn()}
        />
      </TimelineViewContext.Provider>
    </TimelineShowRangeContext.Provider>
  );
  const utils = render(ui());
  const lane = utils.container.querySelector<HTMLElement>('[data-testid="webcam-lane"]')!;
  lane.getBoundingClientRect = () =>
    ({ left: 0, width: LANE_PX, top: 300, height: 44, right: LANE_PX, bottom: 344 }) as DOMRect;
  return { ...utils, lane, rerenderWith: (v: typeof view) => utils.rerender(ui(v)), view };
}

const card = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>("[data-webcam-card]");
const hoverAt = (lane: HTMLElement, clientX: number): void => {
  fireEvent.pointerMove(lane, { clientX, clientY: 320, pointerId: 1 });
};
const settle = (): void => {
  act(() => {
    vi.advanceTimersByTime(130);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("WebcamLane double-click zoom (spec decision 18)", () => {
  const target = (container: HTMLElement, id: string): HTMLElement =>
    container.querySelector<HTMLElement>(`[data-webcam-id="${id}"]`)!;

  it("selects on the first click and zooms to the part's timeline range on the double-click", () => {
    const onSelect = vi.fn();
    const showRange = vi.fn();
    // Source 12-14 sits in clip b: timeline 7-9.
    const { container } = renderLane([part("p", 12, 14)], { onSelect, showRange });
    const button = target(container, "p");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("p");
    expect(showRange).not.toHaveBeenCalled();
    fireEvent.doubleClick(button);
    expect(showRange).toHaveBeenCalledTimes(1);
    expect(showRange).toHaveBeenCalledWith(7, 9);
  });

  it("covers a part a cut splits into two pieces, from the first to the last", () => {
    const showRange = vi.fn();
    // Source 3-12 spans the end of clip a (timeline 3-5) and the start of clip b (5-7).
    const { container } = renderLane([part("p", 3, 12)], { showRange });
    fireEvent.doubleClick(target(container, "p"));
    expect(showRange).toHaveBeenCalledWith(3, 7);
  });

  it("does nothing outside a timeline strip", () => {
    const { container } = renderLane([part("p", 12, 14)]);
    expect(() => fireEvent.doubleClick(target(container, "p"))).not.toThrow();
  });
});

describe("WebcamLane hover card", () => {
  it("appears 120 ms after the pointer enters the lane, wherever it has moved to since", () => {
    const { lane } = renderLane([part("p", 14, 15)]);
    hoverAt(lane, 700); // source 14-15 is timeline 9-10: 900-1000 px; 700 is an original stretch
    hoverAt(lane, 950);
    expect(card()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(110);
    });
    expect(card()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(card()).not.toBeNull();
  });

  it("says the place, the range and length, and how a part arrives", () => {
    const { lane } = renderLane([part("p", 14, 16)]);
    hoverAt(lane, 950);
    settle();
    const el = card()!;
    expect(el).toHaveAttribute("data-webcam-card", "part");
    expect(el).toHaveTextContent("Top right");
    expect(el).toHaveTextContent("0:14.0 – 0:16.0 · 2.0 s");
    expect(el).toHaveTextContent("Slide 0.7 s · Smooth");
    expect(el).toHaveAttribute("role", "tooltip");
  });

  it("says Cut for a cut, and the easing's own name for another motion", () => {
    const cut = renderLane([
      part("c", 14, 15, { transition: { kind: "cut", ms: 700, easing: "back" } }),
    ]);
    hoverAt(cut.lane, 950);
    settle();
    expect(card()).toHaveTextContent("Cut");
    expect(card()).not.toHaveTextContent("Slide");
    cut.unmount();
    const bounce = renderLane([
      part("b", 14, 16, { transition: { kind: "slide", ms: 700, easing: "back" } }),
    ]);
    hoverAt(bounce.lane, 950);
    settle();
    expect(card()).toHaveTextContent("Slide 0.7 s · Bounce");
  });

  it("says Camera hidden, with the range and no place, for a hidden range", () => {
    const { lane } = renderLane([{ id: "h", start: 14, end: 16, mode: "hidden" }]);
    hoverAt(lane, 950);
    settle();
    const el = card()!;
    expect(el).toHaveAttribute("data-webcam-card", "hidden");
    expect(el).toHaveTextContent("Camera hidden");
    expect(el).toHaveTextContent("0:14.0 – 0:16.0 · 2.0 s");
    expect(el.querySelector("[data-webcam-glyph]")).toBeNull();
  });

  it("says Original, the place and the range for an original stretch", () => {
    const { lane } = renderLane([part("p", 14, 15)]);
    hoverAt(lane, 200); // timeline 2 s: the original before the part, source 0-5 of clip a
    settle();
    const el = card()!;
    expect(el).toHaveAttribute("data-webcam-card", "original");
    expect(el).toHaveTextContent("Bottom left");
    expect(el).toHaveTextContent("Original");
    expect(el).toHaveTextContent("0:00.0 – 0:14.0 · 14.0 s");
  });

  it("finds a 3 px part from anywhere in its 12 px target", () => {
    const { lane } = renderLane([part("p", 14, 14.03)]);
    // The part is drawn at 900-903 px; the target is 895.5-907.5.
    hoverAt(lane, 896);
    settle();
    expect(card()).toHaveAttribute("data-webcam-card", "part");
  });

  it("follows the pointer to another stretch at once once it is showing", () => {
    const { lane } = renderLane([part("p", 14, 15)]);
    hoverAt(lane, 950);
    settle();
    expect(card()).toHaveAttribute("data-webcam-card", "part");
    hoverAt(lane, 200);
    expect(card()).toHaveAttribute("data-webcam-card", "original");
  });

  it("is gone when the pointer leaves the lane", () => {
    const { lane } = renderLane([part("p", 14, 15)]);
    hoverAt(lane, 950);
    settle();
    fireEvent.pointerLeave(lane);
    expect(card()).toBeNull();
  });

  it("does not appear if the pointer left before the delay", () => {
    const { lane } = renderLane([part("p", 14, 15)]);
    hoverAt(lane, 950);
    fireEvent.pointerLeave(lane);
    settle();
    expect(card()).toBeNull();
  });

  it("is gone while a handle is dragged, and stays away until the drag ends", () => {
    const { lane, container } = renderLane([part("p", 14, 15)], { selectedId: "p" });
    hoverAt(lane, 950);
    settle();
    expect(card()).not.toBeNull();
    const end = container.querySelector<HTMLElement>('[data-webcam-handle="end"]')!;
    fireEvent.pointerDown(end, { pointerId: 1, clientX: 1000 });
    expect(card()).toBeNull();
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 1020 });
    hoverAt(lane, 950);
    settle();
    expect(card()).toBeNull();
    fireEvent.pointerUp(end, { pointerId: 1, clientX: 1020 });
    hoverAt(lane, 950);
    settle();
    expect(card()).not.toBeNull();
  });

  it("is gone when the timeline scrolls or zooms", () => {
    const { lane, rerenderWith, view } = renderLane([part("p", 14, 15)]);
    hoverAt(lane, 950);
    settle();
    expect(card()).not.toBeNull();
    rerenderWith({ ...view, scroll: view.scroll + 40 });
    expect(card()).toBeNull();
  });

  it("shows the same card on keyboard focus of a part, at once", () => {
    const { container } = renderLane([part("p", 14, 15)]);
    const button = container.querySelector<HTMLElement>('button[data-webcam-id="p"]')!;
    button.getBoundingClientRect = () =>
      ({ left: 900, width: 100, top: 303, height: 38, right: 1000, bottom: 341 }) as DOMRect;
    // A key press first, as Tab is: after a click the browser no longer shows focus rings.
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => button.focus());
    expect(card()).toHaveTextContent("Top right");
    act(() => button.blur());
    expect(card()).toBeNull();
  });

  it("stays inside the timeline's visible area, whatever the pointer does", () => {
    // jsdom defines these on the prototype: put its own getters back afterwards, not nothing.
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!;
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 200 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 60 });
    try {
      const { lane } = renderLane([part("p", 14, 20)]);
      hoverAt(lane, 1495);
      settle();
      // 200 px wide: right edge at 1500 - 4 px of margin.
      expect(card()!.style.left).toBe("1296px");
      hoverAt(lane, 910);
      expect(card()!.style.left).toBe("810px");
    } finally {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
    }
  });
});

describe("clampCardLeft", () => {
  const bounds = { left: 100, right: 900 };
  it("centres the card on the pointer when there is room", () => {
    expect(clampCardLeft(500, 200, bounds)).toBe(400);
  });
  it("keeps it inside the visible area on either side", () => {
    expect(clampCardLeft(110, 200, bounds)).toBe(104);
    expect(clampCardLeft(890, 200, bounds)).toBe(696);
  });
  it("starts at the left edge when the card is wider than the area", () => {
    expect(clampCardLeft(500, 2000, bounds)).toBe(104);
  });
});
