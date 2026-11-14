import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DEMO_IDS, DEMO_ICONS, OnboardingDemo, type DemoId } from "./index";

const BEATS: Record<DemoId, number> = {
  record: 4,
  capture: 7,
  share: 3,
  editor: 4,
  workspaces: 3,
};

/** Every inline `animation` value under the container. */
function animations(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("[style*='animation']")].map(
    (el) => el.style.animation,
  );
}

describe("OnboardingDemo", () => {
  it("lists the demos in card order, each with an icon", () => {
    expect(DEMO_IDS).toEqual(["record", "capture", "share", "editor", "workspaces"]);
    for (const id of DEMO_IDS) expect(DEMO_ICONS[id]).toBeTypeOf("function");
  });

  describe.each(DEMO_IDS)("%s", (id) => {
    it("renders its stage, its beat chips and one style element with kd- keyframes", () => {
      const { container } = render(<OnboardingDemo id={id} reducedMotion={false} />);
      const styles = container.querySelectorAll("style");
      expect(styles).toHaveLength(1);
      expect(styles[0]?.textContent).toContain("@keyframes kd-");
      expect(container.querySelectorAll("[data-demo-stage]")).toHaveLength(1);
      expect(container.querySelectorAll("[data-demo-beat]")).toHaveLength(BEATS[id]);
      // Moving: the stage fades in and out, nothing is paused.
      const running = animations(container);
      expect(running.length).toBeGreaterThan(BEATS[id]);
      expect(running.some((a) => a.includes("paused"))).toBe(false);
    });

    it("holds a still frame under reduced motion", () => {
      const { container } = render(<OnboardingDemo id={id} reducedMotion />);
      expect(container.querySelector("style")?.textContent).toContain("@keyframes kd-");
      expect(container.querySelectorAll("[data-demo-beat]")).toHaveLength(BEATS[id]);
      const frozen = animations(container);
      expect(frozen.length).toBeGreaterThan(BEATS[id]);
      for (const a of frozen) expect(a).toContain("paused");
      // The stage does not fade out of view.
      const stage = container.querySelector<HTMLElement>("[data-demo-stage]");
      expect(stage?.style.animation).toBe("");
    });
  });

  it("uses only kd- animation names", () => {
    for (const id of DEMO_IDS) {
      const { container, unmount } = render(<OnboardingDemo id={id} reducedMotion={false} />);
      for (const a of animations(container)) expect(a).toMatch(/^kd-/);
      unmount();
    }
  });
});
