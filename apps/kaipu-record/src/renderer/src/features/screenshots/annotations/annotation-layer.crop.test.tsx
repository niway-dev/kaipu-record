import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationLayer } from "./annotation-layer";
import { BASE_IMAGE_ID } from "./image-crop";
import { ANNOTATION_COLORS } from "./tools";
import type { Annotation, ImageAnnotation } from "./scene";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";

// Per-image crop, unit 4: what the layer does to enter crop mode, draw it, and resize the base.
// The layer is 100 x 100 px; the base asset is 200 x 200 source px (2 source px per layer px).

vi.mock("./redaction-preview", () => ({ useRedactionTile: vi.fn(() => null) }));

const tools = (over: Partial<AnnotationToolsController> = {}): AnnotationToolsController => ({
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
  ...over,
});

const sceneOf = (annotations: Annotation[], selectedId: string | null = null): EditorScene =>
  ({
    beautify: { state: {} } as unknown as EditorScene["beautify"],
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
  }) as EditorScene;

// An added image over the lower right of the base: visible rect (0.5, 0.5, 0.4, 0.3).
const image: ImageAnnotation = {
  id: "i1",
  kind: "image",
  assetId: "img-aaaaaaaaaaaa",
  x: 0.5,
  y: 0.5,
  w: 0.4,
  h: 0.3,
  pixelWidth: 80,
  pixelHeight: 60,
};
const URLS = { "img-aaaaaaaaaaaa": "blob:added" };
const NATURAL = { w: 200, h: 200 };

function mount(
  scene: EditorScene,
  props: Partial<React.ComponentProps<typeof AnnotationLayer>> = {},
  toolsOver: Partial<AnnotationToolsController> = {},
) {
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
  }
  const parentDouble = vi.fn();
  const utils = render(
    <div onDoubleClick={parentDouble}>
      <AnnotationLayer
        scene={scene}
        tools={tools(toolsOver)}
        src=""
        canvas
        canvasMode
        imageUrls={URLS}
        natural={NATURAL}
        {...props}
      />
    </div>,
  );
  const layer = utils.container.firstElementChild!.firstElementChild as HTMLElement;
  layer.setPointerCapture = vi.fn();
  layer.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 }) as DOMRect;
  return { ...utils, layer, parentDouble };
}

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

describe("entering crop mode by double-click", () => {
  it("on an added image's pixels it crops that image, and the frame does not hear it", () => {
    const onEnterCrop = vi.fn();
    const { layer, parentDouble } = mount(sceneOf([image]), { onEnterCrop });
    fireEvent.doubleClick(layer, { clientX: 70, clientY: 60 });
    expect(onEnterCrop).toHaveBeenCalledWith("i1");
    expect(parentDouble).not.toHaveBeenCalled();
  });

  it("on the bare base it crops the base, and the frame does not hear it", () => {
    const onEnterCrop = vi.fn();
    const { layer, parentDouble } = mount(sceneOf([image]), { onEnterCrop });
    fireEvent.doubleClick(layer, { clientX: 20, clientY: 20 });
    expect(onEnterCrop).toHaveBeenCalledWith(BASE_IMAGE_ID);
    expect(parentDouble).not.toHaveBeenCalled();
  });

  it("on padding or background it does not, so the Export frame opens as today", () => {
    const onEnterCrop = vi.fn();
    const { layer, parentDouble } = mount(sceneOf([image]), { onEnterCrop });
    fireEvent.doubleClick(layer, { clientX: -30, clientY: 40 });
    expect(onEnterCrop).not.toHaveBeenCalled();
    expect(parentDouble).toHaveBeenCalledTimes(1);
  });

  it("the base counts only where it shows: a cropped-out part is background", () => {
    const onEnterCrop = vi.fn();
    // The right half of the asset shows: the visible base is x 0.5..1.
    const { layer, parentDouble } = mount(sceneOf([]), {
      onEnterCrop,
      base: { baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 } },
    });
    fireEvent.doubleClick(layer, { clientX: 20, clientY: 50 });
    expect(onEnterCrop).not.toHaveBeenCalled();
    expect(parentDouble).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(layer, { clientX: 80, clientY: 50 });
    expect(onEnterCrop).toHaveBeenCalledWith(BASE_IMAGE_ID);
  });

  it("another tool does not crop", () => {
    const onEnterCrop = vi.fn();
    const { layer } = mount(sceneOf([image]), { onEnterCrop }, { tool: "box" });
    fireEvent.doubleClick(layer, { clientX: 70, clientY: 60 });
    expect(onEnterCrop).not.toHaveBeenCalled();
  });

  it("without the handler (Inspect on) the base is not croppable and the frame hears it", () => {
    const { layer, parentDouble } = mount(sceneOf([]));
    fireEvent.doubleClick(layer, { clientX: 20, clientY: 20 });
    expect(parentDouble).toHaveBeenCalledTimes(1);
  });
});

