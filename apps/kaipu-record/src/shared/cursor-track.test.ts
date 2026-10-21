import { describe, expect, it } from "vitest";
import {
  lastIndexAtOrBefore,
  parseCursorTrack,
  sampleCursor,
  serializeCursorTrack,
  type CursorTrack,
} from "./cursor-track";

const DISPLAY = { id: "1", width: 1600, height: 1000, scaleFactor: 2 };

function track(partial: Partial<CursorTrack> = {}): CursorTrack {
  return {
    version: 1,
    display: DISPLAY,
    anchor: "exact",
    clicksAvailable: true,
    t: [],
    x: [],
    y: [],
    clicks: [],
    ...partial,
  };
}

describe("parseCursorTrack", () => {
  it("round-trips a valid track", () => {
    const tr = track({ t: [0, 10], x: [0.1, 0.2], y: [0.3, 0.4] });
    expect(parseCursorTrack(serializeCursorTrack(tr))).toEqual(tr);
  });
  it("keeps truncatedAtMs when it is there, and omits it when it is not", () => {
    const tr = track({ t: [0], x: [0], y: [0], truncatedAtMs: 8_000_000 });
    expect(parseCursorTrack(serializeCursorTrack(tr))?.truncatedAtMs).toBe(8_000_000);
    expect(parseCursorTrack(serializeCursorTrack(track()))).not.toHaveProperty("truncatedAtMs");
  });
  it.each([
    ["bad json", "{"],
    ["wrong version", JSON.stringify({ ...track(), version: 2 })],
    ["ragged arrays", JSON.stringify(track({ t: [0, 1], x: [0], y: [0] }))],
    ["unsorted t", JSON.stringify(track({ t: [5, 1], x: [0, 0], y: [0, 0] }))],
    ["bad button", JSON.stringify(track({ clicks: [{ t: 0, x: 0, y: 0, button: 7 as 0 }] }))],
    ["zero display", JSON.stringify(track({ display: { ...DISPLAY, width: 0 } }))],
    ["non-numeric truncatedAtMs", JSON.stringify({ ...track(), truncatedAtMs: "yes" })],
  ])("rejects %s", (_label: string, json: string) => {
    expect(parseCursorTrack(json)).toBeNull();
  });
});

describe("sampleCursor", () => {
  const tr = track({ t: [0, 100, 200], x: [0, 1, 1], y: [0, 0, 1] });
  it("interpolates between samples", () => {
    expect(sampleCursor(tr, 50)).toEqual({ x: 0.5, y: 0 });
    expect(sampleCursor(tr, 150)).toEqual({ x: 1, y: 0.5 });
  });
  it("clamps outside the track", () => {
    expect(sampleCursor(tr, -10)).toEqual({ x: 0, y: 0 });
    expect(sampleCursor(tr, 999)).toEqual({ x: 1, y: 1 });
  });
  it("returns null for an empty track", () => {
    expect(sampleCursor(track(), 10)).toBeNull();
  });
  it("binary search finds the last index at or before t", () => {
    expect(lastIndexAtOrBefore([0, 10, 10, 20], 10)).toBe(2);
    expect(lastIndexAtOrBefore([0, 10], -1)).toBe(-1);
  });
});
