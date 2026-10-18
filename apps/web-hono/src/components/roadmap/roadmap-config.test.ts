import { describe, expect, it } from "vitest";

import { ROADMAP_ITEMS, platformCounts, stateOf } from "./roadmap-config";

describe("roadmap config", () => {
  it("keeps ids unique, so React keys never collide", () => {
    const ids = ROADMAP_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // "Shipped" means "in the build you can download", and no Windows build is on
  // the download feed yet. Flip this in the same PR as the first Windows installer.
  it("claims nothing shipped on Windows before the Windows build is downloadable", () => {
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
