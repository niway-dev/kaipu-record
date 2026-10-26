import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCT,
  DEFAULT_SURFACE,
  FLAG_DEFAULTS,
  FLAG_NAMES,
  SCREENSHOT_CAPTURED_EVENT,
  buildRecordingStartedProperties,
  buildScreenshotCapturedProperties,
  serializeError,
} from "./analytics";

describe("flag model", () => {
  it("defaults every known flag to a safe value", () => {
    for (const name of FLAG_NAMES) {
      expect(typeof FLAG_DEFAULTS[name]).toBe("boolean");
    }
    // Login is bypassed pre-auth.
    expect(FLAG_DEFAULTS["bypass-login"]).toBe(true);
  });

  it("uses stable identity defaults", () => {
    expect(DEFAULT_PRODUCT).toBe("kaipu-recorder");
    expect(DEFAULT_SURFACE).toBe("desktop");
  });
});

describe("serializeError", () => {
  it("extracts name/message/stack from an Error", () => {
    const payload = serializeError(new TypeError("boom"));
    expect(payload.name).toBe("TypeError");
    expect(payload.message).toBe("boom");
    expect(payload.stack).toContain("boom");
  });

  it("survives non-Error throws", () => {
    expect(serializeError("nope")).toEqual({ name: "Error", message: "nope", stack: null });
    expect(serializeError(undefined).message).toBe("Unknown error");
  });
});

describe("screenshot_captured", () => {
  it("keeps a stable event name", () => {
    expect(SCREENSHOT_CAPTURED_EVENT).toBe("screenshot_captured");
  });

  it("carries exactly mode, platform, displays and outcome, nothing else", () => {
    const leaky = {
      mode: "frame",
      platform: "darwin",
      displays: 2,
      outcome: "captured",
      rect: { x: 1, y: 2, width: 3, height: 4 },
      png: new ArrayBuffer(8),
    } as Parameters<typeof buildScreenshotCapturedProperties>[0];
    expect(buildScreenshotCapturedProperties(leaky)).toEqual({
      mode: "frame",
      platform: "darwin",
      displays: 2,
      outcome: "captured",
    });
  });

  it("carries after when set and drops anything beyond the allowed fields", () => {
    const input = {
      mode: "window",
      platform: "darwin",
      displays: 1,
      outcome: "captured",
      after: "quiet",
      title: "secret",
    } as Parameters<typeof buildScreenshotCapturedProperties>[0];
    expect(buildScreenshotCapturedProperties(input)).toEqual({
      mode: "window",
      platform: "darwin",
      displays: 1,
      outcome: "captured",
      after: "quiet",
    });
  });
});

describe("buildRecordingStartedProperties", () => {
  it("names the mode from the source and the area, and nothing else", () => {
    const base = { platform: "darwin", displays: 2 };
    expect(
      buildRecordingStartedProperties({ ...base, sourceId: "screen:1:0", area: false }),
    ).toEqual({ mode: "screen", platform: "darwin", displays: 2 });
    expect(
      buildRecordingStartedProperties({ ...base, sourceId: "screen:1:0", area: true }),
    ).toEqual({ mode: "area", platform: "darwin", displays: 2 });
    expect(
      buildRecordingStartedProperties({ ...base, sourceId: "window:42:0", area: false }),
    ).toEqual({ mode: "window", platform: "darwin", displays: 2 });
    const leaky = {
      ...base,
      sourceId: "screen:1:0",
      area: true,
      title: "Secret plan",
    } as Parameters<typeof buildRecordingStartedProperties>[0];
    expect(buildRecordingStartedProperties(leaky)).not.toHaveProperty("title");
    expect(buildRecordingStartedProperties(leaky)).not.toHaveProperty("sourceId");
  });

  it("adds the size bucket and the ratio for an area, never the dimensions", () => {
    const base = { platform: "darwin", displays: 1, sourceId: "screen:1:0" };
    expect(
      buildRecordingStartedProperties({
        ...base,
        area: true,
        areaSize: { width: 2560, height: 1440 },
        ratio: "16:9",
      }),
    ).toEqual({ mode: "area", platform: "darwin", displays: 1, size: "1440p+", ratio: "16:9" });
    // No locked ratio: inferred from the size, like the capture metadata.
    expect(
      buildRecordingStartedProperties({
        ...base,
        area: true,
        areaSize: { width: 720, height: 1280 },
      }),
    ).toMatchObject({ size: "720p", ratio: "9:16" });
    expect(
      buildRecordingStartedProperties({
        ...base,
        area: true,
        areaSize: { width: 900, height: 500 },
      }),
    ).toMatchObject({ size: "<720p", ratio: "free" });
    // A whole screen carries neither.
    expect(
      buildRecordingStartedProperties({ ...base, area: false, areaSize: { width: 1, height: 1 } }),
    ).toEqual({ mode: "screen", platform: "darwin", displays: 1 });
  });
});
