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
    expect(screen.getByRole("button", { name: "Webcam section 2" })).toHaveTextContent("Custom");
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

  describe("transition band", () => {
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

    it("draws a band at the block's start as long as the transition, inside the block", () => {
      // Source 10 to 14 is timeline 5 to 9: 1000 ms of a 4 s block is a quarter of it.
      const container = renderLane([block({ start: 10, end: 14 })]);
      const [band] = bands(container);
      expect(band).toBeDefined();
      expect(band.style.width).toBe("25%");
      expect(band.closest('[data-webcam-id="o"]')).not.toBeNull();
    });

    it("shows the effective duration: at most half of a short block", () => {
      const short = renderLane([
        block({
          id: "s",
          start: 10,
          end: 12,
          transition: { kind: "slide", ms: 2000, easing: "back" },
        }),
      ]);
      expect(bands(short)[0].style.width).toBe("50%");
    });

    it("draws no band for a Cut, for no transition or for a hidden block", () => {
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

    it("draws the band on the first piece only, and not when the start is cut away", () => {
      // Source 4 to 12 is two pieces (timeline 4 to 5, then 5 to 7); the start is in the first.
      const spanning = renderLane([
        block({ start: 4, end: 12, transition: { kind: "slide", ms: 700, easing: "back" } }),
      ]);
      expect(bands(spanning)).toHaveLength(1);
      expect(bands(spanning)[0].style.width).toBe("70%");
      // Source 7 to 12: the part before 10 is deleted, so the start is not on screen.
      const startCut = renderLane([block({ id: "c", start: 7, end: 12 })]);
      expect(bands(startCut)).toHaveLength(0);
    });
  });
});

describe("WebcamLane across recordings", () => {
  it("covers the clips without a camera with a labelled span", () => {
    const { container } = render(
      <WebcamLane
        layout={layout}
        segments={[]}
        noCameraItemIds={new Set(["b"])}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
      />,
    );
    const spans = container.querySelectorAll<HTMLElement>('[data-testid="no-camera-span"]');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toHaveTextContent("No camera in this recording");
    // Clip b runs 5 s to 15 s of the 15 s timeline.
    expect(spans[0].style.left).toBe(`${(5 / 15) * 100}%`);
  });

  it("draws no span without clips to cover", () => {
    const { container } = render(
      <WebcamLane
        layout={layout}
        segments={[]}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="no-camera-span"]')).toBeNull();
  });
});

describe("WebcamLane filmstrip across joined recordings", () => {
  // Opened recording A: axis 0-10; joined B: axis 10-20 (offset 10), joined B again: axis 20-30.
  const joinedLayout = toLayout([
    { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 4 },
    { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 14 },
    { id: "b2", kind: "clip", sourceStart: 20, sourceEnd: 24 },
  ]);
  const clip = (sourceId: string | null, offset: number) => ({
    sourceId,
    title: "t",
    status: "ready" as const,
    hasWebcam: true,
    offset,
  });
  const clips = new Map([
    ["a", clip(null, 0)],
    ["b", clip("src-b", 10)],
    ["b2", clip("src-b2", 20)],
  ]);
  const own = (prefix: string) =>
    Array.from({ length: 10 }, (_, i) => ({ sourceTime: i + 0.5, url: `${prefix}-${i}` }));
  const recordingStrips = new Map([
    ["src-b", { thumbnails: own("b"), covered: { start: 0, end: 10 } }],
    ["src-b2", { thumbnails: own("c"), covered: { start: 0, end: 10 } }],
  ]);
  const urlsByClip = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("[data-webcam-filmstrip] > *")).map((strip) =>
      Array.from(strip.querySelectorAll("img")).map((img) => img.getAttribute("src")!),
    );
  const base = {
    segments: [],
    selectedId: null,
    onSelect: vi.fn(),
    onEdgeDrag: vi.fn(),
  };

  it("draws each clip from its own recording's strip at the recording's local time", () => {
    const { container } = render(
      <WebcamLane
        {...base}
        layout={joinedLayout}
        thumbnails={Array.from({ length: 10 }, (_, i) => ({ sourceTime: i + 0.5, url: `a-${i}` }))}
        covered={{ start: 0, end: 10 }}
        clipRecordings={clips}
        recordingStrips={recordingStrips}
      />,
    );
    const [a, b, b2] = urlsByClip(container);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((u) => u.startsWith("a-"))).toBe(true);
    // Clip b reads axis 10-14 = local 0-4 of B's webcam: frames b-0..b-3, nothing later.
    expect(b.length).toBeGreaterThan(0);
    expect(b.every((u) => u.startsWith("b-") && Number(u.slice(2)) <= 4)).toBe(true);
    // The second copy of B has its own range and its own strip.
    expect(b2.length).toBeGreaterThan(0);
    expect(b2.every((u) => u.startsWith("c-") && Number(u.slice(2)) <= 4)).toBe(true);
  });

  it("draws a joined clip when the opened recording is not first", () => {
    const joinedFirst = toLayout([
      { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 14 },
      { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 4 },
    ]);
    const { container } = render(
      <WebcamLane
        {...base}
        layout={joinedFirst}
        thumbnails={Array.from({ length: 10 }, (_, i) => ({ sourceTime: i + 0.5, url: `a-${i}` }))}
        covered={{ start: 0, end: 10 }}
        clipRecordings={
          new Map([
            ["a", clip(null, 0)],
            ["b", clip("src-b", 10)],
          ])
        }
        recordingStrips={recordingStrips}
      />,
    );
    const [first, second] = urlsByClip(container);
    expect(first.every((u) => u.startsWith("b-"))).toBe(true);
    expect(second.every((u) => u.startsWith("a-"))).toBe(true);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });

  it("leaves a joined clip empty until its strip is decoded or where its camera has no footage", () => {
    const { container } = render(
      <WebcamLane
        {...base}
        layout={joinedLayout}
        clipRecordings={clips}
        recordingStrips={
          new Map([["src-b2", { thumbnails: own("c"), covered: { start: 5, end: 10 } }]])
        }
        thumbnails={Array.from({ length: 10 }, (_, i) => ({ sourceTime: i + 0.5, url: `a-${i}` }))}
        covered={{ start: 0, end: 10 }}
      />,
    );
    const [, b, b2] = urlsByClip(container);
    expect(b).toEqual([]); // src-b not decoded yet: never borrows the opened recording's frames
    // B again: local 0-4 is before its camera starts (covered from 5).
    expect(b2).toEqual([]);
  });
});
