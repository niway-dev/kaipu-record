import { describe, expect, it } from "vitest";
import { CursorSampleBuffer, MAX_CURSOR_SAMPLES } from "./cursor-sample-buffer";

describe("CursorSampleBuffer", () => {
  it("skips duplicates but writes the last one before a move", () => {
    const b = new CursorSampleBuffer();
    b.push(0, 0.5, 0.5);
    b.push(8, 0.5, 0.5);
    b.push(16, 0.5, 0.5);
    b.push(24, 0.6, 0.5);
    expect(b.t).toEqual([0, 16, 24]);
    expect(b.x).toEqual([0.5, 0.5, 0.6]);
  });
  it("flush writes a trailing duplicate", () => {
    const b = new CursorSampleBuffer();
    b.push(0, 0.1, 0.1);
    b.push(500, 0.1, 0.1);
    b.flush();
    expect(b.t).toEqual([0, 500]);
  });
  it("rounds to 1e-4 so sub-pixel jitter counts as a duplicate", () => {
    const b = new CursorSampleBuffer();
    b.push(0, 0.12341, 0.5);
    b.push(8, 0.12344, 0.5);
    b.flush();
    expect(b.x).toEqual([0.1234, 0.1234]);
  });
  it("stops at the cap and records when it stopped", () => {
    const b = new CursorSampleBuffer();
    for (let i = 0; i <= MAX_CURSOR_SAMPLES; i++) b.push(i, (i % 2) / 2, 0);
    expect(b.length).toBe(MAX_CURSOR_SAMPLES);
    // One push per sample, t === i, so the first rejected sample is t = the cap.
    expect(b.truncatedAtMs).toBe(MAX_CURSOR_SAMPLES);
    b.push(MAX_CURSOR_SAMPLES + 50, 0, 0);
    expect(b.truncatedAtMs).toBe(MAX_CURSOR_SAMPLES); // first drop wins
  });
});
