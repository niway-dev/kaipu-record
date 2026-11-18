import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import type { CanvasReadResult } from "@shared/types/screenshot-canvas";
import { buildCanvasDoc } from "@renderer/features/screenshots/annotations/canvas-doc";
import type { Scene } from "@renderer/features/screenshots/annotations";
import { ScreenshotEditor } from "./screenshot-editor-page";

// Per-image crop, unit 4: crop mode and the base's corner resize, end to end in the page. The
// layer and the page cooperate: the session lives in the page, the commit happens once on leaving.

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
  exportScene.mockResolvedValue(new ArrayBuffer(1));
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
const surface = () => screen.getByTestId("canvas-hit-surface");
const undoKey = () => fireEvent.keyDown(window, { key: "z", metaKey: true });

/** Drag one point to another on the layer (the layer is 200 x 200 px here). */
function drag(from: [number, number], to: [number, number]): void {
  fireEvent.pointerDown(surface(), { clientX: from[0], clientY: from[1], button: 0 });
  fireEvent.pointerMove(surface(), { clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(surface(), { clientX: to[0], clientY: to[1] });
}

async function cropBaseToTopLeftQuarter(): Promise<void> {
  fireEvent.doubleClick(surface(), { clientX: 100, clientY: 100 });
  await screen.findByTestId("crop-window");
  // The whole base's se corner is (200, 200): drag it to the middle.
  drag([200, 200], [100, 100]);
}

describe("crop mode on the base", () => {
  it("a double-click on the base's pixels enters it: the window and its eight handles show", async () => {
    await open({});
    await waitFor(() => expect(label()).toHaveTextContent("400 × 400 px"));
    fireEvent.doubleClick(surface(), { clientX: 100, clientY: 100 });
    expect(await screen.findByTestId("crop-window")).toBeInTheDocument();
    expect(screen.getAllByTestId("crop-handle")).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("dragging a handle changes nothing in the export until the crop is finished", async () => {
    await open({});
    await cropBaseToTopLeftQuarter();
    // The window did shrink (200 px layer, window 200 -> 100)...
    expect(screen.getByTestId("crop-window").getAttribute("width")).toBe("100");
    // ...but it is still being edited: the export box measures the whole asset.
    expect(label()).toHaveTextContent("400 × 400 px");
  });

  it("Enter commits the crop and leaves: the base exports as the quarter", async () => {
    await open({});
    await cropBaseToTopLeftQuarter();
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(label()).toHaveTextContent("200 × 200 px"));
    expect(screen.queryByTestId("crop-window")).toBeNull();
  });

  it("Esc keeps the crop and leaves, it never clears it", async () => {
    await open({});
    await cropBaseToTopLeftQuarter();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(label()).toHaveTextContent("200 × 200 px"));
    expect(screen.queryByTestId("crop-window")).toBeNull();
  });

  it("the Done button commits the crop and leaves", async () => {
    await open({});
    await cropBaseToTopLeftQuarter();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(label()).toHaveTextContent("200 × 200 px"));
  });

  it("one undo removes the whole session: several drags, one step", async () => {
    await open({});
    fireEvent.doubleClick(surface(), { clientX: 100, clientY: 100 });
    await screen.findByTestId("crop-window");
    drag([200, 200], [150, 150]);
    drag([0, 0], [50, 50]);
    fireEvent.keyDown(window, { key: "Enter" });
    // 0.25..0.75 of a 400 px asset: 200 x 200.
    await waitFor(() => expect(label()).toHaveTextContent("200 × 200 px"));
    undoKey();
    await waitFor(() => expect(label()).toHaveTextContent("400 × 400 px"));
  });

  it("leaving without moving the window commits nothing: undo has nothing to take back", async () => {
    await open({});
    fireEvent.doubleClick(surface(), { clientX: 100, clientY: 100 });
    await screen.findByTestId("crop-window");
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(screen.queryByTestId("crop-window")).toBeNull());
    expect(screen.getByRole("button", { name: /undo/i })).toBeDisabled();
  });

  it("a stored crop is re-opened as the whole asset with the window where it was", async () => {
    await open({ baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
    await waitFor(() => expect(label()).toHaveTextContent("200 × 400 px"));
    // The visible base is the right half (x 100..200 on screen): its pixels open the crop.
    fireEvent.doubleClick(surface(), { clientX: 150, clientY: 100 });
    const win = await screen.findByTestId("crop-window");
    expect(win.getAttribute("x")).toBe("100");
    expect(win.getAttribute("width")).toBe("100");
    // The scrim covers the whole asset (0..200), so the left half is dimmed, still reachable.
    expect(screen.getByTestId("crop-scrim")).toBeInTheDocument();
  });

  it("a double-click on a cropped-out part does not enter crop mode", async () => {
    await open({ baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
    await waitFor(() => expect(label()).toHaveTextContent("200 × 400 px"));
    fireEvent.doubleClick(surface(), { clientX: 20, clientY: 100 });
    expect(screen.queryByTestId("crop-window")).toBeNull();
  });
});

describe("leaving crop mode by other routes", () => {
  const widthOf = () => screen.getByTestId("crop-window").getAttribute("width");

  it("undo mid-session puts the window back and adds no history step", async () => {
    await open({});
    await cropBaseToTopLeftQuarter();
    expect(widthOf()).toBe("100");
    undoKey();
    await waitFor(() => expect(widthOf()).toBe("200"));
    // Still in crop mode, and nothing was committed: the undo button stays disabled.
    expect(screen.getByRole("button", { name: /undo/i })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(screen.queryByTestId("crop-window")).toBeNull());
    expect(label()).toHaveTextContent("400 × 400 px");
  });

  it("a press outside the canvas commits the crop", async () => {
    await open({});
    await cropBaseToTopLeftQuarter();
    fireEvent.pointerDown(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(screen.queryByTestId("crop-window")).toBeNull());
    expect(label()).toHaveTextContent("200 × 200 px");
  });

  it("picking another tool commits the crop", async () => {
    await open({});
    await cropBaseToTopLeftQuarter();
    // The Box tool's key: a tool change goes through the same `afterPick` as its button.
    fireEvent.keyDown(window, { key: "r" });
    await waitFor(() => expect(screen.queryByTestId("crop-window")).toBeNull());
    expect(label()).toHaveTextContent("200 × 200 px");
  });
});

describe("Save, Copy and PDF never run on an uncommitted crop window", () => {
  it("Copy by keyboard (no pointer press) exports the cropped scene", async () => {
    await open({});
    await cropBaseToTopLeftQuarter();
    // A click with no pointerdown, as Space or Enter on a focused Copy button gives.
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(exportScene).toHaveBeenCalled());
    const scene = exportScene.mock.calls[0][1].scene as Scene;
    expect(scene.baseCrop).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(screen.queryByTestId("crop-window")).toBeNull();
  });

  it("PDF by keyboard exports the cropped scene", async () => {
    window.electronAPI.exportScreenshotFile = vi.fn(async () => null) as never;
    await open({});
    await cropBaseToTopLeftQuarter();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(exportScene).toHaveBeenCalled());
    expect(exportScene.mock.calls[0][0]).toBe("pdf");
    expect((exportScene.mock.calls[0][1].scene as Scene).baseCrop).toEqual({
      x: 0,
      y: 0,
      w: 0.5,
      h: 0.5,
    });
  });

  it("Save by keyboard exports the cropped scene", async () => {
    window.electronAPI.saveScreenshot = vi.fn(async () => ({ id: "shot-1" })) as never;
    await open({});
    await cropBaseToTopLeftQuarter();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const overwrite = screen.queryByRole("button", { name: /overwrite/i });
    if (overwrite) fireEvent.click(overwrite);
    await waitFor(() => expect(exportScene).toHaveBeenCalled());
    expect((exportScene.mock.calls[0][1].scene as Scene).baseCrop).toEqual({
      x: 0,
      y: 0,
      w: 0.5,
      h: 0.5,
    });
  });
});

describe("selecting and resizing the base", () => {
  it("a click on the base selects it and shows the image handles", async () => {
    await open({});
    fireEvent.pointerDown(surface(), { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(surface());
    expect(await screen.findByTestId("image-selection")).toBeInTheDocument();
    expect(screen.getAllByTestId("image-handle")).toHaveLength(8);
  });

  it("dragging the corner resizes it proportionally: one commit, one undo", async () => {
    await open({});
    fireEvent.pointerDown(surface(), { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(surface());
    await screen.findByTestId("image-selection");
    drag([200, 200], [100, 100]);
    await waitFor(() => expect(label()).toHaveTextContent("200 × 200 px"));
    undoKey();
    await waitFor(() => expect(label()).toHaveTextContent("400 × 400 px"));
  });
});

describe("crop mode on an added image", () => {
  async function addImage(): Promise<void> {
    await open({});
    await waitFor(() => expect(label()).toHaveTextContent("400 × 400 px"));
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
    // The 200 x 100 image sits at x = 432..632 (file px), y = 0..100: the box is 632 x 400.
    await waitFor(() => expect(label()).toHaveTextContent("632 × 400 px"));
  }
  // On screen (2 file px per layer px): the image is x 216..316, y 0..50.

  it("a double-click on its pixels crops it, not the base", async () => {
    await addImage();
    fireEvent.doubleClick(surface(), { clientX: 260, clientY: 25 });
    const win = await screen.findByTestId("crop-window");
    expect(win.getAttribute("x")).toBe("216");
    expect(win.getAttribute("width")).toBe("100");
  });

  it("dragging the window's right edge in and pressing Enter crops it: the box shrinks, one undo restores", async () => {
    await addImage();
    fireEvent.doubleClick(surface(), { clientX: 260, clientY: 25 });
    await screen.findByTestId("crop-window");
    // The e handle sits at (316, 25): half the width stays.
    drag([316, 25], [266, 25]);
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(label()).toHaveTextContent("532 × 400 px"));
    undoKey();
    await waitFor(() => expect(label()).toHaveTextContent("632 × 400 px"));
  });
});
