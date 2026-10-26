import { describe, expect, it } from "vitest";
import {
  cameraPreviewPlacement,
  ratioBarPlacement,
  startPillPlacement,
  widgetPlacement,
  WIDGET_HEIGHT_DIP,
  WIDGET_WIDTH_DIP,
} from "./record-chrome";

const AREA = { x: 0, y: 25, width: 1600, height: 975 };

describe("record chrome placement", () => {
  it("puts the ratio bar above the box, inside it when the box touches the top", () => {
    expect(ratioBarPlacement({ x: 100, y: 200, width: 640, height: 360 }, AREA)).toEqual({
      left: 100,
      top: 158,
      inside: false,
    });
    expect(ratioBarPlacement({ x: 100, y: 30, width: 640, height: 360 }, AREA)).toEqual({
      left: 108,
      top: 38,
      inside: true,
    });
  });

  it("attaches the widget 10 DIP right of the box, then left, then inside", () => {
    expect(widgetPlacement({ x: 100, y: 200, width: 640, height: 360 }, AREA)).toEqual({
      side: "right",
      left: 750,
      top: 200,
    });
    expect(widgetPlacement({ x: 900, y: 200, width: 690, height: 360 }, AREA)).toEqual({
      side: "left",
      left: 900 - 10 - WIDGET_WIDTH_DIP,
      top: 200,
    });
    expect(widgetPlacement({ x: 0, y: 25, width: 1600, height: 975 }, AREA).side).toBe("inside");
  });

  it("keeps the widget inside the work area vertically", () => {
    const low = widgetPlacement({ x: 100, y: 900, width: 300, height: 90 }, AREA);
    expect(low.top).toBe(25 + 975 - WIDGET_HEIGHT_DIP);
  });

  it("centres the Start pill under the box, inside its bottom edge when the area ends", () => {
    expect(startPillPlacement({ x: 100, y: 200, width: 640, height: 360 }, AREA)).toEqual({
      centerX: 420,
      top: 574,
    });
    expect(startPillPlacement({ x: 100, y: 500, width: 640, height: 500 }, AREA).top).toBe(
      1000 - 36 - 14,
    );
  });

  it("puts the camera preview bottom-left inside the box, or nowhere when it cannot fit", () => {
    expect(cameraPreviewPlacement({ x: 100, y: 200, width: 640, height: 360 })).toEqual({
      x: 140,
      y: 296,
      width: 224,
      height: 224,
    });
    expect(cameraPreviewPlacement({ x: 0, y: 0, width: 300, height: 300 })).toBeNull();
  });
});
