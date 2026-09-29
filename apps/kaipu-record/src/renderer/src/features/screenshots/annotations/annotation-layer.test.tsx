import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnotationLayer } from "./annotation-layer";
import { ANNOTATION_COLORS } from "./tools";
import { handlesFor } from "./handles";
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

  it("Alt+Enter does not commit — it inserts a newline (spreadsheet/Excalidraw)", () => {
    const scene = makeScene([], null);
    const input = openTextInput(scene);
    fireEvent.change(input, { target: { value: "line 1" } });
    fireEvent.keyDown(input, { key: "Enter", altKey: true });
    expect(scene.addAnnotation).not.toHaveBeenCalled();
  });

  it("Shift+Enter does not commit either (also a newline)", () => {
    const scene = makeScene([], null);
    const input = openTextInput(scene);
    fireEvent.change(input, { target: { value: "line 1" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(scene.addAnnotation).not.toHaveBeenCalled();
  });

  it("commits multi-line text with its newline preserved", () => {
    const scene = makeScene([], null);
    const input = openTextInput(scene);
    fireEvent.change(input, { target: { value: "line 1\nline 2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(scene.addAnnotation).toHaveBeenCalledTimes(1);
    expect((scene.addAnnotation as ReturnType<typeof vi.fn>).mock.calls[0][0].text).toBe(
      "line 1\nline 2",
    );
  });

  // Give the layer a real box so toNorm maps client coords to normalized space and
  // the geometric hit-test can find a label (jsdom reports 0×0 otherwise).
  function renderSizedLayer(scene: EditorScene, tools: AnnotationToolsController) {
    const utils = render(<AnnotationLayer scene={scene} tools={tools} src="" />);
    const layer = utils.container.firstChild as HTMLElement;
    layer.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
      }) as DOMRect;
    return { ...utils, layer };
  }

  const label: Annotation = {
    id: "t1",
    kind: "text",
    x: 0.3,
    y: 0.3,
    text: "Hello",
    color: ANNOTATION_COLORS[0].value,
    size: 1,
  };

  it("double-clicking a label re-opens it prefilled and updates it in place", () => {
    const scene = makeScene([label], "t1");
    const { layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
    fireEvent.doubleClick(layer, { clientX: 30, clientY: 30 });
    const input = screen.getByDisplayValue("Hello"); // prefilled with the current text
    fireEvent.change(input, { target: { value: "Hello world" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(scene.commitAnnotation).toHaveBeenCalledWith("t1", { text: "Hello world" });
    expect(scene.addAnnotation).not.toHaveBeenCalled(); // updates, never duplicates
  });

  it("clearing the text while re-editing deletes the label", () => {
    const scene = makeScene([label], "t1");
    const { layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
    fireEvent.doubleClick(layer, { clientX: 30, clientY: 30 });
    const input = screen.getByDisplayValue("Hello");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(scene.removeSelected).toHaveBeenCalled();
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
  });

  it("shows the resize handles for a selected label that is not being edited", () => {
    const scene = makeScene([label], "t1");
    const { container } = renderSizedLayer(scene, makeTools({ tool: "select" }));
    expect(container.querySelectorAll('[data-testid="resize-handle"]').length).toBeGreaterThan(0);
  });

  it("hides the resize handles while the label is being edited", () => {
    // The handles are drawn from the label's STORED geometry, which stops matching
    // what the user is typing the moment they type it — a box that visibly deforms
    // around the inline editor. Resizing is impossible mid-edit anyway.
    const scene = makeScene([label], "t1");
    const { container, layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
    fireEvent.doubleClick(layer, { clientX: 30, clientY: 30 });
    screen.getByDisplayValue("Hello"); // the inline editor is open
    expect(container.querySelectorAll('[data-testid="resize-handle"]')).toHaveLength(0);
  });

  it("does not resize from a hidden handle while the label is being edited", () => {
    // The handles are gone, so their geometry must not be hit-tested either —
    // otherwise a corner the user cannot see still grabs and rescales the font.
    const scene = makeScene([label], "t1");
    const { layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
    fireEvent.doubleClick(layer, { clientX: 30, clientY: 30 });
    const handle = handlesFor(label, { w: 100, h: 100 })[0];
    fireEvent.pointerDown(layer, { clientX: handle.x * 100, clientY: handle.y * 100 });
    fireEvent.pointerMove(layer, { clientX: handle.x * 100 + 20, clientY: handle.y * 100 + 20 });
    // A resize of a text label rescales its font; nothing may do that mid-edit.
    const updates = (scene.updateAnnotation as ReturnType<typeof vi.fn>).mock.calls;
    for (const [, patch] of updates) expect(patch).not.toHaveProperty("fontPx");
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
