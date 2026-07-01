import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnotationLayer } from "./annotation-layer";
import { ANNOTATION_COLORS } from "./tools";
import type { Annotation, BoxAnnotation } from "./scene";
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

const box: BoxAnnotation = {
  id: "b1",
  kind: "box",
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  color: ANNOTATION_COLORS[0].value,
  stroke: 1,
  seed: 1,
};

describe("AnnotationLayer — keyboard", () => {
  it("deletes the selected annotation on Backspace", () => {
    const scene = makeScene([box], "b1");
    render(<AnnotationLayer scene={scene} tools={makeTools()} src="" />);
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(scene.removeSelected).toHaveBeenCalledTimes(1);
  });

  it("does not delete while typing in a text field", () => {
    const scene = makeScene([box], "b1");
    render(
      <>
        <input data-testid="field" />
        <AnnotationLayer scene={scene} tools={makeTools()} src="" />
      </>,
    );
    fireEvent.keyDown(screen.getByTestId("field"), { key: "Backspace" });
    expect(scene.removeSelected).not.toHaveBeenCalled();
  });

  it("does not delete while a modal is open", () => {
    const scene = makeScene([box], "b1");
    render(
      <>
        <div aria-modal="true" />
        <AnnotationLayer scene={scene} tools={makeTools()} src="" />
      </>,
    );
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(scene.removeSelected).not.toHaveBeenCalled();
  });
});

describe("AnnotationLayer — text tool", () => {
  function openTextInput(scene: EditorScene): HTMLElement {
    const { container } = render(
      <AnnotationLayer scene={scene} tools={makeTools({ tool: "text" })} src="" />,
    );
    fireEvent.pointerDown(container.firstChild as HTMLElement, { clientX: 10, clientY: 10 });
    return screen.getByPlaceholderText("Type…");
  }

  it("commits the text exactly once on Enter (no duplicate)", () => {
    const scene = makeScene([], null);
    const input = openTextInput(scene);
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(scene.addAnnotation).toHaveBeenCalledTimes(1);
  });

  it("does not commit on Escape (cancel)", () => {
    const scene = makeScene([], null);
    const input = openTextInput(scene);
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(scene.addAnnotation).not.toHaveBeenCalled();
  });

  it("auto-selects after committing text (switches to the select tool)", () => {
    const scene = makeScene([], null);
    const tools = makeTools({ tool: "text" });
    const { container } = render(<AnnotationLayer scene={scene} tools={tools} src="" />);
    fireEvent.pointerDown(container.firstChild as HTMLElement, { clientX: 10, clientY: 10 });
    const input = screen.getByPlaceholderText("Type…");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(tools.setTool).toHaveBeenCalledWith("select");
    expect(scene.select).toHaveBeenCalled();
  });
});

describe("AnnotationLayer — pen tool", () => {
  it("commits one path on a down → move → up freehand stroke", () => {
    const scene = makeScene([], null);
    const addAnnotation = scene.addAnnotation as ReturnType<typeof vi.fn>;
    const { container } = render(
      <AnnotationLayer scene={scene} tools={makeTools({ tool: "pen" })} src="" />,
    );
    const layer = container.firstChild as HTMLElement;
    fireEvent.pointerDown(layer, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(layer, { clientX: 20, clientY: 30 });
    fireEvent.pointerMove(layer, { clientX: 40, clientY: 50 });
    fireEvent.pointerUp(layer);
    expect(addAnnotation).toHaveBeenCalledTimes(1);
    expect(addAnnotation.mock.calls[0][0].kind).toBe("path");
  });
});
