import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dirnameOf } from "../../../test/source-tree";
import { AnnotationLayer } from "./annotation-layer";
import { BASE_IMAGE_ID } from "./image-crop";
import { ANNOTATION_COLORS } from "./tools";
import type { Annotation, ImageAnnotation } from "./scene";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";

// NIW2-876, layer 2: the floating action bar over a selected image, and crop mode's own look.
// The layer is 100 x 100 px; the base asset is 200 x 200 source px.

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
const URLS = { "img-aaaaaaaaaaaa": "blob:added" };

const handlers = () => ({
  onEnterCrop: vi.fn(),
  onResetCrop: vi.fn(),
  onImageRadius: vi.fn(),
});

function mount(
  scene: EditorScene,
  props: Partial<React.ComponentProps<typeof AnnotationLayer>> = {},
  toolsOver: Partial<AnnotationToolsController> = {},
) {
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
  }
  const utils = render(
    <AnnotationLayer
      scene={scene}
      tools={tools(toolsOver)}
      src=""
      canvas
      canvasMode
      imageUrls={URLS}
      natural={{ w: 200, h: 200 }}
      {...props}
    />,
  );
  const layer = utils.container.firstElementChild as HTMLElement;
  layer.setPointerCapture = vi.fn();
  layer.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 }) as DOMRect;
  return { ...utils, layer };
}

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  vi.unstubAllGlobals();
});

const bar = () => screen.queryByTestId("image-action-bar");
const inBar = (name: string) =>
  within(screen.getByTestId("image-action-bar")).getByRole("button", { name });

