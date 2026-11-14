import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import type { AudioPeaks } from "../use-audio-peaks";
import { AudioLane, type AudioLaneProps } from "./audio-lane";
import { TimelineViewContext } from "./timeline-pointer";
import { fitView } from "./timeline-view";

const items: TrackItem[] = [{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 }];
const layout = toLayout(items);

/** 10 s of steady speech-level peaks. */
const waveform: AudioPeaks = {
  peaks: new Float32Array(1000).fill(0.2),
  filled: 1000,
  reference: 0.2,
  complete: true,
};

function lane(overrides: Partial<AudioLaneProps> = {}): React.JSX.Element {
  return (
    <AudioLane
      ranges={[]}
      layout={layout}
      audioMuted={false}
      selectedId={null}
      onSelect={vi.fn()}
      onEdgeDrag={vi.fn()}
      {...overrides}
    />
  );
}

/** A 2D context that only records the bars: jsdom has no canvas. */
function stubCanvas() {
  const alphas: number[] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(() => alphas.push(ctx.globalAlpha)),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  return { ctx, alphas };
}

// jsdom has no canvas: by default getContext answers null, as it does there, silently.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("AudioLane waveform", () => {
  it("looks as it always did without a waveform: the empty-state text, no canvas", () => {
    const { container } = render(lane());
    expect(screen.getByText("No muted sections yet.")).toBeTruthy();
    expect(container.querySelector("[data-audio-waveform]")).toBeNull();
  });

  it("treats a null or still-empty waveform like no waveform", () => {
    const { container, rerender } = render(lane({ waveform: null }));
    expect(screen.getByText("No muted sections yet.")).toBeTruthy();
    rerender(
      lane({ waveform: { peaks: new Float32Array(10), filled: 0, reference: 0, complete: false } }),
    );
    expect(screen.getByText("No muted sections yet.")).toBeTruthy();
    expect(container.querySelector("[data-audio-waveform]")).toBeNull();
  });

  it("draws one decorative canvas and hides the empty-state text when there are peaks", () => {
    const { container } = render(lane({ waveform }));
    const canvas = container.querySelector("[data-audio-waveform]");
    expect(canvas).not.toBeNull();
    expect(canvas!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByText("No muted sections yet.")).toBeNull();
  });

  it("marks the canvas complete only once the whole recording is decoded", () => {
    const { container, rerender } = render(lane({ waveform: { ...waveform, complete: false } }));
    const attr = () =>
      container.querySelector("[data-audio-waveform]")!.getAttribute("data-audio-waveform");
    expect(attr()).toBe("partial");
    rerender(lane({ waveform }));
    expect(attr()).toBe("complete");
  });

  it("covers only the visible window of the lane under a timeline strip", () => {
    const view = { ...fitView(500, 10), zoom: 4, scroll: 300 };
    const { container } = render(
      <TimelineViewContext.Provider value={view}>
        {lane({ waveform })}
      </TimelineViewContext.Provider>,
    );
    const canvas = container.querySelector<HTMLElement>("[data-audio-waveform]")!;
    expect(canvas.style.left).toBe("300px");
    expect(canvas.style.width).toBe("500px");
  });

  it("draws the bars of the window, dimming those under a muted range", () => {
    const { alphas } = stubCanvas();
    const view = fitView(100, 10); // 10 px per second: a bar covers 0.5 s
    const { container } = render(
      <TimelineViewContext.Provider value={view}>
        {lane({ waveform, ranges: [{ id: "m", sourceStart: 2, sourceEnd: 4 }] })}
      </TimelineViewContext.Provider>,
    );
    expect(container.querySelector("[data-audio-waveform]")).not.toBeNull();
    // 100 px / 5 px pitch = 20 bars; the muted 2..4 s covers bars 4..7 (midpoints 2.25..3.75).
    expect(alphas).toHaveLength(20);
    expect(alphas.filter((a) => a < 1)).toHaveLength(4);
    expect(alphas.slice(4, 8)).toEqual([0.3, 0.3, 0.3, 0.3]);
  });

  it("keeps the muted blocks interactive on top of the waveform", () => {
    stubCanvas();
    const onSelect = vi.fn();
    render(
      <TimelineViewContext.Provider value={fitView(100, 10)}>
        {lane({ waveform, ranges: [{ id: "m", sourceStart: 2, sourceEnd: 4 }], onSelect })}
      </TimelineViewContext.Provider>,
    );
    screen.getByRole("button", { pressed: false }).click();
    expect(onSelect).toHaveBeenCalledWith("m");
  });

  it("draws every bar dimmed under the whole-recording-muted overlay", () => {
    const { alphas } = stubCanvas();
    const { container } = render(
      <TimelineViewContext.Provider value={fitView(100, 10)}>
        {lane({ waveform, audioMuted: true })}
      </TimelineViewContext.Provider>,
    );
    expect(container.querySelector("[data-audio-waveform]")).not.toBeNull();
    expect(screen.getByText("The whole recording is muted")).toBeTruthy();
    expect(alphas.length).toBeGreaterThan(0);
    expect(alphas.every((a) => a === 0.3)).toBe(true);
  });

  it("does not throw where a canvas has no 2D context", () => {
    expect(() => render(lane({ waveform }))).not.toThrow();
  });
});
