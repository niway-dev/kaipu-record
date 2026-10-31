import { describe, expect, it } from "vitest";
import { WebcamGapLog } from "./webcam-gaps";

describe("WebcamGapLog", () => {
  it("records each off period, in the order it happened", () => {
    const log = new WebcamGapLog();
    log.open(5000);
    log.close(10_000);
    log.open(20_000);
    log.close(21_000);
    expect(log.finish(30_000)).toEqual([
      { startMs: 5000, endMs: 10_000 },
      { startMs: 20_000, endMs: 21_000 },
    ]);
  });

  it("closes a gap still open at the take's end: the camera was off when it stopped", () => {
    const log = new WebcamGapLog();
    log.open(8000);
    expect(log.finish(12_000)).toEqual([{ startMs: 8000, endMs: 12_000 }]);
  });

  it("keeps the first off time when the camera is turned off again before it came back", () => {
    const log = new WebcamGapLog();
    log.open(1000);
    log.open(2000);
    log.close(3000);
    log.close(4000); // nothing open
    expect(log.finish(9000)).toEqual([{ startMs: 1000, endMs: 3000 }]);
  });

  it("drops an empty gap (off and on within the same paused instant)", () => {
    const log = new WebcamGapLog();
    log.open(4000);
    log.close(4000);
    expect(log.finish(9000)).toEqual([]);
  });
});
