import { describe, expect, it } from "vitest";
import { buildSvg, frameWindow, type Geom } from "./compositor";
import {
  annotationBounds,
  canvasLayout,
  contentExtents,
  visibleBaseBounds,
  visibleBaseRectPx,
} from "./canvas-geometry";
import { contentBoxFrame } from "../canvas/content-box";
import type { Annotation, Scene } from "./scene";

// Per-image crop, unit 3: the base's crop, scale and corners. The numbers below are illustrative
// (a 1000x600 base), worked out by hand in the comments.

const HREF = "data:image/png;base64,AAAA";
const geom = (over: Partial<Geom> = {}): Geom => ({
  href: HREF,
  naturalW: 1000,
  naturalH: 600,
  pad: 40,
  radius: 12,
  scale: 2,
  extents: { left: 30, top: 0, right: 600, bottom: 20 },
  assets: {},
  ...over,
});
const scene = (
  annotations: Annotation[],
  extra: Partial<Scene> = {},
  bg = "none",
  shadow = 0,
): Scene => ({
  beautify: { bg, padding: 20, radius: 6, shadow } as Scene["beautify"],
  annotations,
  ...extra,
});
const blur: Annotation = { id: "z", kind: "blur", x: 0.2, y: 0.1, w: 0.2, h: 0.2 };
const box: Annotation = {
  id: "b",
  kind: "box",
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  color: "#f00",
  stroke: 1,
  seed: 3,
};
const img: Annotation = {
  id: "a9",
  kind: "image",
  assetId: "img-abc123def456",
  x: 1.1,
  y: 0,
  w: 0.5,
  h: 0.5,
  pixelWidth: 500,
  pixelHeight: 300,
};

describe("a base with no crop, scale or radius draws exactly what it drew before", () => {
  // SVG strings captured from the previous commit (the head of the base-crop's parent branch).
  // blurShadow drops the white fill a "none" background used to paint: since #679 a transparent
  // background stays transparent in the canvas gap.
  const GOLDEN = {
    plain:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1710" height="700" viewBox="0 0 1710 700"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff2d6e"/><stop offset="1" stop-color="#a3044a"/></linearGradient><clipPath id="rc"><rect x="70" y="40" width="1000" height="600" rx="12"/></clipPath><image id="shot" href="data:image/png;base64,AAAA" width="1000" height="600" preserveAspectRatio="none"/></defs><rect width="1710" height="700" rx="20" fill="url(#bg)"/><g clip-path="url(#rc)"><use href="#shot" x="70" y="40"/></g><g transform="translate(70,40)"></g></svg>',
    blurShadow:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1710" height="700" viewBox="0 0 1710 700"><defs><filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="54" stdDeviation="62" flood-color="#000" flood-opacity="0.42"/></filter><clipPath id="rc"><rect x="70" y="40" width="1000" height="600" rx="12"/></clipPath><image id="shot" href="data:image/png;base64,AAAA" width="1000" height="600" preserveAspectRatio="none"/></defs><rect x="70" y="40" width="1000" height="600" rx="12" fill="#000" filter="url(#sh)"/><g clip-path="url(#rc)"><use href="#shot" x="70" y="40"/></g><g transform="translate(70,40)"><defs><clipPath id="bclip-z"><rect x="200" y="60" width="200" height="120"/></clipPath></defs><g clip-path="url(#bclip-z)"><use href="#shot"/></g></g></svg>',
    imageThenBlur:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1710" height="700" viewBox="0 0 1710 700"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#06b6d4"/></linearGradient><filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="27" stdDeviation="35" flood-color="#000" flood-opacity="0.27"/></filter><clipPath id="rc"><rect x="70" y="40" width="1000" height="600" rx="12"/></clipPath><image id="shot" href="data:image/png;base64,AAAA" width="1000" height="600" preserveAspectRatio="none"/><image id="asset-img-abc123def456-500x300" href="data:image/png;base64,BBBB" width="500" height="300" preserveAspectRatio="none"/></defs><rect width="1710" height="700" rx="20" fill="url(#bg)"/><rect x="70" y="40" width="1000" height="600" rx="12" fill="#000" filter="url(#sh)"/><g clip-path="url(#rc)"><use href="#shot" x="70" y="40"/></g><g transform="translate(70,40)"><defs><clipPath id="ic-a9"><rect x="1100" y="0" width="500" height="300" rx="12"/></clipPath></defs><rect x="1100" y="0" width="500" height="300" rx="12" fill="#000" filter="url(#sh)"/><g clip-path="url(#ic-a9)"><use href="#asset-img-abc123def456-500x300" x="1100" y="0"/></g><defs><clipPath id="bclip-z"><rect x="200" y="60" width="200" height="120"/></clipPath></defs><g clip-path="url(#bclip-z)"><use href="#shot"/><defs><clipPath id="ic-a9-under-z"><rect x="1100" y="0" width="500" height="300" rx="12"/></clipPath></defs><g clip-path="url(#ic-a9-under-z)"><use href="#asset-img-abc123def456-500x300" x="1100" y="0"/></g></g></g></svg>',
  };
  const withAssets = geom({ assets: { "img-abc123def456": "data:image/png;base64,BBBB" } });

  it("plain", () => {
    expect(buildSvg(scene([], {}, "magenta", 0), withAssets)).toBe(GOLDEN.plain);
  });
  it("blur and shadow", () => {
    expect(buildSvg(scene([blur], {}, "none", 60), withAssets)).toBe(GOLDEN.blurShadow);
  });
  it("an image under a blur", () => {
    expect(buildSvg(scene([img, blur], {}, "ocean", 30), withAssets)).toBe(GOLDEN.imageThenBlur);
  });
  it("an identity placement and a full-window crop add nothing to the geometry", () => {
    expect(visibleBaseBounds({}, 1000, 600)).toEqual({ x1: 0, y1: 0, x2: 1000, y2: 600 });
    expect(
      visibleBaseBounds(
        { basePlacement: { x: 0, y: 0, scale: 1 }, baseCrop: { x: 0, y: 0, w: 1, h: 1 } },
        1000,
        600,
      ),
    ).toEqual({ x1: 0, y1: 0, x2: 1000, y2: 600 });
  });
});

