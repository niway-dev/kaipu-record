import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import type { RecognizedWord } from "@shared/types/text-recognition";
import type { CanvasReadResult } from "@shared/types/screenshot-canvas";
import { ScreenshotEditor, ScreenshotEditorPage } from "./screenshot-editor-page";

// Text recognition (NIW2-705) is behind `image-text`; each test picks its flags.
let flags: Record<string, boolean> = {};
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => flags[name] ?? false,
}));

const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene,
  clearExportCache: vi.fn(),
}));

// jsdom has no createImageBitmap or canvas: baking is the identity here.
vi.mock("@renderer/features/screenshots/annotations/redaction", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@renderer/features/screenshots/annotations/redaction")
  >()),
  bakeRedactions: vi.fn(async (bytes: ArrayBuffer) => bytes),
  // Canvas saves bake through this one since M6 (NIW2-703): the base and each added asset.
  bakeCanvasRedactions: vi.fn(async (base: ArrayBuffer, assets: Record<string, ArrayBuffer>) => ({
    base,
    assets,
  })),
}));

const originalRect = Element.prototype.getBoundingClientRect;

const flatBytes = new Uint8Array([1, 2, 3]).buffer;
const assetBytes = new Uint8Array([9, 9, 9, 9]).buffer;
// A 400×400 image shown at 200×200: a word's display box is half its pixel box.
const PASTE: ImageSource = {
  kind: "blob",
  bytes: flatBytes,
  width: 400,
  height: 400,
  origin: "paste",
};
const LOCAL: ImageSource = { kind: "local", id: "shot-1", assetId: "a-shot-1", title: "Shot" };

const word = (text: string, line: number, x: number, y: number, w: number): RecognizedWord => ({
  text,
  line,
  rect: { x, y, w, h: 20 },
  confidence: 0.9,
});
// Pixel boxes; the display boxes are half of these.
const HELLO = word("Hello", 0, 40, 40, 80); // display x 20-60, y 20-30
const WORLD = word("world", 0, 140, 40, 80); // display x 70-110, y 20-30
const SECOND = word("second", 1, 40, 100, 100); // display x 20-70, y 50-60
const LINE = word("line", 1, 160, 100, 60); // display x 80-110, y 50-60
const WORDS = [HELLO, WORLD, SECOND, LINE];

const recognize = vi.fn();
const saveScreenshot = vi.fn();
const writeText = vi.fn(async () => {});

beforeEach(async () => {
  flags = { "image-text": true, "image-canvas": true };
  const base = await window.electronAPI.getSettings();
  window.electronAPI.getSettings = vi.fn(async () => ({
    ...base,
    screenshotCopy: "manual" as const,
  }));
  URL.createObjectURL = vi.fn(() => "blob:shot");
  URL.revokeObjectURL = vi.fn();
  exportScene.mockReset();
  exportScene.mockResolvedValue(new ArrayBuffer(1));
  recognize.mockReset();
  recognize.mockResolvedValue({ status: "ready", words: WORDS });
  saveScreenshot.mockReset();
  saveScreenshot.mockImplementation(async (_png: ArrayBuffer, opts: { title: string }) => ({
    id: "s1",
    assetId: "a-s1",
    title: opts.title,
    kind: "screenshot",
  }));
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  window.electronAPI.recognizeScreenshotText = recognize as never;
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
  flags = {};
  getToasts().forEach((x) => dismissToast(x.id));
  // @ts-expect-error — drop the stubs
  delete HTMLElement.prototype.clientWidth;
  // @ts-expect-error — see above
  delete HTMLElement.prototype.clientHeight;
  Element.prototype.getBoundingClientRect = originalRect;
  // @ts-expect-error — jsdom has no pointer capture; the tests stub it
  delete Element.prototype.setPointerCapture;
});

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
const loadImage = async () => fireEvent.load(await screen.findByRole("img"));
const pickText = () => fireEvent.click(screen.getByRole("button", { name: "Select text" }));
const textLayer = (): HTMLElement =>
  document.querySelector('[data-ui-area="editorImage.textSelection"]')!;
const highlights = (): string[] =>
  [...document.querySelectorAll('[data-testid="text-highlight"]')].map(
    (r) => `${r.getAttribute("x")},${r.getAttribute("y")}`,
  );
