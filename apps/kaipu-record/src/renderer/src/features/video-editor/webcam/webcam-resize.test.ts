import { describe, expect, it } from "vitest";
import { webcamRect } from "./webcam-layout";
import { WEBCAM_DEFAULTS, type WebcamScene, type WebcamSegment } from "./webcam-model";
import {
  resizeWebcamFromCorner,
  webcamResizeTarget,
  webcamResizeWriteTime,
  webcamSizeLabel,
  type WebcamResizeStart,
} from "./webcam-resize";
import type { Corner } from "../media-box-drag";

const FRAME = { width: 1000, height: 1000 };

/** A circle of size 0.2 drawn at (400, 400), 200 px square, with no zoom in force. */
const circle: WebcamResizeStart = {
  layout: { shape: "circle", size: 0.2, scaleDuringZoom: 1 },
  rect: { x: 400, y: 400, width: 200, height: 200 },
  cameraScale: 1,
};

/** The rectangle is 3/4 as wide as tall: 150 × 200 at the same place. */
const rectangle: WebcamResizeStart = {
  layout: { shape: "rectangle", size: 0.2, scaleDuringZoom: 1 },
  rect: { x: 400, y: 400, width: 150, height: 200 },
  cameraScale: 1,
};

const px = (position: { x: number; y: number }) => ({
  x: Math.round(position.x * FRAME.width * 100) / 100,
  y: Math.round(position.y * FRAME.height * 100) / 100,
});

describe("resizeWebcamFromCorner, aspect 1", () => {
  it.each<[Corner, number, number, number, { x: number; y: number }]>([
    // The corner dragged outwards by 100 px on both axes grows the height by 100 px; the
    // opposite corner stays, so the centre moves half the growth towards the dragged corner.
    ["se", 100, 100, 0.3, { x: 550, y: 550 }],
    ["nw", -100, -100, 0.3, { x: 450, y: 450 }],
    ["ne", 50, -50, 0.25, { x: 525, y: 475 }],
    ["sw", -50, 50, 0.25, { x: 475, y: 525 }],
  ])("%s grows the bubble from its opposite corner", (corner, dx, dy, size, centre) => {
    const next = resizeWebcamFromCorner({
      start: circle,
      corner,
      deltaX: dx,
      deltaY: dy,
      frame: FRAME,
    });
    expect(next.size).toBe(size);
    expect(px(next.position)).toEqual(centre);
  });

  it("shrinks when the corner moves inwards", () => {
    const next = resizeWebcamFromCorner({
      start: circle,
      corner: "se",
      deltaX: -60,
      deltaY: -60,
      frame: FRAME,
    });
    expect(next.size).toBe(0.14);
    expect(px(next.position)).toEqual({ x: 470, y: 470 });
  });

  it("follows the axis the pointer moved further along", () => {
    const next = resizeWebcamFromCorner({
      start: circle,
      corner: "se",
      deltaX: 10,
      deltaY: 80,
      frame: FRAME,
    });
    expect(next.size).toBe(0.28);
  });

  it("keeps the size when the pointer has not moved", () => {
    const next = resizeWebcamFromCorner({
      start: circle,
      corner: "nw",
      deltaX: 0,
      deltaY: 0,
      frame: FRAME,
    });
    expect(next.size).toBe(0.2);
    expect(px(next.position)).toEqual({ x: 500, y: 500 });
  });
});

describe("resizeWebcamFromCorner, aspect 3/4", () => {
  it("turns a horizontal move into height through the aspect", () => {
    // 75 px wider is 100 px taller (width = height × 3/4): size 0.2 → 0.3.
    const next = resizeWebcamFromCorner({
      start: rectangle,
      corner: "se",
      deltaX: 75,
      deltaY: 0,
      frame: FRAME,
    });
    expect(next.size).toBe(0.3);
    // The box is 225 × 300 and hangs from the top-left corner at (400, 400).
    expect(px(next.position)).toEqual({ x: 512.5, y: 550 });
  });

  it("uses a vertical move as the height change directly", () => {
    const next = resizeWebcamFromCorner({
      start: rectangle,
      corner: "nw",
      deltaX: 0,
      deltaY: -60,
      frame: FRAME,
    });
    expect(next.size).toBe(0.26);
    // Anchored at the bottom-right corner (550, 600): box 195 × 260.
    expect(px(next.position)).toEqual({ x: 452.5, y: 470 });
  });
});

