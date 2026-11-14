import { describe, expect, it } from "vitest";
import { cameraPreviewPlacement } from "./camera-preview";

describe("camera preview placement", () => {
  it("puts the camera preview bottom-left inside the box, or nowhere when it cannot fit", () => {
    // The bubble window sits 32 DIP in and pads the bubble by 24: the bubble is 56 DIP in.
    expect(cameraPreviewPlacement({ x: 100, y: 200, width: 640, height: 360 })).toEqual({
      x: 156,
      y: 264,
      width: 240,
      height: 240,
    });
    expect(cameraPreviewPlacement({ x: 0, y: 0, width: 200, height: 200 })).toBeNull();
  });

  it("sizes the camera preview like the bubble: the chosen size, shrunk to what the box holds", () => {
    const box = { x: 100, y: 200, width: 640, height: 360 };
    expect(cameraPreviewPlacement(box, 160)).toMatchObject({ width: 160, height: 160 });
    // 360 - 2 × 56 = 248 is all the box holds.
    expect(cameraPreviewPlacement(box, 480)).toMatchObject({ width: 248, height: 248 });
  });

  it("draws the rectangle 3:4, as close to the area's corner as the square", () => {
    const box = { x: 100, y: 200, width: 640, height: 360 };
    // The window is as wide as the shape: the 180-wide rectangle starts where the square does.
    expect(cameraPreviewPlacement(box, 240, "rectangle")).toEqual({
      x: 156,
      y: 264,
      width: 180,
      height: 240,
    });
  });
});
