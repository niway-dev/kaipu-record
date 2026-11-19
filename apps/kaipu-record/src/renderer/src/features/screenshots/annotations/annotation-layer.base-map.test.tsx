import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecognizedWord } from "@kaipu/domain/schemas";
import { AnnotationLayer } from "./annotation-layer";
import { BASE_IMAGE_ID } from "./image-crop";
import { ANNOTATION_COLORS } from "./tools";
import type { Annotation, ImageAnnotation } from "./scene";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";
import type { TextLayerModel } from "../text-selection";

// The base's crop and placement reach every mapping the layer does from the asset's pixels
// (NIW2-876): the redact tool's one-click hide, the gap guides and the selection tag.
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

function makeScene(annotations: Annotation[], selectedId: string | null): EditorScene {
  return {
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
  };
}

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

/** A 100 px layer: one world unit is 100 display px; the base asset is 400 x 400 source px. */
const NATURAL = { w: 400, h: 400 };
function renderLayer(
  scene: EditorScene,
  tools: AnnotationToolsController,
  props: Partial<React.ComponentProps<typeof AnnotationLayer>> = {},
) {
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
  }
  const utils = render(
    <AnnotationLayer
      scene={scene}
      tools={tools}
      src=""
      canvas
      canvasMode
      natural={NATURAL}
      imageUrls={{ a: "blob:a" }}
      {...props}
    />,
  );
  const layer = utils.container.firstChild as HTMLElement;
  layer.setPointerCapture = vi.fn();
  layer.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 }) as DOMRect;
  return { ...utils, layer };
}

const word = (text: string, line: number, x: number, y: number): RecognizedWord => ({
  text,
  line,
  rect: { x, y, w: 80, h: 20 },
  confidence: 1,
});