describe("the image action bar (AC7)", () => {
  it("shows over a selected added image with Crop, Corners and Reset", () => {
    mount(sceneOf([image], "i1"), handlers());
    expect(bar()).not.toBeNull();
    inBar("Crop");
    inBar("Corners");
    inBar("Reset");
  });

  it("shows over the selected base too", () => {
    mount(sceneOf([], BASE_IMAGE_ID), handlers());
    expect(bar()).not.toBeNull();
  });

  it("is centred on the image's top edge", () => {
    mount(sceneOf([image], "i1"), handlers());
    const anchor = bar()!.parentElement!;
    // The image spans x 50..90 and starts at y 50: its middle is 70.
    expect(anchor.style.left).toBe("70px");
    expect(anchor.style.top).toBe("50px");
  });

  it("is not there with nothing selected, or a non-image selected", () => {
    const b = mount(sceneOf([image], null), handlers());
    expect(bar()).toBeNull();
    b.unmount();
    mount(
      sceneOf([{ id: "b1", kind: "blur", x: 0, y: 0, w: 0.1, h: 0.1 }, image], "b1"),
      handlers(),
    );
    expect(bar()).toBeNull();
  });

  it("Crop enters the same crop mode as a double-click on the image", () => {
    const h = handlers();
    const { layer } = mount(sceneOf([image], "i1"), h);
    fireEvent.doubleClick(layer, { clientX: 70, clientY: 60 });
    expect(h.onEnterCrop).toHaveBeenLastCalledWith("i1");
    h.onEnterCrop.mockClear();
    fireEvent.click(inBar("Crop"));
    expect(h.onEnterCrop).toHaveBeenCalledTimes(1);
    expect(h.onEnterCrop).toHaveBeenCalledWith("i1");
  });

  it("Crop on the base asks for the base's crop mode", () => {
    const h = handlers();
    mount(sceneOf([], BASE_IMAGE_ID), h);
    fireEvent.click(inBar("Crop"));
    expect(h.onEnterCrop).toHaveBeenCalledWith(BASE_IMAGE_ID);
  });

  it("Reset is disabled with no crop, and removes the crop of an image that has one", () => {
    const none = handlers();
    const first = mount(sceneOf([image], "i1"), none);
    expect(inBar("Reset")).toBeDisabled();
    first.unmount();
    const h = handlers();
    mount(sceneOf([{ ...image, crop: { x: 0, y: 0, w: 0.5, h: 1 } }], "i1"), h);
    expect(inBar("Reset")).toBeEnabled();
    fireEvent.click(inBar("Reset"));
    expect(h.onResetCrop).toHaveBeenCalledTimes(1);
    expect(h.onResetCrop).toHaveBeenCalledWith("i1");
  });

  it("Reset reads the base's crop", () => {
    mount(sceneOf([], BASE_IMAGE_ID), {
      ...handlers(),
      base: { baseCrop: { x: 0, y: 0, w: 0.5, h: 1 } },
    });
    expect(inBar("Reset")).toBeEnabled();
  });

  it("Corners sets the image's own radius in source px", () => {
    const h = handlers();
    mount(sceneOf([image], "i1"), h);
    fireEvent.click(inBar("Corners"));
    const field = screen.getByRole("spinbutton");
    // The slider's 8 layer px on a 100 px layer over a 200 px asset is 16 source px.
    expect((field as HTMLInputElement).value).toBe("16");
    fireEvent.change(field, { target: { value: "20" } });
    fireEvent.blur(field);
    expect(h.onImageRadius).toHaveBeenCalledWith("i1", 20);
  });

  it("a press on the bar does not reach the layer: nothing is deselected or moved", () => {
    const scene = sceneOf([image], "i1");
    mount(scene, handlers());
    fireEvent.pointerDown(inBar("Crop"), { clientX: 70, clientY: 45 });
    expect(scene.select).not.toHaveBeenCalled();
  });

  describe("is hidden", () => {
    it("in crop mode", () => {
      mount(sceneOf([image], "i1"), {
        ...handlers(),
        cropping: {
          id: "i1",
          full: { x: 0.5, y: 0.5, w: 0.4, h: 0.3 },
          win: { x: 0.5, y: 0.5, w: 0.4, h: 0.3 },
        },
      });
      expect(bar()).toBeNull();
    });

    it("in Inspect, which gives the layer no crop handlers", () => {
      mount(sceneOf([image], "i1"));
      expect(bar()).toBeNull();
    });

    it("with another tool, and in select text", () => {
      const a = mount(sceneOf([image], "i1"), handlers(), { tool: "box" });
      expect(bar()).toBeNull();
      a.unmount();
      mount(sceneOf([image], "i1"), handlers(), { tool: "selectText" });
      expect(bar()).toBeNull();
    });

    it("while the image is dragged, and back on release", () => {
      const scene = sceneOf([image], "i1");
      const { layer } = mount(scene, handlers());
      fireEvent.pointerDown(layer, { clientX: 70, clientY: 65 });
      fireEvent.pointerMove(layer, { clientX: 72, clientY: 66 });
      expect(bar()).toBeNull();
      fireEvent.pointerUp(layer);
      expect(bar()).not.toBeNull();
    });

    it("but not by a plain press: the bar stays mounted and an open Corners panel keeps its value", () => {
      const { layer } = mount(sceneOf([image], "i1"), handlers());
      fireEvent.click(inBar("Corners"));
      const field = screen.getByRole("spinbutton") as HTMLInputElement;
      fireEvent.change(field, { target: { value: "12" } });
      const before = bar();
      fireEvent.pointerDown(layer, { clientX: 70, clientY: 65 });
      expect(bar()).toBe(before);
      fireEvent.pointerUp(layer);
      expect(bar()).toBe(before);
      expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("12");
    });

    it("while the base is resized by a corner", () => {
      const { layer } = mount(sceneOf([], BASE_IMAGE_ID), handlers());
      // The se corner of the whole base is (100, 100).
      fireEvent.pointerDown(layer, { clientX: 100, clientY: 100 });
      expect(bar()).toBeNull();
      fireEvent.pointerUp(layer);
      expect(bar()).not.toBeNull();
    });
  });

  describe("placement when the stage may clip it", () => {
    function observed(ratio: number) {
      let callback: IntersectionObserverCallback = () => {};
      const observe = vi.fn();
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(cb: IntersectionObserverCallback) {
            callback = cb;
          }
          observe = observe;
          disconnect = vi.fn();
        },
      );
      return {
        report: (): void =>
          callback([{ intersectionRatio: ratio } as IntersectionObserverEntry], {} as never),
        observe,
      };
    }

    it("sits above the image while its probe is fully on the stage", () => {
      const io = observed(1);
      mount(sceneOf([image], "i1"), handlers());
      expect(io.observe).toHaveBeenCalledTimes(1);
      React.act(() => io.report());
      expect(bar()!.getAttribute("data-placement")).toBe("above");
    });

    it("moves inside the image's top edge when there is no room above", () => {
      const io = observed(0.2);
      mount(sceneOf([image], "i1"), handlers());
      React.act(() => io.report());
      expect(bar()!.getAttribute("data-placement")).toBe("inside");
    });
  });
});

