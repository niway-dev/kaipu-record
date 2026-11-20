import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import type { CanvasReadResult } from "@shared/types/screenshot-canvas";
import { buildCanvasDoc } from "@renderer/features/screenshots/annotations/canvas-doc";
import type { Scene } from "@renderer/features/screenshots/annotations";
import { ScreenshotEditor } from "./screenshot-editor-page";

// Per-image crop, unit 4: a reopened document whose base is cropped or resized. The live page
// must size the export box, place the preview and the geometry from the VISIBLE base.

vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => name === "image-canvas",
}));
const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene,
  clearExportCache: vi.fn(),
}));
vi.mock("@renderer/features/screenshots/annotations/redaction", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@renderer/features/screenshots/annotations/redaction")
  >()),
  bakeRedactions: vi.fn(async (bytes: ArrayBuffer) => bytes),
  bakeCanvasRedactions: vi.fn(async (base: ArrayBuffer, assets: Record<string, ArrayBuffer>) => ({
    base,
    assets,
  })),
}));

// jsdom cannot decode: a pasted file decodes to a fixed 200 x 100 PNG.
const pastedPng = new Uint8Array([7, 7, 7]).buffer;
vi.mock("@renderer/features/editor/paste-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/features/editor/paste-image")>()),
  decodeToPng: vi.fn(async () => ({ png: pastedPng, width: 200, height: 100 })),
}));

const originalRect = Element.prototype.getBoundingClientRect;
const flatBytes = new Uint8Array([1, 2, 3]).buffer;
const assetBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]).buffer;
const LOCAL: ImageSource = { kind: "local", id: "shot-1", assetId: "a-shot-1", title: "Shot" };
const FRAME = { bg: "none", padding: 0, radius: 0, shadow: 0 } as Scene["beautify"];

/** The stored document of a 400 x 400 base with the given base view. */
const stored = (view: Partial<Scene>): CanvasReadResult =>
  ({
    docJson: JSON.stringify(
      buildCanvasDoc(
        { beautify: FRAME, annotations: [], ...view },
        { pixelWidth: 400, pixelHeight: 400 },
      ),
    ),
    assets: { base: assetBytes },
  }) as CanvasReadResult;

const readCanvas = vi.fn();
beforeEach(async () => {
  const base = await window.electronAPI.getSettings();
  window.electronAPI.getSettings = vi.fn(async () => ({
    ...base,
    screenshotCopy: "manual" as const,
  }));
  URL.createObjectURL = vi.fn(() => "blob:asset");
  URL.revokeObjectURL = vi.fn();
  exportScene.mockReset();
  readCanvas.mockReset();
  window.electronAPI.readScreenshotCanvas = readCanvas as never;
  window.electronAPI.readScreenshotBytes = vi.fn(async () => flatBytes);
  // A 400 px asset shown at 200 px: scale 2.
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 200 });
  }
  for (const prop of ["naturalWidth", "naturalHeight"]) {
    Object.defineProperty(HTMLImageElement.prototype, prop, { configurable: true, get: () => 400 });
  }
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0 }) as DOMRect;
});
afterEach(() => {
  getToasts().forEach((x) => dismissToast(x.id));
  for (const prop of ["clientWidth", "clientHeight"]) {
    Reflect.deleteProperty(HTMLElement.prototype, prop);
  }
  for (const prop of ["naturalWidth", "naturalHeight"]) {
    Reflect.deleteProperty(HTMLImageElement.prototype, prop);
  }
  Element.prototype.getBoundingClientRect = originalRect;
  Reflect.deleteProperty(Element.prototype, "setPointerCapture");
});

async function open(view: Partial<Scene>): Promise<void> {
  readCanvas.mockResolvedValue(stored(view));
  const router = createMemoryRouter(
    [
      { path: "/editor/:id", element: <ScreenshotEditor source={LOCAL} /> },
      { path: "/", element: <div>capture</div> },
    ],
    { initialEntries: ["/editor/shot-1"] },
  );
  render(<RouterProvider router={router} />);
  fireEvent.load(await screen.findByRole("img"));
}
const label = () => screen.getByTestId("export-box-label");

describe("the editor page with a cropped or resized base", () => {
  it("an uncropped base keeps today's export size and draws no separate base view", async () => {
    await open({});
    await waitFor(() => expect(label()).toHaveTextContent("400 × 400 px"));
    expect(screen.queryByTestId("base-view")).toBeNull();
  });

  it("the export box is the visible base: the right half of a 400 px asset is 200 × 400", async () => {
    await open({ baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
    await waitFor(() => expect(label()).toHaveTextContent("200 × 400 px"));
  });

  it("the live frame draws that half where it exports: 50% wide, the asset shifted left", async () => {
    await open({ baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
    const view = await screen.findByTestId("base-view");
    expect(view.style.left).toBe("50%");
    expect(view.style.width).toBe("50%");
    expect(view.querySelector("img")!.style.left).toBe("-100%");
  });

  it("a base resized to half its size exports at half its size", async () => {
    await open({ basePlacement: { x: 0, y: 0, scale: 0.5 } });
    await waitFor(() => expect(label()).toHaveTextContent("200 × 200 px"));
  });

  it("an added image lands past the VISIBLE base, top-aligned with it", async () => {
    // The lower-left quarter of the asset shows: x 0..200, y 200..400 (file px).
    await open({ baseCrop: { x: 0, y: 0.5, w: 0.5, h: 0.5 } });
    await waitFor(() => expect(label()).toHaveTextContent("200 × 200 px"));
    fireEvent.paste(document.body, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => new File([pastedPng], "clip.png", { type: "image/png" }),
          },
        ],
      },
    });
    // The 200 x 100 image sits at x = 200 + 32 gap, y = 200: the box is 0..432 by 200..400.
    await waitFor(() => expect(label()).toHaveTextContent("432 × 200 px"));
  });
});

