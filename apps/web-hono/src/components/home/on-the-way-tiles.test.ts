import { describe, expect, it } from "vitest";
import en from "@kaipu/i18n/messages/en";
import es from "@kaipu/i18n/messages/es";

import { ROADMAP_ITEMS, stateOf } from "@/components/roadmap/roadmap-config";
import { ON_THE_WAY_TILES } from "./on-the-way-tiles";

const stateOfTile = (id: string) => {
  const tile = ON_THE_WAY_TILES.find((t) => t.id === id)!;
  return stateOf(ROADMAP_ITEMS.find((item) => item.id === tile.roadmapId)!, "mac");
};

describe("On the way tiles", () => {
  it("lists OCR, measure, colors, image grid and camera moves", () => {
    expect(ON_THE_WAY_TILES.map((t) => t.id)).toEqual([
      "ocr",
      "measure",
      "colors",
      "grid",
      "camera",
    ]);
  });

  // The badge is read from the roadmap row, so this is the brand rule: nothing planned reads as
  // available, and nothing in beta reads as shipped.
  it("badges the four image tools Private beta and the camera Planned", () => {
    for (const id of ["ocr", "measure", "colors", "grid"]) expect(stateOfTile(id)).toBe("beta");
    expect(stateOfTile("camera")).toBe("planned");
  });

  it("never claims a tile is shipped", () => {
    for (const tile of ON_THE_WAY_TILES) expect(stateOfTile(tile.id)).not.toBe("shipped");
  });

  it("labels the beta state Private beta in English and Beta privada in Spanish", () => {
    expect(en.roadmap.status.beta).toBe("Private beta");
    expect(es.roadmap.status.beta).toBe("Beta privada");
  });

  it.each([
    ["en", en],
    ["es", es],
  ])("has copy for every tile in %s", (_locale, catalog) => {
    const landing = catalog.landing as Record<string, unknown>;
    const missing = ON_THE_WAY_TILES.flatMap((t) => [t.title, t.body]).filter(
      (key) => typeof landing[key] !== "string",
    );
    expect(missing).toEqual([]);
  });
});
