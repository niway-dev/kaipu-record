import { describe, expect, it } from "vitest";
import { recordingModeChip } from "./recording-mode-label";

const screenSource = { id: "screen:1:0", name: "Display 1", type: "screen" as const };
const area = {
  displayId: 7,
  rect: { x: 0, y: 0, width: 640, height: 360 },
  displaySize: { width: 1512, height: 982 },
};

describe("recordingModeChip", () => {
  it("prints the area's locked ratio", () => {
    expect(
      recordingModeChip({ selectedSource: screenSource, area: { ...area, ratio: "9:16" } }),
    ).toEqual({ mode: "frame", ratio: "9:16" });
  });

  it("infers the ratio of an area chosen before ratios, like the library and analytics", () => {
    // 640 × 360 is 16:9: the bar says so too, instead of a bare FRAME.
    expect(recordingModeChip({ selectedSource: screenSource, area })).toEqual({
      mode: "frame",
      ratio: "16:9",
    });
  });

  it("names Frame for a free area, Window for a window and Screen for a display", () => {
    expect(
      recordingModeChip({ selectedSource: screenSource, area: { ...area, ratio: "free" } }),
    ).toEqual({ mode: "frame", ratio: null });
    expect(
      recordingModeChip({
        selectedSource: { id: "window:1", name: "Safari", type: "window" },
        area: null,
      }),
    ).toEqual({ mode: "window", ratio: null });
    expect(recordingModeChip({ selectedSource: screenSource, area: null })).toEqual({
      mode: "screen",
      ratio: null,
    });
  });
});
