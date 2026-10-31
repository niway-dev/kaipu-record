import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WebcamEditing } from "../../webcam/use-webcam-editing";
import { WEBCAM_DEFAULTS, type WebcamLayout } from "../../webcam/webcam-model";
import { webcamPresetCenter } from "../../webcam/webcam-layout";
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
    remove: vi.fn(),
    edgeDrag: vi.fn(),
    commitLayout: vi.fn(),
    begin: vi.fn(),
    liveLayout: vi.fn(),
    end: vi.fn(),
  };
}

function renderGlobal(l = layout(), edits = makeEdits(), onHideHere = vi.fn()) {
  render(<WebcamInspector layout={l} edits={edits} frame={FRAME} onHideHere={onHideHere} />);
  return { edits, onHideHere };
}

describe("WebcamInspector", () => {
  it("sets the shape on the global layout", () => {
    const { edits } = renderGlobal();
    expect(screen.getByRole("button", { name: "Circle" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Rounded" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ shape: "rounded" }, null);
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

  it("offers nine position presets and marks the one in use", () => {
    const at = webcamPresetCenter({ x: 1, y: 0 }, 0.22, FRAME);
    const { edits } = renderGlobal(layout({ size: 0.22, position: at }));
    const group = screen.getByRole("group", { name: "Position" });
    expect(group.querySelectorAll("button")).toHaveLength(9);
    expect(screen.getByRole("button", { name: "Top right" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Bottom left" }));
    expect(edits.commitLayout).toHaveBeenCalledWith(
      { position: webcamPresetCenter({ x: 0, y: 1 }, 0.22, FRAME) },
      null,
    );
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
      <WebcamInspector layout={layout()} edits={edits} frame={FRAME} onHideHere={vi.fn()} />,
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
});
