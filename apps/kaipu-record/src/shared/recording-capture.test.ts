import { describe, expect, it } from "vitest";
import {
  buildRecordingCapture,
  inferRecordingRatio,
  recordingCaptureLabel,
  recordingCaptureLabelKey,
  recordingCaptureMode,
  sanitizeRecordingCapture,
  type RecordingCapture,
} from "./recording-capture";
import type { RecordingArea } from "./types/ipc";

const area = (over: Partial<RecordingArea> = {}): RecordingArea => ({
  displayId: 7,
  rect: { x: 10, y: 20, width: 640, height: 360 },
  displaySize: { width: 1512, height: 982 },
  ...over,
});

describe("recordingCaptureMode", () => {
  it("reads window, area and screen from the source id and the area", () => {
    expect(recordingCaptureMode("window:12:0", false)).toBe("window");
    expect(recordingCaptureMode("window:12:0", true)).toBe("window");
    expect(recordingCaptureMode("screen:1:0", true)).toBe("area");
    expect(recordingCaptureMode("screen:1:0", false)).toBe("screen");
  });
});

describe("inferRecordingRatio", () => {
  it("matches fixed ratios within 1%", () => {
    expect(inferRecordingRatio(1280, 720)).toBe("16:9");
    // Even rounding: 1078 × 606 is 0.07% off 16:9.
    expect(inferRecordingRatio(1078, 606)).toBe("16:9");
    expect(inferRecordingRatio(720, 1280)).toBe("9:16");
    expect(inferRecordingRatio(1080, 1080)).toBe("1:1");
    expect(inferRecordingRatio(1000, 1008)).toBe("1:1");
  });

  it("is free outside the tolerance or when the size is unknown", () => {
    expect(inferRecordingRatio(1000, 1020)).toBe("free");
    expect(inferRecordingRatio(1662, 1080)).toBe("free");
    expect(inferRecordingRatio(0, 0)).toBe("free");
  });
});

describe("buildRecordingCapture", () => {
  it("a whole display: output size, no ratio, no display id", () => {
    expect(
      buildRecordingCapture({
        sourceId: "screen:1:0",
        output: { width: 1662, height: 1080 },
      }),
    ).toEqual({ mode: "screen", width: 1662, height: 1080, ratio: null });
  });

  it("a window: output size, no ratio", () => {
    expect(
      buildRecordingCapture({
        sourceId: "window:9:0",
        output: { width: 800, height: 600 },
      }),
    ).toEqual({ mode: "window", width: 800, height: 600, ratio: null });
  });

  it("an area: infers the ratio from the output size and keeps the display id", () => {
    expect(
      buildRecordingCapture({
        sourceId: "screen:1:0",
        area: area(),
        output: { width: 1280, height: 720 },
      }),
    ).toEqual({
      mode: "area",
      width: 1280,
      height: 720,
      ratio: "16:9",
      displayId: 7,
    });
  });

  it("an area with a remembered ratio uses it over the inferred one", () => {
    expect(
      buildRecordingCapture({
        sourceId: "screen:1:0",
        area: area({ ratio: "free" }),
        output: { width: 1280, height: 720 },
      }).ratio,
    ).toBe("free");
  });

  it("falls back to the area rect times scale, then to zeros", () => {
    expect(
      buildRecordingCapture({
        sourceId: "screen:1:0",
        area: area(),
        output: null,
        scale: 2,
      }),
    ).toMatchObject({ width: 1280, height: 720, ratio: "16:9" });
    expect(buildRecordingCapture({ sourceId: "screen:1:0" })).toEqual({
      mode: "screen",
      width: 0,
      height: 0,
      ratio: null,
    });
  });
});

describe("sanitizeRecordingCapture", () => {
  it("keeps a valid value", () => {
    const value: RecordingCapture = {
      mode: "area",
      width: 1280,
      height: 720,
      ratio: "16:9",
      displayId: 3,
    };
    expect(sanitizeRecordingCapture(value)).toEqual(value);
  });

  it("drops what cannot be trusted", () => {
    expect(sanitizeRecordingCapture(null)).toBeNull();
    expect(sanitizeRecordingCapture("screen")).toBeNull();
    expect(sanitizeRecordingCapture({ mode: "tab", width: 1, height: 1 })).toBeNull();
    expect(
      sanitizeRecordingCapture({
        mode: "screen",
        width: -4,
        height: "x",
        ratio: "16:9",
        displayId: 1,
      }),
    ).toEqual({ mode: "screen", width: 0, height: 0, ratio: null });
    expect(
      sanitizeRecordingCapture({
        mode: "area",
        width: 10,
        height: 10,
        ratio: "4:3",
      }),
    ).toEqual({ mode: "area", width: 10, height: 10, ratio: null });
  });
});

describe("recordingCaptureLabelKey", () => {
  it("picks the key and params per mode and ratio", () => {
    expect(recordingCaptureLabelKey(null)).toBeNull();
    expect(
      recordingCaptureLabelKey({
        mode: "screen",
        width: 1,
        height: 1,
        ratio: null,
      }),
    ).toEqual({ key: "captureScreen" });
    expect(
      recordingCaptureLabelKey({
        mode: "window",
        width: 1,
        height: 1,
        ratio: null,
      }),
    ).toEqual({ key: "captureWindow" });
    expect(
      recordingCaptureLabelKey({
        mode: "area",
        width: 1280,
        height: 720,
        ratio: "16:9",
      }),
    ).toEqual({ key: "captureFrameRatio", params: { ratio: "16:9" } });
    expect(
      recordingCaptureLabelKey({
        mode: "area",
        width: 1234,
        height: 567,
        ratio: "free",
      }),
    ).toEqual({
      key: "captureFrameSize",
      params: { width: 1234, height: 567 },
    });
    expect(
      recordingCaptureLabelKey({
        mode: "area",
        width: 0,
        height: 0,
        ratio: "free",
      }),
    ).toEqual({ key: "captureFrame" });
  });

  it("formats through the caller's translator", () => {
    const t = (key: string, params?: Record<string, string | number>): string =>
      key === "captureFrameSize" ? `FRAME · ${params?.width} × ${params?.height}` : key;
    expect(
      recordingCaptureLabel({ mode: "area", width: 1280, height: 721, ratio: "free" }, t),
    ).toBe("FRAME · 1280 × 721");
    expect(recordingCaptureLabel(null, t)).toBeNull();
  });
});
