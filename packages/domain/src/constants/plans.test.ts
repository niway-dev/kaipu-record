import { describe, expect, it } from "vitest";
import {
  BETA_EXPANSION_CAPACITY_BYTES,
  FREE_CLOUD_CAPACITY_BYTES,
  PLAN_IDS,
  PLANS,
  PRO_CLOUD_CAPACITY_BYTES,
  planCopyValues,
} from "./plans";

/**
 * Pins the plan table. Changing a number here is a product decision — update
 * apps/documentation/src/content/docs/features/plans.md in the same change.
 */
describe("plan table", () => {
  it("Free (verified) is 250 MB — the sign-up incentive (NIW2-232)", () => {
    expect(FREE_CLOUD_CAPACITY_BYTES).toBe(250_000_000);
    expect(PLANS.free.cloudStorageBytes).toBe(250_000_000);
  });

  it("Pro is 15 GB (cloud trial spec, Decision 4)", () => {
    expect(PRO_CLOUD_CAPACITY_BYTES).toBe(15_000_000_000);
    expect(PLANS.pro.cloudStorageBytes).toBe(15_000_000_000);
  });

  it("the beta expansion is 1 GB total", () => {
    expect(BETA_EXPANSION_CAPACITY_BYTES).toBe(1_000_000_000);
  });

  it("has exactly free and pro, each with its own display key and the shared per-file caps", () => {
    expect(PLAN_IDS).toEqual(["free", "pro"]);
    expect(PLANS).toEqual({
      free: {
        id: "free",
        nameKey: "planFree",
        cloudStorageBytes: 250_000_000,
        maxVideoBytes: 1_000_000_000,
        maxScreenshotBytes: 25_000_000,
        requiresVerifiedEmail: true,
      },
      pro: {
        id: "pro",
        nameKey: "planPro",
        cloudStorageBytes: 15_000_000_000,
        maxVideoBytes: 1_000_000_000,
        maxScreenshotBytes: 25_000_000,
        requiresVerifiedEmail: true,
      },
    });
  });

  it("formats the copy values the messages interpolate", () => {
    expect(planCopyValues()).toEqual({
      freeCapacity: "250 MB",
      proCapacity: "15 GB",
      expansionCapacity: "1 GB",
      perVideo: "1 GB",
      perScreenshot: "25 MB",
    });
  });
});
