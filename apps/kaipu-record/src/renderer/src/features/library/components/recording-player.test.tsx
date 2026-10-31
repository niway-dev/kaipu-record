import { describe, expect, it } from "vitest";
import { pictureBox } from "./recording-player";

describe("pictureBox", () => {
  it("fills the 16:9 player with a 16:9 picture", () => {
    expect(pictureBox({ width: 1920, height: 1080 })).toEqual({ width: "100%", height: "100%" });
  });

  it("pillarboxes a taller picture: full height, narrower width", () => {
    expect(pictureBox({ width: 1080, height: 1080 })).toEqual({
      width: "56.25%",
      height: "100%",
    });
  });

  it("letterboxes a wider picture: full width, shorter height", () => {
    const box = pictureBox({ width: 3200, height: 900 });
    expect(box.width).toBe("100%");
    expect(parseFloat(box.height)).toBeCloseTo(50, 5);
  });
});
