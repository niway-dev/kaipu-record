import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import type { RecognizedWord } from "@shared/types/text-recognition";
import { redactionRectsInPixels } from "@renderer/features/screenshots/text-selection";
import { ScreenshotEditorPage } from "./screenshot-editor-page";

import type { Annotation } from "@renderer/features/screenshots/annotations/scene";

// One-click hide of recognized text (NIW2-706): `image-text` with `image-canvas`, the mode in
// which a redaction replaces the pixels. Each test picks its flags.
let flags: Record<string, boolean> = {};
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => flags[name] ?? false,
}));

const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene,
  clearExportCache: vi.fn(),
}));

// jsdom has no createImageBitmap or canvas: baking is the identity, and the test reads what
// it was asked to bake. Canvas mode bakes through bakeCanvasRedactions, which calls
// bakeRedactions inside its own module, so the mock replaces the canvas entry point.
const bakeCanvasRedactions = vi.hoisted(() =>
  vi.fn(async (base: ArrayBuffer, assets: Record<string, ArrayBuffer>, _annotations: unknown) => ({
    base,
    assets,
  })),
);
vi.mock("@renderer/features/screenshots/annotations/redaction", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@renderer/features/screenshots/annotations/redaction")
  >()),
  bakeCanvasRedactions,
}));

const originalRect = Element.prototype.getBoundingClientRect;

// A 400×400 image shown at 200×200: a word's display box is half its pixel box.
const PASTE: ImageSource = {
  kind: "blob",
  bytes: new Uint8Array([1, 2, 3]).buffer,
  width: 400,
  height: 400,
  origin: "paste",
};

const word = (text: string, line: number, x: number, y: number, w: number): RecognizedWord => ({
  text,
  line,
  rect: { x, y, w, h: 20 },
  confidence: 0.9,
});
// Pixel boxes; the display boxes are half of these. The lines are 40 px apart.
const HELLO = word("Hello", 0, 40, 40, 80); // display x 20-60, y 20-30
const WORLD = word("world", 0, 140, 40, 80); // display x 70-110, y 20-30
const SECOND = word("second", 1, 40, 100, 100); // display x 20-70, y 50-60
const LINE = word("line", 1, 160, 100, 60); // display x 80-110, y 50-60
const WORDS = [HELLO, WORLD, SECOND, LINE];
// The first line's box (40,40)-(220,60) px grown by a quarter of its height (5 px).
const FIRST_LINE_REDACTION = { x: 35, y: 35, w: 190, h: 30 };

const recognize = vi.fn();
const saveScreenshot = vi.fn();

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
  bakeCanvasRedactions.mockClear();
  recognize.mockReset();
  recognize.mockResolvedValue({ status: "ready", words: WORDS });
  saveScreenshot.mockReset();
  saveScreenshot.mockImplementation(async (_png: ArrayBuffer, opts: { title: string }) => ({
    id: "s1",
    assetId: "a-s1",
    title: opts.title,
    kind: "screenshot",
  }));
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
const loadImage = async () => fireEvent.load(await screen.findByRole("img"));
// The tool is "Redact" in canvas mode and "Blur" before it.
const pickRedact = () =>
  fireEvent.click(screen.getByRole("button", { name: flags["image-canvas"] ? "Redact" : "Blur" }));
const hideLayer = (): HTMLElement | null =>
  document.querySelector('[data-ui-area="editorImage.textHide"]');
const READY_HINT = "Click a line of text to hide it, or drag over a region.";
/** Open the redact tool once recognition has produced words. */
async function openRedact(): Promise<void> {
  await loadImage();
  pickRedact();
  await screen.findByText(READY_HINT);
}
const at = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, button: 0 });
const click = (el: Element, x: number, y: number): void => {
  fireEvent.pointerDown(el, at(x, y));
  fireEvent.pointerUp(el, at(x, y));
};
const dragOn = (el: Element, from: [number, number], to: [number, number]): void => {
  fireEvent.pointerDown(el, at(...from));
  fireEvent.pointerMove(el, at(...to));
  fireEvent.pointerUp(el, at(...to));
};
const shapes = (): Element[] => [...document.querySelectorAll("[data-annotation]")];
const sentMeta = () =>
  saveScreenshot.mock.calls.at(-1)![1] as {
    text?: { assets: { assetId: string; words: RecognizedWord[] }[] };
  };
/** The redactions the last save baked into the stored image. */
const baked = (): Annotation[] =>
  (bakeCanvasRedactions.mock.calls.at(-1)?.[2] ?? []) as Annotation[];
const save = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveScreenshot).toHaveBeenCalled());
};
/** The pixels a stored redaction covers, rounded the way the save bakes it. */
const bakedPixels = (a: Annotation) => redactionRectsInPixels([a], { w: 400, h: 400 });

