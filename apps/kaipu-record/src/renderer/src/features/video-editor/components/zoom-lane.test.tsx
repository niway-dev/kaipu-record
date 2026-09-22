import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import type { ZoomSegment } from "../zoom/zoom-model";
import { ZoomLane } from "./zoom-lane";

const items: TrackItem[] = [
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 5 },
  { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 20 },
];
const layout = toLayout(items);

const zoom = (partial: Partial<ZoomSegment>): ZoomSegment => ({
  id: "z",
  start: 1,
  end: 3,
  scale: 2,
  mode: "follow",
  anchor: null,
  smoothing: 70,
  origin: "auto",
  trigger: "click",
  ...partial,
});

describe("ZoomLane — empty state (PR 10 polish)", () => {
  it("shows the empty-state hint with zero zooms and a cursor track", () => {
    render(
      <ZoomLane
        layout={layout}
        segments={[]}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
        hasTrack
      />,
    );
    expect(screen.getByText(/no zooms yet/i)).toBeInTheDocument();
  });

  it("stays silent with zero zooms and no cursor track (the Detection panel explains that case)", () => {
    render(
      <ZoomLane
        layout={layout}
        segments={[]}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
      />,
    );
    expect(screen.queryByText(/no zooms yet/i)).toBeNull();
  });

  it("stays silent once a zoom exists, even with a track", () => {
    render(
      <ZoomLane
        layout={layout}
        segments={[zoom({})]}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
        hasTrack
      />,
    );
    expect(screen.queryByText(/no zooms yet/i)).toBeNull();
  });
});

describe("ZoomLane", () => {
  it("renders one block per visible piece and hides fully deleted zooms", () => {
    const { container } = render(
      <ZoomLane
        layout={layout}
        segments={[zoom({ id: "span", start: 4, end: 12 }), zoom({ id: "gone", start: 6, end: 9 })]}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-zoom-id="span"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-zoom-id="gone"]')).toHaveLength(0);
  });

  it("shows the level and a lock for fixed zooms", () => {
    const { container } = render(
      <ZoomLane
        layout={layout}
        segments={[zoom({ scale: 2.14, mode: "fixed", anchor: { x: 0.5, y: 0.5 } })]}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("2.1×");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("selects on click and exposes handles only on the real edges", () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(
      <ZoomLane
        layout={layout}
        segments={[zoom({ start: 4, end: 12 })]}
        selectedId={null}
        onSelect={onSelect}
        onEdgeDrag={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector('[data-zoom-id="z"]')!);
    expect(onSelect).toHaveBeenCalledWith("z");
    rerender(
      <ZoomLane
        layout={layout}
        segments={[zoom({ start: 4, end: 12 })]}
        selectedId="z"
        onSelect={onSelect}
        onEdgeDrag={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("[data-zoom-handle]")).toHaveLength(2);
  });

  it("omits the handle of an edge buried in deleted footage", () => {
    // start 6 s is inside the 5–10 s cut, so only the end edge is reachable.
    const { container } = render(
      <ZoomLane
        layout={layout}
        segments={[zoom({ start: 6, end: 12 })]}
        selectedId="z"
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("[data-zoom-handle]")).toHaveLength(1);
    expect(container.querySelector('[data-zoom-handle="end"]')).not.toBeNull();
    expect(container.querySelector('[data-zoom-handle="start"]')).toBeNull();
  });

  it("drags an edge with start/move/end phases in source time", () => {
    const onEdgeDrag = vi.fn();
    const { container } = render(
      <ZoomLane
        layout={layout}
        segments={[zoom({})]}
        selectedId="z"
        onSelect={vi.fn()}
        onEdgeDrag={onEdgeDrag}
      />,
    );
    const lane = container.querySelector('[data-testid="zoom-lane"]') as HTMLElement;
    lane.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 1500,
        top: 0,
        height: 40,
        right: 1500,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const end = container.querySelector('[data-zoom-handle="end"]') as HTMLElement;
    fireEvent.pointerDown(end, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 900 }); // timeline 9 s → source 14 s
    fireEvent.pointerUp(end, { pointerId: 1, clientX: 900 });
    expect(onEdgeDrag.mock.calls).toEqual([
      ["z", "end", 3, "start"],
      ["z", "end", 14, "move"],
      ["z", "end", null, "end"],
    ]);
  });

  it("ends the drag when the pointer capture is lost, and only once", () => {
    const onEdgeDrag = vi.fn();
    const { container } = render(
      <ZoomLane
        layout={layout}
        segments={[zoom({})]}
        selectedId="z"
        onSelect={vi.fn()}
        onEdgeDrag={onEdgeDrag}
      />,
    );
    const end = container.querySelector('[data-zoom-handle="end"]') as HTMLElement;
    fireEvent.pointerDown(end, { pointerId: 1, clientX: 300 });
    // No pointerup: the gesture is aborted by the platform. Without the abort handlers
    // the controller would stay `interacting` and every later commit would no-op.
    fireEvent.lostPointerCapture(end, { pointerId: 1 });
    fireEvent.pointerCancel(end, { pointerId: 1 });
    expect(onEdgeDrag.mock.calls).toEqual([
      ["z", "end", 3, "start"],
      ["z", "end", null, "end"],
    ]);
  });
});
