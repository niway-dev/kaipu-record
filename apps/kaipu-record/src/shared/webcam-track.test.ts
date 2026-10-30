import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_BUBBLE, DEFAULT_CAMERA_FRAMING } from "./camera-bubble";
import {
  WEBCAM_FPS,
  WEBCAM_LINES_DEFAULT,
  bubblePreviewLines,
  sanitizeWebcamTrackMeta,
  webcamCaptureLines,
  webcamSiblingPath,
  webcamStartOffset,
} from "./webcam-track";

describe("webcamCaptureLines", () => {
  it("records 720 lines without framing, whatever the bubble's size", () => {
    expect(WEBCAM_LINES_DEFAULT).toBe(720);
    expect(webcamCaptureLines({ size: 480, framing: DEFAULT_CAMERA_FRAMING })).toBe(720);
    expect(webcamCaptureLines({ size: 120, framing: DEFAULT_CAMERA_FRAMING })).toBe(720);
  });

  it("follows the bubble's capture lines while framing is on, never below 720 nor above 1080", () => {
    const framing = { enabled: true, zoom: 1, x: 0, y: 0 };
    // cameraCaptureLines(160, zoom 1) = 480: the webcam file still gets 720.
    expect(webcamCaptureLines({ size: 160, framing })).toBe(720);
    // 360 × 2 × 1.5 = 1080.
    expect(webcamCaptureLines({ size: 360, framing: { ...framing, zoom: 1.5 } })).toBe(1080);
    expect(webcamCaptureLines({ size: 480, framing: { ...framing, zoom: 3 } })).toBe(1080);
  });
});

describe("bubblePreviewLines", () => {
  it("never asks the shared camera for fewer lines than the webcam file records", () => {
    // Chromium shares one capture per device and only downscales per track: a 480-line
    // bubble would starve the recorder's 720-line webcam track.
    expect(bubblePreviewLines({ size: 240, framing: DEFAULT_CAMERA_FRAMING })).toBe(720);
    const framing = { enabled: true, zoom: 1, x: 0, y: 0 };
    expect(bubblePreviewLines({ size: 160, framing })).toBe(720);
    // 240 × 2 × 2 = 960 → the bubble's own step, 1080.
    expect(bubblePreviewLines({ size: 240, framing: { ...framing, zoom: 2 } })).toBe(1080);
  });
});

describe("webcamStartOffset", () => {
  it("is the webcam's time 0 minus the screen's, on the renderer clock", () => {
    expect(
      webcamStartOffset(
        { rendererMs: 1000, quality: "exact" },
        { rendererMs: 1033.4, quality: "exact" },
      ),
    ).toEqual({ startOffsetMs: 33.4, offsetQuality: "exact" });
  });

  it("can be negative when the webcam's first frame came first", () => {
    expect(
      webcamStartOffset(
        { rendererMs: 2000, quality: "exact" },
        { rendererMs: 1990, quality: "exact" },
      ).startOffsetMs,
    ).toBe(-10);
  });

  it("is exact only when both first-media timestamps are exact", () => {
    const exact = { rendererMs: 0, quality: "exact" } as const;
    const estimated = { rendererMs: 0, quality: "estimated" } as const;
    expect(webcamStartOffset(exact, estimated).offsetQuality).toBe("estimated");
    expect(webcamStartOffset(estimated, exact).offsetQuality).toBe("estimated");
    expect(webcamStartOffset(estimated, estimated).offsetQuality).toBe("estimated");
  });

  it("drops floating-point noise below a microsecond", () => {
    expect(
      webcamStartOffset(
        { rendererMs: 0.1, quality: "exact" },
        { rendererMs: 0.3, quality: "exact" },
      ).startOffsetMs,
    ).toBe(0.2);
  });
});

describe("sanitizeWebcamTrackMeta", () => {
  const valid = {
    startOffsetMs: 12.5,
    offsetQuality: "exact",
    width: 1280,
    height: 720,
    fps: WEBCAM_FPS,
  };

  it("keeps a valid meta", () => {
    expect(sanitizeWebcamTrackMeta(valid)).toEqual(valid);
  });

  it("refuses anything that cannot place the file on the screen's clock", () => {
    expect(sanitizeWebcamTrackMeta(null)).toBeNull();
    expect(sanitizeWebcamTrackMeta("x")).toBeNull();
    expect(sanitizeWebcamTrackMeta({ ...valid, startOffsetMs: Number.NaN })).toBeNull();
    expect(sanitizeWebcamTrackMeta({ ...valid, startOffsetMs: "1" })).toBeNull();
    expect(sanitizeWebcamTrackMeta({ ...valid, offsetQuality: "perfect" })).toBeNull();
    expect(sanitizeWebcamTrackMeta({ ...valid, width: 0 })).toBeNull();
    expect(sanitizeWebcamTrackMeta({ ...valid, height: -720 })).toBeNull();
    expect(sanitizeWebcamTrackMeta({ ...valid, fps: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("keeps the recorded bubble, sanitized, and drops its device", () => {
    const meta = sanitizeWebcamTrackMeta({
      ...valid,
      recordedLayout: { ...DEFAULT_CAMERA_BUBBLE, size: 9999, deviceId: "cam-1" },
    });
    expect(meta?.recordedLayout).toEqual({
      shape: DEFAULT_CAMERA_BUBBLE.shape,
      size: 480,
      mirrored: DEFAULT_CAMERA_BUBBLE.mirrored,
      framing: DEFAULT_CAMERA_BUBBLE.framing,
    });
    expect(meta?.recordedLayout).not.toHaveProperty("deviceId");
  });

  it("keeps the bubble's recorded position clamped to 0..1, and drops a malformed one", () => {
    const layout = { ...DEFAULT_CAMERA_BUBBLE };
    expect(
      sanitizeWebcamTrackMeta({
        ...valid,
        recordedLayout: { ...layout, position: { x: 0.2, y: 1.7 } },
      })?.recordedLayout?.position,
    ).toEqual({ x: 0.2, y: 1 });
    expect(
      sanitizeWebcamTrackMeta({
        ...valid,
        recordedLayout: { ...layout, position: { x: "a", y: 0.5 } },
      })?.recordedLayout,
    ).not.toHaveProperty("position");
    expect(
      sanitizeWebcamTrackMeta({ ...valid, recordedLayout: layout })?.recordedLayout,
    ).not.toHaveProperty("position");
  });

  it("keeps the recorded size fraction when positive, capped at 1", () => {
    const layout = { ...DEFAULT_CAMERA_BUBBLE };
    const fraction = (sizeFraction: unknown) =>
      sanitizeWebcamTrackMeta({ ...valid, recordedLayout: { ...layout, sizeFraction } })
        ?.recordedLayout?.sizeFraction;
    expect(fraction(0.25)).toBe(0.25);
    expect(fraction(3)).toBe(1);
    expect(fraction(-1)).toBeUndefined();
    expect(fraction("big")).toBeUndefined();
  });

  it("ignores extra fields the renderer sent", () => {
    expect(sanitizeWebcamTrackMeta({ ...valid, path: "/etc/passwd" })).not.toHaveProperty("path");
  });
});

describe("webcamSiblingPath", () => {
  it("puts the webcam file next to the screen file", () => {
    expect(webcamSiblingPath("/Users/me/Movies/take.mp4")).toBe("/Users/me/Movies/take.webcam.mp4");
    expect(webcamSiblingPath("/Users/me/Movies/take")).toBe("/Users/me/Movies/take.webcam.mp4");
  });
});