describe("text hide — one click", () => {
  it("hovering a line outlines the redaction a click would make", async () => {
    mountPaste();
    await openRedact();
    // (40, 25) display = the gap-free middle of "Hello", line 0.
    fireEvent.pointerMove(hideLayer()!, at(40, 25));
    const target = screen.getByTestId("text-target").querySelector("rect")!;
    expect(target.getAttribute("x")).toBe("17.5");
    expect(target.getAttribute("y")).toBe("17.5");
    expect(target.getAttribute("width")).toBe("95");
    expect(target.getAttribute("height")).toBe("15");
    fireEvent.pointerLeave(hideLayer()!);
    expect(screen.queryByTestId("text-target")).toBeNull();
  });

  it("leaving the tool and coming back, with the pointer still, outlines nothing", async () => {
    mountPaste();
    await openRedact();
    fireEvent.pointerMove(hideLayer()!, at(40, 25));
    expect(screen.getByTestId("text-target")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Box" }));
    pickRedact();
    expect(screen.queryByTestId("text-target")).toBeNull();
  });

  it("a click on a line hides that line only: one redaction over its box plus the margin", async () => {
    mountPaste();
    await openRedact();
    // Between "Hello" and "world" is still the line.
    click(hideLayer()!, 65, 25);
    expect(shapes()).toHaveLength(1);
    await save();
    expect(baked()).toHaveLength(1);
    expect(bakedPixels(baked()[0])).toEqual([FIRST_LINE_REDACTION]);
    expect(baked()[0]).not.toHaveProperty("style");
  });

  it("a click that jitters a few pixels still hides the line, not a tiny region", async () => {
    mountPaste();
    await openRedact();
    // 4 px each way: inside the 6 px click tolerance, yet more than 1% of this 200 px layer.
    dragOn(hideLayer()!, [40, 25], [44, 29]);
    expect(shapes()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    await save();
    expect(bakedPixels(baked()[0])).toEqual([FIRST_LINE_REDACTION]);
  });

  it("after the save, the text cache has no word of the hidden line and every other word", async () => {
    mountPaste();
    await openRedact();
    click(hideLayer()!, 40, 25);
    await save();
    expect(sentMeta().text).toEqual({ assets: [{ assetId: "base", words: [SECOND, LINE] }] });
  });

  it("the tool stays on with nothing selected, so the next line is one more click", async () => {
    mountPaste();
    await openRedact();
    click(hideLayer()!, 40, 25);
    // The hidden line is no longer a target: hovering it outlines nothing.
    fireEvent.pointerMove(hideLayer()!, at(40, 25));
    expect(screen.queryByTestId("text-target")).toBeNull();
    click(hideLayer()!, 40, 55);
    expect(shapes()).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    await save();
    expect(sentMeta().text).toEqual({ assets: [{ assetId: "base", words: [] }] });
  });

  it("takes the style chosen in the tool", async () => {
    mountPaste();
    await openRedact();
    fireEvent.click(screen.getByRole("button", { name: "Solid" }));
    click(hideLayer()!, 40, 25);
    await save();
    expect(baked()[0]).toMatchObject({ kind: "blur", style: "solid" });
  });

  it("a click a few pixels off the line still hides it; one far from text hides nothing", async () => {
    mountPaste();
    await openRedact();
    click(hideLayer()!, 150, 150);
    expect(shapes()).toHaveLength(0);
    // 4 display px right of "world" (which ends at x 110).
    click(hideLayer()!, 114, 25);
    expect(shapes()).toHaveLength(1);
  });

  it("a press that wanders off the line and comes back hides nothing", async () => {
    mountPaste();
    await openRedact();
    const el = hideLayer()!;
    fireEvent.pointerDown(el, at(40, 25));
    fireEvent.pointerMove(el, at(90, 26));
    fireEvent.pointerMove(el, at(41, 25));
    fireEvent.pointerUp(el, at(41, 25));
    expect(shapes()).toHaveLength(0);
  });

  it("a drag that starts on text still draws the region dragged, and selects it", async () => {
    mountPaste();
    await openRedact();
    dragOn(hideLayer()!, [40, 25], [150, 150]);
    expect(shapes()).toHaveLength(1);
    // Like any drawn shape, it is selected on release (its Delete button shows).
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    await save();
    expect(bakedPixels(baked()[0])).toEqual([{ x: 80, y: 50, w: 220, h: 250 }]);
  });
});

describe("text hide — without text", () => {
  it("pending: the hint says it is recognizing, and dragging a region works", async () => {
    recognize.mockReturnValue(new Promise(() => {}));
    mountPaste();
    await loadImage();
    pickRedact();
    expect(
      await screen.findByText("Recognizing text… Drag over what to hide meanwhile."),
    ).toBeInTheDocument();
    dragOn(hideLayer()!, [10, 15], [120, 35]);
    expect(shapes()).toHaveLength(1);
  });

  it("unavailable: no hint, a click hides nothing, and dragging a region still works", async () => {
    recognize.mockResolvedValue({ status: "unavailable" });
    mountPaste();
    await loadImage();
    pickRedact();
    await waitFor(() => expect(recognize).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("Recognizing text… Drag over what to hide meanwhile.")).toBeNull(),
    );
    expect(screen.queryByText(READY_HINT)).toBeNull();
    click(hideLayer()!, 40, 25);
    expect(shapes()).toHaveLength(0);
    dragOn(hideLayer()!, [10, 15], [120, 35]);
    expect(shapes()).toHaveLength(1);
  });

  it("the classic editor (no canvas) offers no text targets: its blur is not a redaction", async () => {
    flags = { "image-text": true };
    mountPaste();
    await loadImage();
    pickRedact();
    await waitFor(() => expect(recognize).toHaveBeenCalled());
    expect(hideLayer()).toBeNull();
    expect(screen.queryByText(READY_HINT)).toBeNull();
  });

  it("flag off: no hint and no targets", async () => {
    flags = { "image-canvas": true };
    mountPaste();
    await loadImage();
    pickRedact();
    expect(hideLayer()).toBeNull();
    expect(screen.queryByText(READY_HINT)).toBeNull();
  });
});