describe("crop mode's look (AC6)", () => {
  const session = {
    id: BASE_IMAGE_ID,
    full: { x: 0, y: 0, w: 1, h: 1 },
    win: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
  };
  const css = (file: string): string =>
    readFileSync(join(dirnameOf(import.meta.url), file), "utf8");

  it("draws four L corners, four edge bars and a thirds grid over the window", () => {
    mount(sceneOf([]), { ...handlers(), cropping: session });
    const chrome = screen.getByTestId("crop-chrome");
    expect(chrome.style.left).toBe("25px");
    expect(chrome.style.width).toBe("50px");
    const handles = within(chrome).getAllByTestId("crop-handle");
    expect(handles).toHaveLength(8);
    expect(handles.filter((h) => h.dataset.kind === "corner")).toHaveLength(4);
    expect(handles.filter((h) => h.dataset.kind === "edge")).toHaveLength(4);
    expect(within(chrome).getAllByTestId("crop-grid-line")).toHaveLength(4);
  });

  it("dims the whole asset behind the window", () => {
    mount(sceneOf([]), { ...handlers(), cropping: session });
    expect(screen.getByTestId("crop-scrim")).not.toBeNull();
  });

  describe("Reset beside Done", () => {
    const cropActions = () => screen.getByTestId("crop-actions");
    const reset = () => within(cropActions()).getByRole("button", { name: "Reset" });

    it("sits next to Done, disabled unless the page says there is a crop to remove", () => {
      mount(sceneOf([]), {
        ...handlers(),
        cropping: { ...session, win: { x: 0, y: 0, w: 1, h: 1 } },
      });
      within(cropActions()).getByRole("button", { name: "Done" });
      expect(reset()).toBeDisabled();
    });

    it("is enabled when the page says so, and asks to reset that image", () => {
      const h = handlers();
      mount(sceneOf([]), { ...h, cropping: session, canResetCrop: true });
      expect(reset()).toBeEnabled();
      fireEvent.click(reset());
      expect(h.onResetCrop).toHaveBeenCalledTimes(1);
      expect(h.onResetCrop).toHaveBeenCalledWith(BASE_IMAGE_ID);
    });

    it("does not start a gesture on the layer", () => {
      const scene = sceneOf([]);
      mount(scene, { ...handlers(), cropping: session });
      fireEvent.pointerDown(reset(), { clientX: 75, clientY: 80 });
      expect(scene.select).not.toHaveBeenCalled();
    });
  });

  it("keeps Done, and no action bar", () => {
    mount(sceneOf([]), { ...handlers(), cropping: session });
    expect(screen.getByRole("button", { name: "Done" })).not.toBeNull();
    expect(bar()).toBeNull();
  });

  it("a selected image keeps the thin accent frame and small handles, not the crop chrome", () => {
    mount(sceneOf([image], "i1"), handlers());
    expect(screen.getByTestId("image-selection")).not.toBeNull();
    expect(screen.getAllByTestId("image-handle")).toHaveLength(8);
    expect(screen.queryByTestId("crop-chrome")).toBeNull();
  });

  it("pins the spec's marks: 4 px brackets 16 px long, 22 x 4 px bars, a 1 px white outline", () => {
    const chrome = css("crop-chrome.module.css");
    expect(chrome).toMatch(/16px \/ var\(--canvas-zoom, 1\)/);
    expect(chrome).toMatch(/22px \/ var\(--canvas-zoom, 1\)/);
    expect(chrome).toMatch(/--thick:\s*calc\(4px \/ var\(--canvas-zoom, 1\)\)/);
    expect(chrome).toMatch(/rgba\(255, 255, 255, 0\.4\)/);
    const layerCss = css("annotation-layer.module.css");
    const outline = layerCss.match(/\.cropWindow\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(outline).toMatch(/stroke:\s*#fff/);
    expect(outline).toMatch(/stroke-width:\s*1;/);
    expect(outline).toMatch(/non-scaling-stroke/);
  });
});
