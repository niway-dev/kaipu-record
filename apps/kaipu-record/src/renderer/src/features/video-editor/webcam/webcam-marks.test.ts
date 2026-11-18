import { describe, expect, it } from "vitest";
import { webcamMarks } from "./webcam-marks";
import { webcamRoute } from "./webcam-route";
import { webcamRect, webcamStateRect } from "./webcam-layout";
import {
  WEBCAM_DEFAULTS,
  webcamStateAt,
  type WebcamScene,
  type WebcamSegment,
} from "./webcam-model";

const FRAME = { width: 1920, height: 1080 };

const part = (id: string, start: number, end: number, patch: Partial<WebcamSegment> = {}) =>
  ({
    id,
    start,
    end,
    mode: "override",
    layout: { position: { x: 0.8, y: 0.2 } },
    transition: { kind: "slide", ms: 700, easing: "ease-in-out" },
    ...patch,
  }) satisfies WebcamSegment;
const scene = (...segments: WebcamSegment[]): WebcamScene => ({
  layout: { ...WEBCAM_DEFAULTS },
  segments,
});
const marksAt = (
  webcam: WebcamScene,
  sourceTime: number | null,
  selectedId: string | null = null,
) => webcamMarks({ webcam, sourceTime, selectedId, frame: FRAME, endSeconds: 60 });

describe("webcamMarks: the label", () => {
  it("says 'original' outside every part", () => {
    expect(marksAt(scene(part("a", 10, 20)), 5)?.label).toEqual({ kind: "original" });
  });

  it("gives the part's range inside a settled part", () => {
    expect(marksAt(scene(part("a", 10, 20)), 15)?.label).toEqual({
      kind: "part",
      start: 10,
      end: 20,
    });
  });

  it("says 'sliding' while the bubble is moving, and shows no route then", () => {
    const marks = marksAt(scene(part("a", 10, 20)), 10.3);
    expect(marks?.label).toEqual({ kind: "sliding" });
    expect(marks?.from).toBeNull();
  });

  it("has no marks over a slide clip (no source time)", () => {
    expect(marksAt(scene(part("a", 10, 20)), null)).toBeNull();
  });
});

