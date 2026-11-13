import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { CropOverlay } from "./crop-overlay";
import type { CropRect } from "../annotations/scene";
import type { EditorScene } from "../annotations/use-editor-scene";

function makeScene(crop?: CropRect): EditorScene {
  return {
    beautify: {} as EditorScene["beautify"],
    annotations: [],
    selectedId: null,
    select: vi.fn(),
    addAnnotation: vi.fn(),
    commitAnnotation: vi.fn(),
    beginInteract: vi.fn(),
    endInteract: vi.fn(),
    removeAnnotation: vi.fn(),
    removeSelected: vi.fn(),
    crop,
    setCrop: vi.fn(),
    setExportFrame: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
  };
}

// The overlay measures itself from clientWidth/clientHeight on mount (jsdom: 0×0), and
// maps pointer coords through getBoundingClientRect. Give it a 100×100 box for both.
function renderSizedOverlay(scene: EditorScene, onLeave?: () => void) {
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
  }
  const utils = render(<CropOverlay scene={scene} {...(onLeave ? { onLeave } : {})} />);
  const overlay = utils.container.firstChild as HTMLElement;
  overlay.setPointerCapture = vi.fn();
  overlay.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 }) as DOMRect;
  return { ...utils, overlay };
}

afterEach(() => {
  // @ts-expect-error — drop the stubs renderSizedOverlay put on the prototype
  delete HTMLElement.prototype.clientWidth;
  // @ts-expect-error — see above
  delete HTMLElement.prototype.clientHeight;
});

describe("CropOverlay", () => {
  it("a drag draws a crop and commits it once, on release", () => {
    const scene = makeScene();
    const { overlay } = renderSizedOverlay(scene);
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 20 });
    fireEvent.pointerMove(overlay, { clientX: 40, clientY: 40 });
    fireEvent.pointerMove(overlay, { clientX: 60, clientY: 50 });
    expect(scene.setCrop).not.toHaveBeenCalled();
    fireEvent.pointerUp(overlay);
    expect(scene.setCrop).toHaveBeenCalledTimes(1);
    const rect = (scene.setCrop as ReturnType<typeof vi.fn>).mock.calls[0][0] as CropRect;
    expect(rect.x).toBeCloseTo(0.2, 5);
    expect(rect.y).toBeCloseTo(0.2, 5);
    expect(rect.w).toBeCloseTo(0.4, 5);
    expect(rect.h).toBeCloseTo(0.3, 5);
    expect(scene.beginInteract).not.toHaveBeenCalled();
  });

  it("a click without movement commits nothing", () => {
    const scene = makeScene();
    const { overlay } = renderSizedOverlay(scene);
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(overlay);
    expect(scene.setCrop).not.toHaveBeenCalled();
  });

  it("a drag that ends up covering the whole frame commits no crop", () => {
    const scene = makeScene({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    const { overlay } = renderSizedOverlay(scene);
    // Outside the existing crop, so this draws a fresh rect over the whole frame.
    fireEvent.pointerDown(overlay, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(overlay, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(overlay);
    expect(scene.setCrop).toHaveBeenCalledTimes(1);
    expect(scene.setCrop).toHaveBeenCalledWith(undefined);
  });

  it("the crop rect follows the pointer before any commit", () => {
    const scene = makeScene();
    const { overlay, container } = renderSizedOverlay(scene);
    const outline = (): string | null =>
      container.querySelector("svg rect:nth-of-type(5)")?.getAttribute("width") ?? null;
    const before = outline();
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 20 });
    fireEvent.pointerMove(overlay, { clientX: 60, clientY: 60 });
    expect(outline()).not.toBe(before);
    expect(scene.setCrop).not.toHaveBeenCalled();
  });

  it("Esc leaves the tool and keeps the crop", () => {
    const crop = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    const scene = makeScene(crop);
    const onLeave = vi.fn();
    renderSizedOverlay(scene, onLeave);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(scene.setCrop).not.toHaveBeenCalled();
  });

  it("Esc with no crop set leaves the tool too", () => {
    const scene = makeScene();
    const onLeave = vi.fn();
    renderSizedOverlay(scene, onLeave);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(scene.setCrop).not.toHaveBeenCalled();
  });

  it("Esc during a drag aborts the drag: nothing is committed, the tool is left", () => {
    const scene = makeScene({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    const onLeave = vi.fn();
    const { overlay } = renderSizedOverlay(scene, onLeave);
    fireEvent.pointerDown(overlay, { clientX: 5, clientY: 5 });
    fireEvent.pointerMove(overlay, { clientX: 15, clientY: 15 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(overlay);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(scene.setCrop).not.toHaveBeenCalled();
  });

  it("Enter leaves the tool and keeps the crop", () => {
    const scene = makeScene({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    const onLeave = vi.fn();
    renderSizedOverlay(scene, onLeave);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(scene.setCrop).not.toHaveBeenCalled();
  });

  it("Enter typed in a text field does not leave", () => {
    const scene = makeScene({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    const onLeave = vi.fn();
    renderSizedOverlay(scene, onLeave);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Enter" });
    input.remove();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("Enter on a focused button presses the button and does not leave", () => {
    const scene = makeScene({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    const onLeave = vi.fn();
    renderSizedOverlay(scene, onLeave);
    const button = document.createElement("button");
    document.body.appendChild(button);
    fireEvent.keyDown(button, { key: "Enter" });
    button.remove();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("a click outside an existing crop leaves the tool without changing the crop", () => {
    const scene = makeScene({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    const onLeave = vi.fn();
    const { overlay } = renderSizedOverlay(scene, onLeave);
    fireEvent.pointerDown(overlay, { clientX: 90, clientY: 90 });
    fireEvent.pointerUp(overlay);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(scene.setCrop).not.toHaveBeenCalled();
  });

  it("a click with no crop yet still draws nothing and stays in the tool", () => {
    const scene = makeScene();
    const onLeave = vi.fn();
    const { overlay } = renderSizedOverlay(scene, onLeave);
    fireEvent.pointerDown(overlay, { clientX: 90, clientY: 90 });
    fireEvent.pointerUp(overlay);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("a click inside the crop does not leave", () => {
    const scene = makeScene({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    const onLeave = vi.fn();
    const { overlay } = renderSizedOverlay(scene, onLeave);
    fireEvent.pointerDown(overlay, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(overlay);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("a drag outside an existing crop draws a new one and stays in the tool", () => {
    const scene = makeScene({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 });
    const onLeave = vi.fn();
    const { overlay } = renderSizedOverlay(scene, onLeave);
    fireEvent.pointerDown(overlay, { clientX: 60, clientY: 60 });
    fireEvent.pointerMove(overlay, { clientX: 90, clientY: 90 });
    fireEvent.pointerUp(overlay);
    expect(scene.setCrop).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("ending a drag of a handle or of the frame keeps the tool", () => {
    const scene = makeScene({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    const onLeave = vi.fn();
    const { overlay } = renderSizedOverlay(scene, onLeave);
    // The frame: press inside, move, release.
    fireEvent.pointerDown(overlay, { clientX: 40, clientY: 40 });
    fireEvent.pointerMove(overlay, { clientX: 45, clientY: 45 });
    fireEvent.pointerUp(overlay);
    // A handle: the bottom-right corner is at (70, 70).
    fireEvent.pointerDown(overlay, { clientX: 70, clientY: 70 });
    fireEvent.pointerMove(overlay, { clientX: 80, clientY: 80 });
    fireEvent.pointerUp(overlay);
    expect(scene.setCrop).toHaveBeenCalledTimes(2);
    expect(onLeave).not.toHaveBeenCalled();
  });
});
