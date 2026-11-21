import { describe, expect, it } from "vitest";
import { globToRegExp, splitWatchSpec } from "./watch";

describe("globToRegExp", () => {
  it("matches * within a file name only", () => {
    const re = globToRegExp("*.mp4.part");
    expect(re.test("a.mp4.part")).toBe(true);
    expect(re.test("a.mp4")).toBe(false);
    expect(re.test("x/a.mp4.part")).toBe(false);
  });
  it("escapes regex characters", () => {
    expect(globToRegExp("a+b.part").test("a+b.part")).toBe(true);
    expect(globToRegExp("a+b.part").test("aab.part")).toBe(false);
  });
});

describe("splitWatchSpec", () => {
  it("treats a spec with * as dir + glob", () => {
    expect(splitWatchSpec("/a/b/*.part", () => false)).toEqual({ dir: "/a/b", pattern: "*.part" });
  });
  it("treats an existing directory as every file in it", () => {
    expect(splitWatchSpec("/a/b", () => true)).toEqual({ dir: "/a/b", pattern: "*" });
  });
  it("treats a plain missing path as a single file name", () => {
    expect(splitWatchSpec("/a/b/x.part", () => false)).toEqual({ dir: "/a/b", pattern: "x.part" });
  });
});
