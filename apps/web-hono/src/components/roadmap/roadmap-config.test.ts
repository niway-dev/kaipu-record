import { describe, expect, it } from "vitest";

import { ROADMAP_ITEMS, platformCounts, stateOf } from "./roadmap-config";

describe("roadmap config", () => {
  it("keeps ids unique, so React keys never collide", () => {
    const ids = ROADMAP_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The Windows beta is downloadable (0.13.0), but a cell flips only after owner
  // QA on Windows hardware (decision 10). Relax this in the PR that flips the first.
  it("claims nothing shipped on Windows before hardware QA confirms a feature", () => {
    expect(platformCounts("win").shipped).toBe(0);
  });

  it("groups a row by its most advanced platform when both are shown", () => {
    const row = ROADMAP_ITEMS.find((item) => item.id === "screenAndCamera")!;
    expect(stateOf(row, "all")).toBe("shipped");
    expect(stateOf(row, "mac")).toBe("shipped");
    expect(stateOf(row, "win")).toBe("inProgress");
  });

  it("counts every row once per platform", () => {
    for (const platform of ["mac", "win"] as const) {
      const counts = platformCounts(platform);
      expect(counts.shipped + counts.inProgress + counts.planned).toBe(ROADMAP_ITEMS.length);
    }
  });
});