describe("visibleBaseBounds", () => {
  it("is the crop window of the whole asset, in px from the world origin", () => {
    // Right half of the asset: x 500..1000.
    expect(visibleBaseBounds({ baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 } }, 1000, 600)).toEqual({
      x1: 500,
      y1: 0,
      x2: 1000,
      y2: 600,
    });
  });
  it("follows a resized base: half size with its corner at normalized (1, 0.25)", () => {
    // Whole asset: x 1000..1500, y 150..450. The middle half of it: x 1125..1375, y 225..375.
    expect(
      visibleBaseBounds(
        {
          basePlacement: { x: 1, y: 0.25, scale: 0.5 },
          baseCrop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
        },
        1000,
        600,
      ),
    ).toEqual({ x1: 1125, y1: 225, x2: 1375, y2: 375 });
  });
  it("snaps outward to whole px so the base's edge is never left outside the box", () => {
    const b = visibleBaseBounds({ basePlacement: { x: 0.0004, y: 0, scale: 0.3333 } }, 1000, 600);
    expect(b.x1).toBe(0);
    expect(b.x2).toBe(334); // 0.4 + 333.3 = 333.7 -> 334
    expect(b.y2).toBe(200); // 199.98 -> 200
  });
});

describe("visibleBaseRectPx", () => {
  it("is the visible base in the given px, not snapped: the live view's unit", () => {
    // Illustrative: a 760x456 display of the base, right half, half size at (1, 0.25).
    const b = visibleBaseRectPx(
      { basePlacement: { x: 1, y: 0.25, scale: 0.5 }, baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 } },
      760,
      456,
    );
    expect(b).toEqual({ x1: 760 + 190, y1: 114, x2: 760 + 380, y2: 114 + 228 });
  });
  it("is the whole display for a base that was never cropped or resized", () => {
    expect(visibleBaseRectPx({}, 760, 456)).toEqual({ x1: 0, y1: 0, x2: 760, y2: 456 });
  });
});

describe("content extents follow the visible base", () => {
  const base = { x1: 500, y1: 0, x2: 1000, y2: 600 }; // right half of the asset
  const none = { left: 0, top: 0, right: 0, bottom: 0 };

  it("an annotation over the cropped-out half sticks out to the left of the visible base", () => {
    // The box's own bounds (its stroke included) start at x1; the visible base starts at 500.
    const x1 = annotationBounds(box, 1000, 600, 1, undefined, base)!.x1;
    expect(x1).toBeLessThan(100);
    expect(contentExtents([box], 1000, 600, 1, undefined, base)).toEqual({
      ...none,
      left: Math.ceil(500 - x1),
    });
    // The same box over an uncropped base is inside it: the crop is what made it stick out.
    expect(contentExtents([box], 1000, 600, 1)).toEqual(none);
  });
  it("is never negative when the base is cropped smaller than the content around it", () => {
    const inside: Annotation = { ...box, x: 0.6, y: 0.2, w: 0.1, h: 0.1 };
    expect(contentExtents([inside], 1000, 600, 1, undefined, base)).toEqual(none);
  });
  it("a blur only counts where it covers the visible base, not the cropped-out part", () => {
    // blur x 200..400 lies wholly in the hidden half: no bounds, no extents.
    expect(annotationBounds(blur, 1000, 600, 1, undefined, base)).toBeNull();
    expect(contentExtents([blur], 1000, 600, 1, undefined, base)).toEqual(none);
    // A blur straddling the crop edge is cut to the visible part.
    const edge: Annotation = { ...blur, x: 0.4, w: 0.2 }; // x 400..600
    const cut = annotationBounds(edge, 1000, 600, 1, undefined, base)!;
    expect(cut.x1).toBe(500);
    expect(cut.x2).toBeCloseTo(600, 6);
    expect(cut.y1).toBeCloseTo(60, 6);
    expect(cut.y2).toBeCloseTo(180, 6);
  });
  it("the layout puts the world origin where the whole asset's corner falls", () => {
    // Visible base 500 wide, pad 40, 10 px of extent on the left: the box is 510 wide and the
    // origin sits at 40 + 10 - 500 = -450, so world x 500 lands at frame x 50.
    const l = canvasLayout({
      naturalW: 1000,
      naturalH: 600,
      pad: 40,
      extents: { ...none, left: 10 },
      base,
    });
    expect(l.fullW).toBe(510 + 80);
    expect(l.fullH).toBe(600 + 80);
    expect(l.originX).toBe(-450);
    expect(l.box).toEqual({ x: 40, y: 40, w: 510, h: 600 });
  });
  it("Fit to content covers the visible base plus the overhang, not the whole asset", () => {
    const g = { naturalW: 1000, naturalH: 600, pad: 40, extents: { ...none, left: 400 }, base };
    // x from 500 - 400 = 100 to 1000, i.e. 0.1 .. 1.0 of the asset width.
    expect(contentBoxFrame(g)).toEqual({ x: 0.1, y: 0, w: 0.9, h: 1 });
  });
  it("Fit to content on an unmoved, uncropped base is what it was", () => {
    const g = {
      naturalW: 1000,
      naturalH: 600,
      pad: 40,
      extents: { left: 100, top: 0, right: 50, bottom: 0 },
    };
    expect(contentBoxFrame(g)).toEqual({ x: -0.1, y: 0, w: 1.15, h: 1 });
  });
});

