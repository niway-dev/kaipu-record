import { describe, expect, it } from "vitest";
import {
  applyFlagOverride,
  flagOverridesArg,
  parseFlagOverrides,
  readFlagOverridesArg,
} from "./flag-overrides";

describe("parseFlagOverrides", () => {
  it("flips a known flag", () => {
    const { overrides, rejected } = parseFlagOverrides('{"native-cursor-capture":true}', {
      isPackaged: false,
    });
    expect(overrides).toEqual({ "native-cursor-capture": true });
    expect(rejected).toEqual([]);
  });

  it("ignores the variable entirely in a packaged build", () => {
    const result = parseFlagOverrides('{"native-cursor-capture":true}', { isPackaged: true });
    expect(result).toEqual({ overrides: {}, rejected: [] });
  });

  it("rejects an unknown key and keeps the valid ones", () => {
    const { overrides, rejected } = parseFlagOverrides('{"nope":true,"image-canvas":false}', {
      isPackaged: false,
    });
    expect(overrides).toEqual({ "image-canvas": false });
    expect(rejected).toEqual(["nope (unknown flag)"]);
  });

  it("rejects a non-boolean value", () => {
    const { overrides, rejected } = parseFlagOverrides('{"image-canvas":"yes"}', {
      isPackaged: false,
    });
    expect(overrides).toEqual({});
    expect(rejected).toEqual(["image-canvas (not a boolean)"]);
  });

  it("yields no overrides for invalid JSON or a non-object", () => {
    expect(parseFlagOverrides("{oops", { isPackaged: false }).overrides).toEqual({});
    expect(parseFlagOverrides("{oops", { isPackaged: false }).rejected).toHaveLength(1);
    expect(parseFlagOverrides("[true]", { isPackaged: false }).overrides).toEqual({});
  });

  it("yields nothing when the variable is unset", () => {
    expect(parseFlagOverrides(undefined, { isPackaged: false })).toEqual({
      overrides: {},
      rejected: [],
    });
  });
});

describe("readFlagOverridesArg", () => {
  it("round-trips through the process argument", () => {
    const argv = ["electron", "--foo", flagOverridesArg({ "image-canvas": false })];
    expect(readFlagOverridesArg(argv)).toEqual({ "image-canvas": false });
  });

  it("is empty when the argument is absent", () => {
    expect(readFlagOverridesArg(["electron", "--foo"])).toEqual({});
  });
});

describe("applyFlagOverride", () => {
  it("pins a known flag on top of the current overrides without mutating them", () => {
    const current = { "image-canvas": true } as const;
    const next = applyFlagOverride(current, "image-text", false, { isPackaged: false });
    expect(next).toEqual({ "image-canvas": true, "image-text": false });
    expect(current).toEqual({ "image-canvas": true });
  });

  it("clears one flag when the value is null, so it falls back to PostHog or the default", () => {
    const next = applyFlagOverride(
      { "image-canvas": true, "image-text": false },
      "image-canvas",
      null,
      { isPackaged: false },
    );
    expect(next).toEqual({ "image-text": false });
  });

  it("never sets an override in a packaged build", () => {
    expect(applyFlagOverride({}, "image-canvas", true, { isPackaged: true })).toEqual({});
  });

  it("ignores an unknown flag name and a non-boolean value", () => {
    const current = { "image-canvas": true } as const;
    expect(applyFlagOverride(current, "nope", true, { isPackaged: false })).toEqual(current);
    expect(applyFlagOverride(current, "image-text", "yes", { isPackaged: false })).toEqual(current);
  });
});
