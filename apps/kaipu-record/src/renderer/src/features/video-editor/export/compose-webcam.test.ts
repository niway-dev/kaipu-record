import { describe, expect, it } from "vitest";
import {
  WEBCAM_DEFAULTS,
  webcamStateAt,
  type WebcamLayout,
  type WebcamScene,
  type WebcamTransition,
} from "../webcam/webcam-model";
import { WEBCAM_POSITION_PRESETS, webcamStateRect } from "../webcam/webcam-layout";
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
  rect: { x: number; y: number; width: number; height: number },
  frame: { width: number; height: number },
): boolean =>
  rect.x >= -1e-9 &&
  rect.y >= -1e-9 &&
  rect.x + rect.width <= frame.width + 1e-9 &&
  rect.y + rect.height <= frame.height + 1e-9;

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
    expect(plan.rect.height).toBeCloseTo(432);
    expect(plan.shape).toBe("rounded");
  });

  it("shrinks with the camera path's scale (scaleDuringZoom), like the preview", () => {
    const frame = { width: 1920, height: 1080 };
    const s = scene({ size: 0.2, scaleDuringZoom: 0.5 });
    expect(planWebcamDraw(s, 0, frame, 1, IMAGE)!.rect.height).toBeCloseTo(216);
    expect(planWebcamDraw(s, 0, frame, 2, IMAGE)!.rect.height).toBeCloseTo(108);
  });

  it("plans a 3:4 rectangle with a 3:4 window of the image and its corner", () => {
    const frame = { width: 1920, height: 1080 };
    const s = scene({ shape: "rectangle", size: 0.4, cornerRadius: 0.25 });
    const plan = planWebcamDraw(s, 0, frame, 1, IMAGE)!;
    expect(plan.rect.width / plan.rect.height).toBeCloseTo(3 / 4);
    expect(plan.src.sw / plan.src.sh).toBeCloseTo(3 / 4);
    expect(plan.cornerRadius).toBe(0.25);
  });

  describe("camera sections (ADR 0039)", () => {
    const frame = { width: 1920, height: 1080 };
    const TARGET = { x: 0.88, y: 0.18 };
    // The default sits bottom-left; the block from 10 s moves the bubble to the top right.
    const block = (transition?: WebcamTransition): WebcamScene =>
      scene({ position: { x: 0.12, y: 0.82 } }, [
        {
          id: "b",
          start: 10,
          end: 20,
          mode: "override",
          layout: { position: TARGET },
          ...(transition ? { transition } : {}),
        },
      ]);
    const SLIDE: WebcamTransition = { kind: "slide", ms: 700, easing: "back" };

    it("moves the bubble through distinct places, inside the frame, while a slide plays", () => {
      const s = block(SLIDE);
      const xs = [10.1, 10.25, 10.4].map((t) => {
        const plan = planWebcamDraw(s, t, frame, 1, IMAGE)!;
        expect(inside(plan.rect, frame)).toBe(true);
        return plan.rect.x;
      });
      expect(new Set(xs.map((x) => x.toFixed(3))).size).toBe(3);
      // And it ends on the target once the slide is over.
      const settled = planWebcamDraw(s, 11, frame, 1, IMAGE)!;
      const at = planWebcamDraw(scene({ position: TARGET }), 0, frame, 1, IMAGE)!;
      expect(settled.rect.x).toBeCloseTo(at.rect.x);
      expect(settled.rect.y).toBeCloseTo(at.rect.y);
    });

    it("agrees with the preview's formula at the same source time", () => {
      const s = block(SLIDE);
      for (const t of [9.9, 10, 10.1, 10.3, 10.6, 10.7, 15]) {
        const state = webcamStateAt({ webcam: s }, t)!;
        const preview = webcamStateRect(state, frame, 1.3)!;
        const plan = planWebcamDraw(s, t, frame, 1.3, IMAGE)!;
        expect(plan.rect).toEqual(preview);
      }
    });

    it("a Cut jumps at the block's start with no place in between", () => {
      const cut = block({ kind: "cut", ms: 700, easing: "back" });
      const before = planWebcamDraw(cut, 9.999, frame, 1, IMAGE)!.rect;
      const during = [10, 10.1, 10.35, 10.69].map(
        (t) => planWebcamDraw(cut, t, frame, 1, IMAGE)!.rect,
      );
      for (const rect of during) expect(rect).toEqual(during[0]);
      expect(during[0]!.x).not.toBeCloseTo(before.x);
    });

    it("takes every other field from the layout in force at once, with no animation", () => {
      const s = scene({}, [
        {
          id: "b",
          start: 10,
          end: 20,
          mode: "override",
          layout: { position: TARGET, shape: "rounded", mirrored: false, shadow: false },
          transition: SLIDE,
        },
      ]);
      const plan = planWebcamDraw(s, 10.05, frame, 1, IMAGE)!;
      expect(plan.shape).toBe("rounded");
      expect(plan.mirrored).toBe(false);
      expect(plan.shadow).toBe(false);
    });
  });

  // Failure 10: the layer is placed in the OUTPUT canvas (after the framer), so Fill cannot
  // crop it and Fit cannot shrink it into the padding.
  describe.each([
    ["Vertical (Fill)", { width: 1080, height: 1920 }],
    ["Square (Fit)", { width: 1080, height: 1080 }],
  ])("%s keeps the whole bubble inside the output", (_name, frame) => {
    it.each(
      WEBCAM_POSITION_PRESETS.flatMap((p) =>
        (["circle", "rectangle"] as const).map((shape) => [p.id, shape, p] as const),
      ),
    )("at %s (%s)", (_id, shape, preset) => {
      const size = 0.6; // the largest bubble
      const position = { x: preset.x, y: preset.y };
      const plan = planWebcamDraw(scene({ shape, size, position }), 0, frame, 1, IMAGE)!;
      expect(inside(plan.rect, frame)).toBe(true);
    });

    it("from a corner stored on the landscape frame, flush with the output's own corner", () => {
      const plan = planWebcamDraw(scene({ position: { x: 1, y: 1 } }), 0, frame, 1, IMAGE)!;
      expect(inside(plan.rect, frame)).toBe(true);
      expect(plan.rect.x + plan.rect.width).toBeCloseTo(frame.width);
      expect(plan.rect.y + plan.rect.height).toBeCloseTo(frame.height);
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
      plan.rect.width,
      plan.rect.height,
    ]);
    expect(calls).not.toContain("scale");
  });

  it("flips the image once when mirrored", () => {
    const { ctx, log } = fakeCtx();
    const plan = planWebcamDraw(scene({ mirrored: true, shadow: false }), 0, frame, 1, IMAGE)!;
    drawWebcamLayer(ctx, {} as CanvasImageSource, plan);
    expect(log.filter((entry) => entry[0] === "scale")).toEqual([["scale", -1, 1]]);
    expect(log).toContainEqual(["translate", plan.rect.x + plan.rect.width, plan.rect.y]);
    expect(log.map((entry) => entry[0])).not.toContain("fill");
  });

  it("clips a circle to the bubble's inscribed circle and a rounded square with arcs", () => {
    const circle = fakeCtx();
    const c = planWebcamDraw(scene({ shape: "circle", shadow: false }), 0, frame, 1, IMAGE)!;
    drawWebcamLayer(circle.ctx, {} as CanvasImageSource, c);
    expect(circle.log).toContainEqual([
      "arc",
      c.rect.x + c.rect.width / 2,
      c.rect.y + c.rect.height / 2,
      c.rect.width / 2,
      0,
      Math.PI * 2,
    ]);
    const rounded = fakeCtx();
    const r = planWebcamDraw(scene({ shape: "rounded", shadow: false }), 0, frame, 1, IMAGE)!;
    drawWebcamLayer(rounded.ctx, {} as CanvasImageSource, r);
    expect(rounded.log.filter((entry) => entry[0] === "arcTo")).toHaveLength(4);
  });

  it("rounds the corners by the layout's radius times the shorter side", () => {
    const sharp = fakeCtx();
    const s = planWebcamDraw(
      scene({ shape: "rectangle", cornerRadius: 0, shadow: false }),
      0,
      frame,
      1,
      IMAGE,
    )!;
    drawWebcamLayer(sharp.ctx, {} as CanvasImageSource, s);
    const sharpArcs = sharp.log.filter((entry) => entry[0] === "arcTo");
    expect(sharpArcs.every((entry) => entry[5] === 0)).toBe(true);
    const pill = fakeCtx();
    const p = planWebcamDraw(
      scene({ shape: "rectangle", cornerRadius: 0.5, shadow: false }),
      0,
      frame,
      1,
      IMAGE,
    )!;
    drawWebcamLayer(pill.ctx, {} as CanvasImageSource, p);
    const pillArcs = pill.log.filter((entry) => entry[0] === "arcTo");
    expect(pillArcs[0]![5]).toBeCloseTo(p.rect.width / 2);
  });
});
