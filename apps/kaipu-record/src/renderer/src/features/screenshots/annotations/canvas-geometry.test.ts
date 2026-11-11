import { describe, expect, it, vi } from "vitest";
import {
  annotationBounds,
  canvasLayout,
  contentExtents,
  defaultTextMeasure,
  extentsToDisplay,
  frameToWorld,
  worldToFrame,
  type TextMeasure,
} from "./canvas-geometry";
import { STEP_PX, STROKE_WIDTHS, TEXT_LINE_HEIGHT, TEXT_PX, stepRingPx } from "./tools";
import type { Annotation } from "./scene";

const W = 1000;
const H = 600;
// Deterministic: 10 px per character regardless of font size.
const measure: TextMeasure = (text) => text.length * 10;

const text = (over: Partial<Extract<Annotation, { kind: "text" }>> = {}): Annotation => ({
  id: "t",
  kind: "text",
  x: 0.1,
  y: 0.1,
  text: "hello",
  color: "#fff",
  size: 1,
  ...over,
});

describe("annotationBounds", () => {
  it("box: the rect grown by half a stroke plus jitter", () => {
    const b = annotationBounds(
      { id: "b", kind: "box", x: 0.1, y: 0.2, w: 0.3, h: 0.4, color: "#f00", stroke: 1, seed: 1 },
      W,
      H,
      2,
    )!;
    const m = (STROKE_WIDTHS[1] * 2) / 2 + 1.7;
    expect(b.x1).toBeCloseTo(100 - m);
    expect(b.y1).toBeCloseTo(120 - m);
    expect(b.x2).toBeCloseTo(400 + m);
    expect(b.y2).toBeCloseTo(360 + m);
  });

  it("arrow: covers both ends and the head margin past the tip", () => {
    const b = annotationBounds(
      {
        id: "a",
        kind: "arrow",
        x1: 0.1,
        y1: 0.5,
        x2: 0.9,
        y2: 0.5,
        color: "#0f0",
        stroke: 0,
        seed: 1,
      },
      W,
      H,
      2,
    )!;
    expect(b.x1).toBeLessThan(100);
    expect(b.x2).toBeGreaterThanOrEqual(900 + 15 * 2);
    expect(b.y1).toBeLessThan(300);
    expect(b.y2).toBeGreaterThan(300);
  });

  it("path: the points grown by half the stroke", () => {
    const b = annotationBounds(
      {
        id: "p",
        kind: "path",
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.6, y: 0.5 },
        ],
        color: "#000",
        stroke: 2,
      },
      W,
      H,
      1,
    )!;
    const m = STROKE_WIDTHS[2] / 2;
    expect(b).toEqual({ x1: 200 - m, y1: 120 - m, x2: 600 + m, y2: 300 + m });
  });

  it("path: a smoothed stroke's overshoot counts, not just the stored points", () => {
    // Catmull-Rom through (1200,0),(1300,0) bows up to about y = -60 (control points at -80).
    const e = contentExtents(
      [
        {
          id: "p",
          kind: "path",
          points: [
            { x: 1.1, y: 0.8 },
            { x: 1.2, y: 0 },
            { x: 1.3, y: 0 },
            { x: 1.4, y: 0.8 },
          ],
          color: "#000",
          stroke: 0,
        },
      ],
      W,
      H,
      1,
    );
    expect(e.top).toBeGreaterThanOrEqual(60);
    expect(e.right).toBeGreaterThanOrEqual(400);
  });

  it("path with no points paints nothing", () => {
    expect(
      annotationBounds({ id: "p", kind: "path", points: [], color: "#000", stroke: 0 }, W, H, 1),
    ).toBeNull();
  });

  it("blur: the rect, clipped to the image", () => {
    expect(
      annotationBounds({ id: "u", kind: "blur", x: 0.5, y: 0.5, w: 0.3, h: 0.1 }, W, H, 2),
    ).toEqual({ x1: 500, y1: 300, x2: 800, y2: 360 });
    expect(
      annotationBounds({ id: "u", kind: "blur", x: -0.25, y: 0.5, w: 0.75, h: 0.8 }, W, H, 2),
    ).toEqual({ x1: 0, y1: 300, x2: 500, y2: 600 });
  });

  it("blur: fully outside the image paints nothing and adds no extent", () => {
    const outside = { id: "u", kind: "blur" as const, x: 1.2, y: 0, w: 0.3, h: 0.3 };
    expect(annotationBounds(outside, W, H, 1)).toBeNull();
    expect(contentExtents([outside], W, H, 1)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it("text: top-left anchored, width from the measure, height from the line count", () => {
    const fs = TEXT_PX[1]! * 2;
    const b = annotationBounds(text({ text: "hello\nhi" }), W, H, 2, measure)!;
    expect(b.x1).toBe(100);
    expect(b.y1).toBe(60);
    expect(b.x2).toBe(100 + 50);
    expect(b.y2).toBeCloseTo(60 + 2 * fs * TEXT_LINE_HEIGHT);
  });

  it("text with width: a measured line wider than the box widens it", () => {
    const b = annotationBounds(
      text({ text: "WWWW", width: 0.01, fontPx: 20 }),
      W,
      H,
      1,
      () => 300,
    )!;
    expect(b.x2 - b.x1).toBe(300);
  });

  it("text with width wraps to width x naturalW", () => {
    const b = annotationBounds(
      text({ text: "aaa bbb ccc ddd eee fff", width: 0.1, fontPx: 20 }),
      W,
      H,
      1,
      measure,
    )!;
    expect(b.x2 - b.x1).toBe(100);
    expect(b.y2 - b.y1).toBeGreaterThan(20 * TEXT_LINE_HEIGHT);
  });
});

describe("defaultTextMeasure", () => {
  it("falls back to the character estimate when there is no 2D context (jsdom)", () => {
    // 5 chars x 0.55 x 20 px: the textBoxPx estimate, with no margin.
    expect(defaultTextMeasure("hello", 20)).toBeCloseTo(55);
  });

  it("measures with the export's font string and adds a margin when a context exists", async () => {
    vi.resetModules();
    const ctx = { font: "", measureText: () => ({ width: 384 }) };
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    try {
      const fresh = await import("./canvas-geometry");
      const { HAND_FONT } = await import("./tools");
      const w = fresh.defaultTextMeasure("WWWWWWWWWW", 37);
      expect(ctx.font).toBe(`600 37px ${HAND_FONT}`);
      // Measured 384 px (the estimate says 203): margin on top, never below the real width.
      expect(w).toBeGreaterThan(384);
      expect(w).toBeLessThan(384 * 1.04 + 37 * 0.1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("contentExtents", () => {
  it("is all zero for annotations inside the image", () => {
    const e = contentExtents(
      [
        { id: "b", kind: "box", x: 0.2, y: 0.2, w: 0.3, h: 0.3, color: "#f00", stroke: 0, seed: 1 },
        text({ x: 0.3, y: 0.3 }),
      ],
      W,
      H,
      1,
      measure,
    );
    expect(e).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it("is all zero with no annotations", () => {
    expect(contentExtents([], W, H, 1)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it("grows right for a text placed right of the image", () => {
    const e = contentExtents([text({ x: 1.2, text: "hello" })], W, H, 1, measure);
    expect(e).toEqual({ left: 0, top: 0, right: 200 + 50 - 0, bottom: 0 });
  });

  it("grows top for a text placed above the image", () => {
    const e = contentExtents([text({ y: -0.3, text: "hi" })], W, H, 1, measure);
    expect(e.top).toBe(180);
    expect(e.left).toBe(0);
    expect(e.right).toBe(0);
  });

  it("rounds up to whole natural px", () => {
    const e = contentExtents([text({ x: 1.0001, text: "" })], W, H, 1, measure);
    expect(e.right).toBeGreaterThan(0);
    expect(Number.isInteger(e.right)).toBe(true);
  });
});

describe("layout and frame converters", () => {
  const g = {
    naturalW: W,
    naturalH: H,
    pad: 40,
    extents: { left: 100, top: 50, right: 200, bottom: 0 },
  };

  it("lays out the frame, origin and union box", () => {
    expect(canvasLayout(g)).toEqual({
      fullW: 100 + W + 200 + 80,
      fullH: 50 + H + 80,
      originX: 140,
      originY: 90,
      box: { x: 40, y: 40, w: 1300, h: 650 },
    });
  });

  it("round-trips between world and frame units", () => {
    const world = { x: -0.05, y: -0.1, w: 1.2, h: 0.9 };
    const back = frameToWorld(worldToFrame(world, g), g);
    expect(back.x).toBeCloseTo(world.x);
    expect(back.y).toBeCloseTo(world.y);
    expect(back.w).toBeCloseTo(world.w);
    expect(back.h).toBeCloseTo(world.h);
  });

  it("maps the whole frame to the world rect that spans it", () => {
    const w = frameToWorld({ x: 0, y: 0, w: 1, h: 1 }, g);
    expect(w.x * W).toBeCloseTo(-140);
    expect(w.w * W).toBeCloseTo(1380);
  });

  it("converts extents to display px", () => {
    expect(extentsToDisplay({ left: 10, top: 20, right: 30, bottom: 40 }, 2)).toEqual({
      left: 5,
      top: 10,
      right: 15,
      bottom: 20,
    });
  });
});

describe("step badge bounds", () => {
  const step = (x: number, y: number): Annotation => ({
    id: "s",
    kind: "step",
    x,
    y,
    color: "#fff",
    size: 1,
  });
  const half = (scale: number): number => ((STEP_PX[1] + stepRingPx(STEP_PX[1])) / 2) * scale;

  it("is centered on the point and scales with `scale`", () => {
    const b1 = annotationBounds(step(0.5, 0.5), W, H, 1, measure)!;
    expect((b1.x1 + b1.x2) / 2).toBeCloseTo(500);
    expect((b1.y1 + b1.y2) / 2).toBeCloseTo(300);
    expect(b1.x2 - b1.x1).toBeCloseTo(2 * half(1));
    const b2 = annotationBounds(step(0.5, 0.5), W, H, 2, measure)!;
    expect(b2.x2 - b2.x1).toBeCloseTo(2 * half(2));
  });

  it("grows the content box when the badge sits outside the image", () => {
    const e = contentExtents([step(-0.1, 0.5)], W, H, 1, measure);
    expect(e.left).toBe(Math.ceil(100 + half(1)));
    expect(e.right).toBe(0);
    expect(contentExtents([step(0.5, 0.5)], W, H, 1, measure)).toEqual({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    });
  });
});

describe("annotationBounds - measure (NIW2-702)", () => {
  it("covers the segment, its ticks and the label pill", () => {
    const b = annotationBounds(
      {
        id: "m",
        kind: "measure",
        axis: "x",
        from: 100,
        to: 300,
        at: 199,
        imageW: W,
        imageH: H,
        color: "#f00",
      },
      W,
      H,
      1,
    )!;
    expect(b.x1).toBeLessThanOrEqual(100);
    expect(b.x2).toBeGreaterThanOrEqual(300);
    expect(b.y1).toBeLessThan(199.5); // the pill sits above the line
    expect(b.y2).toBeGreaterThan(199.5);
  });
});
