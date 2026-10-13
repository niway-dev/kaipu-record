import { describe, expect, it } from "vitest";
import {
  isTagColor,
  nextTagColor,
  normalizeTagName,
  TAG_COLORS,
  TAG_NAME_MAX_LENGTH,
  tagSlug,
} from "./tags";

describe("normalizeTagName", () => {
  it("trims and collapses whitespace, keeping capitals", () => {
    expect(normalizeTagName("  Archivos   varios ")).toBe("Archivos varios");
    expect(normalizeTagName("Cricut")).toBe("Cricut");
  });

  it("refuses empty, too long, separators and control characters", () => {
    expect(normalizeTagName("   ")).toBeNull();
    expect(normalizeTagName("x".repeat(TAG_NAME_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeTagName("a/b")).toBeNull();
    expect(normalizeTagName("..\\x")).toBeNull();
    expect(normalizeTagName("bad\u0007bell")).toBeNull();
  });

  it("refuses a name with nothing left for a slug", () => {
    expect(normalizeTagName("!!!")).toBeNull();
  });
});

describe("tagSlug", () => {
  it("lowercases and joins words with underscores", () => {
    expect(tagSlug("Archivos varios")).toBe("archivos_varios");
    expect(tagSlug("Issue #1232")).toBe("issue_#1232");
    expect(tagSlug("Demo")).toBe(tagSlug("demo"));
  });

  it("keeps accented letters and drops punctuation", () => {
    expect(tagSlug("Canción  nueva!")).toBe("canción_nueva");
    expect(tagSlug("v1.2, beta")).toBe("v1_2_beta");
  });
});

describe("palette", () => {
  it("knows its colors", () => {
    expect(isTagColor("lagoon")).toBe(true);
    expect(isTagColor("#ff0000")).toBe(false);
  });

  it("picks the least used color, palette order on ties", () => {
    expect(nextTagColor([])).toBe(TAG_COLORS[0]);
    expect(nextTagColor(["rose"])).toBe("coral");
    expect(nextTagColor([...TAG_COLORS, "rose"])).toBe("coral");
  });
});
