import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { VideoAnnotationLayer, type VideoAnnotationLayerProps } from "./video-annotation-layer";
import type { VideoOverlay } from "../scene";

// jsdom never lays anything out, so clientWidth/clientHeight default to 0 — that
// would make the layer's HANDLE_HIT_PX tolerance divide by a 0-sized box (falling
// back to a huge `12/1` tolerance), so ANY click would match the first handle.
// Pin both to the same 400x300 box used by mockRect() below.
beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
});
afterAll(() => {
  vi.restoreAllMocks();
});

/** The layer normalizes pointer positions against its own getBoundingClientRect —
 *  jsdom never lays anything out, so pin it to a fixed, non-zero box. */
function mockRect(el: HTMLElement): void {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
    toJSON: () => ({}),
  });
}

function makeProps(overrides: Partial<VideoAnnotationLayerProps> = {}): VideoAnnotationLayerProps {
  return {
    overlays: [],
    visibleIds: new Set(),
    selectedId: null,
    onSelect: vi.fn(),
    tool: "select",
    toolState: { color: "#f6055c", stroke: 1, textSize: 1 },
    playheadTime: 2,
    timelineDuration: 10,
    onDraft: vi.fn(),
    onCommit: vi.fn(),
    onInteractStart: vi.fn(),
    onInteractEnd: vi.fn(),
    ...overrides,
  };
}

function renderLayer(overrides: Partial<VideoAnnotationLayerProps> = {}): {
  props: VideoAnnotationLayerProps;
  layer: HTMLElement;
} {
  const props = makeProps(overrides);
  const { container } = render(<VideoAnnotationLayer {...props} />);
  const layer = container.firstChild as HTMLElement;
  mockRect(layer);
  return { props, layer };
}

const box: VideoOverlay = {
  id: "b1",
  kind: "box",
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  color: "#f6055c",
  stroke: 1,
  seed: 1,
  start: 0,
  end: 5,
};

