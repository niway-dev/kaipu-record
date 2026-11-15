import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import type { CanvasReadResult } from "@shared/types/screenshot-canvas";
import type { LocalRecording } from "@shared/types/library-storage";
import { ScreenshotEditor, ScreenshotEditorPage } from "./screenshot-editor-page";

// Images added to the canvas (NIW2-703) exist only in canvas mode.
let imageCanvas = true;
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => (name === "image-canvas" ? imageCanvas : false),
}));

const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene,
  clearExportCache: vi.fn(),
}));

// The layer draws the images (its own tests cover that); here it only reports what the page
// hands it: the scene's annotations and the object-URL map.
vi.mock("@renderer/features/screenshots/annotations/annotation-layer", () => ({
  AnnotationLayer: (props: { scene: { annotations: unknown[] }; imageUrls?: unknown }) => (
    <div
      data-testid="layer"
      data-urls={JSON.stringify(props.imageUrls ?? null)}
      data-annotations={JSON.stringify(props.scene.annotations)}
    />
  ),
}));

// jsdom cannot decode: a pasted file decodes to a fixed 200×100 PNG.
const pastedPng = new Uint8Array([7, 7, 7]).buffer;
vi.mock("@renderer/features/editor/paste-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/features/editor/paste-image")>()),
  decodeToPng: vi.fn(async () => ({ png: pastedPng, width: 200, height: 100 })),
}));

const originalRect = Element.prototype.getBoundingClientRect;

const flatBytes = new Uint8Array([1, 2, 3]).buffer;
// Stored assets start with the PNG signature: a reopened document refuses any other bytes.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const assetBytes = new Uint8Array([...PNG_SIGNATURE, 9, 9, 9, 9]).buffer;
const libraryBytes = new Uint8Array([...PNG_SIGNATURE, 5, 5]).buffer;
const LOCAL: ImageSource = { kind: "local", id: "shot-1", assetId: "a-shot-1", title: "Shot" };
const PASTE: ImageSource = {
  kind: "blob",
  bytes: flatBytes,
  width: 400,
  height: 400,
  origin: "paste",
};

const FRAME = { bg: "none", padding: 0, radius: 0, shadow: 0 };
const baseItem = {
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
const addedItem = (assetId: string) => ({
  id: "a3",
  kind: "image",
  assetId,
  x: 432,
  y: 0,
  w: 200,
  h: 100,
  pixelWidth: 200,
  pixelHeight: 100,
});
const docV2 = (assetId = "img-aaaaaaaaaaaa"): string =>
  JSON.stringify({ schemaVersion: 2, items: [baseItem, addedItem(assetId)], frame: FRAME });
const stored = (json: string, assets: Record<string, ArrayBuffer>) =>
  ({ docJson: json, assets }) as CanvasReadResult;

const shot = (patch: Partial<LocalRecording>): LocalRecording =>
  ({
    id: "lib-1",
    assetId: "asset-lib-1",
    kind: "screenshot",
    title: "Dashboard draft",
    filePath: "/vault/lib-1.png",
    createdAt: 1,
    sizeBytes: 1,
    durationSeconds: 0,
    thumbnailUrl: null,
    derivedFromAssetId: null,
    ...patch,
  }) as LocalRecording;

const readCanvas = vi.fn();
const saveScreenshot = vi.fn();
let urlCount = 0;

beforeEach(async () => {
  imageCanvas = true;
  urlCount = 0;
  const base = await window.electronAPI.getSettings();
  window.electronAPI.getSettings = vi.fn(async () => ({
    ...base,
    screenshotCopy: "manual" as const,
  }));
  URL.createObjectURL = vi.fn(() => `blob:${(urlCount += 1)}`);
  URL.revokeObjectURL = vi.fn();
  exportScene.mockReset();
  exportScene.mockResolvedValue(new ArrayBuffer(1));
  readCanvas.mockReset();
  readCanvas.mockResolvedValue(null);
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
  window.electronAPI.listLocalRecordings = vi.fn(async () => []);
  window.electronAPI.revealAfterCapture = vi.fn();
  window.electronAPI.readClipboardImage = vi.fn(async () => null);
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 200 });
  }
  // The base's pixel size, which the placement of an added image is computed from.
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", {
    configurable: true,
    get: () => 400,
  });
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
  // @ts-expect-error — see above
  delete HTMLImageElement.prototype.naturalWidth;
  // @ts-expect-error — see above
  delete HTMLImageElement.prototype.naturalHeight;
  Element.prototype.getBoundingClientRect = originalRect;
  // @ts-expect-error — jsdom has no pointer capture; the tests stub it
  delete Element.prototype.setPointerCapture;
  vi.unstubAllGlobals();
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
const loadImage = async () => {
  const img = (await screen.findAllByRole("img")).find((el) => el.tagName === "IMG")!;
  fireEvent.load(img);
};
type Added = {
  id: string;
  kind: string;
  assetId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
};
const layer = (): HTMLElement => screen.getByTestId("layer");
const annotations = (): Added[] => JSON.parse(layer().dataset.annotations!) as Added[];
const urls = (): Record<string, string> | null =>
  JSON.parse(layer().dataset.urls!) as Record<string, string> | null;
