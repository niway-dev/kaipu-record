import { describe, expect, it } from "vitest";
import { EASING_PEAK_OVERSHOOT, easeValue } from "./easing";
import {
  WEBCAM_DEFAULTS,
  webcamStateAt,
  type WebcamLayout,
  type WebcamScene,
  type WebcamState,
} from "./webcam-model";
import {
  WEBCAM_POSITION_PRESETS,
  clampWebcamCenter,
  webcamClipPath,
  webcamPresetActive,
  webcamRect,
  webcamStateRect,
  webcamSourceRect,
  webcamZoomFactor,
} from "./webcam-layout";

const FRAME = { width: 1920, height: 1080 };
const layout = (patch: Partial<WebcamLayout>): WebcamLayout => ({ ...WEBCAM_DEFAULTS, ...patch });

describe("webcamZoomFactor with a large bubble", () => {
  it("is today's factor for sizes up to 0.42", () => {
    expect(webcamZoomFactor(0.7, 2, 0.22)).toBeCloseTo(0.7);
    expect(webcamZoomFactor(0.7, 2, 0.42)).toBeCloseTo(0.7);
  });

  it("fades the shrink linearly between 0.42 and 0.90", () => {
    // size 0.66 is halfway: weight 0.5, so 1 - 0.3 * 0.5.
    expect(webcamZoomFactor(0.7, 2, 0.66)).toBeCloseTo(0.85);
  });

  it("never shrinks a 0.90 bubble", () => {
    expect(webcamZoomFactor(0.7, 2, 0.9)).toBe(1);
    expect(webcamZoomFactor(0.3, 3, 0.9)).toBe(1);
  });
});

describe("webcamRect at the largest size", () => {
  it("draws a 0.90 bubble at 972 px on 1920x1080 under a 2x zoom", () => {
    const rect = webcamRect(
      layout({ size: 0.9, position: { x: 0.5, y: 0.5 }, scaleDuringZoom: 0.7 }),
      FRAME,
      2,
    )!;
    expect(rect.height).toBeCloseTo(972);
    expect(rect.width).toBeCloseTo(972);
  });
});

describe("webcamZoomFactor", () => {
  it("is 1 without a zoom, whatever scaleDuringZoom says", () => {
    expect(webcamZoomFactor(0.7, 1, 0.22)).toBe(1);
  });

  it("reaches scaleDuringZoom at 1.5× and stays there", () => {
    expect(webcamZoomFactor(0.7, 1.5, 0.22)).toBeCloseTo(0.7);
    expect(webcamZoomFactor(0.7, 3, 0.22)).toBeCloseTo(0.7);
  });

  it("eases in between, so the bubble follows the camera's spring", () => {
    expect(webcamZoomFactor(0.7, 1.25, 0.22)).toBeCloseTo(0.85);
  });

  it("never shrinks when the toggle is off (scaleDuringZoom 1)", () => {
    expect(webcamZoomFactor(1, 2.5, 0.22)).toBe(1);
  });

  it("treats a non-finite camera scale as no zoom", () => {
    expect(webcamZoomFactor(0.7, Number.NaN, 0.22)).toBe(1);
  });
});

