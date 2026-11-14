import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import type { CanvasReadResult } from "@shared/types/screenshot-canvas";
import { ScreenshotEditor, ScreenshotEditorPage } from "./screenshot-editor-page";

// The editable document (ADR 0053, NIW2-700) only exists in canvas mode.
let imageCanvas = true;
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => (name === "image-canvas" ? imageCanvas : false),
}));

const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene,
  clearExportCache: vi.fn(),
}));

// jsdom has no createImageBitmap or canvas: baking is the identity here. The pixel work has
// its own tests (redaction.test.ts).
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

const flatBytes = new Uint8Array([1, 2, 3]).buffer;
// A PNG signature and one byte: enough for the reader's PNG check.
const assetBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]).buffer;
const LOCAL: ImageSource = { kind: "local", id: "shot-1", assetId: "a-shot-1", title: "Shot" };
const PASTE: ImageSource = {
  kind: "blob",
  bytes: flatBytes,
  width: 400,
  height: 400,
  origin: "paste",
};

const FRAME = { bg: "none", padding: 0, radius: 0, shadow: 0 };
const arrow = {
  id: "a7",
  kind: "arrow",
  x1: 0.1,
  y1: 0.1,
  x2: 0.9,
  y2: 0.1,
  color: "#ff0000",
  stroke: 1,
  seed: 1,
};
const blur = { id: "a8", kind: "blur", x: 0.2, y: 0.5, w: 0.3, h: 0.2, locked: true };
const image = {
  id: "image-base",
  kind: "image",
  assetId: "base",
  x: 0,
  y: 0,
  w: 400,
  h: 400,
  pixelWidth: 400,
  pixelHeight: 400,
};
const docJson = (patch: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    items: [image, arrow, blur],
    frame: FRAME,
    ...patch,
  });
const stored = (json: string, assets: Record<string, ArrayBuffer> = { base: assetBytes }) =>
  ({ docJson: json, assets }) as CanvasReadResult;

const readCanvas = vi.fn();
const saveScreenshot = vi.fn();

beforeEach(async () => {
  imageCanvas = true;
  const base = await window.electronAPI.getSettings();
  window.electronAPI.getSettings = vi.fn(async () => ({
    ...base,
    screenshotCopy: "auto" as const,
  }));
  URL.createObjectURL = vi.fn(() => "blob:asset");
  URL.revokeObjectURL = vi.fn();
  exportScene.mockReset();
  exportScene.mockResolvedValue(new ArrayBuffer(1));
  readCanvas.mockReset();
  saveScreenshot.mockReset();
  saveScreenshot.mockImplementation(async (_png: ArrayBuffer, opts: { title: string }) => ({
    id: "shot-1",
    assetId: "a-shot-1",
    title: opts.title,
    kind: "screenshot",
  }));
  window.electronAPI.readScreenshotCanvas = readCanvas as never;
  window.electronAPI.readScreenshotBytes = vi.fn(async () => flatBytes);
  window.electronAPI.saveScreenshot = saveScreenshot as never;
  window.electronAPI.copyImageToClipboard = vi.fn(async () => {});
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 200 });
  }
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0 }) as DOMRect;
});
afterEach(() => {
  getToasts().forEach((x) => dismissToast(x.id));
  // @ts-expect-error — drop the stubs
  delete HTMLElement.prototype.clientWidth;
  // @ts-expect-error — see above
  delete HTMLElement.prototype.clientHeight;
  Element.prototype.getBoundingClientRect = originalRect;
  // @ts-expect-error — jsdom has no pointer capture; the tests stub it
  delete Element.prototype.setPointerCapture;
});

function mountLocal() {
  const router = createMemoryRouter(
    [
      { path: "/editor/:id", element: <ScreenshotEditor source={LOCAL} /> },
      { path: "/", element: <div>capture</div> },
    ],
    { initialEntries: ["/editor/shot-1"] },
  );
  return render(<RouterProvider router={router} />);
}
function mountPaste() {
  const router = createMemoryRouter(
    [
      { path: "/editor/capture", element: <ScreenshotEditorPage /> },
      { path: "/", element: <div>capture</div> },
    ],
    { initialEntries: [{ pathname: "/editor/capture", state: PASTE }] },
  );
  return render(<RouterProvider router={router} />);
}
const loadImage = async () => fireEvent.load(await screen.findByRole("img"));
const annotationIds = (): string[] =>
  [...document.querySelectorAll("[data-annotation]")].map(
    (el) => (el as HTMLElement).dataset.annotation!,
  );
const shownSrc = async (): Promise<string> =>
  (await screen.findByRole("img")).getAttribute("src") ?? "";
const sentCanvas = () => {
  const meta = saveScreenshot.mock.calls.at(-1)![1] as {
    canvas?: { docJson: string; assets: { assetId: string; png: ArrayBuffer }[] };
  };
  return meta.canvas;
};

