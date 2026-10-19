import { describe, expect, it } from "vitest";
import { chooseVideoEncoding } from "./video-encoding";

const TIER = { quantizer: 30, videoBitrate: 2_500_000, keyFrameInterval: 10 };
const FIXED = { quantizer: null, videoBitrate: 8_000_000, keyFrameInterval: 2 };

describe("chooseVideoEncoding", () => {
  it("encodes a tier in quantizer mode on hardware, with the bitrate as fallback", () => {
    expect(chooseVideoEncoding(TIER, { hardwareQuantizer: true, hardwareBitrate: true })).toEqual({
      rateControl: "quantizer",
      quantizer: 30,
      bitrate: 2_500_000,
      hardwareAcceleration: "prefer-hardware",
      keyFrameInterval: 10,
      softwareFallback: false,
      quantizerUnsupported: false,
    });
  });

  it("falls back to the tier's bitrate on hardware without quantizer support", () => {
    const choice = chooseVideoEncoding(TIER, { hardwareQuantizer: false, hardwareBitrate: true });
    expect(choice).toMatchObject({
      rateControl: "bitrate",
      quantizer: null,
      bitrate: 2_500_000,
      hardwareAcceleration: "prefer-hardware",
      keyFrameInterval: 10,
      softwareFallback: false,
      quantizerUnsupported: true,
    });
  });

  it("still exports with no hardware encoder, at the bitrate, and flags it", () => {
    const choice = chooseVideoEncoding(TIER, { hardwareQuantizer: false, hardwareBitrate: false });
    expect(choice).toMatchObject({
      rateControl: "bitrate",
      quantizer: null,
      hardwareAcceleration: "no-preference",
      softwareFallback: true,
      quantizerUnsupported: true,
    });
  });

  it("keeps a bitrate preset on its bitrate, never in quantizer mode", () => {
    const choice = chooseVideoEncoding(FIXED, { hardwareQuantizer: true, hardwareBitrate: true });
    expect(choice).toMatchObject({
      rateControl: "bitrate",
      bitrate: 8_000_000,
      hardwareAcceleration: "prefer-hardware",
      keyFrameInterval: 2,
      quantizerUnsupported: false,
    });
  });

  it("passes Maximum's 'high' level through", () => {
    const max = { quantizer: null, videoBitrate: "high" as const, keyFrameInterval: 10 };
    expect(
      chooseVideoEncoding(max, { hardwareQuantizer: false, hardwareBitrate: true }).bitrate,
    ).toBe("high");
  });
});
