import { describe, expect, it } from "vitest";
import { BufferTarget, Mp4OutputFormat, Output } from "mediabunny";
import { waitForFirstMediaTimestamp } from "./first-media-timestamp";

describe("waitForFirstMediaTimestamp", () => {
  it("mediabunny still exposes the private field (upgrade guard)", () => {
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    // If this fails after a mediabunny upgrade, the cursor track silently degrades to
    // "estimated" anchors — find the new field in media-source.js before upgrading.
    expect("_firstMediaStreamTimestamp" in output).toBe(true);
  });

  it("returns the field in ms once mediabunny fills it", async () => {
    const output: { _firstMediaStreamTimestamp: number | null } = {
      _firstMediaStreamTimestamp: null,
    };
    let clock = 0;
    const result = await waitForFirstMediaTimestamp(output, 999, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
        if (clock >= 48) output._firstMediaStreamTimestamp = 12.5;
      },
    });
    expect(result).toEqual({ rendererMs: 12_500, quality: "exact" });
  });

  it("falls back to the estimate when the field never fills", async () => {
    let clock = 0;
    const result = await waitForFirstMediaTimestamp({ _firstMediaStreamTimestamp: null }, 777, {
      timeoutMs: 100,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(result).toEqual({ rendererMs: 777, quality: "estimated" });
  });

  it("falls back immediately when the field does not exist", async () => {
    expect(await waitForFirstMediaTimestamp({}, 5)).toEqual({
      rendererMs: 5,
      quality: "estimated",
    });
  });
});
