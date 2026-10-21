import { describe, expect, it } from "vitest";
import { buildCameraPath } from "../zoom/camera-path";
import type { ZoomSegment } from "../zoom/zoom-model";
import { coverLabelPx, type Redaction } from "../privacy/redaction";
import {
  applyRedactions,
  framingRect,
  type Ctx2D,
  cropRectPx,
  planClipFrame,
  type ScratchCanvas,
} from "./compose-frame";

/** Records every call and property write, in order. */
function fakeCtx(): { ctx: Ctx2D; log: unknown[][] } {
  const log: unknown[][] = [];
  const state: Record<string, unknown> = { imageSmoothingEnabled: true };
  const ctx = new Proxy({} as Ctx2D, {
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

function scratch(withContext = true): { canvas: ScratchCanvas; log: unknown[][] } {
  const { ctx, log } = fakeCtx();
  return { canvas: { width: 0, height: 0, getContext: () => (withContext ? ctx : null) }, log };
}

/** Stands in for the WORK canvas: regions sample the pixels composed so far, not the decoded frame. */
const WORK = {} as CanvasImageSource;
const W = 1000;
const H = 500;

const blur = (partial: Partial<Redaction> = {}): Redaction =>
  ({
    id: "b",
    kind: "blur",
    start: 1,
    end: 3,
    rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
    intensity: 100,
    style: "gaussian",
    ...partial,
  }) as Redaction;

const ZOOM: ZoomSegment = {
  id: "z",
  start: 0,
  end: 10,
  scale: 2,
  mode: "fixed",
  anchor: { x: 0.25, y: 0.25 },
  smoothing: 0,
  origin: "manual",
  trigger: null,
};

describe("cropRectPx", () => {
  it("converts the camera window to source pixels", () => {
    expect(cropRectPx({ cx: 0.25, cy: 0.25, scale: 2 }, W, H)).toEqual({
      sx: 0,
      sy: 0,
      sw: 500,
      sh: 250,
    });
  });
  it("clamps a window that Float32 rounding pushed outside the frame", () => {
    const out = cropRectPx({ cx: 0.2499, cy: 0.2499, scale: 2 }, W, H);
    expect(out.sx).toBe(0);
    expect(out.sy).toBe(0);
    expect(out.sx + out.sw).toBeLessThanOrEqual(W);
    expect(out.sy + out.sh).toBeLessThanOrEqual(H);
  });
});

describe("planClipFrame", () => {
  it("takes the direct path with no zoom and no region", () => {
    expect(planClipFrame(null, [], 1, 1 / 30, W, H)).toEqual({
      mode: "direct",
      crop: null,
      redactions: [],
    });
  });
  it("composites when a region overlaps the frame interval (edge frames included)", () => {
    const plan = planClipFrame(null, [blur({ start: 1.02 })], 1, 1 / 30, W, H);
    expect(plan.mode).toBe("composite");
    expect(plan.redactions).toHaveLength(1);
  });
  it("crops when the camera is zoomed at the frame's source time", () => {
    const path = buildCameraPath([ZOOM], null, 10);
    const plan = planClipFrame(path, [], 5, 1 / 30, W, H);
    expect(plan.mode).toBe("composite");
    expect(plan.crop!.sw).toBeCloseTo(500, 0);
  });
});

describe("applyRedactions", () => {
  it("cover: solid fill then a centered label inset by a share of the label size", () => {
    const { ctx, log } = fakeCtx();
    const cover: Redaction = {
      id: "c",
      kind: "cover",
      start: 0,
      end: 1,
      rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
      fill: "#F6055C",
      label: "API key",
    };
    applyRedactions(ctx, WORK, [cover], W, H, scratch().canvas, true);
    expect(log[0]).toEqual(["=fillStyle", "#F6055C"]);
    expect(log[1]).toEqual(["fillRect", 0, 0, 500, 250]);
    const label = log.at(-1)!;
    expect(label.slice(0, 4)).toEqual(["fillText", "API key", 250, 125]);
    expect(label[4] as number).toBeCloseTo(500 - coverLabelPx(H) * 0.8, 9);
  });

  it("gaussian: clipped, filtered redraw from the composed canvas with a 3σ margin", () => {
    const { ctx, log } = fakeCtx();
    applyRedactions(ctx, WORK, [blur()], W, H, scratch().canvas, true);
    const filter = log.find((e) => e[0] === "=filter" && String(e[1]).startsWith("blur("));
    expect(filter![1]).toMatch(/^blur\(14\.3\d*px\)$/); // 11/382 × 500
    const draw = log.find((e) => e[0] === "drawImage")!;
    expect(draw.slice(0, 2)).toEqual(["drawImage", WORK]);
    expect(log.map((e) => e[0])).toEqual(
      expect.arrayContaining(["save", "beginPath", "rect", "clip", "restore"]),
    );
  });

  it("gaussian: fills the clip opaque BEFORE the filtered draw (no fade onto the original)", () => {
    const { ctx, log } = fakeCtx();
    applyRedactions(ctx, WORK, [blur()], W, H, scratch().canvas, true);
    const keys = log.map((e) => e[0]);
    const clip = keys.indexOf("clip");
    const fill = keys.indexOf("fillRect");
    const blurSet = log.findIndex((e) => e[0] === "=filter" && String(e[1]).startsWith("blur("));
    const draw = keys.indexOf("drawImage");
    expect(log[fill]).toEqual(["fillRect", 100, 100, 300, 100]); // the region itself
    expect(clip).toBeLessThan(fill);
    expect(fill).toBeLessThan(blurSet);
    expect(blurSet).toBeLessThan(draw);
    // The opaque fill must not itself be blurred, or it fades at the same edge.
    expect(log[fill - 1]).toEqual(["=fillStyle", "#18181b"]);
    expect(log[fill - 2]).toEqual(["=filter", "none"]);
  });

  it("gaussian without canvas filters falls back to the mosaic, never to nothing", () => {
    const { ctx, log } = fakeCtx();
    const s = scratch();
    applyRedactions(ctx, WORK, [blur()], W, H, s.canvas, false);
    expect(log.some((e) => e[0] === "=filter")).toBe(false);
    expect(s.canvas.width).toBeGreaterThan(0);
    expect(log.filter((e) => e[0] === "drawImage")).toHaveLength(1);
  });

  it("pixelate: downscale into cells, upscale without smoothing, restore smoothing", () => {
    const { ctx, log } = fakeCtx();
    const s = scratch();
    applyRedactions(ctx, WORK, [blur({ style: "pixelate", intensity: 100 })], W, H, s.canvas, true);
    // cell = 0.04 × 500 = 20 px → region 300 × 100 px → 15 × 5 cells
    expect([s.canvas.width, s.canvas.height]).toEqual([15, 5]);
    const writes = log.filter((e) => e[0] === "=imageSmoothingEnabled").map((e) => e[1]);
    expect(writes).toEqual([false, true]);
  });

  it("a blur over an earlier cover samples the COVER, not what it hid", () => {
    const { ctx, log } = fakeCtx();
    const cover: Redaction = {
      id: "c",
      kind: "cover",
      start: 0,
      end: 5,
      rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
      fill: "#18181b",
      label: "",
    };
    applyRedactions(ctx, WORK, [cover, blur()], W, H, scratch().canvas, true);
    // The only image the blur redraws is WORK — the canvas that now holds the cover.
    for (const entry of log.filter((e) => e[0] === "drawImage")) expect(entry[1]).toBe(WORK);
  });

  it("fails closed with a solid block when no scratch context exists", () => {
    const { ctx, log } = fakeCtx();
    applyRedactions(ctx, WORK, [blur({ style: "pixelate" })], W, H, scratch(false).canvas, true);
    expect(log).toContainEqual(["fillRect", 100, 100, 300, 100]);
  });
});

describe("framingRect (NIW2-218)", () => {
  it("Fit: whole 16:9 frame inside 1080×1920, centred vertically with padding", () => {
    const r = framingRect(1920, 1080, 1080, 1920, "fit");
    expect(r).toMatchObject({ sx: 0, sy: 0, sw: 1920, sh: 1080, dx: 0, dw: 1080 });
    expect(r.dh).toBeCloseTo(607.5);
    expect(r.dy).toBeCloseTo((1920 - 607.5) / 2);
  });

  it("Fit: a 1662×1080 frame on 1920×1080 gets side (pillar) padding", () => {
    const r = framingRect(1662, 1080, 1920, 1080, "fit");
    expect(r.dh).toBe(1080);
    expect(r.dw).toBeCloseTo(1662);
    expect(r.dx).toBeCloseTo((1920 - 1662) / 2);
  });

  it("Fill: 16:9 frame covers 1080×1920, cropping a centred window of the source", () => {
    const r = framingRect(1920, 1080, 1080, 1920, "fill");
    expect(r).toMatchObject({ dx: 0, dy: 0, dw: 1080, dh: 1920, sy: 0, sh: 1080 });
    expect(r.sw).toBeCloseTo(607.5);
    expect(r.sx + r.sw / 2).toBeCloseTo(960); // centred on the view
  });

  it("Fill: square canvas from 16:9 crops the sides equally", () => {
    const r = framingRect(1920, 1080, 1080, 1080, "fill");
    expect(r.sw).toBe(1080);
    expect(r.sx).toBe(420);
  });

  it("identical aspect: Fit and Fill agree and nothing is cropped", () => {
    expect(framingRect(1280, 720, 1920, 1080, "fit")).toEqual(
      framingRect(1280, 720, 1920, 1080, "fill"),
    );
  });
});