describe("webcamRect", () => {
  it("sizes the bubble as a fraction of the OUTPUT height and centres it on the position", () => {
    const rect = webcamRect(layout({ size: 0.2, position: { x: 0.5, y: 0.5 } }), FRAME);
    expect(rect).toEqual({ x: 960 - 108, y: 540 - 108, width: 216, height: 216 });
  });

  it("keeps the whole bubble inside the frame when the centre is at a corner", () => {
    const rect = webcamRect(layout({ size: 0.2, position: { x: 0, y: 1 } }), FRAME)!;
    expect(rect.x).toBe(0);
    expect(rect.y + rect.height).toBe(1080);
  });

  it("shrinks during a zoom by the camera path's scale, around the same centre", () => {
    const flat = webcamRect(layout({ size: 0.2, position: { x: 0.5, y: 0.5 } }), FRAME, 1)!;
    const zoomed = webcamRect(
      layout({ size: 0.2, position: { x: 0.5, y: 0.5 }, scaleDuringZoom: 0.5 }),
      FRAME,
      2,
    )!;
    expect(zoomed.height).toBeCloseTo(flat.height * 0.5);
    expect(zoomed.x + zoomed.width / 2).toBeCloseTo(flat.x + flat.width / 2);
  });

  it("is in the frame's own units: a 1×1 frame gives fractions", () => {
    const rect = webcamRect(layout({ size: 0.5, position: { x: 0.5, y: 0.5 } }), {
      width: 1,
      height: 1,
    });
    expect(rect).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  });

  it("draws the rectangle 3:4 portrait: size is its height, the width follows", () => {
    const rect = webcamRect(
      layout({ shape: "rectangle", size: 0.4, position: { x: 0.5, y: 0.5 } }),
      FRAME,
    );
    expect(rect).toEqual({ x: 960 - 162, y: 540 - 216, width: 324, height: 432 });
  });

  it("keeps the rectangle's aspect when a narrow frame caps its width", () => {
    const rect = webcamRect(
      layout({ shape: "rectangle", size: 0.6, position: { x: 0.5, y: 0.5 } }),
      { width: 300, height: 1000 },
    )!;
    expect(rect.width).toBeCloseTo(300);
    expect(rect.height).toBeCloseTo(400);
  });

  it("is null for a frame whose size is not known yet", () => {
    expect(webcamRect(WEBCAM_DEFAULTS, { width: 0, height: 0 })).toBeNull();
  });
});

describe("clampWebcamCenter", () => {
  it("leaves a centre that already fits alone", () => {
    expect(clampWebcamCenter({ x: 0.5, y: 0.4 }, { width: 100, height: 100 }, FRAME)).toEqual({
      x: 0.5,
      y: 0.4,
    });
  });

  it("centres a bubble wider than a narrow frame", () => {
    const box = { width: 400, height: 400 };
    expect(clampWebcamCenter({ x: 0.1, y: 0.5 }, box, { width: 300, height: 1000 }).x).toBe(0.5);
  });

  it("clamps each axis by the box's own side", () => {
    const c = clampWebcamCenter({ x: 0, y: 0 }, { width: 300, height: 400 }, FRAME);
    expect(c.x * 1920).toBeCloseTo(150);
    expect(c.y * 1080).toBeCloseTo(200);
  });
});

describe("webcamClipPath", () => {
  it("cuts a circle, or a square with the corner a share of its side", () => {
    expect(webcamClipPath("circle", 0.3)).toBe("circle(50% at 50% 50%)");
    expect(webcamClipPath("rounded", 0.18)).toBe("inset(0 round 18% / 18%)");
    expect(webcamClipPath("rounded", 0)).toBe("inset(0 round 0% / 0%)");
  });

  it("keeps the rectangle's corners circular: the vertical radius is scaled by 3/4", () => {
    // r = 0.2 × width; as a share of the height that is 0.2 × 3/4 = 15 %.
    expect(webcamClipPath("rectangle", 0.2)).toBe("inset(0 round 20% / 15%)");
    expect(webcamClipPath("rectangle", 0.5)).toBe("inset(0 round 50% / 37.5%)");
  });
});

describe("webcam presets", () => {
  it("offers nine positions", () => {
    expect(WEBCAM_POSITION_PRESETS).toHaveLength(9);
  });

  it("reports a preset active for the raw edge and for a centre clamped to it", () => {
    const l = { shape: "rectangle", size: 0.42 } as const;
    const left = WEBCAM_POSITION_PRESETS.find((p) => p.id === "left")!;
    const right = WEBCAM_POSITION_PRESETS.find((p) => p.id === "right")!;
    expect(webcamPresetActive(left, { ...l, position: { x: 0, y: 0.5 } }, FRAME)).toBe(true);
    // half of the shrunk box (0.7 x 0.42 x 1080 x 3/4 / 2) over the frame width: also the edge
    expect(webcamPresetActive(left, { ...l, position: { x: 0.0775, y: 0.5 } }, FRAME)).toBe(true);
    expect(webcamPresetActive(right, { ...l, position: { x: 0.0775, y: 0.5 } }, FRAME)).toBe(false);
    expect(webcamPresetActive(left, { ...l, position: { x: 0.3, y: 0.5 } }, FRAME)).toBe(false);
  });

  it("is never active before the frame size is known", () => {
    const l = { shape: "circle", size: 0.2, position: { x: 1, y: 0 } } as const;
    expect(webcamPresetActive({ x: 1, y: 0 }, l, { width: 0, height: 0 })).toBe(false);
  });
});