describe("webcamMarks: the route, ghost and chip", () => {
  it("has no route with no part in force and none selected", () => {
    expect(marksAt(scene(part("a", 10, 20)), 5)?.from).toBeNull();
  });

  it("draws the route of the part under the playhead, from the original position to the part", () => {
    const marks = marksAt(scene(part("a", 10, 20)), 15)!;
    const origin = webcamRect(WEBCAM_DEFAULTS, FRAME)!;
    const target = webcamRect({ ...WEBCAM_DEFAULTS, position: { x: 0.8, y: 0.2 } }, FRAME)!;
    const center = (r: { x: number; y: number; width: number; height: number }) => ({
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
    });
    const reach = {
      minX: target.width / 2,
      maxX: FRAME.width - target.width / 2,
      minY: target.height / 2,
      maxY: FRAME.height - target.height / 2,
    };
    // The same curve the preview plays, not a second one.
    expect(marks.from?.route).toEqual(webcamRoute(center(origin), center(target), FRAME, reach));
  });

  it("a selected part shows its route even when the playhead is elsewhere, and beats the one under it", () => {
    const webcam = scene(
      part("a", 10, 20),
      part("b", 30, 40, { layout: { position: { x: 0.2, y: 0.2 } } }),
    );
    const fromB = marksAt(webcam, 15, "b")!.from;
    const fromA = marksAt(webcam, 15, null)!.from;
    expect(fromB).not.toBeNull();
    expect(fromB?.route.end).not.toEqual(fromA?.route.end);
    // A hidden range's id selects no route.
    const withHidden = scene(part("a", 10, 20), { id: "h", start: 30, end: 35, mode: "hidden" });
    expect(marksAt(withHidden, 5, "h")?.from).toBeNull();
  });

  it("calls the ghost 'original' for a part that follows the original position", () => {
    expect(marksAt(scene(part("a", 10, 20)), 15)?.from?.ghost).toBe("original");
    // A gap between two parts is original position too.
    expect(marksAt(scene(part("a", 0, 5), part("b", 10, 20)), 15)?.from?.ghost).toBe("original");
  });

  it("calls the ghost 'before' for a part that starts where another ends, and starts the route there", () => {
    const webcam = scene(
      part("a", 10, 20),
      part("b", 20, 30, { layout: { position: { x: 0.2, y: 0.2 } } }),
    );
    const marks = marksAt(webcam, 25)!;
    expect(marks.from?.ghost).toBe("before");
    const previous = webcamRect({ ...WEBCAM_DEFAULTS, position: { x: 0.8, y: 0.2 } }, FRAME)!;
    expect(marks.from?.route.start.x).toBeCloseTo(previous.x + previous.width / 2, 6);
  });

  describe("the route starts where the slide starts, inside THIS part's box", () => {
    /** The bubble centre the preview and the export draw at the very start of a part's slide. */
    const slideStart = (webcam: WebcamScene, at: number) => {
      const state = webcamStateAt({ webcam }, at)!;
      expect(state.from).not.toBeNull();
      expect(state.progress).toBe(0);
      const rect = webcamStateRect(state, FRAME)!;
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    };

    it("clamps the original position with the part's size, not the original's", () => {
      // The original (size 0.22 at x 0.12, y 0.82) fits. A part of size 0.5 is a box so big
      // that the same position has to be pulled inwards: x to 0.1406 and y to 0.75.
      const webcam = scene(
        part("big", 10, 20, { layout: { position: { x: 0.8, y: 0.2 }, size: 0.5 } }),
      );
      const marks = marksAt(webcam, 15)!;
      const expected = slideStart(webcam, 10);
      expect(marks.from?.route.start.x).toBeCloseTo(expected.x, 6);
      expect(marks.from?.route.start.y).toBeCloseTo(expected.y, 6);
      // And it really differs from the original's own, unclamped centre.
      const unclamped = webcamRect(WEBCAM_DEFAULTS, FRAME)!;
      expect(marks.from!.route.start.y).not.toBeCloseTo(unclamped.y + unclamped.height / 2, 1);
    });

    it("does the same from a previous part that touches it", () => {
      const webcam = scene(
        part("a", 10, 20, { layout: { position: { x: 0.03, y: 0.97 }, size: 0.1 } }),
        part("b", 20, 30, { layout: { position: { x: 0.8, y: 0.2 }, size: 0.5 } }),
      );
      const marks = marksAt(webcam, 25)!;
      expect(marks.from?.ghost).toBe("before");
      const expected = slideStart(webcam, 20);
      expect(marks.from?.route.start.x).toBeCloseTo(expected.x, 6);
      expect(marks.from?.route.start.y).toBeCloseTo(expected.y, 6);
    });
  });

  it("chips a slide with its real seconds: the duration asked for, at most half the part", () => {
    expect(marksAt(scene(part("a", 10, 20)), 15)?.from?.chip).toEqual({
      kind: "slide",
      seconds: 0.7,
    });
    const short = part("a", 10, 11, { transition: { kind: "slide", ms: 1200, easing: "back" } });
    expect(marksAt(scene(short), 10.8)?.from?.chip).toEqual({ kind: "slide", seconds: 0.5 });
  });

  it("chips a Cut as a cut, also for a part saved without a transition", () => {
    const cut = part("a", 10, 20, { transition: { kind: "cut", ms: 700, easing: "back" } });
    expect(marksAt(scene(cut), 15)?.from?.chip).toEqual({ kind: "cut" });
    expect(marksAt(scene(part("a", 10, 20, { transition: undefined })), 15)?.from?.chip).toEqual({
      kind: "cut",
    });
  });
});

describe("webcamMarks: a hidden range", () => {
  const webcam = scene(part("a", 0, 5), { id: "h", start: 10, end: 20, mode: "hidden" });

  it("has an outline where the default layout would put the camera, and no bubble or label", () => {
    const marks = marksAt(webcam, 15)!;
    const rect = webcamRect(WEBCAM_DEFAULTS, FRAME)!;
    expect(marks.bubble).toBeNull();
    expect(marks.label).toBeNull();
    expect(marks.from).toBeNull();
    expect(marks.hidden).toEqual({
      center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      box: { width: rect.width, height: rect.height },
      shape: WEBCAM_DEFAULTS.shape,
      cornerRadius: WEBCAM_DEFAULTS.cornerRadius,
    });
  });

  it("has no outline outside the range, including at its end", () => {
    expect(marksAt(webcam, 25)?.hidden).toBeNull();
    expect(marksAt(webcam, 20)?.hidden).toBeNull();
  });
});