describe("resizeWebcamFromCorner limits", () => {
  it("stops at the largest size and keeps the whole box inside the frame", () => {
    const next = resizeWebcamFromCorner({
      start: circle,
      corner: "se",
      deltaX: 2000,
      deltaY: 2000,
      frame: FRAME,
    });
    expect(next.size).toBe(0.9);
    // A 900 px box cannot hang from (400, 400): the centre is pulled back to the frame.
    expect(px(next.position)).toEqual({ x: 550, y: 550 });
  });

  it("stops at the smallest size, still anchored", () => {
    const next = resizeWebcamFromCorner({
      start: circle,
      corner: "se",
      deltaX: -1000,
      deltaY: -1000,
      frame: FRAME,
    });
    expect(next.size).toBe(0.12);
    expect(px(next.position)).toEqual({ x: 460, y: 460 });
  });

  it("keeps the anchored corner when the grown box fits inside the frame", () => {
    // A circle at the bottom-right of the frame grows to the top-left from its (1000, 1000)
    // corner: the 900 px box centred at (550, 550) fits, so the clamp changes nothing.
    const next = resizeWebcamFromCorner({
      start: { ...circle, rect: { x: 800, y: 800, width: 200, height: 200 } },
      corner: "nw",
      deltaX: -900,
      deltaY: -900,
      frame: FRAME,
    });
    expect(next.size).toBe(0.9);
    expect(px(next.position)).toEqual({ x: 550, y: 550 });
  });

  it("re-clamps the centre when the anchored box would leave the frame", () => {
    // Growing to the bottom-right from the (800, 800) corner would centre a 500 px box at
    // (1050, 1050), past the frame's edge, so the centre is pulled back to (750, 750).
    const next = resizeWebcamFromCorner({
      start: { ...circle, rect: { x: 800, y: 800, width: 200, height: 200 } },
      corner: "se",
      deltaX: 300,
      deltaY: 300,
      frame: FRAME,
    });
    expect(next.size).toBe(0.5);
    expect(px(next.position)).toEqual({ x: 750, y: 750 });
  });
});

describe("resizeWebcamFromCorner during a zoom", () => {
  // scaleDuringZoom 0.5 at camera scale 1.5 halves the drawn bubble: 0.2 × 1000 × 0.5 = 100 px.
  const zoomed: WebcamResizeStart = {
    layout: { shape: "circle", size: 0.2, scaleDuringZoom: 0.5 },
    rect: { x: 450, y: 450, width: 100, height: 100 },
    cameraScale: 1.5,
  };

  it("does not jump when the drag starts", () => {
    const next = resizeWebcamFromCorner({
      start: zoomed,
      corner: "se",
      deltaX: 0,
      deltaY: 0,
      frame: FRAME,
    });
    expect(next.size).toBe(0.2);
  });

  it("divides the zoom factor out of the pointer's change", () => {
    // 50 px more on screen is 100 px more of the layout's own height: 0.2 → 0.3 at factor 0.5.
    const next = resizeWebcamFromCorner({
      start: zoomed,
      corner: "se",
      deltaX: 50,
      deltaY: 50,
      frame: FRAME,
    });
    expect(next.size).toBe(0.3);
    // What is drawn after the change is exactly 150 px, hanging from (450, 450).
    const drawn = webcamRect(
      { shape: "circle", size: next.size, scaleDuringZoom: 0.5, position: next.position },
      FRAME,
      1.5,
    )!;
    expect(drawn.height).toBeCloseTo(150);
    expect(drawn.x).toBeCloseTo(450);
    expect(drawn.y).toBeCloseTo(450);
  });

  it("does not jump when the frame already limited the drawn box", () => {
    // 0.6 of a 1000 px tall frame is 600 px, but a 400 px wide frame limits it to 400.
    const narrow = { width: 400, height: 1000 };
    const next = resizeWebcamFromCorner({
      start: {
        layout: { shape: "circle", size: 0.6, scaleDuringZoom: 1 },
        rect: { x: 0, y: 300, width: 400, height: 400 },
        cameraScale: 1,
      },
      corner: "se",
      deltaX: 0,
      deltaY: 0,
      frame: narrow,
    });
    expect(next.size).toBe(0.6);
  });
});

describe("resizeWebcamFromCorner around the centre", () => {
  it("moves the dragged corner with the pointer and leaves the centre alone", () => {
    const next = resizeWebcamFromCorner({
      start: circle,
      corner: "se",
      deltaX: 50,
      deltaY: 50,
      frame: FRAME,
      anchor: "center",
    });
    // The corner moved 50 px on each axis, so each side grew by 100 px in total.
    expect(next.size).toBe(0.3);
    expect(px(next.position)).toEqual({ x: 500, y: 500 });
  });
});

