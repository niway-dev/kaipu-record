import React, { useState } from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationLayer } from "./annotation-layer";
import { ANNOTATION_COLORS } from "./tools";
import { RULER_HALO_PX, RULER_STROKE_PX, RULER_TICK_PX } from "../ruler-line";
import { handlesFor } from "./handles";
import { useRedactionTile } from "./redaction-preview";
import type { Annotation, BlurAnnotation, BoxAnnotation, ImageAnnotation } from "./scene";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";
import type { RecognizedWord } from "@kaipu/domain/schemas";
import type { TextLayerModel } from "../text-selection";

// The tile decode needs fetch and a real canvas; the layer tests only care what it is asked
// for and where the returned tile is drawn.
vi.mock("./redaction-preview", () => ({ useRedactionTile: vi.fn(() => null) }));

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
    redactionStyle: "blur",
    setRedactionStyle: vi.fn(),
    stepSize: 1,
    setStepSize: vi.fn(),
    ...overrides,
  };
}

function makeScene(
  annotations: Annotation[],
  selectedId: string | null,
  beautify: { radius?: number; shadow?: number } = {},
): EditorScene {
  return {
    beautify: { state: beautify } as unknown as EditorScene["beautify"],
    annotations,
    selectedId,
    select: vi.fn(),
    addAnnotation: vi.fn(),
    commitAnnotation: vi.fn(),
    commitBase: vi.fn(),
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

describe("AnnotationLayer — canvas-mode redaction", () => {
  const unlocked: Annotation = { id: "u1", kind: "blur", x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
  const locked: Annotation = { ...unlocked, id: "l1", locked: true };

  it("keeps the gaussian filter with the flag off", () => {
    const { container } = render(
      <AnnotationLayer scene={makeScene([unlocked], null)} tools={makeTools()} src="" />,
    );
    expect(container.querySelector("feGaussianBlur")).not.toBeNull();
  });

  it("draws no gaussian in canvas mode and nothing at all for a locked blur", () => {
    const { container } = render(
      <AnnotationLayer
        scene={makeScene([unlocked, locked], null)}
        tools={makeTools()}
        src=""
        canvasMode
      />,
    );
    expect(container.querySelector("feGaussianBlur")).toBeNull();
    expect(container.querySelector('[data-annotation="u1"]')).not.toBeNull();
    expect(container.querySelector('[data-annotation="l1"]')).toBeNull();
  });

  it("does not delete a locked blur on Backspace in canvas mode", () => {
    const scene = makeScene([locked], "l1");
    render(<AnnotationLayer scene={scene} tools={makeTools()} src="" canvasMode />);
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(scene.removeSelected).not.toHaveBeenCalled();
  });
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

describe("AnnotationLayer — added images (NIW2-703)", () => {
  const image: ImageAnnotation = {
    id: "i1",
    kind: "image",
    assetId: "img-aaaaaaaaaaaa",
    x: 0.5,
    y: 0.25,
    w: 0.4,
    h: 0.3,
    pixelWidth: 40,
    pixelHeight: 30,
  };
  const urls = { "img-aaaaaaaaaaaa": "blob:added" };

  function renderImageLayer(
    scene: EditorScene,
    tools: AnnotationToolsController,
    props: Partial<React.ComponentProps<typeof AnnotationLayer>> = {},
  ) {
    for (const prop of ["clientWidth", "clientHeight"]) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
    }
    const utils = render(
      <AnnotationLayer scene={scene} tools={tools} src="" canvas imageUrls={urls} {...props} />,
    );
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

  const imageEl = (c: HTMLElement): Element | null =>
    c.querySelector('[data-testid="canvas-image"]');

  it("draws the asset at its normalized rect, in display px", () => {
    const { container } = renderImageLayer(makeScene([image], null), makeTools());
    const el = imageEl(container)!;
    expect(el.getAttribute("href")).toBe("blob:added");
    expect(el.getAttribute("x")).toBe("50");
    expect(el.getAttribute("y")).toBe("25");
    expect(el.getAttribute("width")).toBe("40");
    expect(el.getAttribute("height")).toBe("30");
    expect(el.getAttribute("preserveAspectRatio")).toBe("none");
    expect(container.querySelector('[data-annotation="i1"]')).not.toBeNull();
  });

  it("draws a cropped image whole from the full rect and clips to the visible rect", () => {
    // Illustrative: the visible rect is the right half of the asset, so the whole asset is
    // twice as wide and starts left of the visible rect: x 0.5 - 0.5 * 0.4 = 0.3.
    const cropped: ImageAnnotation = {
      ...image,
      x: 0.5,
      y: 0.25,
      w: 0.2,
      h: 0.3,
      crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    };
    const { container } = renderImageLayer(makeScene([cropped], null), makeTools());
    const el = imageEl(container)!;
    expect(el.getAttribute("x")).toBe("30");
    expect(el.getAttribute("y")).toBe("25");
    expect(el.getAttribute("width")).toBe("40");
    expect(el.getAttribute("height")).toBe("30");
    const clip = container.querySelector("clipPath rect")!;
    expect(clip.getAttribute("x")).toBe("50");
    expect(clip.getAttribute("width")).toBe("20");
    expect(clip.getAttribute("height")).toBe("30");
  });

  it("draws nothing when the editor has no URL for the asset", () => {
    const { container } = renderImageLayer(makeScene([image], "i1"), makeTools(), {
      imageUrls: {},
    });
    expect(imageEl(container)).toBeNull();
    expect(container.querySelector('[data-annotation="i1"]')).toBeNull();
  });

  it("clips to the beautify radius and drops the beautify shadow behind it", () => {
    const { container } = renderImageLayer(
      makeScene([image], null, { radius: 12, shadow: 40 }),
      makeTools(),
    );
    expect(container.querySelector("clipPath rect")?.getAttribute("rx")).toBe("12");
    const drop = container.querySelector("feDropShadow")!;
    expect(drop.getAttribute("dy")).toBe("18"); // round(40 * 0.45), as the base's box-shadow
    expect(drop.getAttribute("stdDeviation")).toBe("22"); // round(40 * 0.9 + 8) / 2
    expect(drop.getAttribute("flood-opacity")).toBe("0.32");
  });

  it("draws no shadow when the beautify shadow is 0", () => {
    const { container } = renderImageLayer(makeScene([image], null), makeTools());
    expect(container.querySelector("feDropShadow")).toBeNull();
  });

  it("outlines it when selected, without resize handles", () => {
    const { container } = renderImageLayer(makeScene([image], "i1"), makeTools());
    expect(container.querySelector("rect[class*='selOutline']")).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="resize-handle"]')).toHaveLength(0);
  });

  it("a click on it selects it, and a drag commits a moved x/y", () => {
    const scene = makeScene([image], null);
    const { layer } = renderImageLayer(scene, makeTools({ tool: "select" }));
    fireEvent.pointerDown(layer, { clientX: 70, clientY: 40 });
    expect(scene.select).toHaveBeenCalledWith("i1");
    fireEvent.pointerMove(layer, { clientX: 80, clientY: 60 });
    fireEvent.pointerUp(layer);
    expect(scene.commitAnnotation).toHaveBeenCalledTimes(1);
    const [id, patch] = (scene.commitAnnotation as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe("i1");
    expect(patch.x).toBeCloseTo(0.6);
    expect(patch.y).toBeCloseTo(0.45);
    expect(patch.w).toBeUndefined(); // it moves, it does not resize
  });

  it("dragging a corner resizes it with its ratio kept, in one commit", () => {
    const scene = makeScene([image], "i1");
    const { layer } = renderImageLayer(scene, makeTools({ tool: "select" }));
    // The se corner is at (90, 55) of the 100 x 100 layer.
    fireEvent.pointerDown(layer, { clientX: 90, clientY: 55 });
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 60 });
    fireEvent.pointerUp(layer);
    expect(scene.commitAnnotation).toHaveBeenCalledTimes(1);
    const [id, patch] = (scene.commitAnnotation as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe("i1");
    expect(patch.x).toBeCloseTo(0.5); // the nw corner stayed
    expect(patch.y).toBeCloseTo(0.25);
    expect(patch.w).toBeCloseTo(0.5);
    expect(patch.h).toBeCloseTo(0.375);
    expect(patch.w / patch.h).toBeCloseTo(40 / 30);
  });

  it("an edge handle still drags the image instead of resizing it", () => {
    const scene = makeScene([image], "i1");
    const { layer } = renderImageLayer(scene, makeTools({ tool: "select" }));
    fireEvent.pointerDown(layer, { clientX: 90, clientY: 40 }); // the e handle, inside the image
    fireEvent.pointerMove(layer, { clientX: 95, clientY: 40 });
    fireEvent.pointerUp(layer);
    const [, patch] = (scene.commitAnnotation as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(patch.w).toBeUndefined();
    expect(patch.x).toBeCloseTo(0.55);
  });

  it("moves in the DOM before the commit", () => {
    const scene = makeScene([image], null);
    const { layer, container } = renderImageLayer(scene, makeTools({ tool: "select" }));
    fireEvent.pointerDown(layer, { clientX: 70, clientY: 40 });
    fireEvent.pointerMove(layer, { clientX: 80, clientY: 40 });
    expect(Number(imageEl(container)!.getAttribute("x"))).toBeCloseTo(60);
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
  });

  it("the whole rect is hittable, and the later item in z-order takes the click", () => {
    const over: BoxAnnotation = { ...box, id: "b2", x: 0.55, y: 0.3, w: 0.2, h: 0.2 };
    const scene = makeScene([image, over], null);
    const { layer } = renderImageLayer(scene, makeTools({ tool: "select" }));
    fireEvent.pointerDown(layer, { clientX: 89, clientY: 54 }); // far corner, image only
    expect(scene.select).toHaveBeenLastCalledWith("i1");
    fireEvent.pointerUp(layer);
    fireEvent.pointerDown(layer, { clientX: 65, clientY: 40 }); // inside the box above it
    expect(scene.select).toHaveBeenLastCalledWith("b2");
  });

  it("Delete removes the selected image", () => {
    const scene = makeScene([image], "i1");
    renderImageLayer(scene, makeTools());
    fireEvent.keyDown(window, { key: "Delete" });
    expect(scene.removeSelected).toHaveBeenCalledTimes(1);
  });

  it("the box tool still draws over an image", () => {
    const scene = makeScene([image], null);
    const { layer } = renderImageLayer(scene, makeTools({ tool: "box" }));
    fireEvent.pointerDown(layer, { clientX: 60, clientY: 30 });
    fireEvent.pointerMove(layer, { clientX: 80, clientY: 50 });
    fireEvent.pointerUp(layer);
    expect(scene.addAnnotation).toHaveBeenCalledTimes(1);
    expect(scene.select).not.toHaveBeenCalledWith("i1");
  });

  describe("redaction over an added image", () => {
    const blur: BlurAnnotation = { id: "u1", kind: "blur", x: 0.6, y: 0.3, w: 0.2, h: 0.15 };
    const tileMock = useRedactionTile as unknown as ReturnType<typeof vi.fn>;

    afterEach(() => tileMock.mockReset().mockImplementation(() => null));

    it("draws a tile computed from the image's URL in its local coordinates", () => {
      tileMock.mockImplementation((url: string) =>
        url === "blob:added"
          ? { url: "data:tile", rect: { x: 5, y: 6, w: 20, h: 15 }, naturalW: 40, naturalH: 30 }
          : null,
      );
      const { container } = renderImageLayer(makeScene([image, blur], null), makeTools(), {
        canvasMode: true,
      });
      const call = tileMock.mock.calls.find((c) => c[0] === "blob:added")!;
      expect(call[1].x).toBeCloseTo((0.6 - 0.5) / 0.4);
      expect(call[1].y).toBeCloseTo((0.3 - 0.25) / 0.3);
      expect(call[1].w).toBeCloseTo(0.2 / 0.4);
      expect(call[1].h).toBeCloseTo(0.15 / 0.3);
      expect(call[2]).toBe("blur");
      expect(call[3]).toBe(true);
      const tile = container.querySelector('[data-testid="image-redaction-tile"]')!;
      expect(tile.getAttribute("href")).toBe("data:tile");
      // The tile's px inside the image, scaled to the image's 40×30 display rect.
      expect(tile.getAttribute("x")).toBe("55");
      expect(tile.getAttribute("y")).toBe("31");
      expect(tile.getAttribute("width")).toBe("20");
      expect(tile.getAttribute("height")).toBe("15");
      // Inside the image's clip, so it follows the rounded corners.
      expect(tile.parentElement?.getAttribute("clip-path")).toMatch(/^url\(#iclip-i1\)$/);
    });

    const baseTileOnly = (url: string) =>
      url === "blob:base"
        ? {
            url: "data:base-tile",
            rect: { x: 0, y: 0, w: 10, h: 10 },
            naturalW: 100,
            naturalH: 100,
          }
        : null;
    const follows = (a: Element, b: Element): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

    // The layer is 100 x 100 px for the base asset at scale 1 (illustrative numbers).
    const baseBlur: BlurAnnotation = { id: "u2", kind: "blur", x: 1.2, y: 0.2, w: 0.1, h: 0.1 };
    const baseTile = {
      url: "data:base-tile",
      rect: { x: 240, y: 40, w: 40, h: 40 },
      naturalW: 400,
      naturalH: 400,
    };

    it("on a base enlarged to scale 2, the tile samples the asset the way the export bakes it", () => {
      tileMock.mockImplementation((url: string) => (url === "blob:base" ? baseTile : null));
      const { container } = renderImageLayer(makeScene([baseBlur], null), makeTools(), {
        canvasMode: true,
        src: "blob:base",
        base: { basePlacement: { x: 0, y: 0, scale: 2 } },
      });
      // World 1.2 of a base 2 wide starts 60% in: source px 240 of 400, as `baseFullRect` maps it.
      const call = tileMock.mock.calls.find((c) => c[0] === "blob:base")!;
      expect(call[1].x).toBeCloseTo(0.6);
      expect(call[1].y).toBeCloseTo(0.1);
      expect(call[1].w).toBeCloseTo(0.05);
      expect(call[1].h).toBeCloseTo(0.05);
      // And it is drawn where the asset is: 240/400 of the 200 px wide enlarged base.
      const tile = container.querySelector('[data-testid="redaction-tile"]')!;
      expect(tile.getAttribute("x")).toBe("120");
      expect(tile.getAttribute("y")).toBe("20");
      expect(tile.getAttribute("width")).toBe("20");
      expect(tile.getAttribute("height")).toBe("20");
    });

    it("on a cropped base the tile is still sampled against the whole asset, clipped to the window", () => {
      tileMock.mockImplementation((url: string) => (url === "blob:base" ? baseTile : null));
      const blurInCrop: BlurAnnotation = { ...baseBlur, x: 0.6, y: 0.1 };
      const { container } = renderImageLayer(makeScene([blurInCrop], null), makeTools(), {
        canvasMode: true,
        src: "blob:base",
        base: { baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 } },
      });
      const call = tileMock.mock.calls.find((c) => c[0] === "blob:base")!;
      expect(call[1].x).toBeCloseTo(0.6); // the asset's own units, not the window's
      const tile = container.querySelector('[data-testid="redaction-tile"]')!;
      expect(tile.parentElement?.getAttribute("clip-path")).toMatch(/^url\(#base-clip-/);
    });

    it("a locked blur on a cropped base is clipped to the window like the unlocked tile", () => {
      // The right half shows (world x 0.5..1); the blur reaches into the hidden left half.
      const lockedBlur: BlurAnnotation = { ...baseBlur, x: 0.4, y: 0.1, locked: true };
      const { container } = renderImageLayer(makeScene([lockedBlur], null), makeTools(), {
        canvasMode: true,
        src: "blob:base",
        base: { baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 } },
      });
      const el = container.querySelector('[data-testid="locked-redaction"]')!;
      const outer = el.querySelector('[clip-path^="url(#base-clip-"]')!;
      expect(outer).not.toBeNull();
      const rect = outer.querySelector("clipPath rect")!;
      expect(rect.getAttribute("x")).toBe("50");
      expect(rect.getAttribute("width")).toBe("50");
    });

    it("a blur below an image draws the base's tile under the image", () => {
      tileMock.mockImplementation(baseTileOnly);
      const { container } = renderImageLayer(makeScene([blur, image], null), makeTools(), {
        canvasMode: true,
        src: "blob:base",
      });
      const baseTile = container.querySelector('[data-testid="redaction-tile"]')!;
      const added = container.querySelector('image[href="blob:added"]')!;
      expect(follows(baseTile, added)).toBe(true);
      // Nothing of the image is redrawn over it: the image is above the blur.
      expect(container.querySelector('[data-testid="redaction-over-images"]')).toBeNull();
    });

    it("a blur above an image redraws that image's redacted pixels over the base's tile", () => {
      tileMock.mockImplementation(
        (url: string) =>
          baseTileOnly(url) ??
          (url === "blob:added"
            ? {
                url: "data:image-tile",
                rect: { x: 0, y: 0, w: 4, h: 3 },
                naturalW: 40,
                naturalH: 30,
              }
            : null),
      );
      // As the export: at the blur's z-position the baked base, then the baked image below it.
      const { container } = renderImageLayer(makeScene([image, blur], null), makeTools(), {
        canvasMode: true,
        src: "blob:base",
      });
      const added = container.querySelector('image[href="blob:added"]')!;
      const baseTile = container.querySelector('[data-testid="redaction-tile"]')!;
      const over = container.querySelector('[data-testid="redaction-over-images"]')!;
      expect(follows(added, baseTile)).toBe(true);
      expect(follows(baseTile, over)).toBe(true);
      // The image's redaction is redrawn, inside the blur, through the image's own rounded clip.
      const redrawn = over.querySelector('[data-testid="image-redaction-tile"]')!;
      expect(redrawn.getAttribute("href")).toBe("data:image-tile");
      expect(redrawn.closest(`[clip-path="url(#iclip-${image.id})"]`)).not.toBeNull();
    });

    it("a locked blur above an image redraws the image's own (already baked) pixels", () => {
      const { container } = renderImageLayer(
        makeScene([image, { ...blur, locked: true }], null),
        makeTools(),
        { canvasMode: true, src: "blob:base" },
      );
      const over = container.querySelector('[data-testid="redaction-over-images"]')!;
      const redrawn = over.querySelector('image[href="blob:added"]')!;
      expect(redrawn).not.toBeNull();
      // Through the image's own rounded clip, so a corner the image cuts off stays cut off.
      const clipped = redrawn.closest(`[clip-path="url(#iclip-${image.id})"]`);
      expect(clipped).not.toBeNull();
      expect(over.contains(clipped)).toBe(true);
      expect(container.querySelector(`clipPath#iclip-${image.id}`)).not.toBeNull();
    });

    it("passes the solid style through", () => {
      renderImageLayer(makeScene([image, { ...blur, style: "solid" }], null), makeTools(), {
        canvasMode: true,
      });
      expect(tileMock.mock.calls.some((c) => c[0] === "blob:added" && c[2] === "solid")).toBe(true);
    });

    it("skips a locked blur, a blur that misses the image, and the flag-off layer", () => {
      const miss: BlurAnnotation = { ...blur, id: "u2", x: 0, y: 0, w: 0.2, h: 0.2 };
      renderImageLayer(makeScene([image, { ...blur, locked: true }, miss], null), makeTools(), {
        canvasMode: true,
      });
      expect(tileMock.mock.calls.some((c) => c[0] === "blob:added")).toBe(false);
      tileMock.mockClear();
      renderImageLayer(makeScene([image, blur], null), makeTools());
      expect(tileMock.mock.calls.some((c) => c[0] === "blob:added")).toBe(false);
    });
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

  it("an unselected measure has no end dots and a borderless pill, but still a halo", () => {
    const { container } = renderMeasureLayer(makeScene([ruler], null));
    const g = container.querySelector('[data-kind="measure"]');
    expect(g?.hasAttribute("data-selected")).toBe(false);
    expect(screen.queryAllByTestId("resize-handle")).toHaveLength(0);
    expect(g?.querySelector("rect")?.getAttribute("stroke")).toBeNull();
    expect(g?.querySelector("[data-measure-halo]")).not.toBeNull();
    // The same line as Inspect's hover: its stroke, its soft outline, butt caps (no round ends).
    const line = g?.querySelector(`g[stroke="${ruler.color}"]`);
    expect(line?.getAttribute("stroke-width")).toBe(String(RULER_STROKE_PX));
    expect(line?.getAttribute("stroke-linecap")).toBeNull();
    expect(g?.querySelector("[data-measure-halo]")?.getAttribute("stroke-width")).toBe(
      String(RULER_HALO_PX),
    );
  });

  it("the end caps are Inspect's ticks: RULER_TICK_PX each side of the line, at both ends", () => {
    const { container } = renderMeasureLayer(makeScene([ruler], null));
    const lines = container.querySelectorAll(`g[stroke="${ruler.color}"] line`);
    // The line plus one cap per end.
    expect(lines).toHaveLength(3);
    for (const cap of [lines[1], lines[2]]) {
      // A horizontal measure: the caps are vertical, 2 * RULER_TICK_PX long.
      expect(cap.getAttribute("x1")).toBe(cap.getAttribute("x2"));
      const len = Math.abs(Number(cap.getAttribute("y2")) - Number(cap.getAttribute("y1")));
      expect(len).toBe(RULER_TICK_PX * 2);
    }
  });

  it("a selected measure keeps an invisible 12 px grab target at each end and a bordered pill", () => {
    const { container } = renderMeasureLayer(makeScene([ruler], "m1"));
    const g = container.querySelector('[data-kind="measure"]');
    expect(g?.getAttribute("data-selected")).toBe("true");
    const hits = screen.getAllByTestId("resize-handle");
    expect(hits).toHaveLength(2);
    for (const hit of hits) {
      expect(hit.tagName.toLowerCase()).toBe("rect");
      expect(Number(hit.getAttribute("width"))).toBeGreaterThanOrEqual(12);
      expect(Number(hit.getAttribute("height"))).toBeGreaterThanOrEqual(12);
      // Invisible: the visible end is the ruler cap drawn by the line, not a second shape.
      expect(hit.getAttribute("stroke")).toBeNull();
    }
    expect(g?.querySelector("circle")).toBeNull();
    expect(g?.querySelector("rect")?.getAttribute("stroke")).not.toBeNull();
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

describe("AnnotationLayer — Select text tool", () => {
  const w = (text: string, x: number, y: number): RecognizedWord => ({
    text,
    line: 0,
    rect: { x, y, w: 80, h: 20 },
    confidence: 1,
  });
  // A 400×400 image shown at 100×100: every display box is a quarter of the pixel box.
  const A = w("a", 40, 40); // display 10-30 x 10-15
  const B = w("b", 200, 40); // display 50-70 x 10-15
  const NATURAL = { w: 400, h: 400 };

  function renderText(
    selected: RecognizedWord[] = [],
    tool: AnnotationToolsController["tool"] = "selectText",
  ) {
    for (const prop of ["clientWidth", "clientHeight"]) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
    }
    const select = vi.fn();
    const clear = vi.fn();
    const scene = makeScene([box], null);
    const model: TextLayerModel = {
      words: [A, B],
      natural: NATURAL,
      selected: new Set(selected),
      select,
      clear,
    };
    const utils = render(
      <AnnotationLayer scene={scene} tools={makeTools({ tool })} src="" text={model} />,
    );
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
    return { ...utils, layer, select, clear, scene };
  }

  it("draws a translucent box over each selected word, at its place in the image", () => {
    const { container } = renderText([B]);
    const rects = container.querySelectorAll('[data-testid="text-highlight"]');
    expect(rects).toHaveLength(1);
    expect(rects[0].getAttribute("x")).toBe("50");
    expect(rects[0].getAttribute("width")).toBe("20");
  });

  it("marks the layer as the text selection area only while the tool is active", () => {
    const on = renderText();
    expect(on.layer).toHaveAttribute("data-ui-area", "editorImage.textSelection");
    on.unmount();
    const off = renderText([A], "select");
    expect(off.layer).not.toHaveAttribute("data-ui-area");
    expect(off.container.querySelector('[data-testid="text-highlight"]')).toBeNull();
  });

  it("a press on a word selects it, a drag extends to the nearest word", () => {
    const { layer, select } = renderText();
    fireEvent.pointerDown(layer, { clientX: 20, clientY: 12, pointerId: 1 });
    expect(select).toHaveBeenLastCalledWith(A, A);
    // Past the end of the line, nowhere near any word: the nearest one still ends the range.
    fireEvent.pointerMove(layer, { clientX: 95, clientY: 90, pointerId: 1 });
    expect(select).toHaveBeenLastCalledWith(A, B);
    fireEvent.pointerUp(layer, { pointerId: 1 });
  });

  it("a press on a highlight captures the pointer on the layer, not on the highlight", () => {
    const { container, layer } = renderText([B]);
    const highlight = container.querySelector('[data-testid="text-highlight"]') as SVGElement;
    highlight.setPointerCapture = vi.fn();
    fireEvent.pointerDown(highlight, { clientX: 60, clientY: 12, pointerId: 1 });
    expect(layer.setPointerCapture).toHaveBeenCalledWith(1);
    expect(highlight.setPointerCapture).not.toHaveBeenCalled();
  });

  it("a press far from every word clears and starts no drag", () => {
    const { layer, select, clear } = renderText([A]);
    fireEvent.pointerDown(layer, { clientX: 20, clientY: 80, pointerId: 1 });
    expect(clear).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(layer, { clientX: 60, clientY: 12, pointerId: 1 });
    expect(select).not.toHaveBeenCalled();
  });

  it("shows the text cursor over a word and the default one elsewhere", () => {
    const { layer } = renderText();
    fireEvent.pointerMove(layer, { clientX: 20, clientY: 12, pointerId: 1 });
    expect(layer.style.cursor).toBe("text");
    fireEvent.pointerMove(layer, { clientX: 20, clientY: 80, pointerId: 1 });
    expect(layer.style.cursor).toBe("default");
  });

  it("does not grab shapes while the tool is active", () => {
    const { layer, scene } = renderText();
    fireEvent.pointerDown(layer, { clientX: 20, clientY: 20, pointerId: 1 }); // on the box
    expect(scene.select).not.toHaveBeenCalled();
  });

  it("with the select tool the words take no input", () => {
    const { layer, select, clear } = renderText([], "select");
    fireEvent.pointerDown(layer, { clientX: 20, clientY: 12, pointerId: 1 });
    expect(select).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});

describe("AnnotationLayer — step badge ring (NIW2-713)", () => {
  const badge = (color: string): Annotation => ({
    id: "s1",
    kind: "step",
    x: 0.5,
    y: 0.5,
    color,
    size: 1,
  });

  it("rings a light fill in white and keeps the number dark", () => {
    const { container } = render(
      <AnnotationLayer scene={makeScene([badge("#f5f5f5")], null)} tools={makeTools()} src="" />,
    );
    const circle = container.querySelector("g[data-annotation] circle")!;
    expect(circle.getAttribute("stroke")).toBe("#ffffff");
    expect(container.querySelector("g[data-annotation] text")!.getAttribute("fill")).toBe(
      "#1a1a1a",
    );
    expect(circle.getAttribute("filter")).toMatch(/^url\(#stepf/);
  });

  it("draws an accent ring only while the badge is selected", () => {
    const rings = (selectedId: string | null): number =>
      render(
        <AnnotationLayer
          scene={makeScene([badge("#f6055c")], selectedId)}
          tools={makeTools()}
          src=""
        />,
      ).container.querySelectorAll("g[data-annotation] circle[data-step-selected]").length;
    expect(rings(null)).toBe(0);
    expect(rings("s1")).toBe(1);
  });
});
