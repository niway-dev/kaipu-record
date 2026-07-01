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
  frameW: 1080,
  frameH: 680,
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
});