describe("webcamSizeLabel", () => {
  it("adds the preset letter when the size is exactly a preset", () => {
    expect(webcamSizeLabel(0.15)).toBe("15% · S");
    expect(webcamSizeLabel(0.22)).toBe("22% · M");
    expect(webcamSizeLabel(0.33)).toBe("33% · L");
  });

  it("is only the percent for any other size", () => {
    expect(webcamSizeLabel(0.28)).toBe("28%");
  });
});

describe("webcamResizeTarget", () => {
  const override = (layout?: Partial<WebcamSegment["layout"]>): WebcamSegment => ({
    id: "part-1",
    mode: "override",
    start: 2,
    end: 6,
    ...(layout ? { layout } : {}),
  });
  const scene = (...segments: WebcamSegment[]): WebcamScene => ({
    layout: { ...WEBCAM_DEFAULTS },
    segments,
  });

  it("edits the part at the playhead on the This part tab", () => {
    expect(webcamResizeTarget(scene(override()), "part", 3)).toEqual({
      whole: false,
      anchor: "opposite",
      handles: true,
    });
  });

  it("offers handles and writes the whole layout on This part with no part shown", () => {
    expect(webcamResizeTarget(scene(), "part", 3, null)).toEqual({
      whole: false,
      anchor: "opposite",
      handles: true,
    });
  });

  it("edits the whole video on the Whole video tab", () => {
    expect(webcamResizeTarget(scene(), "whole", 3)).toEqual({
      whole: true,
      anchor: "opposite",
      handles: true,
    });
  });

  it("grows around the centre when a part's own position hides the whole video's", () => {
    const target = webcamResizeTarget(
      scene(override({ position: { x: 0.8, y: 0.2 } })),
      "whole",
      3,
    );
    expect(target).toEqual({ whole: true, anchor: "center", handles: true });
  });

  it("keeps the corner anchor when the part at the playhead owns nothing", () => {
    expect(webcamResizeTarget(scene(override()), "whole", 3)).toEqual({
      whole: true,
      anchor: "opposite",
      handles: true,
    });
  });

  it("keeps the corner anchor outside the part's range", () => {
    const target = webcamResizeTarget(
      scene(override({ position: { x: 0.8, y: 0.2 } })),
      "whole",
      9,
    );
    expect(target.anchor).toBe("opposite");
  });

  // A part's own size or shape wins over the whole video's, so a whole-video size would change
  // nothing on screen. The drag writes to the part instead, where the user sees it resize.
  it("writes to the part on the Whole video tab when the part owns its size", () => {
    expect(webcamResizeTarget(scene(override({ size: 0.4 })), "whole", 3)).toEqual({
      whole: false,
      anchor: "opposite",
      handles: true,
    });
  });

  it("writes to the part on the Whole video tab when the part owns its shape", () => {
    expect(webcamResizeTarget(scene(override({ shape: "rounded" })), "whole", 3)).toEqual({
      whole: false,
      anchor: "opposite",
      handles: true,
    });
  });

  it("does not move a part outside its range to the part's layout", () => {
    expect(webcamResizeTarget(scene(override({ size: 0.4 })), "whole", 9).whole).toBe(true);
  });

  describe("on This part with a part shown that is not at the playhead", () => {
    it("offers no handles: the drag would edit what the bubble shows, not the shown part", () => {
      const shown = override();
      const other: WebcamSegment = { id: "part-2", mode: "override", start: 10, end: 12 };
      expect(webcamResizeTarget(scene(shown, other), "part", 11, shown).handles).toBe(false);
      expect(webcamResizeTarget(scene(shown, other), "part", 15, shown).handles).toBe(false);
    });

    it("offers them when the shown part is the one at the playhead", () => {
      const shown = override();
      expect(webcamResizeTarget(scene(shown), "part", 3, shown).handles).toBe(true);
    });

    it("offers them on the Whole video tab whatever part is shown", () => {
      const shown = override();
      expect(webcamResizeTarget(scene(shown), "whole", 9, shown).handles).toBe(true);
    });
  });
});

describe("webcamResizeWriteTime", () => {
  it("is null for a whole-video write and the playhead for a part write", () => {
    expect(webcamResizeWriteTime({ whole: true, anchor: "opposite", handles: true }, 3)).toBeNull();
    expect(webcamResizeWriteTime({ whole: false, anchor: "opposite", handles: true }, 3)).toBe(3);
  });
});
