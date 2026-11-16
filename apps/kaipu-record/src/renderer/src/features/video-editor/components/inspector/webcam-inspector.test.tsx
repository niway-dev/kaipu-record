import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WebcamEditing } from "../../webcam/use-webcam-editing";
import { WEBCAM_DEFAULTS, type WebcamLayout, type WebcamSegment } from "../../webcam/webcam-model";
import { webcamRect } from "../../webcam/webcam-layout";
import { WebcamInspector, WebcamSegmentInspector } from "./webcam-inspector";

const FRAME = { width: 1920, height: 1080 };
const layout = (patch: Partial<WebcamLayout> = {}): WebcamLayout => ({
  ...WEBCAM_DEFAULTS,
  ...patch,
});

function makeEdits(): WebcamEditing {
  return {
    webcam: null,
    visibleSegments: [],
    hideAtPlayhead: vi.fn(),
    changeAtPlayhead: vi.fn(),
    changeBlockedReason: vi.fn(() => null),
    commitTransition: vi.fn(),
    liveTransition: vi.fn(),
    remove: vi.fn(),
    edgeDrag: vi.fn(),
    commitLayout: vi.fn(),
    begin: vi.fn(),
    liveLayout: vi.fn(),
    end: vi.fn(),
  };
}

function renderGlobal(
  l = layout(),
  edits = makeEdits(),
  onHideHere = vi.fn(),
  changeBlocked: string | null = null,
) {
  const onChangeHere = vi.fn();
  render(
    <WebcamInspector
      layout={l}
      edits={edits}
      frame={FRAME}
      onHideHere={onHideHere}
      onChangeHere={onChangeHere}
      changeBlocked={changeBlocked}
    />,
  );
  return { edits, onHideHere, onChangeHere };
}

