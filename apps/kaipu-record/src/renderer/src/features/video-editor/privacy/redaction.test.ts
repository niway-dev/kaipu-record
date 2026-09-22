import { describe, expect, it } from "vitest";
import {
  blurSigmaPx,
  clampIntensity,
  pixelBlockPx,
  coverLabelColor,
  coverLabelPx,
  rectFromDrag,
  rectToPx,
  redactionsForFrame,
  type Redaction,
} from "./redaction";

describe("redaction math", () => {
  it("matches the UI spec at the spec preview height", () => {
    expect(blurSigmaPx(100, 382)).toBeCloseTo(11, 6);
    expect(blurSigmaPx(40, 382)).toBeCloseTo(5.6, 6);
  });
  it("scales with frame height (preview/export parity)", () => {
    expect(blurSigmaPx(70, 1080) / blurSigmaPx(70, 540)).toBeCloseTo(2, 6);
  });
  it("never goes below the minimum intensity", () => {
    expect(clampIntensity(0)).toBe(40);
    expect(blurSigmaPx(0, 382)).toBeCloseTo(blurSigmaPx(40, 382), 6);
  });
  it("pixel blocks are at least 4 px", () => {
    expect(pixelBlockPx(40, 100)).toBe(4);
    expect(pixelBlockPx(100, 1000)).toBe(40);
  });
  it("rounds rects outward and clips to the frame", () => {
    expect(rectToPx({ x: 0.101, y: 0.2, w: 0.2, h: 0.899 }, 1000, 100)).toEqual({
      x: 101,
      y: 20,
      w: 200,
      h: 80,
    });
  });
  it("selects redactions overlapping the frame interval", () => {
    const r = (id: string, start: number, end: number): Redaction => ({
      id,
      kind: "cover",
      start,
      end,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      fill: "#000",
      label: "",
    });
    const list = [r("before", 0, 1), r("edge", 1.99, 3), r("after", 2.04, 4)];
    expect(redactionsForFrame(list, 2, 2.033).map((x) => x.id)).toEqual(["edge"]);
  });
  it("normalizes a drag in any direction", () => {
    expect(rectFromDrag(0.8, 0.9, 0.2, 1.4)).toEqual({
      x: 0.2,
      y: 0.9,
      w: 0.6000000000000001,
      h: 0.09999999999999998,
    });
  });
  it("cover labels scale with the frame and stay readable", () => {
    expect(coverLabelPx(382)).toBeCloseTo(10.5, 9);
    expect(coverLabelPx(1080)).toBeCloseTo(29.69, 2);
    expect(coverLabelColor("#F3F3F5")).toBe("#18181b");
    expect(coverLabelColor("#18181b")).toBe("#ffffff");
  });
});