describe("VideoAnnotationLayer — draw", () => {
  it("commits a box with a real id and auto-selects it", () => {
    const { props, layer } = renderLayer({ tool: "box" });
    fireEvent.pointerDown(layer, { clientX: 40, clientY: 30 });
    fireEvent.pointerMove(layer, { clientX: 200, clientY: 150 });
    fireEvent.pointerUp(layer);

    expect(props.onCommit).toHaveBeenCalledTimes(1);
    const committed = (props.onCommit as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as VideoOverlay[];
    expect(committed).toHaveLength(1);
    expect(committed[0].kind).toBe("box");
    expect(committed[0].id).not.toBe("draft");
    expect(props.onSelect).toHaveBeenCalledWith(committed[0].id);
  });

  it("does not commit a box that's too small", () => {
    const { props, layer } = renderLayer({ tool: "box" });
    fireEvent.pointerDown(layer, { clientX: 40, clientY: 30 });
    fireEvent.pointerMove(layer, { clientX: 41, clientY: 31 });
    fireEvent.pointerUp(layer);

    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("gives a new overlay a window starting at the (clamped) playhead", () => {
    const { props, layer } = renderLayer({ tool: "box", playheadTime: 8, timelineDuration: 10 });
    fireEvent.pointerDown(layer, { clientX: 40, clientY: 30 });
    fireEvent.pointerMove(layer, { clientX: 200, clientY: 150 });
    fireEvent.pointerUp(layer);

    const committed = (props.onCommit as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as VideoOverlay[];
    expect(committed[0].start).toBeCloseTo(8, 5);
    // end clamps to the timeline duration rather than overshooting start + 3s.
    expect(committed[0].end).toBeCloseTo(10, 5);
  });

  it("commits an arrow", () => {
    const { props, layer } = renderLayer({ tool: "arrow" });
    fireEvent.pointerDown(layer, { clientX: 40, clientY: 30 });
    fireEvent.pointerMove(layer, { clientX: 200, clientY: 150 });
    fireEvent.pointerUp(layer);

    expect(props.onCommit).toHaveBeenCalledTimes(1);
    const committed = (props.onCommit as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as VideoOverlay[];
    expect(committed[0].kind).toBe("arrow");
  });
});

describe("VideoAnnotationLayer — text tool", () => {
  it("opens an inline input and commits exactly once on Enter", () => {
    const { props, layer } = renderLayer({ tool: "text" });
    fireEvent.pointerDown(layer, { clientX: 40, clientY: 30 });
    const input = screen.getByPlaceholderText("Type…");
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onCommit).toHaveBeenCalledTimes(1);
    const committed = (props.onCommit as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as VideoOverlay[];
    expect(committed[0].kind).toBe("text");
    expect(props.onSelect).toHaveBeenCalledWith(committed[0].id);
  });

  it("does not commit on Escape (cancel)", () => {
    const { props, layer } = renderLayer({ tool: "text" });
    fireEvent.pointerDown(layer, { clientX: 40, clientY: 30 });
    const input = screen.getByPlaceholderText("Type…");
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(props.onCommit).not.toHaveBeenCalled();
  });
});

describe("VideoAnnotationLayer — select tool", () => {
  it("selects an overlay under the pointer and drives a move interaction", () => {
    const { props, layer } = renderLayer({ overlays: [box], visibleIds: new Set(["b1"]) });
    // Box spans normalized 0.1..0.3 both axes -> px 40..120 / 30..90.
    fireEvent.pointerDown(layer, { clientX: 80, clientY: 60 });
    expect(props.onSelect).toHaveBeenCalledWith("b1");
    expect(props.onInteractStart).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(layer, { clientX: 100, clientY: 80 });
    expect(props.onDraft).toHaveBeenCalled();
    const draft = (props.onDraft as ReturnType<typeof vi.fn>).mock.calls[0][0] as VideoOverlay;
    expect(draft.id).toBe("b1"); // real id preserved throughout the drag

    fireEvent.pointerUp(layer);
    expect(props.onInteractEnd).toHaveBeenCalledTimes(1);
    // Moves finalize through onInteractEnd only — never a separate onCommit.
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("grabs a resize handle instead of moving when the selection is clicked there", () => {
    const { props, layer } = renderLayer({
      overlays: [box],
      visibleIds: new Set(["b1"]),
      selectedId: "b1",
    });
    // The "se" handle sits at normalized (0.3, 0.3) -> px (120, 90).
    fireEvent.pointerDown(layer, { clientX: 120, clientY: 90 });
    fireEvent.pointerMove(layer, { clientX: 200, clientY: 150 });

    expect(props.onDraft).toHaveBeenCalled();
    const patched = (props.onDraft as ReturnType<typeof vi.fn>).mock.calls[0][0] as VideoOverlay;
    if (patched.kind !== "box") throw new Error("expected a box overlay");
    expect(patched.w).toBeGreaterThan(box.w); // se handle grows w/h, doesn't move x/y
    expect(patched.x).toBeCloseTo(box.x, 5);

    fireEvent.pointerUp(layer);
    expect(props.onInteractEnd).toHaveBeenCalledTimes(1);
  });

  it("deselects on an empty-area click", () => {
    const { props, layer } = renderLayer({
      overlays: [box],
      visibleIds: new Set(["b1"]),
      selectedId: "b1",
    });
    fireEvent.pointerDown(layer, { clientX: 350, clientY: 280 });
    expect(props.onSelect).toHaveBeenCalledWith(null);
    expect(props.onInteractStart).not.toHaveBeenCalled();
  });

  it("does not hit-test an overlay that's outside its window and not selected", () => {
    const { props, layer } = renderLayer({
      overlays: [box],
      visibleIds: new Set(),
      selectedId: null,
    });
    // Same click that hits the box in the "selects an overlay" test above.
    fireEvent.pointerDown(layer, { clientX: 80, clientY: 60 });
    expect(props.onSelect).toHaveBeenCalledWith(null);
    expect(props.onInteractStart).not.toHaveBeenCalled();
  });

  it("forwards a plain click on empty space to onBackgroundClick (dead <video onClick> fix)", () => {
    const onBackgroundClick = vi.fn();
    const { layer } = renderLayer({ tool: "select", onBackgroundClick });
    fireEvent.pointerDown(layer, { clientX: 350, clientY: 280 });
    fireEvent.pointerUp(layer, { clientX: 350, clientY: 280 });

    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onBackgroundClick when the click hits a shape", () => {
    const onBackgroundClick = vi.fn();
    const { layer } = renderLayer({
      tool: "select",
      overlays: [box],
      visibleIds: new Set(["b1"]),
      onBackgroundClick,
    });
    // Same click that hits the box in the "selects an overlay" test above.
    fireEvent.pointerDown(layer, { clientX: 80, clientY: 60 });
    fireEvent.pointerUp(layer, { clientX: 80, clientY: 60 });

    expect(onBackgroundClick).not.toHaveBeenCalled();
  });

  it("does not fire onBackgroundClick when the pointer drags past the click tolerance", () => {
    const onBackgroundClick = vi.fn();
    const { layer } = renderLayer({ tool: "select", onBackgroundClick });
    fireEvent.pointerDown(layer, { clientX: 350, clientY: 280 });
    fireEvent.pointerMove(layer, { clientX: 250, clientY: 200 });
    fireEvent.pointerUp(layer, { clientX: 250, clientY: 200 });

    expect(onBackgroundClick).not.toHaveBeenCalled();
  });
});

describe("VideoAnnotationLayer — onBackgroundClick, non-select tools", () => {
  it("does not fire onBackgroundClick while a drawing tool is active", () => {
    const onBackgroundClick = vi.fn();
    const { layer } = renderLayer({ tool: "box", onBackgroundClick });
    fireEvent.pointerDown(layer, { clientX: 350, clientY: 280 });
    fireEvent.pointerMove(layer, { clientX: 351, clientY: 281 });
    fireEvent.pointerUp(layer);

    expect(onBackgroundClick).not.toHaveBeenCalled();
  });
});

describe("VideoAnnotationLayer — visibility rendering", () => {
  it("does not render an overlay outside its window when unselected", () => {
    const { layer } = renderLayer({ overlays: [box], visibleIds: new Set(), selectedId: null });
    expect(layer.querySelector("path")).toBeNull();
  });

  it("renders the selected overlay dimmed even outside its window", () => {
    const { layer } = renderLayer({ overlays: [box], visibleIds: new Set(), selectedId: "b1" });
    expect(layer.querySelector('g[opacity="0.35"]')).not.toBeNull();
  });

  it("renders a visible overlay at full opacity", () => {
    const { layer } = renderLayer({
      overlays: [box],
      visibleIds: new Set(["b1"]),
      selectedId: null,
    });
    expect(layer.querySelector('g[opacity="1"]')).not.toBeNull();
  });
});
