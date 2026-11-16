import { describe, expect, it } from "vitest";
import { webcamPositionName } from "./webcam-names";

const SQUARE = { width: 1000, height: 1000 };
const BOX_200 = { width: 200, height: 200 };

describe("webcamPositionName", () => {
  // Reach on a 1000 px frame with a 200 px bubble is 100–900, so the thirds end at 366.7 and 633.3.
  it("names each corner and edge from the third the centre is in", () => {
    const at = (x: number, y: number) => webcamPositionName({ x, y }, SQUARE, BOX_200);
    expect(at(0.15, 0.15)).toBe("topLeft");
    expect(at(0.5, 0.15)).toBe("topMiddle");
    expect(at(0.85, 0.15)).toBe("topRight");
    expect(at(0.15, 0.5)).toBe("middleLeft");
    expect(at(0.85, 0.5)).toBe("middleRight");
    expect(at(0.15, 0.85)).toBe("bottomLeft");
    expect(at(0.5, 0.85)).toBe("bottomMiddle");
    expect(at(0.85, 0.85)).toBe("bottomRight");
  });

  it("calls the middle of both axes Center", () => {
    expect(webcamPositionName({ x: 0.5, y: 0.5 }, SQUARE, BOX_200)).toBe("center");
    expect(webcamPositionName({ x: 0.45, y: 0.55 }, SQUARE, BOX_200)).toBe("center");
  });

  it("puts exactly the boundary of a third in the middle", () => {
    // 366.67 / 1000 is the left/middle boundary of the range 100–900.
    expect(webcamPositionName({ x: 1100 / 3 / 1000, y: 0.5 }, SQUARE, BOX_200)).toBe("center");
    expect(webcamPositionName({ x: 0.366, y: 0.5 }, SQUARE, BOX_200)).toBe("middleLeft");
  });

  it("cuts the range the centre can REACH, not the whole frame", () => {
    // 16:9 frame, a bubble 324 px tall: the centre reaches x 162–1758 (thirds at 694 and 1226)
    // and y 162–918 (thirds at 414 and 666). x = 672 is left of 694 but in the middle third of
    // the bare frame (640–1280); y = 669.6 is bottom for the reach but middle for the frame.
    const frame = { width: 1920, height: 1080 };
    const box = { width: 324, height: 324 };
    expect(webcamPositionName({ x: 672 / 1920, y: 0.5 }, frame, box)).toBe("middleLeft");
    expect(webcamPositionName({ x: 0.5, y: 669.6 / 1080 }, frame, box)).toBe("bottomMiddle");
  });

  it("handles an asymmetric reach: a wide rectangle on a tall frame", () => {
    // 1080x1920 frame, a 540x405 box: x reach 270–810 (thirds 450, 630), y reach 202.5–1717.5.
    const frame = { width: 1080, height: 1920 };
    const box = { width: 540, height: 405 };
    expect(webcamPositionName({ x: 440 / 1080, y: 210 / 1920 }, frame, box)).toBe("topLeft");
    expect(webcamPositionName({ x: 640 / 1080, y: 1700 / 1920 }, frame, box)).toBe("bottomRight");
    expect(webcamPositionName({ x: 540 / 1080, y: 960 / 1920 }, frame, box)).toBe("center");
  });

  it("names a bubble as big as the frame Center: it has nowhere else to be", () => {
    expect(webcamPositionName({ x: 0.1, y: 0.9 }, SQUARE, SQUARE)).toBe("center");
  });
});