/** Wait until recognition has produced `n` words and the tool is on. */
async function openToolWith(n: number): Promise<void> {
  await loadImage();
  pickText();
  await screen.findByText(`${n} words found`);
}
const drag = (from: [number, number], to: [number, number]) => {
  const layer = textLayer();
  fireEvent.pointerDown(layer, { clientX: from[0], clientY: from[1], pointerId: 1 });
  fireEvent.pointerMove(layer, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(layer, { pointerId: 1 });
};
/** Draw a redaction over display px (10,15)-(120,35): it covers the first line. */
function redactFirstLine(): void {
  fireEvent.click(screen.getByRole("button", { name: "Redact" }));
  const surface = screen.getByTestId("canvas-hit-surface");
  fireEvent.pointerDown(surface, { button: 0, clientX: 10, clientY: 15, pointerId: 1 });
  fireEvent.pointerMove(surface, { clientX: 120, clientY: 35, pointerId: 1 });
  fireEvent.pointerUp(surface, { pointerId: 1 });
}
const sentMeta = () =>
  saveScreenshot.mock.calls.at(-1)![1] as {
    text?: { assets: { assetId: string; words: RecognizedWord[] }[] };
    canvas?: unknown;
  };
const save = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveScreenshot).toHaveBeenCalled());
};

describe("text recognition — flag", () => {
  it("flag off: no tool and no recognition call", async () => {
    flags = { "image-canvas": true };
    mountPaste();
    await loadImage();
    expect(screen.queryByRole("button", { name: "Select text" })).toBeNull();
    expect(recognize).not.toHaveBeenCalled();
  });

  it("flag on: one call with the bytes the editor loaded, and no saved id yet", async () => {
    mountPaste();
    await loadImage();
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    expect(recognize).toHaveBeenCalledWith({ id: null, assetId: "base", png: flatBytes });
    expect(screen.getByRole("button", { name: "Select text" })).toBeEnabled();
  });

  it("a first save does not recognize again just because the id appeared", async () => {
    mountPaste();
    await loadImage();
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    await save();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recognize).toHaveBeenCalledTimes(1);
  });

  it("a reopened document is recognized as its base asset, by the saved id", async () => {
    window.electronAPI.readScreenshotCanvas = vi.fn(async () => ({
      docJson: JSON.stringify({
        schemaVersion: 1,
        items: [
          {
            id: "image-base",
            kind: "image",
            assetId: "base",
            x: 0,
            y: 0,
            w: 400,
            h: 400,
            pixelWidth: 400,
            pixelHeight: 400,
          },
        ],
        frame: { bg: "none", padding: 0, radius: 0, shadow: 0 },
      }),
      assets: { base: assetBytes },
    })) as never as (id: string) => Promise<CanvasReadResult>;
    mountLocal();
    await loadImage();
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    expect(recognize).toHaveBeenCalledWith({ id: "shot-1", assetId: "base", png: assetBytes });
  });
});