describe("selecting and resizing the base", () => {
  it("a click on the bare base selects it", () => {
    const scene = sceneOf([image]);
    const { layer } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 20, clientY: 20 });
    expect(scene.select).toHaveBeenLastCalledWith(BASE_IMAGE_ID);
  });

  it("a click on padding clears the selection, as before", () => {
    const scene = sceneOf([image], BASE_IMAGE_ID);
    const { layer } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: -30, clientY: 40 });
    expect(scene.select).toHaveBeenLastCalledWith(null);
  });

  it("without the asset's size the base is not selectable", () => {
    const scene = sceneOf([]);
    const { layer } = mount(scene, { natural: undefined });
    fireEvent.pointerDown(layer, { clientX: 20, clientY: 20 });
    expect(scene.select).toHaveBeenLastCalledWith(null);
  });

  it("the selected base wears the image chrome on its visible rect", () => {
    mount(sceneOf([], BASE_IMAGE_ID), { base: { baseCrop: { x: 0, y: 0, w: 0.5, h: 1 } } });
    const frame = screen.getByTestId("image-selection");
    expect(frame.style.width).toBe("50px");
    expect(frame.style.height).toBe("100px");
    expect(screen.getAllByTestId("image-handle")).toHaveLength(8);
  });

  it("dragging a corner resizes proportionally: live while it moves, one commit on release", () => {
    const scene = sceneOf([], BASE_IMAGE_ID);
    const onLiveBase = vi.fn();
    const { layer } = mount(scene, { onLiveBase });
    // The se corner of the whole base is (100, 100): drag it to (50, 50), half size.
    fireEvent.pointerDown(layer, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 50 });
    const live = onLiveBase.mock.calls.at(-1)![0];
    expect(live.basePlacement.scale).toBeCloseTo(0.5);
    expect(scene.commitBase).not.toHaveBeenCalled();
    fireEvent.pointerUp(layer);
    expect(scene.commitBase).toHaveBeenCalledTimes(1);
    const patch = (scene.commitBase as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch.basePlacement.scale).toBeCloseTo(0.5);
    expect(patch.basePlacement.x).toBeCloseTo(0);
    expect(onLiveBase).toHaveBeenLastCalledWith(null);
  });

  it("a press that does not move commits nothing", () => {
    const scene = sceneOf([], BASE_IMAGE_ID);
    const { layer } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(layer);
    expect(scene.commitBase).not.toHaveBeenCalled();
  });

  it("the base is not moved by dragging its middle", () => {
    const scene = sceneOf([], BASE_IMAGE_ID);
    const { layer } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 70, clientY: 60 });
    fireEvent.pointerUp(layer);
    expect(scene.commitBase).not.toHaveBeenCalled();
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
  });

  it("Delete leaves the base alone", () => {
    const scene = sceneOf([], BASE_IMAGE_ID);
    mount(scene);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(scene.removeSelected).not.toHaveBeenCalled();
  });
});

