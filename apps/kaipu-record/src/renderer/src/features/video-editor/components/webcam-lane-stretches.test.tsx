import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import type { WebcamSegment } from "../webcam/webcam-model";
import { fitView } from "./timeline-view";
import { TimelineViewContext } from "./timeline-pointer";
import { WebcamLane } from "./webcam-lane";

/**
 * The Camera lane draws EVERY stretch of the recording. Timeline: clip a is source 0-5 at
 * timeline 0-5, clip b is source 10-20 at timeline 5-15 (15 s). In a 1500 px lane a second is
 * exactly 100 px, so a width in the DOM (a percent of the lane) reads straight as pixels.
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
const hiddenRange = (id: string, start: number, end: number): WebcamSegment => ({
  id,
  start,
  end,
  mode: "hidden",
});

function renderLane(segments: WebcamSegment[], props: { selectedId?: string | null } = {}) {
  const onSelect = vi.fn();
  const onEdgeDrag = vi.fn();
  const view = render(
    <TimelineViewContext.Provider value={fitView(LANE_PX, 15)}>
      <WebcamLane
        layout={layout}
        segments={segments}
        selectedId={props.selectedId ?? null}
        onSelect={onSelect}
        onEdgeDrag={onEdgeDrag}
      />
    </TimelineViewContext.Provider>,
  );
  return { ...view, onSelect, onEdgeDrag };
}

const px = (el: HTMLElement, side: "left" | "width"): number =>
  (parseFloat(el.style[side]) / 100) * LANE_PX;
const originals = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>("[data-webcam-original]"));
const block = (c: HTMLElement, id: string) =>
  c.querySelector<HTMLElement>(`button[data-webcam-id="${id}"]`)!;

describe("WebcamLane: the original stretches", () => {
  it("draws the whole recording as original with no parts, one piece per clip", () => {
    const { container } = renderLane([]);
    const pieces = originals(container);
    expect(pieces).toHaveLength(2);
    const placed = pieces.map((p) => [px(p, "left"), px(p, "width")]);
    expect(placed[0]![0]).toBeCloseTo(0, 6);
    expect(placed[0]![1]).toBeCloseTo(500, 6);
    expect(placed[1]![0]).toBeCloseTo(500, 6);
    expect(placed[1]![1]).toBeCloseTo(1000, 6);
  });

  it("is not selectable: no button, hidden from assistive tech, takes no click", () => {
    const { container, onSelect } = renderLane([part("p", 12, 16)]);
    for (const piece of originals(container)) {
      expect(piece.tagName).toBe("SPAN");
      expect(piece).toHaveAttribute("aria-hidden", "true");
      fireEvent.click(piece);
    }
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelectorAll("button[data-webcam-id]")).toHaveLength(1);
  });

  it("shows its place's name and 'ORIGINAL' when there is room", () => {
    const { container } = renderLane([]);
    // The default layout sits bottom left. The 1000 px piece has room for every word.
    const wide = originals(container)[1]!;
    expect(wide).toHaveTextContent("Bottom left");
    expect(wide).toHaveTextContent("ORIGINAL");
    expect(wide.querySelector("[data-webcam-glyph]")).not.toBeNull();
  });

  it("drops 'ORIGINAL', then the name, then the frame as it narrows", () => {
    // Clip a's original piece is 0-5 s (500 px) here, but a part at 0.2-4.9 (source) leaves
    // slivers: 0-0.2 s is 20 px, and 4.9-5 s is 10 px.
    const medium = renderLane([part("m", 0.5, 12)]);
    // 0-0.5 s = 50 px: room for the frame (> 46) and nothing else.
    const [sliver] = originals(medium.container);
    expect(px(sliver!, "width")).toBeCloseTo(50, 3);
    expect(sliver!.querySelector("[data-webcam-glyph]")).not.toBeNull();
    expect(sliver).not.toHaveTextContent("Bottom left");
    expect(sliver).not.toHaveTextContent("ORIGINAL");
    medium.unmount();

    // 150 px: a name, no 'ORIGINAL' (needs > 190).
    const named = renderLane([part("m", 1.5, 12)]);
    const [piece] = originals(named.container);
    expect(px(piece!, "width")).toBeCloseTo(150, 3);
    expect(piece).toHaveTextContent("Bottom left");
    expect(piece).not.toHaveTextContent("ORIGINAL");
    named.unmount();

    // 30 px: not even the frame.
    const tiny = renderLane([part("m", 0.3, 12)]);
    const [thin] = originals(tiny.container);
    expect(px(thin!, "width")).toBeCloseTo(30, 3);
    expect(thin!.querySelector("[data-webcam-glyph]")).toBeNull();
    expect(thin!.textContent).toBe("");
  });

  it("has none where a part reaches the clip's end and the next clip's start", () => {
    const { container } = renderLane([part("p", 0, 20)]);
    expect(originals(container)).toHaveLength(0);
  });
});

describe("WebcamLane: parts", () => {
  it("draws a selectable block with the place's name and 'SLIDE 0.7 s'", () => {
    const { container, onSelect } = renderLane([part("p", 12, 16)]);
    const el = block(container, "p");
    expect(el).toHaveAttribute("data-mode", "override");
    expect(el).toHaveTextContent("Top right");
    expect(el).toHaveTextContent("SLIDE 0.7 s");
    expect(el.querySelector("[data-webcam-transition]")).not.toBeNull();
    expect(el.querySelector("[data-webcam-cut]")).toBeNull();
    fireEvent.click(el);
    expect(onSelect).toHaveBeenCalledWith("p");
  });

  it("says 'CUT' with a thin bar instead of a wedge for a cut", () => {
    const cut = part("c", 12, 16, { transition: { kind: "cut", ms: 700, easing: "back" } });
    const { container } = renderLane([cut]);
    const el = block(container, "c");
    expect(el).toHaveTextContent("CUT");
    expect(el).not.toHaveTextContent("SLIDE");
    expect(el.querySelector("[data-webcam-cut]")).not.toBeNull();
    expect(el.querySelector("[data-webcam-transition]")).toBeNull();
  });

  it("calls a part saved without a transition a cut, too", () => {
    const { container } = renderLane([part("n", 12, 16, { transition: undefined })]);
    expect(block(container, "n")).toHaveTextContent("CUT");
  });

  it("writes the slide's real length: at most half of a short part", () => {
    const short = part("s", 12, 13, { transition: { kind: "slide", ms: 2000, easing: "back" } });
    const { container } = renderLane([short]);
    // 1 s is 100 px: too narrow for the word (needs > 200). Widen the part to read it.
    expect(block(container, "s")).not.toHaveTextContent("SLIDE");
    const wide = renderLane([
      part("w", 10, 14.5, { transition: { kind: "slide", ms: 9000, easing: "back" } }),
    ]);
    expect(block(wide.container, "w")).toHaveTextContent("SLIDE 2.25 s");
  });

  it("names the part's place from its own position, not the original's", () => {
    const { container } = renderLane([
      part("tl", 10, 14, { layout: { position: { x: 0.1, y: 0.1 } } }),
      part("c", 15, 19, { layout: { position: { x: 0.5, y: 0.5 } } }),
    ]);
    expect(block(container, "tl")).toHaveTextContent("Top left");
    expect(block(container, "c")).toHaveTextContent("Center");
  });

  it("shows only what fits: a 150 px part has the frame and name but not the slide word", () => {
    const { container } = renderLane([part("p", 12, 13.5)]);
    const el = block(container, "p");
    expect(px(el, "width")).toBeCloseTo(150, 3);
    expect(el).toHaveTextContent("Top right");
    expect(el).not.toHaveTextContent("SLIDE");
  });
});

describe("WebcamLane: the 56 px rule", () => {
  it("draws a 10 px part 56 px wide, with the original after it starting where it ends", () => {
    const { container } = renderLane([part("p", 12, 12.1)]);
    const el = block(container, "p");
    expect(px(el, "left")).toBeCloseTo(700, 3);
    expect(px(el, "width")).toBeCloseTo(56, 3);
    // The original that follows (source 12.1-20, timeline 7.1-15) is drawn from 756, to 1500.
    const after = originals(container).at(-1)!;
    expect(px(after, "left")).toBeCloseTo(756, 3);
    expect(px(after, "width")).toBeCloseTo(744, 3);
  });

  it("never draws a part over the one next to it", () => {
    // Two parts 0.2 s each, 0.3 s apart: room for the first is 50 px, less than 56.
    const { container } = renderLane([part("p", 12, 12.2), part("q", 12.5, 12.7)]);
    expect(px(block(container, "p"), "width")).toBeCloseTo(50, 3);
    expect(px(block(container, "q"), "width")).toBeCloseTo(56, 3);
  });

  it("keeps two touching parts as wide as they are when the first has no room", () => {
    const { container } = renderLane([part("p", 12, 12.2), part("q", 12.2, 14)]);
    expect(px(block(container, "p"), "width")).toBeCloseTo(20, 3);
    expect(px(block(container, "q"), "left")).toBeCloseTo(720, 3);
  });

  it("leaves a part wider than 56 px exactly as wide as its time", () => {
    const { container } = renderLane([part("p", 12, 14)]);
    expect(px(block(container, "p"), "width")).toBeCloseTo(200, 3);
  });
});

describe("WebcamLane: hidden ranges", () => {
  it("draws a striped block with the eye-off icon and 'Hidden', selectable", () => {
    const { container, onSelect } = renderLane([hiddenRange("h", 12, 16)]);
    const el = block(container, "h");
    expect(el).toHaveAttribute("data-mode", "hidden");
    expect(el).toHaveTextContent("Hidden");
    expect(el.querySelector("svg")).not.toBeNull();
    // A hidden range names no place and slides nowhere.
    expect(el.querySelector("[data-webcam-glyph]")).toBeNull();
    expect(el.querySelector("[data-webcam-transition]")).toBeNull();
    fireEvent.click(el);
    expect(onSelect).toHaveBeenCalledWith("h");
  });

  it("keeps both edge handles when selected", () => {
    const { container } = renderLane([hiddenRange("h", 12, 16)], { selectedId: "h" });
    expect(container.querySelector('[data-webcam-handle="start"]')).not.toBeNull();
    expect(container.querySelector('[data-webcam-handle="end"]')).not.toBeNull();
  });

  it("drops the word when it is too narrow, keeping the icon", () => {
    const { container } = renderLane([hiddenRange("h", 12, 12.3)]);
    const el = block(container, "h");
    expect(el).not.toHaveTextContent("Hidden");
    expect(el.querySelector("svg")).not.toBeNull();
  });
});

describe("WebcamLane: every stretch together", () => {
  it("draws original, part, hidden and original in order across the lane, none over another", () => {
    const { container } = renderLane([part("p", 12, 14), hiddenRange("h", 16, 18)]);
    const all = Array.from(
      container.querySelectorAll<HTMLElement>("[data-webcam-original], button[data-webcam-id]"),
    )
      .map((el) => ({ el, left: px(el, "left"), width: px(el, "width") }))
      .sort((a, b) => a.left - b.left);
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.left).toBeGreaterThanOrEqual(all[i - 1]!.left + all[i - 1]!.width - 0.01);
    }
    const kinds = all.map(({ el }) =>
      el.hasAttribute("data-webcam-original") ? "original" : el.getAttribute("data-mode"),
    );
    expect(kinds).toEqual(["original", "original", "override", "original", "hidden", "original"]);
  });

  it("leaves Unit 1's 'New part' block working next to the stretches", () => {
    const { container } = render(
      <TimelineViewContext.Provider value={fitView(LANE_PX, 15)}>
        <WebcamLane
          layout={layout}
          segments={[]}
          selectedId={null}
          onSelect={vi.fn()}
          onEdgeDrag={vi.fn()}
          pendingPart={{ start: 12, end: 20 }}
        />
      </TimelineViewContext.Provider>,
    );
    expect(within(container).getByText("New part · 8 s")).toBeInTheDocument();
    expect(originals(container)).toHaveLength(2);
  });
});

describe("WebcamLane: selecting", () => {
  it("selects a part or hidden range by its button, by name 'Webcam section n'", () => {
    const { onSelect } = renderLane([part("p", 12, 16), hiddenRange("h", 17, 19)]);
    fireEvent.click(screen.getByRole("button", { name: "Webcam section 2" }));
    expect(onSelect).toHaveBeenCalledWith("h");
    fireEvent.click(screen.getByRole("button", { name: "Webcam section 1" }));
    expect(onSelect).toHaveBeenLastCalledWith("p");
  });

  it("puts the handles at the part's real edges, not at its widened edge", () => {
    const { container } = renderLane([part("p", 12, 12.1)], { selectedId: "p" });
    const end = container.querySelector<HTMLElement>('[data-webcam-handle="end"]')!;
    // The block is drawn 56 px wide, but the part ends 10 px after it starts (710 px).
    const percent = parseFloat(/calc\(([\d.]+)%/.exec(end.style.left)![1]!);
    expect((percent / 100) * LANE_PX).toBeCloseTo(710, 3);
  });
});
