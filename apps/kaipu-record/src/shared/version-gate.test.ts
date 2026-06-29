import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOWNLOAD_URL,
  compareSemver,
  evaluateGate,
  parseVersionGateConfig,
} from "./version-gate";

describe("compareSemver", () => {
  it("orders by major, minor, patch", () => {
    expect(compareSemver("1.0.0", "1.0.1")).toBe(-1);
    expect(compareSemver("1.2.0", "1.1.9")).toBe(1);
    expect(compareSemver("2.0.0", "2.0.0")).toBe(0);
  });

  it("compares numerically, not lexically", () => {
    expect(compareSemver("1.10.0", "1.9.0")).toBe(1);
    expect(compareSemver("1.0.10", "1.0.9")).toBe(1);
  });

  it("pads missing parts with zero", () => {
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
    expect(compareSemver("1", "1.0.1")).toBe(-1);
  });
});

const config = { minVersion: "1.2.0", latestVersion: "1.4.0" };

describe("evaluateGate", () => {
  it("hard-blocks below minVersion", () => {
    expect(evaluateGate("1.1.0", config).kind).toBe("hard");
  });

  it("soft-nudges at/above minVersion but below latestVersion", () => {
    expect(evaluateGate("1.2.0", config).kind).toBe("soft");
    expect(evaluateGate("1.3.9", config).kind).toBe("soft");
  });

  it("returns ok at/above latestVersion", () => {
    expect(evaluateGate("1.4.0", config).kind).toBe("ok");
    expect(evaluateGate("2.0.0", config).kind).toBe("ok");
  });

  it("uses config.message and config.downloadUrl when present", () => {
    const state = evaluateGate("1.0.0", {
      ...config,
      message: "Hola",
      downloadUrl: "https://x.test",
    });
    expect(state).toEqual({ kind: "hard", message: "Hola", downloadUrl: "https://x.test" });
  });

  it("falls back to a default download url when omitted", () => {
    const state = evaluateGate("1.0.0", config);
    if (state.kind === "ok") throw new Error("expected a block");
    expect(state.downloadUrl).toBe(DEFAULT_DOWNLOAD_URL);
  });
});

describe("parseVersionGateConfig", () => {
  it("accepts a well-formed object", () => {
    expect(parseVersionGateConfig({ minVersion: "1.0.0", latestVersion: "1.1.0" })).toEqual({
      minVersion: "1.0.0",
      latestVersion: "1.1.0",
    });
  });

  it("keeps optional message and downloadUrl", () => {
    expect(
      parseVersionGateConfig({
        minVersion: "1.0.0",
        latestVersion: "1.1.0",
        message: "m",
        downloadUrl: "u",
      }),
    ).toEqual({ minVersion: "1.0.0", latestVersion: "1.1.0", message: "m", downloadUrl: "u" });
  });

  it("returns null on missing required fields or wrong types", () => {
    expect(parseVersionGateConfig({ minVersion: "1.0.0" })).toBeNull();
    expect(parseVersionGateConfig({ minVersion: 1, latestVersion: "1.1.0" })).toBeNull();
    expect(parseVersionGateConfig(null)).toBeNull();
    expect(parseVersionGateConfig("nope")).toBeNull();
  });
});
