import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnotationOptions } from "./annotation-options";
import { ANNOTATION_COLORS } from "./tools";
import type { Annotation } from "./scene";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";

function makeTools(overrides: Partial<AnnotationToolsController> = {}): AnnotationToolsController {
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

function makeScene(annotations: Annotation[], selectedId: string | null): EditorScene {
  return {
    beautify: {} as EditorScene["beautify"],
    annotations,
    selectedId,
    select: vi.fn(),
    addAnnotation: vi.fn(),
    commitAnnotation: vi.fn(),
    beginInteract: vi.fn(),
    updateAnnotation: vi.fn(),
    endInteract: vi.fn(),
    removeSelected: vi.fn(),
    crop: undefined,
    setCrop: vi.fn(),
    setCropLive: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
  };
}

const box: Annotation = {
  id: "b1",
  kind: "box",
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  color: ANNOTATION_COLORS[0].value,
  stroke: 0,
  seed: 1,
};
const text: Annotation = {
  id: "t1",
  kind: "text",
  x: 0.5,
  y: 0.5,
  text: "Hi",
  color: ANNOTATION_COLORS[0].value,
  size: 1,
};
const blur: Annotation = { id: "bl1", kind: "blur", x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

describe("AnnotationOptions", () => {
  it("renders nothing with the select tool and no selection", () => {
    const { container } = render(
      <AnnotationOptions tools={makeTools()} scene={makeScene([], null)} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows colour + stroke controls when a drawing tool is active", () => {
    render(<AnnotationOptions tools={makeTools({ tool: "box" })} scene={makeScene([], null)} />);
    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByText("Stroke")).toBeInTheDocument();
  });

  it("renders nothing for the blur tool (no colour or stroke)", () => {
    const { container } = render(
      <AnnotationOptions tools={makeTools({ tool: "blur" })} scene={makeScene([], null)} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("recolours the selected box and makes that the current colour (sticks)", () => {
    const scene = makeScene([box], "b1");
    const tools = makeTools();
    render(<AnnotationOptions tools={tools} scene={scene} />);

    // Selection-aware: controls appear even though the active tool is "select".
    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByText("Stroke")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ANNOTATION_COLORS[2].name }));
    // Recolours the selection AND updates the tool default so the next shape matches.
    expect(scene.commitAnnotation).toHaveBeenCalledWith("b1", {
      color: ANNOTATION_COLORS[2].value,
    });
    expect(tools.setColor).toHaveBeenCalledWith(ANNOTATION_COLORS[2].value);
  });

  it("shows the size control and edits a selected text annotation", () => {
    const scene = makeScene([text], "t1");
    render(<AnnotationOptions tools={makeTools()} scene={scene} />);

    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.queryByText("Stroke")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Size L" }));
    expect(scene.commitAnnotation).toHaveBeenCalledWith("t1", { size: 3 });
  });

  it("offers a delete button for a selected shape and removes it on click", () => {
    const scene = makeScene([box], "b1");
    render(<AnnotationOptions tools={makeTools()} scene={scene} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(scene.removeSelected).toHaveBeenCalled();
  });

  it("shows a delete button for a selected blur even though it has no colour/stroke", () => {
    const scene = makeScene([blur], "bl1");
    render(<AnnotationOptions tools={makeTools()} scene={scene} />);

    // No colour/stroke controls for a blur…
    expect(screen.queryByText("Color")).toBeNull();
    expect(screen.queryByText("Stroke")).toBeNull();
    // …but it can still be deleted.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(scene.removeSelected).toHaveBeenCalled();
  });

  it("shows a reset control for the crop tool and clears the crop on click", () => {
    const scene = makeScene([], null);
    scene.crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    scene.setCrop = vi.fn();
    render(<AnnotationOptions tools={makeTools({ tool: "crop" })} scene={scene} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(scene.setCrop).toHaveBeenCalledWith(undefined);
  });

  it("disables the reset control when there is no crop to reset", () => {
    const scene = makeScene([], null); // crop is undefined
    render(<AnnotationOptions tools={makeTools({ tool: "crop" })} scene={scene} />);
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
  });
});
