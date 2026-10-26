import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseShadeRect, RecordingShade } from "./recording-shade";

describe("parseShadeRect", () => {
  it("reads the clear area from the query", () => {
    expect(parseShadeRect("?window=recording-shade&rect=100,50,640,360")).toEqual({
      x: 100,
      y: 50,
      width: 640,
      height: 360,
    });
  });

  it("answers null for a missing or malformed rect", () => {
    expect(parseShadeRect("?window=recording-shade")).toBeNull();
    expect(parseShadeRect("?rect=1,2,3")).toBeNull();
    expect(parseShadeRect("?rect=1,2,0,4")).toBeNull();
  });
});

describe("RecordingShade", () => {
  it("leaves the area clear and outlines it", () => {
    render(<RecordingShade rect={{ x: 100, y: 50, width: 640, height: 360 }} />);
    const area = screen.getByTestId("recording-shade-area");
    expect(area.style.left).toBe("100px");
    expect(area.style.top).toBe("50px");
    expect(area.style.width).toBe("640px");
    expect(area.style.height).toBe("360px");
  });
});
