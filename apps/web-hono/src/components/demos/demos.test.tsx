import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import en from "@kaipu/i18n/messages/en";
import es from "@kaipu/i18n/messages/es";

import { renderWithProviders } from "@/test/render";
import { DemoCard, type DemoId } from "./demo-card";
import { createTimeline } from "./timeline";

afterEach(cleanup);

const IDS: DemoId[] = ["editor", "workspaces", "share"];

describe("web demos", () => {
  // Every key the demos read must exist in the landing slice, in both languages.
  it.each([
    ["en", en],
    ["es", es],
  ])("ports every demo word into landing.demos in %s", (_locale, catalog) => {
    const demos = catalog.landing.demos as Record<string, string>;
    const source = catalog.onboarding.demos as Record<string, string>;
    for (const [key, value] of Object.entries(demos)) expect(source[key]).toBe(value);
    for (const key of ["shareDestChat", "edSectionIntro", "wsWork"])
      expect(demos[key]).toBeTruthy();
  });

  it.each(IDS)("renders the %s demo with a stage that cannot widen the page", (id) => {
    const { container } = renderWithProviders(<DemoCard id={id} />);
    expect(container.querySelector(`[data-demo-card="${id}"]`)).not.toBeNull();
    // The 660 px stage sits in a clipped, scaled box, so a phone never scrolls sideways.
    const scaled = container.querySelector<HTMLElement>("[data-demo-scaled]");
    expect(scaled?.style.overflow).toBe("hidden");
    expect(scaled?.style.width).toBe("100%");
  });

  it("freezes the timeline at a still frame under reduced motion", () => {
    const frozen = createTimeline({ frozenAt: 5 });
    expect(frozen.frozen).toBe(true);
    expect(frozen.vis("x", 10, 1)).toMatch(/paused$/);
    const running = createTimeline();
    expect(running.vis("x", 10, 1)).not.toMatch(/paused/);
  });

  it.each([
    "scene.tsx",
    "timeline.ts",
    "icons.tsx",
    "editor-demo.tsx",
    "share-demo.tsx",
    "workspaces-demo.tsx",
    "demo-text.ts",
    "use-reduced-motion.ts",
  ])("%s names the desktop file it was copied from", (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, file), "utf8");
    expect(source).toContain(
      `Ported from apps/kaipu-record/src/renderer/src/features/onboarding/demos/${file}`,
    );
  });
});
