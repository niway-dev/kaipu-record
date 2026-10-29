/**
 * REC-B8: the tail cut must be computed in VIDEO time. Uses the real 25 s fixture's samples and appends
 * the final 150 ms of synthetic samples at the 8 ms poll interval.
 *
 * The builder cannot know which clock produced `maxMs`: this file pins the builder contract, and the
 * recorder-store "video time" tests are the real regression guard.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCursorTrack } from "@shared/cursor-track";
import { buildCursorTrack } from "./build-cursor-track";

const FIXTURES_DIR = join(__dirname, "..", "..", "shared", "__fixtures__");
const fixture = parseCursorTrack(
  readFileSync(join(FIXTURES_DIR, "real-screen-2026-09-22.cursor.json"), "utf8"),
);

const T0 = 10_000; // main-clock ms of video time 0 (arbitrary)
const MEDIA_MS = 25_900; // true media length of the fixture (1245 frames at 48 fps)
const TAIL = Array.from({ length: 19 }, (_, i) => 25_752 + i * 8); // 25 752 … 25 896

function build(maxMs: number) {
  if (!fixture) throw new Error("fixture did not parse");
  return buildCursorTrack({
    raw: {
      t: [...fixture.t, ...TAIL].map((v) => v + T0),
      x: [...fixture.x, ...TAIL.map(() => 0.9)],
      y: [...fixture.y, ...TAIL.map(() => 0.9)],
      clicks: [],
    },
    anchor: { t0: T0, pauses: [] },
    anchorQuality: "exact",
    clicksAvailable: false,
    display: fixture.display,
    maxMs,
  });
}

describe("cursor track tail (REC-B8)", () => {
  it("keeps every sample in the last 150 ms when maxMs is the video duration + margin", () => {
    const track = build(MEDIA_MS + 250);
    expect(track.t).toHaveLength(1226 + TAIL.length);
    expect(track.t.at(-1)).toBe(25_896);
  });

  it("drops the final ~100 ms when maxMs comes from a clock that started 350 ms late (the old bug)", () => {
    const track = build(MEDIA_MS - 350 + 250);
    expect(track.t.at(-1)).toBe(25_800);
    expect(track.t).toHaveLength(1226 + 7);
  });
});
