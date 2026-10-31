import { describe, expect, it } from "vitest";
import { WEBCAM_DEFAULTS, type WebcamLayout, type WebcamScene } from "../webcam/webcam-model";
import { WEBCAM_POSITION_PRESETS, webcamPresetCenter } from "../webcam/webcam-layout";
import { drawWebcamLayer, planWebcamDraw, type WebcamCtx } from "./compose-webcam";

const IMAGE = { width: 1280, height: 720 };
const layout = (patch: Partial<WebcamLayout> = {}): WebcamLayout => ({
  ...WEBCAM_DEFAULTS,
  ...patch,
});
const scene = (patch: Partial<WebcamLayout> = {}, segments: WebcamScene["segments"] = []) => ({
  layout: layout(patch),
  segments,
});

function fakeCtx(): { ctx: WebcamCtx; log: unknown[][] } {
  const log: unknown[][] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy({} as WebcamCtx, {
    get: (_t, key: string) =>
      key in state ? state[key] : (...args: unknown[]) => void log.push([key, ...args]),
    set: (_t, key: string, value) => {
      state[key] = value;
      log.push([`=${key}`, value]);
      return true;
    },
  });
  return { ctx, log };
}

const inside = (
  rect: { x: number; y: number; size: number },
  frame: { width: number; height: number },
): boolean =>
  rect.x >= -1e-9 &&
  rect.y >= -1e-9 &&
  rect.x + rect.size <= frame.width + 1e-9 &&
  rect.y + rect.size <= frame.height + 1e-9;

describe("planWebcamDraw", () => {
  it("is null without a webcam, without a decoded frame, and inside a hidden segment", () => {
    const frame = { width: 1920, height: 1080 };
    expect(planWebcamDraw(null, 1, frame, 1, IMAGE)).toBeNull();
    expect(planWebcamDraw(scene(), 1, frame, 1, null)).toBeNull();
    const hidden = scene({}, [{ id: "h", start: 2, end: 4, mode: "hidden" }]);
    expect(planWebcamDraw(hidden, 3, frame, 1, IMAGE)).toBeNull();
    expect(planWebcamDraw(hidden, 4, frame, 1, IMAGE)).not.toBeNull();
  });

  it("uses an override's fields inside its segment", () => {
    const frame = { width: 1920, height: 1080 };
    const s = scene({ size: 0.2 }, [
      { id: "o", start: 0, end: 5, mode: "override", layout: { size: 0.4, shape: "rounded" } },
    ]);
    const plan = planWebcamDraw(s, 1, frame, 1, IMAGE)!;
    expect(plan.rect.size).toBeCloseTo(432);
    expect(plan.shape).toBe("rounded");
  });

  it("shrinks with the camera path's scale (scaleDuringZoom), like the preview", () => {
    const frame = { width: 1920, height: 1080 };
    const s = scene({ size: 0.2, scaleDuringZoom: 0.5 });
    expect(planWebcamDraw(s, 0, frame, 1, IMAGE)!.rect.size).toBeCloseTo(216);
    expect(planWebcamDraw(s, 0, frame, 2, IMAGE)!.rect.size).toBeCloseTo(108);
  });

  // Failure 10: the layer is placed in the OUTPUT canvas (after the framer), so Fill cannot
  // crop it and Fit cannot shrink it into the padding.
  describe.each([
    ["Vertical (Fill)", { width: 1080, height: 1920 }],
    ["Square (Fit)", { width: 1080, height: 1080 }],
  ])("%s keeps the whole bubble inside the output", (_name, frame) => {
    it.each(WEBCAM_POSITION_PRESETS.map((p) => [p.id, p] as const))("at %s", (_id, preset) => {
      const size = 0.6; // the largest bubble
      const position = webcamPresetCenter(preset, size, { width: 1920, height: 1080 });
      const plan = planWebcamDraw(scene({ size, position }), 0, frame, 1, IMAGE)!;
      expect(inside(plan.rect, frame)).toBe(true);
    });

    it("from a corner stored on the landscape frame, flush with the output's own corner", () => {
      const plan = planWebcamDraw(scene({ position: { x: 1, y: 1 } }), 0, frame, 1, IMAGE)!;
      expect(inside(plan.rect, frame)).toBe(true);
      expect(plan.rect.x + plan.rect.size).toBeCloseTo(frame.width);
      expect(plan.rect.y + plan.rect.size).toBeCloseTo(frame.height);
    });
  });
});

describe("drawWebcamLayer", () => {
  const frame = { width: 1920, height: 1080 };

  it("draws the shadow first, then clips to the shape and draws the image into the square", () => {
    const { ctx, log } = fakeCtx();
    const plan = planWebcamDraw(scene({ mirrored: false, shadow: true }), 0, frame, 1, IMAGE)!;
    drawWebcamLayer(ctx, {} as CanvasImageSource, plan);
    const calls = log.map((entry) => entry[0]);
    expect(calls.indexOf("fill")).toBeLessThan(calls.indexOf("clip"));
    expect(calls.indexOf("clip")).toBeLessThan(calls.indexOf("drawImage"));
    const draw = log.find((entry) => entry[0] === "drawImage")!;
    expect(draw.slice(2)).toEqual([
      plan.src.sx,
      plan.src.sy,
      plan.src.sw,
      plan.src.sh,
      plan.rect.x,
      plan.rect.y,
      plan.rect.size,
      plan.rect.size,
    ]);
    expect(calls).not.toContain("scale");
  });

  it("flips the image once when mirrored", () => {
    const { ctx, log } = fakeCtx();
    const plan = planWebcamDraw(scene({ mirrored: true, shadow: false }), 0, frame, 1, IMAGE)!;
    drawWebcamLayer(ctx, {} as CanvasImageSource, plan);
    expect(log.filter((entry) => entry[0] === "scale")).toEqual([["scale", -1, 1]]);
    expect(log).toContainEqual(["translate", plan.rect.x + plan.rect.size, plan.rect.y]);
    expect(log.map((entry) => entry[0])).not.toContain("fill");
  });

  it("clips a circle to the bubble's inscribed circle and a rounded square with arcs", () => {
    const circle = fakeCtx();
    const c = planWebcamDraw(scene({ shape: "circle", shadow: false }), 0, frame, 1, IMAGE)!;
    drawWebcamLayer(circle.ctx, {} as CanvasImageSource, c);
    expect(circle.log).toContainEqual([
      "arc",
      c.rect.x + c.rect.size / 2,
      c.rect.y + c.rect.size / 2,
      c.rect.size / 2,
      0,
      Math.PI * 2,
    ]);
    const rounded = fakeCtx();
    const r = planWebcamDraw(scene({ shape: "rounded", shadow: false }), 0, frame, 1, IMAGE)!;
    drawWebcamLayer(rounded.ctx, {} as CanvasImageSource, r);
    expect(rounded.log.filter((entry) => entry[0] === "arcTo")).toHaveLength(4);
  });
});
