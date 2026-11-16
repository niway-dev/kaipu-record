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
/** A part's or hidden range's click target (the button), in percent of the lane. */
const block = (c: HTMLElement, id: string) =>
  c.querySelector<HTMLElement>(`button[data-webcam-id="${id}"]`)!;
/** Where the box is really DRAWN, in lane px: the fill sits inside the target, in percent of it. */
const drawn = (el: HTMLElement): { left: number; width: number } => {
  const fill = el.querySelector<HTMLElement>("[data-webcam-fill]")!;
  const target = { left: px(el, "left"), width: px(el, "width") };
  return {
    left: target.left + (parseFloat(fill.style.left) / 100) * target.width,
    width: (parseFloat(fill.style.width) / 100) * target.width,
  };
};

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
    // Clip a's original piece is 0-5 s (500 px) here. A part starting at 0.5, 1.5 or 0.3 s
    // (source) cuts the piece before it down to 50, 150 or 30 px.
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

describe("WebcamLane: true width (decision 12)", () => {
  it("draws a 10 px part 10 px wide and leaves the original after it where it is", () => {
    const { container } = renderLane([part("p", 12, 12.1)]);
    const mine = drawn(block(container, "p"));
    expect(mine.left).toBeCloseTo(700, 3);
    expect(mine.width).toBeCloseTo(10, 3);
    // The original that follows (source 12.1-20, timeline 7.1-15) starts where the part ends.
    const after = originals(container).at(-1)!;
    expect(px(after, "left")).toBeCloseTo(710, 3);
    expect(px(after, "width")).toBeCloseTo(790, 3);
  });

  it("never moves or drops the short original between two parts", () => {
    // Source 2-2.01 and 2.2-2.21 are timeline 2-2.01 and 2.2-2.21: the 0.19 s between them is 19 px.
    const { container } = renderLane([part("p", 2, 2.01), part("q", 2.2, 2.21)]);
    const gap = originals(container).find((o) => Math.abs(px(o, "left") - 201) < 0.01)!;
    expect(gap).toBeDefined();
    expect(px(gap, "width")).toBeCloseTo(19, 3);
  });

  it("draws a lone part of 0.01 s 3 px wide", () => {
    const { container } = renderLane([part("p", 12, 12.01)]);
    expect(drawn(block(container, "p")).width).toBeCloseTo(3, 3);
  });

  it("does not let the 3 px floor cover the next part", () => {
    const { container } = renderLane([part("p", 12, 12.01), part("q", 12.02, 14)]);
    const p = drawn(block(container, "p"));
    expect(p.left).toBeCloseTo(700, 3);
    expect(p.width).toBeCloseTo(2, 3); // room before q (at 702 px) is 2 px
    expect(drawn(block(container, "q")).left).toBeCloseTo(702, 3);
  });

  it("gives a 3 px part a 12 px click target centred on it, and selects it from the target", () => {
    const { container, onSelect } = renderLane([part("p", 12, 12.03)]);
    const target = block(container, "p");
    expect(px(target, "width")).toBeCloseTo(12, 3);
    expect(px(target, "left") + px(target, "width") / 2).toBeCloseTo(701.5, 3);
    expect(drawn(target).width).toBeCloseTo(3, 3);
    fireEvent.click(target);
    expect(onSelect).toHaveBeenCalledWith("p");
  });

  it("gives two adjacent short parts a target each, never overlapping", () => {
    const { container } = renderLane([part("p", 12, 12.03), part("q", 12.03, 12.06)]);
    const p = block(container, "p");
    const q = block(container, "q");
    expect(px(p, "left") + px(p, "width")).toBeLessThanOrEqual(px(q, "left") + 1e-6);
    expect(drawn(p).width).toBeCloseTo(3, 3);
    expect(drawn(q).width).toBeCloseTo(3, 3);
  });

  it("leaves a part that is 12 px wide or more as its own target", () => {
    const { container } = renderLane([part("p", 12, 14)]);
    const el = block(container, "p");
    expect(px(el, "width")).toBeCloseTo(200, 3);
    expect(drawn(el).width).toBeCloseTo(200, 3);
  });

  it("draws the plain accent block below the glyph threshold: no frame, name or word", () => {
    const { container } = renderLane([part("p", 12, 12.3)]);
    const el = block(container, "p");
    expect(el.querySelector("[data-webcam-glyph]")).toBeNull();
    expect(el.textContent).toBe("");
  });

  it("keeps the slide's wedge inside the part, and drops it when it cannot be told from the block", () => {
    // A 1 s part slides at most half of it (50 px): the wedge fits inside the 100 px part.
    const wide = renderLane([part("w", 12, 13)]);
    const wedge = wide.container.querySelector<HTMLElement>("[data-webcam-transition]")!;
    expect(parseFloat(wedge.style.width)).toBeCloseTo(50, 3);
    expect(parseFloat(wedge.style.width)).toBeLessThanOrEqual(
      drawn(block(wide.container, "w")).width,
    );
    wide.unmount();
    // A 0.08 s part is 8 px; its slide is 4 px: too narrow to be a wedge, so none is drawn.
    const narrow = renderLane([part("n", 12, 12.08)]);
    expect(narrow.container.querySelector("[data-webcam-transition]")).toBeNull();
  });

  it("draws a cut's bar only where there is room for it", () => {
    const cut = { transition: { kind: "cut", ms: 700, easing: "back" } } as const;
    const room = renderLane([part("c", 12, 12.1, cut)]);
    expect(room.container.querySelector("[data-webcam-cut]")).not.toBeNull();
    room.unmount();
    const none = renderLane([part("c", 12, 12.04, cut)]);
    expect(none.container.querySelector("[data-webcam-cut]")).toBeNull();
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

  it("draws the pending 'New part' block next to the original stretches", () => {
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

  it("puts the handles at the part's real edges when it is 10 px wide or more", () => {
    const { container } = renderLane([part("p", 12, 12.1)], { selectedId: "p" });
    const start = container.querySelector<HTMLElement>('[data-webcam-handle="start"]')!;
    const end = container.querySelector<HTMLElement>('[data-webcam-handle="end"]')!;
    // 10 px: the real edges are 700 and 710, and the 6 px handles are centred on them.
    expect(handleCentre(start)).toBeCloseTo(700, 3);
    expect(handleCentre(end)).toBeCloseTo(710, 3);
  });

  it("moves the handles of a part narrower than 10 px apart, symmetrically", () => {
    const { container } = renderLane([part("p", 12, 12.03)], { selectedId: "p" });
    const start = container.querySelector<HTMLElement>('[data-webcam-handle="start"]')!;
    const end = container.querySelector<HTMLElement>('[data-webcam-handle="end"]')!;
    // 3 px wide: real edges at 700 and 703, each handle moved out by (10 - 3) / 2 = 3.5 px.
    expect(handleCentre(start)).toBeCloseTo(696.5, 3);
    expect(handleCentre(end)).toBeCloseTo(706.5, 3);
    expect(handleCentre(end) - handleCentre(start)).toBeGreaterThanOrEqual(10 - 1e-6);
  });

  it("changes the handle distance continuously with the width: no jump at 10 px", () => {
    const gap = (end: number): number => {
      const { container, unmount } = renderLane([part("p", 12, end)], { selectedId: "p" });
      const start = container.querySelector<HTMLElement>('[data-webcam-handle="start"]')!;
      const stop = container.querySelector<HTMLElement>('[data-webcam-handle="end"]')!;
      const result = handleCentre(stop) - handleCentre(start);
      unmount();
      return result;
    };
    // 9.9 px against 10.1 px: the handles of the narrower one are 0.05 px further out each,
    // so the distance moves by 0.1 px, not by a step.
    expect(gap(12.101) - gap(12.099)).toBeCloseTo(0.1, 3);
    expect(gap(12.05)).toBeCloseTo(10, 3);
  });

  it("keeps the grab offset: a handle drawn off its edge does not move the edge until the pointer does", () => {
    const { container, onEdgeDrag } = renderLane([part("p", 12, 12.03)], { selectedId: "p" });
    const lane = container.querySelector<HTMLElement>('[data-testid="webcam-lane"]')!;
    lane.getBoundingClientRect = () =>
      ({ left: 0, width: LANE_PX, top: 0, height: 44, right: LANE_PX, bottom: 44 }) as DOMRect;
    const start = container.querySelector<HTMLElement>('[data-webcam-handle="start"]')!;
    // The start handle is drawn at 696.5 px; the real edge (source 12 s) is at 700 px.
    const grab = handleCentre(start);
    fireEvent.pointerDown(start, { pointerId: 1, clientX: grab });
    fireEvent.pointerMove(start, { pointerId: 1, clientX: grab });
    expect(onEdgeDrag).toHaveBeenLastCalledWith("p", "start", expect.closeTo(12, 6), "move");
    // 100 px further right moves the edge by exactly one second.
    fireEvent.pointerMove(start, { pointerId: 1, clientX: grab + 100 });
    expect(onEdgeDrag).toHaveBeenLastCalledWith("p", "start", expect.closeTo(13, 6), "move");
  });
});

/** A handle's centre in lane px: `left` is a percent of the lane, the margin is -3 px + its shift. */
function handleCentre(el: HTMLElement): number {
  return (parseFloat(el.style.left) / 100) * LANE_PX + parseFloat(el.style.marginLeft) + 3;
}

describe("WebcamLane: a short part at the end of its clip", () => {
  // Clip a (source 0-5, timeline 0-5), a 3 s slide (timeline 5-8), clip b (source 10-20,
  // timeline 8-18). A 1500 px lane over 18 s: a second is 83.33 px.
  const slideLayout = toLayout([
    { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 5 },
    {
      id: "s",
      kind: "slide",
      assetId: "asset",
      duration: 3,
      naturalWidth: 100,
      naturalHeight: 100,
    },
    { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 20 },
  ] satisfies TrackItem[]);
  const PX_PER_SECOND = LANE_PX / 18;

  function renderOverSlide(segments: WebcamSegment[]) {
    return render(
      <TimelineViewContext.Provider value={fitView(LANE_PX, 18)}>
        <WebcamLane
          layout={slideLayout}
          segments={segments}
          selectedId={null}
          onSelect={vi.fn()}
          onEdgeDrag={vi.fn()}
        />
      </TimelineViewContext.Provider>,
    );
  }

  it("never draws the box over the slide that follows its clip", () => {
    // Source 4.99-5.0 is under a pixel at the end of clip a; the 3 px floor would reach the slide.
    const { container } = renderOverSlide([part("p", 4.99, 5)]);
    const box = drawn(block(container, "p"));
    expect(box.left).toBeCloseTo(4.99 * PX_PER_SECOND, 3);
    expect(box.left + box.width).toBeLessThanOrEqual(5 * PX_PER_SECOND + 1e-6);
  });

  it("still widens a short part to the 3 px floor when there is room inside its clip", () => {
    const { container } = renderOverSlide([part("p", 2, 2.01)]);
    expect(drawn(block(container, "p")).width).toBeCloseTo(3, 3);
  });
});
