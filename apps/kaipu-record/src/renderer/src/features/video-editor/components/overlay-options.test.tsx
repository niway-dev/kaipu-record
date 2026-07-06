import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ANNOTATION_COLORS } from "@renderer/features/screenshots/annotations";
import { OverlayOptions } from "./overlay-options";
import type { VideoOverlay } from "../scene";
import type { VideoToolsController } from "../annotations/video-tools";

function makeTools(overrides: Partial<VideoToolsController> = {}): VideoToolsController {
  return {
    tool: "select",
    setTool: vi.fn(),
    color: ANNOTATION_COLORS[0].value,
    setColor: vi.fn(),
    stroke: 1,
    setStroke: vi.fn(),
    textSize: 1,
    setTextSize: vi.fn(),
    ...overrides,
  };
}

const box: VideoOverlay = {
  id: "b1",
  kind: "box",
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  color: ANNOTATION_COLORS[0].value,
  stroke: 0,
  seed: 1,
  start: 0,
  end: 5,
};

const text: VideoOverlay = {
  id: "t1",
  kind: "text",
  x: 0.5,
  y: 0.5,
  text: "Hi",
  color: ANNOTATION_COLORS[0].value,
  size: 1,
  start: 0,
  end: 5,
};

describe("OverlayOptions", () => {
  it("renders nothing with the select tool and no selection", () => {
    const { container } = render(
      <OverlayOptions
        tools={makeTools()}
        overlays={[]}
        selectedId={null}
        onCommitOverlay={vi.fn()}
        onDeleteSelected={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows colour + stroke controls when the box tool is active", () => {
    render(
      <OverlayOptions
        tools={makeTools({ tool: "box" })}
        overlays={[]}
        selectedId={null}
        onCommitOverlay={vi.fn()}
        onDeleteSelected={vi.fn()}
      />,
    );
    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByText("Stroke")).toBeInTheDocument();
  });

  it("shows colour + size controls when the text tool is active", () => {
    render(
      <OverlayOptions
        tools={makeTools({ tool: "text" })}
        overlays={[]}
        selectedId={null}
        onCommitOverlay={vi.fn()}
        onDeleteSelected={vi.fn()}
      />,
    );
    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
  });

  it("recolours the selected box and makes that the current colour (sticks)", () => {
    const onCommitOverlay = vi.fn();
    const tools = makeTools();
    render(
      <OverlayOptions
        tools={tools}
        overlays={[box]}
        selectedId="b1"
        onCommitOverlay={onCommitOverlay}
        onDeleteSelected={vi.fn()}
      />,
    );

    // Selection-aware: controls appear even though the active tool is "select".
    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByText("Stroke")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ANNOTATION_COLORS[2].name }));
    expect(onCommitOverlay).toHaveBeenCalledWith("b1", { color: ANNOTATION_COLORS[2].value });
    expect(tools.setColor).toHaveBeenCalledWith(ANNOTATION_COLORS[2].value);
  });

  it("shows the size control and edits a selected text overlay", () => {
    const onCommitOverlay = vi.fn();
    const tools = makeTools();
    render(
      <OverlayOptions
        tools={tools}
        overlays={[text]}
        selectedId="t1"
        onCommitOverlay={onCommitOverlay}
        onDeleteSelected={vi.fn()}
      />,
    );

    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.queryByText("Stroke")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Size L" }));
    expect(onCommitOverlay).toHaveBeenCalledWith("t1", { size: 3 });
    expect(tools.setTextSize).toHaveBeenCalledWith(3);
  });

  it("offers an Eliminar button for a selected overlay and removes it on click", () => {
    const onDeleteSelected = vi.fn();
    render(
      <OverlayOptions
        tools={makeTools()}
        overlays={[box]}
        selectedId="b1"
        onCommitOverlay={vi.fn()}
        onDeleteSelected={onDeleteSelected}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(onDeleteSelected).toHaveBeenCalled();
  });

  it("edits stroke width on a selected arrow overlay", () => {
    const onCommitOverlay = vi.fn();
    const tools = makeTools();
    const arrow: VideoOverlay = {
      id: "a1",
      kind: "arrow",
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      color: ANNOTATION_COLORS[0].value,
      stroke: 0,
      seed: 1,
      start: 0,
      end: 5,
    };
    render(
      <OverlayOptions
        tools={tools}
        overlays={[arrow]}
        selectedId="a1"
        onCommitOverlay={onCommitOverlay}
        onDeleteSelected={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stroke 2" }));
    expect(onCommitOverlay).toHaveBeenCalledWith("a1", { stroke: 1 });
    expect(tools.setStroke).toHaveBeenCalledWith(1);
  });

  it("sets the arrow tool default stroke when no overlay is selected", () => {
    const tools = makeTools({ tool: "arrow" });
    render(
      <OverlayOptions
        tools={tools}
        overlays={[]}
        selectedId={null}
        onCommitOverlay={vi.fn()}
        onDeleteSelected={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stroke 2" }));
    expect(tools.setStroke).toHaveBeenCalledWith(1);
  });
});
