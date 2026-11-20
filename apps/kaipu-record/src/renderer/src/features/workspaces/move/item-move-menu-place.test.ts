import { describe, expect, it } from "vitest";
import { placeItemMenu } from "./item-move-menu";

const button = (right: number, top = 100) => ({ top, bottom: top + 26, right });

describe("placeItemMenu", () => {
  it("aligns the menu's right edge with the button when there is room", () => {
    expect(placeItemMenu(button(900), 1400, 900)).toMatchObject({ left: 600, top: 132 });
  });

  it("keeps the menu inside the window's left edge for a first-column card", () => {
    // Right-aligned, a 300 px menu would start at x = -50.
    expect(placeItemMenu(button(250), 1400, 900)).toMatchObject({ left: 8 });
  });

  it("keeps the menu inside the window's right edge", () => {
    expect(placeItemMenu(button(1400), 1400, 900)).toMatchObject({ left: 1092 });
  });

  it("opens above the button near the bottom of the window", () => {
    expect(placeItemMenu(button(900, 800), 1400, 900)).toMatchObject({ bottom: 106, top: "auto" });
  });
});