describe("ScreenshotEditor — reopen from the document (image-canvas)", () => {
  it("opens the document: its annotations are objects, the image is the asset, and it is clean", async () => {
    readCanvas.mockResolvedValue(stored(docJson()));
    mountLocal();
    await loadImage();
    expect(readCanvas).toHaveBeenCalledWith("shot-1");
    expect(await shownSrc()).toBe("blob:asset");
    expect(window.electronAPI.readScreenshotBytes).not.toHaveBeenCalled();
    // The arrow is an object; the locked blur is not drawn (its pixels are already in the
    // asset) but stays in the scene, so the next save keeps it in the document.
    expect(annotationIds()).toEqual(["a7"]);

    // The arrow is selectable like any object: Delete appears once it is selected.
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const surface = screen.getByTestId("canvas-hit-surface");
    fireEvent.pointerDown(surface, { button: 0, clientX: 100, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(await screen.findByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("a clean reopen fires no save, no copy and no export", async () => {
    readCanvas.mockResolvedValue(stored(docJson()));
    mountLocal();
    await loadImage();
    // Longer than the autosave debounce (800 ms): a dirty reopen would have saved by now.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(saveScreenshot).not.toHaveBeenCalled();
    expect(window.electronAPI.copyImageToClipboard).not.toHaveBeenCalled();
    expect(exportScene).not.toHaveBeenCalled();
  });

  it("keeps the document's export frame", async () => {
    readCanvas.mockResolvedValue(
      stored(
        docJson({
          frame: { ...FRAME, bg: "none", padding: 24 },
          exportFrame: { x: 0, y: 0, w: 0.5, h: 0.5 },
        }),
      ),
    );
    mountLocal();
    await loadImage();
    const canvas = document.querySelector('[data-ui-area="editorImage.canvas"] > div')!;
    expect((canvas as HTMLElement).dataset.exportFrame).toBe("true");
  });

  it("an edit after a reopen autosaves over the same item, with the document", async () => {
    readCanvas.mockResolvedValue(stored(docJson()));
    mountLocal();
    await loadImage();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const surface = screen.getByTestId("canvas-hit-surface");
    fireEvent.pointerDown(surface, { button: 0, clientX: 100, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(saveScreenshot).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const meta = saveScreenshot.mock.calls[0][1] as { overwriteId?: string };
    expect(meta.overwriteId).toBe("shot-1");
    const doc = JSON.parse(sentCanvas()!.docJson) as { items: { id: string }[] };
    expect(doc.items.map((i) => i.id)).toEqual(["image-base", "a8"]);
  });

  it.each([
    ["no document (null)", () => readCanvas.mockResolvedValue(null)],
    ["a read that rejects", () => readCanvas.mockRejectedValue(new Error("boom"))],
    ["corrupt JSON", () => readCanvas.mockResolvedValue(stored("{not json"))],
    [
      "an unsupported schema version",
      () => readCanvas.mockResolvedValue(stored(docJson({ schemaVersion: 3 }))),
    ],
    ["a missing base asset", () => readCanvas.mockResolvedValue(stored(docJson(), {}))],
    [
      "a base asset that is not a PNG",
      () =>
        readCanvas.mockResolvedValue(
          stored(docJson(), { base: new Uint8Array([0x3c, 0x73, 0x76, 0x67]).buffer }),
        ),
    ],
  ])("falls back to the flat PNG with no annotations: %s", async (_name, arrange) => {
    arrange();
    mountLocal();
    await loadImage();
    expect(await shownSrc()).not.toBe("blob:asset");
    expect(annotationIds()).toEqual([]);
    expect(screen.queryByTestId("canvas-hit-surface")).toBeInTheDocument();
  });

  it("flag off: never reads the document", async () => {
    imageCanvas = false;
    mountLocal();
    await loadImage();
    expect(readCanvas).not.toHaveBeenCalled();
  });
});

describe("ScreenshotEditor — saving the document (image-canvas)", () => {
  async function drawBlurAndSave() {
    fireEvent.click(screen.getByRole("button", { name: "Redact" }));
    const surface = screen.getByTestId("canvas-hit-surface");
    fireEvent.pointerDown(surface, { button: 0, clientX: 20, clientY: 20, pointerId: 3 });
    fireEvent.pointerMove(surface, { clientX: 120, clientY: 90, pointerId: 3 });
    fireEvent.pointerUp(surface, { pointerId: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveScreenshot).toHaveBeenCalledTimes(1));
  }

  it("canvas mode: Save sends the document with locked blurs and one base asset", async () => {
    mountPaste();
    await loadImage();
    await drawBlurAndSave();
    const canvas = sentCanvas()!;
    expect(canvas).toBeDefined();
    const doc = JSON.parse(canvas.docJson) as {
      schemaVersion: number;
      items: { kind: string; locked?: boolean }[];
    };
    expect(doc.schemaVersion).toBe(2);
    expect(doc.items.map((i) => i.kind)).toEqual(["image", "blur"]);
    expect(doc.items[1].locked).toBe(true);
    expect(canvas.assets).toHaveLength(1);
    expect(canvas.assets[0].assetId).toBe("base");
    expect(canvas.assets[0].png).toBeInstanceOf(ArrayBuffer);
  });

  it("the document records the image's pixel size", async () => {
    mountPaste();
    await loadImage();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveScreenshot).toHaveBeenCalledTimes(1));
    const doc = JSON.parse(sentCanvas()!.docJson) as {
      items: { kind: string; pixelWidth?: number; pixelHeight?: number }[];
    };
    expect(doc.items[0]).toMatchObject({ kind: "image", pixelWidth: 400, pixelHeight: 400 });
  });

  it("flag off: Save sends no canvas field at all", async () => {
    imageCanvas = false;
    mountPaste();
    await loadImage();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveScreenshot).toHaveBeenCalledTimes(1));
    expect(saveScreenshot.mock.calls[0][1]).not.toHaveProperty("canvas");
  });
});
