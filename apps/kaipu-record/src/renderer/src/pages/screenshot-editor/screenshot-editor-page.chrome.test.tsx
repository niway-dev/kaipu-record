import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import { ScreenshotEditorPage } from "./screenshot-editor-page";

// The canvas chrome (NIW2-711, mocks A1-A6) is canvas mode only. Each test picks its flags.
let flags: Record<string, boolean> = {};
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => flags[name] ?? false,
}));

const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene,
  clearExportCache: vi.fn(),
}));

// Inspect decodes the image; jsdom has no canvas, so the page test replaces the decoders.
vi.mock("@renderer/features/screenshots/inspect/pixel-buffer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/features/screenshots/inspect/pixel-buffer")>()),
  decodeSrgbBuffer: vi.fn(async () => ({
    width: 4,
    height: 4,
    // One flat opaque colour: a ruler run spans the whole image.
    data: new Uint8ClampedArray(64).fill(200),
  })),
  probeCaptured: vi.fn(async () => null),
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

const originalRect = Element.prototype.getBoundingClientRect;
const bytes = new Uint8Array([1, 2, 3]).buffer;
// A pasted image runs no auto action.
const PASTE: ImageSource = { kind: "blob", bytes, width: 400, height: 400, origin: "paste" };

beforeEach(async () => {
  flags = { "image-canvas": true };
  const base = await window.electronAPI.getSettings();
  window.electronAPI.getSettings = vi.fn(async () => ({
    ...base,
    screenshotCopy: "manual" as const,
  }));
  URL.createObjectURL = vi.fn(() => "blob:shot");
  URL.revokeObjectURL = vi.fn();
  exportScene.mockReset();
  exportScene.mockResolvedValue(new ArrayBuffer(1));
  window.electronAPI.recognizeScreenshotText = vi.fn(async () => ({
    status: "ready",
    words: [],
  })) as never;
  sizeTheCanvas();
});
afterEach(() => {
  flags = {};
  getToasts().forEach((x) => dismissToast(x.id));
  for (const prop of ["clientWidth", "clientHeight"]) {
    Reflect.deleteProperty(HTMLElement.prototype, prop);
  }
  for (const prop of ["naturalWidth", "naturalHeight"]) {
    Reflect.deleteProperty(HTMLImageElement.prototype, prop);
  }
  Element.prototype.getBoundingClientRect = originalRect;
  // @ts-expect-error — jsdom has no pointer capture; the tests stub it
  delete Element.prototype.setPointerCapture;
});

/**
 * A 400 px shot (its file size) shown at 200 px at the origin: scale 2, so a pointer at
 * (x, y) in display px is at (2x, 2y) in the file.
 */
function sizeTheCanvas(): void {
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 200 });
  }
  for (const prop of ["naturalWidth", "naturalHeight"]) {
    Object.defineProperty(HTMLImageElement.prototype, prop, {
      configurable: true,
      get: () => 400,
    });
  }
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0 }) as DOMRect;
}

