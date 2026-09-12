import { describe, expect, it } from "vitest";
import type { StorageUsage } from "@shared/types/cloud-storage";
import { barSegments, toCapacityView } from "./capacity-view";
import { formatBytesDecimal } from "./format-bytes";

const USAGE: StorageUsage = {
  capacityBytes: 1_000_000_000,
  usedBytes: 610_000_000,
  reservedBytes: 130_000_000,
  availableBytes: 260_000_000,
  pendingUploads: 1,
  uploadsEnabled: true,
  cloudUploads: true,
};

describe("toCapacityView", () => {
  it("is loading before any answer", () => {
    expect(toCapacityView(null)).toEqual({ kind: "loading" });
  });

  it("passes failures through without inventing usage", () => {
    expect(toCapacityView({ kind: "error" })).toEqual({ kind: "error" });
    expect(toCapacityView({ kind: "session-expired" })).toEqual({ kind: "session-expired" });
  });

  it("marks a stale answer with its fetch time", () => {
    expect(toCapacityView({ kind: "stale", usage: USAGE, fetchedAt: 5 })).toEqual({
      kind: "usage",
      usage: USAGE,
      staleSince: 5,
      suspended: false,
    });
  });

  it("promotes no cloud access to beta-unavailable, before any bar", () => {
    expect(
      toCapacityView({ kind: "ok", usage: { ...USAGE, cloudUploads: false }, fetchedAt: 1 }),
    ).toEqual({ kind: "beta-unavailable" });
  });

  it("flags globally suspended uploads while keeping the numbers", () => {
    const view = toCapacityView({
      kind: "ok",
      usage: { ...USAGE, uploadsEnabled: false },
      fetchedAt: 1,
    });
    expect(view).toMatchObject({ kind: "usage", suspended: true, staleSince: null });
  });
});

describe("barSegments", () => {
  it("splits used and reserved as percentages of capacity", () => {
    const { used, reserved } = barSegments(USAGE);
    expect(used).toBeCloseTo(61);
    expect(reserved).toBeCloseTo(13);
  });

  it("never overflows the track on inconsistent numbers", () => {
    const s = barSegments({ ...USAGE, usedBytes: 900_000_000, reservedBytes: 500_000_000 });
    expect(s.used + s.reserved).toBeLessThanOrEqual(100);
    expect(barSegments({ ...USAGE, capacityBytes: 0 })).toEqual({ used: 0, reserved: 0 });
  });
});

describe("formatBytesDecimal", () => {
  it("uses decimal units", () => {
    expect(formatBytesDecimal(1_000_000_000)).toBe("1 GB");
    expect(formatBytesDecimal(610_000_000)).toBe("610 MB");
    expect(formatBytesDecimal(1_500_000)).toBe("1.5 MB");
    expect(formatBytesDecimal(999)).toBe("999 B");
  });
});