describe("edge presets (NIW2-636)", () => {
  // The bug: the Left/Right presets stored a centre with a margin computed for the
  // un-shrunk bubble, so under "shrink during zoom" the smaller bubble sat ~94 px
  // (output pixels) away from the edge it was snapped to.
  const rectangle = { shape: "rectangle", size: 0.42, scaleDuringZoom: 0.7 } as const;

  it.each([
    ["left", 1],
    ["right", 1],
    ["left", 2],
    ["right", 2],
  ] as const)("puts the %s preset flush with the frame edge at camera scale %s", (id, scale) => {
    const preset = WEBCAM_POSITION_PRESETS.find((p) => p.id === id)!;
    const position = { x: preset.x, y: preset.y };
    const rect = webcamRect({ ...rectangle, position }, FRAME, scale)!;
    if (id === "left") expect(rect.x).toBeCloseTo(0, 3);
    else expect(rect.x + rect.width).toBeCloseTo(FRAME.width, 3);
  });
});

describe("webcamSourceRect", () => {
  const IMAGE = { width: 1280, height: 720 };

  it("shows the centred square cover puts in the bubble without framing", () => {
    expect(webcamSourceRect(IMAGE, { zoom: 1, x: 0, y: 0 }, false)).toEqual({
      sx: 280,
      sy: 0,
      sw: 720,
      sh: 720,
    });
  });

  it("ignores the pan at zoom 1, where there is nothing to pan", () => {
    expect(webcamSourceRect(IMAGE, { zoom: 1, x: 1, y: -1 }, true)).toEqual(
      webcamSourceRect(IMAGE, { zoom: 1, x: 0, y: 0 }, false),
    );
  });

  it("narrows to 1/zoom of the square, centred", () => {
    expect(webcamSourceRect(IMAGE, { zoom: 2, x: 0, y: 0 }, false)).toEqual({
      sx: 460,
      sy: 180,
      sw: 360,
      sh: 360,
    });
  });

  it("pans to the square's edge at x = 1 and y = 1, never past it", () => {
    // zoom 2: the window is 360 px, its centre moves 180 px: right/bottom edge of the square.
    const r = webcamSourceRect(IMAGE, { zoom: 2, x: 1, y: 1 }, false);
    expect(r.sx + r.sw).toBe(1000); // 280 + 720, the cover square's right edge
    expect(r.sy + r.sh).toBe(720);
    expect(webcamSourceRect(IMAGE, { zoom: 2, x: 3, y: -3 }, false)).toEqual(
      webcamSourceRect(IMAGE, { zoom: 2, x: 1, y: -1 }, false),
    );
  });

  it("moves the other way in the raw image when mirrored: x = 1 shows the bubble's right", () => {
    // Mirrored, the right of what the bubble shows is the LEFT of the raw image.
    const r = webcamSourceRect(IMAGE, { zoom: 2, x: 1, y: 0 }, true);
    expect(r.sx).toBe(280);
  });

  it("clamps the framing exactly like the preview's framingTransform", () => {
    // Past the 3× cap, and between zoom steps: the preview shows 3× and 1.25×.
    expect(webcamSourceRect(IMAGE, { zoom: 9, x: 0, y: 0 }, false)).toEqual(
      webcamSourceRect(IMAGE, { zoom: 3, x: 0, y: 0 }, false),
    );
    expect(webcamSourceRect(IMAGE, { zoom: 1.26, x: 0, y: 0 }, false)).toEqual(
      webcamSourceRect(IMAGE, { zoom: 1.25, x: 0, y: 0 }, false),
    );
    // Pans round to two decimals; a non-number falls back like the preview's does.
    expect(webcamSourceRect(IMAGE, { zoom: 2, x: 0.504, y: 0 }, false)).toEqual(
      webcamSourceRect(IMAGE, { zoom: 2, x: 0.5, y: 0 }, false),
    );
    expect(webcamSourceRect(IMAGE, { zoom: Number.NaN, x: Number.NaN, y: 0 }, false)).toEqual(
      webcamSourceRect(IMAGE, { zoom: 1, x: 0, y: 0 }, false),
    );
  });

  it("works for a portrait image (cover picks the width)", () => {
    expect(webcamSourceRect({ width: 720, height: 1280 }, { zoom: 1, x: 0, y: 0 }, false)).toEqual({
      sx: 0,
      sy: 280,
      sw: 720,
      sh: 720,
    });
  });

  it("covers a 3:4 box from a 16:9 image: full height, 3/4 of it wide, centred", () => {
    expect(webcamSourceRect(IMAGE, { zoom: 1, x: 0, y: 0 }, false, 3 / 4)).toEqual({
      sx: 370,
      sy: 0,
      sw: 540,
      sh: 720,
    });
  });

  it("pans a 3:4 window to the cover's edge on each axis by its own length", () => {
    const r = webcamSourceRect(IMAGE, { zoom: 2, x: 1, y: 1 }, false, 3 / 4);
    expect(r.sw).toBe(270);
    expect(r.sh).toBe(360);
    expect(r.sx + r.sw).toBe(910); // 370 + 540, the cover window's right edge
    expect(r.sy + r.sh).toBe(720);
  });
});

