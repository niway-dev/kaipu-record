import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationLayer } from "./annotation-layer";
import { BASE_IMAGE_ID } from "./image-crop";
import { ANNOTATION_COLORS } from "./tools";
import type { Annotation, BlurAnnotation, ImageAnnotation } from "./scene";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";

// NIW2-876, layer 3 (AC9): the base is dragged like a pasted image, alone. The layer is
// 100 x 100 px and shows the whole 200 x 200 source px base unless a test places it.

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
    beautify: { state: { radius: 8 } } as unknown as EditorScene["beautify"],
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
const blur: BlurAnnotation = { id: "b1", kind: "blur", x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
const URLS = { "img-aaaaaaaaaaaa": "blob:added" };

/** `rectPx`: the layer's on-screen size; a canvas zoom of 2 makes it 200 for the same layout. */
function mount(
  scene: EditorScene,
  props: Partial<React.ComponentProps<typeof AnnotationLayer>> = {},
  toolsOver: Partial<AnnotationToolsController> = {},
  rectPx = 100,
) {
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
  }
  const onLiveBase = vi.fn();
  const utils = render(
    <AnnotationLayer
      scene={scene}
      tools={tools(toolsOver)}
      src=""
      canvas
      canvasMode
      imageUrls={URLS}
      natural={{ w: 200, h: 200 }}
      onEnterCrop={vi.fn()}
      onResetCrop={vi.fn()}
      onImageRadius={vi.fn()}
      onLiveBase={onLiveBase}
      {...props}
    />,
  );
  const layer = utils.container.firstElementChild as HTMLElement;
  layer.setPointerCapture = vi.fn();
  layer.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: rectPx,
      height: rectPx,
      right: rectPx,
      bottom: rectPx,
      x: 0,
      y: 0,
    }) as DOMRect;
  return { ...utils, layer, onLiveBase };
}

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

const lastLive = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0];
const committed = (scene: EditorScene) =>
  (scene.commitBase as ReturnType<typeof vi.fn>).mock.calls[0][0];

