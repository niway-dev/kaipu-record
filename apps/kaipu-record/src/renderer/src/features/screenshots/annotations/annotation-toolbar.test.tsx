import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnotationToolbar } from "./annotation-toolbar";
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

function makeScene(
  annotations: Annotation[],
  selectedId: string | null,
  overrides: Partial<EditorScene> = {},
): EditorScene {
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
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    ...overrides,
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

describe("AnnotationToolbar", () => {
  it("shows only the hint when the select tool is active with nothing selected", () => {
    render(<AnnotationToolbar tools={makeTools()} scene={makeScene([], null)} />);
    expect(screen.getByText(/selecciona una anotación/i)).toBeInTheDocument();
    expect(screen.queryByText("COLOR")).toBeNull();
  });

  it("shows colour + stroke controls when a drawing tool is active", () => {
    render(<AnnotationToolbar tools={makeTools({ tool: "box" })} scene={makeScene([], null)} />);
    expect(screen.getByText("COLOR")).toBeInTheDocument();
    expect(screen.getByText("TRAZO")).toBeInTheDocument();
  });

  it("edits the selected box's colour via commitAnnotation (not the tool default)", () => {
    const scene = makeScene([box], "b1");
    const tools = makeTools();
    render(<AnnotationToolbar tools={tools} scene={scene} />);

    // Selection-aware: COLOR + TRAZO appear even though the tool is "select".
    expect(screen.getByText("COLOR")).toBeInTheDocument();
    expect(screen.getByText("TRAZO")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ANNOTATION_COLORS[2].name }));
    expect(scene.commitAnnotation).toHaveBeenCalledWith("b1", {
      color: ANNOTATION_COLORS[2].value,
    });
    expect(tools.setColor).not.toHaveBeenCalled();
  });

  it("shows the size control and edits a selected text annotation", () => {
    const scene = makeScene([text], "t1");
    render(<AnnotationToolbar tools={makeTools()} scene={scene} />);

    expect(screen.getByText("TAMAÑO")).toBeInTheDocument();
    expect(screen.queryByText("TRAZO")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tamaño L" }));
    expect(scene.commitAnnotation).toHaveBeenCalledWith("t1", { size: 3 });
  });
});