function mount(source: ImageSource = PASTE) {
  const router = createMemoryRouter(
    [
      { path: "/editor/capture", element: <ScreenshotEditorPage /> },
      { path: "/", element: <div>capture</div> },
    ],
    { initialEntries: [{ pathname: "/editor/capture", state: source }] },
  );
  return render(<RouterProvider router={router} />);
}
const loadImage = async () => fireEvent.load(await screen.findByRole("img"));
const box = () => screen.queryByTestId("export-box");
const boxLabel = () => screen.queryByTestId("export-box-label");
const tool = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("ScreenshotEditorPage — export box (mock A1)", () => {
  it("flag on: the box is drawn, labeled with the exact size Copy produces", async () => {
    mount();
    await loadImage();
    await waitFor(() => expect(box()).not.toBeNull());
    expect(box()).toHaveAttribute("data-label", "labeled");
    expect(boxLabel()).toHaveTextContent("Export");
    expect(boxLabel()).toHaveTextContent("400 × 400 px");
  });

  it("with no background the box is filled with the stage colour, under the content", async () => {
    mount();
    await loadImage();
    await waitFor(() => expect(box()).not.toBeNull());
    const fill = screen.getByTestId("export-box-fill");
    expect(box()).toContainElement(fill);
    // First in the box, so the dashed outline and label draw over it.
    expect(box()!.firstElementChild).toBe(fill);
  });

  it("with a background the box has no fill: the background shows", async () => {
    mount();
    await loadImage();
    await waitFor(() => expect(box()).not.toBeNull());
    fireEvent.click(
      within(
        document.querySelector('[data-ui-area="editorImage.beautify"]') as HTMLElement,
      ).getByRole("button", { name: "Sunset" }),
    );
    await waitFor(() => expect(screen.queryByTestId("export-box-fill")).toBeNull());
    expect(box()).not.toBeNull();
  });

  it("flag off: there is no box and no label", async () => {
    flags = {};
    mount();
    await loadImage();
    expect(box()).toBeNull();
    expect(boxLabel()).toBeNull();
  });

  it("the label follows the content: a box drawn outside the shot grows it live", async () => {
    mount();
    await loadImage();
    await waitFor(() => expect(boxLabel()).toHaveTextContent("400 × 400 px"));
    tool("Box");
    const surface = screen.getByTestId("canvas-hit-surface");
    // From (-60,-40) to (-10,-10) display px: above and left of the shot.
    fireEvent.pointerDown(surface, { button: 0, clientX: -60, clientY: -40, pointerId: 6 });
    fireEvent.pointerMove(surface, { clientX: -10, clientY: -10, pointerId: 6 });
    // Mid-drag, before the pointer is released: the box already reaches the drag.
    await waitFor(() => expect(boxLabel()).not.toHaveTextContent("400 × 400 px"));
    const midDrag = boxLabel()!.textContent;
    fireEvent.pointerUp(surface, { pointerId: 6 });
    await waitFor(() => expect(boxLabel()!.textContent).toBe(midDrag));
  });

  it("the label is hidden, the box stays, while a Redact tool is active", async () => {
    mount();
    await loadImage();
    await waitFor(() => expect(box()).toHaveAttribute("data-label", "labeled"));
    tool("Redact");
    expect(box()).toHaveAttribute("data-label", "quiet");
    expect(boxLabel()).toBeNull();
    tool("Box");
    expect(box()).toHaveAttribute("data-label", "labeled");
  });

  it("the label is hidden, the box stays, while Select text is active", async () => {
    flags = { "image-canvas": true, "image-text": true };
    mount();
    await loadImage();
    await waitFor(() => expect(box()).toHaveAttribute("data-label", "labeled"));
    tool("Select text");
    expect(box()).toHaveAttribute("data-label", "quiet");
    expect(boxLabel()).toBeNull();
  });

  it("the label is hidden, the box stays, while Inspect is on", async () => {
    flags = { "image-canvas": true, "image-inspect": true };
    mount();
    await loadImage();
    await waitFor(() => expect(box()).toHaveAttribute("data-label", "labeled"));
    fireEvent.click(screen.getByRole("button", { name: "Inspect (I)" }));
    expect(box()).toHaveAttribute("data-label", "quiet");
    expect(boxLabel()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Annotate (Esc)" }));
    expect(box()).toHaveAttribute("data-label", "labeled");
  });

  it("the whole box is hidden while an export frame is set", async () => {
    mount();
    await loadImage();
    await waitFor(() => expect(box()).not.toBeNull());
    tool("Export frame");
    const overlay = await waitFor(() => {
      const el = document.querySelector('[class*="overlay"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 20, pointerId: 3 });
    fireEvent.pointerMove(overlay, { clientX: 120, clientY: 100, pointerId: 3 });
    fireEvent.pointerUp(overlay, { pointerId: 3 });
    await waitFor(() => expect(box()).toBeNull());
  });
});

const exportFrameOf = () =>
  document
    .querySelector('[data-ui-area="editorImage.canvasView"]')!
    .getAttribute("data-export-frame");
const savedFrame = async (): Promise<unknown> => {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(exportScene).toHaveBeenCalled());
  const calls = exportScene.mock.calls as [string, { scene: { exportFrame?: unknown } }][];
  return calls.at(-1)![1].scene.exportFrame;
};

describe("ScreenshotEditorPage — export frame card (mock A5)", () => {
  it("opens with the Crop tool, and says what the frame is for", async () => {
    mount();
    await loadImage();
    expect(screen.queryByText("Export frame")).toBeNull();
    tool("Export frame");
    expect(screen.getByText("Export frame")).toBeInTheDocument();
    expect(screen.getByText("Copy and Save export exactly this box.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fit to content" })).toBeEnabled();
    // Nothing to remove yet.
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    // The classic Crop / Reset row is not shown in canvas mode.
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    tool("Box");
    expect(screen.queryByText("Export frame")).toBeNull();
  });

  it("flag off: no card, the classic Crop / Reset row stays", async () => {
    flags = {};
    mount();
    await loadImage();
    tool("Crop");
    expect(screen.queryByText("Export frame")).toBeNull();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("Fit to content sets the frame to the content box, and Remove clears it", async () => {
    mount();
    await loadImage();
    await waitFor(() => expect(box()).not.toBeNull());
    tool("Export frame");
    fireEvent.click(screen.getByRole("button", { name: "Fit to content" }));
    await waitFor(() => expect(exportFrameOf()).toBe("true"));
    // No content past the shot and no padding: the content box is the shot, 0-1 of itself.
    expect(await savedFrame()).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(exportFrameOf()).toBe("false"));
  });

  it("both buttons are undoable", async () => {
    mount();
    await loadImage();
    tool("Export frame");
    fireEvent.click(screen.getByRole("button", { name: "Fit to content" }));
    await waitFor(() => expect(exportFrameOf()).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(exportFrameOf()).toBe("false"));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(exportFrameOf()).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(exportFrameOf()).toBe("false"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(exportFrameOf()).toBe("true"));
  });

  it("Fit to content covers content past the shot, but not the padding", async () => {
    mount();
    await loadImage();
    tool("Box");
    const surface = screen.getByTestId("canvas-hit-surface");
    // A box from (150, 50) to (300, 150) display px: it ends 100 px (200 file px) past the
    // shot's right edge, which is at 200 display px.
    fireEvent.pointerDown(surface, { button: 0, clientX: 150, clientY: 50, pointerId: 6 });
    fireEvent.pointerMove(surface, { clientX: 300, clientY: 150, pointerId: 6 });
    fireEvent.pointerUp(surface, { pointerId: 6 });
    tool("Export frame");
    fireEvent.click(screen.getByRole("button", { name: "Fit to content" }));
    await waitFor(() => expect(exportFrameOf()).toBe("true"));
    const frame = (await savedFrame()) as { x: number; y: number; w: number; h: number };
    // Wider than the shot (w > 1), starting at its left edge.
    expect(frame.x).toBeCloseTo(0);
    expect(frame.w).toBeGreaterThan(1.4);
  });
});

/** Stubs for a stage 800 px wide with the frame at `frameLeft` (px from the stage's left). */
function stubStage(state: { frameLeft: number }): void {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const isStage = this.getAttribute("data-canvas") === "true";
    const isFrame = this.parentElement?.getAttribute("data-canvas") === "true";
    const r = isStage
      ? { left: 0, top: 0, width: 800, height: 600 }
      : isFrame
        ? { left: state.frameLeft, top: 100, width: 400, height: 300 }
        : { left: 0, top: 0, width: 200, height: 200 };
    return {
      ...r,
      right: r.left + r.width,
      bottom: r.top + r.height,
      x: r.left,
      y: r.top,
    } as DOMRect;
  };
}
const notice = () => document.querySelector('[data-ui-area="editorImage.offContentNotice"]');

describe("ScreenshotEditorPage — off-content notice (mock A6)", () => {
  it("shows which way the content went once most of it is off the stage", async () => {
    const state = { frameLeft: 1500 }; // wholly right of the 800 px stage
    stubStage(state);
    mount();
    await loadImage();
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(notice()).toHaveTextContent("Most of the content is to the right");
    expect(notice()).toHaveTextContent("⇧1");
    expect(notice()).toHaveAttribute("data-direction", "right");
    // The Fit button is accent-coloured while the notice shows.
    expect(screen.getByTitle("Fit to content (⇧1)")).toHaveAttribute("data-notice", "true");
  });

  it("is absent while the content is in view, and goes away once it is", async () => {
    const state = { frameLeft: 1500 };
    stubStage(state);
    mount();
    await loadImage();
    await waitFor(() => expect(notice()).not.toBeNull());
    state.frameLeft = 100; // fully inside the stage
    fireEvent.click(screen.getByTitle("Zoom in")); // the view moved: measure again
    await waitFor(() => expect(notice()).toBeNull());
    expect(screen.getByTitle("Fit to content (⇧1)")).toHaveAttribute("data-notice", "false");
  });

  it("names the other directions", async () => {
    const state = { frameLeft: -900 }; // wholly left of the stage
    stubStage(state);
    mount();
    await loadImage();
    await waitFor(() => expect(notice()).toHaveTextContent("Most of the content is to the left"));
  });

  it("flag off: no notice and no Fit button", async () => {
    flags = {};
    stubStage({ frameLeft: 1500 });
    mount();
    await loadImage();
    expect(notice()).toBeNull();
    expect(screen.queryByTitle("Fit to content (⇧1)")).toBeNull();
  });

  describe("fitting", () => {
    // A 1000 px frame in a 200 px stage: fitting zooms out to the floor (25%).
    const stubFrameSize = (): void => {
      for (const prop of ["offsetWidth", "offsetHeight"]) {
        Object.defineProperty(HTMLElement.prototype, prop, {
          configurable: true,
          get: () => 1000,
        });
      }
    };
    afterEach(() => {
      for (const prop of ["offsetWidth", "offsetHeight"]) {
        Reflect.deleteProperty(HTMLElement.prototype, prop);
      }
    });
    const zoomText = () => screen.getByTitle("Reset zoom").textContent;

    it("clicking the notice fits the content", async () => {
      const state = { frameLeft: 1500 };
      stubStage(state);
      mount();
      await loadImage();
      await waitFor(() => expect(notice()).not.toBeNull());
      stubFrameSize();
      expect(zoomText()).toBe("100%");
      fireEvent.click(notice()!);
      await waitFor(() => expect(zoomText()).toBe("25%"));
    });

    it("the Fit button does the same", async () => {
      mount();
      await loadImage();
      await waitFor(() => expect(box()).not.toBeNull());
      stubFrameSize();
      fireEvent.click(screen.getByTitle("Fit to content (⇧1)"));
      await waitFor(() => expect(zoomText()).toBe("25%"));
    });

    it("Shift+1 fits the content, from the physical key", async () => {
      mount();
      await loadImage();
      await waitFor(() => expect(box()).not.toBeNull());
      stubFrameSize();
      fireEvent.keyDown(window, { code: "Digit1", key: "!", shiftKey: true });
      await waitFor(() => expect(zoomText()).toBe("25%"));
    });

    it("Shift+1 is ignored while typing in a field and with another modifier", async () => {
      mount();
      await loadImage();
      await waitFor(() => expect(box()).not.toBeNull());
      stubFrameSize();
      const title = screen.getByRole("textbox");
      fireEvent.keyDown(title, { code: "Digit1", key: "!", shiftKey: true });
      fireEvent.keyDown(window, { code: "Digit1", key: "!", shiftKey: true, metaKey: true });
      fireEvent.keyDown(window, { code: "Digit1", key: "1", shiftKey: false });
      expect(zoomText()).toBe("100%");
    });

    it("Shift+1 fits and does not draw Inspect's ruler, while plain 1 still does", async () => {
      flags = { "image-canvas": true, "image-inspect": true };
      mount();
      await loadImage();
      fireEvent.keyDown(window, { key: "i" });
      const inspectLayer = await screen.findByTestId("inspect-layer");
      fireEvent.pointerMove(inspectLayer, { clientX: 100, clientY: 100 });
      await screen.findByText(/\d+, \d+/);
      stubFrameSize();
      fireEvent.keyDown(window, { code: "Digit1", key: "!", shiftKey: true });
      await waitFor(() => expect(zoomText()).toBe("25%"));
      expect(screen.queryByTestId("inspect-ruler-length")).toBeNull();
      fireEvent.keyDown(window, { code: "Digit1", key: "1" });
      await waitFor(() => expect(screen.getByTestId("inspect-ruler-length")).toBeInTheDocument());
    });
  });
});

describe("ScreenshotEditorPage — export frame look and Beautify tip (mock A5, A2)", () => {
  it("the Crop tool labels the frame with the size an export of it has", async () => {
    mount();
    await loadImage();
    await waitFor(() => expect(box()).not.toBeNull());
    tool("Export frame");
    const overlay = await waitFor(() => {
      const el = document.querySelector('[class*="overlay"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // Nothing set yet: the label is the whole export (400 × 400 px, as the box says).
    expect(screen.getByTestId("export-frame-label")).toHaveTextContent(
      "400 × 400 px · EXPORT FRAME",
    );
    expect(screen.getAllByTestId("export-frame-handle")).toHaveLength(8);
    // A drag over a quarter of each side, while it is still in flight.
    fireEvent.pointerDown(overlay, { clientX: 0, clientY: 0, pointerId: 3 });
    fireEvent.pointerMove(overlay, { clientX: 100, clientY: 100, pointerId: 3 });
    expect(screen.getByTestId("export-frame-label")).toHaveTextContent("200 × 200 px");
    fireEvent.pointerUp(overlay, { pointerId: 3 });
  });

  it("flag off: the Crop tool has none of the canvas chrome", async () => {
    flags = {};
    mount();
    await loadImage();
    tool("Crop");
    await waitFor(() => expect(document.querySelector('[class*="overlay"]')).not.toBeNull());
    expect(screen.queryByTestId("export-frame-label")).toBeNull();
  });

  it("the Beautify tip says what the export covers, in canvas mode only", async () => {
    mount();
    await loadImage();
    expect(
      screen.getByText(
        "Background and padding are part of what you export. The dotted canvas around them is not.",
      ),
    ).toBeInTheDocument();
  });

  it("flag off: the Beautify tip is the classic one", async () => {
    flags = {};
    mount();
    await loadImage();
    expect(screen.getByText(/annotations are drawn by hand/)).toBeInTheDocument();
  });
});