describe("dragging the base with the select tool (AC9)", () => {
  it("moves it by the drag delta in world units: live while it moves, one commit on release", () => {
    const scene = sceneOf([]);
    const { layer, onLiveBase } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 70, clientY: 60 });
    // 20 px right and 10 px down of a 100 px layer: 0.2 and 0.1 of the base.
    const live = lastLive(onLiveBase).basePlacement;
    expect(live.x).toBeCloseTo(0.2);
    expect(live.y).toBeCloseTo(0.1);
    expect(live.scale).toBe(1);
    expect(scene.commitBase).not.toHaveBeenCalled();
    fireEvent.pointerUp(layer);
    expect(scene.commitBase).toHaveBeenCalledTimes(1);
    expect(Object.keys(committed(scene))).toEqual(["basePlacement"]);
    expect(committed(scene).basePlacement.x).toBeCloseTo(0.2);
    expect(committed(scene).basePlacement.y).toBeCloseTo(0.1);
    expect(onLiveBase).toHaveBeenLastCalledWith(null);
  });

  it("moves it from where it already sits and keeps its scale and crop", () => {
    const scene = sceneOf([]);
    const base = {
      basePlacement: { x: 0.25, y: 0.25, scale: 0.5 },
      baseCrop: { x: 0, y: 0, w: 1, h: 1 },
    };
    const { layer } = mount(scene, { base });
    // The asset covers (25..75) px on both axes.
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 40, clientY: 55 });
    fireEvent.pointerUp(layer);
    const patch = committed(scene);
    expect(patch.basePlacement.x).toBeCloseTo(0.15);
    expect(patch.basePlacement.y).toBeCloseTo(0.3);
    expect(patch.basePlacement.scale).toBe(0.5);
    expect(patch).not.toHaveProperty("baseCrop");
  });

  it("honors the canvas zoom: the same pointer travel is half the world distance at zoom 2", () => {
    const scene = sceneOf([]);
    const { layer } = mount(scene, {}, {}, 200);
    fireEvent.pointerDown(layer, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(layer, { clientX: 140, clientY: 100 });
    fireEvent.pointerUp(layer);
    // 40 screen px of a layer shown 200 px wide is 0.2 of the base, not 0.4.
    expect(committed(scene).basePlacement.x).toBeCloseTo(0.2);
    expect(committed(scene).basePlacement.y).toBeCloseTo(0);
  });

  it("leaves every annotation, and the history of the scene, alone", () => {
    const annotations: Annotation[] = [blur, image];
    const before = JSON.stringify(annotations);
    const scene = sceneOf(annotations);
    const { layer } = mount(scene);
    // (80, 20) is on the base only: the blur ends at 30 px, the image starts at 50 px.
    fireEvent.pointerDown(layer, { clientX: 80, clientY: 20 });
    fireEvent.pointerMove(layer, { clientX: 60, clientY: 30 });
    fireEvent.pointerUp(layer);
    expect(scene.commitBase).toHaveBeenCalledTimes(1);
    expect(scene.commitAnnotation).not.toHaveBeenCalled();
    expect(scene.addAnnotation).not.toHaveBeenCalled();
    expect(JSON.stringify(scene.annotations)).toBe(before);
  });

  it("owns the history for the drag and closes it once, so one undo step undoes it all", () => {
    const scene = sceneOf([]);
    const { layer } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 50 });
    expect(scene.beginInteract).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(layer, { clientX: 60, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 70, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 80, clientY: 50 });
    fireEvent.pointerUp(layer);
    expect(scene.endInteract).toHaveBeenCalledTimes(1);
    // Three moves, one write.
    expect(scene.commitBase).toHaveBeenCalledTimes(1);
    expect(committed(scene).basePlacement.x).toBeCloseTo(0.3);
  });

  it("a press that does not move commits nothing", () => {
    const scene = sceneOf([]);
    const { layer, onLiveBase } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(layer);
    expect(scene.commitBase).not.toHaveBeenCalled();
    // No preview was ever shown.
    expect(onLiveBase.mock.calls.every(([live]) => live === null)).toBe(true);
    expect(scene.select).toHaveBeenLastCalledWith(BASE_IMAGE_ID);
  });

  it("a right-button press on the base selects it but does not drag it", () => {
    const scene = sceneOf([]);
    const { layer, onLiveBase } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 50, button: 2 });
    fireEvent.pointerMove(layer, { clientX: 70, clientY: 50 });
    fireEvent.pointerUp(layer);
    expect(scene.beginInteract).not.toHaveBeenCalled();
    expect(scene.commitBase).not.toHaveBeenCalled();
    expect(onLiveBase.mock.calls.every(([live]) => live === null)).toBe(true);
  });

  it("a move that comes back to where it began commits nothing", () => {
    const scene = sceneOf([]);
    const { layer, onLiveBase } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 70, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(layer);
    expect(scene.commitBase).not.toHaveBeenCalled();
    // The preview is dropped, so a stale live base cannot shadow the stored one.
    expect(onLiveBase).toHaveBeenLastCalledWith(null);
  });

  it("a gesture that ends without a pointer-up still closes the drag with one commit", () => {
    const scene = sceneOf([]);
    const { layer } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 70, clientY: 50 });
    fireEvent.pointerCancel(layer);
    expect(scene.commitBase).toHaveBeenCalledTimes(1);
    expect(scene.endInteract).toHaveBeenCalledTimes(1);
  });

  it("the first press selects the base and starts the drag, like a pasted image", () => {
    const scene = sceneOf([], null);
    const { layer } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 50 });
    expect(scene.select).toHaveBeenLastCalledWith(BASE_IMAGE_ID);
    fireEvent.pointerMove(layer, { clientX: 55, clientY: 50 });
    fireEvent.pointerUp(layer);
    expect(committed(scene).basePlacement.x).toBeCloseTo(0.05);
  });

  it("moves a cropped base by a press on the part that shows, not on the hidden part", () => {
    const scene = sceneOf([]);
    const base = { baseCrop: { x: 0, y: 0, w: 0.5, h: 1 } };
    const { layer } = mount(scene, { base });
    // The right half is cropped out: a press at 80 px is background.
    fireEvent.pointerDown(layer, { clientX: 80, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 90, clientY: 50 });
    fireEvent.pointerUp(layer);
    expect(scene.commitBase).not.toHaveBeenCalled();
    fireEvent.pointerDown(layer, { clientX: 20, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 30, clientY: 50 });
    fireEvent.pointerUp(layer);
    expect(committed(scene).basePlacement.x).toBeCloseTo(0.1);
  });

  it("a press on padding moves nothing", () => {
    const scene = sceneOf([], BASE_IMAGE_ID);
    const { layer } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: -30, clientY: 40 });
    fireEvent.pointerMove(layer, { clientX: -10, clientY: 40 });
    fireEvent.pointerUp(layer);
    expect(scene.commitBase).not.toHaveBeenCalled();
  });

  it("the selected base's corner still resizes instead of moving", () => {
    const scene = sceneOf([], BASE_IMAGE_ID);
    const { layer, onLiveBase } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 50 });
    expect(lastLive(onLiveBase).basePlacement.scale).toBeCloseTo(0.5);
  });

  it("tells the owner it can be dragged: the base's tag reads 'Drag to move'", () => {
    mount(sceneOf([], BASE_IMAGE_ID));
    expect(screen.getByTestId("image-tag").textContent).toContain("Drag to move");
  });
});