describe("one-click hide on a base that was resized or moved (NIW2-876, AC3)", () => {
  // The 400 x 400 asset at half size with its corner at world (0.5, 0.25): it covers display
  // x 50..100, y 25..75. The word at asset (40, 40) 80 x 20 therefore shows at display
  // x 55..65, y 30..32.5.
  const basePlacement = { x: 0.5, y: 0.25, scale: 0.5 };
  const model = (over: Partial<TextLayerModel> = {}): TextLayerModel => ({
    words: [word("secret", 0, 40, 40)],
    natural: NATURAL,
    basePlacement,
    selected: new Set(),
    select: vi.fn(),
    clear: vi.fn(),
    ...over,
  });

  it("hides the line under the pointer: the redaction is the line's box mapped through the placed base", () => {
    const scene = makeScene([], null);
    const { layer } = renderLayer(scene, makeTools({ tool: "blur" }), {
      text: model(),
      base: { basePlacement },
    });
    fireEvent.pointerDown(layer, { clientX: 60, clientY: 31, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 60, clientY: 31, pointerId: 1 });
    expect(scene.addAnnotation).toHaveBeenCalledTimes(1);
    const added = (scene.addAnnotation as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The line grown by its 5 px margin is asset (35, 35) 90 x 30; half scale, corner (0.5, 0.25).
    expect(added.kind).toBe("blur");
    expect(added.x).toBeCloseTo(0.5 + (35 / 400) * 0.5, 4);
    expect(added.y).toBeCloseTo(0.25 + (35 / 400) * 0.5, 4);
    expect(added.w).toBeCloseTo((90 / 400) * 0.5, 4);
    expect(added.h).toBeCloseTo((30 / 400) * 0.5, 4);
  });

  it("keeps a cropped-out word in the margin collision check without making it a target", () => {
    // A word just above the crop is not offered (not in `words`), but the margin still stops
    // short of it: the saved redaction bakes the whole asset, so its pixels must stay.
    const secret = word("secret", 0, 40, 40);
    const cropped = word("above", 1, 40, 16);
    const scene = makeScene([], null);
    const { layer } = renderLayer(scene, makeTools({ tool: "blur" }), {
      text: model({ words: [secret], marginWords: [secret, cropped] }),
      base: { basePlacement },
    });
    fireEvent.pointerDown(layer, { clientX: 60, clientY: 31, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 60, clientY: 31, pointerId: 1 });
    const added = (scene.addAnnotation as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The full 5 px margin would reach y 35 and cover the word's last rows (it ends at y 36);
    // the half margin of 2 px does not: asset (38, 38) 84 x 24.
    expect(added.y).toBeCloseTo(0.25 + (38 / 400) * 0.5, 4);
    expect(added.h).toBeCloseTo((24 / 400) * 0.5, 4);
  });

  it("does not take a press where the unmoved base had the word for a hit", () => {
    const scene = makeScene([], null);
    const { layer } = renderLayer(scene, makeTools({ tool: "blur" }), {
      text: model(),
      base: { basePlacement },
    });
    // Display (15, 11) is where the word sits on an UNMOVED base; the base is elsewhere now.
    fireEvent.pointerDown(layer, { clientX: 15, clientY: 11, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 15, clientY: 11, pointerId: 1 });
    const blurs = (scene.addAnnotation as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([a]) => (a as Annotation).kind === "blur",
    );
    expect(blurs).toHaveLength(0);
  });

  it("outlines the line it would hide where that line is on screen", () => {
    const { layer, container } = renderLayer(makeScene([], null), makeTools({ tool: "blur" }), {
      text: model(),
      base: { basePlacement },
    });
    fireEvent.pointerMove(layer, { clientX: 60, clientY: 31, pointerId: 1 });
    const outline = container.querySelector('[data-testid="text-target"] rect')!;
    // Asset (35, 35) 90 x 30 at half scale from (50, 25) display px.
    expect(Number(outline.getAttribute("x"))).toBeCloseTo(50 + (35 / 400) * 50, 3);
    expect(Number(outline.getAttribute("y"))).toBeCloseTo(25 + (35 / 400) * 50, 3);
    expect(Number(outline.getAttribute("width"))).toBeCloseTo((90 / 400) * 50, 3);
  });

  it("draws the selected words where they are on screen", () => {
    const w = word("secret", 0, 40, 40);
    const { container } = renderLayer(makeScene([], null), makeTools({ tool: "selectText" }), {
      text: model({ words: [w], selected: new Set([w]) }),
      base: { basePlacement },
    });
    const rect = container.querySelector('[data-testid="text-highlight"]')!;
    expect(Number(rect.getAttribute("x"))).toBeCloseTo(55, 3);
    expect(Number(rect.getAttribute("y"))).toBeCloseTo(30, 3);
    expect(Number(rect.getAttribute("width"))).toBeCloseTo(10, 3);
  });
});

describe("gap guides measure from the visible placed base (NIW2-876)", () => {
  const added = (x: number): ImageAnnotation => ({
    id: "i1",
    kind: "image",
    assetId: "a",
    x,
    y: 0.25,
    w: 0.25,
    h: 0.25,
    pixelWidth: 100,
    pixelHeight: 100,
  });

  it("starts the guide at the right edge of the cropped base, not the whole asset's", () => {
    // The crop shows the left half: world x 0..0.5 = source px 0..200. The image is at 1.25
    // (px 500), so the gap is 300 px (the whole asset's edge at px 400 would say 100).
    renderLayer(makeScene([added(1.25)], "i1"), makeTools(), {
      base: { baseCrop: { x: 0, y: 0, w: 0.5, h: 1 } },
    });
    expect(screen.getByTestId("image-gap-label")).toHaveTextContent("300 px");
  });

  it("follows a moved and resized base", () => {
    // The half-size base ends at world 0.5 = px 200, the image starts at px 500: 300 px. An
    // unplaced base would end at px 400 and read 100 px.
    renderLayer(makeScene([added(1.25)], "i1"), makeTools(), {
      base: { basePlacement: { x: 0, y: 0, scale: 0.5 } },
    });
    expect(screen.getByTestId("image-gap-label")).toHaveTextContent("300 px");
  });
});

describe("the selection tag of a cropped image (NIW2-876, AC5)", () => {
  it("reads the visible and the total source size for a cropped added image", () => {
    const img: ImageAnnotation = {
      id: "i1",
      kind: "image",
      assetId: "a",
      x: 0.5,
      y: 0.25,
      w: 0.25,
      h: 0.125,
      pixelWidth: 400,
      pixelHeight: 200,
      crop: { x: 0.25, y: 0, w: 0.5, h: 0.5 },
    };
    renderLayer(makeScene([img], "i1"), makeTools());
    expect(screen.getByTestId("image-tag")).toHaveTextContent("Showing 200×100 of 400×200 px");
  });

  it("reads the visible and the total source size for a cropped base", () => {
    renderLayer(makeScene([], BASE_IMAGE_ID), makeTools(), {
      base: { baseCrop: { x: 0.25, y: 0, w: 0.5, h: 1 } },
    });
    expect(screen.getByTestId("image-tag")).toHaveTextContent("Showing 200×400 of 400×400 px");
  });

  it("keeps the plain size when nothing is cropped", () => {
    const img: ImageAnnotation = {
      id: "i1",
      kind: "image",
      assetId: "a",
      x: 0.5,
      y: 0.25,
      w: 0.25,
      h: 0.125,
      pixelWidth: 400,
      pixelHeight: 200,
    };
    renderLayer(makeScene([img], "i1"), makeTools());
    const tag = screen.getByTestId("image-tag");
    expect(tag).toHaveTextContent("400 × 200 px");
    expect(tag).not.toHaveTextContent("Showing");
  });
});
