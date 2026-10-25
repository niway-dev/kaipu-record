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
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
  };
}

// The overlay measures itself from clientWidth/clientHeight on mount (jsdom: 0×0), and
// maps pointer coords through getBoundingClientRect. Give it a 100×100 box for both.
function renderSizedOverlay(scene: EditorScene) {
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
  }
  const utils = render(<CropOverlay scene={scene} />);
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
});
