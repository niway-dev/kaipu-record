import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { VideoAnnotationLayer, type VideoAnnotationLayerProps } from "./video-annotation-layer";
import type { VideoOverlay } from "../scene";
import { TEXT_LINE_HEIGHT, TEXT_PX } from "@renderer/features/screenshots/annotations";

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

describe("editing a text label", () => {
  const label: VideoOverlay = {
    id: "t1",
    kind: "text",
    x: 0.5,
    y: 0.5,
    text: "hello",
    color: "#f6055c",
    size: 1,
    start: 0,
    end: 10,
  };

  /**
   * The real gesture, not a synthetic `dblclick`. A browser delivers
   * pointerdown/up/click twice and only then `dblclick`, and the first pointerdown
   * on a label starts a move drag and captures the pointer — which is exactly the
   * path a lone `fireEvent.doubleClick` skips. The original test skipped it, so it
   * stayed green while the gesture was broken in the app.
   */
  function realDoubleClick(layer: HTMLElement, at = { clientX: 200, clientY: 150 }): void {
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(layer, { ...at, pointerId: 1, button: 0 });
      fireEvent.pointerUp(layer, { ...at, pointerId: 1, button: 0 });
      fireEvent.click(layer, at);
    }
    fireEvent.doubleClick(layer, at);
  }

  /**
   * Which element captures the pointer is the whole bug.
   *
   * A `dblclick` only fires when both clicks share a target. Capturing on `e.target`
   * pins it to the node under the cursor — which for a label is a `<tspan>` that
   * React re-renders on selection and removes outright once the editor opens. The
   * resize branch has always captured on the layer, which is stable; the move branch
   * did not, and #184 made it bite by turning the label's content from a text node
   * (target: the `<text>` element) into `<tspan>` elements.
   *
   * jsdom implements no pointer capture at all, so it cannot reproduce the broken
   * gesture. It can prove the contract that fixes it: the layer captures, not the
   * glyph under the cursor.
   */
  it("captures the pointer on the layer, not on the node under the cursor", () => {
    const captured: Element[] = [];
    const original = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = function (this: Element): void {
      captured.push(this);
    };
    try {
      const { layer } = renderLayer({
        overlays: [label],
        visibleIds: new Set(["t1"]),
        selectedId: "t1",
      });
      const glyph = layer.querySelector("tspan");
      expect(glyph).not.toBeNull();

      fireEvent.pointerDown(glyph!, { clientX: 200, clientY: 150, pointerId: 1, button: 0 });

      expect(captured).toHaveLength(1);
      expect(captured[0]).toBe(layer);
      expect(captured[0]).not.toBe(glyph);
    } finally {
      Element.prototype.setPointerCapture = original;
    }
  });

  /**
   * A multi-line label has to be clickable over the words it actually draws.
   *
   * The hit box was `text.length * fs * 0.55` wide and one line tall: newlines were
   * counted as characters, so it stretched far past the right edge, while every line
   * after the first sat outside it. Clicking the body of a tall label therefore missed
   * the annotation entirely and fell through to the video, which started playing.
   *
   * The selection outline was fixed to use `textBoxPx`; this hit test was not, even
   * though its own comment claims it "matches the rendered bounds".
   */
  it("hits a multi-line label on its lower lines, not only the first", () => {
    const tall: VideoOverlay = { ...label, text: "one\ntwo\nthree", x: 0.1, y: 0.1 };
    const { props, layer } = renderLayer({
      overlays: [tall],
      visibleIds: new Set(["t1"]),
      selectedId: null,
    });

    // Third line, measured from the same helper the renderer uses: 400x300 layer.
    const fs = TEXT_PX[tall.size];
    const thirdLineY = 0.1 * 300 + fs * TEXT_LINE_HEIGHT * 2.5;
    fireEvent.pointerDown(layer, { clientX: 0.1 * 400 + 10, clientY: thirdLineY, pointerId: 1 });

    expect(props.onSelect).toHaveBeenCalledWith("t1");
  });

  it("does not claim clicks to the right of where the words end", () => {
    // Counting the whole string as one line inflated the width by the line count.
    // Three ten-character lines measured 32 chars wide instead of 10, so the box
    // reached roughly three times past the text and swallowed clicks on empty video.
    const line = "a".repeat(10);
    const tall: VideoOverlay = { ...label, text: `${line}\n${line}\n${line}`, x: 0.1, y: 0.1 };
    const { props, layer } = renderLayer({
      overlays: [tall],
      visibleIds: new Set(["t1"]),
      selectedId: null,
    });

    const fs = TEXT_PX[tall.size];
    const oneLineWide = line.length * fs * 0.55;
    // Past the widest line, but inside what the old box claimed.
    const x = 0.1 * 400 + oneLineWide * 2;
    fireEvent.pointerDown(layer, { clientX: x, clientY: 0.1 * 300 + 4, pointerId: 1 });

    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  // Reopening showed one line and you had to arrow down through the rest: the
  // textarea is born `rows={1}` and its auto-grow lives in `onInput`, which never
  // fires for a prefilled value. The screenshot editor sizes it in the focus effect;
  // that half did not get ported either.
  it("puts the caret at the end when reopening, ready to keep typing", () => {
    const { layer } = renderLayer({
      overlays: [{ ...label, text: "one\ntwo\nthree" }],
      visibleIds: new Set(["t1"]),
      selectedId: "t1",
    });
    fireEvent.doubleClick(layer, { clientX: 200, clientY: 150 });

    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("opens the editor from the real pointer sequence, not just a synthetic dblclick", () => {
    const { layer } = renderLayer({
      overlays: [label],
      visibleIds: new Set(["t1"]),
      selectedId: "t1",
    });
    realDoubleClick(layer);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("hello");
  });

  function openByDoubleClick(): VideoAnnotationLayerProps {
    const { props, layer } = renderLayer({
      overlays: [label],
      visibleIds: new Set(["t1"]),
      selectedId: "t1",
    });
    fireEvent.doubleClick(layer, { clientX: 200, clientY: 150 });
    return props;
  }

  // Before this, a label was write-once: the only way to change a typo was to delete
  // the overlay and type it again, losing its timeline window.
  it("reopens an existing label prefilled, on double click", () => {
    openByDoubleClick();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(input.value).toBe("hello");
  });

  it("updates that label in place instead of appending a second one", () => {
    const props = openByDoubleClick();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "goodbye" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const committed = (props.onCommit as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as VideoOverlay[];
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ id: "t1", text: "goodbye", start: 0, end: 10 });
  });

  // Shift+Enter must fall through to the textarea's own newline handling, the way a
  // spreadsheet cell behaves. Plain Enter still commits.
  it("does not commit on Shift+Enter", () => {
    const props = openByDoubleClick();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  // The inline editor sits exactly on top of the label, so leaving the label drawn
  // renders the same words twice, half a pixel apart, while you type. The screenshot
  // editor hides it; that one line did not get ported with the rest.
  it("hides the label it is editing, so the two do not overlap", () => {
    const { layer } = renderLayer({
      overlays: [label],
      visibleIds: new Set(["t1"]),
      selectedId: "t1",
    });
    const drawn = (): string => layer.querySelector("svg")?.textContent ?? "";
    expect(drawn()).toContain("hello");

    fireEvent.doubleClick(layer, { clientX: 200, clientY: 150 });

    // Scoped to the SVG on purpose: the textarea legitimately holds the same string,
    // and a bare text query matches it, which is what made the first version of this
    // test pass for the wrong reason.
    expect(drawn()).not.toContain("hello");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("hello");
  });

  it("keeps drawing every other overlay while one is being edited", () => {
    const other: VideoOverlay = { ...label, id: "t2", text: "untouched", y: 0.1 };
    const { layer } = renderLayer({
      overlays: [label, other],
      visibleIds: new Set(["t1", "t2"]),
      selectedId: "t1",
    });
    fireEvent.doubleClick(layer, { clientX: 200, clientY: 150 });
    expect(layer.querySelector("svg")?.textContent).toContain("untouched");
  });

  it("keeps the line breaks the user typed", () => {
    const props = openByDoubleClick();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "first\nsecond" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const committed = (props.onCommit as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as VideoOverlay[];
    expect(committed[0]).toMatchObject({ text: "first\nsecond" });
  });
});
