import { describe, expect, it } from "vitest";
import en from "@kaipu/i18n/messages/en";
import es from "@kaipu/i18n/messages/es";

import { FEATURE_CHAPTERS } from "@/components/features/features-config";
import { CHAPTERS, FEATURES_CHAPTERS, numbered } from "./chapters";

describe("home chapters", () => {
  it("merges Record and Capture: one Capture chapter, no Record", () => {
    const ids = CHAPTERS.map((c) => c.id);
    expect(ids).toContain("capture");
    expect(ids).not.toContain("record");
  });

  it("orders the numbered chapters Capture, Edit, Share, Find, numbered 01 to 04", () => {
    const chapters = numbered(CHAPTERS);
    expect(chapters.map((c) => c.id)).toEqual(["capture", "edit", "share", "find"]);
    expect(chapters.map((c) => c.number)).toEqual(["01", "02", "03", "04"]);
    // The rail's counter reads "01 / 04": the total must follow the list.
    expect(en.landing.homeRailTotal).toBe("04");
    expect(es.landing.homeRailTotal).toBe("04");
  });

  it("puts On the way between the chapters and the files bookend", () => {
    const ids = CHAPTERS.map((c) => c.id);
    expect(ids.indexOf("on-the-way")).toBe(ids.indexOf("find") + 1);
    expect(ids.indexOf("files")).toBe(ids.length - 1);
  });

  it.each([
    ["home", CHAPTERS],
    ["features", FEATURES_CHAPTERS],
  ])("keeps %s ids and anchors unique, with id equal to slug apart from the top", (_name, list) => {
    const ids = list.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of list) expect(c.slug).toBe(c.id === "hero" ? "top" : c.id);
  });

  it.each([
    ["en", en],
    ["es", es],
  ])("has a label in %s for every chapter in either list", (_locale, catalog) => {
    const landing = catalog.landing as Record<string, unknown>;
    const missing = [...CHAPTERS, ...FEATURES_CHAPTERS]
      .map((c) => c.labelKey)
      .filter((key) => key !== "navBrand" && typeof landing[key] !== "string");
    expect(missing).toEqual([]);
  });

  it("keeps the features page rail on the ids its sections carry", () => {
    const featureIds = FEATURE_CHAPTERS.map((c) => c.id);
    const railIds = FEATURES_CHAPTERS.filter((c) => c.number !== null).map((c) => c.id);
    expect(railIds).toEqual(featureIds);
  });
});