describe("what does not move the base", () => {
  const press = (
    toolsOver: Partial<AnnotationToolsController>,
    props: Partial<React.ComponentProps<typeof AnnotationLayer>> = {},
  ) => {
    const scene = sceneOf([]);
    const mounted = mount(scene, props, toolsOver);
    fireEvent.pointerDown(mounted.layer, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(mounted.layer, { clientX: 70, clientY: 60 });
    fireEvent.pointerUp(mounted.layer);
    return { scene, ...mounted };
  };

  for (const tool of [
    "box",
    "arrow",
    "pen",
    "blur",
    "text",
    "step",
    "crop",
    "selectText",
  ] as const) {
    it(`the ${tool} tool does not`, () => {
      const { scene, onLiveBase } = press({ tool });
      expect(scene.commitBase).not.toHaveBeenCalled();
      expect(onLiveBase).not.toHaveBeenCalled();
    });
  }

  it("Inspect does not: the image is read there, not edited (no crop handlers)", () => {
    const { scene, onLiveBase } = press(
      {},
      { onEnterCrop: undefined, onResetCrop: undefined, onImageRadius: undefined },
    );
    expect(scene.commitBase).not.toHaveBeenCalled();
    expect(onLiveBase).not.toHaveBeenCalled();
  });

  it("a crop session does not: the window moves, never the base", () => {
    const scene = sceneOf([]);
    const { layer, onLiveBase } = mount(scene, {
      cropping: {
        id: BASE_IMAGE_ID,
        full: { x: 0, y: 0, w: 1, h: 1 },
        win: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      },
      onCropWindow: vi.fn(),
    });
    // Away from the window's handles, inside the asset.
    fireEvent.pointerDown(layer, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(layer, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(layer);
    expect(scene.commitBase).not.toHaveBeenCalled();
    expect(onLiveBase).not.toHaveBeenCalled();
  });
});

describe("annotations win the press over the base", () => {
  it("a drag that starts on an added image over the base moves the image, not the base", () => {
    const scene = sceneOf([image]);
    const { layer, onLiveBase } = mount(scene);
    // (70, 60) is inside the image, which is itself over the base.
    fireEvent.pointerDown(layer, { clientX: 70, clientY: 60 });
    fireEvent.pointerMove(layer, { clientX: 75, clientY: 65 });
    fireEvent.pointerUp(layer);
    expect(scene.commitAnnotation).toHaveBeenCalledTimes(1);
    expect(scene.commitBase).not.toHaveBeenCalled();
    expect(onLiveBase).not.toHaveBeenCalled();
    expect(scene.select).toHaveBeenLastCalledWith("i1");
  });

  it("a drag that starts on a blur over the base moves the blur, not the base", () => {
    const scene = sceneOf([blur]);
    const { layer } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 20, clientY: 20 });
    fireEvent.pointerMove(layer, { clientX: 25, clientY: 20 });
    fireEvent.pointerUp(layer);
    expect(scene.commitAnnotation).toHaveBeenCalledTimes(1);
    expect(scene.commitBase).not.toHaveBeenCalled();
  });

  it("moving an annotation off the base afterwards leaves the base where it is", () => {
    const scene = sceneOf([image]);
    const { layer } = mount(scene);
    fireEvent.pointerDown(layer, { clientX: 70, clientY: 60 });
    fireEvent.pointerMove(layer, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(layer);
    expect(scene.commitBase).not.toHaveBeenCalled();
  });
});

describe("the live drag stands in for the stored base", () => {
  it("a placed base reads the placement it is given, so the chrome follows the drag", () => {
    const base = { basePlacement: { x: 0.5, y: 0.25, scale: 0.5 } };
    mount(sceneOf([], BASE_IMAGE_ID), { base });
    const frame = screen.getByTestId("image-selection");
    expect(frame.style.left).toBe("50px");
    expect(frame.style.top).toBe("25px");
    expect(frame.style.width).toBe("50px");
  });
});