describe("crop mode", () => {
  // The base is being cropped: the window is its middle half of the asset.
  const session = {
    id: BASE_IMAGE_ID,
    full: { x: 0, y: 0, w: 1, h: 1 },
    win: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
  };

  it("dims the asset outside the window and draws the window with eight handles", () => {
    mount(sceneOf([]), { cropping: session });
    expect(screen.getByTestId("crop-scrim")).not.toBeNull();
    const win = screen.getByTestId("crop-window");
    expect(win.getAttribute("x")).toBe("25");
    expect(win.getAttribute("width")).toBe("50");
    expect(screen.getAllByTestId("crop-handle")).toHaveLength(8);
  });

  it("dragging a handle reports the window; releasing does not leave crop mode", () => {
    const onCropWindow = vi.fn();
    const onCropDone = vi.fn();
    const scene = sceneOf([]);
    const { layer } = mount(scene, { cropping: session, onCropWindow, onCropDone });
    // The se corner is at (75, 75): drag it to (90, 80).
    fireEvent.pointerDown(layer, { clientX: 75, clientY: 75 });
    fireEvent.pointerMove(layer, { clientX: 90, clientY: 80 });
    const win = onCropWindow.mock.calls.at(-1)![0];
    expect(win.x).toBeCloseTo(0.25);
    expect(win.w).toBeCloseTo(0.65);
    expect(win.h).toBeCloseTo(0.55);
    fireEvent.pointerUp(layer);
    expect(onCropDone).not.toHaveBeenCalled();
    // Nothing touches the scene: the page commits once, when the crop is finished.
    expect(scene.commitBase).not.toHaveBeenCalled();
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
  });

  it("the window stays inside the asset", () => {
    const onCropWindow = vi.fn();
    const { layer } = mount(sceneOf([]), { cropping: session, onCropWindow });
    fireEvent.pointerDown(layer, { clientX: 75, clientY: 75 });
    fireEvent.pointerMove(layer, { clientX: 500, clientY: 500 });
    const win = onCropWindow.mock.calls.at(-1)![0];
    expect(win.x + win.w).toBeCloseTo(1);
    expect(win.y + win.h).toBeCloseTo(1);
  });

  it("a press away from the window selects and moves nothing", () => {
    const scene = sceneOf([image]);
    const { layer } = mount(scene, { cropping: session });
    fireEvent.pointerDown(layer, { clientX: 70, clientY: 60 });
    fireEvent.pointerMove(layer, { clientX: 80, clientY: 70 });
    fireEvent.pointerUp(layer);
    expect(scene.select).not.toHaveBeenCalled();
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
  });

  it("Done finishes the crop", () => {
    const onCropDone = vi.fn();
    mount(sceneOf([]), { cropping: session, onCropDone });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCropDone).toHaveBeenCalledTimes(1);
  });

  it("an added image is drawn whole while it is cropped, its selection chrome hidden", () => {
    // The image shows its right half (x 0.5..0.7); the whole asset is x 0.3..0.7.
    const cropped: ImageAnnotation = {
      ...image,
      x: 0.5,
      w: 0.2,
      crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    };
    const { container } = mount(sceneOf([cropped], "i1"), {
      cropping: {
        id: "i1",
        full: { x: 0.3, y: 0.5, w: 0.4, h: 0.3 },
        win: { x: 0.5, y: 0.5, w: 0.2, h: 0.3 },
      },
    });
    const clip = container.querySelector("clipPath rect")!;
    expect(clip.getAttribute("x")).toBe("30");
    expect(clip.getAttribute("width")).toBe("40");
    expect(screen.queryByTestId("image-selection")).toBeNull();
  });
});

describe("an added image's own corner radius", () => {
  it("is drawn in display px: 12 source px at 2 source px per layer px is 6", () => {
    const { container } = mount(sceneOf([{ ...image, radius: 12 }]));
    expect(container.querySelector("clipPath rect")?.getAttribute("rx")).toBe("6");
  });
});
