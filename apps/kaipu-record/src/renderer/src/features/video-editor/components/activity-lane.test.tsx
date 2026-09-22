import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import { ActivityLane } from "./activity-lane";

// Source 0–20 s with 5–10 s deleted → timeline 15 s.
const items: TrackItem[] = [
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 5 },
  { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 20 },
];
const layout = toLayout(items);

describe("ActivityLane", () => {
  it("places clicks on the timeline and hides clicks in deleted footage", () => {
    const { container } = render(
      <ActivityLane
        layout={layout}
        marks={[
          { kind: "click", t: 1.5 },
          { kind: "click", t: 7 },
          { kind: "click", t: 12 },
        ]}
      />,
    );
    const clicks = [...container.querySelectorAll<HTMLElement>("span")].filter(
      (s) => s.style.height === "",
    );
    expect(clicks.map((c) => c.style.left)).toEqual(["10%", `${(7 / 15) * 100}%`]);
  });

  it("splits a dwell across a cut and sizes it by strength", () => {
    const { container } = render(
      <ActivityLane layout={layout} marks={[{ kind: "dwell", start: 4, end: 11, strength: 1 }]} />,
    );
    const bars = [...container.querySelectorAll<HTMLElement>("span")];
    expect(bars).toHaveLength(2);
    expect(bars.every((b) => b.style.height === "18px")).toBe(true);
  });
});
