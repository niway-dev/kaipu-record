import { describe, expect, it } from "vitest";
import { areaEncodePlan } from "./area-crop";

const MACBOOK = { width: 1512, height: 982 };

describe("areaEncodePlan", () => {
  it("crops the physical pixels of the area and encodes them without upscaling", () => {
    expect(
      areaEncodePlan(
        { width: 3024, height: 1964 },
        { displayId: 1, rect: { x: 100, y: 50, width: 640, height: 360 }, displaySize: MACBOOK },
        1080,
      ),
    ).toEqual({
      source: { x: 200, y: 100, width: 1280, height: 720 },
      target: { width: 1280, height: 720 },
    });
  });

  it("caps the height and keeps both encoded dimensions even", () => {
    const plan = areaEncodePlan(
      { width: 3024, height: 1964 },
      { displayId: 1, rect: { x: 0, y: 0, width: 1001, height: 601 }, displaySize: MACBOOK },
      720,
    );
    expect(plan.source).toEqual({ x: 0, y: 0, width: 2002, height: 1202 });
    expect(plan.target.height).toBeLessThanOrEqual(720);
    expect(plan.target.width % 2).toBe(0);
    expect(plan.target.height % 2).toBe(0);
  });

  it("follows the track size it measured, not the display's scale factor", () => {
    const plan = areaEncodePlan(
      { width: 1512, height: 982 },
      { displayId: 1, rect: { x: 100, y: 50, width: 640, height: 360 }, displaySize: MACBOOK },
      1080,
    );
    expect(plan.source).toEqual({ x: 100, y: 50, width: 640, height: 360 });
    expect(plan.target).toEqual({ width: 640, height: 360 });
  });
});
