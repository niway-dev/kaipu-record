import { describe, expect, it } from "vitest";
import { areaCapturedDisplay, type DisplayLike, pickCapturedDisplay } from "./captured-display";

const A: DisplayLike = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, scaleFactor: 2 };
const B: DisplayLike = {
  id: 2,
  bounds: { x: 1512, y: 0, width: 2560, height: 1440 },
  scaleFactor: 1,
};

describe("pickCapturedDisplay", () => {
  it("matches the display by desktopCapturer display_id", () => {
    expect(pickCapturedDisplay("screen:2:0", "2", [A, B])).toEqual({
      id: "2",
      bounds: B.bounds,
      scaleFactor: 1,
    });
  });
  it("falls back to the only display when display_id is empty", () => {
    expect(pickCapturedDisplay("screen:0:0", "", [A])?.id).toBe("1");
  });
  it("gives up when display_id is empty and there are several displays", () => {
    expect(pickCapturedDisplay("screen:0:0", "", [A, B])).toBeNull();
  });
  it("never tracks window sources", () => {
    expect(pickCapturedDisplay("window:123:0", "1", [A])).toBeNull();
  });
});

describe("areaCapturedDisplay", () => {
  it("moves the area to global DIP and remembers where on the display it was", () => {
    const display = {
      id: "2",
      bounds: { x: 1512, y: 0, width: 1512, height: 982 },
      scaleFactor: 2,
    };
    expect(
      areaCapturedDisplay(display, {
        displayId: 2,
        rect: { x: 100, y: 50, width: 640, height: 360 },
        displaySize: { width: 1512, height: 982 },
      }),
    ).toEqual({
      id: "2",
      bounds: { x: 1612, y: 50, width: 640, height: 360 },
      scaleFactor: 2,
      region: { displayId: "2", x: 100, y: 50 },
    });
  });
});