const pasteImage = () =>
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
const openAddMenu = () => fireEvent.click(screen.getByRole("button", { name: "Add image" }));
const sentCanvas = () => {
  const meta = saveScreenshot.mock.calls.at(-1)![1] as {
    canvas?: { docJson: string; assets: { assetId: string; png: ArrayBuffer }[] };
  };
  return meta.canvas;
};

describe("ScreenshotEditor — adding images (image-canvas)", () => {
  it("paste adds an image annotation to the right of the base, selected, and its URL reaches the layer", async () => {
    mountPaste();
    await loadImage();
    expect(annotations()).toEqual([]);
    pasteImage();
    await waitFor(() => expect(annotations()).toHaveLength(1));
    const [added] = annotations();
    expect(added).toMatchObject({ kind: "image", y: 0 });
    // 400 px base, 32 px gap; 200×100 px image over a 400 px base.
    expect(added.x).toBeCloseTo((400 + 32) / 400);
    expect(added.w).toBeCloseTo(0.5);
    expect(added.h).toBeCloseTo(0.25);
    expect(added.assetId).toMatch(/^img-[a-z0-9]{12}$/);
    await waitFor(() => expect(urls()?.[added.assetId!]).toMatch(/^blob:/));
  });

  it("the second image goes past the first one", async () => {
    mountPaste();
    await loadImage();
    pasteImage();
    await waitFor(() => expect(annotations()).toHaveLength(1));
    pasteImage();
    await waitFor(() => expect(annotations()).toHaveLength(2));
    const [first, second] = annotations();
    expect(second.x).toBeGreaterThan(first.x + first.w);
  });

  it("a paste before the base has a known size says so instead of dropping the image", async () => {
    // A local shot without a document and with no size in its source: until the base image
    // loads, its size is unknown.
    readCanvas.mockResolvedValue(null);
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
      configurable: true,
      get: () => 0,
    });
    mountLocal();
    await screen.findAllByRole("img");
    pasteImage();
    await waitFor(() =>
      expect(getToasts().map((x) => x.message)).toContain("Couldn't add the image."),
    );
    expect(annotations()).toHaveLength(0);
  });

  it("a New capture that answers after the editor closed adds nothing", async () => {
    let answer: (v: unknown) => void = () => {};
    window.electronAPI.captureScreenshot = vi.fn(
      () => new Promise((resolve) => (answer = resolve)),
    ) as never;
    const view = mountPaste();
    await loadImage();
    openAddMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "New capture" }));
    const created = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.length;
    view.unmount();
    answer({
      kind: "captured",
      after: "editor",
      png: libraryBytes,
      width: 300,
      height: 150,
      mode: "frame",
      saved: null,
      copied: false,
      policy: null,
    });
    await new Promise((r) => setTimeout(r, 20));
    // No asset registered for a closed editor: its URL would never be revoked.
    expect((URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.length).toBe(created);
  });

  it("a paste while a modal is open adds nothing behind it", async () => {
    mountPaste();
    await loadImage();
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    try {
      pasteImage();
      await new Promise((r) => setTimeout(r, 20));
      expect(annotations()).toHaveLength(0);
    } finally {
      modal.remove();
    }
    pasteImage();
    await waitFor(() => expect(annotations()).toHaveLength(1));
  });

  describe("the view fits the content", () => {
    // The canvas is 200 px (clientWidth stub); the frame's laid-out size is `frame` px.
    let frame = 100;
    const canvasView = () => document.querySelector('[data-canvas="true"]')!;
    beforeEach(() => {
      for (const prop of ["offsetWidth", "offsetHeight"]) {
        Object.defineProperty(HTMLElement.prototype, prop, {
          configurable: true,
          get: () => frame,
        });
      }
    });
    afterEach(() => {
      // @ts-expect-error — drop the stubs
      delete HTMLElement.prototype.offsetWidth;
      // @ts-expect-error — see above
      delete HTMLElement.prototype.offsetHeight;
    });

    it("a content box that fits opens at 100%, and an added image that overflows zooms out", async () => {
      frame = 100;
      mountPaste();
      await loadImage();
      expect(canvasView()).toHaveAttribute("data-zoomed-out", "false");
      frame = 400; // the added image makes the frame twice as wide as the canvas
      pasteImage();
      await waitFor(() => expect(annotations()).toHaveLength(1));
      await waitFor(() => expect(canvasView()).toHaveAttribute("data-zoomed-out", "true"));
    });

    it("a document wider than the canvas opens fitted", async () => {
      frame = 400;
      mountPaste();
      await loadImage();
      await waitFor(() => expect(canvasView()).toHaveAttribute("data-zoomed-out", "true"));
    });
  });

  it("paste inside a text field is left to the field", async () => {
    mountPaste();
    await loadImage();
    const field = screen.getByRole("textbox", { name: /title/i });
    fireEvent.paste(field, {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => null }] },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(annotations()).toEqual([]);
  });

  it("Add image > From Library adds the picked shot, and lists neither recordings nor the open shot", async () => {
    window.electronAPI.listLocalRecordings = vi.fn(async () => [
      shot({ id: "shot-1", assetId: "a-shot-1", title: "Open shot" }),
      shot({ id: "lib-1", title: "Dashboard draft", createdAt: 5 }),
      shot({ id: "rec-1", kind: "recording", title: "A video" }),
    ]);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 300, height: 150, close: vi.fn() })),
    );
    window.electronAPI.readScreenshotBytes = vi.fn(async (id: string) =>
      id === "lib-1" ? libraryBytes : flatBytes,
    );
    mountLocal();
    await loadImage();
    openAddMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From Library" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(await screen.findByRole("button", { name: "Dashboard draft" })).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("Open shot");
    expect(dialog).not.toHaveTextContent("A video");
    fireEvent.click(screen.getByRole("button", { name: "Dashboard draft" }));
    await waitFor(() => expect(annotations()).toHaveLength(1));
    expect(window.electronAPI.readScreenshotBytes).toHaveBeenCalledWith("lib-1");
    expect(annotations()[0]).toMatchObject({ kind: "image" });
    expect(annotations()[0].w).toBeCloseTo(300 / 400);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Escape while the picked shot loads adds nothing", async () => {
    window.electronAPI.listLocalRecordings = vi.fn(async () => [
      shot({ id: "lib-1", title: "Dashboard draft", createdAt: 5 }),
    ]);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 300, height: 150, close: vi.fn() })),
    );
    let release: (bytes: ArrayBuffer) => void = () => {};
    window.electronAPI.readScreenshotBytes = vi.fn((id: string) =>
      id === "lib-1"
        ? new Promise<ArrayBuffer>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(flatBytes),
    );
    mountLocal();
    await loadImage();
    openAddMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From Library" }));
    fireEvent.click(await screen.findByRole("button", { name: "Dashboard draft" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    release(libraryBytes);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(annotations()).toEqual([]);
  });

  it("a Library shot that finishes loading after a paste lands past the pasted image", async () => {
    window.electronAPI.listLocalRecordings = vi.fn(async () => [
      shot({ id: "lib-1", title: "Dashboard draft", createdAt: 5 }),
    ]);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 300, height: 150, close: vi.fn() })),
    );
    let release: (bytes: ArrayBuffer) => void = () => {};
    window.electronAPI.readScreenshotBytes = vi.fn((id: string) =>
      id === "lib-1"
        ? new Promise<ArrayBuffer>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(flatBytes),
    );
    mountLocal();
    await loadImage();
    openAddMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From Library" }));
    fireEvent.click(await screen.findByRole("button", { name: "Dashboard draft" }));
    // The open picker blocks a paste, so force the interleaving: any image added while the
    // Library read is in flight must not be covered by the picked one.
    screen.getByRole("alertdialog").removeAttribute("aria-modal");
    pasteImage();
    await waitFor(() => expect(annotations()).toHaveLength(1));
    release(libraryBytes);
    await waitFor(() => expect(annotations()).toHaveLength(2));
    const [pasted, picked] = annotations();
    expect(picked.x).toBeGreaterThan(pasted.x + pasted.w);
  });

  it("the picker says so when the Library has no other screenshot", async () => {
    mountPaste();
    await loadImage();
    openAddMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "From Library" }));
    expect(await screen.findByText("No other screenshots in your Library yet.")).toBeVisible();
  });

  it("Add image > New capture asks main for a shot that comes back to the editor only", async () => {
    window.electronAPI.captureScreenshot = vi.fn(async () => ({
      kind: "captured",
      after: "editor",
      png: libraryBytes,
      width: 300,
      height: 150,
      mode: "frame",
      saved: null,
      copied: false,
      policy: null,
    })) as never;
    mountPaste();
    await loadImage();
    openAddMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "New capture" }));
    await waitFor(() => expect(annotations()).toHaveLength(1));
    expect(window.electronAPI.captureScreenshot).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      { insert: true },
    );
    expect(window.electronAPI.revealAfterCapture).toHaveBeenCalledTimes(1);
  });

  it("a cancelled capture adds nothing", async () => {
    window.electronAPI.captureScreenshot = vi.fn(async () => ({ kind: "cancelled" })) as never;
    mountPaste();
    await loadImage();
    openAddMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "New capture" }));
    await waitFor(() => expect(window.electronAPI.captureScreenshot).toHaveBeenCalled());
    expect(annotations()).toEqual([]);
  });

  it("the menu says pasting works too", async () => {
    mountPaste();
    await loadImage();
    openAddMenu();
    expect(screen.getByRole("menu")).toHaveTextContent(/paste an image with/i);
  });

  it("Save sends a v2 document with the image item and both assets", async () => {
    mountPaste();
    await loadImage();
    pasteImage();
    await waitFor(() => expect(annotations()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveScreenshot).toHaveBeenCalledTimes(1));
    const canvas = sentCanvas()!;
    const doc = JSON.parse(canvas.docJson) as {
      schemaVersion: number;
      items: { kind: string; assetId: string; x: number; w: number }[];
    };
    expect(doc.schemaVersion).toBe(2);
    expect(doc.items.map((i) => i.kind)).toEqual(["image", "image"]);
    // World units: 1 unit = 1 base px.
    expect(doc.items[1]).toMatchObject({ x: 432, w: 200 });
    expect(canvas.assets.map((a) => a.assetId)).toEqual(["base", doc.items[1].assetId]);
    expect(canvas.assets[1].png).toBe(pastedPng);
    // The export got the bytes too, to draw the image.
    const exportInput = exportScene.mock.calls[0][1] as { assets: Record<string, ArrayBuffer> };
    expect(exportInput.assets[doc.items[1].assetId]).toBe(pastedPng);
  });

  it("an image that was added and then undone is not sent", async () => {
    mountPaste();
    await loadImage();
    pasteImage();
    await waitFor(() => expect(annotations()).toHaveLength(1));
    fireEvent.click(screen.getByTitle("Undo"));
    await waitFor(() => expect(annotations()).toHaveLength(0));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveScreenshot).toHaveBeenCalledTimes(1));
    expect(sentCanvas()!.assets.map((a) => a.assetId)).toEqual(["base"]);
  });
});

