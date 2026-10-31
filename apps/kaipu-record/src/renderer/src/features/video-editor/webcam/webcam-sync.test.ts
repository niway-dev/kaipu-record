import { describe, expect, it } from "vitest";
import {
  WEBCAM_DRIFT_SECONDS,
  webcamHasFrameAt,
  webcamResyncTarget,
  webcamSeekLead,
  webcamTimeFor,
} from "./webcam-sync";

describe("webcamTimeFor", () => {
  it("subtracts the offset: a webcam that started 500 ms late is at 0 when the screen is at 0.5 s", () => {
    expect(webcamTimeFor(0.5, 500)).toBe(0);
    expect(webcamTimeFor(10, 500)).toBe(9.5);
  });

  it("a webcam that started first is ahead of the screen", () => {
    expect(webcamTimeFor(0, -200)).toBeCloseTo(0.2);
  });
});

describe("webcamHasFrameAt", () => {
  it("is hidden before the webcam's first frame", () => {
    expect(webcamHasFrameAt(-0.01, 30)).toBe(false);
  });

  it("is shown inside the file and hidden from its last frame on", () => {
    expect(webcamHasFrameAt(0, 30)).toBe(true);
    expect(webcamHasFrameAt(29.99, 30)).toBe(true);
    expect(webcamHasFrameAt(30, 30)).toBe(false);
  });

  it("shows nothing until the metadata says how long the file is", () => {
    expect(webcamHasFrameAt(1, Number.NaN)).toBe(false);
    expect(webcamHasFrameAt(1, 0)).toBe(false);
  });

  it("has no last frame for an unbounded duration", () => {
    expect(webcamHasFrameAt(1e6, Number.POSITIVE_INFINITY)).toBe(true);
  });
});

describe("webcamResyncTarget", () => {
  it("leaves a webcam within the drift alone", () => {
    expect(webcamResyncTarget(10, 10 + WEBCAM_DRIFT_SECONDS - 0.001, 30)).toBeNull();
    expect(webcamResyncTarget(10.05, 10, 30)).toBeNull();
  });

  it("re-seeks past 80 ms, either way", () => {
    expect(webcamResyncTarget(10, 10.09, 30)).toBe(10.09);
    expect(webcamResyncTarget(10.2, 10, 30)).toBe(10);
  });

  it("clamps the target into the file", () => {
    expect(webcamResyncTarget(5, -1, 30)).toBe(0);
    expect(webcamResyncTarget(5, 40, 30)).toBe(30);
  });

  it("does not seek when already parked at the clamped end", () => {
    expect(webcamResyncTarget(30, 40, 30)).toBeNull();
  });
});

describe("webcamSeekLead", () => {
  it("leads a seek during playback by the last seek's duration, so it lands on time", () => {
    expect(webcamSeekLead(true, 0.4)).toBeCloseTo(0.4);
  });

  it("does not lead while paused: the main clock is not moving", () => {
    expect(webcamSeekLead(false, 0.4)).toBe(0);
  });

  it("ignores seeks short enough for the drift rule, and caps a pathological one", () => {
    expect(webcamSeekLead(true, WEBCAM_DRIFT_SECONDS / 2)).toBe(0);
    expect(webcamSeekLead(true, 5)).toBe(1);
    expect(webcamSeekLead(true, Number.NaN)).toBe(0);
  });
});
