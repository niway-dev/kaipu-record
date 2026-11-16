import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import type { WebcamSegment } from "../webcam/webcam-model";
import { WebcamLane } from "./webcam-lane";

const items: TrackItem[] = [
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 5 },
  { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 20 },
];
const layout = toLayout(items);

const segment = (partial: Partial<WebcamSegment>): WebcamSegment => ({
  id: "w",
  start: 1,
  end: 3,
  mode: "hidden",
  ...partial,
});

function stubLaneRect(container: HTMLElement): void {
  const lane = container.querySelector('[data-testid="webcam-lane"]') as HTMLElement;
  lane.getBoundingClientRect = () =>
    ({ left: 0, width: 1500, top: 0, height: 40, right: 1500, bottom: 40 }) as DOMRect;
}

describe("WebcamLane", () => {
  it("renders one block per visible piece and hides segments in deleted footage", () => {
    const { container } = render(
      <WebcamLane
        layout={layout}
        segments={[
          segment({ id: "span", start: 4, end: 12 }),
          segment({ id: "gone", start: 6, end: 9 }),
        ]}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-webcam-id="span"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-webcam-id="gone"]')).toHaveLength(0);
  });

  it("labels hidden and override segments", () => {
    render(
      <WebcamLane
        layout={layout}
        segments={[
          segment({ id: "h", start: 1, end: 2 }),
          segment({ id: "o", start: 3, end: 4, mode: "override", layout: { size: 0.3 } }),
        ]}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Webcam section 1" })).toHaveTextContent("Hidden");
    // A part no longer says "Custom": it names where the camera is (the text shows with room).
    expect(screen.getByRole("button", { name: "Webcam section 2" })).not.toHaveTextContent(
      "Custom",
    );
  });

  it("selects on click and exposes handles only on the real edges", () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(
      <WebcamLane
        layout={layout}
        segments={[segment({ start: 4, end: 12 })]}
        selectedId={null}
        onSelect={onSelect}
        onEdgeDrag={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector('[data-webcam-id="w"]')!);
    expect(onSelect).toHaveBeenCalledWith("w");
    rerender(
      <WebcamLane
        layout={layout}
        segments={[segment({ start: 6, end: 12 })]}
        selectedId="w"
        onSelect={onSelect}
        onEdgeDrag={vi.fn()}
      />,
    );
    // start 6 s is inside the 5–10 s cut: only the end is reachable.
    expect(container.querySelector('[data-webcam-handle="start"]')).toBeNull();
    expect(container.querySelector('[data-webcam-handle="end"]')).not.toBeNull();
  });

  it("drags an edge with start/move/end phases in source time, ending once on abort", () => {
    const onEdgeDrag = vi.fn();
    const { container } = render(
      <WebcamLane
        layout={layout}
        segments={[segment({})]}
        selectedId="w"
        onSelect={vi.fn()}
        onEdgeDrag={onEdgeDrag}
      />,
    );
    stubLaneRect(container);
    const end = container.querySelector('[data-webcam-handle="end"]') as HTMLElement;
    fireEvent.pointerDown(end, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 900 }); // timeline 9 s → source 14 s
    fireEvent.lostPointerCapture(end, { pointerId: 1 });
    fireEvent.pointerCancel(end, { pointerId: 1 });
    expect(onEdgeDrag.mock.calls).toEqual([
      ["w", "end", 3, "start"],
      ["w", "end", 14, "move"],
      ["w", "end", null, "end"],
    ]);
  });

  describe("filmstrip", () => {
    // One thumbnail per second of source; the webcam has no footage after source 15 s.
    const thumbnails = Array.from({ length: 15 }, (_, i) => ({
      sourceTime: i + 0.5,
      url: `cam-${i}`,
    }));
    const tiles = (container: HTMLElement) =>
      Array.from(container.querySelectorAll<HTMLImageElement>("[data-webcam-filmstrip] img"));

    it("shows the webcam's frames under each clip, picked at source time", () => {
      const { container } = render(
        <WebcamLane
          layout={layout}
          segments={[]}
          thumbnails={thumbnails}
          covered={{ start: 0, end: 15 }}
          selectedId={null}
          onSelect={vi.fn()}
          onEdgeDrag={vi.fn()}
        />,
      );
      const strips = Array.from(container.querySelectorAll("[data-webcam-filmstrip] > *"));
      const frameSeconds = (strip: Element) =>
        Array.from(strip.querySelectorAll("img")).map((img) =>
          Number(img.getAttribute("src")!.slice("cam-".length)),
        );
      // Clip a (source 0–5) then clip b (source 10–20), placed like the clips lane: the
      // second strip starts where the first ends, and the cut (5–10) shows no frame at all.
      expect(strips).toHaveLength(2);
      expect((strips[1] as HTMLElement).style.left).toBe((strips[0] as HTMLElement).style.width);
      expect(frameSeconds(strips[0]).length).toBeGreaterThan(0);
      expect(frameSeconds(strips[0]).every((s) => s < 5)).toBe(true);
      expect(frameSeconds(strips[1]).length).toBeGreaterThan(0);
      expect(frameSeconds(strips[1]).every((s) => s >= 10)).toBe(true);
    });

    it("leaves a tile empty where the webcam has no frame", () => {
      const late = render(
        <WebcamLane
          layout={toLayout([{ id: "c", kind: "clip", sourceStart: 16, sourceEnd: 20 }])}
          segments={[]}
          thumbnails={thumbnails}
          covered={{ start: 0, end: 15 }}
          selectedId={null}
          onSelect={vi.fn()}
          onEdgeDrag={vi.fn()}
        />,
      );
      expect(tiles(late.container)).toHaveLength(0);
    });

    it("keeps the segments clickable above it and the strip out of the accessibility tree", () => {
      const onSelect = vi.fn();
      const { container } = render(
        <WebcamLane
          layout={layout}
          segments={[segment({ id: "h", start: 1, end: 2 })]}
          thumbnails={thumbnails}
          covered={{ start: 0, end: 15 }}
          selectedId={null}
          onSelect={onSelect}
          onEdgeDrag={vi.fn()}
        />,
      );
      expect(container.querySelector("[data-webcam-filmstrip]")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      fireEvent.click(screen.getByRole("button", { name: "Webcam section 1" }));
      expect(onSelect).toHaveBeenCalledWith("h");
    });

    it("renders no strip without thumbnails", () => {
      const { container } = render(
        <WebcamLane
          layout={layout}
          segments={[]}
          selectedId={null}
          onSelect={vi.fn()}
          onEdgeDrag={vi.fn()}
        />,
      );
      expect(container.querySelector("[data-webcam-filmstrip]")).toBeNull();
    });
  });

  describe("transition wedge", () => {
    // No view and no measured lane: 800 px over the 15 s timeline, so a second is 800 / 15 px.
    const perSecond = 800 / 15;
    const block = (partial: Partial<WebcamSegment>): WebcamSegment =>
      segment({
        id: "o",
        mode: "override",
        layout: { position: { x: 0.8, y: 0.2 } },
        transition: { kind: "slide", ms: 1000, easing: "back" },
        ...partial,
      });
    const renderLane = (segments: WebcamSegment[]) =>
      render(
        <WebcamLane
          layout={layout}
          segments={segments}
          selectedId={null}
          onSelect={vi.fn()}
          onEdgeDrag={vi.fn()}
        />,
      ).container;
    const bands = (container: HTMLElement) =>
      Array.from(container.querySelectorAll<HTMLElement>("[data-webcam-transition]"));

    it("draws a wedge at the part's start as wide as the slide lasts, inside the part", () => {
      // Source 10 to 14 is timeline 5 to 9: a slide of 1000 ms is one second wide.
      const container = renderLane([block({ start: 10, end: 14 })]);
      const [band] = bands(container);
      expect(band).toBeDefined();
      expect(parseFloat(band.style.width)).toBeCloseTo(perSecond, 6);
      expect(band.closest('[data-webcam-id="o"]')).not.toBeNull();
    });

    it("shows the effective duration: at most half of a short part", () => {
      const short = renderLane([
        block({
          id: "s",
          start: 10,
          end: 12,
          transition: { kind: "slide", ms: 2000, easing: "back" },
        }),
      ]);
      // 2000 ms asked of a 2 s part: one second is all the slide may take.
      expect(parseFloat(bands(short)[0].style.width)).toBeCloseTo(perSecond, 6);
    });

    it("draws no wedge for a Cut, for no transition or for a hidden range", () => {
      const container = renderLane([
        block({
          id: "cut",
          start: 10,
          end: 12,
          transition: { kind: "cut", ms: 700, easing: "back" },
        }),
        block({ id: "none", start: 12, end: 14, transition: undefined }),
        segment({ id: "hid", start: 14, end: 16 }),
      ]);
      expect(bands(container)).toHaveLength(0);
    });

    it("draws the wedge on the first piece only, and not when the start is cut away", () => {
      // Source 4 to 12 is two pieces (timeline 4 to 5, then 5 to 7); the start is in the first.
      const spanning = renderLane([
        block({ start: 4, end: 12, transition: { kind: "slide", ms: 700, easing: "back" } }),
      ]);
      expect(bands(spanning)).toHaveLength(1);
      expect(parseFloat(bands(spanning)[0].style.width)).toBeCloseTo(0.7 * perSecond, 6);
      // Source 7 to 12: the part before 10 is deleted, so the start is not on screen.
      const startCut = renderLane([block({ id: "c", start: 7, end: 12 })]);
      expect(bands(startCut)).toHaveLength(0);
    });
  });

  it("draws a dashed 'New part · N s' block where a part would go, and none otherwise", () => {
    const props = {
      layout,
      segments: [],
      selectedId: null,
      onSelect: vi.fn(),
      onEdgeDrag: vi.fn(),
    };
    const { container, rerender } = render(<WebcamLane {...props} />);
    expect(container.querySelector("[data-webcam-pending]")).toBeNull();
    rerender(<WebcamLane {...props} pendingPart={{ start: 12, end: 20 }} />);
    const pending = container.querySelector("[data-webcam-pending]") as HTMLElement;
    expect(pending).not.toBeNull();
    expect(pending).toHaveTextContent("New part · 8 s");
    // Timeline: clip a is 0-5, clip b is 5-15 from source 10: source 12-20 shows only 12-15.
    expect(parseFloat(pending.style.left)).toBeCloseTo((7 / 15) * 100, 3);
    // It is not a selectable block and takes no pointer.
    expect(container.querySelectorAll("button[data-webcam-id]")).toHaveLength(0);
  });
});