describe("export frame math with a cropped base", () => {
  const base = { x1: 500, y1: 0, x2: 1000, y2: 600 };
  const none = { left: 0, top: 0, right: 0, bottom: 0 };

  it("without an export frame the output is the visible base plus the padding ring", () => {
    const w = frameWindow(scene([]), geom({ extents: none, base }));
    expect(w).toMatchObject({ vbX: 0, vbY: 0, outW: 580, outH: 680 });
  });
  it("an export frame in world units lands on the right pixels of the composed frame", () => {
    // World x 600..900 (0.6 wide .3) over y 100..400. Origin x = 40 - 500 = -460, y = 40,
    // so the window starts at frame (140, 140) and is 300 x 300. Output is not padded again.
    const w = frameWindow(
      scene([], { exportFrame: { x: 0.6, y: 100 / 600, w: 0.3, h: 0.5 } }),
      geom({ extents: none, base }),
    );
    expect(w).toMatchObject({ vbX: 140, vbY: 140, outW: 300, outH: 300 });
  });
});

describe("buildSvg draws the base through its crop", () => {
  const sc = scene([blur], {
    baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    baseRadius: 20,
  });
  const noneExt = { left: 0, top: 0, right: 0, bottom: 0 };
  const g = geom({ extents: noneExt, base: { x1: 500, y1: 0, x2: 1000, y2: 600 } });
  const blurInVisible: Annotation = { ...blur, x: 0.6, y: 0.1, w: 0.2, h: 0.2 };
  const svg = buildSvg({ ...sc, annotations: [blurInVisible] }, g);

  it("clips the visible window with the base's own radius", () => {
    expect(svg).toContain(
      '<clipPath id="rc"><rect x="40" y="40" width="500" height="600" rx="20"/></clipPath>',
    );
  });
  it("draws the WHOLE asset at the world origin, so the window shows the right part", () => {
    expect(svg).toContain(
      '<image id="shot" href="data:image/png;base64,AAAA" width="1000" height="600"',
    );
    // Origin x = 40 - 500 = -460: the asset's left edge is off the visible window.
    expect(svg).toContain('<use href="#shot" x="-460" y="40"/>');
  });
  it("a blur redrawn over the base is clipped to the visible window too", () => {
    expect(svg).toContain(
      '<clipPath id="bbase-z"><rect x="500" y="0" width="500" height="600" rx="20"/></clipPath>',
    );
  });
  it("falls back to the global radius when the base has no radius of its own", () => {
    const out = buildSvg({ ...sc, baseRadius: undefined }, g);
    expect(out).toContain('width="500" height="600" rx="12"/></clipPath>');
  });
});

describe("buildSvg draws a resized base at its placed size", () => {
  const sc = scene([], {
    basePlacement: { x: 1, y: 0.25, scale: 0.5 },
    baseCrop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
  });
  const base = visibleBaseBounds(sc, 1000, 600);
  const g = geom({ extents: { left: 0, top: 0, right: 0, bottom: 0 }, base });
  const svg = buildSvg(sc, g);

  it("sizes the asset to scale x natural size", () => {
    expect(svg).toContain(
      '<image id="shot" href="data:image/png;base64,AAAA" width="500" height="300"',
    );
  });
  it("clips the middle half and puts the asset's corner where the placement says", () => {
    // Visible x 1125..1375 -> 250 x 150 window at the padding. Origin = 40 - 1125 = -1085,
    // y = 40 - 225 = -185; the whole asset (1000,150) lands at (-85, -35).
    expect(svg).toContain('<rect x="40" y="40" width="250" height="150" rx="12"/></clipPath>');
    expect(svg).toContain('<use href="#shot" x="-85" y="-35"/>');
    expect(svg).toContain('width="330" height="230"');
  });
});