describe("webcamRect on a portrait output", () => {
  it("never makes the bubble wider than the frame (0.6 of a 1920 px height on 1080 px)", () => {
    const rect = webcamRect(layout({ size: 0.6, position: { x: 1, y: 1 } }), {
      width: 1080,
      height: 1920,
    })!;
    expect(rect.width).toBe(1080);
    expect(rect.x).toBe(0);
    expect(rect.y + rect.height).toBe(1920);
  });
});

describe("webcamStateRect", () => {
  const sceneWith = (
    position: { x: number; y: number },
    easing: "back" | "linear",
    from: { x: number; y: number },
  ) => {
    const webcam: WebcamScene = {
      layout: { ...WEBCAM_DEFAULTS, position: from, size: 0.2 },
      segments: [
        {
          id: "a",
          start: 10,
          end: 20,
          mode: "override",
          layout: { position },
          transition: { kind: "slide", ms: 1000, easing },
        },
      ],
    };
    return { webcam };
  };
  /** The rect at 101 evenly spaced instants of the slide, from its start to its end. */
  const run = (scene: ReturnType<typeof sceneWith>) =>
    Array.from({ length: 101 }, (_, i) =>
      webcamStateRect(webcamStateAt(scene, 10 + i / 100)!, FRAME),
    );
  const inside = (r: { x: number; y: number; width: number; height: number }): boolean =>
    r.x >= -1e-6 &&
    r.y >= -1e-6 &&
    r.x + r.width <= FRAME.width + 1e-6 &&
    r.y + r.height <= FRAME.height + 1e-6;

  it("is webcamRect when nothing moves", () => {
    const state: WebcamState = {
      layout: layout({ position: { x: 0.3, y: 0.4 } }),
      from: null,
      progress: 1,
      easing: "linear",
    };
    expect(webcamStateRect(state, FRAME)).toEqual(webcamRect(state.layout, FRAME));
    expect(webcamStateRect(state, { width: 0, height: 0 })).toBeNull();
  });

  it("starts on the previous position and ends on the target", () => {
    const rects = run(sceneWith({ x: 0.5, y: 0.5 }, "back", { x: 0.1, y: 0.1 }));
    const origin = webcamRect(layout({ position: { x: 0.1, y: 0.1 }, size: 0.2 }), FRAME)!;
    const target = webcamRect(layout({ position: { x: 0.5, y: 0.5 }, size: 0.2 }), FRAME)!;
    expect(rects[0]).toEqual(origin);
    expect(rects[100]).toEqual(target);
  });

  it("interpolates the centre linearly while the progress is at most 1", () => {
    const scene = sceneWith({ x: 0.5, y: 0.5 }, "linear", { x: 0.1, y: 0.1 });
    const mid = webcamStateRect(webcamStateAt(scene, 10.5)!, FRAME)!;
    const a = webcamRect(layout({ position: { x: 0.1, y: 0.1 }, size: 0.2 }), FRAME)!;
    const b = webcamRect(layout({ position: { x: 0.5, y: 0.5 }, size: 0.2 }), FRAME)!;
    expect(mid.x).toBeCloseTo((a.x + b.x) / 2);
    expect(mid.y).toBeCloseTo((a.y + b.y) / 2);
  });

  it("stays inside the frame at every sampled time of a back slide toward a corner", () => {
    const corners = [
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    for (const corner of corners) {
      const rects = run(sceneWith(corner, "back", { x: 0.5, y: 0.5 }));
      expect(rects.every((r) => r && inside(r))).toBe(true);
    }
  });

  it("never overshoots a target that touches the edge", () => {
    const rects = run(sceneWith({ x: 1, y: 1 }, "back", { x: 0.2, y: 0.2 }));
    const target = webcamRect(layout({ position: { x: 1, y: 1 }, size: 0.2 }), FRAME)!;
    for (const r of rects) {
      expect(r!.x).toBeLessThanOrEqual(target.x + 1e-6);
      expect(r!.y).toBeLessThanOrEqual(target.y + 1e-6);
    }
  });

  it("keeps a visible overshoot toward a target with room, inside the frame", () => {
    const rects = run(sceneWith({ x: 0.5, y: 0.5 }, "back", { x: 0.1, y: 0.5 }));
    const target = webcamRect(layout({ position: { x: 0.5, y: 0.5 }, size: 0.2 }), FRAME)!;
    const farthest = Math.max(...rects.map((r) => r!.x));
    const distance =
      target.x - webcamRect(layout({ position: { x: 0.1, y: 0.5 }, size: 0.2 }), FRAME)!.x;
    expect(farthest).toBeGreaterThan(target.x + 1);
    // The full back curve fits in this room, so the peak is the curve's own.
    expect(farthest - target.x).toBeCloseTo(EASING_PEAK_OVERSHOOT.back * distance, 0);
    expect(rects.every((r) => r && inside(r))).toBe(true);
  });

  it("overshoots on x only when y has no room", () => {
    const rects = run(sceneWith({ x: 0.5, y: 1 }, "back", { x: 0.1, y: 0.3 }));
    const target = webcamRect(layout({ position: { x: 0.5, y: 1 }, size: 0.2 }), FRAME)!;
    expect(Math.max(...rects.map((r) => r!.x))).toBeGreaterThan(target.x + 1);
    expect(Math.max(...rects.map((r) => r!.y))).toBeLessThanOrEqual(target.y + 1e-6);
    expect(rects.every((r) => r && inside(r))).toBe(true);
  });

  it("scales the whole peak down to the room instead of flattening it", () => {
    // Centre 0.9 on a 216 px bubble leaves 84 px to the edge, less than the curve's 10 % peak.
    const target = layout({ position: { x: 0.9, y: 0.5 }, size: 0.2 });
    const targetRect = webcamRect(target, FRAME)!;
    const room = FRAME.width - (targetRect.x + targetRect.width);
    const from = layout({ position: { x: 0.1, y: 0.5 }, size: 0.2 });
    const distance = targetRect.x - webcamRect(from, FRAME)!.x;
    expect(EASING_PEAK_OVERSHOOT.back * distance).toBeGreaterThan(room);
    const samples = Array.from({ length: 1001 }, (_, i) => {
      const progress = easeValue("back", i / 1000);
      return webcamStateRect({ layout: target, from, progress, easing: "back" }, FRAME)!;
    });
    const peak = Math.max(...samples.map((r) => r.x + r.width));
    expect(peak).toBeCloseTo(FRAME.width, 3);
    const flat = samples.filter((r) => r.x + r.width > FRAME.width - 1e-3);
    expect(flat.length).toBeLessThan(5);
    expect(samples.every(inside)).toBe(true);
  });
});
