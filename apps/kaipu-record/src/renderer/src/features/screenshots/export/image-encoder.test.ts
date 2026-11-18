import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeImage } from "./image-encoder";
import { planExport, settingsForPreset, type ImageExportSettings } from "./image-export-settings";

const drawImage = vi.fn();
const fillRect = vi.fn();
const toBlob = vi.fn();
const close = vi.fn();
let fillOrder: string[] = [];

/** jsdom has no canvas or decoder: both are stubbed, so these tests pin what the encoder asks for. */
beforeEach(() => {
  fillOrder = [];
  drawImage.mockImplementation(() => fillOrder.push("draw"));
  fillRect.mockImplementation(() => fillOrder.push("fill"));
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 100, height: 50, close })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage, fillRect, fillStyle: "" }) as unknown as CanvasRenderingContext2D,
  );
  toBlob.mockImplementation((cb: (b: Blob | null) => void, type: string) =>
    cb(new Blob([new Uint8Array([1, 2, 3])], { type })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(toBlob);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  drawImage.mockReset();
  fillRect.mockReset();
  toBlob.mockReset();
  close.mockReset();
});

const png = new Uint8Array([9, 9, 9]).buffer;
const plan = (settings: ImageExportSettings) => planExport(100, 50, settings);

describe("encodeImage", () => {
  it("asks the canvas for the plan's type and quality at the plan's size", async () => {
    const out = await encodeImage(png, plan(settingsForPreset("web")));
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.8);
    expect(out.width).toBe(100);
    expect(out.height).toBe(50);
    expect(out.bytes.byteLength).toBe(3);
    expect(close).toHaveBeenCalled();
  });

  it("paints white under a JPEG before drawing the image", async () => {
    await encodeImage(png, plan(settingsForPreset("small")));
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.7);
    expect(fillOrder).toEqual(["fill", "draw"]);
  });

  it("does not paint under WebP, which keeps its alpha", async () => {
    await encodeImage(png, plan(settingsForPreset("web")));
    expect(fillOrder).toEqual(["draw"]);
  });

  it("hands back Save's own PNG when nothing changes", async () => {
    const out = await encodeImage(png, plan(settingsForPreset("original")));
    expect(out.bytes).toBe(png);
    expect(toBlob).not.toHaveBeenCalled();
  });

  it("re-encodes a PNG that has to change size, without a quality argument", async () => {
    await encodeImage(png, plan({ ...settingsForPreset("original"), scale: 0.5 }));
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", undefined);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 50, 25);
  });

  it("refuses a file the canvas encoded as something else", async () => {
    // Chromium answers an encoder it lacks (AVIF) with a PNG, not an error.
    toBlob.mockImplementation((cb: (b: Blob | null) => void) =>
      cb(new Blob([new Uint8Array([1])], { type: "image/png" })),
    );
    await expect(encodeImage(png, plan(settingsForPreset("web")))).rejects.toThrow(
      /asked for image\/webp, got image\/png/,
    );
    expect(close).toHaveBeenCalled();
  });

  it("fails when the canvas returns nothing", async () => {
    toBlob.mockImplementation((cb: (b: Blob | null) => void) => cb(null));
    await expect(encodeImage(png, plan(settingsForPreset("small")))).rejects.toThrow(/toBlob/);
  });
});