describe("WebcamInspector", () => {
  it("sets the shape on the global layout", () => {
    const { edits } = renderGlobal();
    expect(screen.getByRole("button", { name: "Circle" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Square" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ shape: "rounded" }, null);
  });

  it("changing the shape never rewrites the position: presets clamp to the edge by themselves", () => {
    const { edits } = renderGlobal(layout({ size: 0.22, position: { x: 0, y: 1 } }));
    fireEvent.click(screen.getByRole("button", { name: "Rectangle" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ shape: "rectangle" }, null);
  });

  it("sets the size: a keyboard step commits, a drag is one begin…end gesture", () => {
    const { edits } = renderGlobal();
    const slider = screen.getByRole("slider", { name: "Size" });
    fireEvent.change(slider, { target: { value: "0.3" } });
    expect(edits.commitLayout).toHaveBeenCalledWith({ size: 0.3 }, null);
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "0.4" } });
    fireEvent.pointerUp(slider);
    expect(edits.begin).toHaveBeenCalledOnce();
    expect(edits.liveLayout).toHaveBeenCalledWith({ size: 0.4 }, null);
    expect(edits.end).toHaveBeenCalledOnce();
  });

  it("labels the size slider 10% to 90% over the stored 0.12 to 0.90", () => {
    renderGlobal(layout({ size: 0.9 }));
    const slider = screen.getByRole("slider", { name: "Size" });
    expect(slider.getAttribute("min")).toBe("0.12");
    expect(slider.getAttribute("max")).toBe("0.9");
    expect(screen.getByText("90%")).toBeTruthy();
  });

  it("offers nine position presets and marks the one in use", () => {
    const { edits } = renderGlobal(layout({ size: 0.22, position: { x: 1, y: 0 } }));
    const group = screen.getByRole("group", { name: "Position" });
    expect(group.querySelectorAll("button")).toHaveLength(9);
    expect(screen.getByRole("button", { name: "Top right" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Bottom left" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ position: { x: 0, y: 1 } }, null);
  });

  it("marks a preset for a position dragged to the same edge", () => {
    // Dragged to the left edge while shrunk: the stored centre is the small box's half width.
    renderGlobal(layout({ shape: "rectangle", size: 0.42, position: { x: 0.0775, y: 0.5 } }));
    expect(screen.getByRole("button", { name: "Left" })).toHaveAttribute("aria-pressed", "true");
  });

  it("the Left preset on a rectangle sits flush at 2x zoom with shrink on (NIW2-636)", () => {
    const l = layout({ shape: "rectangle", size: 0.42, scaleDuringZoom: 0.7 });
    const { edits } = renderGlobal(l);
    fireEvent.click(screen.getByRole("button", { name: "Left" }));
    const patch = vi.mocked(edits.commitLayout).mock.calls[0]![0] as Partial<typeof l>;
    expect(webcamRect({ ...l, ...patch }, FRAME, 2)!.x).toBeCloseTo(0, 3);
  });

  it("toggles mirror and shadow", () => {
    const { edits } = renderGlobal(layout({ mirrored: true, shadow: false }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mirror" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ mirrored: false }, null);
    fireEvent.click(screen.getByRole("checkbox", { name: "Shadow" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ shadow: true }, null);
  });

  it("shrink during zoom: off is 1, on restores 0.7 and shows its slider", () => {
    const edits = makeEdits();
    const { unmount } = render(
      <WebcamInspector
        layout={layout()}
        edits={edits}
        frame={FRAME}
        onHideHere={vi.fn()}
        onChangeHere={vi.fn()}
        changeBlocked={null}
      />,
    );
    expect(screen.getByRole("slider", { name: "Size during zoom" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Shrink during zoom" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ scaleDuringZoom: 1 }, null);
    unmount();
    renderGlobal(layout({ scaleDuringZoom: 1 }), edits);
    expect(screen.queryByRole("slider", { name: "Size during zoom" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Shrink during zoom" }));
    expect(edits.commitLayout).toHaveBeenLastCalledWith({ scaleDuringZoom: 0.7 }, null);
  });

  it("hides the webcam at the playhead", () => {
    const { onHideHere } = renderGlobal();
    fireEvent.click(screen.getByRole("button", { name: "Hide webcam here" }));
    expect(onHideHere).toHaveBeenCalledOnce();
  });

  it("names the scope: the default camera, with no transition controls", () => {
    renderGlobal();
    expect(screen.getByText("Default camera")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Transition" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "Duration" })).toBeNull();
  });

  it("changes the camera from the playhead", () => {
    const { onChangeHere } = renderGlobal();
    fireEvent.click(screen.getByRole("button", { name: "Change camera from here" }));
    expect(onChangeHere).toHaveBeenCalledOnce();
  });

  it("disables Change camera from here and says why when it cannot apply", () => {
    const { onChangeHere } = renderGlobal(layout(), makeEdits(), vi.fn(), "No room left.");
    const button = screen.getByRole("button", { name: "Change camera from here" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "No room left.");
    fireEvent.click(button);
    expect(onChangeHere).not.toHaveBeenCalled();
  });
});

describe("WebcamSegmentInspector", () => {
  it("a hidden segment shows its range and deletes, without layout controls", () => {
    const edits = makeEdits();
    const onRemoved = vi.fn();
    render(
      <WebcamSegmentInspector
        segment={{ id: "h", start: 10, end: 15, mode: "hidden" }}
        index={2}
        range={{ from: 10, to: 15 }}
        layout={layout()}
        edits={edits}
        frame={FRAME}
        onRemoved={onRemoved}
      />,
    );
    expect(screen.getByRole("heading", { name: "Webcam section 2" })).toBeInTheDocument();
    expect(screen.getByText(/0:10.*→.*0:15/)).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Size" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete this webcam section" }));
    expect(edits.remove).toHaveBeenCalledWith("h");
    expect(onRemoved).toHaveBeenCalledOnce();
  });

  it("an override edits its own fields, at a time inside the segment", () => {
    const edits = makeEdits();
    render(
      <WebcamSegmentInspector
        segment={{ id: "o", start: 4, end: 8, mode: "override", layout: { shape: "rounded" } }}
        index={1}
        range={{ from: 4, to: 8 }}
        layout={layout({ shape: "rounded" })}
        edits={edits}
        frame={FRAME}
        onRemoved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Circle" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ shape: "circle" }, 4);
  });

  describe("a block's transition", () => {
    const block = (transition?: WebcamSegment["transition"]): WebcamSegment => ({
      id: "o",
      start: 4,
      end: 8,
      mode: "override",
      layout: { position: { x: 0.8, y: 0.2 } },
      transition,
    });
    function renderBlock(segment: WebcamSegment, edits = makeEdits()) {
      render(
        <WebcamSegmentInspector
          segment={segment}
          index={1}
          range={{ from: 4, to: 8 }}
          layout={layout()}
          edits={edits}
          frame={FRAME}
          onRemoved={vi.fn()}
        />,
      );
      return edits;
    }

    it("names the scope as the block's time range", () => {
      renderBlock(block());
      expect(screen.getByText(/0:04.*→.*0:08/)).toBeInTheDocument();
      expect(screen.queryByText("Default camera")).toBeNull();
    });

    it("shows a block with no transition as a Cut, without duration or easing", () => {
      renderBlock(block());
      expect(screen.getByRole("button", { name: "Cut" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Slide" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.queryByRole("slider", { name: "Duration" })).toBeNull();
      expect(screen.queryByRole("group", { name: "Motion" })).toBeNull();
    });

    it("switches to Slide and to Cut on the block", () => {
      const edits = renderBlock(block());
      fireEvent.click(screen.getByRole("button", { name: "Slide" }));
      expect(edits.commitTransition).toHaveBeenCalledWith("o", { kind: "slide" });
      fireEvent.click(screen.getByRole("button", { name: "Cut" }));
      expect(edits.commitTransition).toHaveBeenLastCalledWith("o", { kind: "cut" });
    });

    it("a Slide offers a 100 to 2000 ms duration, one undo step per drag", () => {
      const edits = renderBlock(block({ kind: "slide", ms: 700, easing: "back" }));
      const slider = screen.getByRole("slider", { name: "Duration" });
      expect(slider.getAttribute("min")).toBe("100");
      expect(slider.getAttribute("max")).toBe("2000");
      expect(screen.getByText("700 ms")).toBeInTheDocument();
      fireEvent.change(slider, { target: { value: "900" } });
      expect(edits.commitTransition).toHaveBeenCalledWith("o", { ms: 900 });
      fireEvent.pointerDown(slider);
      fireEvent.change(slider, { target: { value: "1200" } });
      fireEvent.pointerUp(slider);
      expect(edits.begin).toHaveBeenCalledOnce();
      expect(edits.liveTransition).toHaveBeenCalledWith("o", { ms: 1200 });
      expect(edits.end).toHaveBeenCalledOnce();
    });

    it("offers the four easing presets and marks the one in use", () => {
      const edits = renderBlock(block({ kind: "slide", ms: 700, easing: "back" }));
      const group = screen.getByRole("group", { name: "Motion" });
      expect(group.querySelectorAll("button")).toHaveLength(4);
      expect(screen.getByRole("button", { name: "Bounce" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      fireEvent.click(screen.getByRole("button", { name: "Linear" }));
      expect(edits.commitTransition).toHaveBeenCalledWith("o", { easing: "linear" });
      fireEvent.click(screen.getByRole("button", { name: "Smooth" }));
      expect(edits.commitTransition).toHaveBeenLastCalledWith("o", { easing: "ease-in-out" });
      fireEvent.click(screen.getByRole("button", { name: "Ease out" }));
      expect(edits.commitTransition).toHaveBeenLastCalledWith("o", { easing: "ease-out" });
    });

    it("a Cut that keeps a duration and easing still hides their controls", () => {
      renderBlock(block({ kind: "cut", ms: 900, easing: "linear" }));
      expect(screen.getByRole("button", { name: "Cut" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByRole("slider", { name: "Duration" })).toBeNull();
    });

    it("a hidden block has no transition controls", () => {
      renderBlock({ id: "h", start: 4, end: 8, mode: "hidden" });
      expect(screen.queryByRole("group", { name: "Transition" })).toBeNull();
    });
  });
});