describe("ScreenshotEditor — reopening a document with images (image-canvas)", () => {
  it("loads the image annotation and its asset", async () => {
    readCanvas.mockResolvedValue(
      stored(docV2(), { base: assetBytes, "img-aaaaaaaaaaaa": libraryBytes }),
    );
    mountLocal();
    await loadImage();
    expect(annotations()).toHaveLength(1);
    expect(annotations()[0]).toMatchObject({ kind: "image", assetId: "img-aaaaaaaaaaaa" });
    expect(annotations()[0].x).toBeCloseTo(1.08);
    await waitFor(() => expect(urls()?.["img-aaaaaaaaaaaa"]).toMatch(/^blob:/));
    expect(window.electronAPI.readScreenshotBytes).not.toHaveBeenCalled();
  });

  it("falls back to the flat PNG when an image's asset is missing", async () => {
    readCanvas.mockResolvedValue(stored(docV2(), { base: assetBytes }));
    mountLocal();
    await loadImage();
    expect(readCanvas).toHaveBeenCalledWith("shot-1");
    expect(annotations()).toEqual([]);
    expect(urls()).toEqual({});
  });
});

describe("ScreenshotEditor — flag off", () => {
  it("shows no Add image and ignores paste", async () => {
    imageCanvas = false;
    mountPaste();
    await loadImage();
    expect(screen.queryByRole("button", { name: "Add image" })).not.toBeInTheDocument();
    pasteImage();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(annotations()).toEqual([]);
    expect(urls()).toBeNull();
    expect(window.electronAPI.readClipboardImage).not.toHaveBeenCalled();
  });
});
