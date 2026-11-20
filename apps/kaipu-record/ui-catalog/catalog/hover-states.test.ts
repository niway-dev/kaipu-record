import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  // The step that waits for the device list must not be met by the empty-list label, which the
  // card shows on first render. The text comes from the shipped messages, not from a copy.
  it("waits for a real microphone, not for the empty-list label", () => {
    const en = JSON.parse(
      readFileSync(resolve(__dirname, "../../../../packages/i18n/messages/en.json"), "utf8"),
    ) as { micSettings: { noDevices: string } };
    const record = CATALOGS.find((c) => c.screen === "record")!;
    for (const name of ["mic-toggle-hover", "mic-device-hover"]) {
      const first = (record.states[name]!.steps ?? [])[0];
      expect(first && "waitFor" in first && JSON.stringify(first.waitFor), name).toContain(
        en.micSettings.noDevices,
      );
    }
  });

  // Not asserted here: that each hover step's role/name resolves in the rendered card. A jsdom
  // render would need the card's real props and would mostly re-state the labels; the catalog
  // run itself fails (waitFor/stillOnScreen) when a hover does not land.
});
