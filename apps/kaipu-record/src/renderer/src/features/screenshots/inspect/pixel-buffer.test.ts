import { describe, expect, it } from "vitest";
import { p3ToSrgb } from "./color";
import {
  assetClientRect,
  clientToBasePixel,
  clientToImagePixel,
  isPointVisible,
  loupePixels,
  readProbe,
  sampleAt,
  visiblePixelWindow,
  type PixelBuffer,
  type ProbeTile,
} from "./pixel-buffer";

/** 3x2 image: pixel (x, y) has r = 10x, g = 10y, b = 5, a = 255. */
function buffer(): PixelBuffer {
  const width = 3;
  const height = 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([10 * x, 10 * y, 5, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

describe("sampleAt", () => {
  it("reads inside the image and returns null outside it", () => {
    const buf = buffer();
    expect(sampleAt(buf, 2, 1)).toEqual({ r: 20, g: 10, b: 5, a: 255 });
    expect(sampleAt(buf, -1, 0)).toBeNull();
    expect(sampleAt(buf, 0, -1)).toBeNull();
    expect(sampleAt(buf, 3, 0)).toBeNull();
    expect(sampleAt(buf, 0, 2)).toBeNull();
  });
});

describe("loupePixels", () => {
  it("is (2r+1)^2 RGBA pixels with the centre in the middle", () => {
    const out = loupePixels(buffer(), 1, 1, 2);
    expect(out).toHaveLength(5 * 5 * 4);
    const centre = (2 * 5 + 2) * 4;
    expect(Array.from(out.slice(centre, centre + 4))).toEqual([10, 10, 5, 255]);
  });

  it("leaves pixels outside the image fully transparent", () => {
    const out = loupePixels(buffer(), 0, 0, 1); // 3x3 around the top-left corner
    const px = (col: number, row: number) =>
      Array.from(out.slice((row * 3 + col) * 4, (row * 3 + col) * 4 + 4));
    expect(px(0, 0)).toEqual([0, 0, 0, 0]); // (-1,-1)
    expect(px(1, 0)).toEqual([0, 0, 0, 0]); // (0,-1)
    expect(px(0, 1)).toEqual([0, 0, 0, 0]); // (-1,0)
    expect(px(1, 1)).toEqual([0, 0, 5, 255]); // centre (0,0)
    expect(px(2, 1)).toEqual([10, 0, 5, 255]); // (1,0)
  });
});

describe("clientToImagePixel", () => {
  const img = { width: 100, height: 50 };

  it("maps the displayed rect to image pixels with floor", () => {
    const rect = { left: 10, top: 20, width: 100, height: 50 };
    expect(clientToImagePixel(10, 20, rect, img)).toEqual({ x: 0, y: 0 });
    expect(clientToImagePixel(59.9, 44.9, rect, img)).toEqual({ x: 49, y: 24 });
    expect(clientToImagePixel(109.9, 69.9, rect, img)).toEqual({ x: 99, y: 49 });
  });

  it("returns the same image pixel for the same point of the picture at any zoom", () => {
    const at1 = { left: 0, top: 0, width: 100, height: 50 };
    const at2 = { left: 30, top: -10, width: 200, height: 100 }; // zoomed 2x and panned
    const atHalf = { left: 5, top: 5, width: 50, height: 25 };
    // The centre of the picture, in each rect's own coordinates.
    const centre = (r: typeof at1) =>
      clientToImagePixel(r.left + r.width / 2, r.top + r.height / 2, r, img);
    expect(centre(at1)).toEqual({ x: 50, y: 25 });
    expect(centre(at2)).toEqual({ x: 50, y: 25 });
    expect(centre(atHalf)).toEqual({ x: 50, y: 25 });
  });

  it("is null outside the rect, including its far edge", () => {
    const rect = { left: 0, top: 0, width: 100, height: 50 };
    expect(clientToImagePixel(-1, 10, rect, img)).toBeNull();
    expect(clientToImagePixel(10, -1, rect, img)).toBeNull();
    expect(clientToImagePixel(100, 10, rect, img)).toBeNull();
    expect(clientToImagePixel(10, 50, rect, img)).toBeNull();
    expect(clientToImagePixel(10, 10, { ...rect, width: 0 }, img)).toBeNull();
  });
});

describe("readProbe", () => {
  // A 2x2 tile whose top-left is image pixel (5, 7); its second pixel is P3 pure red.
  const tile: ProbeTile = {
    sx: 5,
    sy: 7,
    sw: 2,
    sh: 2,
    raw: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]),
    p3: new Uint8ClampedArray([
      255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ]),
  };

  it("returns the raw bytes and the gamut verdict of a pixel inside the tile", () => {
    expect(p3ToSrgb([255, 0, 0]).outOfGamut).toBe(true);
    expect(readProbe(tile, 5, 7)).toEqual({ raw: { r: 1, g: 2, b: 3, a: 255 }, outOfGamut: false });
    expect(readProbe(tile, 6, 7)).toEqual({ raw: { r: 4, g: 5, b: 6, a: 255 }, outOfGamut: true });
    expect(readProbe(tile, 5, 8)?.raw).toEqual({ r: 7, g: 8, b: 9, a: 255 });
  });

  it("is null outside the tile", () => {
    expect(readProbe(tile, 4, 7)).toBeNull();
    expect(readProbe(tile, 7, 7)).toBeNull();
    expect(readProbe(tile, 5, 9)).toBeNull();
    expect(readProbe(tile, 5, 6)).toBeNull();
  });
});

describe("isPointVisible", () => {
  const rect = (left: number, top: number, w: number, h: number): DOMRect =>
    ({ left, top, right: left + w, bottom: top + h, width: w, height: h }) as DOMRect;

  it("is false outside a clipping ancestor (a classic crop window) and true inside it", () => {
    const clip = document.createElement("div");
    clip.style.overflow = "hidden";
    clip.getBoundingClientRect = () => rect(100, 100, 50, 50);
    const img = document.createElement("img");
    clip.appendChild(img);
    document.body.appendChild(clip);
    expect(isPointVisible(img, 120, 120)).toBe(true);
    expect(isPointVisible(img, 160, 120)).toBe(false);
    clip.remove();
  });

  it("ignores ancestors that do not clip", () => {
    const wrap = document.createElement("div");
    wrap.getBoundingClientRect = () => rect(0, 0, 10, 10);
    const img = document.createElement("img");
    wrap.appendChild(img);
    document.body.appendChild(wrap);
    expect(isPointVisible(img, 500, 500)).toBe(true);
    wrap.remove();
  });
});

describe("the base's view in Inspect", () => {
  // Illustrative: the invisible anchor is the asset at scale 1, 100 x 100 px at the origin;
  // the decoded asset is 400 x 400 px.
  const anchor = { left: 0, top: 0, width: 100, height: 100 };
  const buf = { width: 400, height: 400 };

  it("an untouched base maps through the anchor, as before", () => {
    expect(assetClientRect(anchor, {})).toEqual(anchor);
    expect(clientToBasePixel(50, 25, anchor, buf, {})).toEqual({ x: 200, y: 100 });
  });

  it("a base enlarged to scale 2 reads the right and bottom halves too", () => {
    const view = { basePlacement: { x: 0, y: 0, scale: 2 } };
    expect(assetClientRect(anchor, view)).toEqual({ left: 0, top: 0, width: 200, height: 200 });
    // 150 px is three quarters across the 200 px wide enlarged base: source pixel 300.
    expect(clientToBasePixel(150, 150, anchor, buf, view)).toEqual({ x: 300, y: 300 });
    expect(clientToBasePixel(250, 10, anchor, buf, view)).toBeNull();
    // The old mapping, through the anchor alone, found nothing there.
    expect(clientToImagePixel(150, 150, anchor, buf)).toBeNull();
  });

  it("a moved base maps from where the whole asset sits", () => {
    const view = { basePlacement: { x: 0.5, y: 0, scale: 1 } };
    expect(clientToBasePixel(75, 50, anchor, buf, view)).toEqual({ x: 100, y: 200 });
    expect(clientToBasePixel(25, 50, anchor, buf, view)).toBeNull();
  });

  it("a cropped base returns no pixel outside the window", () => {
    // The right half shows; the whole asset is still the anchor's rect.
    const view = { baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 } };
    expect(clientToBasePixel(20, 50, anchor, buf, view)).toBeNull(); // hidden, source x 80
    expect(clientToBasePixel(70, 50, anchor, buf, view)).toEqual({ x: 280, y: 200 });
  });

  it("a scaled and cropped base uses both", () => {
    const view = {
      baseCrop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      basePlacement: { x: 0, y: 0, scale: 2 },
    };
    // The window is the lower-right quarter of the 200 px asset: client 100..200.
    expect(clientToBasePixel(50, 150, anchor, buf, view)).toBeNull();
    expect(clientToBasePixel(150, 150, anchor, buf, view)).toEqual({ x: 300, y: 300 });
  });
});

