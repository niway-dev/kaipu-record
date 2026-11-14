import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import { ScreenshotEditor, ScreenshotEditorPage } from "./screenshot-editor-page";

// Inspect mode (NIW2-699) is behind `image-inspect`; image-canvas is the other latch it must
// work with. Each test picks its sides.
const flags = { "image-inspect": false, "image-canvas": false };
const reportError = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/features/analytics")>()),
  reportError,
}));
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: keyof typeof flags) => flags[name] ?? false,
}));

vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene: vi.fn(async () => new ArrayBuffer(1)),
  clearExportCache: vi.fn(),
}));

// The decoders need a real canvas and ImageBitmap: the page test replaces them.
const decodeSrgbBuffer = vi.hoisted(() => vi.fn());
const probeCaptured = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/inspect/pixel-buffer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/features/screenshots/inspect/pixel-buffer")>()),
  decodeSrgbBuffer,
  probeCaptured,
}));

const originalRect = Element.prototype.getBoundingClientRect;
const bytes = new Uint8Array([1, 2, 3]).buffer;
const PASTE: ImageSource = { kind: "blob", bytes, width: 4, height: 4, origin: "paste" };

/** 4x4 image whose pixel (x, y) is (50x, 50y, 100). */
function fourByFour() {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) data.set([50 * x, 50 * y, 100, 255], (y * 4 + x) * 4);
  }
  return { width: 4, height: 4, data };
}
// The pointer used below sits over image pixel (3, 1): (150, 50, 100).
const POINTER = { clientX: 150, clientY: 50 };
const PIXEL_HEX = "#963264";

const writeText = vi.fn(async (_text: string) => {});

// jsdom has no canvas: a fake 2D context that records what the loupe draws.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const drawn: Uint8ClampedArray[] = [];
const fakeContext = {
  imageSmoothingEnabled: true,
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: vi.fn((image: { data: Uint8ClampedArray }) => {
    drawn.push(new Uint8ClampedArray(image.data));
  }),
};

beforeEach(async () => {
  reportError.mockClear();
  const base = await window.electronAPI.getSettings();
  window.electronAPI.getSettings = vi.fn(async () => ({
    ...base,
    screenshotCopy: "manual" as const,
  }));
  let urls = 0;
  URL.createObjectURL = vi.fn(() => `blob:shot-${++urls}`);
  URL.revokeObjectURL = vi.fn();
  window.electronAPI.saveScreenshot = vi.fn(async (_png: ArrayBuffer, opts: { title: string }) => ({
    id: "s1",
    assetId: "a-s1",
    title: opts.title,
    kind: "screenshot",
  })) as never;
  decodeSrgbBuffer.mockReset();
  decodeSrgbBuffer.mockImplementation(async () => fourByFour());
  probeCaptured.mockReset();
  probeCaptured.mockImplementation(async () => {
    const raw = new Uint8ClampedArray(4 * 4 * 4);
    const p3 = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      raw.set([1, 2, 3, 255], i * 4);
      p3.set([255, 0, 0, 255], i * 4); // P3 pure red: outside sRGB
    }
    return { sx: 0, sy: 0, sw: 4, sh: 4, raw, p3 };
  });
  writeText.mockClear();
  drawn.length = 0;
  fakeContext.putImageData.mockClear();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => fakeContext) as never;
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  // A 200x200 picture at the origin, so the pointer maps to a known pixel.
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0 }) as DOMRect;
  Element.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  flags["image-inspect"] = false;
  flags["image-canvas"] = false;
  getToasts().forEach((x) => dismissToast(x.id));
  Element.prototype.getBoundingClientRect = originalRect;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  // @ts-expect-error — jsdom has no pointer capture; the tests stub it
  delete Element.prototype.setPointerCapture;
});

function mount(source: ImageSource) {
  const router = createMemoryRouter(
    [
      { path: "/editor/capture", element: <ScreenshotEditorPage /> },
      { path: "/", element: <div>capture</div> },
    ],
    { initialEntries: [{ pathname: "/editor/capture", state: source }] },
  );
  return render(<RouterProvider router={router} />);
}
const PASTE_B: ImageSource = { kind: "blob", bytes, width: 4, height: 4, origin: "paste" };

/** The editor with a button that swaps the open image in place (a new displayUrl, same mount). */
function mountSwappable() {
  function Swappable() {
    const [source, setSource] = useState(PASTE);
    return (
      <>
        <button onClick={() => setSource(PASTE_B)}>swap-image</button>
        <ScreenshotEditor source={source} fresh />
      </>
    );
  }
  const router = createMemoryRouter([{ path: "/", element: <Swappable /> }]);
  return render(<RouterProvider router={router} />);
}
const swapImage = () => fireEvent.click(screen.getByRole("button", { name: "swap-image" }));
const loadImage = async () => fireEvent.load(await screen.findByRole("img"));
const canvasEl = (): HTMLElement =>
  document.querySelector('[data-ui-area="editorImage.canvas"] > div')!;
const inspectButton = () => screen.queryByRole("button", { name: "Inspect (I)" });
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key, ...init });
const layer = () => screen.getByTestId("inspect-layer");

async function enterAndHover(): Promise<void> {
  mount(PASTE);
  await loadImage();
  fireEvent.click(inspectButton()!);
  await screen.findByTestId("inspect-layer");
  fireEvent.pointerMove(layer(), POINTER);
  await screen.findByText(PIXEL_HEX);
}

