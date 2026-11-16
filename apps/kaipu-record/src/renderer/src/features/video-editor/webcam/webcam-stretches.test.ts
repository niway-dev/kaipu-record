import { describe, expect, it } from "vitest";
import {
  webcamLaneBlockWidths,
  webcamLaneStretches,
  webcamLayoutDot,
  webcamLayoutName,
  webcamPartOrigin,
  webcamPartSlideSeconds,
  webcamStretchDot,
  webcamStretchName,
  type LanePiece,
} from "./webcam-stretches";
import {
  WEBCAM_DEFAULTS,
  webcamStateAt,
  type WebcamScene,
  type WebcamSegment,
} from "./webcam-model";
import { webcamMarks } from "./webcam-marks";
import { webcamRect } from "./webcam-layout";

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

  it("does not widen a part past the end of its clip, where a slide or another clip follows", () => {
    // 20 px at 480-500; the clip ends at 500 and nothing in the lane limits the part.
    const [mine] = webcamLaneBlockWidths([{ ...piece("part", 480, 500), clipRight: 500 }], 1800);
    expect(mine).toEqual({ left: 480, width: 20 });
    // With room left inside the clip the 56 px minimum still applies, up to the clip's end.
    const [roomy, tight] = webcamLaneBlockWidths(
      [
        { ...piece("part", 100, 110), clipRight: 500 },
        { ...piece("part", 460, 470), clipRight: 500 },
      ],
      1800,
    );
    expect(roomy).toEqual({ left: 100, width: 56 });
    expect(tight).toEqual({ left: 460, width: 40 });
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

describe("the panel's frame helpers", () => {
  const FRAME = { width: 1920, height: 1080 };
  const scene = (segments: WebcamSegment[]): WebcamScene => ({
    layout: { ...WEBCAM_DEFAULTS, position: { x: 0.12, y: 0.82 } },
    segments,
  });

  it("names and places a layout like the lane does for the same stretch", () => {
    const webcam = scene([part("p", 4, 8)]);
    const stretch = webcamLaneStretches(webcam, 20)[1]!;
    const layout = { ...webcam.layout, ...webcam.segments[0]!.layout };
    expect(webcamLayoutName(layout, FRAME)).toBe(webcamStretchName(webcam, stretch, FRAME));
    expect(webcamLayoutDot(layout, FRAME)).toEqual(webcamStretchDot(webcam, stretch, FRAME));
  });

  it("a part comes from the original position when nothing touches its start", () => {
    const webcam = scene([part("p", 4, 8)]);
    expect(webcamPartOrigin(webcam, webcam.segments[0]!).position).toEqual({ x: 0.12, y: 0.82 });
  });

  it("a part comes from the part that ends exactly where it starts", () => {
    const webcam = scene([
      part("a", 1, 4, { layout: { position: { x: 0.5, y: 0.5 } } }),
      part("b", 4, 8),
    ]);
    expect(webcamPartOrigin(webcam, webcam.segments[1]!).position).toEqual({ x: 0.5, y: 0.5 });
  });

  it("a gap or a hidden range before a part means it comes from the original position", () => {
    const gap = scene([
      part("a", 1, 3, { layout: { position: { x: 0.5, y: 0.5 } } }),
      part("b", 4, 8),
    ]);
    expect(webcamPartOrigin(gap, gap.segments[1]!).position).toEqual({ x: 0.12, y: 0.82 });
    const hiddenBefore = scene([hiddenRange("h", 1, 4), part("b", 4, 8)]);
    expect(webcamPartOrigin(hiddenBefore, hiddenBefore.segments[1]!).position).toEqual({
      x: 0.12,
      y: 0.82,
    });
  });

  it("keeps the part's own size and shape, so both dots are measured on the same box", () => {
    const webcam = scene([
      part("p", 4, 8, { layout: { position: { x: 0.8, y: 0.2 }, size: 0.33 } }),
    ]);
    expect(webcamPartOrigin(webcam, webcam.segments[0]!)).toMatchObject({ size: 0.33 });
  });
});

describe("where a part's slide starts: the three rules agree", () => {
  // The slide's origin is decided in three places: `webcamStateAt` (the slide that plays),
  // `webcamMarks` (the route and ghost in the preview) and `webcamPartOrigin` (the panel's
  // "before" dot). There is no shared helper, so this pins that they stay in step.
  const FRAME = { width: 1920, height: 1080 };
  const DEFAULT = { x: 0.12, y: 0.82 };
  const BEFORE = { x: 0.5, y: 0.5 };
  const scene = (segments: WebcamSegment[]): WebcamScene => ({
    layout: { ...WEBCAM_DEFAULTS, position: DEFAULT },
    segments,
  });
  const first = part("a", 1, 5, { layout: { position: BEFORE } });
  // Illustrative layouts: gaps around one epsilon (1e-6), a hidden range, a chain, no layout.
  const layouts: Record<string, WebcamScene> = {
    "touching exactly": scene([first, part("b", 5, 10)]),
    "gap of float noise": scene([first, part("b", 5 + 1e-9, 10)]),
    "gap of one epsilon": scene([first, part("b", 5 + 1e-6, 10)]),
    "gap just over an epsilon": scene([first, part("b", 5 + 2e-6, 10)]),
    "gap of a millisecond": scene([first, part("b", 5 + 1e-3, 10)]),
    "a real gap": scene([first, part("b", 5.5, 10)]),
    "overlap of float noise": scene([first, part("b", 5 - 1e-9, 10)]),
    "hidden range between": scene([first, hiddenRange("h", 5, 7), part("b", 7, 12)]),
    "hidden range before": scene([hiddenRange("h", 1, 5), part("b", 5, 10)]),
    "hidden range after": scene([first, hiddenRange("h", 5, 7)]),
    "a chain of three": scene([
      first,
      part("b", 5, 8),
      part("c", 8, 12, { layout: { position: DEFAULT } }),
    ]),
    "a part with no layout before": scene([
      part("a", 1, 5, { layout: undefined }),
      part("b", 5, 10),
    ]),
    "a cut before": scene([
      part("a", 1, 5, { layout: { position: BEFORE }, transition: undefined }),
      part("b", 5, 10),
    ]),
  };

  for (const [name, webcam] of Object.entries(layouts)) {
    it(`${name}: the slide that plays, the route and the panel start from the same place`, () => {
      for (const segment of webcam.segments.filter((s) => s.mode === "override")) {
        const origin = webcamPartOrigin(webcam, segment);
        const own = { ...webcam.layout, ...segment.layout };

        // The slide that plays, just after the part starts: `from` is null when nothing moves.
        // A Cut plays no slide, so only its panel and preview marks have an origin to compare.
        if (segment.transition?.kind === "slide") {
          const state = webcamStateAt({ webcam }, segment.start + 0.001, 60);
          expect(state?.from?.position ?? own.position).toEqual(origin.position);
        }

        // The preview's route and ghost, read once the slide has settled.
        const marks = webcamMarks({
          webcam,
          sourceTime: segment.end - 0.5,
          selectedId: segment.id,
          frame: FRAME,
          endSeconds: 60,
        });
        const rect = webcamRect(origin, FRAME)!;
        expect(marks?.from?.route.start).toEqual({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        });
        // The ghost says "before" exactly when an override part ends where this one starts.
        const previous = webcam.segments[webcam.segments.indexOf(segment) - 1];
        const touching =
          previous?.mode === "override" && Math.abs(previous.end - segment.start) <= 1e-6;
        expect(marks?.from?.ghost).toBe(touching ? "before" : "original");
      }
    });
  }
});
