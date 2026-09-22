import { describe, expect, it } from "vitest";
import { cameraTransform } from "./camera-css";

describe("cameraTransform", () => {
  it("maps the window's top-left to the element's top-left", () => {
    // 2× centered on (0.75, 0.25): window x = 0.5, y = 0.
    expect(cameraTransform({ cx: 0.75, cy: 0.25, scale: 2 })).toBe("scale(2) translate(-50%, 0%)");
  });
  it("is a no-op at 1×, centered", () => {
    expect(cameraTransform({ cx: 0.5, cy: 0.5, scale: 1 })).toBe("scale(1) translate(0%, 0%)");
  });
});