describe("ScreenshotEditorPage — Inspect (flag off)", () => {
  it("has no Inspect button, ignores the keys and never decodes", async () => {
    mount(PASTE);
    await loadImage();
    expect(inspectButton()).toBeNull();
    press("i");
    press("c");
    press("Escape");
    expect(canvasEl()).not.toHaveAttribute("data-inspect");
    expect(screen.queryByTestId("inspect-layer")).toBeNull();
    expect(decodeSrgbBuffer).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe.each([
  ["image-canvas off", false],
  ["image-canvas on", true],
])("ScreenshotEditorPage — Inspect (flag on, %s)", (_label, canvas) => {
  beforeEach(() => {
    flags["image-inspect"] = true;
    flags["image-canvas"] = canvas;
  });

  it("the button enters, Esc leaves, and the keys do the same", async () => {
    mount(PASTE);
    await loadImage();
    expect(canvasEl()).toHaveAttribute("data-inspect", "false");
    expect(inspectButton()).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(inspectButton()!);
    expect(canvasEl()).toHaveAttribute("data-inspect", "true");
    expect(inspectButton()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Inspect options" })).toBeInTheDocument();

    press("Escape");
    expect(canvasEl()).toHaveAttribute("data-inspect", "false");
    expect(screen.queryByRole("group", { name: "Inspect options" })).toBeNull();

    press("i");
    expect(canvasEl()).toHaveAttribute("data-inspect", "true");
    press("i");
    expect(canvasEl()).toHaveAttribute("data-inspect", "false");
  });

  it("reads the pixels once, the first time Inspect is entered", async () => {
    mount(PASTE);
    await loadImage();
    expect(decodeSrgbBuffer).not.toHaveBeenCalled();
    press("i");
    press("Escape");
    press("i");
    await waitFor(() => expect(decodeSrgbBuffer).toHaveBeenCalledTimes(1));
  });

  it("ignores i typed in the title field", async () => {
    mount(PASTE);
    await loadImage();
    const title = screen.getByRole("textbox");
    fireEvent.keyDown(title, { key: "i" });
    expect(canvasEl()).toHaveAttribute("data-inspect", "false");
  });

  it("shows the loupe and the colour under the pointer", async () => {
    await enterAndHover();
    expect(screen.getByText("3, 1")).toBeInTheDocument();
    const loupe = screen.getByTestId("inspect-loupe");
    expect(loupe).toHaveAttribute("data-smoothing", "off");
    expect(loupe).toHaveAttribute("width", "15");
    // Drawn unsmoothed, 15 x 15 pixels, the pixel under the pointer in the middle.
    // The loupe canvas is painted in an effect after the readout renders: wait for it.
    await waitFor(() => expect(drawn.length).toBeGreaterThan(0));
    expect(fakeContext.imageSmoothingEnabled).toBe(false);
    const last = drawn[drawn.length - 1];
    expect(last).toHaveLength(15 * 15 * 4);
    const centre = (7 * 15 + 7) * 4;
    expect(Array.from(last.slice(centre, centre + 4))).toEqual([150, 50, 100, 255]);
    expect(document.querySelector('[data-ui-area="editorImage.inspectHud"]')).not.toBeNull();
  });

  it("hides the HUD when the pointer leaves", async () => {
    await enterAndHover();
    fireEvent.pointerLeave(layer());
    await waitFor(() => expect(screen.queryByText(PIXEL_HEX)).toBeNull());
  });

  it("C copies the shown colour, and the format switch changes what is copied", async () => {
    await enterAndHover();
    press("c");
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(PIXEL_HEX));
    expect(await screen.findByText("Copied")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "RGB" }));
    await screen.findByText("rgb(150, 50, 100)");
    press("C");
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("rgb(150, 50, 100)"));

    fireEvent.click(screen.getByRole("button", { name: "OKLCH" }));
    press("c");
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
    expect(writeText.mock.lastCall?.[0]).toMatch(/^oklch\(\d\.\d{3} \d\.\d{3} \d+\.\d\)$/);
  });

  it("the Copy button does what C does", async () => {
    await enterAndHover();
    fireEvent.click(screen.getByRole("button", { name: "Copy color" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PIXEL_HEX));
  });

  it("Cmd+C keeps its own meaning and copies nothing", async () => {
    await enterAndHover();
    press("c", { metaKey: true });
    press("c", { ctrlKey: true });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("C copies nothing before the pointer is over a pixel", async () => {
    mount(PASTE);
    await loadImage();
    press("i");
    press("c");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("As captured copies the raw bytes and offers only hex and rgb", async () => {
    await enterAndHover();
    expect(await screen.findByText("Out of sRGB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OKLCH" }));
    fireEvent.click(screen.getByRole("button", { name: "As captured" }));
    expect(screen.getByRole("button", { name: "HSL" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "OKLCH" })).toBeDisabled();
    // oklch falls back to the rgb form for raw bytes
    await screen.findByText("rgb(1, 2, 3)");
    press("c");
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("rgb(1, 2, 3)"));
    fireEvent.click(screen.getByRole("button", { name: "HEX" }));
    press("c");
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("#010203"));
  });

  it("says why As captured shows nothing when its decode fails, and retries on the next entry", async () => {
    probeCaptured.mockRejectedValueOnce(new Error("no p3 canvas"));
    await enterAndHover();
    fireEvent.click(screen.getByRole("button", { name: "As captured" }));
    expect(
      await screen.findByText('"As captured" is unavailable for this image'),
    ).toBeInTheDocument();
    press("Escape");
    press("i");
    await screen.findByTestId("inspect-layer");
    fireEvent.pointerMove(layer(), POINTER);
    await screen.findByText("#010203");
    expect(screen.queryByText('"As captured" is unavailable for this image')).toBeNull();
  });

  it("says so when the pixels cannot be read", async () => {
    decodeSrgbBuffer.mockRejectedValue(new Error("no canvas"));
    mount(PASTE);
    await loadImage();
    press("i");
    expect(await screen.findAllByText("Pixel reading unavailable")).not.toHaveLength(0);
    // Inspect stays usable (Esc still leaves) even though nothing can be read
    press("Escape");
    expect(canvasEl()).toHaveAttribute("data-inspect", "false");
  });

  it("decodes the new image when the old image's decode fails after the swap", async () => {
    let rejectOld: (error: Error) => void = () => {};
    decodeSrgbBuffer.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectOld = reject)),
    );
    mountSwappable();
    await loadImage();
    press("i");
    await waitFor(() => expect(decodeSrgbBuffer).toHaveBeenCalledTimes(1));
    swapImage();
    rejectOld(new Error("old decode failed"));
    await waitFor(() => expect(decodeSrgbBuffer).toHaveBeenCalledTimes(2));
    await screen.findByTestId("inspect-layer");
    fireEvent.pointerMove(layer(), POINTER);
    await screen.findByText(PIXEL_HEX);
    expect(screen.queryByText("Pixel reading unavailable")).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("does not carry a failed As captured probe over to the next image", async () => {
    probeCaptured.mockRejectedValueOnce(new Error("no p3 canvas"));
    mountSwappable();
    await loadImage();
    press("i");
    await screen.findByTestId("inspect-layer");
    fireEvent.pointerMove(layer(), POINTER);
    await screen.findByText(PIXEL_HEX);
    fireEvent.click(screen.getByRole("button", { name: "As captured" }));
    await screen.findByText('"As captured" is unavailable for this image');
    swapImage();
    await waitFor(() =>
      expect(screen.queryByText('"As captured" is unavailable for this image')).toBeNull(),
    );
    // The new image is probed again: its raw bytes show up under the still pointer.
    expect(await screen.findByText("#010203")).toBeInTheDocument();
  });

  /** Hold the first probe pending across a swap; `settle` finishes it afterwards. */
  async function swapDuringProbe() {
    let settle: { resolve: (tile: unknown) => void; reject: (e: Error) => void } = {
      resolve: () => {},
      reject: () => {},
    };
    const first = probeCaptured.getMockImplementation()!;
    probeCaptured.mockImplementationOnce(
      () => new Promise((resolve, reject) => (settle = { resolve, reject })),
    );
    mountSwappable();
    await loadImage();
    press("i");
    await screen.findByTestId("inspect-layer");
    fireEvent.pointerMove(layer(), POINTER);
    await screen.findByText(PIXEL_HEX);
    await waitFor(() => expect(probeCaptured).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "As captured" }));
    swapImage();
    return { settle, tile: await first() };
  }

  it("drops a probe tile of the old image that resolves after the swap", async () => {
    const { settle, tile } = await swapDuringProbe();
    // The old tile would say rgb(9, 9, 9) and "Out of sRGB"; the new image's own tile says 1, 2, 3.
    tile.raw.fill(9);
    settle.resolve(tile);
    expect(await screen.findByText("#010203")).toBeInTheDocument();
    expect(screen.queryByText("#090909")).toBeNull();
  });

  it("drops a probe failure of the old image that arrives after the swap", async () => {
    const { settle } = await swapDuringProbe();
    settle.reject(new Error("old probe failed"));
    expect(await screen.findByText("#010203")).toBeInTheDocument();
    expect(screen.queryByText('"As captured" is unavailable for this image')).toBeNull();
  });

  it("re-reads the pixel when the image moves under a still pointer", async () => {
    await enterAndHover();
    expect(screen.getByText("3, 1")).toBeInTheDocument();
    // Let the probe finish first: its own re-flush would otherwise hide a missing watcher.
    await screen.findByText("Out of sRGB");
    // Zoomed or panned: the picture is now 400 px wide, the pointer did not move.
    Element.prototype.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 400,
        height: 400,
        right: 400,
        bottom: 400,
        x: 0,
        y: 0,
      }) as DOMRect;
    expect(await screen.findByText("1, 0")).toBeInTheDocument();
    press("c");
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("#320064"));
  });

  it("the Copy button still copies the last pixel after the pointer left for the bar", async () => {
    await enterAndHover();
    fireEvent.pointerLeave(layer());
    await waitFor(() => expect(screen.queryByText(PIXEL_HEX)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Copy color" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(PIXEL_HEX));

    fireEvent.click(screen.getByRole("button", { name: "RGB" }));
    // The label reads "Copied" for a moment after the first copy.
    fireEvent.click(screen.getByRole("button", { name: /^(Copy color|Copied)$/ }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("rgb(150, 50, 100)"));
    // C keeps meaning "what the chip shows": nothing, with the pointer off the image.
    writeText.mockClear();
    press("c");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("reports a colour copy the clipboard refuses", async () => {
    await enterAndHover();
    writeText.mockRejectedValueOnce(new Error("clipboard denied"));
    press("c");
    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith(
        "Couldn't copy the color to the clipboard.",
        expect.any(Error),
        expect.anything(),
      ),
    );
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("drops the old image's readout as soon as the image changes", async () => {
    mountSwappable();
    await loadImage();
    press("i");
    await screen.findByTestId("inspect-layer");
    fireEvent.pointerMove(layer(), POINTER);
    await screen.findByText(PIXEL_HEX);
    // Hold the new image's decode so only the reset can clear the chip.
    decodeSrgbBuffer.mockImplementationOnce(() => new Promise(() => {}));
    swapImage();
    await waitFor(() => expect(screen.queryByText(PIXEL_HEX)).toBeNull());
    writeText.mockClear();
    press("c");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("entering Inspect does not stop the wheel from reaching the canvas", async () => {
    mount(PASTE);
    await loadImage();
    press("i");
    const wheel = vi.fn();
    canvasEl().addEventListener("wheel", wheel);
    fireEvent.wheel(layer(), { deltaX: 10, deltaY: 40 });
    expect(wheel).toHaveBeenCalledTimes(1);
    if (canvas) await waitFor(() => expect(canvasEl().dataset.panned).toBe("true"));
  });
});

/** 4x4: 8 px #ffffff, 4 px #fafafa (a second white), 4 px #000000. */
function twoWhites() {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let p = 0; p < 16; p++) {
    const v = p < 8 ? 255 : p < 12 ? 250 : 0;
    data.set([v, v, v, 255], p * 4);
  }
  return { width: 4, height: 4, data };
}

/**
 * 8x8 image, every row the same: white, white, a 1 px black border, a 4 px blue fill, the
 * other border. Shown at 200x200, so one image pixel is 25 CSS px.
 */
function buttonImage() {
  const row = [
    [255, 255, 255, 255],
    [255, 255, 255, 255],
    [0, 0, 0, 255],
    [40, 90, 200, 255],
    [40, 90, 200, 255],
    [40, 90, 200, 255],
    [40, 90, 200, 255],
    [0, 0, 0, 255],
  ];
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 0; y < 8; y++) row.forEach((px, x) => data.set(px, (y * 8 + x) * 4));
  return { width: 8, height: 8, data };
}
// Over pixel (4, 2): inside the blue fill.
const FILL = { clientX: 4 * 25 + 12, clientY: 2 * 25 + 12 };
const rulerLength = () => screen.queryByTestId("inspect-ruler-length");

describe.each([
  ["image-canvas off", false],
  ["image-canvas on", true],
])("ScreenshotEditorPage — Inspect colors panel (%s)", (_label, canvas) => {
  beforeEach(() => {
    flags["image-inspect"] = true;
    flags["image-canvas"] = canvas;
    decodeSrgbBuffer.mockImplementation(async () => twoWhites());
  });

  // The Inspect controls (format, Colors, ...) are the Tool tab's content, and Colors is a tab of
  // its own, so a test that reaches for a control while the list is open goes through the Tool tab.
  const showTool = () => fireEvent.click(screen.getByRole("tab", { name: "Tool" }));
  const colorsButton = () => screen.getByRole("button", { name: "Colors" });
  const panel = () => document.querySelector('[data-ui-area="editorImage.inspectColors"]');
  const overlay = () => screen.queryByTestId("inspect-locate");

  async function openPanel(): Promise<void> {
    mount(PASTE);
    await loadImage();
    press("i");
    fireEvent.click(colorsButton());
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "list"));
  }

  it("says the colors are unavailable when Inspect could not read the pixels", async () => {
    decodeSrgbBuffer.mockRejectedValue(new Error("no canvas"));
    mount(PASTE);
    await loadImage();
    press("i");
    fireEvent.click(colorsButton());
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "error"));
    expect(panel()).toHaveTextContent("Colors unavailable for this image");
  });

  it("offers the exact value when the group's minor values add up to a notable share", async () => {
    // 190 px #ffffff and 10 near-whites of 1 px each: every near-white is too minor to list
    // (0.5%), but together they are 5% of the group, so the exact #ffffff chip is offered.
    const near = [
      [255, 255, 254],
      [255, 254, 255],
      [254, 255, 255],
      [254, 254, 255],
      [254, 255, 254],
      [255, 254, 254],
      [254, 254, 254],
      [253, 255, 255],
      [255, 253, 255],
      [255, 255, 253],
    ];
    const data = new Uint8ClampedArray(200 * 4);
    for (let p = 0; p < 200; p++) data.set([...(near[p] ?? [255, 255, 255]), 255], p * 4);
    decodeSrgbBuffer.mockImplementation(async () => ({ width: 200, height: 1, data }));
    mount(PASTE);
    await loadImage();
    press("i");
    fireEvent.click(colorsButton());
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "list"));
    expect(screen.queryByTitle("Highlight only #fefefe")).toBeNull();
    fireEvent.click(screen.getByTitle("Highlight only #ffffff"));
    await waitFor(() => expect(overlay()).toHaveAttribute("data-matched", "190"));
  });

  it("offers no exact chip when the group's other values are a trace", async () => {
    // 199 px #ffffff and 1 px #fefefe (0.5%): the group and #ffffff highlight nearly the same.
    const data = new Uint8ClampedArray(200 * 4);
    for (let p = 0; p < 200; p++)
      data.set(p === 0 ? [254, 254, 254, 255] : [255, 255, 255, 255], p * 4);
    decodeSrgbBuffer.mockImplementation(async () => ({ width: 200, height: 1, data }));
    mount(PASTE);
    await loadImage();
    press("i");
    fireEvent.click(colorsButton());
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "list"));
    expect(
      screen.getByTitle("Highlight #ffffff and the values grouped with it"),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("Highlight only #ffffff")).toBeNull();
  });

  it("lists the colors with their share and the two whites side by side", async () => {
    await openPanel();
    expect(screen.getByRole("tab", { name: "Colors" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("2 colors · 3 exact values")).toBeInTheDocument();
    const white = screen.getByTitle("Highlight #ffffff and the values grouped with it");
    expect(white).toHaveTextContent("#ffffff75.0%");
    expect(screen.getByTitle("Highlight only #ffffff")).toHaveTextContent("#ffffff50.0%");
    expect(screen.getByTitle("Highlight only #fafafa")).toHaveTextContent("#fafafa25.0%");
    expect(screen.getByTitle("Highlight #000000 and the values grouped with it")).toHaveTextContent(
      "#00000025.0%",
    );
    // One decode serves the loupe and the panel.
    expect(decodeSrgbBuffer).toHaveBeenCalledTimes(1);
  });

  it("shows the values in the Inspect bar's format", async () => {
    await openPanel();
    showTool();
    fireEvent.click(screen.getByRole("button", { name: "RGB" }));
    fireEvent.click(screen.getByRole("tab", { name: "Colors" }));
    expect(screen.getByTitle("Highlight only rgb(250, 250, 250)")).toBeInTheDocument();
  });

  it("clicking a color highlights it, clicking it again clears it", async () => {
    await openPanel();
    const second = screen.getByTitle("Highlight only #fafafa");
    fireEvent.click(second);
    await waitFor(() => expect(overlay()).toHaveAttribute("data-matched", "4"));
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(panel()).toHaveAttribute("data-state", "located");
    expect(screen.getByText("4 pixels highlighted")).toBeInTheDocument();
    // The overlay sits in the frame's overlay slot, over the image.
    expect(overlay()!.parentElement).toContainElement(screen.getByRole("img"));

    fireEvent.click(screen.getByTitle("Highlight #ffffff and the values grouped with it"));
    await waitFor(() => expect(overlay()).toHaveAttribute("data-matched", "12"));

    fireEvent.click(screen.getByTitle("Highlight #ffffff and the values grouped with it"));
    expect(overlay()).toBeNull();
    expect(panel()).toHaveAttribute("data-state", "list");
  });

  it("Clear highlight and closing the panel remove the highlight", async () => {
    await openPanel();
    fireEvent.click(screen.getByTitle("Highlight only #fafafa"));
    await waitFor(() => expect(overlay()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Clear highlight" }));
    expect(overlay()).toBeNull();

    fireEvent.click(screen.getByTitle("Highlight only #fafafa"));
    await waitFor(() => expect(overlay()).not.toBeNull());
    showTool();
    fireEvent.click(colorsButton());
    expect(panel()).toBeNull();
    expect(overlay()).toBeNull();
  });

  it("leaving Inspect closes the panel and drops the highlight", async () => {
    await openPanel();
    fireEvent.click(screen.getByTitle("Highlight only #fafafa"));
    await waitFor(() => expect(overlay()).not.toBeNull());
    press("Escape");
    expect(panel()).toBeNull();
    expect(overlay()).toBeNull();
    press("i");
    expect(screen.getByRole("button", { name: "Colors" })).toHaveAttribute("aria-pressed", "false");
  });

  it("counts the new image after a swap", async () => {
    decodeSrgbBuffer.mockImplementationOnce(async () => twoWhites());
    decodeSrgbBuffer.mockImplementationOnce(async () => fourByFour());
    mountSwappable();
    await loadImage();
    press("i");
    fireEvent.click(colorsButton());
    await screen.findByText("2 colors · 3 exact values");
    fireEvent.click(screen.getByTitle("Highlight only #fafafa"));
    await waitFor(() => expect(overlay()).not.toBeNull());
    swapImage();
    // fourByFour: 16 exact values; the darkest neighbours fall into shared groups.
    await screen.findByText("14 colors · 16 exact values");
    expect(overlay()).toBeNull();
  });
});

describe.each([
  ["image-canvas off", false],
  ["image-canvas on", true],
])("ScreenshotEditorPage — Inspect ruler (%s)", (_label, canvas) => {
  beforeEach(() => {
    flags["image-inspect"] = true;
    flags["image-canvas"] = canvas;
    decodeSrgbBuffer.mockImplementation(async () => buttonImage());
  });

  async function enterOverFill(): Promise<void> {
    mount(PASTE);
    await loadImage();
    press("i");
    await screen.findByTestId("inspect-layer");
    fireEvent.pointerMove(layer(), FILL);
    await screen.findByText("4, 2");
  }

  it("1 shows the horizontal run, 2 the vertical one, and the same key again hides it", async () => {
    await enterOverFill();
    expect(rulerLength()).toBeNull();
    press("1");
    await waitFor(() => expect(rulerLength()).toHaveTextContent("4 px"));
    expect(rulerLength()).toHaveAttribute("data-axis", "x");
    press("2");
    await waitFor(() => expect(rulerLength()).toHaveTextContent("8 px"));
    expect(rulerLength()).toHaveAttribute("data-axis", "y");
    press("2");
    await waitFor(() => expect(rulerLength()).toBeNull());
  });

  it("the bar's Horizontal and Vertical buttons do what 1 and 2 do", async () => {
    await enterOverFill();
    fireEvent.click(screen.getByRole("button", { name: "Horizontal" }));
    await waitFor(() => expect(rulerLength()).toHaveTextContent("4 px"));
    fireEvent.click(screen.getByRole("button", { name: "Vertical" }));
    await waitFor(() => expect(rulerLength()).toHaveTextContent("8 px"));
  });

  it("keeps the length in image pixels when the view is zoomed", async () => {
    await enterOverFill();
    press("1");
    await waitFor(() => expect(rulerLength()).toHaveTextContent("4 px"));
    // Off the image first, so the run on screen afterwards can only come from a new scan.
    fireEvent.pointerMove(layer(), { clientX: 260, clientY: 50 });
    await waitFor(() => expect(rulerLength()).toBeNull());
    // Twice as large on screen: the same pixel (4, 2) is now under (225, 125).
    Element.prototype.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 400,
        height: 400,
        right: 400,
        bottom: 400,
        x: 0,
        y: 0,
      }) as DOMRect;
    fireEvent.pointerMove(layer(), { clientX: 4 * 50 + 25, clientY: 2 * 50 + 25 });
    await waitFor(() => expect(rulerLength()).toHaveTextContent("4 px"));
    expect(screen.getByText("4, 2")).toBeInTheDocument();
  });

  it("Shift and the Outer toggle measure past the border", async () => {
    await enterOverFill();
    press("1");
    await waitFor(() => expect(rulerLength()).toHaveTextContent("4 px"));
    press("Shift");
    await waitFor(() => expect(rulerLength()).toHaveTextContent("6 px"));
    expect(rulerLength()).toHaveAttribute("data-outer", "true");
    fireEvent.keyUp(window, { key: "Shift" });
    await waitFor(() => expect(rulerLength()).toHaveTextContent("4 px"));
    fireEvent.click(screen.getByRole("button", { name: "Outer" }));
    await waitFor(() => expect(rulerLength()).toHaveTextContent("6 px"));
  });

  it("the wheel changes the tolerance while a run is shown, and does not pan", async () => {
    await enterOverFill();
    press("1");
    await waitFor(() => expect(rulerLength()).toBeInTheDocument());
    const wheel = vi.fn();
    canvasEl().addEventListener("wheel", wheel);
    fireEvent.wheel(layer(), { deltaY: -25 });
    await waitFor(() => expect(screen.getByTestId("inspect-tolerance")).toHaveTextContent("11"));
    fireEvent.wheel(layer(), { deltaY: 50 });
    await waitFor(() => expect(screen.getByTestId("inspect-tolerance")).toHaveTextContent("9"));
    expect(wheel).not.toHaveBeenCalled();
    if (canvas) expect(canvasEl().dataset.panned).toBe("false");
    // Cmd + wheel keeps zooming: it reaches the canvas and the view actually zooms in.
    expect(canvasEl()).toHaveAttribute("data-zoomed", "false");
    fireEvent.wheel(layer(), { deltaY: -25, metaKey: true });
    expect(wheel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(canvasEl()).toHaveAttribute("data-zoomed", "true"));
  });

  it("a high tolerance joins the fill and the border", async () => {
    await enterOverFill();
    press("1");
    await waitFor(() => expect(rulerLength()).toHaveTextContent("4 px"));
    const up = screen.getByRole("button", { name: "Raise the tolerance" });
    for (let i = 0; i < 190; i++) fireEvent.click(up);
    await waitFor(() => expect(rulerLength()).toHaveTextContent("6 px"));
  });

  it("shows no run over padding or empty canvas", async () => {
    await enterOverFill();
    press("1");
    await waitFor(() => expect(rulerLength()).toBeInTheDocument());
    fireEvent.pointerMove(layer(), { clientX: 260, clientY: 50 });
    await waitFor(() => expect(rulerLength()).toBeNull());
  });

  it("ignores 1 and 2 typed in the title field", async () => {
    await enterOverFill();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "1" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "2" });
    expect(layer()).toHaveAttribute("data-ruler", "off");
  });

  it("a click pins the run as a measure annotation in image pixels", async () => {
    await enterOverFill();
    press("1");
    await waitFor(() => expect(rulerLength()).toHaveTextContent("4 px"));
    fireEvent.pointerDown(layer(), { ...FILL, button: 0, pointerId: 1 });
    fireEvent.pointerUp(layer(), { ...FILL, button: 0, pointerId: 1 });
    const pinned = await waitFor(() => {
      const el = document.querySelector('[data-kind="measure"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(pinned).toHaveAttribute("data-measure-length", "4");
    // Inspect stays on, so the next run can be measured.
    expect(canvasEl()).toHaveAttribute("data-inspect", "true");
  });

  it("a drag is not a click and pins nothing", async () => {
    await enterOverFill();
    press("1");
    await waitFor(() => expect(rulerLength()).toBeInTheDocument());
    fireEvent.pointerDown(layer(), { ...FILL, button: 0, pointerId: 1 });
    fireEvent.pointerUp(layer(), {
      clientX: FILL.clientX + 30,
      clientY: FILL.clientY,
      button: 0,
      pointerId: 1,
    });
    expect(document.querySelector('[data-kind="measure"]')).toBeNull();
  });

  it("a click with no run shown pins nothing", async () => {
    await enterOverFill();
    fireEvent.pointerDown(layer(), { ...FILL, button: 0, pointerId: 1 });
    fireEvent.pointerUp(layer(), { ...FILL, button: 0, pointerId: 1 });
    expect(document.querySelector('[data-kind="measure"]')).toBeNull();
  });
});

/** 20x10: #ffffff everywhere except two 5x4 cards of #fdfdfd (20 px each, so two areas). */
function twoCards() {
  const data = new Uint8ClampedArray(20 * 10 * 4);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 20; x++) {
      const card = y >= 1 && y < 5 && ((x >= 1 && x < 6) || (x >= 12 && x < 17));
      const v = card ? 253 : 255;
      data.set([v, v, v, 255], (y * 20 + x) * 4);
    }
  }
  return { width: 20, height: 10, data };
}

