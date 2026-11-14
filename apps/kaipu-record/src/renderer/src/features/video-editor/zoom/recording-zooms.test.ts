import { describe, expect, it } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import { detectRecordingZooms, replaceAutoZooms } from "./recording-zooms";
import { detectZoomSegments } from "./detect-zoom-segments";
import type { ZoomSegment } from "./zoom-model";

const track = (durationMs: number, clickTimes: number[]): CursorTrack => ({
  version: 1,
  display: { id: "1", width: 1600, height: 1000, scaleFactor: 2 },
  anchor: "exact",
  clicksAvailable: true,
  t: [0, durationMs],
  x: [0.5, 0.5],
  y: [0.5, 0.5],
  clicks: clickTimes.map((t) => ({ t, x: 0.5, y: 0.5, button: 0 })),
});

const TRACK_A = track(20_000, [10_000]);
const TRACK_B = track(30_000, [5_000, 25_000]);
const SENSITIVITY = 55;

const manual = (id: string, start: number, end: number): ZoomSegment => ({
  id,
  start,
  end,
  scale: 2,
  mode: "follow",
  anchor: null,
  smoothing: 70,
  origin: "manual",
  trigger: null,
});

describe("detectRecordingZooms", () => {
  it("is the plain detector for one recording at offset 0", () => {
    expect(
      detectRecordingZooms([{ offset: 0, duration: 20, track: TRACK_A }], SENSITIVITY),
    ).toEqual(detectZoomSegments(TRACK_A, 20, SENSITIVITY));
  });

  it("puts each recording's zooms inside its own range", () => {
    const zooms = detectRecordingZooms(
      [
        { offset: 0, duration: 20, track: TRACK_A },
        { offset: 3600, duration: 30, track: TRACK_B },
      ],
      SENSITIVITY,
    );
    const inA = zooms.filter((z) => z.start < 3600);
    const inB = zooms.filter((z) => z.start >= 3600);
    expect(inA.length).toBeGreaterThan(0);
    expect(inB.length).toBeGreaterThan(1);
    expect(inA.length + inB.length).toBe(zooms.length);
    for (const z of inA) expect(z.end).toBeLessThanOrEqual(20);
    for (const z of inB) {
      expect(z.start).toBeGreaterThanOrEqual(3600);
      expect(z.end).toBeLessThanOrEqual(3630);
    }
  });

  it("shifts B's segments by its offset and keeps ids unique", () => {
    const local = detectZoomSegments(TRACK_B, 30, SENSITIVITY);
    const zooms = detectRecordingZooms(
      [{ offset: 3600, duration: 30, track: TRACK_B }],
      SENSITIVITY,
    );
    expect(zooms.map((z) => [z.start, z.end])).toEqual(
      local.map((z) => [z.start + 3600, z.end + 3600]),
    );
    expect(zooms[0].id).toBe(`auto-${Math.round(zooms[0].start * 1000)}`);
    const all = detectRecordingZooms(
      [
        { offset: 0, duration: 20, track: TRACK_A },
        { offset: 3600, duration: 30, track: TRACK_B },
        { offset: 7200, duration: 30, track: TRACK_B },
      ],
      SENSITIVITY,
    );
    expect(new Set(all.map((z) => z.id)).size).toBe(all.length);
    expect(all.map((z) => z.start)).toEqual(all.map((z) => z.start).sort((a, b) => a - b));
  });

  it("detects nothing for a recording without a track", () => {
    expect(
      detectRecordingZooms([{ offset: 3600, duration: 30, track: null }], SENSITIVITY),
    ).toEqual([]);
  });
});

describe("replaceAutoZooms", () => {
  const recordings = [
    { offset: 0, duration: 20, track: TRACK_A },
    { offset: 3600, duration: 30, track: TRACK_B },
  ];

  it("replaces autos in every recording and keeps manual zooms in each range", () => {
    const stale = { ...manual("stale", 3618, 3619), origin: "auto" as const };
    const current = [manual("m-a", 2, 4), stale, manual("m-b", 3601, 3603)];
    const next = replaceAutoZooms(current, recordings, SENSITIVITY);
    expect(next.find((z) => z.id === "stale")).toBeUndefined();
    expect(next.filter((z) => z.origin === "manual").map((z) => z.id)).toEqual(["m-a", "m-b"]);
    expect(next.some((z) => z.origin === "auto" && z.start >= 3600)).toBe(true);
    expect(next.some((z) => z.origin === "auto" && z.start < 20)).toBe(true);
  });

  it("leaves a recording without a track alone, auto segments included", () => {
    const autoB = { ...manual("auto-3601000", 3601, 3603), origin: "auto" as const };
    const next = replaceAutoZooms(
      [autoB],
      [
        { offset: 0, duration: 20, track: TRACK_A },
        { offset: 3600, duration: 30, track: null },
      ],
      SENSITIVITY,
    );
    expect(next).toContainEqual(autoB);
    expect(next).toHaveLength(1 + detectZoomSegments(TRACK_A, 20, SENSITIVITY).length);
  });

  it("never mints the id of a manual zoom lying outside every range", () => {
    const [first] = detectZoomSegments(TRACK_A, 20, SENSITIVITY);
    const edited = manual(first.id, -1, -0.5);
    const next = replaceAutoZooms([edited], recordings, SENSITIVITY);
    expect(next.filter((z) => z.id === first.id)).toEqual([edited]);
  });

  it("keeps the zooms of a recording the caller did not list", () => {
    const autoB = { ...manual("auto-3601000", 3601, 3603), origin: "auto" as const };
    const manualB = manual("m-b", 3610, 3612);
    const next = replaceAutoZooms(
      [autoB, manualB],
      [{ offset: 0, duration: 20, track: TRACK_A }],
      SENSITIVITY,
    );
    expect(next).toContainEqual(autoB);
    expect(next).toContainEqual(manualB);
  });
});
