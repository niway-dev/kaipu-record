import React, { useState } from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    stepSize: 1,
    setStepSize: vi.fn(),
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
    endInteract: vi.fn(),
    removeAnnotation: vi.fn(),
    removeSelected: vi.fn(),
    crop: undefined,
    setCrop: vi.fn(),
    setExportFrame: vi.fn(),
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

afterEach(() => {
  // @ts-expect-error — drop the instance-less stubs renderSizedLayer put on the prototype
  delete HTMLElement.prototype.clientWidth;
  // @ts-expect-error — see above
  delete HTMLElement.prototype.clientHeight;
});

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
    // The layer measures itself from clientWidth/clientHeight on mount (jsdom: 0×0),
    // which would make every px-based derivation (handle tolerance, shape transforms)
    // degenerate. Restored in afterEach.
    for (const prop of ["clientWidth", "clientHeight"]) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
    }
    const utils = render(<AnnotationLayer scene={scene} tools={tools} src="" />);
    const layer = utils.container.firstChild as HTMLElement;
    layer.setPointerCapture = vi.fn();
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
    expect(scene.removeAnnotation).toHaveBeenCalledWith("t1");
    expect(scene.removeSelected).not.toHaveBeenCalled();
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
  });

  it("clearing a label and then grabbing another shape deletes the label, not the shape (SHOT-B5)", async () => {
    const farBox: BoxAnnotation = { ...box, x: 0.7, y: 0.7, w: 0.2, h: 0.2 };
    const scene = makeScene([label, farBox], "t1");
    const { layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
    fireEvent.doubleClick(layer, { clientX: 30, clientY: 30 });
    const input = screen.getByDisplayValue("Hello");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.pointerDown(layer, { clientX: 80, clientY: 80 }); // the far box
    // Blur-to-commit only arms after one frame.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    fireEvent.blur(input);
    expect(scene.removeAnnotation).toHaveBeenCalledWith("t1");
    expect(scene.removeSelected).not.toHaveBeenCalled();
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
    fireEvent.pointerUp(layer);
    // A resize of a text label rescales its font; nothing may do that mid-edit.
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
  });

  it("does not drag the label out from under its own inline editor", () => {
    // The hit-test keeps an 8px margin around the label and the textarea covers only
    // the box, so a press in that ring reaches the layer. It must not grab the label
    // the user is typing into.
    const scene = makeScene([label], "t1");
    const { layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
    fireEvent.doubleClick(layer, { clientX: 30, clientY: 30 });
    fireEvent.pointerDown(layer, { clientX: 31, clientY: 31 });
    fireEvent.pointerMove(layer, { clientX: 45, clientY: 45 });
    fireEvent.pointerUp(layer);
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
  });

  it("still lets another shape be grabbed while a label is being edited", () => {
    // Only the edited label is off limits; the rest of the canvas keeps working.
    // The box sits well clear of the label so each click lands on one of them.
    const farBox: BoxAnnotation = { ...box, x: 0.05, y: 0.05, w: 0.1, h: 0.1 };
    const scene = makeScene([label, farBox], "t1");
    const { layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
    fireEvent.doubleClick(layer, { clientX: 30, clientY: 30 });
    screen.getByDisplayValue("Hello"); // the label's editor is open
    fireEvent.pointerDown(layer, { clientX: 10, clientY: 10 }); // inside the box
    fireEvent.pointerMove(layer, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(layer);
    expect(scene.select).toHaveBeenCalledWith("b1");
    expect(scene.commitAnnotation).toHaveBeenCalledWith("b1", expect.any(Object));
  });

  // A box big enough that its centre is outside every handle's 12px hit tolerance.
  const bigBox: BoxAnnotation = { ...box, w: 0.6, h: 0.6 };

  it("commits a move once on release with the final geometry", () => {
    const scene = makeScene([bigBox], "b1"); // bigBox at 0.1,0.1, clear of every handle
    const { layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
    fireEvent.pointerDown(layer, { clientX: 40, clientY: 40 });
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 50 });
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
    fireEvent.pointerUp(layer);
    expect(scene.commitAnnotation).toHaveBeenCalledTimes(1);
    expect(scene.commitAnnotation).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({ x: expect.closeTo(0.2, 5), y: expect.closeTo(0.2, 5) }),
    );
    expect(scene.beginInteract).not.toHaveBeenCalled();
  });

  it("a click without movement commits nothing", () => {
    const scene = makeScene([bigBox], "b1");
    const { layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
    fireEvent.pointerDown(layer, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(layer);
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
  });

  it("the dragged shape moves in the DOM before any commit", () => {
    const scene = makeScene([bigBox], "b1");
    const { layer, container } = renderSizedLayer(scene, makeTools({ tool: "select" }));
    const group = (): string | null | undefined =>
      container.querySelector("g[data-annotation='b1']")?.getAttribute("transform");
    const before = group();
    expect(before).toBeTruthy();
    fireEvent.pointerDown(layer, { clientX: 40, clientY: 40 });
    fireEvent.pointerMove(layer, { clientX: 60, clientY: 60 });
    expect(group()).not.toBe(before);
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
  });

  it("commits a resize once on release", () => {
    const scene = makeScene([box], "b1");
    const { layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
    const handle = handlesFor(box, { w: 100, h: 100 })[0];
    fireEvent.pointerDown(layer, { clientX: handle.x * 100, clientY: handle.y * 100 });
    fireEvent.pointerMove(layer, { clientX: handle.x * 100 + 5, clientY: handle.y * 100 + 5 });
    fireEvent.pointerMove(layer, { clientX: handle.x * 100 + 10, clientY: handle.y * 100 + 10 });
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
    fireEvent.pointerUp(layer);
    expect(scene.commitAnnotation).toHaveBeenCalledTimes(1);
    expect(scene.beginInteract).not.toHaveBeenCalled();
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

describe("AnnotationLayer — canvas mode (NIW2-698)", () => {
  // The layer measures the SHOT (100×100 here); the canvas is bigger, so a press can land
  // outside it. The hit surface carries such a press to the layer's handler.
  function renderCanvasLayer(scene: EditorScene, tools: AnnotationToolsController, canvas = true) {
    for (const prop of ["clientWidth", "clientHeight"]) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
    }
    const utils = render(<AnnotationLayer scene={scene} tools={tools} src="" canvas={canvas} />);
    const layer = utils.container.firstChild as HTMLElement;
    layer.setPointerCapture = vi.fn();
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

  it("renders an invisible hit surface only in canvas mode", () => {
    const on = renderCanvasLayer(makeScene([], null), makeTools());
    expect(screen.queryByTestId("canvas-hit-surface")).not.toBeNull();
    on.unmount();
    renderCanvasLayer(makeScene([], null), makeTools(), false);
    expect(screen.queryByTestId("canvas-hit-surface")).toBeNull();
  });

  it("a press outside the shot (on the hit surface) draws a box with coordinates outside 0–1", () => {
    const scene = makeScene([], null);
    const tools = makeTools({ tool: "box" });
    renderCanvasLayer(scene, tools);
    const surface = screen.getByTestId("canvas-hit-surface");
    surface.setPointerCapture = vi.fn();
    // Shot is 100×100 at (0,0): from (-50,-40) to (-10,-5) is entirely left/above it.
    fireEvent.pointerDown(surface, { clientX: -50, clientY: -40 });
    fireEvent.pointerMove(surface, { clientX: -10, clientY: -5 });
    fireEvent.pointerUp(surface);
    expect(scene.addAnnotation).toHaveBeenCalledTimes(1);
    const added = (scene.addAnnotation as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as BoxAnnotation;
    expect(added.kind).toBe("box");
    expect(added.x).toBeCloseTo(-0.5);
    expect(added.y).toBeCloseTo(-0.4);
    expect(added.w).toBeCloseTo(0.4);
    expect(added.h).toBeCloseTo(0.35);
  });

  it("text can be placed and committed outside the shot", () => {
    const scene = makeScene([], null);
    renderCanvasLayer(scene, makeTools({ tool: "text" }));
    fireEvent.pointerDown(screen.getByTestId("canvas-hit-surface"), { clientX: 160, clientY: 130 });
    const input = screen.getByPlaceholderText("Type…");
    fireEvent.change(input, { target: { value: "outside" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const added = (scene.addAnnotation as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(added).toMatchObject({ kind: "text", text: "outside" });
    expect(added.x).toBeCloseTo(1.6);
    expect(added.y).toBeCloseTo(1.3);
  });

  it("a placed label outside the shot can be re-opened for editing", () => {
    const out: Annotation = {
      id: "t9",
      kind: "text",
      x: 1.6,
      y: 1.3,
      text: "Far",
      color: ANNOTATION_COLORS[0].value,
      size: 1,
    };
    const scene = makeScene([out], "t9");
    const { layer } = renderCanvasLayer(scene, makeTools({ tool: "select" }));
    fireEvent.doubleClick(layer, { clientX: 162, clientY: 132 });
    const input = screen.getByDisplayValue("Far");
    fireEvent.change(input, { target: { value: "Farther" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(scene.commitAnnotation).toHaveBeenCalledWith("t9", { text: "Farther" });
  });

  it("a shape can be moved from inside the shot to outside it", () => {
    // Not selected: a selected box's corner handles would take the press (they are within
    // 12 px of its centre at this size) and resize instead of move.
    const scene = makeScene([box], null);
    const { layer } = renderCanvasLayer(scene, makeTools({ tool: "select" }));
    fireEvent.pointerDown(layer, { clientX: 20, clientY: 20 }); // on the box
    fireEvent.pointerMove(layer, { clientX: 220, clientY: 20 });
    fireEvent.pointerUp(layer);
    const [, patch] = (scene.commitAnnotation as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(patch.x).toBeCloseTo(0.1 + 2);
  });

  it("the crop tool's presses outside the frame do not draw anything", () => {
    const scene = makeScene([], null);
    renderCanvasLayer(scene, makeTools({ tool: "crop" }));
    const surface = screen.getByTestId("canvas-hit-surface");
    fireEvent.pointerDown(surface, { clientX: -50, clientY: -40 });
    fireEvent.pointerMove(surface, { clientX: -10, clientY: -5 });
    fireEvent.pointerUp(surface);
    expect(scene.addAnnotation).not.toHaveBeenCalled();
  });
});

describe("AnnotationLayer — step badges", () => {
  // A stateful scene and tool: the layer reads annotations back from it, so numbering is
  // exercised end to end (click -> addAnnotation -> stepNumbers -> rendered text).
  function StepHarness(): React.JSX.Element {
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [tool, setTool] = useState<AnnotationToolsController["tool"]>("step");
    const scene = {
      ...makeScene(annotations, selectedId),
      addAnnotation: (a: Annotation) => setAnnotations((prev) => [...prev, a]),
      select: (id: string | null) => setSelectedId(id),
      removeSelected: () => {
        setAnnotations((prev) => prev.filter((a) => a.id !== selectedId));
        setSelectedId(null);
      },
    };
    return (
      <>
        <span data-testid="tool">{tool}</span>
        <button type="button" onClick={() => setTool("select")}>
          to-select
        </button>
        <AnnotationLayer scene={scene} tools={makeTools({ tool, setTool })} src="" />
      </>
    );
  }

  const numbers = (container: HTMLElement): string[] =>
    Array.from(container.querySelectorAll("g[data-annotation] text")).map(
      (el) => el.textContent ?? "",
    );

  it("numbers clicks 1, 2, 3, keeps the step tool, and renumbers after deleting the middle", () => {
    for (const prop of ["clientWidth", "clientHeight"]) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
    }
    const { container } = render(<StepHarness />);
    const layer = container.querySelector("svg")!.parentElement as HTMLElement;
    layer.setPointerCapture = vi.fn();
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

    // A right-click and a middle-button press (canvas pan) place nothing.
    fireEvent.pointerDown(layer, { clientX: 30, clientY: 30, button: 2 });
    fireEvent.pointerDown(layer, { clientX: 30, clientY: 30, button: 1 });
    expect(numbers(container)).toEqual([]);

    fireEvent.pointerDown(layer, { clientX: 20, clientY: 20 });
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 50 });
    fireEvent.pointerDown(layer, { clientX: 80, clientY: 80 });
    expect(numbers(container)).toEqual(["1", "2", "3"]);
    expect(screen.getByTestId("tool").textContent).toBe("step"); // never auto-switches
    // Placing does not select: the options panel would otherwise repaint the badge just
    // placed when the user picks a colour for the next one. One circle each, no outline.
    for (const g of container.querySelectorAll("g[data-annotation]")) {
      expect(g.querySelectorAll("circle")).toHaveLength(1);
    }

    // Select the middle badge with the select tool, then delete it.
    fireEvent.click(screen.getByText("to-select"));
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 50 });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(numbers(container)).toEqual(["1", "2"]);
    // The survivors are the first and the last badge, now numbered 1 and 2.
    const centers = Array.from(container.querySelectorAll("g[data-annotation] text")).map((el) => [
      el.getAttribute("x"),
      el.textContent,
    ]);
    expect(centers).toEqual([
      ["20", "1"],
      ["80", "2"],
    ]);
  });
});

describe("AnnotationLayer — measure (NIW2-702)", () => {
  // Image 200×200 px shown in a 100×100 layer. The line runs from x=40 to x=80 on row 49,
  // so it spans 20–40 display px horizontally at y = 25.
  const ruler: Annotation = {
    id: "m1",
    kind: "measure",
    axis: "x",
    from: 40,
    to: 80,
    at: 49,
    imageW: 200,
    imageH: 200,
    color: ANNOTATION_COLORS[0].value,
  };

  function renderMeasureLayer(scene: EditorScene) {
    for (const prop of ["clientWidth", "clientHeight"]) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
    }
    const utils = render(<AnnotationLayer scene={scene} tools={makeTools()} src="" />);
    const layer = utils.container.firstChild as HTMLElement;
    layer.setPointerCapture = vi.fn();
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

  it("renders the line with its length label and a readable data-measure-length", () => {
    const { container } = renderMeasureLayer(makeScene([ruler], null));
    const g = container.querySelector('[data-kind="measure"]');
    expect(g?.getAttribute("data-annotation")).toBe("m1");
    expect(g?.getAttribute("data-measure-length")).toBe("40");
    expect(g?.textContent).toBe("40 px");
  });

  it("dragging an end handle commits one patch that changes only that end", () => {
    const scene = makeScene([ruler], "m1");
    const { layer } = renderMeasureLayer(scene);
    expect(screen.getAllByTestId("resize-handle")).toHaveLength(2);
    fireEvent.pointerDown(layer, { clientX: 40, clientY: 25 }); // the "to" end
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 25 });
    fireEvent.pointerMove(layer, { clientX: 60, clientY: 25 });
    fireEvent.pointerUp(layer);
    expect(scene.commitAnnotation).toHaveBeenCalledTimes(1);
    expect(scene.commitAnnotation).toHaveBeenCalledWith("m1", { from: 40, to: 120 });
  });

  it("a press on the label pill, off the line, grabs the measure", () => {
    const scene = makeScene([ruler], null);
    const { layer } = renderMeasureLayer(scene);
    // The line is at y = 25, too close to the top for the pill, so it sits about 19 px below:
    // well past the line's own slop.
    fireEvent.pointerDown(layer, { clientX: 30, clientY: 44 });
    expect(scene.select).toHaveBeenCalledWith("m1");
  });

  it("moving the body keeps the length and shifts from, to and at", () => {
    const scene = makeScene([ruler], null);
    const { layer } = renderMeasureLayer(scene);
    fireEvent.pointerDown(layer, { clientX: 30, clientY: 25 }); // middle of the line
    fireEvent.pointerMove(layer, { clientX: 40, clientY: 35 });
    fireEvent.pointerUp(layer);
    expect(scene.commitAnnotation).toHaveBeenCalledTimes(1);
    expect(scene.commitAnnotation).toHaveBeenCalledWith("m1", { from: 60, to: 100, at: 69 });
  });
});
