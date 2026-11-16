import { describe, expect, it } from "vitest";
import {
  webcamLaneBlockWidths,
  webcamLaneStretches,
  webcamPartSlideSeconds,
  webcamStretchDot,
  webcamStretchName,
  type LanePiece,
} from "./webcam-stretches";
import { WEBCAM_DEFAULTS, type WebcamScene, type WebcamSegment } from "./webcam-model";

const part = (id: string, start: number, end: number, extra: Partial<WebcamSegment> = {}) =>
  ({
    id,
    start,
    end,
    mode: "override",
    layout: { position: { x: 0.8, y: 0.2 } },
    transition: { kind: "slide", ms: 700, easing: "ease-in-out" },
    ...extra,
  }) satisfies WebcamSegment;
const hiddenRange = (id: string, start: number, end: number): WebcamSegment => ({
  id,
  start,
  end,
  mode: "hidden",
});
const stretchesOf = (segments: WebcamSegment[], duration = 40) =>
  webcamLaneStretches({ segments }, duration).map((s) => [
    s.kind,
    s.start,
    s.end,
    "id" in s ? s.id : null,
  ]);

describe("webcamLaneStretches", () => {
  it("is one original stretch over the whole recording with no parts", () => {
    expect(stretchesOf([])).toEqual([["original", 0, 40, null]]);
  });

  it("puts original stretches before and after a part", () => {
    expect(stretchesOf([part("a", 10, 20)])).toEqual([
      ["original", 0, 10, null],
      ["part", 10, 20, "a"],
      ["original", 20, 40, null],
    ]);
  });

  it("has no original stretch between two parts that touch", () => {
    expect(stretchesOf([part("a", 10, 20), part("b", 20, 30)])).toEqual([
      ["original", 0, 10, null],
      ["part", 10, 20, "a"],
      ["part", 20, 30, "b"],
      ["original", 30, 40, null],
    ]);
  });

  it("draws a hidden range as its own kind, between originals", () => {
    expect(stretchesOf([part("a", 5, 8), hiddenRange("h", 12, 16)])).toEqual([
      ["original", 0, 5, null],
      ["part", 5, 8, "a"],
      ["original", 8, 12, null],
      ["hidden", 12, 16, "h"],
      ["original", 16, 40, null],
    ]);
  });

  it("has no original stretch for a part at the very start or the very end", () => {
    expect(stretchesOf([part("a", 0, 10), part("z", 30, 40)])).toEqual([
      ["part", 0, 10, "a"],
      ["original", 10, 30, null],
      ["part", 30, 40, "z"],
    ]);
  });

  it("orders the stretches by time even when the segments arrive out of order", () => {
    expect(stretchesOf([part("b", 20, 25), part("a", 5, 8)]).map((s) => s[3])).toEqual([
      null,
      "a",
      null,
      "b",
      null,
    ]);
  });

  it("keeps a part whose end is past the recording and adds nothing after it", () => {
    expect(stretchesOf([part("a", 30, 45)], 40)).toEqual([
      ["original", 0, 30, null],
      ["part", 30, 45, "a"],
    ]);
  });
});

describe("webcamStretchName and webcamStretchDot", () => {
  const webcam: Pick<WebcamScene, "layout"> = {
    layout: { ...WEBCAM_DEFAULTS, size: 0.2, position: { x: 0.1, y: 0.9 } },
  };
  const frame = { width: 1000, height: 1000 };

  it("names an original stretch from the default position and a part from its own", () => {
    const [original, mine] = webcamLaneStretches(
      { segments: [part("a", 10, 20, { layout: { position: { x: 0.9, y: 0.1 } } })] },
      40,
    );
    expect(webcamStretchName(webcam, original!, frame)).toBe("bottomLeft");
    expect(webcamStretchName(webcam, mine!, frame)).toBe("topRight");
  });

  it("falls back to the default position when a part holds no position of its own", () => {
    const [, mine] = webcamLaneStretches({ segments: [part("a", 10, 20, { layout: {} })] }, 40);
    expect(webcamStretchName(webcam, mine!, frame)).toBe("bottomLeft");
  });

  it("names nothing for a hidden range", () => {
    const [hidden] = webcamLaneStretches({ segments: [hiddenRange("h", 0, 5)] }, 40);
    expect(webcamStretchName(webcam, hidden!, frame)).toBeNull();
    expect(webcamStretchDot(webcam, hidden!, frame)).toBeNull();
  });

  it("puts the dot at the centre's share of the range it can reach", () => {
    const [original] = webcamLaneStretches({ segments: [] }, 40);
    const dot = webcamStretchDot(webcam, original!, frame)!;
    // Box 200: x reach 100–900, centre 100 → 0; y centre 900 → clamped to 900 → 1.
    expect(dot.x).toBeCloseTo(0, 6);
    expect(dot.y).toBeCloseTo(1, 6);
  });

  it("still names a place before the frame is measured (a 16:9 frame stands in)", () => {
    const [original] = webcamLaneStretches({ segments: [] }, 40);
    expect(webcamStretchName(webcam, original!, { width: 0, height: 0 })).toBe("bottomLeft");
  });
});