/** 64x32 pixels, every one a different color: a photograph by the panel's count. */
function photoLike() {
  const data = new Uint8ClampedArray(64 * 32 * 4);
  for (let p = 0; p < 64 * 32; p++) {
    data.set([p % 256, Math.floor(p / 256) * 30, 100 + (p % 5), 255], p * 4);
  }
  return { width: 64, height: 32, data };
}

describe.each([
  ["image-canvas off", false],
  ["image-canvas on", true],
])("ScreenshotEditorPage — Colors tab of the side panel (%s)", (_label, canvas) => {
  beforeEach(() => {
    flags["image-inspect"] = true;
    flags["image-canvas"] = canvas;
    decodeSrgbBuffer.mockImplementation(async () => twoCards());
  });

  const tab = (name: string) => screen.getByRole("tab", { name });
  const panel = () => document.querySelector('[data-ui-area="editorImage.inspectColors"]');
  const overlay = () => screen.queryByTestId("inspect-locate");

  async function openColors(): Promise<void> {
    mount(PASTE);
    await loadImage();
    press("i");
    fireEvent.click(screen.getByRole("button", { name: "Colors" }));
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "list"));
  }

  it("shows the tab strip with Beautify selected, and no heading of its own", async () => {
    mount(PASTE);
    await loadImage();
    expect(screen.getByRole("tablist", { name: "Side panel" })).toBeInTheDocument();
    expect(tab("Beautify")).toHaveAttribute("aria-selected", "true");
    expect(tab("Colors")).toHaveAttribute("aria-selected", "false");
    // The tab names the panel: one "Beautify" on screen, not a tab plus a heading.
    expect(screen.getAllByText("Beautify")).toHaveLength(1);
    expect(screen.getByRole("tabpanel")).toContainElement(
      document.querySelector('[data-ui-area="editorImage.beautify"]') as HTMLElement,
    );
  });

  it("has no tab strip where Inspect does not exist", async () => {
    flags["image-inspect"] = false;
    mount(PASTE);
    await loadImage();
    // Tool and Beautify stay (the tool options live in the panel); Colors needs Inspect.
    expect(screen.getByRole("tablist", { name: "Side panel" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Colors" })).toBeNull();
    expect(tab("Tool")).toBeInTheDocument();
    expect(tab("Beautify")).toHaveAttribute("aria-selected", "true");
  });

  it("the Colors tab in Annotate turns Inspect on and opens the panel", async () => {
    mount(PASTE);
    await loadImage();
    expect(canvasEl()).toHaveAttribute("data-inspect", "false");
    fireEvent.click(tab("Colors"));
    expect(canvasEl()).toHaveAttribute("data-inspect", "true");
    expect(tab("Colors")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "list"));
    expect(screen.getByRole("tabpanel")).toContainElement(panel() as HTMLElement);
    // Nothing floats over the stage any more.
    expect(panel()!.closest('[data-ui-area="editorImage.canvas"]')).toBeNull();
  });

  it("entering Inspect shows the Tool tab, its Colors button selects the Colors tab, and Beautify closes it", async () => {
    mount(PASTE);
    await loadImage();
    press("i");
    expect(tab("Tool")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Colors" }));
    expect(tab("Colors")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tab("Beautify"));
    expect(tab("Beautify")).toHaveAttribute("aria-selected", "true");
    expect(panel()).toBeNull();
    // Inspect stays on: only the panel closed. Its controls wait in the Tool tab.
    expect(canvasEl()).toHaveAttribute("data-inspect", "true");
    fireEvent.click(tab("Tool"));
    expect(screen.getByRole("button", { name: "Colors" })).toHaveAttribute("aria-pressed", "false");
  });

  it("leaving Inspect returns to Beautify", async () => {
    await openColors();
    press("Escape");
    expect(tab("Beautify")).toHaveAttribute("aria-selected", "true");
  });

  it("Group is on by default: near-identical values sit in a box with their distance", async () => {
    await openColors();
    expect(screen.getByRole("switch", { name: "Group" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Almost the same")).toBeInTheDocument();
    expect(screen.getByText(/^ΔE \d/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show both/ })).toHaveAttribute(
      "title",
      "Highlight #ffffff and the values grouped with it",
    );
    expect(screen.getByTitle("Highlight only #fdfdfd")).toBeInTheDocument();
    expect(screen.getByText(/1 set of colors is nearly identical/)).toBeInTheDocument();
  });

  it("Group off lists every exact value as its own row, and Group on brings the boxes back", async () => {
    await openColors();
    fireEvent.click(screen.getByRole("switch", { name: "Group" }));
    expect(screen.getByRole("switch", { name: "Group" })).toHaveAttribute("aria-checked", "false");
    expect(panel()).toHaveAttribute("data-grouped", "false");
    expect(screen.queryByText("Almost the same")).toBeNull();
    expect(screen.queryByTitle(/and the values grouped with it/)).toBeNull();
    expect(screen.getByTitle("Highlight only #ffffff")).toHaveTextContent("#ffffff");
    expect(screen.getByTitle("Highlight only #fdfdfd")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Highlight only #fdfdfd"));
    await waitFor(() => expect(overlay()).toHaveAttribute("data-matched", "40"));

    // Switching lists drops a highlight the other list may not have.
    fireEvent.click(screen.getByRole("switch", { name: "Group" }));
    expect(overlay()).toBeNull();
    expect(screen.getByText("Almost the same")).toBeInTheDocument();
  });

  it("keeps Group off after a visit to the Tool tab", async () => {
    await openColors();
    fireEvent.click(screen.getByRole("switch", { name: "Group" }));
    fireEvent.click(tab("Tool"));
    fireEvent.click(tab("Colors"));
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "list"));
    expect(screen.getByRole("switch", { name: "Group" })).toHaveAttribute("aria-checked", "false");
    expect(panel()).toHaveAttribute("data-grouped", "false");
  });

  it("highlighting a color tags its largest area on the image and tells how to stop", async () => {
    await openColors();
    fireEvent.click(screen.getByTitle("Highlight only #fdfdfd"));
    await waitFor(() => expect(overlay()).toHaveAttribute("data-matched", "40"));
    const tag = await screen.findByTestId("inspect-locate-tag");
    expect(tag).toHaveTextContent("#fdfdfd · 2 areas · 20.0% of the image");
    // A sibling of the highlight, so it is placed over the same image.
    expect(tag.parentElement).toBe(overlay()!.parentElement);
    expect(screen.getByTitle("Highlight only #fdfdfd")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Click the color again to stop highlighting.")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Highlight only #fdfdfd"));
    expect(screen.queryByTestId("inspect-locate-tag")).toBeNull();
  });

  it("copy puts the value in the Inspect format on the clipboard, shows Copied and a toast", async () => {
    await openColors();
    fireEvent.click(tab("Tool"));
    fireEvent.click(screen.getByRole("button", { name: "RGB" }));
    fireEvent.click(tab("Colors"));
    fireEvent.click(screen.getByRole("button", { name: "Copy rgb(253, 253, 253)" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("rgb(253, 253, 253)"));
    await waitFor(() =>
      expect(screen.getByTitle("Highlight only rgb(253, 253, 253)")).toHaveTextContent("Copied"),
    );
    // The row's share is replaced for a moment, not the other rows'.
    expect(screen.getByTitle("Highlight only rgb(253, 253, 253)")).not.toHaveTextContent("%");
    expect(screen.getByTitle("Highlight only rgb(255, 255, 255)")).not.toHaveTextContent("Copied");
    expect(getToasts().map((x) => x.message)).toContain("Copied rgb(253, 253, 253)");
  });

  it("the Copied mark goes away after a moment", async () => {
    await openColors();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Copy #fdfdfd" }));
      await vi.waitFor(() =>
        expect(screen.getByTitle("Highlight only #fdfdfd")).toHaveTextContent("Copied"),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(screen.getByTitle("Highlight only #fdfdfd")).not.toHaveTextContent("Copied");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed copy says so and does not show Copied", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    await openColors();
    fireEvent.click(screen.getByRole("button", { name: "Copy #fdfdfd" }));
    await waitFor(() => expect(reportError).toHaveBeenCalled());
    expect(screen.getByTitle("Highlight only #fdfdfd")).not.toHaveTextContent("Copied");
    expect(getToasts()).toEqual([]);
  });

  it("reads the colors with a progress view while Inspect is still decoding", async () => {
    decodeSrgbBuffer.mockImplementation(() => new Promise(() => {}));
    mount(PASTE);
    await loadImage();
    press("i");
    fireEvent.click(screen.getByRole("button", { name: "Colors" }));
    expect(panel()).toHaveTextContent("Reading colors…");
    expect(panel()).not.toHaveTextContent("%");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("lists a photograph by the groups that cover most of it, with Other last and a card", async () => {
    decodeSrgbBuffer.mockImplementation(async () => photoLike());
    mount(PASTE);
    await loadImage();
    press("i");
    fireEvent.click(screen.getByRole("button", { name: "Colors" }));
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "photo"));
    expect(screen.getByText("This looks like a photo")).toBeInTheDocument();
    expect(panel()).toHaveTextContent("2,048 colors. Showing the");
    expect(panel()).toHaveTextContent("groups that cover 80% of the image");
    // Group has no meaning for a photo, and its rows are groups.
    expect(screen.queryByRole("switch")).toBeNull();
    const items = Array.from(panel()!.querySelectorAll("ul > li"));
    const other = items[items.length - 1] as HTMLElement;
    expect(other).toHaveTextContent("Other");
    expect(other.querySelector("button")).toBeNull();
  });
});
