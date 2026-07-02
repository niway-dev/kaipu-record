import { describe, expect, it } from "vitest";
import { buildSvg, type Geom } from "./compositor";
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
});