describe("webcamPartSlideSeconds", () => {
  it("is the slide's real length: the duration asked for, at most half the part", () => {
    expect(webcamPartSlideSeconds(part("a", 0, 10))).toBeCloseTo(0.7, 6);
    expect(
      webcamPartSlideSeconds(
        part("a", 0, 1, { transition: { kind: "slide", ms: 1200, easing: "back" } }),
      ),
    ).toBeCloseTo(0.5, 6);
  });

  it("is null for a Cut, for a part with no transition and for a hidden range", () => {
    expect(
      webcamPartSlideSeconds(
        part("a", 0, 10, { transition: { kind: "cut", ms: 700, easing: "back" } }),
      ),
    ).toBeNull();
    expect(webcamPartSlideSeconds(part("a", 0, 10, { transition: undefined }))).toBeNull();
    expect(webcamPartSlideSeconds(hiddenRange("h", 0, 10))).toBeNull();
  });
});

describe("webcamLaneBlockWidths (the 56 px rule)", () => {
  const piece = (kind: LanePiece["kind"], left: number, right: number): LanePiece => ({
    kind,
    left,
    right,
  });

  it("draws a narrow part 56 px wide when its neighbour is far enough", () => {
    const [original, mine, rest] = webcamLaneBlockWidths(
      [piece("original", 0, 100), piece("part", 100, 110), piece("original", 110, 600)],
      600,
    );
    expect(mine).toEqual({ left: 100, width: 56 });
    // The original after it is drawn from where the wider part now ends.
    expect(original).toEqual({ left: 0, width: 100 });
    expect(rest).toEqual({ left: 156, width: 444 });
  });

  it("leaves a part that is already wider than 56 px as it is", () => {
    const [mine] = webcamLaneBlockWidths([piece("part", 10, 210)], 600);
    expect(mine).toEqual({ left: 10, width: 200 });
  });

  it("never draws a part over the next part or hidden range", () => {
    const result = webcamLaneBlockWidths([piece("part", 100, 110), piece("hidden", 130, 180)], 600);
    // 30 px of room before the hidden range: the part is as wide as that room, not 56.
    expect(result[0]).toEqual({ left: 100, width: 30 });
    expect(result[1]).toEqual({ left: 130, width: 50 });
  });

  it("keeps a part with no room as wide as it is, when the next block starts at its end", () => {
    const result = webcamLaneBlockWidths([piece("part", 100, 104), piece("part", 104, 300)], 600);
    expect(result[0]).toEqual({ left: 100, width: 4 });
    expect(result[1]).toEqual({ left: 104, width: 196 });
  });

  it("widens each of two adjacent narrow parts only up to the one after it", () => {
    const result = webcamLaneBlockWidths(
      [piece("part", 0, 10), piece("part", 10, 20), piece("original", 20, 500)],
      500,
    );
    expect(result[0]).toEqual({ left: 0, width: 10 });
    expect(result[1]).toEqual({ left: 10, width: 56 });
    expect(result[2]).toEqual({ left: 66, width: 434 });
  });

  it("stops at the lane's end when nothing follows", () => {
    const [mine] = webcamLaneBlockWidths([piece("part", 580, 590)], 600);
    expect(mine).toEqual({ left: 580, width: 20 });
  });

  it("draws no original stretch a wider part covers entirely", () => {
    const result = webcamLaneBlockWidths(
      [piece("part", 0, 10), piece("original", 10, 30), piece("hidden", 60, 90)],
      600,
    );
    // The part reaches 56 px and the original only had 10-30: nothing is left of it.
    expect(result[0]).toEqual({ left: 0, width: 56 });
    expect(result[1]!.width).toBe(0);
  });

  it("starts an original after a widened part where the part ends, and keeps its right edge", () => {
    const result = webcamLaneBlockWidths(
      [piece("part", 0, 10), piece("original", 10, 200), piece("hidden", 200, 260)],
      600,
    );
    expect(result[1]).toEqual({ left: 56, width: 144 });
  });
});
