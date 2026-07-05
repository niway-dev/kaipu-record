import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VideoOverlay } from "../scene";
import { OverlayLane, type OverlayLaneProps } from "./overlay-lane";

/** The lane normalizes pointer positions against its own getBoundingClientRect —
 *  jsdom never lays anything out, so pin it to a fixed, non-zero box spanning a
 *  10-second timeline (1 px per 0.1s, for easy-to-read expectations below). */
function mockRect(el: HTMLElement): void {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 20,
    width: 1000,
    height: 20,
    toJSON: () => ({}),
  });
}

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
  start: 2,
  end: 5,
};

const arrow: VideoOverlay = {
  id: "o2",
  kind: "arrow",
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 1,
  color: "#2563eb",
  stroke: 1,
  seed: 2,
  start: 6,
  end: 8,
};

function renderLane(overrides: Partial<OverlayLaneProps> = {}): {
  props: OverlayLaneProps;
  container: HTMLElement;
} {
  const props: OverlayLaneProps = {
    overlays: [box],
    duration: 10,
    selectedOverlayId: null,
    onSelectOverlay: vi.fn(),
    onWindowChange: vi.fn(),
    ...overrides,
  };
  const { container } = render(<OverlayLane {...props} />);
  mockRect(container.firstChild as HTMLElement);
  return { props, container };
}

describe("OverlayLane — rendering", () => {
  it("renders one pill per overlay", () => {
    const { container } = renderLane({ overlays: [box, arrow] });
    expect(container.querySelectorAll("button")).toHaveLength(2);
  });

  it("renders no pill selected by default", () => {
    const { container } = renderLane();
    const pill = container.querySelector("button")!;
    expect(pill.className).not.toMatch(/pillSelected/);
  });

  it("marks the selected overlay's pill", () => {
    const { container } = renderLane({ selectedOverlayId: "o1" });
    const pill = container.querySelector("button")!;
    expect(pill.className).toMatch(/pillSelected/);
  });

  it("renders start/end drag handles for every pill", () => {
    const { container } = renderLane({ overlays: [box, arrow] });
    const starts = container.querySelectorAll('[data-overlay-handle="start"]');
    const ends = container.querySelectorAll('[data-overlay-handle="end"]');
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
  });
});

describe("OverlayLane — selection", () => {
  it("selects the overlay on a pill click", () => {
    const { props, container } = renderLane();
    const pill = container.querySelector("button")!;
    fireEvent.pointerDown(pill, { clientX: 250, clientY: 10 });
    fireEvent.pointerUp(pill);
    expect(props.onSelectOverlay).toHaveBeenCalledWith("o1");
  });
});

describe("OverlayLane — body drag (move)", () => {
  it("shifts the window, preserving its length, and collapses into begin/move/end", () => {
    const { props, container } = renderLane();
    const pill = container.querySelector("button")!;
    // box.start=2,end=5 (length 3) at 10s duration -> px 200..500 on a 1000px lane.
    fireEvent.pointerDown(pill, { clientX: 250, clientY: 10 }); // grabs mid-pill
    fireEvent.pointerMove(pill, { clientX: 350, clientY: 10 }); // +1s
    fireEvent.pointerUp(pill);

    const calls = (props.onWindowChange as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]).toEqual(["o1", 2, 5, "start"]);
    expect(calls[1][0]).toBe("o1");
    expect(calls[1][1]).toBeCloseTo(3, 1); // start shifted by +1s
    expect(calls[1][2]).toBeCloseTo(6, 1); // end shifted by +1s (length preserved)
    expect(calls[1][3]).toBe("move");
    expect(calls[2]).toEqual(["o1", 2, 5, "end"]);
  });

  it("clamps the moved window into [0, duration]", () => {
    const { props, container } = renderLane();
    const pill = container.querySelector("button")!;
    fireEvent.pointerDown(pill, { clientX: 250, clientY: 10 });
    fireEvent.pointerMove(pill, { clientX: 950, clientY: 10 }); // far past the end
    fireEvent.pointerUp(pill);

    const move = (props.onWindowChange as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(move[1]).toBeCloseTo(7, 1); // duration(10) - length(3)
    expect(move[2]).toBeCloseTo(10, 1);
  });
});

describe("OverlayLane — handle drag (resize)", () => {
  it("resizes from the end handle down to the minimum window length", () => {
    const { props, container } = renderLane();
    const endHandle = container.querySelector('[data-overlay-handle="end"]')!;
    fireEvent.pointerDown(endHandle, { clientX: 500, clientY: 10 });
    fireEvent.pointerMove(endHandle, { clientX: 210, clientY: 10 }); // drag start-ward
    fireEvent.pointerUp(endHandle);

    const move = (props.onWindowChange as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(move[0]).toBe("o1");
    expect(move[1]).toBeCloseTo(2, 1); // start unchanged
    expect(move[2]).toBeCloseTo(2.2, 1); // end clamps to start + 0.2s minimum
    expect(move[3]).toBe("move");
  });

  it("resizes from the start handle without moving past the end minimum", () => {
    const { props, container } = renderLane();
    const startHandle = container.querySelector('[data-overlay-handle="start"]')!;
    fireEvent.pointerDown(startHandle, { clientX: 200, clientY: 10 });
    fireEvent.pointerMove(startHandle, { clientX: 490, clientY: 10 }); // drag end-ward
    fireEvent.pointerUp(startHandle);

    const move = (props.onWindowChange as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(move[1]).toBeCloseTo(4.8, 1); // start clamps to end - 0.2s minimum
    expect(move[2]).toBeCloseTo(5, 1); // end unchanged
  });

  it("also selects the overlay when grabbing a handle", () => {
    const { props, container } = renderLane();
    const endHandle = container.querySelector('[data-overlay-handle="end"]')!;
    fireEvent.pointerDown(endHandle, { clientX: 500, clientY: 10 });
    expect(props.onSelectOverlay).toHaveBeenCalledWith("o1");
  });

  it("ignores a hover pointermove over the handle with no preceding pointerdown", () => {
    const { props, container } = renderLane();
    const endHandle = container.querySelector('[data-overlay-handle="end"]')!;
    // No pointerDown — this is what a mere mouse hover over the handle looks like.
    fireEvent.pointerMove(endHandle, { clientX: 210, clientY: 10 });
    expect(props.onWindowChange).not.toHaveBeenCalled();
  });

  it("still resizes with exactly one undo step across a full pointerDown->move->up", () => {
    const { props, container } = renderLane();
    const endHandle = container.querySelector('[data-overlay-handle="end"]')!;
    fireEvent.pointerDown(endHandle, { clientX: 500, clientY: 10 });
    fireEvent.pointerMove(endHandle, { clientX: 210, clientY: 10 }); // drag start-ward
    fireEvent.pointerUp(endHandle);

    const calls = (props.onWindowChange as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual(["o1", 2, 5, "start"]);
    expect(calls[1][1]).toBeCloseTo(2, 1); // start unchanged
    expect(calls[1][2]).toBeCloseTo(2.2, 1); // end clamps to the 0.2s minimum
    expect(calls[1][3]).toBe("move");
    expect(calls[2]).toEqual(["o1", 2, 5, "end"]);
  });
});
