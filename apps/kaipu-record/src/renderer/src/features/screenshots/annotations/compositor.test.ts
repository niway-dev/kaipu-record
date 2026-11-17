import { describe, expect, it, vi } from "vitest";
import { intersectFrame, worldToFrame } from "./canvas-geometry";
import { assertExportSize, buildSvg, compositeSceneAt, frameWindow, type Geom } from "./compositor";
import { MAX_EXPORT_SIDE } from "./canvas-geometry";
import { TEXT_SIZES } from "./tools";
import type { Annotation, Scene } from "./scene";

const geom: Geom = {
  href: "data:image/png;base64,AAAA",
  naturalW: 1000,
  naturalH: 600,
  pad: 40,
  radius: 12,
  scale: 2,
};

function scene(annotations: Annotation[], bg: Scene["beautify"]["bg"] = "magenta"): Scene {
  return { beautify: { bg, padding: 20, radius: 6, shadow: 60 }, annotations };
}

describe("compositor buildSvg", () => {
  it("emits a numeric font-size for every text size (guards the TEXT_PX drift bug)", () => {
    TEXT_SIZES.forEach((_, size) => {
      const svg = buildSvg(
        scene([{ id: "t", kind: "text", x: 0.5, y: 0.5, text: "Hi", color: "#fff", size }]),
        geom,
      );
      expect(svg).not.toContain("NaN");
      expect(svg).toMatch(/font-size="\d+(\.\d+)?"/);
    });
  });

  it("rounds the exported background to match the preview frame", () => {
    const svg = buildSvg(scene([], "magenta"), geom);
    // The bg rect must carry rx (square corners diverged from the rounded preview).
    expect(svg).toMatch(/<rect width="1080" height="680" rx="\d+"/);
  });

  it("omits the background rect when bg is none", () => {
    const svg = buildSvg(scene([], "none"), geom);
    expect(svg).not.toMatch(/<rect width="1080" height="680"/);
  });

  it("scales stroke widths and never emits NaN", () => {
    const annotations: Annotation[] = [
      { id: "b", kind: "box", x: 0.1, y: 0.1, w: 0.2, h: 0.2, color: "#f00", stroke: 1, seed: 3 },
      {
        id: "a",
        kind: "arrow",
        x1: 0.1,
        y1: 0.1,
        x2: 0.4,
        y2: 0.4,
        color: "#0f0",
        stroke: 0,
        seed: 5,
      },
    ];
    const svg = buildSvg(scene(annotations, "ocean"), geom);
    expect(svg).not.toContain("NaN");
    expect(svg).toContain("stroke-width=");
  });

  it("renders a freehand path as a stroked, smoothed SVG path", () => {
    const annotations: Annotation[] = [
      {
        id: "p",
        kind: "path",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.3, y: 0.4 },
          { x: 0.6, y: 0.2 },
        ],
        color: "#0ff",
        stroke: 2,
      },
    ];
    const svg = buildSvg(scene(annotations), geom);
    expect(svg).toMatch(/<path d="M [\d.]+ [\d.]+ C/); // smoothed bézier path
    expect(svg).toContain('stroke="#0ff"');
    expect(svg).not.toContain("NaN");
  });

  it("bakes a blur box as a clipped, blurred copy of the base image", () => {
    const annotations: Annotation[] = [{ id: "x", kind: "blur", x: 0.1, y: 0.1, w: 0.3, h: 0.2 }];
    const svg = buildSvg(scene(annotations), geom);
    expect(svg).toContain("<feGaussianBlur");
    // The base data URL is embedded once (as #shot); the blur references it via <use>.
    expect(svg).toContain('<image id="shot" href="data:image/png;base64,AAAA"');
    expect(svg).toMatch(/<use href="#shot"[^>]*filter="url\(#bfilter-x\)"/);
    expect(svg).not.toContain("NaN");
  });

  it("embeds the base image only once even with multiple blur boxes", () => {
    const annotations: Annotation[] = [
      { id: "a", kind: "blur", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { id: "b", kind: "blur", x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
    ];
    const svg = buildSvg(scene(annotations), geom);
    // The (potentially huge) data URL appears once, not once per blur.
    expect(svg.match(/href="data:image\/png/g)?.length).toBe(1);
    expect(svg.match(/<use href="#shot"/g)?.length).toBe(3); // base + 2 blurs
  });

  it("windows the export to a crop of the composed FRAME via viewBox", () => {
    // Frame = naturalW+2pad x naturalH+2pad = 1080 x 680. Crop = middle half in each axis.
    const cropped = { ...scene([]), crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } };
    const svg = buildSvg(cropped, geom);
    // Output size = window in frame px = 0.5*1080 x 0.5*680 = 540 x 340.
    expect(svg).toContain('width="540" height="340"');
    // viewBox selects the sub-rect: origin 0.25*1080=270, 0.25*680=170.
    expect(svg).toContain('viewBox="270 170 540 340"');
    // The frame is composed once at full size — the shot still sits at (pad,pad), unshifted.
    expect(svg).toContain('<use href="#shot" x="40" y="40"');
  });

  it("lets a crop span into the padding/background (no re-added padding)", () => {
    // Left half, full height: x:0,y:0,w:0.5,h:1 with padding>0.
    const cropped = { ...scene([]), crop: { x: 0, y: 0, w: 0.5, h: 1 } };
    const svg = buildSvg(cropped, geom);
    // viewBox starts at the frame origin (0,0), so the left padding strip is INCLUDED.
    expect(svg).toContain('viewBox="0 0 540 680"');
    // Shot still at (pad,pad): the 40px padding strip on the left is inside the window.
    expect(svg).toContain('<use href="#shot" x="40" y="40"');
  });

  it("crops a 3:4 shot to a SQUARE by including padding (the headline use case)", () => {
    // 3:4 shot (600x800) + 100px padding → frame 800x1000. A full-width crop of height
    // 0.8 (0.8*1000=800) yields an 800x800 square that includes the padding.
    const g34: Geom = { ...geom, naturalW: 600, naturalH: 800, pad: 100 };
    const cropped = { ...scene([]), crop: { x: 0, y: 0, w: 1, h: 0.8 } };
    const svg = buildSvg(cropped, g34);
    expect(svg).toContain('width="800" height="800"');
    expect(svg).toContain('viewBox="0 0 800 800"');
  });

  it("clips the base shot via a wrapping group, not the translated <use> (padding shear bug)", () => {
    // A clip-path on an element that also carries an x/y translation resolves in the
    // translated space, landing `rc` (authored at pad,pad) at (2·pad,2·pad) and shearing
    // the shot's top-left `pad` strip off — the padded-export bug. The clip must live on a
    // non-translated wrapping <g> so it clips where the shot actually is.
    const svg = buildSvg(scene([]), geom);
    expect(svg).toContain('<g clip-path="url(#rc)"><use href="#shot" x="40" y="40"/></g>');
    // The <use> itself must NOT carry the clip (that's the shearing form).
    expect(svg).not.toMatch(/<use href="#shot"[^>]*clip-path/);
  });

  it("leaves the export unchanged when there is no crop", () => {
    const svg = buildSvg(scene([]), geom);
    // full frame 1080x680, base at (pad,pad)=(40,40)
    expect(svg).toContain('width="1080" height="680"');
    expect(svg).toContain('viewBox="0 0 1080 680"');
    expect(svg).toContain('<use href="#shot" x="40" y="40"');
  });

  it("does NOT clip annotations to the shot rect (they may render over the padding, like the preview)", () => {
    const annotations: Annotation[] = [
      {
        id: "a",
        kind: "arrow",
        x1: 0.9,
        y1: 0.9,
        x2: 1.1,
        y2: 1.1,
        color: "#f00",
        stroke: 1,
        seed: 2,
      },
    ];
    const svg = buildSvg(scene(annotations), geom);
    // The annotation group is translated into the frame but carries no shot clip,
    // so an arrow head at 1.1 (past the shot edge, into the padding) isn't truncated.
    expect(svg).toContain(`<g transform="translate(40,40)">`);
    expect(svg).not.toContain("rcLocal");
  });
});

const bakeMock = vi.hoisted(() => vi.fn());
vi.mock("./redaction", async (orig) => ({
  ...(await orig<typeof import("./redaction")>()),
  // The compositor's one entry point is the canvas bake (it bakes the base and every image).
  bakeCanvasRedactions: bakeMock,
}));

describe("compositor canvas mode", () => {
  const ZERO = { left: 0, top: 0, right: 0, bottom: 0 };
  const inside: Annotation[] = [
    { id: "b", kind: "box", x: 0.1, y: 0.1, w: 0.2, h: 0.2, color: "#f00", stroke: 1, seed: 3 },
    { id: "t", kind: "text", x: 0.5, y: 0.5, text: "Hi", color: "#fff", size: 1 },
    { id: "u", kind: "blur", x: 0.6, y: 0.6, w: 0.2, h: 0.1 },
  ];
  const noPad: Scene["beautify"] = { bg: "none", padding: 0, radius: 0, shadow: 0 };
  const scenes: Scene[] = [
    scene([]),
    scene(inside),
    { beautify: { bg: "ocean", padding: 24, radius: 8, shadow: 40 }, annotations: inside },
    { beautify: noPad, annotations: inside },
  ];

  it("with zero extents is byte-identical to the non-canvas SVG", () => {
    scenes.forEach((s, i) => {
      const pad = Math.round(s.beautify.padding * 2);
      const g = { ...geom, pad };
      // Canvas mode bakes blurs into the base bytes, so only the blur layer differs.
      const noBlur = { ...s, annotations: s.annotations.filter((a) => a.kind !== "blur") };
      expect(buildSvg(noBlur, { ...g, extents: ZERO }), `scene ${i}`).toBe(buildSvg(noBlur, g));
    });
  });

  it("draws no blur filter in canvas mode (its pixels are in the base image)", () => {
    const svg = buildSvg(scene(inside), { ...geom, extents: ZERO });
    expect(svg).not.toContain("feGaussianBlur");
    expect(buildSvg(scene(inside), geom)).toContain("feGaussianBlur");
  });

  it("canvas mode: a redaction covers an annotation drawn before it, locked or not", () => {
    for (const locked of [false, true]) {
      const s = scene([
        { id: "t", kind: "text", x: 0.1, y: 0.1, text: "secret", color: "#fff", size: 1 },
        { id: "r", kind: "blur", x: 0, y: 0, w: 0.5, h: 0.5, style: "solid", locked },
      ]);
      const svg = buildSvg(s, { ...geom, extents: ZERO });
      const copy = svg.indexOf(`<g clip-path="url(#bclip-r)"><use href="#shot"/>`);
      expect(copy, `locked ${locked}`).toBeGreaterThan(svg.indexOf("secret"));
    }
  });

  it("canvas mode: an annotation drawn before a redaction is cut out of its rect, so a translucent base cannot show it through (NIW2-799)", () => {
    const s = scene([
      { id: "t", kind: "text", x: 0.1, y: 0.1, text: "secret", color: "#fff", size: 1 },
      { id: "r", kind: "blur", x: 0, y: 0, w: 0.5, h: 0.5, style: "blur" },
      { id: "after", kind: "text", x: 0.1, y: 0.8, text: "later", color: "#fff", size: 1 },
    ]);
    const svg = buildSvg(s, { ...geom, extents: ZERO });
    // The text drawn before the redaction sits inside a mask that is black over the rect.
    const group = svg.indexOf('<g mask="url(#cut-t)">');
    expect(group).toBeGreaterThan(-1);
    expect(group).toBeLessThan(svg.indexOf("secret"));
    expect(svg).toMatch(
      /<mask id="cut-t"[^>]*><rect [^>]*fill="#fff"\/><rect x="0" y="0" width="500" height="300" fill="#000"\/><\/mask>/,
    );
    // The text drawn after it stays on top of the redaction, unmasked.
    expect(svg).not.toContain("cut-after");
    // Outside canvas mode a blur is a filter over the shot: nothing to cut out.
    expect(buildSvg(s, geom)).not.toContain("<mask");
  });

  it("bakes redactions into the base bytes in canvas mode only", async () => {
    bakeMock.mockReset();
    bakeMock.mockRejectedValue(new Error("baked"));
    const bytes = new ArrayBuffer(4);
    await expect(compositeSceneAt(scene(inside), bytes, 100, { canvas: true })).rejects.toThrow(
      "baked",
    );
    expect(bakeMock).toHaveBeenCalledWith(bytes, {}, inside, undefined);
    // Flag off: the export goes straight to decoding the bytes, which never settles for
    // these fake bytes in jsdom; the bake would have run before that, so one tick is enough.
    bakeMock.mockClear();
    void compositeSceneAt(scene(inside), bytes, 100).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bakeMock).not.toHaveBeenCalled();
  });

  it("hands the base's placement (never its crop) to the bake, so the whole asset is what gets redacted", async () => {
    bakeMock.mockReset();
    bakeMock.mockRejectedValue(new Error("baked"));
    const bytes = new ArrayBuffer(4);
    const basePlacement = { x: 1, y: 0, scale: 0.5 };
    const s = {
      ...scene(inside),
      basePlacement,
      baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    };
    await expect(compositeSceneAt(s, bytes, 100, { canvas: true })).rejects.toThrow("baked");
    expect(bakeMock).toHaveBeenCalledWith(bytes, {}, inside, basePlacement);
  });

  it("refuses an export frame past the canvas limit before rasterizing it", async () => {
    // A hostile document: the 2880x1800 base resized to 100x is a 288 000 x 180 000 px frame.
    bakeMock.mockReset();
    bakeMock.mockImplementation(async (base: ArrayBuffer) => ({ base, assets: {} }));
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 2880;
        naturalHeight = 1800;
        onload: (() => void) | null = null;
        set src(_url: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    try {
      const s = { ...scene([]), basePlacement: { x: 0, y: 0, scale: 100 } };
      await expect(compositeSceneAt(s, new ArrayBuffer(4), 1440, { canvas: true })).rejects.toThrow(
        /export frame .* exceeds 16384px/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("accepts a frame at the canvas limit and refuses one px past it", () => {
    expect(() => assertExportSize(MAX_EXPORT_SIDE, MAX_EXPORT_SIDE)).not.toThrow();
    expect(() => assertExportSize(MAX_EXPORT_SIDE + 1, 10)).toThrow(/export frame/);
    expect(() => assertExportSize(10, MAX_EXPORT_SIDE + 1)).toThrow(/export frame/);
    expect(() => assertExportSize(Number.NaN, 10)).toThrow(/export frame/);
  });

  it("grows the frame for a text outside the image and keeps the shot at the padding", () => {
    const extR = 300;
    const s = scene([
      { id: "t", kind: "text", x: 1.2, y: 0.1, text: "Hi", color: "#fff", size: 1 },
    ]);
    const svg = buildSvg(s, { ...geom, extents: { ...ZERO, right: extR } });
    const fullW = 1000 + extR + 80;
    expect(svg).toContain(`width="${fullW}" height="${600 + 80}" viewBox="0 0 ${fullW} 680"`);
    expect(svg).toContain(`<use href="#shot" x="40" y="40"/>`);
    expect(svg).toContain(`translate(40,40)`);
    expect(svg).toContain(`x="1200"`); // text x in shot space, inside the viewBox once translated
  });

  it("shifts the shot by the left/top extents", () => {
    const svg = buildSvg(scene([]), {
      ...geom,
      extents: { left: 100, top: 50, right: 0, bottom: 0 },
    });
    expect(svg).toContain(`<use href="#shot" x="140" y="90"/>`);
    expect(svg).toContain(`translate(140,90)`);
  });

  it("with bg none fills only the union box, never the padding", () => {
    const s = scene([], "none");
    const g = { ...geom, extents: { ...ZERO, right: 300 } };
    const svg = buildSvg(s, g);
    expect(svg).toContain(`<rect x="40" y="40" width="1300" height="600" fill="#ffffff"/>`);
    expect(svg).not.toMatch(/<rect width="\d+" height="\d+"/);
  });

  it("draws no neutral fill for bg none when extents are zero", () => {
    expect(buildSvg(scene([], "none"), { ...geom, extents: ZERO })).not.toContain("#ffffff");
  });

  it("an export frame sets exactly the output rect in natural px", () => {
    const s: Scene = { ...scene([]), exportFrame: { x: -0.1, y: 0.2, w: 1.5, h: 0.5 } };
    const g = { ...geom, extents: { left: 100, top: 0, right: 400, bottom: 0 } };
    const svg = buildSvg(s, g);
    // origin x = pad + left = 140; vb x = 140 - 100 = 40, y = 40 + 120 = 160
    expect(svg).toContain(`width="1500" height="300" viewBox="40 160 1500 300"`);
  });

  it("an export frame past the composed frame is intersected with it", () => {
    const s: Scene = { ...scene([]), exportFrame: { x: -1, y: -1, w: 5, h: 5 } };
    const w = frameWindow(s, { ...geom, extents: ZERO });
    expect(w).toMatchObject({ vbX: 0, vbY: 0, outW: w.fullW, outH: w.fullH });
    const t: Scene = { ...scene([]), exportFrame: { x: 0.5, y: 0.5, w: 5, h: 5 } };
    const v = frameWindow(t, { ...geom, extents: ZERO });
    expect(v.vbX + v.outW).toBeLessThanOrEqual(v.fullW);
    expect(v.vbY + v.outH).toBeLessThanOrEqual(v.fullH);
  });

  it("one-sided overflow gives the same window in the preview rule and in frameWindow", () => {
    const g = { ...geom, extents: ZERO };
    const frame = { x: 0.7, y: 0, w: 0.5, h: 1 };
    const w = frameWindow({ ...scene([]), exportFrame: frame }, g);
    const c = intersectFrame(worldToFrame(frame, g))!;
    expect(w.vbX).toBe(Math.round(c.x * w.fullW));
    expect(w.vbX + w.outW).toBe(w.fullW);
    expect(w.outW).toBeLessThan(Math.round(0.5 * w.fullW));
  });

  it("an export frame fully outside the composed frame exports the whole frame, like the preview", () => {
    const g = { ...geom, extents: ZERO };
    const frame = { x: 5, y: 5, w: 1, h: 1 };
    expect(intersectFrame(worldToFrame(frame, g))).toBeUndefined();
    const w = frameWindow({ ...scene([]), exportFrame: frame }, g);
    expect(w).toMatchObject({ vbX: 0, vbY: 0, outW: w.fullW, outH: w.fullH });
  });

  it("ignores scene.crop in canvas mode", () => {
    const s: Scene = { ...scene([]), crop: { x: 0.5, y: 0.5, w: 0.25, h: 0.25 } };
    const svg = buildSvg(s, { ...geom, extents: ZERO });
    expect(svg).toContain(`viewBox="0 0 1080 680"`);
  });
});

describe("compositor image annotations (canvas mode)", () => {
  const ZERO = { left: 0, top: 0, right: 0, bottom: 0 };
  // Illustrative: a 500x300 image to the right of the 1000x600 base, 100 px gap, top-aligned.
  const second: Annotation = {
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
  const assets = { "img-abc123def456": "data:image/png;base64,BBBB" };
  const g: Geom = { ...geom, extents: { ...ZERO, right: 600 }, assets };

  it("defines the asset once, uses it at its frame position and grows the frame", () => {
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
    const svg = buildSvg(scene([second, box, { ...second, id: "a10", x: 1.1, y: 0.6 }]), g);
    expect(svg.split('<image id="asset-img-abc123def456-500x300"')).toHaveLength(2);
    expect(svg).toContain(`href="data:image/png;base64,BBBB" width="500" height="300"`);
    // Annotation space is translated to the shot at the padding (40,40): x = 1.1 * 1000.
    expect(svg).toContain(`translate(40,40)`);
    expect(svg).toContain(`<use href="#asset-img-abc123def456-500x300" x="1100" y="0"/>`);
    expect(svg).toContain(`<use href="#asset-img-abc123def456-500x300" x="1100" y="360"/>`);
    const fullW = 1000 + 600 + 80;
    expect(svg).toContain(`width="${fullW}" height="680" viewBox="0 0 ${fullW} 680"`);
  });

  it("draws a resized image at its new size, scaling the asset (illustrative: 500x300 -> 750x450)", () => {
    const resized: Annotation = { ...second, w: 0.75, h: 0.75 };
    const svg = buildSvg(scene([resized]), g);
    expect(svg).toContain(`href="data:image/png;base64,BBBB" width="750" height="450"`);
    expect(svg).toContain(
      `<clipPath id="ic-a9"><rect x="1100" y="0" width="750" height="450" rx="12"/></clipPath>`,
    );
  });

  it("defines one asset per size, each placement using the def of its own size", () => {
    const resized: Annotation = { ...second, id: "a10", y: 1, w: 0.75, h: 0.75 };
    const svg = buildSvg(scene([second, resized]), g);
    expect(svg.match(/<image id="asset-/g)).toHaveLength(2);
    expect(svg).toContain(
      `<image id="asset-img-abc123def456-500x300" href="data:image/png;base64,BBBB" width="500" height="300"`,
    );
    expect(svg).toContain(
      `<image id="asset-img-abc123def456-750x450" href="data:image/png;base64,BBBB" width="750" height="450"`,
    );
    expect(svg).toContain(`<use href="#asset-img-abc123def456-500x300" x="1100" y="0"/>`);
    expect(svg).toContain(`<use href="#asset-img-abc123def456-750x450" x="1100" y="600"/>`);
  });

  it("keeps one def for two placements of equal size", () => {
    const svg = buildSvg(scene([second, { ...second, id: "a10", y: 1 }]), g);
    expect(svg.match(/<image id="asset-/g)).toHaveLength(1);
    expect(svg.match(/<use href="#asset-/g)).toHaveLength(2);
  });

  it("clips each image to its own rounded rect in a non-transformed group", () => {
    const svg = buildSvg(scene([second]), g);
    expect(svg).toContain(
      `<clipPath id="ic-a9"><rect x="1100" y="0" width="500" height="300" rx="12"/></clipPath>`,
    );
    expect(svg).toContain(`<g clip-path="url(#ic-a9)"><use href="#asset-img-abc123def456-500x300"`);
  });

  it("gives an image the base's drop shadow only when shadow > 0", () => {
    const withShadow = buildSvg(scene([second]), g);
    expect(withShadow).toContain(
      `<rect x="1100" y="0" width="500" height="300" rx="12" fill="#000" filter="url(#sh)"/>`,
    );
    const flat: Scene = { ...scene([second]), beautify: { ...scene([]).beautify, shadow: 0 } };
    expect(buildSvg(flat, g)).not.toContain("filter=");
  });

  it("throws when an image's asset is missing", () => {
    expect(() => buildSvg(scene([second]), { ...g, assets: {} })).toThrow(/missing asset/);
  });

  it("composite throws on a missing asset before doing any work", async () => {
    await expect(
      compositeSceneAt(scene([second]), new ArrayBuffer(4), 100, { canvas: true, assets: {} }),
    ).rejects.toThrow(/missing asset img-abc123def456/);
  });

  it("leaves the output unchanged when no image annotation is present", () => {
    const s = scene([
      { id: "t", kind: "text", x: 0.5, y: 0.5, text: "Hi", color: "#fff", size: 1 },
    ]);
    const plain = buildSvg(s, { ...geom, extents: ZERO });
    expect(buildSvg(s, { ...geom, extents: ZERO, assets })).toBe(plain);
    expect(plain).not.toContain("asset-");
  });

  it("draws a cropped image: whole asset from its own corner, clipped to the visible rect", () => {
    // Illustrative: the visible 500x300 rect shows the middle half of the asset, so the
    // asset is 1000x600 on the canvas and starts 250 px left of / 150 px above the rect (x 1250 -> 1000).
    const cropped: Annotation = { ...second, x: 1.25, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } };
    const svg = buildSvg(scene([cropped]), g);
    expect(svg).toContain(`<image id="asset-img-abc123def456-1000x600"`);
    expect(svg).toContain(`width="1000" height="600" preserveAspectRatio="none"`);
    expect(svg).toContain(
      `<clipPath id="ic-a9"><rect x="1250" y="0" width="500" height="300" rx="12"/></clipPath>`,
    );
    expect(svg).toContain(`<use href="#asset-img-abc123def456-1000x600" x="1000" y="-150"/>`);
  });

  it("keeps two crops of one asset on separate placements when their full sizes differ", () => {
    const a: Annotation = { ...second, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } };
    const b: Annotation = { ...second, id: "a10", y: 1, crop: { x: 0, y: 0, w: 0.25, h: 0.25 } };
    const svg = buildSvg(scene([a, b]), g);
    expect(svg).toContain(`<image id="asset-img-abc123def456-1000x600"`);
    expect(svg).toContain(`<image id="asset-img-abc123def456-2000x1200"`);
  });

  it("gives two crops of the same full size one def, even when float noise differs", () => {
    // 0.1 + 0.2 vs 0.3 are the same width mathematically, not in floating point.
    const a: Annotation = { ...second, w: 0.1 + 0.2, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } };
    const b: Annotation = {
      ...second,
      id: "a10",
      y: 1,
      w: 0.3,
      crop: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    };
    const svg = buildSvg(scene([a, b]), g);
    expect(svg.match(/<image id="asset-/g)).toHaveLength(1);
  });

  it("uses an image's own radius, in source px, for its clip and shadow; else the global one", () => {
    const own: Annotation = { ...second, radius: 40 };
    const svg = buildSvg(scene([own]), g);
    expect(svg).toContain(
      `<clipPath id="ic-a9"><rect x="1100" y="0" width="500" height="300" rx="40"/></clipPath>`,
    );
    expect(svg).toContain(`rx="40" fill="#000" filter="url(#sh)"`);
    // 0 is a real value (square corners), not "unset".
    expect(buildSvg(scene([{ ...second, radius: 0 }]), g)).toContain(`height="300" rx="0"/>`);
  });

  it("draws an image without crop or radius exactly as before this feature", () => {
    // The pre-crop template, written out: any drift here changes every existing export.
    const svg = buildSvg(scene([second]), g);
    expect(svg).toContain(
      `<defs><clipPath id="ic-a9"><rect x="1100" y="0" width="500" height="300" rx="12"/></clipPath></defs>` +
        `<rect x="1100" y="0" width="500" height="300" rx="12" fill="#000" filter="url(#sh)"/>` +
        `<g clip-path="url(#ic-a9)"><use href="#asset-img-abc123def456-500x300" x="1100" y="0"/></g>`,
    );
    expect(svg).toContain(
      `<image id="asset-img-abc123def456-500x300" href="data:image/png;base64,BBBB" width="500" height="300" preserveAspectRatio="none"/>`,
    );
  });

  it("redraws, at a blur's z-position, the baked images below it and never one above", () => {
    const blur: Annotation = { id: "z", kind: "blur", x: 1.2, y: 0.1, w: 0.2, h: 0.2 };
    const above = buildSvg(scene([second, blur]), g);
    expect(above).toContain(`<clipPath id="bclip-z">`);
    expect(above).toContain(
      `<g clip-path="url(#bclip-z)"><use href="#shot"/><defs><clipPath id="ic-a9-under-z">`,
    );
    const below = buildSvg(scene([blur, second]), g);
    expect(below).toContain(`<g clip-path="url(#bclip-z)"><use href="#shot"/></g>`);
    expect(below).not.toContain("-under-z");
    // Never a filter: the pixels are already baked.
    expect(above).not.toContain("feGaussianBlur");
  });
});

describe("compositor step badges", () => {
  const step = (id: string, x: number, color: string): Annotation => ({
    id,
    kind: "step",
    x,
    y: 0.5,
    color,
    size: 1,
  });

  it("emits a circle and the number for each badge, scaled by `scale`", () => {
    const svg = buildSvg(scene([step("a", 0.25, "#f6055c"), step("b", 0.75, "#f6055c")]), geom);
    expect(svg.match(/<circle /g)).toHaveLength(2);
    // Diameter STEP_PX[1] = 28 -> radius 14, times scale 2.
    expect(svg).toContain('r="28"');
    expect(svg).toMatch(/dominant-baseline="central">1<\/text>/);
    expect(svg).toMatch(/dominant-baseline="central">2<\/text>/);
    expect(svg).not.toContain("NaN");
  });

  it("renumbers in the export when a badge is missing", () => {
    const svg = buildSvg(scene([step("a", 0.25, "#f6055c"), step("c", 0.75, "#f6055c")]), geom);
    expect(svg).not.toContain(">3</text>");
    expect(svg).toMatch(/>2<\/text>/);
  });

  it("uses dark ink on a light fill and white on a dark one", () => {
    const light = buildSvg(scene([step("a", 0.5, "#f5f5f5")]), geom);
    expect(light).toContain('fill="#1a1a1a"');
    const dark = buildSvg(scene([step("a", 0.5, "#f6055c")]), geom);
    expect(dark).toContain('stroke="#ffffff"');
  });
});

describe("compositor step badges - mock ring, hairline and shadow (NIW2-713)", () => {
  it("rings a light fill in white and keeps the number dark", () => {
    const svg = buildSvg(
      scene([{ id: "a", kind: "step", x: 0.5, y: 0.5, color: "#f5f5f5", size: 1 }]),
      geom,
    );
    expect(svg).toMatch(/<circle [^>]*fill="#f5f5f5"[^>]*stroke="#ffffff"/);
    expect(svg).toContain('fill="#1a1a1a"');
  });

  it("draws the hairline and drop shadow with one filter, still one circle per badge", () => {
    const svg = buildSvg(
      scene([
        { id: "a", kind: "step", x: 0.25, y: 0.5, color: "#f6055c", size: 1 },
        { id: "b", kind: "step", x: 0.75, y: 0.5, color: "#f6055c", size: 1 },
      ]),
      geom,
    );
    expect(svg.match(/<circle /g)).toHaveLength(2);
    const ref = svg.match(/<circle [^>]*filter="url\(#([^)]+)\)"/);
    expect(ref).not.toBeNull();
    expect(svg).toContain(`<filter id="${ref![1]}"`);
    expect(svg.match(/<filter id="stepf/g)).toHaveLength(1);
  });
});

describe("compositor buildSvg - measure (NIW2-702)", () => {
  it("draws the line, end ticks and the escaped length label, scaled", () => {
    const svg = buildSvg(
      scene([
        {
          id: "m",
          kind: "measure",
          axis: "x",
          from: 100,
          to: 140,
          at: 299,
          imageW: 1000,
          imageH: 600,
          color: "#ff0000",
        },
      ]),
      geom,
    );
    expect(svg).not.toContain("NaN");
    expect(svg).toContain('data-kind="measure"');
    // Line from x=100 to x=140 on the middle of row 299 (y = 299.5).
    expect(svg).toContain('x1="100" y1="299.5" x2="140" y2="299.5"');
    expect(svg).toContain(">40 px</text>");
    // Font 12 px scaled by geom.scale (2).
    expect(svg).toMatch(/font-size="24"/);
  });
});
