import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPTURE_WIDGET_SETTINGS,
  sanitizeCaptureWidgetSettings,
} from "./capture-widget-settings";
import { DEFAULT_SETTINGS } from "./types/ipc";

describe("sanitizeCaptureWidgetSettings", () => {
  it("starts compact for both capture types", () => {
    expect(DEFAULT_CAPTURE_WIDGET_SETTINGS).toEqual({
      screenshotExpanded: false,
      recordingExpanded: false,
    });
    expect(DEFAULT_SETTINGS.captureWidget).toEqual(DEFAULT_CAPTURE_WIDGET_SETTINGS);
  });

  it("falls back to the defaults for anything that is not an object", () => {
    expect(sanitizeCaptureWidgetSettings(undefined)).toEqual(DEFAULT_CAPTURE_WIDGET_SETTINGS);
    expect(sanitizeCaptureWidgetSettings(null)).toEqual(DEFAULT_CAPTURE_WIDGET_SETTINGS);
    expect(sanitizeCaptureWidgetSettings("expanded")).toEqual(DEFAULT_CAPTURE_WIDGET_SETTINGS);
    expect(sanitizeCaptureWidgetSettings(3)).toEqual(DEFAULT_CAPTURE_WIDGET_SETTINGS);
  });

  it("keeps each capture type's value apart", () => {
    expect(sanitizeCaptureWidgetSettings({ recordingExpanded: true })).toEqual({
      screenshotExpanded: false,
      recordingExpanded: true,
    });
    expect(sanitizeCaptureWidgetSettings({ screenshotExpanded: true })).toEqual({
      screenshotExpanded: true,
      recordingExpanded: false,
    });
  });

  it("drops a value that is not a boolean", () => {
    expect(
      sanitizeCaptureWidgetSettings({ screenshotExpanded: "yes", recordingExpanded: 1 }),
    ).toEqual(DEFAULT_CAPTURE_WIDGET_SETTINGS);
  });
});
