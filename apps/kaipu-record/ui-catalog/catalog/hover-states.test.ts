import { describe, expect, it } from "vitest";
import { CATALOGS } from "./index";

describe("the Capture page's hover states", () => {
  // A hover that never lands (or is lost to a re-render before the shot) leaves an image of the
  // resting state under a hover name (NIW2-882: the left zone's hover never showed). Each of
  // them must say how the shot proves the pointer is still there.
  it("proves the pointer is still over the target when the shot is taken", () => {
    const missing: string[] = [];
    for (const cat of CATALOGS.filter((c) => c.screen === "record")) {
      for (const [name, spec] of Object.entries(cat.states)) {
        const hovers = (spec.steps ?? []).some((step) => "hover" in step);
        if (hovers && spec.keepPointer && !spec.stillOnScreen)
          missing.push(`${cat.screen}/${name}`);
      }
    }
    expect(missing).toEqual([]);
    const names = CATALOGS.filter((c) => c.screen === "record").flatMap((c) =>
      Object.keys(c.states),
    );
    expect(names).toEqual(expect.arrayContaining(["mic-toggle-hover", "mic-device-hover"]));
  });
});