describe("dragging the base (NIW2-876, AC9 and AC10)", () => {
  // The 400 px asset shown at 200 px, at half size with its corner at (0.25, 0.25): it covers
  // (50..150) px on both axes, so a press at (100, 100) is on the base and on nothing else.
  const PLACED = { basePlacement: { x: 0.25, y: 0.25, scale: 0.5 } };
  const view = () => screen.getByTestId("base-view");
  /** A `left`/`top` in percent, as a number: a drag's float noise is not part of the contract. */
  const pct = (v: string): number => parseFloat(v);
  const drag = (to: { clientX: number; clientY: number }, release = true) => {
    const surface = screen.getByTestId("canvas-hit-surface");
    fireEvent.pointerDown(surface, { button: 0, clientX: 100, clientY: 100, pointerId: 8 });
    fireEvent.pointerMove(surface, { ...to, pointerId: 8 });
    if (release) fireEvent.pointerUp(surface, { pointerId: 8 });
  };
  const copiedScene = async () => {
    exportScene.mockResolvedValue(new ArrayBuffer(1));
    exportScene.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(exportScene).toHaveBeenCalled());
    return (exportScene.mock.calls.at(-1) as [string, { scene: Scene }])[1].scene;
  };

  it("the live frame follows the pointer while it moves and lands where it was released", async () => {
    await open(PLACED);
    await waitFor(() => expect(label()).toHaveTextContent("200 × 200 px"));
    expect(view().style.left).toBe("25%");
    drag({ clientX: 120, clientY: 110 }, false);
    // 20 px of a 200 px shot is 0.1 of the base; 10 px is 0.05.
    expect(pct(view().style.left)).toBeCloseTo(35);
    expect(pct(view().style.top)).toBeCloseTo(30);
    fireEvent.pointerUp(screen.getByTestId("canvas-hit-surface"), { pointerId: 8 });
    expect(pct(view().style.left)).toBeCloseTo(35);
    expect(pct(view().style.top)).toBeCloseTo(30);
    // The box is still the visible base: moving it does not resize it.
    expect(label()).toHaveTextContent("200 × 200 px");
  });

  it("Copy exports the moved base: the new placement, the same scale and no annotation touched", async () => {
    await open(PLACED);
    await waitFor(() => expect(label()).toHaveTextContent("200 × 200 px"));
    drag({ clientX: 120, clientY: 110 });
    const exported = await copiedScene();
    expect(exported.basePlacement!.x).toBeCloseTo(0.35);
    expect(exported.basePlacement!.y).toBeCloseTo(0.3);
    expect(exported.basePlacement!.scale).toBe(0.5);
    expect(exported.annotations).toEqual([]);
  });

  it("an unmoved base is moved from its natural place, writing a placement at scale 1", async () => {
    await open({});
    await waitFor(() => expect(label()).toHaveTextContent("400 × 400 px"));
    drag({ clientX: 120, clientY: 110 });
    const exported = await copiedScene();
    expect(exported.basePlacement!.x).toBeCloseTo(0.1);
    expect(exported.basePlacement!.y).toBeCloseTo(0.05);
    expect(exported.basePlacement!.scale).toBe(1);
  });

  it("Cmd+Z undoes the whole drag in one step, and Cmd+Shift+Z puts it back", async () => {
    await open(PLACED);
    await waitFor(() => expect(label()).toHaveTextContent("200 × 200 px"));
    // Many moves, one release.
    const surface = screen.getByTestId("canvas-hit-surface");
    fireEvent.pointerDown(surface, { button: 0, clientX: 100, clientY: 100, pointerId: 8 });
    for (const x of [105, 110, 115, 120]) {
      fireEvent.pointerMove(surface, { clientX: x, clientY: 110, pointerId: 8 });
    }
    fireEvent.pointerUp(surface, { pointerId: 8 });
    expect(pct(view().style.left)).toBeCloseTo(35);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await waitFor(() => expect(view().style.left).toBe("25%"));
    expect(view().style.top).toBe("25%");
    // One step: there is nothing earlier to undo.
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(view().style.left).toBe("25%");
    fireEvent.keyDown(window, { key: "Z", metaKey: true, shiftKey: true });
    await waitFor(() => expect(pct(view().style.left)).toBeCloseTo(35));
  });

  it("a press that does not move leaves the frame as it was", async () => {
    await open(PLACED);
    await waitFor(() => expect(label()).toHaveTextContent("200 × 200 px"));
    drag({ clientX: 100, clientY: 100 });
    expect(view().style.left).toBe("25%");
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(view().style.left).toBe("25%");
  });
});