describe("the visible pixel window of a cropped base (NIW2-876, AC2)", () => {
  /** 10x4 image: pixel (x, y) is opaque with r = x, g = y. */
  function wide(): PixelBuffer {
    const width = 10;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) data.set([x, y, 0, 255], (y * width + x) * 4);
    }
    return { width, height, data };
  }

  it("is the crop window in whole asset pixels, and the whole image without a crop", () => {
    const buf = wide();
    expect(visiblePixelWindow(buf, { x: 0.2, y: 0.25, w: 0.5, h: 0.5 })).toEqual({
      x0: 2,
      y0: 1,
      x1: 7,
      y1: 3,
    });
    expect(visiblePixelWindow(buf)).toEqual({ x0: 0, y0: 0, x1: 10, y1: 4 });
  });

  it("does not move an edge that float noise puts a hair past a pixel boundary", () => {
    // 0.1 * 30 is 3.0000000000000004: the window must still start at pixel 3, not 4.
    const buf = { width: 30, height: 1, data: new Uint8ClampedArray(120) };
    expect(visiblePixelWindow(buf, { x: 0.1, y: 0, w: 0.5, h: 1 })).toMatchObject({
      x0: 3,
      x1: 18,
    });
  });

  it("a partly visible pixel counts at both edges, so a pointer on its sliver reads it", () => {
    // 10 px wide, crop 2.4 .. 7.4: pixel 2 shows 60% and pixel 7 shows 40%.
    const buf = wide();
    const crop = { x: 0.24, y: 0, w: 0.5, h: 1 };
    expect(visiblePixelWindow(buf, crop)).toMatchObject({ x0: 2, x1: 8 });
    const anchor = { left: 0, top: 0, width: 100, height: 40 };
    // Display x 26 is on the visible sliver of pixel 2 (it starts at 24).
    expect(clientToBasePixel(26, 5, anchor, buf, { baseCrop: crop })).toEqual({ x: 2, y: 0 });
    expect(clientToBasePixel(15, 5, anchor, buf, { baseCrop: crop })).toBeNull();
  });

  it("sampleAt reads nothing outside the window", () => {
    const buf = wide();
    const win = visiblePixelWindow(buf, { x: 0.2, y: 0, w: 0.5, h: 1 });
    expect(sampleAt(buf, 2, 0, win)).toEqual({ r: 2, g: 0, b: 0, a: 255 });
    expect(sampleAt(buf, 1, 0, win)).toBeNull();
    expect(sampleAt(buf, 7, 0, win)).toBeNull();
  });

  it("the loupe leaves cropped-out pixels transparent", () => {
    const buf = wide();
    const win = visiblePixelWindow(buf, { x: 0.2, y: 0, w: 0.5, h: 1 }); // pixels 2..6
    // Radius 1 around (2, 1): the column x = 1 is cropped out, x = 2 and 3 show.
    const out = loupePixels(buf, 2, 1, 1, win);
    const at = (col: number, row: number): number[] =>
      Array.from(out.slice((row * 3 + col) * 4, (row * 3 + col) * 4 + 4));
    expect(at(0, 1)).toEqual([0, 0, 0, 0]);
    expect(at(1, 1)).toEqual([2, 1, 0, 255]);
    expect(at(2, 1)).toEqual([3, 1, 0, 255]);
  });

  it("clientToBasePixel and the window agree on which pixels show", () => {
    const buf = wide();
    const crop = { x: 0.2, y: 0, w: 0.5, h: 1 };
    const win = visiblePixelWindow(buf, crop);
    const anchor = { left: 0, top: 0, width: 100, height: 40 };
    for (let x = 0; x < 10; x++) {
      const hit = clientToBasePixel(x * 10 + 5, 5, anchor, buf, { baseCrop: crop });
      expect(hit !== null).toBe(x >= win.x0 && x < win.x1);
    }
  });

  it("clientToBasePixel pins the crop edges with hard-coded hits and misses", () => {
    const buf = wide(); // 10 px wide, 4 px tall, 10 client px per source pixel
    const anchor = { left: 0, top: 0, width: 100, height: 40 };
    const crop = { x: 0.2, y: 0, w: 0.5, h: 1 }; // pixels 2..6 show
    const at = (clientX: number) => clientToBasePixel(clientX, 5, anchor, buf, { baseCrop: crop });
    expect(at(19)).toBeNull(); // last pixel before the window (x = 1)
    expect(at(20)).toEqual({ x: 2, y: 0 }); // first visible pixel
    expect(at(69)).toEqual({ x: 6, y: 0 }); // last visible pixel
    expect(at(70)).toBeNull(); // first pixel after the window (x = 7)
  });
});
