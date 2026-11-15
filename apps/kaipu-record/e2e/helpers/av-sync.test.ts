import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  audioStartFromLevels,
  beepOnsets,
  flashOnsets,
  measureAvSync,
  pairEvents,
  parseMetadataPrint,
  risingEdges,
} from "./av-sync";

const FIXTURES = path.resolve(__dirname, "..", "..", "verify", "fixtures", "av-sync");
// CI installs ffmpeg for the desktop unit tests, so there the fixture measurements always run
// and a missing binary fails them. A laptop without ffmpeg skips them, and says so.
const skipFixtures = !process.env.CI && spawnSync("ffmpeg", ["-version"]).status !== 0;
if (skipFixtures) {
  process.stderr.write(
    "av-sync.test.ts: ffmpeg is not on PATH, skipping the fixture measurements\n",
  );
}

describe("parseMetadataPrint", () => {
  it("reads each frame's pts_time and the value of the key, including -inf", () => {
    const output = [
      "frame:0    pts:0       pts_time:0",
      "lavfi.astats.Overall.RMS_level=-inf",
      "frame:1    pts:24      pts_time:0.0005",
      "lavfi.astats.Overall.RMS_level=-12.5",
      "frame:2    pts:48      pts_time:0.001",
      "lavfi.signalstats.YAVG=16.0",
    ].join("\n");
    expect(parseMetadataPrint(output, "lavfi.astats.Overall.RMS_level")).toEqual([
      { t: 0, value: Number.NEGATIVE_INFINITY },
      { t: 0.0005, value: -12.5 },
    ]);
  });
});

describe("onsets", () => {
  it("finds the first frame of each flash", () => {
    const luma = [0, 1, 2, 3, 4].map((i) => ({ t: i / 30, value: i === 2 || i === 3 ? 235 : 32 }));
    expect(flashOnsets(luma)).toEqual([2 / 30]);
  });

  it("puts a beep at its loud edge, not at the quieter pre-echo before it", () => {
    const levels = [-Infinity, -45, -30, -9, -9, -9, -Infinity];
    const rms = levels.map((value, i) => ({ t: 2 + i * 0.0005, value }));
    expect(beepOnsets(rms)).toEqual([2.0015]);
  });

  it("keeps a dip inside one beep as one event", () => {
    const values = [0, 10, 0, 10, 0].map((value, i) => ({ t: i / 10, value }));
    expect(risingEdges(values, 5, 0.5)).toEqual([0.1]);
    expect(risingEdges(values, 5)).toEqual([0.1, 0.3]);
  });
});

describe("pairEvents", () => {
  it("gives audio minus video per event in milliseconds", () => {
    expect(pairEvents([2, 4], [2.044, 3.9995])).toEqual([44, -0.5]);
  });

  it("fails when an event lost its beep", () => {
    expect(() => pairEvents([2, 4], [2])).toThrow(/one beep per flash/);
  });
});

// The measurement against files whose offsets are known (see verify/fixtures/av-sync/README.md).
// Each case decodes a 10 s fixture twice (video and audio): well under a second on a laptop,
// slower on a shared CI runner, so the budget is above the node project's 5 s default.
describe.skipIf(skipFixtures)("measureAvSync on the fixtures", { timeout: 30_000 }, () => {
  it.each([
    ["ffmpeg.mp4", 0],
    ["mb161.mp4", 44],
    ["mb166.mp4", 0],
  ])("%s plays its beeps %d ms after the flashes", async (file, offsetMs) => {
    const report = await measureAvSync(path.join(FIXTURES, file));
    expect(report.flashes).toEqual([2, 4, 6, 8]);
    for (const offset of report.offsetsMs)
      expect(Math.abs(offset - offsetMs)).toBeLessThanOrEqual(0.5);
  });

  it("shows mb166's priming on the raw packet timeline, where the edit list is ignored", async () => {
    const report = await measureAvSync(path.join(FIXTURES, "mb166.mp4"), { rawTimeline: true });
    for (const offset of report.offsetsMs) expect(Math.abs(offset - 44)).toBeLessThanOrEqual(0.5);
  });
});

describe("audioStartFromLevels", () => {
  const luma = [0, 1, 2].map((i) => ({ t: i / 30, value: 32 }));

  it("finds where a continuous tone becomes audible and counts holes after it", () => {
    // 0–10 ms silent (lost start), 10–20 ms loud, 20–22 ms silent (a hole), then loud to 200 ms.
    const rms = Array.from({ length: 400 }, (_, i) => {
      const t = i * 0.0005;
      const quiet = t < 0.01 || (t >= 0.02 && t < 0.022);
      return { t, value: quiet ? Number.NEGATIVE_INFINITY : -18 };
    });
    const report = audioStartFromLevels(luma, rms);
    expect(report.firstLoudSec).toBeCloseTo(0.01, 6);
    expect(report.silentAfterStartMs).toBe(2);
    expect(report.firstVideoSec).toBe(0);
  });

  it("ignores the quiet encoder tail in the last 50 ms", () => {
    const rms = Array.from({ length: 400 }, (_, i) => ({
      t: i * 0.0005,
      value: i >= 380 ? Number.NEGATIVE_INFINITY : -18,
    }));
    expect(audioStartFromLevels(luma, rms).silentAfterStartMs).toBe(0);
  });
});
