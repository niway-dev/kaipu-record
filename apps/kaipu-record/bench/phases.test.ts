import { describe, expect, it } from "vitest";
import { PhaseTracker } from "./phases";

describe("PhaseTracker", () => {
  it("starts in 'start' and switches on each mark, using the monotonic clock", () => {
    let now = 1000;
    const t = new PhaseTracker(() => now);
    expect(t.current()).toBe("start");
    now = 1500;
    t.mark("export start");
    now = 4000;
    t.mark("scrub");
    expect(t.current()).toBe("scrub");
    expect(t.marks()).toEqual([
      { label: "start", tMs: 0 },
      { label: "export start", tMs: 500 },
      { label: "scrub", tMs: 3000 },
    ]);
  });
  it("ignores blank labels and trims", () => {
    const t = new PhaseTracker(() => 0);
    t.mark("   ");
    t.mark("  a  ");
    expect(t.marks().map((m) => m.label)).toEqual(["start", "a"]);
  });
  it("phaseAt returns the phase active at a time", () => {
    let now = 0;
    const t = new PhaseTracker(() => now);
    now = 10;
    t.mark("b");
    expect(t.phaseAt(5)).toBe("start");
    expect(t.phaseAt(10)).toBe("b");
  });
});
