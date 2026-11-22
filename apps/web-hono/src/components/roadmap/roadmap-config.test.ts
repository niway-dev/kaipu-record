import { describe, expect, it } from "vitest";

import { ROADMAP_ITEMS, ROADMAP_STATES, platformCounts, stateOf } from "./roadmap-config";

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
      const total = ROADMAP_STATES.reduce((sum, state) => sum + counts[state], 0);
      expect(total).toBe(ROADMAP_ITEMS.length);
    }
  });

  describe("private beta", () => {
    const betaIds = (platform: "mac" | "win") =>
      ROADMAP_ITEMS.filter((item) => item[platform] === "beta").map((item) => item.id);

    it("ranks beta between shipped and in progress", () => {
      expect(ROADMAP_STATES).toEqual(["shipped", "beta", "inProgress", "planned"]);
    });

    it("marks the flagged macOS features as private beta", () => {
      expect(betaIds("mac").sort()).toEqual(
        [
          "clipLevels",
          "imageCanvas",
          "imageInspect",
          "localTranscription",
          "screenshotsWhileRecording",
          "textRecognition",
          "zoomFilmstrip",
        ].sort(),
      );
    });

    it("claims no private beta on Windows, which has no build of these", () => {
      expect(betaIds("win")).toEqual([]);
      expect(platformCounts("win").beta).toBe(0);
    });

    it("keeps the camera moving over time planned, not beta", () => {
      const row = ROADMAP_ITEMS.find((item) => item.id === "cameraMoves")!;
      expect(row.mac).toBe("planned");
      expect(stateOf(row, "all")).toBe("planned");
    });

    it("groups a beta row under beta when both platforms are shown", () => {
      const row = ROADMAP_ITEMS.find((item) => item.id === "textRecognition")!;
      expect(stateOf(row, "all")).toBe("beta");
      expect(stateOf(row, "win")).toBe("planned");
    });
  });
});