describe("text recognition — options bar", () => {
  it("pending: says it is recognizing, and the tool stays usable", async () => {
    recognize.mockReturnValue(new Promise(() => {}));
    mountPaste();
    await loadImage();
    pickText();
    expect(await screen.findByText("Recognizing text…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select text" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Box" })).toBeEnabled();
  });

  it("unavailable", async () => {
    recognize.mockResolvedValue({ status: "unavailable" });
    mountPaste();
    await loadImage();
    pickText();
    expect(await screen.findByText("Text recognition is not available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy text" })).toBeNull();
    expect(screen.getByRole("button", { name: "Select text" })).toBeEnabled();
  });

  it("unavailable: picking the tool again retries once; ready is never re-requested", async () => {
    // The open-time call and the first pick's retry both fail; the second pick succeeds.
    recognize.mockResolvedValueOnce({ status: "unavailable" });
    recognize.mockResolvedValueOnce({ status: "unavailable" });
    recognize.mockResolvedValueOnce({ status: "ready", words: [] });
    mountPaste();
    await loadImage();
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    pickText();
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Text recognition is not available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Box" }));
    pickText();
    expect(await screen.findByText("No text found")).toBeInTheDocument();
    expect(recognize).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Box" }));
    pickText();
    expect(await screen.findByText("No text found")).toBeInTheDocument();
    expect(recognize).toHaveBeenCalledTimes(3);
  });

  it("a call that rejects reads as unavailable", async () => {
    recognize.mockRejectedValue(new Error("ipc"));
    mountPaste();
    await loadImage();
    pickText();
    expect(await screen.findByText("Text recognition is not available")).toBeInTheDocument();
  });

  it("ready with no words", async () => {
    recognize.mockResolvedValue({ status: "ready", words: [] });
    mountPaste();
    await loadImage();
    pickText();
    expect(await screen.findByText("No text found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy text" })).toBeNull();
  });

  it("ready with words: the count, Select all and a Copy text that waits for a selection", async () => {
    mountPaste();
    await openToolWith(4);
    expect(screen.getByRole("button", { name: "Select all" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy text" })).toBeDisabled();
  });
});

describe("text recognition — selecting and copying", () => {
  it("dragging selects the words in reading order between the two ends", async () => {
    mountPaste();
    await openToolWith(4);
    // From inside "Hello" down to inside "second": Hello, world, second.
    drag([40, 25], [45, 55]);
    expect(highlights()).toEqual(["20,20", "70,20", "20,50"]);
    expect(screen.getByRole("button", { name: "Copy text" })).toBeEnabled();
  });

  it("dragging backwards selects the same range", async () => {
    mountPaste();
    await openToolWith(4);
    drag([45, 55], [40, 25]);
    expect(highlights()).toEqual(["20,20", "70,20", "20,50"]);
  });

  it("a press a few pixels off a word still starts on it; empty space clears", async () => {
    mountPaste();
    await openToolWith(4);
    drag([64, 25], [64, 25]); // 4 px right of "Hello" (ends at 60)
    expect(highlights()).toEqual(["20,20"]);
    fireEvent.pointerDown(textLayer(), { clientX: 150, clientY: 150, pointerId: 1 });
    expect(highlights()).toEqual([]);
  });

  it("Cmd+C copies the selected text as text, not the image", async () => {
    mountPaste();
    await openToolWith(4);
    drag([40, 25], [45, 55]);
    fireEvent.keyDown(window, { key: "c", metaKey: true });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Hello world\nsecond"));
    expect(window.electronAPI.copyImageToClipboard).not.toHaveBeenCalled();
    expect(exportScene).not.toHaveBeenCalled();
    expect(getToasts().map((x) => x.message)).toContain("Text copied");
  });

  it("Cmd+C with nothing selected does nothing", async () => {
    mountPaste();
    await openToolWith(4);
    fireEvent.keyDown(window, { key: "c", metaKey: true });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("Cmd+A selects every word and the Copy text button copies them", async () => {
    mountPaste();
    await openToolWith(4);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(highlights()).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Hello world\nsecond line"));
  });

  it("the Select all button selects every word", async () => {
    mountPaste();
    await openToolWith(4);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(highlights()).toHaveLength(4);
  });

  it("leaving the tool drops the selection", async () => {
    mountPaste();
    await openToolWith(4);
    fireEvent.keyDown(window, { key: "a", metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Box" }));
    pickText();
    expect(highlights()).toEqual([]);
  });

  it("the text keys do nothing outside the tool", async () => {
    mountPaste();
    await loadImage();
    await waitFor(() => expect(recognize).toHaveBeenCalled());
    fireEvent.keyDown(window, { key: "a", metaKey: true });
    fireEvent.keyDown(window, { key: "c", metaKey: true });
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("text recognition — redactions", () => {
  it("words under a redaction drawn this session are not selectable", async () => {
    mountPaste();
    await loadImage();
    await waitFor(() => expect(recognize).toHaveBeenCalled());
    redactFirstLine();
    pickText();
    await screen.findByText("2 words found");
    fireEvent.keyDown(window, { key: "a", metaKey: true });
    expect(highlights()).toEqual(["20,50", "80,50"]);
    // A drag from where "Hello" was finds no word to start on.
    fireEvent.pointerDown(textLayer(), { clientX: 40, clientY: 25, pointerId: 1 });
    expect(highlights()).toEqual([]);
  });

  it("a canvas save sends the words no baked redaction touches", async () => {
    mountPaste();
    await loadImage();
    await waitFor(() => expect(recognize).toHaveBeenCalled());
    redactFirstLine();
    await save();
    await waitFor(() => expect(sentMeta().text).toBeDefined());
    expect(sentMeta().text).toEqual({
      assets: [{ assetId: "base", words: [SECOND, LINE] }],
    });
  });

  it("a canvas save with no redaction sends every word", async () => {
    mountPaste();
    await loadImage();
    await waitFor(() => expect(recognize).toHaveBeenCalled());
    await screen.findByRole("button", { name: "Select text" });
    // Let the result land before saving.
    pickText();
    await screen.findByText("4 words found");
    await save();
    expect(sentMeta().text).toEqual({ assets: [{ assetId: "base", words: WORDS }] });
  });
});

describe("text recognition — save payload", () => {
  it("pending: the save sends no text", async () => {
    recognize.mockReturnValue(new Promise(() => {}));
    mountPaste();
    await loadImage();
    await save();
    expect(sentMeta().canvas).toBeDefined();
    expect(sentMeta()).not.toHaveProperty("text");
  });

  it("unavailable: the save sends no text", async () => {
    recognize.mockResolvedValue({ status: "unavailable" });
    mountPaste();
    await loadImage();
    pickText();
    await screen.findByText("Text recognition is not available");
    await save();
    expect(sentMeta()).not.toHaveProperty("text");
  });

  it("without the canvas the save sends no text, even with words ready", async () => {
    flags = { "image-text": true };
    mountPaste();
    await loadImage();
    pickText();
    await screen.findByText("4 words found");
    await save();
    expect(sentMeta()).not.toHaveProperty("canvas");
    expect(sentMeta()).not.toHaveProperty("text");
  });

  it("flag off: the save sends no text", async () => {
    flags = { "image-canvas": true };
    mountPaste();
    await loadImage();
    await save();
    expect(sentMeta()).not.toHaveProperty("text");
  });
});
