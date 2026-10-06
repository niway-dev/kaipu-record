import { describe, expect, it } from "vitest";
import {
  normalizeTag,
  TAG_MAX_LENGTH,
  TAGS_PER_ITEM_MAX,
  TagLimitError,
  TagSetBuilder,
} from "./tags";

describe("normalizeTag", () => {
  it("normalizes the spec's examples", () => {
    expect(normalizeTag(" Cricut ")).toBe("cricut");
    expect(normalizeTag("Issue #1232")).toBe("issue-#1232");
    expect(normalizeTag("video")).toBe("video");
  });

  it("collapses whitespace and dashes", () => {
    expect(normalizeTag("  my   big -- idea  ")).toBe("my-big-idea");
    expect(normalizeTag("-edge-")).toBe("edge");
  });

  it("rejects path separators, control characters and other symbols", () => {
    expect(normalizeTag("../x")).toBeNull();
    expect(normalizeTag("a/b")).toBeNull();
    expect(normalizeTag("a\\b")).toBeNull();
    expect(normalizeTag("tab\u0000")).toBeNull();
    expect(normalizeTag("café")).toBeNull();
    expect(normalizeTag("#lead")).toBeNull(); // must start with a letter or digit
  });

  it("rejects empty and over-long tags", () => {
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag("a".repeat(TAG_MAX_LENGTH))).toBe("a".repeat(TAG_MAX_LENGTH));
    expect(normalizeTag("a".repeat(TAG_MAX_LENGTH + 1))).toBeNull();
  });
});

describe("TagSetBuilder", () => {
  it("dedupes across spellings and keeps insertion order", () => {
    const tags = new TagSetBuilder().add("Cricut").add("video").add("cricut ").build();
    expect(tags).toEqual(["cricut", "video"]);
  });

  it("ignores invalid tags", () => {
    expect(new TagSetBuilder(["ok", "../x", ""]).build()).toEqual(["ok"]);
  });

  it("removes by any spelling", () => {
    expect(new TagSetBuilder(["a", "Big Idea"]).remove("big idea").build()).toEqual(["a"]);
  });

  it("throws past the per-item limit", () => {
    const builder = new TagSetBuilder();
    for (let i = 0; i < TAGS_PER_ITEM_MAX; i++) builder.add(`t${i}`);
    expect(builder.build()).toHaveLength(TAGS_PER_ITEM_MAX);
    builder.add("one-more");
    expect(() => builder.build()).toThrow(TagLimitError);
  });
});
